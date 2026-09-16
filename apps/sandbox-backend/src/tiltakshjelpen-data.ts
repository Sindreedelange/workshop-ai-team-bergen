import type {
  TiltakshjelpenAdresse, TiltakshjelpenArealberegning, TiltakshjelpenArealformaal, TiltakshjelpenBebyggelse, TiltakshjelpenEiendomsGeoJson, TiltakshjelpenEksisterendeBygning,
  TiltakshjelpenGrunnlag, TiltakshjelpenKilde, TiltakshjelpenPlan, TiltakshjelpenPlanflate, TiltakshjelpenPolygon, TiltakshjelpenPunkt, TiltakshjelpenNabotomter,
} from "../../shared/tiltakshjelpen.ts";
import type { Datasettid } from "../../shared/hensynssoner.ts";
import { DATASETTHENSYN, findHensynssone, soneHindrerFritak } from "../../shared/hensynssoner.ts";
import type { Kartutsnitt } from "../../shared/geometri.ts";
import { getGeometriBounds, intersectsKartutsnitt, isBoundedKartutsnitt, ringerInneholder } from "../../shared/geometri.ts";
import { classifyArealsone, findArealsone } from "../../shared/arealsoner.ts";
import { findTiltakshjelpenKommunekilder, getTiltakshjelpenKartlagUrl, type TiltakshjelpenKommunekilder } from "../../shared/tiltakshjelpen-kommuner.ts";
import { HttpError } from "./errors.ts";
import { containsPunkt, kildeSvarte, validateTiltakshjelpenPunkt } from "./tiltakshjelpen.ts";
import { callUpstream } from "./upstream.ts";

/**
 * En planflate slik den ser ut mellom oppslaget og regelen.
 *
 * Typen sto i `apps/shared/hensynssoner.ts` og beskrev formen på tråden fra en
 * tjeneste som ikke finnes lenger. Den bygges og leses nå i denne filen alene, og
 * hører derfor her: det som er delt er kodeverket, ikke mellomformen.
 */
type Planflatetreff = {
  ringer: [number, number][][];
  datasett: Datasettid;
  /** Null når kilden ikke oppgir koden. Flaten kan da ikke navngis. */
  sonekode: number | null;
  /** HENSYNSONENAVN, for eksempel «H220_1». Arealformål har ingen. */
  sonenavn: string | null;
  /** AREALST. Bare arealformål har den. */
  arealstatus: number | null;
  beskrivelse: string | null;
  planId: string;
  kommunenummer: string;
};

const ADRESSE_URL = "https://ws.geonorge.no/adresser/v1/sok";
const EIENDOM_URL = "https://api.kartverket.no/eiendom/v1/geokoding";
// /punkt returns points, not polygons. /punkt/omrader and maksTreff are documented
// at https://api.kartverket.no/eiendom/v1/openapi.json (verified 2026-09-10).
const NABOTOMTER_URL = "https://api.kartverket.no/eiendom/v1/punkt/omrader";

/** Taket på naboutsnittet. Det er en sperre mot bulkuttrekk, ikke en kartgrense. */
const NABOTEIG_MAKS_SIDE_METER = 500;
/**
 * Taket på hvor mange naboteiger som vises.
 *
 * Sto i apps/shared/matrikkelteig.ts, sammen med formene det lokale teiguttrekket
 * hadde. Uttrekket er borte, og en delt modul med én konstant og én leser er ikke
 * en delt modul - den er en omvei.
 */
const NABOTEIG_MAX_TREFF = 200;

/**
 * Kartlagene, og alt som er sant om det enkelte laget.
 *
 * Feltnavnene, om svaret skal forenkles, og om sonenavnet skal leses ut av
 * tegnforklaringen står her - ikke som `if (id === …)` inne i `queryLayer`.
 * Den funksjonen spør et lag; hvilket lag som er hva, er tabellens sak, og et
 * nytt lag skal bli en rad framfor en tredje gren i to betingelser.
 */
const layers = {
  kpa: {
    fields: ["KPAREALFORMAL", "BESKRIVELSE", "PLANID"],
    optionalFields: ["AREALST"],
    forenkles: true,
    // Arealformålskoden alene navngir ikke sonen; kombinasjonen kode og
    // arealstatus gjør det, og kilden fører den i sin egen tegnforklaring.
    sonenavnFraTegnforklaring: true,
  },
  reguleringsplan: {
    fields: ["PLANID", "PLANNAVN"],
    optionalFields: [],
    forenkles: true,
    sonenavnFraTegnforklaring: false,
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
    // Forenkles aldri: her måles flatene mot tomtearealet. For plansvarene er
    // forenklingen nødvendig - uten den svarte arealformålet med 3,6 MB og en ring
    // på 41 811 punkter for et vanlig teigutsnitt i LNF, mot 396 kB.
    forenkles: false,
    sonenavnFraTegnforklaring: false,
  },
} as const satisfies Record<string, {
  fields: readonly string[];
  optionalFields: readonly string[];
  forenkles: boolean;
  sonenavnFraTegnforklaring: boolean;
}>;
type LayerId = keyof typeof layers;
type SourceId = LayerId | "eiendomsgrenser" | "planflater";

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

/**
 * En valgfri verdi fra et Esri-svar: `null`, `undefined` eller en tom streng.
 *
 * Kilden fyller i dag hvert felt vi ber om - kontrollert mot alle 2480 radene i
 * de tolv sonelagene - men den tomme strengen er ArcGIS' andre måte å si «ingen
 * verdi» på, og `text()` avviser den med 502. Uten dette ville én flate med et
 * tomt navn felt hele plankilden, og med den hvert fritak `vurderMeldeplikt` kan
 * gi. Guardene rundt her hadde allerede bestemt at ingen verdi ikke er en feil;
 * dette gjør dem ferdige.
 */
function manglerVerdi(input: unknown): boolean {
  return input === null || input === undefined || (typeof input === "string" && !input.trim());
}

function planId(input: unknown): string {
  const id = text(input, 30);
  if (!/^\d+$/.test(id)) fail("Plankilden svarte uten en gyldig planidentifikasjon.");
  return id;
}

function punkt(input: unknown): TiltakshjelpenPunkt {
  const value = record(input);
  try {
    return validateTiltakshjelpenPunkt({ lat: value.lat, lon: value.lon });
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

/**
 * Tidsgrensene for et kartoppslag, i rekkefølge, og dermed antall forsøk.
 *
 * Målt mot Bergens `Bygning_Flate/.../query` fra en container: median 122 ms, men
 * en tung hale på 2,6 til 4,7 sekunder og innimellom over 8. Halen er kilden sin,
 * ikke vår - metadataoppslaget mot det samme laget stanset aldri, og et avbrutt
 * kall er et `TimeoutError`, ikke et avslag. Med ett forsøk på 8 sekunder falt
 * derfor «Bebygd eiendom» til uavklart noen ganger i timen, og et tiltak som
 * oppfyller vilkårene fikk «må avklares» i stedet for fritak.
 *
 * Første forsøk kuttes tidlig, fordi et svar som ikke er kommet etter fire
 * sekunder nesten alltid er halen og ikke et stort svar underveis. Det andre får
 * hele budsjettet. Verste fall er da 12 sekunder mot 8 før, og det vanlige
 * tilfellet er uendret.
 *
 * Bare tidsavbrudd gjentas. En 4xx, en 5xx eller et svar som ikke er JSON er
 * kildens svar og betyr det samme som før: `upstream.ts` avgjør hva det betyr, og
 * det stedet er fortsatt ett.
 */
const KARTOPPSLAG_TIDSGRENSER = [4000, 8000] as const;

function erTidsavbrudd(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

async function readJson(url: URL, service: string): Promise<unknown> {
  // Bare den overstyrte verdien kan være ugyldig - konstanten er kontrollert når
  // den skrives - så sjekken står der verdien leses og ikke i en løkke som kjører
  // fjorten ganger per grunnlag for å kontrollere det samme tallparet om igjen.
  const overstyrt = process.env.NODE_ENV === "test" && process.env.GARASJE_TIMEOUT_MS
    ? Number(process.env.GARASJE_TIMEOUT_MS) : null;
  if (overstyrt !== null && (!Number.isInteger(overstyrt) || overstyrt < 1 || overstyrt > 30_000)) {
    throw new HttpError("Ugyldig tidsgrense for datakilden.", 500);
  }
  const tidsgrenser = overstyrt === null ? KARTOPPSLAG_TIDSGRENSER : [overstyrt, overstyrt];
  // Gjenforsøket ligger rundt selve sendingen og ikke rundt `callUpstream`, slik at
  // tolkningen av et svar fortsatt skjer én gang, på det siste utfallet.
  //
  // Flagget finnes fordi `callUpstream` pakker feilen inn i sin egen HttpError før
  // catch-en nedenfor ser den: da er navnet «HttpError» og ikke «TimeoutError», og
  // et tidsavbrudd kan ikke skilles fra et brutt svar lenger nede uten dette.
  let avbruttPaaTid = false;
  const send = async (): Promise<Response> => {
    for (const [nr, timeout] of tidsgrenser.entries()) {
      // Nullstilles per forsøk. Uten det blir et tidsavbrudd på første forsøk
      // stående når det andre svarer med en feil, og innbyggeren får «svarte ikke
      // i tid … kjør sjekken på nytt» om en kilde som faktisk er i stykker.
      avbruttPaaTid = false;
      try {
        return await fetch(url, { signal: AbortSignal.timeout(timeout), redirect: "error", headers: { Accept: "application/json" } });
      } catch (error) {
        avbruttPaaTid = erTidsavbrudd(error);
        if (nr === tidsgrenser.length - 1 || !avbruttPaaTid) throw error;
      }
    }
    throw new HttpError("Ingen tidsgrenser for datakilden.", 500);
  };
  try {
    return await callUpstream<unknown>({ service, action: "Å hente offentlige kartdata" }, send);
  } catch (error) {
    // A response stream can fail after headers arrived, outside upstream's
    // request-error mapping. This catch covers only the HTTP read.
    if (!(error instanceof Error)) throw error;
    // Public geodata is not synthetic. Keep upstream's status mapping without
    // carrying over its sandbox-specific flag or an untrusted response body.
    //
    // Et tidsavbrudd får sin egen setning, fordi den ender i `kilde.merknad` og
    // dermed foran innbyggeren. «Kunne ikke levere et gyldig svar» leses som at
    // kilden er i stykker; at den var treg og at et nytt forsøk kan hjelpe er både
    // sannere og til å gjøre noe med.
    throw new HttpError(
      avbruttPaaTid
        ? `${service} svarte ikke i tid, heller ikke på et nytt forsøk. Kilden er treg akkurat nå, ikke utilgjengelig. Kjør sjekken på nytt, eller be kommunen bekrefte forholdet.`
        : `${service} kunne ikke levere et gyldig svar.`,
      502, { kilde: url.href, detalj: error.message });
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

export async function searchTiltakshjelpenAdresser(sok: string, kommunenummer?: string): Promise<TiltakshjelpenAdresse[]> {
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

function officialLayerUrl(id: LayerId | "hensynssoner", kommune: TiltakshjelpenKommunekilder | undefined): string {
  return kommune ? getTiltakshjelpenKartlagUrl(kommune, id) : "";
}

/**
 * Hva hver kilde er: hvilket kommunalt kartlag, og hva den heter uten et oppsett.
 *
 * `planflater` heter `hensynssoner` i kommuneregisteret, og `eiendomsgrenser` er
 * nasjonalt og har ikke noe lag. Én tabell og ikke to parallelle: de måtte uansett
 * få og miste nøkler sammen, så to av dem var to steder å glemme den ene.
 */
const KILDER: Record<SourceId, { lag: LayerId | "hensynssoner" | null; navn: string }> = {
  kpa: { lag: "kpa", navn: "Kommuneplan" },
  reguleringsplan: { lag: "reguleringsplan", navn: "Reguleringsplaner" },
  bygninger: { lag: "bygninger", navn: "Bygningskart" },
  planflater: { lag: "hensynssoner", navn: "Hensynssoner" },
  eiendomsgrenser: { lag: null, navn: "Kartverket / Geonorge eiendomskart" },
};

type Envelope = [number, number, number, number];

/**
 * Broen mellom de to formene for det samme rektangelet.
 *
 * `Envelope` er firetuppelen Esri vil ha i `geometry`; `Kartutsnitt` er den
 * navngitte formen geometrien regner med. De blir stående hver for seg fordi
 * rekkefølgen i tuppelen er kildens kontrakt og ikke vår, men omregningen
 * skrives én gang.
 */
function tilKartutsnitt([vest, sor, ost, nord]: Envelope): Kartutsnitt {
  return { vest, sor, ost, nord };
}

function tilEnvelope({ vest, sor, ost, nord }: Kartutsnitt): Envelope {
  return [vest, sor, ost, nord];
}

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

/**
 * Lagmetadata, hentet én gang per lag.
 *
 * Kartlagets oppsett - felter, geometritype, om det kan spørres - endrer seg ikke
 * mellom to oppslag. Memoen er derfor på tvers av kall og ikke innenfor ett:
 * nøkkelen er lagets egen URL, så de seksten lagene henter hvert sitt oppsett
 * første gang og ingen etterpå. Målt mot den ekte tjenesten er det 16 forespørsler
 * og rundt 1,7 sekunder spart på hvert kall etter det første. Selve valideringen
 * kjører fortsatt per lag; det er bare hentingen som slipper å gjentas.
 *
 * Levetiden er prosessens. Endrer kommunen laget sitt, trengs en omstart - og det
 * er riktig avveining for et oppsett som ellers ligger fast i årevis.
 */
const lagmetadata = new Map<string, Promise<Record<string, unknown>>>();

/**
 * Glemmer det huskede lagoppsettet.
 *
 * Finnes for testene, og det står her framfor å være en betingelse inne i memoen:
 * en memo som slår seg av under test er ikke den memoen som kjører i produksjon.
 * Kallerne er `scripts/test-tiltakshjelpen.ts`, som må kunne prøve et endret
 * lagoppsett uten at svaret fra forrige test står i veien.
 */
export function nullstillLagmetadata(): void {
  lagmetadata.clear();
}

async function hentLagmetadata(root: URL, navn: string): Promise<Record<string, unknown>> {
  const metadataUrl = new URL(root);
  metadataUrl.searchParams.set("f", "json");
  const noekkel = metadataUrl.href;
  let venter = lagmetadata.get(noekkel);
  if (!venter) {
    venter = readJson(metadataUrl, navn).then(record);
    lagmetadata.set(noekkel, venter);
    // Et feilet oppslag skal ikke bli stående som svaret for resten av kjøringen.
    venter.catch(() => lagmetadata.delete(noekkel));
  }
  return venter;
}

/**
 * Hva laget spørres om: ett punkt, eller et utsnitt med geometri tilbake.
 *
 * En union og ikke to valgfrie parametere. Med `(punkt, geometri, utsnitt?)` var
 * punktet stille ignorert så snart et utsnitt var med, og en kaller kunne sende
 * et punkt som ikke hadde noen virkning.
 */
type Lagsporring = { punkt: TiltakshjelpenPunkt } | { utsnitt: Envelope };

/**
 * Feltnavnene laget faktisk har, etter at oppsettet er godkjent.
 *
 * Porten er den samme for et kartlag og et sonelag: svarer tjenesten med en feil,
 * er laget ikke et polygonlag, kan det ikke spørres, eller mangler det et felt vi
 * trenger, er det ikke noe å hente. Sto i to kopier som bare skilte seg i ordlyden
 * på feilmeldingen, og da er ArcGIS-kontrakten hevdet to steder.
 */
function lagfelter(metadata: Record<string, unknown>, paakrevde: readonly string[]): string[] {
  if (metadata.error || metadata.geometryType !== "esriGeometryPolygon"
    || typeof metadata.capabilities !== "string" || !metadata.capabilities.split(",").includes("Query")
    || !Array.isArray(metadata.fields)) fail("Kartlagets metadata bekrefter ikke at laget kan brukes.");
  const felter = (metadata.fields as unknown[]).map(record).map(f => text(f.name));
  if (paakrevde.some(felt => !felter.includes(felt))) fail("Kartlaget mangler nødvendige felter.");
  return felter;
}

/**
 * Ett kartlag, spurt på et punkt eller et utsnitt.
 *
 * Både `queryLayer` og sonelagene går gjennom denne. ArcGIS-kontrakten - hvilke
 * parametere spørringen har, og hva som gjør et svar ubrukelig - står derfor ett
 * sted. Den sto i to kopier som bare skilte seg i ordlyden på feilmeldingen og i
 * taket, og da må en endring i kilden rettes to steder eller ingen.
 */
async function esriSporring(
  root: URL, navn: string, felter: readonly string[], sporring: Lagsporring,
  opsjoner: { maks: number; forenkling?: string; kilde: string }
): Promise<Record<string, unknown>[]> {
  // Et utsnitt spørres alltid med geometri tilbake, et punkt aldri: punktet
  // svarer på «hva gjelder her», flaten på «hvor går grensen».
  const utsnitt = "utsnitt" in sporring;
  const url = new URL(`${root.href}/query`);
  url.search = new URLSearchParams({
    f: "json",
    geometry: utsnitt ? sporring.utsnitt.join(",") : `${sporring.punkt.lon},${sporring.punkt.lat}`,
    geometryType: utsnitt ? "esriGeometryEnvelope" : "esriGeometryPoint",
    inSR: "4258", outSR: "4258", spatialRel: "esriSpatialRelIntersects",
    outFields: felter.join(","), returnGeometry: String(utsnitt), returnZ: "false", returnM: "false",
    ...(opsjoner.forenkling ? { maxAllowableOffset: opsjoner.forenkling } : {}),
    resultRecordCount: String(opsjoner.maks),
  }).toString();
  const data = record(await readJson(url, navn));
  if (data.error || (data.exceededTransferLimit !== undefined && data.exceededTransferLimit !== false)
    || !Array.isArray(data.features) || data.features.length > opsjoner.maks) {
    fail(`${opsjoner.kilde} svarte med feil eller et ufullstendig utvalg. Ingen konklusjon kan trekkes fra utvalget.`);
  }
  if (utsnitt && data.features.length > 0) {
    const sr = record(data.spatialReference);
    if (sr.wkid !== 4258 || data.geometryType !== "esriGeometryPolygon") {
      fail(`${opsjoner.kilde} svarte i et ukjent koordinatsystem.`);
    }
  }
  return data.features.map(record);
}

async function queryLayer(id: LayerId, kommune: TiltakshjelpenKommunekilder | undefined, sporring: Lagsporring): Promise<Record<string, unknown>[]> {
  if (!kommune) throw new HttpError("Kommunal kartkilde er ikke konfigurert.", 500);
  const layer = kommune[id], schema = layers[id];
  const root = new URL(layer.path, testUrl("GARASJE_KART_BASE_URL", kommune.kartBaseUrl).replace(/\/?$/, "/"));
  const metadata = await hentLagmetadata(root, layer.navn);
  const fields = lagfelter(metadata, schema.fields);
  const requestedFields: string[] = [...schema.fields];
  requestedFields.push(...schema.optionalFields.filter(f => fields.includes(f)));
  const rader = await esriSporring(root, layer.navn, requestedFields, sporring, {
    maks: 500, kilde: "Kartkilden",
    ...(schema.forenkles ? { forenkling: PLANFLATE_FORENKLING } : {}),
  });
  return rader.map(feature => {
    const attributes = record(feature.attributes);
    const clean = {
      attributes: Object.fromEntries(requestedFields.map(name => [name, attributes[name]])),
      ...("utsnitt" in sporring ? { geometry: feature.geometry } : {}),
    };
    // AREALST er valgfritt og står bare i svaret når det ble bedt om, så den
    // manglende verdien er den eneste sjekken som trengs.
    if (!schema.sonenavnFraTegnforklaring || attributes.AREALST === undefined || attributes.AREALST === null) return clean;
    const sonenavn = readKpaSonenavn(metadata, integer(attributes.KPAREALFORMAL, 1), integer(attributes.AREALST, 1));
    return { ...clean, ...(sonenavn ? { sonenavn } : {}) };
  });
}

/**
 * Ringene i en Esri-geometri, hvert koordinat kontrollert og hver ring lukket.
 *
 * Én parser, fordi begge lesere av et Esri-svar trenger nøyaktig de samme
 * kontrollene: at ringen er lukket, at koordinatene er gyldige, og at den har et
 * areal. `esriDeler` deler dem i polygondeler etterpå.
 */
function esriRinger(
  rings: unknown, tak: { maksRinger: number; maksPunkter: number } = { maksRinger: 100, maksPunkter: 10_000 }
): [number, number][][] {
  if (!Array.isArray(rings) || !rings.length || rings.length > tak.maksRinger) fail();
  return rings.map(ring => {
    if (!Array.isArray(ring) || ring.length < 4 || ring.length > tak.maksPunkter) fail();
    const points: [number, number][] = ring.map(pair => {
      if (!Array.isArray(pair) || pair.length < 2) fail();
      const p = punkt({ lon: pair[0], lat: pair[1] });
      return [p.lon, p.lat];
    });
    const first = points[0]!, last = points.at(-1)!;
    if (first[0] !== last[0] || first[1] !== last[1]) fail("Kartkilden svarte med en åpen polygonring.");
    if (Math.abs(ringareal(points)) < 1e-16) fail("Kartkilden svarte med en polygonring uten areal.");
    return points;
  });
}

function polygon(feature: Record<string, unknown>): TiltakshjelpenPolygon {
  const attributes = record(feature.attributes), geometry = record(feature.geometry);
  return { id: String(integer(attributes.OBJECTID, 1)), ringer: esriRinger(geometry.rings) };
}

function buildingAttributes(feature: Record<string, unknown>): TiltakshjelpenEksisterendeBygning {
  const attrs = record(feature.attributes);
  const building: TiltakshjelpenEksisterendeBygning = { id: String(integer(attrs.OBJECTID, 1)), kobling: "geometri" };
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

function eiendomQuery(adresse: TiltakshjelpenAdresse): URL {
  const suffix = adresse.festenummer ? `/${adresse.festenummer}` : "";
  const url = new URL(testUrl("GARASJE_EIENDOM_URL", EIENDOM_URL));
  url.search = new URLSearchParams({
    matrikkelnummer: `${adresse.kommunenummer}-${adresse.gardsnummer}/${adresse.bruksnummer}${suffix}`,
    omrade: "true", utkoordsys: "4258",
  }).toString();
  return url;
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

/**
 * Om to ringer krysser hverandre. `same` sammenligner en ring med seg selv.
 *
 * Den ytre løkken går over `b` og avviser hvert segment mot omslutningen til `a`
 * før segmentparene regnes ut. Det er ikke mikrooptimering: `a` er teigringen på
 * et par hundre punkter og `b` er planflaten på nitten tusen, så uten avvisningen
 * ble hvert eneste par regnet ut. Målt på seksten slike flater mot én teig: 79 ms
 * uten avvisningen, 3,4 ms med. Det er blokkerende CPU på tjenerens eneste tråd,
 * altså ventetid for hver andre forespørsel også.
 */
function ringsIntersect(a: Pair[], b: Pair[], same = false, strict = false): boolean {
  if (same) {
    for (let i = 0; i < a.length - 1; i++) {
      for (let j = i + 2; j < b.length - 1; j++) {
        if (i === 0 && j === b.length - 2) continue;
        if (segmentsIntersect(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!, strict)) return true;
      }
    }
    return false;
  }
  let vest = Infinity, sor = Infinity, ost = -Infinity, nord = -Infinity;
  for (const [x, y] of a) {
    if (x < vest) vest = x;
    if (x > ost) ost = x;
    if (y < sor) sor = y;
    if (y > nord) nord = y;
  }
  for (let j = 0; j < b.length - 1; j++) {
    const c = b[j]!, d = b[j + 1]!;
    if (Math.max(c[0], d[0]) < vest || Math.min(c[0], d[0]) > ost
      || Math.max(c[1], d[1]) < sor || Math.min(c[1], d[1]) > nord) continue;
    for (let i = 0; i < a.length - 1; i++) {
      if (segmentsIntersect(a[i]!, a[i + 1]!, c, d, strict)) return true;
    }
  }
  return false;
}

type Flate = Pick<TiltakshjelpenPolygon, "ringer">;

/** Om punktet ligger i rektangelet. Grensen regnes med, slik `containsPunkt` gjør. */
function inneIBoks(p: Pair, boks: Kartutsnitt): boolean {
  return p[0] >= boks.vest && p[0] <= boks.ost && p[1] >= boks.sor && p[1] <= boks.nord;
}

/**
 * Om to flater overlapper i areal, ikke bare berører hverandre.
 *
 * Omslutningene først, og de kan sendes inn når kalleren allerede har dem: er de
 * usammenhångende, kan verken et strengt kryss eller et innvendig punkt finnes.
 *
 * Deretter samme avvisning ett nivå ned, og det er den som betyr noe. Hvert punkt
 * som skal prøves mot en flate testes først mot flatens rektangel: et punkt
 * utenfor det kan verken være inne i flaten eller på kanten av den, så svaret er
 * uendret - men det koster fire sammenligninger i stedet for en ray cast over
 * nitten tusen punkter. Målt på seksten plansoneflater mot én teig som ligger
 * utenfor dem - den grenen som faktisk når hit: 306 ms uten, 3 ms med. Det er
 * blokkerende CPU på tjenerens eneste tråd, altså køtid for hver andre
 * forespørsel også.
 */
function polygonsIntersect(a: Flate, b: Flate, aBounds?: Kartutsnitt, bBounds?: Kartutsnitt): boolean {
  const first = aBounds ?? ringerBounds(a.ringer), second = bBounds ?? ringerBounds(b.ringer);
  if (!intersectsKartutsnitt(first, second)) return false;
  const strictlyInside = (p: Pair, shape: Flate, boks: Kartutsnitt) => inneIBoks(p, boks)
    && containsPunkt({ lon: p[0], lat: p[1] }, shape)
    && !shape.ringer.some(ring => ring.slice(1).some((end, i) => segmentsIntersect(p, p, ring[i]!, end)));
  const hasInsidePoint = (shape: Flate, target: Flate, boks: Kartutsnitt) => shape.ringer.some(ring =>
    ring.slice(1).some((end, i) => strictlyInside(end, target, boks)
      || strictlyInside([(ring[i]![0] + end[0]) / 2, (ring[i]![1] + end[1]) / 2], target, boks)));
  // Strict crossing catches overlaps without contained vertices. Boundary-only
  // contact does not make the neighbour's building evidence of a built parcel.
  if (a.ringer.some(ar => b.ringer.some(br => ringsIntersect(ar, br, false, true)))
    || hasInsidePoint(a, b, second) || hasInsidePoint(b, a, first)) return true;
  // Coincident boundaries can enclose area without a strictly interior edge
  // point. Reuse the area intersection rather than inventing a boundary rule.
  try {
    return calculateTiltakshjelpenAreal([a], [b], { lon: (first.vest + first.ost) / 2, lat: (first.sor + first.nord) / 2 }).kartlagtBebygdArealM2 > 1e-6;
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    return false;
  }
}

// The same spherical approximation the map view uses in tiltakshjelpen-kart.ts.
const METERS_PER_DEGREE = 111320;

function buildingEnvelope(parcels: TiltakshjelpenPolygon[], p: TiltakshjelpenPunkt): Envelope {
  const envelope: Envelope = [p.lon - 0.002, p.lat - 0.001, p.lon + 0.002, p.lat + 0.001];
  const teiger = tilEnvelope(getGeometriBounds({ type: "MultiPolygon", coordinates: parcels.map(teig => teig.ringer) }));
  // The map view pads the teig by 10 m and then grows the short side to 4:3
  // (fitKartutsnitt). Query the same extent, or the buildings along the edges of
  // a wide teig are missing from a map that shows their ground.
  if (Number.isFinite(teiger[0])) {
    const lonMeters = METERS_PER_DEGREE * Math.cos(p.lat * Math.PI / 180);
    const view: Envelope = [
      teiger[0] - 10 / lonMeters, teiger[1] - 10 / METERS_PER_DEGREE,
      teiger[2] + 10 / lonMeters, teiger[3] + 10 / METERS_PER_DEGREE,
    ];
    const width = (view[2] - view[0]) * lonMeters, height = (view[3] - view[1]) * METERS_PER_DEGREE;
    if (width / height < 640 / 480) {
      const extra = (height * 640 / 480 - width) / lonMeters / 2;
      view[0] -= extra; view[2] += extra;
    } else {
      const extra = (width * 480 / 640 - height) / METERS_PER_DEGREE / 2;
      view[1] -= extra; view[3] += extra;
    }
    envelope[0] = Math.min(envelope[0], view[0]);
    envelope[1] = Math.min(envelope[1], view[1]);
    envelope[2] = Math.max(envelope[2], view[2]);
    envelope[3] = Math.max(envelope[3], view[3]);
  }
  // Avoid a municipality-wide fetch when one matrikkelenhet has distant teiger.
  if (envelope[2] - envelope[0] > 0.05 || envelope[3] - envelope[1] > 0.025) {
    fail("Eiendommens teiger dekker et for stort område for et fullstendig bygningsoppslag i piloten.");
  }
  return envelope;
}

function buildBebyggelse(
  parcels: TiltakshjelpenPolygon[], geojson: TiltakshjelpenEiendomsGeoJson | undefined,
  buildings: { polygon: TiltakshjelpenPolygon; attributes: TiltakshjelpenEksisterendeBygning }[], kilder: TiltakshjelpenKilde[],
  kommune: TiltakshjelpenKommunekilder | undefined,
): TiltakshjelpenBebyggelse {
  const result: TiltakshjelpenBebyggelse = {
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

function hasUavklartTeigomfang(geojson: TiltakshjelpenEiendomsGeoJson | undefined): boolean {
  return geojson?.features.some(f => f.properties.teigmedflerematrikkelenheter
    || f.properties.uregistrertjordsameie) ?? false;
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
export function calculateTiltakshjelpenAreal(parcels: Flate[], buildings: Flate[], origin: TiltakshjelpenPunkt) {
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
  const edgesFor = (polygons: Flate[]): Segment[][] => polygons.map(polygon => polygon.ringer.flatMap(ring => {
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
  adresse: TiltakshjelpenAdresse, parcels: TiltakshjelpenPolygon[], buildings: TiltakshjelpenPolygon[],
  geojson: TiltakshjelpenEiendomsGeoJson | undefined, kilder: TiltakshjelpenKilde[],
  kommune: TiltakshjelpenKommunekilder | undefined,
): TiltakshjelpenArealberegning {
  const teigkilde = kilder.find(kilde => kilde.id === "eiendomsgrenser");
  const koordinatsystem = teigkilde?.koordinatsystem ?? "ukjent koordinatsystem";
  const result: TiltakshjelpenArealberegning = {
    tomtearealM2: null, kartlagtBebygdArealM2: null, kartlagtAndelProsent: null,
    kilde: [teigkilde?.url, officialLayerUrl("bygninger", kommune)].filter(Boolean).join(" og "),
    metode: `Anslag fra teiger i ${koordinatsystem} og bygningsflater i EPSG:4258, beregnet i et lokalt meterplan på GRS80 ved adressepunktet. Arealet av sammenslåtte teiger og bygningsflater beregnes med hull, uten dobbelttelling av overlapp. Bygningsflatene klippes til teigene.`,
    forbehold: [
      "Dette er kartlagt flatedekning, ikke juridisk BYA, %BYA, BRA eller %BRA. Parkering, overbygg og andre arealer som skal med etter planen, kan mangle.",
      "Tillatt utnyttelse er ikke fastsatt. Gjeldende planbestemmelser, beregningsmåte og lovlig etablert bebyggelse må kontrolleres.",
      "Lokal projeksjon, kartkvalitet og kartets oppdatering gir usikkerhet. Tallene er anslag, ikke oppmålte eller godkjente arealer.",
    ],
  };
  if (teigkilde?.status !== "ok" || !parcels.length) {
    result.forbehold.push("Tomtearealet er ukjent fordi eiendomsflaten mangler eller ikke kunne hentes.");
    return result;
  }
  if (hasUavklartTeigomfang(geojson)) {
    result.forbehold.push("Teigen har ukjent tilknytning, omfatter flere matrikkelenheter eller jordsameie. Arealet som tilhører den valgte eiendommen er ukjent.");
    return result;
  }
  if (parcels.some(p => p.kvalitetsklasse !== "Grønt")) result.forbehold.push("En eller flere teiger har usikker eller ukjent grensekvalitet. Det påvirker arealanslaget.");
  const status = kilder.find(k => k.id === "bygninger")?.status;
  const bygningskildeOk = status === "ok" || status === "ingen_treff";
  if (!bygningskildeOk) {
    result.forbehold.push(kommune
      ? "Kartlagt bygningsareal og andel er ukjent fordi bygningskilden ikke ga et fullstendig svar."
      : `Kartlagt bygningsareal og andel er ukjent fordi piloten ikke har en bygningskilde for kommunenummer ${adresse.kommunenummer}.`);
  }
  const parcelBounds = parcels.map(teig => ringerBounds(teig.ringer));
  const relevant = bygningskildeOk ? buildings.filter(building => {
    const b = ringerBounds(building.ringer);
    return parcelBounds.some(teig => intersectsKartutsnitt(teig, b));
  }) : [];
  // Den samlede summeringen først. Den svarer på tomtearealet også, så et eget
  // kall for teigene alene var en hel ekstra sveip over de samme kantene hver
  // gang det gikk bra. Går den samlede i stå, er det bygningsgeometrien som er
  // for detaljert - og da svarer teigene alene fortsatt på tomtearealet.
  try {
    const calculated = calculateTiltakshjelpenAreal(parcels, relevant, adresse.punkt);
    result.tomtearealM2 = Number(calculated.tomtearealM2.toFixed(2));
    if (!bygningskildeOk) return result;
    result.kartlagtBebygdArealM2 = Number(calculated.kartlagtBebygdArealM2.toFixed(2));
    result.kartlagtAndelProsent = Number(calculated.kartlagtAndelProsent.toFixed(2));
    if (calculated.kartlagtBebygdArealM2 === 0) result.forbehold.push("Null kartlagt flatedekning bekrefter ikke at eiendommen er ubebygd.");
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    result.forbehold.push(error.message);
    try {
      result.tomtearealM2 = Number(calculateTiltakshjelpenAreal(parcels, [], adresse.punkt).tomtearealM2.toFixed(2));
    } catch (bareTeiger) {
      if (!(bareTeiger instanceof HttpError)) throw bareTeiger;
    }
  }
  return result;
}

function validateParcelRings(input: unknown): Pair[][] {
  const rings = esriRinger(input);
  if (rings.reduce((n, ring) => n + ring.length, 0) > 2000) fail("Eiendomspolygonen er for stor for denne kontrollen.");
  const contains = (ring: Pair[], p: Pair) => containsPunkt({ lon: p[0], lat: p[1] }, { ringer: [ring] });
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

function parseEiendomsGeoJson(input: unknown, adresse: TiltakshjelpenAdresse, nabotomter = false): TiltakshjelpenEiendomsGeoJson {
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
  const features: TiltakshjelpenEiendomsGeoJson["features"] = data.features.map(input => {
    const feature = record(input), geometry = record(feature.geometry), p = record(feature.properties);
    const gnr = integer(p.gardsnummer, nabotomter ? 0 : 1), bnr = integer(p.bruksnummer), fnr = integer(p.festenummer);
    if (feature.type !== "Feature" || p.objekttype !== "Teig" || p.kommunenummer !== adresse.kommunenummer
      || (!nabotomter && (gnr !== adresse.gardsnummer || bnr !== adresse.bruksnummer
        || fnr !== adresse.festenummer))) fail("Eiendomskilden svarte med en annen matrikkelenhet enn den valgte.");
    const lokalid = integer(p.lokalid, 1);
    if (ids.has(lokalid)) fail("Eiendomskilden svarte med dupliserte teiger.");
    ids.add(lokalid);
    let polygons: Pair[][][];
    const readRings = (value: unknown) => nabotomter ? esriRinger(value) : validateParcelRings(value);
    if (geometry.type === "Polygon") polygons = [readRings(geometry.coordinates)];
    else if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)
      && geometry.coordinates.length > 0 && geometry.coordinates.length <= 100) {
      polygons = geometry.coordinates.map(readRings);
    } else fail("Eiendomskilden svarte uten Polygon eller MultiPolygon.");
    points += polygons.flat().reduce((n, ring) => n + ring.length, 0);
    if (points > (nabotomter ? 50_000 : 10_000)) fail("Eiendomskildens geometri er for stor for denne kontrollen.");
    const properties: TiltakshjelpenEiendomsGeoJson["features"][number]["properties"] = {
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

function parcelPolygons(geojson: TiltakshjelpenEiendomsGeoJson): TiltakshjelpenPolygon[] {
  return geojson.features.flatMap(feature => {
    const p = feature.properties;
    const id = String(p.lokalid);
    const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    return polygons.map((ringer, index) => ({
      id: polygons.length === 1 ? id : `${id}-${index + 1}`,
      ringer, teigId: p.lokalid, matrikkelnummer: p.matrikkelnummertekst,
      teig: { gnr: p.gardsnummer, bnr: p.bruksnummer, fnr: p.festenummer, teigId: p.lokalid },
      ...(p["nøyaktighetsklasseteig"] ? { kvalitetsklasse: p["nøyaktighetsklasseteig"] } : {}),
      ...(p.oppdateringsdato ? { oppdatert: p.oppdateringsdato } : {}),
    }));
  });
}


/**
 * Taket på hvor mange punkter én planflatering får ha.
 *
 * Høyere enn for en teig, og det er ikke slapphet: en teig er én eiendom, mens en
 * LNF-flate eller en byfjellsone er ett polygon over en hel fjellside. Målt mot
 * kilden gir et vanlig teigutsnitt i LNF en ring på 16 225 punkter selv etter
 * forenkling - med teigens tak på 10 000 ville hele plansteget blitt en kildefeil
 * nøyaktig der `vurderMeldeplikt` kan gi fritaket.
 *
 * Taket over alle flatene i ett svar står ved siden av, så en enkeltring som er
 * stor ikke gjør at hele oppslaget kan bli det.
 */
const PLANFLATE_MAKS_PUNKTER = 300_000;
/**
 * Og taket for én ring, utledet av budsjettet over.
 *
 * En femtedel: en enkelt ring får være stor, men ikke så stor at den alene
 * bruker opp det svaret har lov til å veie. Utledet framfor skrevet ned, slik at
 * det finnes ett tall å justere og ikke to som kan komme i utakt.
 */
const PLANFLATE_MAKS_PUNKTER_PER_RING = PLANFLATE_MAKS_PUNKTER / 5;

/**
 * Taket på antall flater i svaret fra **étt** sonelag.
 *
 * Høyere enn `NABOTEIG_MAX_TREFF` fordi en sone kan være oppstykket i mange
 * små deler i det samme utsnittet, mens en teig er én eiendom. Sto i
 * `apps/shared/hensynssoner.ts` mens plan-mock håndhevet det på sin åpne rute;
 * nå er det denne filen som spør, og en delt modul med én leser er en omvei.
 *
 * Tallet gjelder étt lag, og det er ikke en detalj: Bergen har tretten sonelag som
 * spørres hver for seg, og hver feature kan dessuten deles i flere polygondeler.
 * Taket på unionen utledes derfor av dette, framfor å arve det - et lag-tak brukt
 * på summen ville felt hele plankilden for tretten lag som hver svarte normalt.
 */
const PLANSONE_MAX_TREFF = 400;

/**
 * Hvor mye sonegrensene forenkles, i grader.
 *
 * Rundt to meter. Uten den svarte en boks på tre kilometer mot gul støysone med
 * 5,8 MB på 2,8 sekunder; med den 536 kB på under ett. Flatene er ekte
 * sonegrenser, men de er ikke oppmålte, og det er den setningen innbyggeren får
 * se - se merknaden på kilden lenger nede.
 */
const PLANFLATE_FORENKLING = "0.00002";

/**
 * Kontrollen av at plankilden svarte på utsnittet vi faktisk ba om.
 *
 * Regelen er snudd. Kilden var et uttrekk klippet til utsnittet, og en koordinat
 * utenfor rektangelet var derfor et brudd. Kommunens egen tjeneste svarer med hele
 * flaten, så nå er det motsatte kravet det riktige: geometrien får gå utenfor, men
 * den må berøre utsnittet - ellers er det en flate vi ikke ba om.
 *
 * Sjekken står på **hele featuren** og ikke på den enkelte polygondelen, og det er
 * ikke en detalj: ArcGIS svarer med hele geometrien til det som treffer utsnittet,
 * og en multiflate har deler langt unna. Sto sjekken på delen, ville en enslig
 * landskapsdel noen hundre meter borte felt hele plankilden - og med den hvert
 * fritak `vurderMeldeplikt` kan gi, siden `alleKilderOk` er en hviteliste. En del
 * som ikke berører utsnittet er ikke en feil; den faller uansett bort i `beroring`.
 */
function sjekkPlanflateUtsnitt(deler: [number, number][][][], bounds: Kartutsnitt): void {
  // Koordinatene er allerede kontrollert av `esriRinger`, punkt for punkt gjennom
  // `punkt()`. Her gjenstår bare spørsmålet featuren må svare ja på.
  if (!intersectsKartutsnitt(getGeometriBounds({ type: "MultiPolygon", coordinates: deler }), bounds)) {
    fail("Plankilden svarte med en flate som ikke berører kartutsnittet den ble spurt om.");
  }
}

/**
 * Omslutningen til én polygondels ringer.
 *
 * Lokal og ikke i `apps/shared/geometri.ts`: det er ingen regel, bare et navn på
 * å pakke én polygon inn som en multipolygon. Uten navnet sto innpakkingen skrevet
 * ut på hvert kallsted, der `[ringer]` og `ringer` begge er gyldige og ingen av
 * dem gir en typefeil om man tar feil.
 */
function ringerBounds(ringer: readonly (readonly (readonly number[])[])[]): Kartutsnitt {
  return getGeometriBounds({ type: "MultiPolygon", coordinates: [ringer as number[][][]] });
}

/** Arealet med fortegn. Esri tegner ytre ringer med klokken, hull mot. */
function ringareal(ring: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    sum += ring[i]![0] * ring[i + 1]![1] - ring[i + 1]![0] * ring[i]![1];
  }
  return sum / 2;
}

/**
 * Esri-ringer delt i polygondeler, én ytre ring med sine hull per del.
 *
 * Esri legger flere ytre ringer i samme feature, mens `beroring` leser `ringer[0]`
 * som yttergrensen og resten som hull. Uten delingen ville to atskilte
 * landskapsflater blitt lest som én flate med et hull i, og svaret «helt» ville
 * gjeldt grunn sonen ikke dekker. Plan-mocken lærte det samme og indekserte på
 * polygondelen; lærdommen flytter hit sammen med oppslaget.
 */
function esriDeler(rings: unknown): [number, number][][][] {
  const deler: [number, number][][][] = [];
  for (const ring of esriRinger(rings, { maksRinger: 200, maksPunkter: PLANFLATE_MAKS_PUNKTER_PER_RING })) {
    // Med klokken er ytre ring. En feature som starter med et hull finnes ikke i
    // Esris egen form, men om den kommer, leses den første ringen som ytre
    // uansett - et hull uten en flate rundt seg har ingen tolkning.
    if (ringareal(ring) <= 0 || !deler.length) deler.push([ring]);
    else deler[deler.length - 1]!.push(ring);
  }
  return deler;
}

/** Feltene en sonespørring ber om, utover kodefeltet laget selv navngir. */
const SONEFELTER = ["HENSYNSONENAVN", "BESKRIVELSE", "PLANID"] as const;

/**
 * Hensynssonene og arealformålet som flater, fra kommunens egne kartlag.
 *
 * Hvert barnelag spørres for seg, fordi ArcGIS ikke svarer på en spørring mot et
 * gruppelag. Arealformålet er det samme laget som punktoppslaget `kpa` bruker, og
 * spørres her med geometri i stedet for uten.
 */
async function hentPlanflater(
  kommune: TiltakshjelpenKommunekilder, utsnitt: Envelope
): Promise<{ soner: Planflatetreff[]; formaal: Planflatetreff[] }> {
  const kommunenummer = kommune.kommunenummer;
  const base = testUrl("GARASJE_KART_BASE_URL", kommune.kartBaseUrl).replace(/\/?$/, "/");
  const tjeneste = new URL(kommune.hensynssoner.path, base);
  const utsnittBounds = tilKartutsnitt(utsnitt);

  const lesFlater = (
    rader: Record<string, unknown>[], datasett: Datasettid, kodefelt: string, navnefelt: string | null
  ): Planflatetreff[] => rader.flatMap((rad, nr) => {
    const attrs = record(rad.attributes), geometry = record(rad.geometry);
    const sonenavn = navnefelt === null || manglerVerdi(attrs[navnefelt]) ? null : text(attrs[navnefelt]);
    const deler = esriDeler(geometry.rings);
    sjekkPlanflateUtsnitt(deler, utsnittBounds);
    return deler.map(del => ({
      ringer: del,
      datasett,
      // Sonekoden kan mangle på samme måte som navnet, og en flate uten kode kan
      // ikke navngis. Den telles og hoppes over i `byggPlanflater`, som en ukjent
      // kode - og en faresone uten kode feller kilden der, som en faresone uten navn.
      sonekode: manglerVerdi(attrs[kodefelt]) ? null : integer(attrs[kodefelt]),
      sonenavn,
      arealstatus: manglerVerdi(attrs.AREALST) ? null : integer(attrs.AREALST),
      beskrivelse: manglerVerdi(attrs.BESKRIVELSE) ? null : text(attrs.BESKRIVELSE),
      planId: planId(attrs.PLANID),
      kommunenummer,
    }));
  });

  // Alle lagene i parallell. De tretten sonelagene og arealformålet er uavhengige
  // oppslag mot samme tjeneste, og hvert av dem har et retrybudsjett på 4 + 8
  // sekunder. Etter tur ville verste fall vært fjorten ganger det; nå er det ett.
  // Tjenesten svarer ikke på en flerlagsspørring (`layerDefs` gir «Invalid URL»),
  // så fjorten forespørsler er det som skal til - de skal bare ikke stå i kø.
  const [sonesvar, formaalRader] = await Promise.all([
    Promise.all(kommune.hensynssoner.lag.map(async lag => lesFlater(
      await querySonelag(
        new URL(`${tjeneste.href}/${lag.id}`), `${kommune.hensynssoner.navn}, lag ${lag.id}`,
        [lag.kodefelt, ...SONEFELTER], utsnitt
      ),
      lag.datasett, lag.kodefelt, "HENSYNSONENAVN"
    ))),
    queryLayer("kpa", kommune, { utsnitt }),
  ]);
  const soner = sonesvar.flat();
  const formaal = lesFlater(formaalRader, "arealformaal", "KPAREALFORMAL", null);
  if (soner.length > PLANSONE_MAX_TREFF * kommune.hensynssoner.lag.length) {
    fail("Plankilden svarte med flere flater enn taket tillater. Ingen delvis liste vises.");
  }
  const punkter = [...soner, ...formaal].reduce(
    (sum, flate) => sum + flate.ringer.reduce((n, ring) => n + ring.length, 0), 0);
  if (punkter > PLANFLATE_MAKS_PUNKTER) {
    fail("Plankilden svarte med mer geometri enn taket tillater. Ingen delvis liste vises.");
  }
  return { soner, formaal };
}

/** Ett sonelag, spurt på et utsnitt og forenklet til om lag to meter. */
async function querySonelag(
  root: URL, navn: string, felter: string[], utsnitt: Envelope
): Promise<Record<string, unknown>[]> {
  lagfelter(await hentLagmetadata(root, navn), felter);
  return esriSporring(root, navn, felter, { utsnitt }, {
    maks: PLANSONE_MAX_TREFF, forenkling: PLANFLATE_FORENKLING, kilde: "Plankilden",
  });
}

/**
 * Ringene klippet til kartutsnittet, for tegning.
 *
 * Avgjørelsen - «helt», «delvis» eller ikke i det hele tatt - tas på hele flaten,
 * før dette. Det er derfor ikke det gamle klippede uttrekket i ny drakt: da var
 * det kilden som var klippet, og svaret hvilte på en beskåret flate. Her hviler
 * svaret på hele polygonet, og bare det som tegnes er trimmet.
 *
 * Grunnen er størrelsesorden. Ett arealformål i LNF er ett polygon over 27 × 40
 * kilometer: 396 kB og 19 022 punkter for et teigutsnitt på 138 × 200 meter, målt
 * mot kilden. Etter klipping er det 82 byte. Alt det andre går over tråden til
 * nettleseren og tegnes der.
 *
 * Følgen å vite om: kantene langs utsnittet er ikke sonegrenser, så ingen avstand
 * skal måles mot de tegnede ringene. Det gjelder tegningen, ikke vurderingen.
 */
function klippTilUtsnitt(ringer: [number, number][][], b: Kartutsnitt): [number, number][][] {
  const kanter: [(p: [number, number]) => boolean, (a: [number, number], c: [number, number]) => [number, number]][] = [
    [p => p[0] >= b.vest, (a, c) => [b.vest, a[1] + (c[1] - a[1]) * (b.vest - a[0]) / (c[0] - a[0])]],
    [p => p[0] <= b.ost, (a, c) => [b.ost, a[1] + (c[1] - a[1]) * (b.ost - a[0]) / (c[0] - a[0])]],
    [p => p[1] >= b.sor, (a, c) => [a[0] + (c[0] - a[0]) * (b.sor - a[1]) / (c[1] - a[1]), b.sor]],
    [p => p[1] <= b.nord, (a, c) => [a[0] + (c[0] - a[0]) * (b.nord - a[1]) / (c[1] - a[1]), b.nord]],
  ];
  const klippet: [number, number][][] = [];
  for (const ring of ringer) {
    // Sutherland-Hodgman: ringen skjæres mot én kant om gangen.
    let punkter = ring.slice(0, -1);
    for (const [innenfor, skjaering] of kanter) {
      const neste: [number, number][] = [];
      for (const [i, naa] of punkter.entries()) {
        const forrige = punkter[(i + punkter.length - 1) % punkter.length]!;
        if (innenfor(naa)) {
          if (!innenfor(forrige)) neste.push(skjaering(forrige, naa));
          neste.push(naa);
        } else if (innenfor(forrige)) {
          neste.push(skjaering(forrige, naa));
        }
      }
      punkter = neste;
      if (!punkter.length) break;
    }
    // En ring som ble borte lå helt utenfor utsnittet, og har ingenting å tegne.
    if (punkter.length >= 3) klippet.push([...punkter, punkter[0]!]);
  }
  return klippet;
}

/**
 * Hvordan flaten berører eiendommen.
 *
 * «helt» krever at ingen teiggrense krysser flaten og at teigen ligger inne i den.
 * Krysser de hverandre, er svaret «delvis», og det er det spørsmålet innbyggeren
 * faktisk stiller: går sonegrensen tvers gjennom tomten min. Sammenligningen er
 * mot de kartlagte teigene, ikke mot matrikkelenheten.
 *
 * Rekkefølgen er valgt så `polygonsIntersect` bare nås når de billige svarene
 * ikke holder: et kryss betyr «delvis» uten mer arbeid, og alle teigpunkter inne
 * uten kryss betyr «helt» bare når ingen hull i sonen overlapper teigen.
 * Et hull kan ligge helt inne på tomten uten at noen grenser krysser hverandre.
 */
function beroring(
  flate: Flate, parcels: readonly { polygon: TiltakshjelpenPolygon; bounds: Kartutsnitt }[],
  flateBounds: Kartutsnitt
): "helt" | "delvis" | null {
  const naerMedBoks = parcels.filter(teig => intersectsKartutsnitt(teig.bounds, flateBounds));
  const naer = naerMedBoks.map(teig => teig.polygon);
  if (!naer.length) return null;
  const krysser = naer.some(teig => teig.ringer.some(tr => flate.ringer.some(fr => ringsIntersect(tr, fr, false, true))));
  if (krysser) return "delvis";
  if (naer.length === parcels.length
    && naer.every(teig => teig.ringer.every(ring => ring.every(([lon, lat]) => ringerInneholder(lon, lat, flate.ringer))))
    && !flate.ringer.slice(1).some(hull => naerMedBoks.some(teig => polygonsIntersect(teig.polygon, { ringer: [hull] }, teig.bounds)))) {
    return "helt";
  }
  return naerMedBoks.some(teig => polygonsIntersect(teig.polygon, flate, teig.bounds, flateBounds)) ? "delvis" : null;
}

/**
 * Flatene som faktisk berører eiendommen, og hvor mange som ble utelatt.
 *
 * Tallet følger med ut fordi en utelatt flate ellers forsvinner uten spor: en
 * sonekode kodeverket ikke kjenner, eller en sone uten navn, kan ikke navngis i
 * klarspråk - men innbyggeren skal få vite at noe er utelatt, og `uavklarteForhold`
 * er stedet det står.
 */
function byggPlanflater(
  flater: Planflatetreff[], kategori: TiltakshjelpenPlanflate["kategori"], parcels: TiltakshjelpenPolygon[], bounds: Kartutsnitt
): { flater: TiltakshjelpenPlanflate[]; utelatt: number } {
  let utelatteSoner = 0;
  const treff: TiltakshjelpenPlanflate[] = [];
  // Teigomslutningene er de samme for hver flate. Sto de inne i `beroring`, ble
  // hver teigring gjennomgått én gang per planflate i stedet for én gang.
  const teiger = parcels.map(polygon => ({ polygon, bounds: ringerBounds(polygon.ringer) }));
  for (const e of flater) {
    const ringer = e.ringer;
    // Omslutningen regnes én gang. `beroring` trenger den for å finne de teigene
    // som er i nærheten, og `klippTilUtsnitt` gjennomgår de samme ringene rett
    // etter. På en LNF-flate er det nitten tusen punkter per gjennomgang.
    const omsluttende = ringerBounds(ringer);
    const berorer = beroring({ ringer }, teiger, omsluttende);
    if (!berorer) continue;
    // Klippes først her: avgjørelsen over er tatt på hele flaten, og det som
    // sendes videre er bare det kartet skal tegne.
    // Hensynstypen leses av kartlaget og ikke av sonekoden. Kommunen publiserer
    // étt barnelag per hensynstype, mens koden er en verdi kilden fyller inn -
    // så leste sperren under laget og flaten under koden, ville en faresone med
    // en kode kodeverket typer som angitt hensyn blitt levert regelen som ufarlig.
    const hensynstype = DATASETTHENSYN[e.datasett];
    // En flate kodeverket ikke kan navngi hoppes over, og telles. Det gjelder tre
    // ting: ingen sonekode, en kode kodeverket ikke kjenner, og et manglende navn.
    //
    // Med ett unntak, og det er hele forskjellen mellom en telling og en sperre.
    // Kommer flaten fra et datasett som kan holde tilbake fritaket, er det ikke
    // nok å telle den: `vurderMeldeplikt` leser `soneHindrerFritak` over de
    // flatene som kom gjennom, så en utelatt faresone ville gitt «du trenger ikke
    // søke» på en eiendom med fare. Den live kilden gjør tilfellet virkelig: den
    // navngir koder uttrekket aldri hadde. Da feiler kilden i stedet, og manglende
    // kunnskap blir et «må avklares» - aldri et fritak.
    const utelat = () => {
      if (hensynstype !== null && soneHindrerFritak(hensynstype)) {
        fail(`Plankilden svarte med en flate i datasettet ${e.datasett} som sandkassens kodeverk ikke kan navngi. `
          + "Sonen kan gjelde eiendommen, og den kan ikke utelates i stillhet.");
      }
      utelatteSoner += 1;
    };
    const sonekode = e.sonekode;
    if (sonekode === null) {
      utelat();
      continue;
    }
    const felles = { datasett: e.datasett, sonekode, kildetekst: e.beskrivelse, berorer, planId: e.planId,
      ringer: klippTilUtsnitt(ringer, bounds) };
    if (kategori === "hensynssone") {
      const sone = findHensynssone(sonekode);
      if (!sone || e.sonenavn === null) {
        utelat();
        continue;
      }
      // Et datasett uten hensynstype er arealformålet, og det havner aldri her.
      if (hensynstype === null) fail(`Plankilden svarte med en hensynssone i datasettet ${e.datasett}.`);
      treff.push({ ...felles, kategori, sonenavn: e.sonenavn, hensynstype, navn: sone.navn, beskrivelse: sone.beskrivelse });
      continue;
    }
    // Navnet kommer fra det kontrollerte soneregisteret og ikke fra kildens egen
    // BESKRIVELSE. Ellers svarer den samme TiltakshjelpenGrunnlag på det samme
    // spørsmålet to ganger, én gang kontrollert og én gang fra fritekst.
    const sone = e.arealstatus === null ? undefined
      : findArealsone(sonekode, e.arealstatus, e.planId, e.kommunenummer);
    treff.push({
      ...felles, kategori, arealstatus: e.arealstatus ?? 0,
      navn: sone?.navn ?? `Arealformål ${sonekode}`,
      beskrivelse: "Arealformålet sier hva området er satt av til. Hva som er tillatt, står i planbestemmelsene.",
    });
  }
  // Fast rekkefølge, så to like oppslag gir samme svar og samme tegnerekkefølge.
  treff.sort((a, b) => a.datasett.localeCompare(b.datasett) || a.sonekode - b.sonekode
    || (a.kategori === "hensynssone" ? a.sonenavn : "").localeCompare(b.kategori === "hensynssone" ? b.sonenavn : ""));
  return { flater: treff, utelatt: utelatteSoner };
}

async function getNabotomter(
  adresse: TiltakshjelpenAdresse, parcels: TiltakshjelpenPolygon[], paaKilde?: Kildehendelse
): Promise<TiltakshjelpenNabotomter> {
  const kilde: TiltakshjelpenKilde = {
    id: "nabotomter", navn: "Kartverkets åpne eiendoms-API, områder nær punkt",
    url: testUrl("GARASJE_NABOTOMTER_URL", NABOTOMTER_URL),
    status: "ikke_sjekket", hentet: new Date().toISOString(),
  };
  // Nabokartet står utenfor `load` fordi det ikke er en kilde vilkårene hviler på,
  // men innbyggeren venter like fullt på det: det ligger i samme `Promise.all`.
  // Meldte det ingenting, sto det «Alle kildene har svart» mens forespørselen
  // fortsatt hang på Kartverkets områdesøk - nettopp den feilen de gjettede
  // ventetekstene ble fjernet for.
  const meld = () => paaKilde?.(kilde);
  paaKilde?.({ ...kilde, status: "henter" });
  const result: TiltakshjelpenNabotomter = { tomter: [], kilde };
  if (!parcels.length) {
    kilde.merknad = "Tomter i nærheten er ikke hentet fordi grensene til den valgte eiendommen mangler.";
    meld();
    return result;
  }
  const envelope = getGeometriBounds({ type: "MultiPolygon", coordinates: parcels.map(p => p.ringer) });
  const lat = (envelope.sor + envelope.nord) / 2, lon = (envelope.vest + envelope.ost) / 2;
  const latitudeMargin = 15 / 111320, longitudeMargin = latitudeMargin / Math.cos(lat * Math.PI / 180);
  const bounds = { vest: envelope.vest - longitudeMargin, sor: envelope.sor - latitudeMargin,
    ost: envelope.ost + longitudeMargin, nord: envelope.nord + latitudeMargin };
  if (!isBoundedKartutsnitt(bounds, NABOTEIG_MAKS_SIDE_METER)) {
    kilde.merknad = "Eiendommens teiger dekker et større kartutsnitt enn 500 meter. Nabokartet er ikke hentet.";
    meld();
    return result;
  }
  // Nabokartet er bare kontekst. Kilden holdes utenfor vilkårsgrunnlagets kildeliste.
  const select = (geojson: TiltakshjelpenEiendomsGeoJson): TiltakshjelpenPolygon[] => {
    const features = geojson.features.filter(({ properties: p, geometry }) =>
      !(p.gardsnummer === adresse.gardsnummer && p.bruksnummer === adresse.bruksnummer && p.festenummer === adresse.festenummer)
      && intersectsKartutsnitt(getGeometriBounds(geometry), bounds));
    const tomter = parcelPolygons({ ...geojson, features });
    if (tomter.length > NABOTEIG_MAX_TREFF) fail("Nabokartet har over 200 polygoner. Ingen avkortet liste vises.");
    return tomter;
  };
  try {
    const url = new URL(testUrl("GARASJE_NABOTOMTER_URL", NABOTOMTER_URL));
    const width = (bounds.ost - bounds.vest) * 111700 * Math.cos(lat * Math.PI / 180);
    const height = (bounds.nord - bounds.sor) * 111700;
    const radius = Math.ceil(Math.hypot(width, height) / 2) + 1;
    url.search = new URLSearchParams({ ost: String(lon), nord: String(lat), koordsys: "4258", utkoordsys: "4258",
      radius: String(radius), maksTreff: String(NABOTEIG_MAX_TREFF + 1) }).toString();
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
    kilde.merknad = `Kartverket er spurt innen ${radius} meter rundt utsnittets midtpunkt. `
      + "Bare teiger i samme kommune som berører utsnittet vises. "
      + "Dette er ikke en komplett oversikt over grensenaboer. Teigens kvalitetsklasse er ikke kvalitetsdata for hver grense. "
      + "Manglende kvalitet er ukjent. Eieropplysninger, planer og byggetillatelser er ikke hentet for nabotomtene.";
    kilde.status = result.tomter.length ? "ok" : "ingen_treff";
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    result.tomter = [];
    kilde.status = "feil";
    kilde.merknad = `${error.message} Nabokartet er uavklart og påvirker ikke søknadssjekken.`;
  } finally {
    kilde.hentet = new Date().toISOString();
    meld();
  }
  return result;
}

/**
 * Får beskjed hver gang en kilde skifter tilstand.
 *
 * Kalles én gang når oppslaget settes i gang, og én gang når det er ferdig. Uten
 * den ser innbyggeren bare at noe tar tid; med den ser hun hvilken kilde det er,
 * og hvem som allerede har svart. Kildene hentes i parallell, så rekkefølgen
 * hendelsene kommer i er den rekkefølgen kildene faktisk svarer i - og det er
 * nettopp det en gjettet ventetekst ikke kan vise.
 */
export type Kildehendelse = (kilde: TiltakshjelpenKilde) => void;

export async function getTiltakshjelpenGrunnlag(
  adresse: TiltakshjelpenAdresse, plassering?: TiltakshjelpenPunkt, paaKilde?: Kildehendelse
): Promise<TiltakshjelpenGrunnlag> {
  // The route resolves this candidate afresh through searchTiltakshjelpenAdresser.
  // Never accept source contents or plan statuses from the request body.
  const a = record(adresse);
  if (!isKommunenummer(a.kommunenummer)) throw new HttpError("Kommunenummer må være fire sifre og kan ikke være 0000.", 400);
  const kommune = findTiltakshjelpenKommunekilder(a.kommunenummer);
  text(a.adressetekst);
  integer(a.gardsnummer, 1); integer(a.bruksnummer); integer(a.festenummer); integer(a.undernummer);
  const adressePunkt = validateTiltakshjelpenPunkt(a.punkt);
  const p = plassering === undefined ? adressePunkt : validateTiltakshjelpenPunkt(plassering);
  if (Math.abs(p.lat - adressePunkt.lat) > 0.005 || Math.abs(p.lon - adressePunkt.lon) > 0.01) {
    throw new HttpError("Velg en plassering i nærheten av den valgte adressen.", 400);
  }
  const kilder: TiltakshjelpenKilde[] = [{
    id: "adresse", navn: "Kartverkets adresse-API", url: adresseQuery(adresse.adressetekst, adresse.kommunenummer).href,
    hentet: new Date().toISOString(), status: "ok", merknad: "Offentlig adressepunkt, ikke dokumentasjon på eierskap.",
  }];
  paaKilde?.(kilder[0]!);
  // Eiendomsgrensene er nasjonale: Kartverket svarer for hele landet, uansett om
  // kommunen har et kartoppsett her. Derfor står de utenfor sjekken under, der de
  // kommunale lagene stopper for en kommune uten adapter. Planflatene er
  // kommunale og går gjennom den vanlige veien.
  async function load<T>(id: SourceId, read: (kilde: TiltakshjelpenKilde) => Promise<T[]>): Promise<T[]> {
    const { lag, navn } = KILDER[id];
    const kilde: TiltakshjelpenKilde = {
      id,
      navn: lag === null ? navn
        : kommune?.[lag].navn ?? `${navn} for kommunenummer ${adresse.kommunenummer}`,
      url: lag === null ? eiendomQuery(adresse).href : officialLayerUrl(lag, kommune),
      hentet: new Date().toISOString(), status: "ikke_sjekket",
    };
    kilder.push(kilde);
    // «henter» finnes bare her, mens oppslaget pågår. Et lagret grunnlag har
    // aldri den verdien - da er hver kilde ferdig med ett av de fire andre.
    paaKilde?.({ ...kilde, status: "henter" });
    // Tabellen svarer allerede på hva kilden er: `lag === null` er dens egen måte
    // å si «nasjonal kilde, ikke noe kommunalt lag» på. Sto id-en her i stedet,
    // ville en andre nasjonal kilde arvet den kommunale tidligreturen i stillhet.
    if (lag !== null && !kommune) {
      kilde.merknad = `Ingen kommunal datakilde er konfigurert for kommunenummer ${adresse.kommunenummer}. Ingen oppslag er sendt til en annen kommunes kart.`;
      paaKilde?.(kilde);
      return [];
    }
    try {
      const rows = await read(kilde);
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
      paaKilde?.(kilde);
    }
  }
  // Ett utsnitt for begge de to kildene som trenger det, og det brukes til begge
  // ting: det oppslaget ber om, og det flatene sammenlignes mot. `buildingEnvelope`
  // går gjennom hver ring i hver teig, så to kall var to gjennomganger av det
  // samme - og bygningslaget og planflatene regnet hver sin.
  let eiendomsgeojson: TiltakshjelpenEiendomsGeoJson | undefined;
  let buildingRows: { polygon: TiltakshjelpenPolygon; attributes: TiltakshjelpenEksisterendeBygning }[] = [];
  // Teiggeometrien kommer fra Kartverket, og bare derfra.
  //
  // Den lå tidligere i et 92 MB uttrekk over Bergen, med Kartverket som reserve
  // når uttrekket bommet. Reserven er nå hovedveien, og tre ting følger av det:
  // den dekker hele landet og ikke én kommune, den er fersk framfor frosset i
  // 2025, og den svarer på grensekvalitet, tvist og oppdateringsdato - felter
  // uttrekket aldri hadde og som derfor alltid sto som ukjent.
  const eiendomPromise = load<TiltakshjelpenPolygon>("eiendomsgrenser", async kilde => {
    kilde.koordinatsystem = "EPSG:4258";
    kilde.merknad = "Offentlige teigdata fra Kartverkets åpne eiendoms-API, hentet ved oppslag. "
      + "Ikke syntetisk geometri.";
    eiendomsgeojson = parseEiendomsGeoJson(await readJson(eiendomQuery(adresse), "Kartverkets eiendoms-API"), adresse);
    return parcelPolygons(eiendomsgeojson);
  });
  const utsnittPromise = eiendomPromise.then(parcels => buildingEnvelope(parcels, p));
  let utelatteSoner = 0;
  const [arealformaal, reguleringsplaner, eiendomsgrenser, bygninger, nabotomter, planflater] = await Promise.all([
    load<TiltakshjelpenArealformaal>("kpa", async () => (await queryLayer("kpa", kommune, { punkt: p })).map(feature => {
      const attrs = record(feature.attributes);
      const formaal: TiltakshjelpenArealformaal = {
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
    load<TiltakshjelpenPlan>("reguleringsplan", async () => (await queryLayer("reguleringsplan", kommune, { punkt: p })).map(feature => {
      const attrs = record(feature.attributes), id = planId(attrs.PLANID);
      const url = new URL(kommune!.reguleringsplan.planportalUrl);
      url.search = new URLSearchParams({ funksjon: "VisPlan", planidentifikasjon: id, kommunenummer: adresse.kommunenummer }).toString();
      return {
        planId: id, navn: text(attrs.PLANNAVN),
        url: url.href,
      };
    })),
    eiendomPromise,
    load<TiltakshjelpenPolygon>("bygninger", async () => {
      const features = await queryLayer("bygninger", kommune, { utsnitt: await utsnittPromise });
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
    eiendomPromise.then(parcels => getNabotomter(adresse, parcels, paaKilde)),
    load<TiltakshjelpenPlanflate>("planflater", async kilde => {
      const parcels = await eiendomPromise;
      if (!parcels.length) fail("Eiendomsgrensene mangler, så planflatene kan ikke sammenlignes med eiendommen.");
      const utsnitt = await utsnittPromise;
      const bounds = tilKartutsnitt(utsnitt);
      // `load` har allerede svart for en kommune uten kartoppsett, og gjort det
      // før noe nettverk ble rørt. Linjen er innsnevringen TypeScript trenger, og
      // ikke en gren som kan nås.
      if (!kommune) return [];
      kilde.koordinatsystem = "EPSG:4258";
      const { soner, formaal } = await hentPlanflater(kommune, utsnitt);
      kilde.merknad = "Hentet fra kommunens egne kartlag ved oppslag. Om sonen dekker eiendommen helt eller "
        + "delvis er avgjort på hele flaten, men flatene som tegnes er klippet til kartutsnittet - kantene "
        + "langs utsnittet er derfor ikke sonegrenser, og ingen avstand skal måles mot dem. Grensene er "
        + "dessuten forenklet til om lag 2 meter. Sonen sier at et hensyn gjelder, ikke hva som er tillatt; "
        + "det står i planbestemmelsene, som piloten ikke leser.";
      const hensynssoner = byggPlanflater(soner, "hensynssone", parcels, bounds);
      const arealformaal = byggPlanflater(formaal, "arealformaal", parcels, bounds);
      utelatteSoner = hensynssoner.utelatt + arealformaal.utelatt;
      return [...hensynssoner.flater, ...arealformaal.flater];
    }),
  ]);
  const bebyggelse = buildBebyggelse(eiendomsgrenser, eiendomsgeojson, buildingRows, kilder, kommune);
  const arealberegning = buildArealberegning(adresse, eiendomsgrenser, bygninger, eiendomsgeojson, kilder, kommune);
  return {
    adresse, punkt: p, arealformaal, reguleringsplaner, eiendomsgrenser, bygninger, planflater, bebyggelse, arealberegning, kilder, nabotomter,
    ...(eiendomsgeojson ? { eiendomsgeojson } : {}),
    uavklarteForhold: [
      ...(kommune ? [
        "Planbestemmelser er ikke maskinelt kontrollert. Planoppslaget dekker bare planområder på grunnen, ikke alle plannivåer.",
        "Kommuneplanoppslaget gjelder ett punkt. Hensynssonene er sammenlignet med hele den kartlagte eiendommen, men byggegrenser og andre formål er ikke kontrollert for tiltakets utstrekning.",
        "Bygningskartet viser også nabobygninger. Bare geometriske treff på valgt teig inngår i bebyggelsesgrunnlaget. Registerkobling til matrikkelenheten og lovlighet er ikke bekreftet.",
      ] : [
        `Kommunale plan- og bygningskilder er ikke konfigurert for kommunenummer ${adresse.kommunenummer}. Nasjonale eiendomsdata er tilgjengelige, men sier ikke hva som er tillatt å bygge.`,
      ]),
      "Registrert bruksareal (BRA) er ikke bebygd areal (BYA). Kartlagt flatedekning er bare et geometrisk anslag, ikke planens utnyttelsesgrad.",
      ...(bebyggelse.status === "uavklart" ? [bebyggelse.forklaring] : []),
      "Eiendomsgrenser kan være usikre. Avstander og lovlig arealutnyttelse er ikke bekreftet fra kartet.",
      ...arealberegning.forbehold,
      ...(utelatteSoner ? [`${utelatteSoner} planflate(r) i kartutsnittet mangler sonekode eller navn sandkassens kodeverk kjenner, og er utelatt. Planbestemmelsene må leses.`] : []),
      ...arealformaal.filter(f => f.sonetype === "ukjent").map(() => "Sonetypen er ikke støttet eller bekreftet for denne planen. Tegnforklaringen må kunne leses og stemme med soneregisteret. Arealformålskoden alene er ikke nok til å velge sone; kildens råverdier og beskrivelse er bevart."),
      ...eiendomsgrenser.filter(teig => teig.kvalitetsklasse !== "Grønt").map(teig =>
        `Teig ${teig.teigId ?? teig.id}: Kildens kvalitetsklasse er ${teig.kvalitetsklasse ?? "ikke oppgitt"}. Grensen må avklares før den brukes til plassering.`),
      ...(eiendomsgeojson?.features.filter(f => f.properties.teigmedflerematrikkelenheter || f.properties.uregistrertjordsameie)
        .map(f => `Teig ${f.properties.lokalid} er knyttet til flere matrikkelenheter eller et uregistrert jordsameie. Innvendige grenser er ikke avklart.`) ?? []),
      // `kildeSvarte` og ikke en egen `ingen_treff`-sjekk her: hvor et tomt svar
      // er et svar står i `VILKAARSKILDER`, hos regelen som avgjør på det.
      ...kilder.filter(k => !kildeSvarte(k)).map(k => `${k.navn}: ${k.merknad ?? "Datagrunnlaget mangler."}`),
    ],
  };
}
