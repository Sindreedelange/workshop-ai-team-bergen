import type {
  GarasjeAdresse, GarasjeArealberegning, GarasjeArealformaal, GarasjeBebyggelse, GarasjeEiendomsGeoJson, GarasjeEksisterendeBygning,
  GarasjeGrunnlag, GarasjeKilde, GarasjePlan, GarasjePolygon, GarasjePunkt, GarasjeNabotomter,
} from "../../shared/garasje.ts";
import { getTeigBounds, intersectsKartutsnitt, isBoundedKartutsnitt, NABOTEIG_MAX_TREFF } from "../../shared/matrikkelteig.ts";
import { classifyArealsone } from "../../shared/arealsoner.ts";
import { findGarasjeKommunekilder, getGarasjeKartlagUrl, type GarasjeKommunekilder } from "../../shared/garasje-kommuner.ts";
import { HttpError } from "./errors.ts";
import { containsPunkt, validateGarasjePunkt } from "./garasje.ts";
import { callUpstream } from "./upstream.ts";
import { matrikkelBaseUrl } from "./config.ts";

const ADRESSE_URL = "https://ws.geonorge.no/adresser/v1/sok";
const EIENDOM_URL = "https://api.kartverket.no/eiendom/v1/geokoding";
// /punkt returns points, not polygons. /punkt/omrader and maksTreff are documented
// at https://api.kartverket.no/eiendom/v1/openapi.json (verified 2026-09-10).
const NABOTOMTER_URL = "https://api.kartverket.no/eiendom/v1/punkt/omrader";
const layers = {
  kpa: {
    fields: ["KPAREALFORMAL", "BESKRIVELSE", "PLANID"],
    optionalFields: ["AREALST"],
  },
  reguleringsplan: {
    fields: ["PLANID", "PLANNAVN"],
  },
  bygninger: {
    // The same public layer's FeatureServer query timed out in verification.
    // Its documented MapServer query returned actual footprints.
    // FKB BYGGNR links to a building, not to a matrikkelenhet. The open national
    // Bygningspunkt WFS exposes matrikkelenhetId only in GML; geokoding's lokalid
    // identifies a teig instead. Never join those unrelated IDs or call this a
    // registered property relationship.
    fields: ["OBJECTID"],
    optionalFields: ["OBJTYPE", "BYGGNR", "BYGGTYP_NBR", "BYGGTYPE", "BYGGSTAT", "STATUS", "BRUKSAREAL"],
  },
} as const;
type LayerId = keyof typeof layers;
type SourceId = LayerId | "eiendomsgrenser";

function fail(message = "Datakilden svarte med et ugyldig eller ufullstendig format."): never {
  throw new HttpError(message, 502);
}

function record(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) fail();
  return input as Record<string, unknown>;
}

function text(input: unknown, max = 300): string {
  if (typeof input !== "string" || !input.trim() || input.length > max || /[\u0000-\u001f]/u.test(input)) fail();
  return input.trim();
}

function integer(input: unknown, min = 0): number {
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input < min) fail();
  return input;
}

function planId(input: unknown): string {
  const id = text(input, 30);
  if (!/^\d+$/.test(id)) fail("Plankilden svarte uten en gyldig planidentifikasjon.");
  return id;
}

function punkt(input: unknown): GarasjePunkt {
  const value = record(input);
  try {
    return validateGarasjePunkt({ lat: value.lat, lon: value.lon });
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    return fail("Datakilden svarte med ugyldige koordinater.");
  }
}

function testUrl(variable: string, official: string): string {
  const override = process.env[variable];
  if (!override) return official;
  let url: URL;
  try { url = new URL(override); } catch { throw new HttpError("Ugyldig lokal testadresse.", 500); }
  if (process.env.NODE_ENV !== "test" || url.protocol !== "http:"
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || url.username || url.password || url.search || url.hash) {
    throw new HttpError("Alternative datakilder er bare tillatt mot lokal testserver i testmiljø.", 500);
  }
  return url.href;
}

async function readJson(url: URL, service: string): Promise<unknown> {
  const timeout = process.env.NODE_ENV === "test" && process.env.GARASJE_TIMEOUT_MS
    ? Number(process.env.GARASJE_TIMEOUT_MS) : 8000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 30_000) throw new HttpError("Ugyldig tidsgrense for datakilden.", 500);
  try {
    return await callUpstream<unknown>(
      { service, action: "Å hente offentlige kartdata" },
      () => fetch(url, { signal: AbortSignal.timeout(timeout), redirect: "error", headers: { Accept: "application/json" } }),
    );
  } catch (error) {
    // A response stream can fail after headers arrived, outside upstream's
    // request-error mapping. This catch covers only the HTTP read.
    if (!(error instanceof Error)) throw error;
    // Public geodata is not synthetic. Keep upstream's status mapping without
    // carrying over its sandbox-specific flag or an untrusted response body.
    throw new HttpError(`${service} kunne ikke levere et gyldig svar.`, 502,
      { kilde: url.href, detalj: error.message });
  }
}

function isKommunenummer(input: unknown): input is string {
  return typeof input === "string" && input.length === 4 && /^\d{4}$/.test(input) && input !== "0000";
}

function adresseQuery(sok: string, kommunenummer?: string): URL {
  const url = new URL(testUrl("GARASJE_ADRESSE_URL", ADRESSE_URL));
  url.search = new URLSearchParams({ sok, treffPerSide: "20", side: "0", utkoordsys: "4258",
    ...(kommunenummer !== undefined ? { kommunenummer } : {}) }).toString();
  return url;
}

export async function searchGarasjeAdresser(sok: string, kommunenummer?: string): Promise<GarasjeAdresse[]> {
  if (typeof sok !== "string" || sok.trim().length < 3 || sok.trim().length > 120
    || !/^[\p{L}\p{N} .,'()/-]+$/u.test(sok) || /\d{11}/u.test(sok)) {
    throw new HttpError("Skriv en offentlig gateadresse på 3 til 120 tegn, uten personopplysninger.", 400);
  }
  if (kommunenummer !== undefined && !isKommunenummer(kommunenummer)) {
    throw new HttpError("Kommunenummer må være fire sifre og kan ikke være 0000.", 400);
  }
  const response = record(await readJson(adresseQuery(sok.trim(), kommunenummer), "Kartverkets adresse-API"));
  const metadata = record(response.metadata);
  const total = integer(metadata.totaltAntallTreff);
  if (!Array.isArray(response.adresser) || response.adresser.length > 20
    || response.adresser.length > total || (total > 0 && response.adresser.length === 0)) fail();
  return response.adresser.map(input => {
    const a = record(input), p = record(a.representasjonspunkt);
    if (!isKommunenummer(a.kommunenummer)) fail("Adressetjenesten svarte med ugyldig kommunenummer.");
    if (kommunenummer !== undefined && a.kommunenummer !== kommunenummer) fail("Adressetjenesten svarte med en annen kommune enn det ble søkt etter.");
    if (p.epsg !== "EPSG:4258") fail("Adressetjenesten svarte i et ukjent koordinatsystem.");
    return {
      adressetekst: text(a.adressetekst), kommunenummer: a.kommunenummer,
      ...(a.kommunenavn === undefined || a.kommunenavn === null ? {} : { kommunenavn: text(a.kommunenavn, 100) }),
      gardsnummer: integer(a.gardsnummer, 1), bruksnummer: integer(a.bruksnummer),
      festenummer: integer(a.festenummer),
      // Geonorge returns null for undernummer on ordinary vegadresser.
      undernummer: a.undernummer === null ? 0 : integer(a.undernummer),
      punkt: punkt(p),
    };
  });
}

function officialLayerUrl(id: LayerId, kommune: GarasjeKommunekilder | undefined): string {
  return kommune ? getGarasjeKartlagUrl(kommune, id) : "";
}

type Envelope = [number, number, number, number];

function readKpaSonenavn(metadata: Record<string, unknown>, kode: number, arealstatus: number): string | undefined {
  try {
    const renderer = record(record(metadata.drawingInfo).renderer);
    if (renderer.type !== "uniqueValue" || renderer.field1 !== "KPAREALFORMAL"
      || renderer.field2 !== "AREALST" || renderer.field3) return undefined;
    const matches: string[] = [];
    if (Array.isArray(renderer.uniqueValueInfos) && renderer.uniqueValueInfos.length) {
      if (renderer.fieldDelimiter !== ",") return undefined;
      for (const input of renderer.uniqueValueInfos) {
        const info = record(input);
        if (info.value === `${kode},${arealstatus}`) matches.push(text(info.label));
      }
    }
    if (Array.isArray(renderer.uniqueValueGroups)) {
      for (const input of renderer.uniqueValueGroups) {
        const group = record(input);
        if (!Array.isArray(group.classes)) return undefined;
        for (const inputClass of group.classes) {
          const item = record(inputClass);
          if (!Array.isArray(item.values)) return undefined;
          if (item.values.some(values => Array.isArray(values) && values.length === 2
            && values[0] === String(kode) && values[1] === String(arealstatus))) {
            matches.push(text(item.label));
          }
        }
      }
    }
    const names = [...new Set(matches)];
    return names.length === 1 ? names[0] : undefined;
  } catch (error) {
    // Presentation metadata can invalidate a label, not the source's raw plan
    // attributes. The caller retains those facts and reports an unknown zone.
    if (error instanceof HttpError) return undefined;
    throw error;
  }
}

async function queryLayer(id: LayerId, kommune: GarasjeKommunekilder | undefined, p: GarasjePunkt, geometry: boolean, envelope?: Envelope): Promise<Record<string, unknown>[]> {
  if (!kommune) throw new HttpError("Kommunal kartkilde er ikke konfigurert.", 500);
  const layer = kommune[id], schema = layers[id];
  const root = new URL(layer.path, testUrl("GARASJE_KART_BASE_URL", kommune.kartBaseUrl).replace(/\/?$/, "/"));
  const metadataUrl = new URL(root);
  metadataUrl.searchParams.set("f", "json");
  const metadata = record(await readJson(metadataUrl, layer.navn));
  if (metadata.error || metadata.geometryType !== "esriGeometryPolygon"
    || typeof metadata.capabilities !== "string" || !metadata.capabilities.split(",").includes("Query")
    || !Array.isArray(metadata.fields)) fail("Kartlagets metadata bekrefter ikke at laget kan brukes.");
  const definitions = metadata.fields.map(record);
  const fields = definitions.map(f => text(f.name));
  if (schema.fields.some(f => !fields.includes(f))) fail("Kartlaget mangler nødvendige felter.");
  const requestedFields: string[] = [...schema.fields];
  if ("optionalFields" in schema) requestedFields.push(...schema.optionalFields.filter(f => fields.includes(f)));
  const url = new URL(`${root.href}/query`);
  url.search = new URLSearchParams({
    f: "json", geometry: envelope
      ? envelope.join(",")
      : `${p.lon},${p.lat}`,
    geometryType: envelope ? "esriGeometryEnvelope" : "esriGeometryPoint",
    inSR: "4258", outSR: "4258", spatialRel: "esriSpatialRelIntersects",
    outFields: requestedFields.join(","), returnGeometry: String(geometry), returnZ: "false", returnM: "false",
    resultRecordCount: "500",
  }).toString();
  const data = record(await readJson(url, layer.navn));
  if (data.error || (data.exceededTransferLimit !== undefined && data.exceededTransferLimit !== false)
    || !Array.isArray(data.features) || data.features.length > 500) {
    fail("Kartkilden svarte med feil eller et ufullstendig utvalg. Ingen konklusjon kan trekkes fra utvalget.");
  }
  if (geometry && data.features.length > 0) {
    const sr = record(data.spatialReference);
    if (sr.wkid !== 4258 || data.geometryType !== "esriGeometryPolygon") fail("Kartet svarte i et ukjent koordinatsystem.");
  }
  return data.features.map(input => {
    const feature = record(input), attributes = record(feature.attributes);
    const clean = {
      attributes: Object.fromEntries(requestedFields.map(name => [name, attributes[name]])),
      ...(geometry ? { geometry: feature.geometry } : {}),
    };
    if (id !== "kpa" || attributes.AREALST === undefined || attributes.AREALST === null || !requestedFields.includes("AREALST")) return clean;
    const sonenavn = readKpaSonenavn(metadata, integer(attributes.KPAREALFORMAL, 1), integer(attributes.AREALST, 1));
    return { ...clean, ...(sonenavn ? { sonenavn } : {}) };
  });
}

function polygon(feature: Record<string, unknown>): GarasjePolygon {
  const attributes = record(feature.attributes), geometry = record(feature.geometry);
  if (!Array.isArray(geometry.rings) || !geometry.rings.length || geometry.rings.length > 100) fail();
  const ringer: [number, number][][] = geometry.rings.map(ring => {
    if (!Array.isArray(ring) || ring.length < 4 || ring.length > 10_000) fail();
    const points: [number, number][] = ring.map(pair => {
      if (!Array.isArray(pair) || pair.length !== 2) fail();
      const p = punkt({ lon: pair[0], lat: pair[1] });
      return [p.lon, p.lat];
    });
    const first = points[0]!, last = points.at(-1)!;
    if (first[0] !== last[0] || first[1] !== last[1]) fail("Kartkilden svarte med en åpen polygonring.");
    let twiceArea = 0;
    for (let i = 1; i < points.length; i++) {
      const previous = points[i - 1]!, current = points[i]!;
      twiceArea += (previous[0] - first[0]) * (current[1] - first[1])
        - (current[0] - first[0]) * (previous[1] - first[1]);
    }
    if (Math.abs(twiceArea) < 1e-16) fail("Kartkilden svarte med en polygonring uten areal.");
    return points;
  });
  return { id: String(integer(attributes.OBJECTID, 1)), ringer };
}

function buildingAttributes(feature: Record<string, unknown>): GarasjeEksisterendeBygning {
  const attrs = record(feature.attributes);
  const building: GarasjeEksisterendeBygning = { id: String(integer(attrs.OBJECTID, 1)), kobling: "geometri" };
  for (const [source, target] of [
    ["OBJTYPE", "objekttype"], ["BYGGTYPE", "bygningstypeNavn"], ["BYGGSTAT", "bygningsstatus"], ["STATUS", "bygningsstatusNavn"],
  ] as const) {
    if (attrs[source] !== undefined && attrs[source] !== null) building[target] = text(attrs[source]);
  }
  for (const [source, target] of [["BYGGNR", "bygningsnummer"], ["BYGGTYP_NBR", "bygningstype"]] as const) {
    if (attrs[source] !== undefined && attrs[source] !== null) {
      const value = integer(attrs[source]);
      if (value > 0) building[target] = value;
    }
  }
  if (attrs.BRUKSAREAL !== undefined && attrs.BRUKSAREAL !== null) {
    if (typeof attrs.BRUKSAREAL !== "number" || !Number.isFinite(attrs.BRUKSAREAL) || attrs.BRUKSAREAL < 0) fail();
    building.bruksareal = attrs.BRUKSAREAL;
  }
  return building;
}

function eiendomQuery(adresse: GarasjeAdresse): URL {
  const suffix = adresse.festenummer ? `/${adresse.festenummer}` : "";
  const url = new URL(testUrl("GARASJE_EIENDOM_URL", EIENDOM_URL));
  url.search = new URLSearchParams({
    matrikkelnummer: `${adresse.kommunenummer}-${adresse.gardsnummer}/${adresse.bruksnummer}${suffix}`,
    omrade: "true", utkoordsys: "4258",
  }).toString();
  return url;
}

function lokalTeigQuery(adresse: GarasjeAdresse): URL {
  const url = new URL("/mock/matrikkel/teiger", matrikkelBaseUrl);
  url.search = new URLSearchParams({
    kommunenummer: adresse.kommunenummer,
    gnr: String(adresse.gardsnummer), bnr: String(adresse.bruksnummer), fnr: String(adresse.festenummer)
  }).toString();
  return url;
}

function parseLokaleTeiger(input: unknown, adresse: GarasjeAdresse, nabotomter = false): {
  geojson: GarasjeEiendomsGeoJson;
  kilde: { navn: string; fil?: string; uttrekksaar?: number };
  dekket: boolean;
} {
  const data = record(input);
  const source = record(data.kilde);
  if (data.kommunenummer !== adresse.kommunenummer
    || !["tilgjengelig", "ikke_dekket"].includes(String(data.kildestatus))
    || data.type !== "FeatureCollection" || !Array.isArray(data.features) || data.features.length > 500
    || source.syntetisk !== false || source.koordinatsystem !== "EPSG:4326") {
    fail("Matrikkelmocken svarte med feil kommune, koordinatsystem eller teigformat.");
  }
  if (data.kildestatus === "ikke_dekket" && data.features.length) fail("Teiger ble returnert fra et område kilden ikke dekker.");
  if (data.kildestatus === "tilgjengelig" && adresse.kommunenummer !== "4601") {
    fail("Det lokale Bergen-uttrekket kan ikke brukes for en annen kommune.");
  }
  const navn = text(source.navn);
  const fil = source.fil === null ? undefined : text(source.fil, 160);
  if (fil && (!/^[a-zA-Z0-9_.-]+$/.test(fil) || fil === "." || fil === "..")) fail("Teigkilden mangler et gyldig filnavn.");
  const uttrekksaar = source.uttrekksaar === null ? undefined : integer(source.uttrekksaar, 1900);
  if (data.kildestatus === "tilgjengelig" && !fil) fail("Lokale teiger mangler kildefil.");
  const ids = new Set<number>();
  let pointCount = 0;
  const features: GarasjeEiendomsGeoJson["features"] = data.features.map(input => {
    const feature = record(input), geometry = record(feature.geometry), attrs = record(feature.properties);
    const gnr = integer(attrs.GNR, nabotomter ? 0 : 1), bnr = integer(attrs.BNR), fnr = integer(attrs.FNR);
    if (feature.type !== "Feature" || attrs.OBJTYPE !== "Teig"
      || (!nabotomter && (gnr !== adresse.gardsnummer || bnr !== adresse.bruksnummer || fnr !== adresse.festenummer))) {
      fail("Det lokale teiguttrekket tilhører en annen matrikkelenhet.");
    }
    const objectId = integer(attrs.OBJECTID, 1);
    if (feature.id !== objectId || ids.has(objectId)) fail("Det lokale teiguttrekket har dupliserte eller ugyldige objekt-ID-er.");
    ids.add(objectId);
    let polygons: Pair[][][];
    const readRings = (value: unknown) => nabotomter
      ? polygon({ attributes: { OBJECTID: 1 }, geometry: { rings: value } }).ringer : validateParcelRings(value);
    if (geometry.type === "Polygon") polygons = [readRings(geometry.coordinates)];
    else if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)
      && geometry.coordinates.length > 0 && geometry.coordinates.length <= 100) {
      polygons = geometry.coordinates.map(readRings);
    } else fail("Det lokale teiguttrekket mangler Polygon eller MultiPolygon.");
    pointCount += polygons.flat().reduce((n, ring) => n + ring.length, 0);
    if (pointCount > (nabotomter ? 50_000 : 10_000)) fail("Det lokale teiguttrekket er for stort for denne kontrollen.");
    if (attrs.AREAL !== null && (typeof attrs.AREAL !== "number" || !Number.isFinite(attrs.AREAL) || attrs.AREAL < 0)) {
      fail("Det lokale teiguttrekket har ugyldig registrert areal.");
    }
    const antall = integer(attrs.ANTALL_GID);
    return {
      type: "Feature",
      geometry: geometry.type === "Polygon" ? { type: "Polygon", coordinates: polygons[0]! }
        : { type: "MultiPolygon", coordinates: polygons },
      properties: {
        kommunenummer: adresse.kommunenummer, gardsnummer: gnr, bruksnummer: bnr,
        festenummer: fnr, seksjonsnummer: integer(attrs.SNR),
        objekttype: "Teig", matrikkelnummertekst: `${gnr}/${bnr}${fnr ? `/${fnr}` : ""}`,
        kildeObjektId: objectId, kildefil: fil,
        ...(typeof attrs.AREAL === "number" ? { registrertArealM2: attrs.AREAL } : {}),
        arealmerknad: attrs.AREALMERKNAD === null ? null : text(attrs.AREALMERKNAD),
        tinglyst: text(attrs.TINGLYST), antallMatrikkelenheter: antall,
        teigmedflerematrikkelenheter: antall > 1
      }
    };
  });
  return { geojson: { type: "FeatureCollection", koordinatsystem: "EPSG:4326", features },
    kilde: { navn, ...(fil ? { fil } : {}), ...(uttrekksaar ? { uttrekksaar } : {}) },
    dekket: data.kildestatus === "tilgjengelig" };
}

type Pair = [number, number];
function segmentsIntersect(a: Pair, b: Pair, c: Pair, d: Pair, strict = false): boolean {
  const cross = (p: Pair, q: Pair, r: Pair) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  if (strict) {
    return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
  }
  const on = (p: Pair, q: Pair, r: Pair) => Math.abs(cross(p, q, r)) < 1e-14
    && r[0] >= Math.min(p[0], q[0]) && r[0] <= Math.max(p[0], q[0])
    && r[1] >= Math.min(p[1], q[1]) && r[1] <= Math.max(p[1], q[1]);
  return on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b)
    || ((cross(a, b, c) > 0) !== (cross(a, b, d) > 0) && (cross(c, d, a) > 0) !== (cross(c, d, b) > 0));
}

function ringsIntersect(a: Pair[], b: Pair[], same = false, strict = false): boolean {
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = same ? i + 2 : 0; j < b.length - 1; j++) {
      if (same && i === 0 && j === b.length - 2) continue;
      if (segmentsIntersect(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!, strict)) return true;
    }
  }
  return false;
}

function polygonsIntersect(a: GarasjePolygon, b: GarasjePolygon): boolean {
  const strictlyInside = (p: Pair, shape: GarasjePolygon) => containsPunkt({ lon: p[0], lat: p[1] }, shape)
    && !shape.ringer.some(ring => ring.slice(1).some((end, i) => segmentsIntersect(p, p, ring[i]!, end)));
  const hasInsidePoint = (shape: GarasjePolygon, target: GarasjePolygon) => shape.ringer.some(ring =>
    ring.slice(1).some((end, i) => strictlyInside(end, target)
      || strictlyInside([(ring[i]![0] + end[0]) / 2, (ring[i]![1] + end[1]) / 2], target)));
  // Strict crossing catches overlaps without contained vertices. Boundary-only
  // contact does not make the neighbour's building evidence of a built parcel.
  if (a.ringer.some(ar => b.ringer.some(br => ringsIntersect(ar, br, false, true)))
    || hasInsidePoint(a, b) || hasInsidePoint(b, a)) return true;
  const first = polygonEnvelope(a), second = polygonEnvelope(b);
  if (first[0] >= second[2] || second[0] >= first[2] || first[1] >= second[3] || second[1] >= first[3]) return false;
  // Coincident boundaries can enclose area without a strictly interior edge
  // point. Reuse the area intersection rather than inventing a boundary rule.
  try {
    return calculateGarasjeAreal([a], [b], { lon: (first[0] + first[2]) / 2, lat: (first[1] + first[3]) / 2 }).kartlagtBebygdArealM2 > 1e-6;
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    return false;
  }
}

function buildingEnvelope(parcels: GarasjePolygon[], p: GarasjePunkt): Envelope {
  const envelope: Envelope = [p.lon - 0.002, p.lat - 0.001, p.lon + 0.002, p.lat + 0.001];
  for (const parcel of parcels) for (const ring of parcel.ringer) for (const [lon, lat] of ring) {
    envelope[0] = Math.min(envelope[0], lon);
    envelope[1] = Math.min(envelope[1], lat);
    envelope[2] = Math.max(envelope[2], lon);
    envelope[3] = Math.max(envelope[3], lat);
  }
  // Avoid a municipality-wide fetch when one matrikkelenhet has distant teiger.
  if (envelope[2] - envelope[0] > 0.05 || envelope[3] - envelope[1] > 0.025) {
    fail("Eiendommens teiger dekker et for stort område for et fullstendig bygningsoppslag i piloten.");
  }
  return envelope;
}

function polygonEnvelope(polygon: GarasjePolygon): Envelope {
  const bounds: Envelope = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of polygon.ringer) for (const [x, y] of ring) {
    bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y);
    bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y);
  }
  return bounds;
}

function buildBebyggelse(
  parcels: GarasjePolygon[], geojson: GarasjeEiendomsGeoJson | undefined,
  buildings: { polygon: GarasjePolygon; attributes: GarasjeEksisterendeBygning }[], kilder: GarasjeKilde[],
  kommune: GarasjeKommunekilder | undefined,
): GarasjeBebyggelse {
  const result: GarasjeBebyggelse = {
    status: "uavklart", bebygd: null, bygninger: [], kilde: officialLayerUrl("bygninger", kommune),
    forklaring: kommune
      ? "Eksisterende bebyggelse kunne ikke avklares fordi eiendoms- eller bygningskilden mangler. Dette betyr ikke at eiendommen er ubebygd."
      : "Piloten har ingen konfigurert kommunal bygningskilde for den valgte kommunen. Eksisterende bebyggelse er ukjent, ikke bekreftet ubebygd.",
  };
  if (!parcels.length || kilder.find(k => k.id === "eiendomsgrenser")?.status !== "ok"
    || !["ok", "ingen_treff"].includes(kilder.find(k => k.id === "bygninger")?.status ?? "")) return result;
  result.bygninger = buildings.filter(b => parcels.some(parcel => polygonsIntersect(b.polygon, parcel))).map(b => b.attributes);
  const sharedParcel = hasUavklartTeigomfang(geojson);
  if (sharedParcel) {
    result.forklaring = "Bygningsflater er sammenholdt med teigen, men teigen har ukjent tilknytning, omfatter flere matrikkelenheter eller jordsameie. Bebyggelse på den valgte eiendommen er derfor uavklart.";
  } else if (result.bygninger.some(b => b.objekttype === "Bygning" && b.bygningsnummer
    && ["TB", "FA", "MB"].includes(b.bygningsstatus ?? ""))) {
    result.status = "bekreftet";
    result.bebygd = true;
    result.forklaring = `Kartet viser eksisterende bebyggelse som berører den valgte eiendomsteigen. Bygningsnummer, type og status er hentet fra ${kommune?.navn ?? "den valgte kommunen"} kommunes bygningskart. Koblingen til teigen er geometrisk, ikke en bekreftet registerkobling til matrikkelenheten. Kartet dokumenterer ikke at bebyggelsen er lovlig.`;
  } else {
    result.forklaring = result.bygninger.length
      ? "Kartlagte bygningsflater berører teigen, men registrert bygningsnummer eller status bekrefter ikke at bygningene er tatt i bruk. Eksisterende bebyggelse er uavklart."
      : "Ingen bygningsflater treffer den valgte eiendomsteigen i dette kartoppslaget. Kartet er ikke et fullstendig bevis på at eiendommen er ubebygd.";
  }
  return result;
}

function hasUavklartTeigomfang(geojson: GarasjeEiendomsGeoJson | undefined): boolean {
  return geojson?.features.some(f => f.properties.teigmedflerematrikkelenheter
    || f.properties.uregistrertjordsameie || f.properties.antallMatrikkelenheter === 0) ?? false;
}

type Segment = [Pair, Pair];
type Interval = [number, number];

function unionIntervals(intervals: Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const [low, high] of intervals.sort((a, b) => a[0] - b[0])) {
    const previous = result.at(-1);
    if (previous && low <= previous[1]) previous[1] = Math.max(previous[1], high);
    else result.push([low, high]);
  }
  return result;
}

function slicePolygons(polygons: Segment[][], x: number): Interval[] {
  const intervals: Interval[] = [];
  for (const edges of polygons) {
    const crossings = edges.filter(([a, b]) => (a[0] < x && x < b[0]) || (b[0] < x && x < a[0]))
      .map(([a, b]) => a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])).sort((a, b) => a - b);
    if (crossings.length % 2) fail("Kartgeometrien kunne ikke brukes til en entydig arealberegning.");
    // Even-odd membership applies to each feature's rings, then union between
    // features. Duplicate/split features cannot fill a hole or count twice.
    for (let i = 0; i < crossings.length; i += 2) intervals.push([crossings[i]!, crossings[i + 1]!]);
  }
  return unionIntervals(intervals);
}

function intersectionLength(a: Interval[], b: Interval[]): number {
  let i = 0, j = 0, length = 0;
  while (i < a.length && j < b.length) {
    const first = a[i]!, second = b[j]!;
    length += Math.max(0, Math.min(first[1], second[1]) - Math.max(first[0], second[0]));
    if (first[1] < second[1]) i++; else j++;
  }
  return length;
}

/** Map estimate from validated geographic polygons; the caller reports input CRS and approximation. */
export function calculateGarasjeAreal(parcels: GarasjePolygon[], buildings: GarasjePolygon[], origin: GarasjePunkt) {
  const latitude = origin.lat * Math.PI / 180;
  // GRS80 is the ellipsoid of ETRS89 (EPSG:4258). Linearise its meridional and
  // prime-vertical radii at the address, keeping units in metres locally.
  const a = 6378137, f = 1 / 298.257222101, e2 = f * (2 - f);
  const denominator = 1 - e2 * Math.sin(latitude) ** 2;
  const eastScale = a / Math.sqrt(denominator) * Math.cos(latitude) * Math.PI / 180;
  const northScale = a * (1 - e2) / denominator ** 1.5 * Math.PI / 180;
  const project = ([lon, lat]: Pair): Pair => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon - origin.lon) > 0.05 || Math.abs(lat - origin.lat) > 0.025) {
      fail("Kartområdet er for stort for den lokale arealtilnærmingen.");
    }
    return [(lon - origin.lon) * eastScale, (lat - origin.lat) * northScale];
  };
  const edgesFor = (polygons: GarasjePolygon[]): Segment[][] => polygons.map(polygon => polygon.ringer.flatMap(ring => {
    const points = ring.map(project);
    return points.slice(1).map((p, i): Segment => [points[i]!, p]);
  }));
  const parcelEdges = edgesFor(parcels), buildingEdges = edgesFor(buildings);
  const edges = [...parcelEdges, ...buildingEdges].flat();
  if (edges.length > 2000) fail("Kartgeometrien er for detaljert for pilotens arealberegning.");
  const breaks = new Set(edges.flatMap(([a, b]) => [a[0], b[0]]));
  const cross = (x: Pair, y: Pair) => x[0] * y[1] - x[1] * y[0];
  const subtract = (a: Pair, b: Pair): Pair => [a[0] - b[0], a[1] - b[1]];
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const [a, b] = edges[i]!, [c, d] = edges[j]!;
    const r = subtract(b, a), s = subtract(d, c), divider = cross(r, s);
    if (Math.abs(divider) < 1e-10) continue;
    const t = cross(subtract(c, a), s) / divider, u = cross(subtract(c, a), r) / divider;
    if (t > 0 && t < 1 && u > 0 && u < 1) breaks.add(a[0] + t * r[0]);
    if (breaks.size > 10_000) fail("Kartgeometrien har for mange kryss til en trygg arealberegning.");
  }
  const xs = [...breaks].sort((a, b) => a - b);
  let tomtearealM2 = 0, kartlagtBebygdArealM2 = 0;
  // Between every vertex/crossing, all interval endpoints are linear functions
  // of x and retain their order. Midpoint integration is exact in this local
  // plane, including holes, overlapping buildings and clipping to the parcel.
  for (let i = 1; i < xs.length; i++) {
    const width = xs[i]! - xs[i - 1]!;
    if (width < 1e-8) continue;
    const middle = (xs[i]! + xs[i - 1]!) / 2;
    const parcelSlice = slicePolygons(parcelEdges, middle);
    const buildingSlice = slicePolygons(buildingEdges, middle);
    tomtearealM2 += width * parcelSlice.reduce((sum, [a, b]) => sum + b - a, 0);
    kartlagtBebygdArealM2 += width * intersectionLength(parcelSlice, buildingSlice);
  }
  if (!Number.isFinite(tomtearealM2) || tomtearealM2 <= 0 || !Number.isFinite(kartlagtBebygdArealM2)) {
    fail("Kartet gir ikke et gyldig tomteareal å beregne andelen fra.");
  }
  return { tomtearealM2, kartlagtBebygdArealM2, kartlagtAndelProsent: kartlagtBebygdArealM2 / tomtearealM2 * 100 };
}

function buildArealberegning(
  adresse: GarasjeAdresse, parcels: GarasjePolygon[], buildings: GarasjePolygon[],
  geojson: GarasjeEiendomsGeoJson | undefined, kilder: GarasjeKilde[],
  kommune: GarasjeKommunekilder | undefined,
): GarasjeArealberegning {
  const teigkilde = kilder.find(kilde => kilde.id === "eiendomsgrenser");
  const koordinatsystem = teigkilde?.koordinatsystem ?? "ukjent koordinatsystem";
  const result: GarasjeArealberegning = {
    tomtearealM2: null, kartlagtBebygdArealM2: null, kartlagtAndelProsent: null,
    kilde: [teigkilde?.fil ? `${teigkilde.fil} via ${teigkilde.url}` : teigkilde?.url, officialLayerUrl("bygninger", kommune)].filter(Boolean).join(" og "),
    metode: `Anslag fra teiger i ${koordinatsystem} og bygningsflater i EPSG:4258, beregnet i et lokalt meterplan på GRS80 ved adressepunktet. Arealet av sammenslåtte teiger og bygningsflater beregnes med hull, uten dobbelttelling av overlapp. Bygningsflatene klippes til teigene.`,
    forbehold: [
      "Dette er kartlagt flatedekning, ikke juridisk BYA, %BYA, BRA eller %BRA. Parkering, overbygg og andre arealer som skal med etter planen, kan mangle.",
      "Tillatt utnyttelse er ikke fastsatt. Gjeldende planbestemmelser, beregningsmåte og lovlig etablert bebyggelse må kontrolleres.",
      "Lokal projeksjon, kartkvalitet og kartets oppdatering gir usikkerhet. Tallene er anslag, ikke oppmålte eller godkjente arealer.",
      ...(koordinatsystem === "EPSG:4326" ? [
        "Uttrekkets WGS84-koordinater brukes sammen med ETRS89-bygningskart som et geografisk anslag uten presis datumtransformasjon. Datoforskjeller og koordinatsystemer kan gi små avvik."
      ] : []),
    ],
  };
  if (kilder.find(k => k.id === "eiendomsgrenser")?.status !== "ok" || !parcels.length) {
    result.forbehold.push("Tomtearealet er ukjent fordi eiendomsflaten mangler eller ikke kunne hentes.");
    return result;
  }
  if (hasUavklartTeigomfang(geojson)) {
    result.forbehold.push("Teigen har ukjent tilknytning, omfatter flere matrikkelenheter eller jordsameie. Arealet som tilhører den valgte eiendommen er ukjent.");
    return result;
  }
  if (parcels.some(p => p.kvalitetsklasse !== "Grønt")) result.forbehold.push("En eller flere teiger har usikker eller ukjent grensekvalitet. Det påvirker arealanslaget.");
  try {
    const parcelArea = calculateGarasjeAreal(parcels, [], adresse.punkt);
    result.tomtearealM2 = Number(parcelArea.tomtearealM2.toFixed(2));
    const status = kilder.find(k => k.id === "bygninger")?.status;
    if (status !== "ok" && status !== "ingen_treff") {
      result.forbehold.push(kommune
        ? "Kartlagt bygningsareal og andel er ukjent fordi bygningskilden ikke ga et fullstendig svar."
        : `Kartlagt bygningsareal og andel er ukjent fordi piloten ikke har en bygningskilde for kommunenummer ${adresse.kommunenummer}.`);
      return result;
    }
    const parcelBounds = parcels.map(polygonEnvelope);
    const relevant = buildings.filter(building => {
      const b = polygonEnvelope(building);
      return parcelBounds.some(p => p[0] < b[2] && b[0] < p[2] && p[1] < b[3] && b[1] < p[3]);
    });
    const calculated = calculateGarasjeAreal(parcels, relevant, adresse.punkt);
    result.kartlagtBebygdArealM2 = Number(calculated.kartlagtBebygdArealM2.toFixed(2));
    result.kartlagtAndelProsent = Number(calculated.kartlagtAndelProsent.toFixed(2));
    if (calculated.kartlagtBebygdArealM2 === 0) result.forbehold.push("Null kartlagt flatedekning bekrefter ikke at eiendommen er ubebygd.");
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    result.forbehold.push(error.message);
  }
  return result;
}

function validateParcelRings(input: unknown): Pair[][] {
  const rings = polygon({ attributes: { OBJECTID: 1 }, geometry: { rings: input } }).ringer;
  if (rings.reduce((n, ring) => n + ring.length, 0) > 2000) fail("Eiendomspolygonen er for stor for denne kontrollen.");
  const contains = (ring: Pair[], p: Pair) => containsPunkt({ lon: p[0], lat: p[1] }, { id: "", ringer: [ring] });
  for (let i = 0; i < rings.length; i++) {
    const ring = rings[i]!;
    if (ringsIntersect(ring, ring, true)) fail("Eiendomspolygonen krysser seg selv.");
    if (i > 0 && (!contains(rings[0]!, ring[0]!) || ringsIntersect(rings[0]!, ring))) fail("Et hull ligger utenfor eller krysser eiendomspolygonen.");
    for (let j = 1; j < i; j++) {
      if (contains(rings[j]!, ring[0]!) || contains(ring, rings[j]![0]!) || ringsIntersect(rings[j]!, ring)) {
        fail("Eiendomspolygonen har overlappende hull.");
      }
    }
  }
  return rings;
}

function parseEiendomsGeoJson(input: unknown, adresse: GarasjeAdresse, nabotomter = false): GarasjeEiendomsGeoJson {
  const data = record(input);
  if (data.type !== "FeatureCollection" || !Array.isArray(data.features) || data.features.length > 500
    || Object.keys(data).some(key => !["type", "features", "crs"].includes(key))) {
    fail("Eiendomskilden svarte med et ugyldig eller mulig avkortet GeoJSON-utvalg.");
  }
  if (data.crs !== undefined) {
    const crs = record(data.crs), properties = record(crs.properties);
    if (crs.type !== "name" || !["EPSG:4258", "urn:ogc:def:crs:EPSG::4258"].includes(String(properties.name))) {
      fail("Eiendomskilden svarte i et annet koordinatsystem enn EPSG:4258.");
    }
  }
  const ids = new Set<number>();
  let points = 0;
  const features: GarasjeEiendomsGeoJson["features"] = data.features.map(input => {
    const feature = record(input), geometry = record(feature.geometry), p = record(feature.properties);
    const gnr = integer(p.gardsnummer, nabotomter ? 0 : 1), bnr = integer(p.bruksnummer), fnr = integer(p.festenummer);
    if (feature.type !== "Feature" || p.objekttype !== "Teig" || p.kommunenummer !== adresse.kommunenummer
      || (!nabotomter && (gnr !== adresse.gardsnummer || bnr !== adresse.bruksnummer
        || fnr !== adresse.festenummer))) fail("Eiendomskilden svarte med en annen matrikkelenhet enn den valgte.");
    const lokalid = integer(p.lokalid, 1);
    if (ids.has(lokalid)) fail("Eiendomskilden svarte med dupliserte teiger.");
    ids.add(lokalid);
    let polygons: Pair[][][];
    const readRings = (value: unknown) => nabotomter
      ? polygon({ attributes: { OBJECTID: 1 }, geometry: { rings: value } }).ringer : validateParcelRings(value);
    if (geometry.type === "Polygon") polygons = [readRings(geometry.coordinates)];
    else if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)
      && geometry.coordinates.length > 0 && geometry.coordinates.length <= 100) {
      polygons = geometry.coordinates.map(readRings);
    } else fail("Eiendomskilden svarte uten Polygon eller MultiPolygon.");
    points += polygons.flat().reduce((n, ring) => n + ring.length, 0);
    if (points > (nabotomter ? 50_000 : 10_000)) fail("Eiendomskildens geometri er for stor for denne kontrollen.");
    const properties: GarasjeEiendomsGeoJson["features"][number]["properties"] = {
      kommunenummer: adresse.kommunenummer, gardsnummer: gnr, bruksnummer: bnr,
      festenummer: fnr, seksjonsnummer: integer(p.seksjonsnummer), lokalid,
      objekttype: "Teig", matrikkelnummertekst: text(p.matrikkelnummertekst),
    };
    if (p["nøyaktighetsklasseteig"] !== undefined && p["nøyaktighetsklasseteig"] !== null) {
      const quality = text(p["nøyaktighetsklasseteig"]);
      if (!["Grønt", "Gult", "Rødt"].includes(quality)) fail("Eiendomskilden svarte med ukjent kvalitetsklasse.");
      properties["nøyaktighetsklasseteig"] = quality;
    }
    if (p.oppdateringsdato !== undefined && p.oppdateringsdato !== null) {
      const date = text(p.oppdateringsdato, 50);
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(date)
        || !Number.isFinite(Date.parse(date))) fail("Eiendomskilden svarte med en ugyldig oppdateringsdato.");
      properties.oppdateringsdato = date;
    }
    for (const field of ["hovedområde", "teigmedflerematrikkelenheter", "uregistrertjordsameie"] as const) {
      if (p[field] !== undefined && p[field] !== null) {
        if (typeof p[field] !== "boolean") fail("Eiendomskilden svarte med en ugyldig teigegenskap.");
        properties[field] = p[field];
      }
    }
    return {
      type: "Feature",
      geometry: geometry.type === "Polygon" ? { type: "Polygon", coordinates: polygons[0]! }
        : { type: "MultiPolygon", coordinates: polygons },
      properties,
    };
  });
  return { type: "FeatureCollection", features };
}

function parcelPolygons(geojson: GarasjeEiendomsGeoJson): GarasjePolygon[] {
  return geojson.features.flatMap(feature => {
    const p = feature.properties;
    const id = p.lokalid === undefined ? `${p.kildefil}:${p.kildeObjektId}` : String(p.lokalid);
    const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    return polygons.map((ringer, index) => ({
      id: polygons.length === 1 ? id : `${id}-${index + 1}`,
      ringer, teigId: p.lokalid, matrikkelnummer: p.matrikkelnummertekst,
      teig: { gnr: p.gardsnummer, bnr: p.bruksnummer, fnr: p.festenummer, teigId: p.lokalid },
      ...(p.kildeObjektId === undefined ? {} : { kildeObjektId: p.kildeObjektId }),
      ...(p.registrertArealM2 === undefined ? {} : { registrertArealM2: p.registrertArealM2 }),
      ...(p["nøyaktighetsklasseteig"] ? { kvalitetsklasse: p["nøyaktighetsklasseteig"] } : {}),
      ...(p.oppdateringsdato ? { oppdatert: p.oppdateringsdato } : {}),
    }));
  });
}

async function getNabotomter(adresse: GarasjeAdresse, parcels: GarasjePolygon[]): Promise<GarasjeNabotomter> {
  const localUrl = new URL("/mock/matrikkel/naboteiger", matrikkelBaseUrl);
  const kilde: GarasjeKilde = {
    id: "nabotomter", navn: "Matrikkelmockens lokale teiguttrekk", url: localUrl.href,
    status: "ikke_sjekket", hentet: new Date().toISOString(),
  };
  const result: GarasjeNabotomter = { tomter: [], kilde };
  if (!parcels.length) {
    kilde.merknad = "Tomter i nærheten er ikke hentet fordi grensene til den valgte eiendommen mangler.";
    return result;
  }
  const envelope = getTeigBounds({ type: "MultiPolygon", coordinates: parcels.map(p => p.ringer) });
  const lat = (envelope.sor + envelope.nord) / 2, lon = (envelope.vest + envelope.ost) / 2;
  const latitudeMargin = 15 / 111320, longitudeMargin = latitudeMargin / Math.cos(lat * Math.PI / 180);
  const bounds = { vest: envelope.vest - longitudeMargin, sor: envelope.sor - latitudeMargin,
    ost: envelope.ost + longitudeMargin, nord: envelope.nord + latitudeMargin };
  if (!isBoundedKartutsnitt(bounds)) {
    kilde.merknad = "Eiendommens teiger dekker et større kartutsnitt enn 500 meter. Nabokartet er ikke hentet.";
    return result;
  }
  localUrl.search = new URLSearchParams({ kommunenummer: adresse.kommunenummer,
    ...Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, String(value)])) }).toString();
  kilde.url = localUrl.href;
  // Nabokartet er bare kontekst. Kilden holdes utenfor vilkårsgrunnlagets kildeliste.
  const select = (geojson: GarasjeEiendomsGeoJson): GarasjePolygon[] => {
    const features = geojson.features.filter(({ properties: p, geometry }) =>
      !(p.gardsnummer === adresse.gardsnummer && p.bruksnummer === adresse.bruksnummer && p.festenummer === adresse.festenummer)
      && intersectsKartutsnitt(getTeigBounds(geometry), bounds));
    const tomter = parcelPolygons({ ...geojson, features });
    if (tomter.length > NABOTEIG_MAX_TREFF) fail("Nabokartet har over 200 polygoner. Ingen avkortet liste vises.");
    return tomter;
  };
  try {
    const raw = record(await readJson(localUrl, "Matrikkelmockens naboteig-API"));
    if (raw.avkortet !== false || !Array.isArray(raw.features) || raw.features.length > NABOTEIG_MAX_TREFF) {
      fail("Nabokartet mangler bekreftelse på at utvalget ikke er avkortet.");
    }
    const local = parseLokaleTeiger(raw, adresse, true);
    const localTomter = select(local.geojson);
    if (localTomter.length) {
      result.tomter = localTomter;
      Object.assign(kilde, local.kilde, { koordinatsystem: "EPSG:4326" });
      kilde.merknad = `Tomter i kartutsnittet fra ${local.kilde.fil}, med 15 meter margin rundt valgt eiendom. ` +
        "Uttrekket er ikke en komplett oversikt over grensenaboer. Grensekvalitet, tvist og oppdateringstidspunkt er ikke oppgitt. " +
        "Registrert teigareal gjelder kildeobjektet, ikke nødvendigvis hele matrikkelenheten. Ingen eieropplysninger eller byggetillatelser er hentet.";
    } else {
      const url = new URL(testUrl("GARASJE_NABOTOMTER_URL", NABOTOMTER_URL));
      const width = (bounds.ost - bounds.vest) * 111700 * Math.cos(lat * Math.PI / 180);
      const height = (bounds.nord - bounds.sor) * 111700;
      const radius = Math.ceil(Math.hypot(width, height) / 2) + 1;
      url.search = new URLSearchParams({ ost: String(lon), nord: String(lat), koordsys: "4258", utkoordsys: "4258",
        radius: String(radius), maksTreff: String(NABOTEIG_MAX_TREFF + 1) }).toString();
      kilde.navn = "Kartverkets åpne eiendoms-API, områder nær punkt";
      kilde.url = url.href;
      kilde.koordinatsystem = "EPSG:4258";
      const data = record(await readJson(url, "Kartverkets eiendoms-API"));
      if (!Array.isArray(data.features) || data.features.length > NABOTEIG_MAX_TREFF
        || Object.keys(data).some(key => !["type", "features", "crs"].includes(key))) {
        fail("Nabokartet er for stort eller kan være avkortet. Ingen delvis liste vises.");
      }
      // Områdesøket kan krysse kommunegrensen og inneholde anleggsprojeksjonsflater.
      const features = data.features.filter(input => {
        const feature = record(input), p = record(feature.properties);
        if (!isKommunenummer(p.kommunenummer)) fail("Nabokartet mangler kommuneidentitet.");
        if (!["Teig", "Anleggsprojeksjonsflate"].includes(String(p.objekttype))) fail("Nabokartet har en ukjent objekttype.");
        return p.kommunenummer === adresse.kommunenummer && p.objekttype === "Teig";
      });
      result.tomter = select(parseEiendomsGeoJson({ ...data, features }, adresse, true));
      kilde.merknad = `${local.dekket ? `Ingen andre tomter i utsnittet ble funnet i ${local.kilde.fil}.` : "Kommunen har ikke et lokalt teiguttrekk."} ` +
        `Kartverket er derfor spurt innen ${radius} meter rundt utsnittets midtpunkt. Bare teiger i samme kommune som berører utsnittet vises. ` +
        "Dette er ikke en komplett oversikt over grensenaboer. Teigens kvalitetsklasse er ikke kvalitetsdata for hver grense. " +
        "Manglende kvalitet er ukjent. Eieropplysninger, planer og byggetillatelser er ikke hentet for nabotomtene.";
    }
    kilde.status = result.tomter.length ? "ok" : "ingen_treff";
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    result.tomter = [];
    kilde.status = "feil";
    kilde.merknad = `${error.message} Nabokartet er uavklart og påvirker ikke søknadssjekken.`;
  } finally {
    kilde.hentet = new Date().toISOString();
  }
  return result;
}

export async function getGarasjeGrunnlag(adresse: GarasjeAdresse, plassering?: GarasjePunkt): Promise<GarasjeGrunnlag> {
  // The route resolves this candidate afresh through searchGarasjeAdresser.
  // Never accept source contents or plan statuses from the request body.
  const a = record(adresse);
  if (!isKommunenummer(a.kommunenummer)) throw new HttpError("Kommunenummer må være fire sifre og kan ikke være 0000.", 400);
  const kommune = findGarasjeKommunekilder(a.kommunenummer);
  text(a.adressetekst);
  integer(a.gardsnummer, 1); integer(a.bruksnummer); integer(a.festenummer); integer(a.undernummer);
  const adressePunkt = validateGarasjePunkt(a.punkt);
  const p = plassering === undefined ? adressePunkt : validateGarasjePunkt(plassering);
  if (Math.abs(p.lat - adressePunkt.lat) > 0.005 || Math.abs(p.lon - adressePunkt.lon) > 0.01) {
    throw new HttpError("Velg en plassering i nærheten av den valgte adressen.", 400);
  }
  const kilder: GarasjeKilde[] = [{
    id: "adresse", navn: "Kartverkets adresse-API", url: adresseQuery(adresse.adressetekst, adresse.kommunenummer).href,
    hentet: new Date().toISOString(), status: "ok", merknad: "Offentlig adressepunkt, ikke dokumentasjon på eierskap.",
  }];
  async function load<T>(id: SourceId, read: () => Promise<T[]>): Promise<T[]> {
    const kilde: GarasjeKilde = {
      id, navn: id === "eiendomsgrenser" ? "Matrikkelmockens lokale teiguttrekk" : kommune?.[id].navn
        ?? `${({ kpa: "Kommuneplan", reguleringsplan: "Reguleringsplaner", bygninger: "Bygningskart" })[id]} for kommunenummer ${adresse.kommunenummer}`,
      url: id === "eiendomsgrenser" ? lokalTeigQuery(adresse).href : officialLayerUrl(id, kommune),
      hentet: new Date().toISOString(), status: "ikke_sjekket",
    };
    kilder.push(kilde);
    if (id !== "eiendomsgrenser" && !kommune) {
      kilde.merknad = `Ingen kommunal datakilde er konfigurert for kommunenummer ${adresse.kommunenummer}. Ingen oppslag er sendt til en annen kommunes kart.`;
      return [];
    }
    try {
      const rows = await read();
      kilde.status = rows.length ? "ok" : "ingen_treff";
      kilde.merknad ??= rows.length ? "Offentlig kartoppslag, ikke en full kontroll av vilkårene for å bygge."
        : "Datakilden svarte gyldig, men fant ingen objekter i det undersøkte området.";
      return rows;
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      kilde.status = "feil";
      kilde.merknad = error.message;
      return [];
    } finally {
      kilde.hentet = new Date().toISOString();
    }
  }
  let eiendomsgeojson: GarasjeEiendomsGeoJson | undefined;
  let buildingRows: { polygon: GarasjePolygon; attributes: GarasjeEksisterendeBygning }[] = [];
  const eiendomPromise = load<GarasjePolygon>("eiendomsgrenser", async () => {
    const kilde = kilder.find(k => k.id === "eiendomsgrenser")!;
    const local = parseLokaleTeiger(await readJson(lokalTeigQuery(adresse), "Matrikkelmockens teig-API"), adresse);
    if (local.geojson.features.length) {
      eiendomsgeojson = local.geojson;
      Object.assign(kilde, local.kilde, { koordinatsystem: "EPSG:4326" });
      kilde.merknad = `Lokalt uttrekk${local.kilde.uttrekksaar ? ` merket ${local.kilde.uttrekksaar}` : ""} fra ${local.kilde.fil}. ` +
        "Offentlige teigdata, ikke syntetisk geometri. Uttrekket oppgir ikke grensekvalitet, tvist eller oppdateringstidspunkt. " +
        "OBJECTID er en ID i uttrekket, ikke en Matrikkel-teig-ID. GeoJSON-koordinater (WGS84) brukes som geografisk kartgrunnlag; presis grenseplassering er uavklart.";
    } else {
      kilde.navn = "Kartverket / Geonorge eiendomskart";
      kilde.url = eiendomQuery(adresse).href;
      kilde.koordinatsystem = "EPSG:4258";
      kilde.merknad = local.dekket
        ? `Eiendommen finnes ikke i ${local.kilde.fil}. Grunnlaget hentes derfor fra Kartverkets eiendoms-API.`
        : "Ingen lokalt teiguttrekk dekker kommunen. Grunnlaget hentes derfor fra Kartverkets eiendoms-API.";
      eiendomsgeojson = parseEiendomsGeoJson(await readJson(eiendomQuery(adresse), "Kartverkets eiendoms-API"), adresse);
    }
    return parcelPolygons(eiendomsgeojson);
  });
  const [arealformaal, reguleringsplaner, eiendomsgrenser, bygninger, nabotomter] = await Promise.all([
    load<GarasjeArealformaal>("kpa", async () => (await queryLayer("kpa", kommune, p, false)).map(feature => {
      const attrs = record(feature.attributes);
      const formaal: GarasjeArealformaal = {
        kode: integer(attrs.KPAREALFORMAL, 1), beskrivelse: text(attrs.BESKRIVELSE), planId: planId(attrs.PLANID),
        ...(attrs.AREALST !== undefined && attrs.AREALST !== null ? { arealstatus: integer(attrs.AREALST, 1) } : {}),
        ...(feature.sonenavn ? { sonenavn: text(feature.sonenavn) } : {}),
      };
      formaal.sonetype = classifyArealsone({
        ...formaal, kommunenummer: adresse.kommunenummer,
        versjon: kommune?.kpa.versjon ?? "", kildeUrl: officialLayerUrl("kpa", kommune),
      });
      return formaal;
    })),
    load<GarasjePlan>("reguleringsplan", async () => (await queryLayer("reguleringsplan", kommune, p, false)).map(feature => {
      const attrs = record(feature.attributes), id = planId(attrs.PLANID);
      const url = new URL(kommune!.reguleringsplan.planportalUrl);
      url.search = new URLSearchParams({ funksjon: "VisPlan", planidentifikasjon: id, kommunenummer: adresse.kommunenummer }).toString();
      return {
        planId: id, navn: text(attrs.PLANNAVN),
        url: url.href,
      };
    })),
    eiendomPromise,
    load<GarasjePolygon>("bygninger", async () => {
      const parcels = await eiendomPromise;
      const features = await queryLayer("bygninger", kommune, p, true, buildingEnvelope(parcels, p));
      if (features.length === 500) fail("Bygningsoppslaget nådde treffgrensen. Utvalget kan være ufullstendig.");
      const rows = features.map(feature => ({ polygon: polygon(feature), attributes: buildingAttributes(feature) }));
      if (new Set(rows.map(row => row.polygon.id)).size !== rows.length) fail("Bygningskilden svarte med dupliserte flater.");
      if (rows.reduce((n, row) => n + row.polygon.ringer.reduce((m, ring) => m + ring.length, 0), 0) > 20_000) {
        fail("Bygningskildens geometri er for stor for denne kontrollen.");
      }
      if (rows.some(row => row.polygon.ringer.some(ring => ring.length > 2000 || ringsIntersect(ring, ring, true)))) {
        fail("Bygningskilden svarte med en ugyldig eller for stor polygonring.");
      }
      buildingRows = rows;
      return rows.map(row => row.polygon);
    }),
    eiendomPromise.then(parcels => getNabotomter(adresse, parcels)),
  ]);
  const bebyggelse = buildBebyggelse(eiendomsgrenser, eiendomsgeojson, buildingRows, kilder, kommune);
  const arealberegning = buildArealberegning(adresse, eiendomsgrenser, bygninger, eiendomsgeojson, kilder, kommune);
  return {
    adresse, punkt: p, arealformaal, reguleringsplaner, eiendomsgrenser, bygninger, bebyggelse, arealberegning, kilder, nabotomter,
    ...(eiendomsgeojson ? { eiendomsgeojson } : {}),
    uavklarteForhold: [
      ...(kommune ? [
        "Planbestemmelser er ikke maskinelt kontrollert. Planoppslaget dekker bare planområder på grunnen, ikke alle plannivåer.",
        "Kommuneplanoppslaget gjelder ett punkt. Hele garasjen kan berøre andre formål, hensynssoner eller byggegrenser.",
        "Bygningskartet viser også nabobygninger. Bare geometriske treff på valgt teig inngår i bebyggelsesgrunnlaget. Registerkobling til matrikkelenheten og lovlighet er ikke bekreftet.",
      ] : [
        `Kommunale plan- og bygningskilder er ikke konfigurert for kommunenummer ${adresse.kommunenummer}. Nasjonale eiendomsdata er tilgjengelige, men sier ikke hva som er tillatt å bygge.`,
      ]),
      "Registrert bruksareal (BRA) er ikke bebygd areal (BYA). Kartlagt flatedekning er bare et geometrisk anslag, ikke planens utnyttelsesgrad.",
      ...(bebyggelse.status === "uavklart" ? [bebyggelse.forklaring] : []),
      "Eiendomsgrenser kan være usikre. Avstander og lovlig arealutnyttelse er ikke bekreftet fra kartet.",
      ...arealberegning.forbehold,
      ...arealformaal.filter(f => f.sonetype === "ukjent").map(() => "Sonetypen er ikke støttet eller bekreftet for denne planen. Tegnforklaringen må kunne leses og stemme med soneregisteret. Arealformålskoden alene er ikke nok til å velge sone; kildens råverdier og beskrivelse er bevart."),
      ...eiendomsgrenser.filter(teig => teig.kvalitetsklasse !== "Grønt").map(teig =>
        `Teig ${teig.teigId ?? teig.id}: Kildens kvalitetsklasse er ${teig.kvalitetsklasse ?? "ikke oppgitt"}. Grensen må avklares før den brukes til plassering.`),
      ...(eiendomsgeojson?.features.filter(f => f.properties.teigmedflerematrikkelenheter || f.properties.uregistrertjordsameie)
        .map(f => `Teig ${f.properties.lokalid ?? `${f.properties.kildefil}:${f.properties.kildeObjektId}`} er knyttet til flere matrikkelenheter eller et uregistrert jordsameie. Innvendige grenser er ikke avklart.`) ?? []),
      ...kilder.filter(k => k.status === "feil" || k.status === "ikke_sjekket"
        || (k.status === "ingen_treff" && k.id !== "reguleringsplan"))
        .map(k => `${k.navn}: ${k.merknad ?? "Datagrunnlaget mangler."}`),
    ],
  };
}
