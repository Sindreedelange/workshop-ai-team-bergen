import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  MatrikkelTeigFeature, MatrikkelTeigGeometri, MatrikkelTeigSvar, MatrikkelNaboteigSvar
} from "../../shared/matrikkelteig.ts";
import { NABOTEIG_MAX_TREFF } from "../../shared/matrikkelteig.ts";
import type { Kartutsnitt } from "../../shared/geometri.ts";
import {
  getGeometriBounds, intersectsKartutsnitt, isBoundedKartutsnitt, isNonnegativeInteger, isNonnegativeNumber,
  isObject, parseKartutsnittQuery, projectGeometri
} from "../../shared/geometri.ts";

const defaultFile = fileURLToPath(new URL("../../../data/matrikkel_bk_25.json", import.meta.url));
const kommunenummerBergen = "4601";

export class TeigError extends Error {
  readonly status: 400 | 502;

  constructor(status: 400 | 502, message: string) {
    super(message);
    this.status = status;
  }
}

export type TeigQuery = { kommunenummer: string; gnr: number; bnr: number; fnr: number };

export function parseTeigQuery(params: URLSearchParams): TeigQuery {
  for (const name of params.keys()) {
    if (!["kommunenummer", "gnr", "bnr", "fnr"].includes(name) || params.getAll(name).length !== 1) {
      throw new TeigError(400, "Bruk bare kommunenummer, gnr, bnr og eventuelt fnr, én gang hver.");
    }
  }
  const kommunenummer = params.get("kommunenummer") || "";
  if (!/^\d{4}$/.test(kommunenummer)) {
    throw new TeigError(400, "kommunenummer må være fire sifre.");
  }
  const readNumber = (name: string, minimum: number, fallback?: number): number => {
    const raw = params.get(name);
    if (raw === null && fallback !== undefined) return fallback;
    const number = Number(raw);
    if (raw === null || !/^\d+$/.test(raw) || !Number.isSafeInteger(number) || number < minimum) {
      throw new TeigError(400, `${name} må være et heltall som er minst ${minimum}.`);
    }
    return number;
  };
  return { kommunenummer, gnr: readNumber("gnr", 1), bnr: readNumber("bnr", 0), fnr: readNumber("fnr", 0, 0) };
}

export type NaboteigQuery = Kartutsnitt & { kommunenummer: string };

export function parseNaboteigQuery(params: URLSearchParams): NaboteigQuery {
  return parseKartutsnittQuery(params, melding => new TeigError(400, melding));
}

type TeigIndex = {
  perEiendom: Map<string, MatrikkelTeigFeature[]>;
  spatial: { bounds: Kartutsnitt; feature: MatrikkelTeigFeature }[];
  antallTeiger: number;
};
type TeigStatus = {
  status: "ikke_lastet" | "laster" | "tilgjengelig" | "feil";
  kommunenummer: string;
  fil: string;
  antallTeiger?: number;
  antallEiendommer?: number;
  lastetTidspunkt?: string;
};

function eiendomKey(gnr: number, bnr: number, fnr: number): string {
  return `${gnr}/${bnr}/${fnr}`;
}

function buildIndex(value: unknown): TeigIndex {
  // Uten CRS bruker GeoJSON lengdegrad/breddegrad. Et annet CRS må ikke merkes om.
  if (!isObject(value) || value.type !== "FeatureCollection" || !Array.isArray(value.features) || "crs" in value) {
    throw new TeigError(502, "Teigdatasettet er ikke en GeoJSON FeatureCollection uten CRS-overstyring.");
  }
  const perEiendom = new Map<string, MatrikkelTeigFeature[]>();
  const spatial: TeigIndex["spatial"] = [];
  const ids = new Set<number>();
  for (const [index, feature] of value.features.entries()) {
    const invalid = () => new TeigError(502, `Teigdatasettet har ugyldige felter eller koordinater i objekt ${index + 1}.`);
    if (!isObject(feature) || feature.type !== "Feature" || !isObject(feature.properties)) throw invalid();
    const p = feature.properties;
    const geometry = projectGeometri(feature.geometry);
    if (!geometry || !isNonnegativeInteger(p.OBJECTID) || feature.id !== p.OBJECTID || ids.has(p.OBJECTID)
      || p.OBJTYPE !== "Teig" || !isNonnegativeInteger(p.GNR) || !isNonnegativeInteger(p.BNR)
      || !isNonnegativeInteger(p.FNR) || !isNonnegativeInteger(p.SNR)
      || !(p.AREAL === null || isNonnegativeNumber(p.AREAL))
      || !(p.AREALMERKNAD === null || typeof p.AREALMERKNAD === "string")
      || typeof p.TINGLYST !== "string" || !isNonnegativeInteger(p.ANTALL_GID)
      || !isNonnegativeNumber(p.Shape_Area) || !isNonnegativeNumber(p.Shape_Length)) throw invalid();
    ids.add(p.OBJECTID);
    const projected: MatrikkelTeigFeature = {
      type: "Feature",
      id: p.OBJECTID,
      geometry,
      properties: {
        OBJECTID: p.OBJECTID, OBJTYPE: p.OBJTYPE, GNR: p.GNR, BNR: p.BNR, FNR: p.FNR, SNR: p.SNR,
        AREAL: p.AREAL, AREALMERKNAD: p.AREALMERKNAD, TINGLYST: p.TINGLYST, ANTALL_GID: p.ANTALL_GID,
        Shape_Area: p.Shape_Area, Shape_Length: p.Shape_Length
      }
    };
    const key = eiendomKey(p.GNR, p.BNR, p.FNR);
    const features = perEiendom.get(key);
    if (features) features.push(projected);
    else perEiendom.set(key, [projected]);
    spatial.push({ bounds: getGeometriBounds(geometry), feature: projected });
  }
  return { perEiendom, spatial, antallTeiger: value.features.length };
}

export function createTeigStore(file = process.env.MATRIKKEL_TEIG_DATA_FILE || defaultFile) {
  const fil = path.basename(file);
  const filenameYear = /^matrikkel_bk_(\d{2}|\d{4})\.json$/.exec(fil)?.[1];
  const uttrekksaar = filenameYear ? Number(filenameYear.length === 2 ? `20${filenameYear}` : filenameYear) : null;
  const kilde: MatrikkelTeigSvar["kilde"] = {
    navn: "Lokalt teiguttrekk for Bergen (4601)", fil, uttrekksaar, koordinatsystem: "EPSG:4326", syntetisk: false
  };
  let status: TeigStatus = { status: "ikke_lastet", kommunenummer: kommunenummerBergen, fil };
  let cached: { metadata: string; index: TeigIndex } | undefined;
  let pending: Promise<TeigIndex> | undefined;

  async function readMetadata(): Promise<string> {
    const info = await stat(file, { bigint: true });
    if (!info.isFile()) throw new TeigError(502, "Teigkilden er ikke en vanlig fil.");
    return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
  }

  async function refresh(): Promise<TeigIndex> {
    try {
      const metadata = await readMetadata();
      if (cached?.metadata === metadata) return cached.index;
      status = { status: "laster", kommunenummer: kommunenummerBergen, fil };
      cached = undefined;
      const index = buildIndex(JSON.parse(await readFile(file, "utf8")) as unknown);
      if (await readMetadata() !== metadata) throw new TeigError(502, "Teigdatasettet ble endret under innlasting. Prøv igjen.");
      cached = { metadata, index };
      status = {
        status: "tilgjengelig", kommunenummer: kommunenummerBergen, fil,
        antallTeiger: index.antallTeiger, antallEiendommer: index.perEiendom.size,
        lastetTidspunkt: new Date().toISOString()
      };
      return index;
    } catch (error) {
      cached = undefined;
      status = { status: "feil", kommunenummer: kommunenummerBergen, fil };
      if (error instanceof TeigError) throw error;
      // Parser- og filfeil kan inneholde filstier eller rådata som ikke skal ut.
      throw new TeigError(502, "Teigdatasettet kunne ikke leses som gyldig GeoJSON.");
    }
  }

  function load(): Promise<TeigIndex> {
    pending ??= refresh().finally(() => { pending = undefined; });
    return pending;
  }

  return {
    getStatus(): TeigStatus {
      // Helsesjekken viser siste kjente tilstand, uten å lese eller laste filen.
      return { ...status };
    },
    async getTeiger(query: TeigQuery): Promise<MatrikkelTeigSvar> {
      if (query.kommunenummer !== kommunenummerBergen) {
        return {
          kommunenummer: query.kommunenummer, kildestatus: "ikke_dekket",
          kilde: { ...kilde, fil: null, uttrekksaar: null }, type: "FeatureCollection", features: []
        };
      }
      const index = await load();
      return {
        kommunenummer: query.kommunenummer, kildestatus: "tilgjengelig", kilde: { ...kilde },
        type: "FeatureCollection",
        features: index.perEiendom.get(eiendomKey(query.gnr, query.bnr, query.fnr)) || []
      };
    },
    async getNaboteiger(query: NaboteigQuery): Promise<MatrikkelNaboteigSvar> {
      if (!isBoundedKartutsnitt(query)) throw new TeigError(400, "Kartutsnittet må være høyst 500 meter langs hver side.");
      if (query.kommunenummer !== kommunenummerBergen) {
        return {
          kommunenummer: query.kommunenummer, kildestatus: "ikke_dekket",
          kilde: { ...kilde, fil: null, uttrekksaar: null }, type: "FeatureCollection", features: [], avkortet: false
        };
      }
      const index = await load();
      const features: MatrikkelTeigFeature[] = [];
      for (const entry of index.spatial) {
        if (!intersectsKartutsnitt(entry.bounds, query)) continue;
        features.push(entry.feature);
        if (features.length > NABOTEIG_MAX_TREFF) {
          throw new TeigError(400, "Kartutsnittet har over 200 teiger. Velg et mindre utsnitt; ingen avkortet liste returneres.");
        }
      }
      return {
        kommunenummer: query.kommunenummer, kildestatus: "tilgjengelig", kilde: { ...kilde },
        type: "FeatureCollection", features, avkortet: false
      };
    }
  };
}
