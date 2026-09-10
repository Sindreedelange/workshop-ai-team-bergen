import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Kartutsnitt } from "../../shared/geometri.ts";
import {
  getRingBounds, intersectsKartutsnitt, isBoundedKartutsnitt, isNonnegativeInteger, isObject,
  parseKartutsnittQuery, polygonDeler
} from "../../shared/geometri.ts";
import type { PlansoneFeature, PlansoneSvar } from "../../shared/hensynssoner.ts";
import {
  KPA2018_KOMMUNENUMMER, KPA2018_PLANID, PLANSONE_MAX_SIDE_METER, PLANSONE_MAX_TREFF
} from "../../shared/hensynssoner.ts";
import type { Plandatasett } from "./datasett.ts";
import { AREALFORMAALDATASETT, HENSYNSSONEDATASETT } from "./datasett.ts";

const defaultDir = fileURLToPath(new URL("../../../data/", import.meta.url));
const uttrekksaar = 2018;

export class PlanError extends Error {
  readonly status: 400 | 502;

  constructor(status: 400 | 502, message: string) {
    super(message);
    this.status = status;
  }
}

export type PlanQuery = Kartutsnitt & { kommunenummer: string };

export function parsePlanQuery(params: URLSearchParams): PlanQuery {
  return parseKartutsnittQuery(params, melding => new PlanError(400, melding), PLANSONE_MAX_SIDE_METER);
}

/**
 * Én polygondel med sin egen bbox.
 *
 * Indeksen ligger på **delen** og ikke på featuren, som i matrikkel-mock. Grunnen
 * er datasettet: KpAngitthensyn_landskap har to MultiPolygon-features hvis bbox
 * til sammen dekker hver eneste teig i Bergen. En bbox per feature ville sagt
 * «kandidat» for alle oppslag og gjort indeksen verdiløs.
 */
type Del = { bounds: Kartutsnitt; ringer: number[][][]; egenskaper: PlansoneFeature["properties"]; id: number };

type Indeks = { deler: Del[]; antallObjekter: number; antallUtenGeometri: number };

type Datasettstatus = {
  id: string;
  status: "ikke_lastet" | "laster" | "tilgjengelig" | "feil";
  fil: string;
  antallObjekter?: number;
  antallDeler?: number;
  /** GeoJSON tillater geometry: null, og arealformålsfilen har ett slikt objekt. */
  antallUtenGeometri?: number;
  lastetTidspunkt?: string;
};

function buildIndex(datasett: Plandatasett, value: unknown): Indeks {
  // Uten CRS bruker GeoJSON lengdegrad/breddegrad. Et annet CRS må ikke merkes om.
  if (!isObject(value) || value.type !== "FeatureCollection" || !Array.isArray(value.features) || "crs" in value) {
    throw new PlanError(502, `Datasettet ${datasett.id} er ikke en GeoJSON FeatureCollection uten CRS-overstyring.`);
  }
  const deler: Del[] = [];
  const ids = new Set<number>();
  let antallUtenGeometri = 0;
  for (const [index, feature] of value.features.entries()) {
    const invalid = () => new PlanError(502, `Datasettet ${datasett.id} har ugyldige felter eller koordinater i objekt ${index + 1}.`);
    if (!isObject(feature) || feature.type !== "Feature" || !isObject(feature.properties)) throw invalid();
    const p = feature.properties;
    const kode = p[datasett.kodefelt];
    const sonenavn = datasett.navnefelt === null ? null : p[datasett.navnefelt];
    if (!isNonnegativeInteger(p.OBJECTID) || feature.id !== p.OBJECTID || ids.has(p.OBJECTID)
      || p.OBJTYPE !== datasett.objekttype || p.KOMM !== KPA2018_KOMMUNENUMMER || p.PLANID !== KPA2018_PLANID
      || typeof kode !== "number" || !Number.isSafeInteger(kode) || kode < 0
      || (datasett.navnefelt !== null && typeof sonenavn !== "string")
      || !(p.AREALST === undefined || isNonnegativeInteger(p.AREALST))
      || !(p.BESKRIVELSE === undefined || p.BESKRIVELSE === null || typeof p.BESKRIVELSE === "string")) throw invalid();
    ids.add(p.OBJECTID);
    // geometry: null er gyldig GeoJSON, og arealformålsfilen har ett slikt objekt.
    // Et objekt uten flate kan ikke berøre en teig, så det telles og hoppes over.
    if (feature.geometry === null) {
      antallUtenGeometri++;
      continue;
    }
    const polygoner = polygonDeler(feature.geometry);
    if (!polygoner) throw invalid();
    const egenskaper: PlansoneFeature["properties"] = {
      datasett: datasett.id,
      sonekode: kode,
      sonenavn: typeof sonenavn === "string" ? sonenavn : null,
      arealstatus: isNonnegativeInteger(p.AREALST) ? p.AREALST : null,
      beskrivelse: typeof p.BESKRIVELSE === "string" ? p.BESKRIVELSE : null,
      planId: KPA2018_PLANID,
      kommunenummer: KPA2018_KOMMUNENUMMER,
    };
    for (const ringer of polygoner) {
      deler.push({ bounds: getRingBounds(ringer), ringer, egenskaper, id: p.OBJECTID });
    }
  }
  return { deler, antallObjekter: value.features.length, antallUtenGeometri };
}

/**
 * Sutherland-Hodgman mot utsnittet, som er et rektangel og dermed konvekst.
 *
 * Se kommentaren over PlansoneFeature for hvorfor klippingen er nødvendig og
 * ikke bare hyggelig. En ring som klippes bort helt faller ut; et hull klippes
 * som sin egen ring, og fyllregelen på tegnesiden er even-odd, som holder hullet
 * åpent.
 */
type Klippekant = { inne: (p: number[]) => boolean; kryss: (a: number[], b: number[]) => number[] };

/** De fire kantene i utsnittet. Bygges én gang per forespørsel, ikke per ring. */
function klippekanter(bounds: Kartutsnitt): Klippekant[] {
  return [
    { inne: p => p[0]! >= bounds.vest, kryss: (a, b) => skjaeringX(a, b, bounds.vest) },
    { inne: p => p[0]! <= bounds.ost, kryss: (a, b) => skjaeringX(a, b, bounds.ost) },
    { inne: p => p[1]! >= bounds.sor, kryss: (a, b) => skjaeringY(a, b, bounds.sor) },
    { inne: p => p[1]! <= bounds.nord, kryss: (a, b) => skjaeringY(a, b, bounds.nord) },
  ];
}

/**
 * Sutherland-Hodgman mot utsnittet, som er et rektangel og dermed konvekst.
 *
 * Se kommentaren over PlansoneFeature for hvorfor klippingen er nødvendig og
 * ikke bare hyggelig. En ring som klippes bort helt faller ut; et hull klippes
 * som sin egen ring, og fyllregelen på tegnesiden er even-odd, som holder hullet
 * åpent.
 */
function klippRing(ring: number[][], kanter: Klippekant[]): number[][] | null {
  // Siste punkt er en gjentakelse av det første i en lukket GeoJSON-ring.
  let punkter = ring.slice(0, -1);
  for (const kant of kanter) {
    const ut: number[][] = [];
    // Både punktet og predikatet for forrige runde bæres videre. Første pass går
    // over ~100 000 punkter for den største støysonedelen, og å regne `inne` to
    // ganger per punkt er halvparten av arbeidet i den passeringen.
    let forrige = punkter[punkter.length - 1]!;
    let forrigeInne = kant.inne(forrige);
    for (const naa of punkter) {
      const naaInne = kant.inne(naa);
      if (naaInne !== forrigeInne) ut.push(kant.kryss(forrige, naa));
      if (naaInne) ut.push(naa);
      forrige = naa;
      forrigeInne = naaInne;
    }
    punkter = ut;
    if (punkter.length === 0) return null;
  }
  const entydige = new Set(punkter.map(p => `${p[0]},${p[1]}`));
  if (entydige.size < 3) return null;
  return [...punkter, punkter[0]!];
}

function skjaeringX(a: number[], b: number[], x: number): number[] {
  const t = (x - a[0]!) / (b[0]! - a[0]!);
  return [x, a[1]! + t * (b[1]! - a[1]!)];
}

function skjaeringY(a: number[], b: number[], y: number): number[] {
  const t = (y - a[1]!) / (b[1]! - a[1]!);
  return [a[0]! + t * (b[0]! - a[0]!), y];
}

function klippDel(del: Del, kanter: Klippekant[]): PlansoneFeature | null {
  const ringer: number[][][] = [];
  for (const ring of del.ringer) {
    const klippet = klippRing(ring, kanter);
    // Ytterringen først: faller den bort, er ingenting av delen inne i utsnittet.
    if (!klippet) {
      if (ringer.length === 0) return null;
      continue;
    }
    ringer.push(klippet);
  }
  if (ringer.length === 0) return null;
  return { type: "Feature", id: del.id, geometry: { type: "Polygon", coordinates: ringer }, properties: del.egenskaper };
}

function datasettStore(datasett: Plandatasett, dir: string) {
  const file = path.join(dir, datasett.fil);
  let status: Datasettstatus = { id: datasett.id, status: "ikke_lastet", fil: datasett.fil };
  let cached: { metadata: string; indeks: Indeks } | undefined;
  let pending: Promise<Indeks> | undefined;

  async function readMetadata(): Promise<string> {
    const info = await stat(file, { bigint: true });
    if (!info.isFile()) throw new PlanError(502, `Plankilden ${datasett.fil} er ikke en vanlig fil.`);
    return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
  }

  async function refresh(): Promise<Indeks> {
    try {
      const metadata = await readMetadata();
      if (cached?.metadata === metadata) return cached.indeks;
      status = { id: datasett.id, status: "laster", fil: datasett.fil };
      cached = undefined;
      const indeks = buildIndex(datasett, JSON.parse(await readFile(file, "utf8")) as unknown);
      if (await readMetadata() !== metadata) throw new PlanError(502, `Datasettet ${datasett.id} ble endret under innlasting. Prøv igjen.`);
      cached = { metadata, indeks };
      status = {
        id: datasett.id, status: "tilgjengelig", fil: datasett.fil,
        antallObjekter: indeks.antallObjekter, antallDeler: indeks.deler.length,
        antallUtenGeometri: indeks.antallUtenGeometri, lastetTidspunkt: new Date().toISOString(),
      };
      return indeks;
    } catch (error) {
      cached = undefined;
      status = { id: datasett.id, status: "feil", fil: datasett.fil };
      if (error instanceof PlanError) throw error;
      // Parser- og filfeil kan inneholde filstier eller rådata som ikke skal ut.
      throw new PlanError(502, `Datasettet ${datasett.id} kunne ikke leses som gyldig GeoJSON.`);
    }
  }

  return {
    getStatus: (): Datasettstatus => ({ ...status }),
    load: (): Promise<Indeks> => {
      pending ??= refresh().finally(() => { pending = undefined; });
      return pending;
    },
  };
}

export function createPlanStore(dir = process.env.PLAN_DATA_DIR || defaultDir) {
  const alle = [...HENSYNSSONEDATASETT, AREALFORMAALDATASETT];
  const stores = new Map(alle.map(datasett => [datasett.id, datasettStore(datasett, dir)]));

  function tomtSvar(kommunenummer: string, datasett: readonly Plandatasett[]): PlansoneSvar {
    return {
      kommunenummer, kildestatus: "ikke_dekket",
      kilde: {
        navn: "Bergen kommuneplanens arealdel 2018 (KPA2018)", planId: null, versjon: null,
        filer: datasett.map(d => d.fil), uttrekksaar: null, koordinatsystem: "EPSG:4326", syntetisk: false,
      },
      type: "FeatureCollection", features: [], klippetTilUtsnitt: true,
    };
  }

  async function hent(query: PlanQuery, datasett: readonly Plandatasett[]): Promise<PlansoneSvar> {
    if (!isBoundedKartutsnitt(query, PLANSONE_MAX_SIDE_METER)) {
      throw new PlanError(400, `Kartutsnittet må være høyst ${PLANSONE_MAX_SIDE_METER} meter langs hver side.`);
    }
    if (query.kommunenummer !== KPA2018_KOMMUNENUMMER) return tomtSvar(query.kommunenummer, datasett);
    const kanter = klippekanter(query);
    const features: PlansoneFeature[] = [];
    for (const d of datasett) {
      const indeks = await stores.get(d.id)!.load();
      for (const del of indeks.deler) {
        if (!intersectsKartutsnitt(del.bounds, query)) continue;
        const klippet = klippDel(del, kanter);
        if (!klippet) continue;
        features.push(klippet);
        if (features.length > PLANSONE_MAX_TREFF) {
          throw new PlanError(400, `Kartutsnittet har over ${PLANSONE_MAX_TREFF} planflater. Velg et mindre utsnitt; ingen avkortet liste returneres.`);
        }
      }
    }
    return {
      kommunenummer: query.kommunenummer, kildestatus: "tilgjengelig",
      kilde: {
        navn: "Bergen kommuneplanens arealdel 2018 (KPA2018)", planId: KPA2018_PLANID, versjon: "KPA2018",
        filer: datasett.map(d => d.fil), uttrekksaar, koordinatsystem: "EPSG:4326", syntetisk: false,
      },
      type: "FeatureCollection", features, klippetTilUtsnitt: true,
    };
  }

  return {
    // Helsesjekken viser siste kjente tilstand, uten å lese eller laste filene.
    getStatus: (): Datasettstatus[] => [...stores.values()].map(store => store.getStatus()),
    hent,
  };
}
