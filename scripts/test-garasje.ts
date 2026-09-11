#!/usr/bin/env node
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import type { GarasjeAdresse, GarasjeGrunnlag, GarasjePolygon, GarasjeTiltak } from "../apps/shared/garasje.ts";
import { AREALSONER, classifyArealsone, KPA2018_SONEKILDE, listGarasjeSonetyper } from "../apps/shared/arealsoner.ts";
import { findGarasjeKommune, findGarasjeKommunekilder, GARASJE_KOMMUNER, getGarasjeKartlagUrl } from "../apps/shared/garasje-kommuner.ts";
import { calculateGarasjeAreal, getGarasjeGrunnlag, searchGarasjeAdresser } from "../apps/sandbox-backend/src/garasje-data.ts";
import { evaluateGarasje, GARASJE_KPA_URL, validateGarasjePunkt, validateGarasjeTiltak } from "../apps/sandbox-backend/src/garasje.ts";
import { HttpError } from "../apps/sandbox-backend/src/errors.ts";
import { createTeigStore, parseNaboteigQuery, parseTeigQuery } from "../apps/matrikkel-mock/src/teiger.ts";
import { parsePlanQuery } from "../apps/plan-mock/src/planlag.ts";
import { findHensynssone } from "../apps/shared/hensynssoner.ts";
import { findArealsone } from "../apps/shared/arealsoner.ts";
import { fitKartutsnitt } from "../apps/demo-gui/src/client/garasje-kart.ts";
import { readGarasjeGrunnlag } from "../apps/sandbox-backend/src/garasje-oppslag.ts";
import { validateGarasjeRaad } from "../apps/ai-gateway/src/garasje-raad.ts";

const milde: GarasjeAdresse = {
  adressetekst: "Litle Milde 65", kommunenummer: "4601", kommunenavn: "BERGEN", gardsnummer: 105, bruksnummer: 209,
  festenummer: 0, undernummer: 0, punkt: { lat: 60.2536577976675, lon: 5.255241147052527 },
};
const krakenes: GarasjeAdresse = {
  adressetekst: "Kråkenestoppen 60", kommunenummer: "4601", kommunenavn: "BERGEN", gardsnummer: 20, bruksnummer: 1413,
  festenummer: 0, undernummer: 0, punkt: { lat: 60.33304009061054, lon: 5.315468234797857 },
};
const oslo: GarasjeAdresse = {
  adressetekst: "Rådhusplassen 1", kommunenummer: "0301", kommunenavn: "OSLO", gardsnummer: 209, bruksnummer: 339,
  festenummer: 0, undernummer: 0, punkt: { lat: 59.91174989125625, lon: 10.733452414128745 },
};
const tiltak: GarasjeTiltak = {
  bra: 50, bya: 50, monehoyde: 4, gesimshoyde: 3, etasjer: 1,
  frittliggende: true, beboelse: false, kjeller: false, bebygdEiendom: true,
  avstandNabogrense: 1, avstandBygning: 1, overVannAvlop: false,
};
let count = 0;
async function test(navn: string, check: () => unknown | Promise<unknown>): Promise<void> {
  try { await check(); count++; } catch (error) { console.error(`FEIL: ${navn}`); throw error; }
}
const errorStatus = (status: number) => (error: unknown) => error instanceof HttpError && error.status === status;

function addressResponse(adresse: GarasjeAdresse) {
  return {
    metadata: { totaltAntallTreff: 1, treffPerSide: 20, side: 0 },
    adresser: [{
      ...adresse, undernummer: null, adressekode: 33832, bruksenhetsnummer: [],
      representasjonspunkt: { ...adresse.punkt, epsg: "EPSG:4258" }, kommunenavn: adresse.kommunenummer === "0301" ? "OSLO" : "BERGEN",
    }],
  };
}
// Actual Kartverket parcel GeoJSON and Bergen building geometry. These test
// fixtures never become runtime data or a fallback.
const parcelRings = [[
  [5.2555238, 60.2536782], [5.255341, 60.2535286], [5.2550217, 60.253501],
  [5.2548037, 60.2536077], [5.2552815, 60.2538992], [5.2555238, 60.2536782],
]];
const buildingRings = [[
  [5.2551895852321895, 60.253817688087025], [5.255188296331635, 60.253832123445896],
  [5.255261892804862, 60.253833842427404], [5.255263361956112, 60.253819412159075],
  [5.2551895852321895, 60.253817688087025],
]];
// Public Bygning_Flate/MapServer/0 features verified on 2026-09-10.
const mildeHouse = {
  attributes: { OBJECTID: 52224, OBJTYPE: "Bygning", BYGGNR: 139536843, BYGGTYP_NBR: 111, BYGGSTAT: "TB", BYGGTYPE: "Enebolig", STATUS: "Tatt i bruk", BRUKSAREAL: 63 },
  geometry: { rings: [[
    [5.2552307534135947, 60.253699660995252], [5.2552633084030482, 60.253718647646309],
    [5.2553579655140332, 60.253678534847822], [5.2553254105078562, 60.253659548219751],
    [5.2552940560448755, 60.253641134808724], [5.2552697300752831, 60.253651413975362],
    [5.2552134416850569, 60.253618543691012], [5.2551800011461722, 60.25363261032556],
    [5.2551473021971322, 60.253646518123432], [5.2552020602322962, 60.25367853623473],
    [5.2551976883502283, 60.253680390269494], [5.2552307534135947, 60.253699660995252],
  ]] },
};
const krakenesHouse = {
  attributes: { OBJECTID: 98669, OBJTYPE: "Bygning", BYGGNR: 9521836, BYGGTYP_NBR: 121, BYGGSTAT: "TB", BYGGTYPE: "Tomannsbolig, vertikaldelt", STATUS: "Tatt i bruk", BRUKSAREAL: 138 },
  geometry: { rings: [[
    [5.3154071692780382, 60.333073540811519], [5.3155348808601612, 60.333096947787801],
    [5.3155634878677889, 60.333058732158463], [5.3155914211487252, 60.333021666313115],
    [5.3155187759773046, 60.333008325856873], [5.3155222542228113, 60.333003209134617],
    [5.3154680917284232, 60.332993167740931], [5.3154361277637143, 60.333035424840581],
    [5.3154071692780382, 60.333073540811519],
  ]] },
};
const krakenesNeighbour = {
  attributes: { OBJECTID: 71816, OBJTYPE: "Bygning", BYGGNR: 9515771, BYGGTYP_NBR: 131, BYGGSTAT: "TB", BYGGTYPE: "Rekkehus", STATUS: "Tatt i bruk", BRUKSAREAL: 138 },
  geometry: { rings: [[
    [5.3148819021546361, 60.333094831397027], [5.3150045238974961, 60.333116749424704],
    [5.3150335044388299, 60.333076836484672], [5.3150624849077692, 60.333036923537506],
    [5.3149396826900404, 60.33301500055105], [5.3149107020924138, 60.333054913470356],
    [5.3148819021546361, 60.333094831397027],
  ]] },
};
const krakenesParcelRings = [[
  [5.3149147, 60.3329171], [5.3149806, 60.3329591], [5.3150065, 60.3329755],
  [5.3151249, 60.3330337], [5.3151306, 60.3330499], [5.3151202, 60.3330735],
  [5.3150811, 60.3331292], [5.3151869, 60.3331248], [5.3153162, 60.3331166],
  [5.3154537, 60.3331128], [5.3155593, 60.3331072], [5.3158003, 60.3331004],
  [5.3157884, 60.3330753], [5.3157645, 60.333038], [5.31571, 60.3329285],
  [5.3155577, 60.3329029], [5.3155316, 60.3328991], [5.3155153, 60.3329264],
  [5.3153506, 60.3329001], [5.3150119, 60.3328459], [5.3149806, 60.3328409],
  [5.3149663, 60.3328551], [5.3149065, 60.3329154], [5.3149147, 60.3329171],
]];
// Kartverket's actual native parcel for Rådhusplassen 1, Oslo, verified 2026-09-10.
const osloParcelRings = [[
  [10.734265, 59.9119989], [10.7342502, 59.9120024], [10.7338227, 59.9115418],
  [10.7337962, 59.9115132], [10.7321612, 59.9118947], [10.732454, 59.9125997],
  [10.7334816, 59.9125018], [10.7335447, 59.9124872], [10.733594, 59.9125407],
  [10.7337138, 59.9125129], [10.7340746, 59.9129021], [10.7342141, 59.9128908],
  [10.7346288, 59.9127933], [10.7347362, 59.9127475], [10.7343522, 59.9123356],
  [10.7344368, 59.912316], [10.7344086, 59.9122851], [10.7345061, 59.9122624],
  [10.734312, 59.9120526], [10.734314, 59.9120521], [10.734265, 59.9119989],
]];
function eiendomResponse(second: boolean) {
  const adresse = second ? krakenes : milde;
  return { type: "FeatureCollection", features: [{
    type: "Feature", geometry: { type: "Polygon", coordinates: structuredClone(second ? krakenesParcelRings : parcelRings) },
    properties: {
      kommunenummer: "4601", gardsnummer: adresse.gardsnummer, bruksnummer: adresse.bruksnummer,
      festenummer: 0, seksjonsnummer: 0, lokalid: second ? 258839374 : 259953783, objekttype: "Teig",
      matrikkelnummertekst: second ? "20/1413" : "105/209", "nøyaktighetsklasseteig": second ? "Gult" : "Grønt",
      oppdateringsdato: second ? "2020-06-16T06:59:59" : "2025-06-18T16:10:10", "hovedområde": true,
      teigmedflerematrikkelenheter: false, uregistrertjordsameie: false,
    },
  }] };
}
function osloEiendomResponse() {
  const response = eiendomResponse(false);
  response.features[0]!.geometry.coordinates = structuredClone(osloParcelRings);
  Object.assign(response.features[0]!.properties, {
    kommunenummer: "0301", gardsnummer: 209, bruksnummer: 339, lokalid: 291199441,
    matrikkelnummertekst: "209/339", oppdateringsdato: "2020-06-16T07:19:19",
  });
  return response;
}
const layerFields = {
  kpa: ["KPAREALFORMAL", "AREALST", "BESKRIVELSE", "PLANID"], plan: ["PLANID", "PLANNAVN"],
  eiendom: ["OBJECTID", "GNR", "BNR", "FNR"],
  bygning: ["OBJECTID", "OBJTYPE", "BYGGNR", "BYGGTYP_NBR", "BYGGSTAT", "BYGGTYPE", "STATUS", "BRUKSAREAL"],
};
const zoneLegend = [
  { value: "1130,2", label: "Sentrumskjerne", sonetype: "sentrumskjerne" },
  { value: "1130,1", label: "Byfortettingssone", sonetype: "byfortettingssone" },
  { value: "1001,2", label: "Ytre fortettingssone", sonetype: "ytre_fortettingssone" },
  { value: "1001,1", label: "Øvrig byggesone", sonetype: "ovrig_byggesone" },
  { value: "5100,1", label: "LNF", sonetype: "lnf" },
  { value: "3001,1", label: "Grønnstruktur", sonetype: "gronnstruktur" },
  { value: "3001,2", label: "Grønnstruktur, framtidig", sonetype: "gronnstruktur" },
];
type Source = keyof typeof layerFields | "adresse";
type Transform = (source: Source, query: boolean, body: any) => any;
let transform: Transform = (_source, _query, body) => body;
const urls: URL[] = [];
const fetchedMetadata = new Set<Source>();
// The envelope the building layer was last asked for, so a test can compare it
// with the extent the map actually draws.
let bygningsKonvolutt = "";
let lokaleTeiger: ((url: URL) => unknown) | null = null;
let lokalePlanflater: ((url: URL) => unknown) | null = null;
let lokaleNabotomter: ((url: URL) => unknown) | null = null;
let apiNabotomter: ((url: URL) => unknown) | null = null;
function localNeighbourResponse(url: URL) {
  const second = Number(url.searchParams.get("sor")) > 60.3;
  const a = second ? krakenes : milde;
  return {
    kommunenummer: url.searchParams.get("kommunenummer"), kildestatus: "tilgjengelig",
    kilde: { navn: "Lokalt teiguttrekk", fil: "matrikkel_bk_25.json", uttrekksaar: 2025, koordinatsystem: "EPSG:4326", syntetisk: false },
    type: "FeatureCollection", avkortet: false, features: [{
      type: "Feature", id: 987,
      geometry: eiendomResponse(second).features[0].geometry,
      properties: { OBJECTID: 987, OBJTYPE: "Teig", GNR: a.gardsnummer, BNR: a.bruksnummer + 1, FNR: 0, SNR: 0,
        AREAL: 900, AREALMERKNAD: null, TINGLYST: "Ja", ANTALL_GID: 1, Shape_Area: 900, Shape_Length: 120 },
    }],
  };
}

/**
 * Planmockens svar, klippet til utsnittet, med flatene rundt de to eiendommene.
 *
 * Flatene bygges av utsnittet forespørselen ba om, ikke av faste koordinater.
 * Det er det plan-mock faktisk gjør, og `planflateRinger` avviser nå et svar med
 * geometri utenfor utsnittet - en fixtur med faste bokser ville testet en kilde
 * ingen har.
 *
 * Litle Milde får en støysone som dekker hele utsnittet, og dermed hele teigen;
 * Kråkenes en faresone over den vestlige halvparten, som gir «delvis». Begge er
 * de faktiske treffene i KPA2018-uttrekket, valgt slik at «helt» og «delvis»
 * hver har en eiendom å oppstå på uten at fixturen finner på et forhold.
 */
function planResponse(url: URL, kategori: "hensynssone" | "arealformaal") {
  const second = Number(url.searchParams.get("sor")) > 60.3;
  const tall = (navn: string) => Number(url.searchParams.get(navn));
  const vest = tall("vest"), sor = tall("sor"), ost = tall("ost"), nord = tall("nord");
  const boks = (ostkant: number): number[][][] =>
    [[[vest, sor], [ostkant, sor], [ostkant, nord], [vest, nord], [vest, sor]]];
  const felles = { planId: "65270000", kommunenummer: "4601" };
  const flater = kategori === "hensynssone"
    ? second
      // Kråkenestoppen: faresonen dekker bare den vestlige halvparten av utsnittet.
      ? [{ id: 41, ringer: boks(vest + (ost - vest) / 2), p: { datasett: "fare", sonekode: 390, sonenavn: "H390_2", arealstatus: null, beskrivelse: "Akutt forurensning" } }]
      // Litle Milde: støysonen dekker hele utsnittet, og dermed hele teigen.
      : [{ id: 42, ringer: boks(ost), p: { datasett: "stoy", sonekode: 220, sonenavn: "H220_1", arealstatus: null, beskrivelse: "Sjøflyhavn - gul sone" } }]
    : [{ id: 43, ringer: boks(ost), p: { datasett: "arealformaal", sonekode: second ? 1001 : 5100, sonenavn: null, arealstatus: 1, beskrivelse: second ? "Øvrig byggesone" : "LNF" } }];
  return {
    kommunenummer: url.searchParams.get("kommunenummer"), kildestatus: "tilgjengelig",
    kilde: {
      navn: "Bergen kommuneplanens arealdel 2018 (KPA2018)", planId: "65270000", versjon: "KPA2018",
      filer: ["KpStøySone_gul_2018.geojson"], uttrekksaar: 2018, koordinatsystem: "EPSG:4326", syntetisk: false,
    },
    type: "FeatureCollection", klippetTilUtsnitt: true,
    features: flater.map(flate => ({
      type: "Feature", id: flate.id,
      geometry: { type: "Polygon", coordinates: flate.ringer },
      properties: { ...felles, ...flate.p },
    })),
  };
}

const fakeFetch: typeof fetch = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  urls.push(url);
  assert(options?.signal, "Alle oppslag må ha tidsgrense");
  assert.equal(options?.redirect, "error");
  assert.equal(options?.body, undefined);
  assert.equal(new Headers(options?.headers).get("Authorization"), null);
  if (url.pathname === "/mock/matrikkel/naboteiger") {
    parseNaboteigQuery(url.searchParams);
    const result = lokaleNabotomter ? await lokaleNabotomter(url) : url.searchParams.get("kommunenummer") === "4601"
      ? localNeighbourResponse(url) : { ...localNeighbourResponse(url), kildestatus: "ikke_dekket", features: [] };
    return result instanceof Response ? result : Response.json(result);
  }
  if (url.pathname.startsWith("/mock/plan/")) {
    parsePlanQuery(url.searchParams);
    const kategori = url.pathname === "/mock/plan/hensynssoner" ? "hensynssone" as const : "arealformaal" as const;
    if (lokalePlanflater) {
      const overstyrt = await lokalePlanflater(url);
      return overstyrt instanceof Response ? overstyrt : Response.json(overstyrt);
    }
    const svar = planResponse(url, kategori);
    return Response.json(url.searchParams.get("kommunenummer") === "4601" ? svar
      : { ...svar, kildestatus: "ikke_dekket", kilde: { ...svar.kilde, planId: null, versjon: null, uttrekksaar: null }, features: [] });
  }
  if (url.pathname === "/mock/matrikkel/teiger") {
    assert.equal(url.searchParams.get("fnr"), "0");
    assert(!url.searchParams.has("personId"));
    if (lokaleTeiger) {
      const result = await lokaleTeiger(url);
      return result instanceof Response ? result : Response.json(result);
    }
    return Response.json({
      kommunenummer: url.searchParams.get("kommunenummer"), kildestatus: "ikke_dekket",
      kilde: { navn: "Lokalt teiguttrekk", fil: null, uttrekksaar: null, koordinatsystem: "EPSG:4326", syntetisk: false },
      type: "FeatureCollection", features: []
    });
  }
  assert(!url.search.includes("personId") && !url.search.includes("fnr="));
  assert(["ws.geonorge.no", "api.kartverket.no", "kart.bergen.kommune.no"].includes(url.hostname));
  if (url.pathname === "/eiendom/v1/punkt/omrader") {
    assert.equal(url.searchParams.get("koordsys"), "4258");
    assert.equal(url.searchParams.get("utkoordsys"), "4258");
    assert.equal(url.searchParams.get("maksTreff"), "201");
    assert(Number(url.searchParams.get("radius")) > 0 && Number(url.searchParams.get("radius")) <= 355);
    const result = apiNabotomter ? await apiNabotomter(url) : { type: "FeatureCollection", features: [] };
    return result instanceof Response ? result : Response.json(result);
  }
  const source: Source = url.hostname === "api.kartverket.no" ? "eiendom" : url.hostname === "ws.geonorge.no" ? "adresse"
    : decodeURIComponent(url.pathname).includes("Arealformål") ? "kpa"
      : decodeURIComponent(url.pathname).includes("Reguleringsplaner") ? "plan"
        : url.pathname.includes("Eiendommer") ? "eiendom" : "bygning";
  const query = url.hostname === "api.kartverket.no" || url.pathname.endsWith("/query");
  let body: unknown;
  if (source === "adresse") {
    assert([null, "4601", "0301"].includes(url.searchParams.get("kommunenummer")));
    body = addressResponse(url.searchParams.get("sok")?.includes("Rådhusplassen") ? oslo
      : url.searchParams.get("sok")?.includes("Kråkenes") ? krakenes : milde);
  } else if (source === "eiendom") {
    assert.equal(url.hostname, "api.kartverket.no");
    assert.equal(url.pathname, "/eiendom/v1/geokoding");
    assert.equal(url.searchParams.get("omrade"), "true");
    assert.equal(url.searchParams.get("utkoordsys"), "4258");
    assert(["4601-105/209", "4601-20/1413", "0301-209/339"].includes(url.searchParams.get("matrikkelnummer")!));
    body = url.searchParams.get("matrikkelnummer") === "0301-209/339" ? osloEiendomResponse()
      : eiendomResponse(url.searchParams.get("matrikkelnummer") === "4601-20/1413");
  } else if (!query) {
    fetchedMetadata.add(source);
    body = {
      geometryType: "esriGeometryPolygon", capabilities: "Query,Map,Data", fields: layerFields[source].map(name => ({ name })),
      ...(source === "kpa" ? { drawingInfo: { renderer: {
        type: "uniqueValue", field1: "KPAREALFORMAL", field2: "AREALST", fieldDelimiter: ",",
        uniqueValueInfos: zoneLegend.map(({ value, label }) => ({ value, label })),
      } } } : {}),
    };
  } else {
    assert(fetchedMetadata.has(source), "Metadata må kontrolleres før kartoppslaget");
    if (source === "bygning") bygningsKonvolutt = url.searchParams.get("geometry")!;
    assert.equal(url.searchParams.get("inSR"), "4258");
    assert.equal(url.searchParams.get("outSR"), "4258");
    assert.notEqual(url.searchParams.get("outFields"), "*");
    const second = Number(url.searchParams.get("geometry")!.split(",")[1]) > 60.3;
    body = {
      geometryType: "esriGeometryPolygon", spatialReference: { wkid: 4258, latestWkid: 4258 },
      features: source === "kpa" ? [{
        attributes: { KPAREALFORMAL: second ? 1001 : 5100, AREALST: 1, BESKRIVELSE: second ? "Øvrig byggesone" : "LNF", PLANID: "65270000" },
      }] : source === "plan" ? second ? [{
        attributes: {
          PLANID: "6170063", PLANNAVN: "FYLLINGSDALEN. BØNES ØST, FELT 19A, PLAN FOR BEBYGGELSE",
          URL: "https://example.invalid/do-not-follow",
        },
      }] : [] : second ? structuredClone([krakenesHouse, krakenesNeighbour]) : [{
        attributes: { OBJECTID: 14583, OBJTYPE: "AnnenBygning", BYGGNR: null, BYGGTYP_NBR: null, BYGGSTAT: null, BRUKSAREAL: null, OFFENTLIG_EIER: "Skal ikke følge svaret" },
        geometry: { rings: buildingRings },
      }, structuredClone(mildeHouse)],
    };
  }
  const result = transform(source, query, body);
  return result instanceof Response ? result : Response.json(result);
};
const originalFetch = globalThis.fetch;
const originalEnv = {
  NODE_ENV: process.env.NODE_ENV, GARASJE_TIMEOUT_MS: process.env.GARASJE_TIMEOUT_MS,
  GARASJE_ADRESSE_URL: process.env.GARASJE_ADRESSE_URL, GARASJE_KART_BASE_URL: process.env.GARASJE_KART_BASE_URL,
  GARASJE_EIENDOM_URL: process.env.GARASJE_EIENDOM_URL,
  GARASJE_NABOTOMTER_URL: process.env.GARASJE_NABOTOMTER_URL,
};
globalThis.fetch = fakeFetch;
delete process.env.GARASJE_ADRESSE_URL;
delete process.env.GARASJE_KART_BASE_URL;
delete process.env.GARASJE_EIENDOM_URL;
delete process.env.GARASJE_NABOTOMTER_URL;
delete process.env.GARASJE_TIMEOUT_MS;
try {
  await test("Adressekandidater bruker faktiske feltnavn og normaliserer null undernummer", async () => {
    assert.deepEqual(await searchGarasjeAdresser("Litle Milde 65"), [milde]);
    assert.deepEqual(await searchGarasjeAdresser("Kråkenestoppen 60"), [krakenes]);
  });
  await test("Adressesøk er nasjonalt uten skjult Bergen-filter", async () => {
    urls.length = 0;
    assert.deepEqual(await searchGarasjeAdresser("Rådhusplassen 1"), [oslo]);
    assert.equal(urls[0]!.searchParams.has("kommunenummer"), false);
    assert.deepEqual(await searchGarasjeAdresser("Litle Milde 65"), [milde]);
    assert.equal(urls[1]!.searchParams.has("kommunenummer"), false);
  });
  await test("Et eksplisitt kommunefilter sendes uendret til den nasjonale kilden", async () => {
    urls.length = 0;
    assert.deepEqual(await searchGarasjeAdresser("Rådhusplassen 1", "0301"), [oslo]);
    assert.equal(urls[0]!.searchParams.get("kommunenummer"), "0301");
    assert.deepEqual(await searchGarasjeAdresser("Litle Milde 65", "4601"), [milde]);
    assert.equal(urls[1]!.searchParams.get("kommunenummer"), "4601");
    await assert.rejects(searchGarasjeAdresser("Rådhusplassen 1", "4601"), errorStatus(502));
  });
  await test("Et nasjonalt søk kan returnere adresser fra flere kommuner", async () => {
    transform = (source, _query, body) => source === "adresse" ? {
      metadata: { totaltAntallTreff: 2 },
      adresser: [...addressResponse(milde).adresser, ...addressResponse(oslo).adresser],
    } : body;
    assert.deepEqual(await searchGarasjeAdresser("Rådhusplassen 1"), [milde, oslo]);
    await assert.rejects(searchGarasjeAdresser("Rådhusplassen 1", "0301"), errorStatus(502));
    transform = (_source, _query, body) => body;
  });
  await test("Ugyldige kommunenummer avvises før nettverk", async () => {
    const before = urls.length;
    for (const code of ["0000", "301", "03011", "abcd", " 0301", "0301\n", "0301&x=1", 301, null]) {
      await assert.rejects(searchGarasjeAdresser("Rådhusplassen 1", code as never), errorStatus(400));
      await assert.rejects(getGarasjeGrunnlag({ ...oslo, kommunenummer: code as never }), errorStatus(400));
    }
    assert.equal(urls.length, before);
  });
  await test("Ukonfigurert kommune får nasjonalt eiendomskart og tomteareal uten Bergen-oppslag", async () => {
    urls.length = 0;
    const g = await getGarasjeGrunnlag(oslo);
    assert.deepEqual(g.adresse, oslo);
    assert.deepEqual(g.eiendomsgeojson, osloEiendomResponse());
    assert.equal(g.eiendomsgeojson?.features[0]?.properties.kommunenummer, "0301");
    assert.equal(g.eiendomsgrenser[0]?.matrikkelnummer, "209/339");
    assert.equal(g.eiendomsgrenser[0]?.teigId, 291199441);
    assert.equal(g.kilder.find(k => k.id === "eiendomsgrenser")?.status, "ok");
    assert(g.arealberegning.tomtearealM2! > 0);
    assert.equal(g.arealberegning.kartlagtBebygdArealM2, null);
    assert.equal(g.arealberegning.kartlagtAndelProsent, null);
    assert.equal(g.bebyggelse.bebygd, null);
    assert.equal(g.bebyggelse.status, "uavklart");
    assert.equal(g.bebyggelse.kilde, "");
    assert(g.bebyggelse.forklaring.includes("ingen konfigurert"));
    assert.deepEqual(g.arealformaal, []);
    assert.deepEqual(g.reguleringsplaner, []);
    assert.deepEqual(g.bygninger, []);
    for (const id of ["kpa", "reguleringsplan", "bygninger"]) {
      const source = g.kilder.find(k => k.id === id)!;
      assert.equal(source.status, "ikke_sjekket");
      assert.equal(source.url, "");
      assert(source.merknad?.includes("0301"));
    }
    assert.deepEqual(g.planflater, []);
    const plan = g.kilder.find(k => k.id === "planflater")!;
    assert.equal(plan.status, "ikke_sjekket");
    assert(plan.merknad?.includes("0301"));
    const hensyn = evaluateGarasje(tiltak, g).sjekker.find(s => s.id === "hensynssoner")!;
    assert.equal(hensyn.status, "uavklart");
    assert(!hensyn.forklaring.includes("Ingen hensynssone"));
    assert.equal(urls.length, 4, "Lokal dekning sjekkes før nasjonale oppslag for eiendom og nabotomter");
    assert.equal(urls[0]!.pathname, "/mock/matrikkel/teiger");
    assert.equal(urls[0]!.searchParams.get("kommunenummer"), "0301");
    assert.equal(urls[1]!.hostname, "api.kartverket.no");
    assert.equal(urls[1]!.searchParams.get("matrikkelnummer"), "0301-209/339");
    // Ingen planoppslag i det hele tatt: bare Bergen har et uttrekk, og kommunen er
    // kjent før noe nettverk røres. Et kall ingen kunne brukt svaret på er ikke verdt
    // turen, uansett hvor kort den er.
    assert.deepEqual(urls.filter(u => u.pathname.startsWith("/mock/plan/")), []);
    assert(!JSON.stringify(g).includes("bergen.kommune") && !JSON.stringify(g).includes("bergen4601"));
  });
  await test("Kommuneregisteret gir aldri en ukjent kommune Bergens adapter", () => {
    assert.equal(findGarasjeKommunekilder("0301"), undefined);
    assert.equal(findGarasjeKommunekilder("0000"), undefined);
    assert.equal(findGarasjeKommunekilder("constructor"), undefined);
    assert.equal(findGarasjeKommunekilder("4601"), GARASJE_KOMMUNER["4601"]);
    assert.equal(getGarasjeKartlagUrl(GARASJE_KOMMUNER["4601"], "kpa"), KPA2018_SONEKILDE.url);
    assert.equal(new URL(GARASJE_KOMMUNER["4601"].kpa.bestemmelserUrl).hostname, "api.arealplaner.no");
  });
  await test("Flat kommunekonfigurasjon gir dokument- og kartkilder uten reservekommune", () => {
    assert.equal(findGarasjeKommune("0301"), undefined);
    assert.equal(findGarasjeKommune("constructor"), undefined);
    assert.deepEqual(findGarasjeKommune("4601"), {
      kommunenummer: "4601", navn: "Bergen", planId: "65270000", versjon: "KPA2018",
      planbestemmelserUrl: "https://api.arealplaner.no/api/kunder/bergen4601/dokumenter/1487/download/b65270000.pdf",
      kpaArealformalUrl: KPA2018_SONEKILDE.url,
      reguleringsplanUrl: "https://kart.bergen.kommune.no/arcgis/rest/services/Plan/Reguleringsplaner_p%C3%A5_grunnen/MapServer/44",
      bygningerUrl: "https://kart.bergen.kommune.no/arcgis/rest/services/Basis_kartdata/Bygning_Flate/MapServer/0",
      lnfBestemmelse: "§ 31.3",
    });
  });
  await test("Veiledningskatalogens sonetyper har entydig navnerom og ingen gjettede grenser", () => {
    const catalogue = listGarasjeSonetyper();
    assert.equal(catalogue.length, 7);
    assert.equal(new Set(catalogue.map(sone => sone.id)).size, 7);
    for (const sone of catalogue) {
      assert.equal(sone.navnerom, "no:4601:65270000:KPA2018");
      assert.equal(sone.id, `${sone.navnerom}:${sone.KPAREALFORMAL}:${sone.AREALST}`);
      assert.equal(sone.tillattUtnyttelse, undefined);
      assert.equal(sone.kilde.planId, "65270000");
      assert.equal(sone.kilde.kommunenummer, "4601");
    }
    catalogue[0]!.kilde.planId = "endret-kopi";
    assert.equal(listGarasjeSonetyper()[0]!.kilde.planId, "65270000");
  });
  const grunnlag = await getGarasjeGrunnlag(milde);
  // Metric squares expressed in EPSG:4258 using fixed GRS80 scale factors at
  // 60 degrees. Expected areas below are ordinary plane geometry, not outputs
  // regenerated from the implementation.
  const metricRing = (left: number, bottom: number, right: number, top: number) =>
    [[left, bottom], [right, bottom], [right, top], [left, top], [left, bottom]];
  const metricPolygon = (rings: number[][][]): GarasjePolygon => ({
    id: "areal-test",
    ringer: rings.map(ring => ring.map(([x, y]) => [5.3 + x! / 55800.0015731251, 60 + y! / 111412.28745823177])),
  });
  const areaCases: [string, number[][][][], number[][][][], number, number][] = [
    ["kvadrat", [[metricRing(0, 0, 10, 10)]], [[metricRing(2, 2, 8, 8)]], 100, 36],
    ["hull i tomten", [[metricRing(0, 0, 10, 10), metricRing(4, 4, 6, 6)]], [[metricRing(3, 3, 7, 7)]], 96, 12],
    ["hull i bygningen", [[metricRing(0, 0, 10, 10)]], [[metricRing(1, 1, 9, 9), metricRing(3, 3, 7, 7)]], 100, 48],
    ["samme flate flere ganger", [[metricRing(0, 0, 10, 10)]], [[metricRing(0, 0, 6, 6)], [metricRing(0, 0, 6, 6)]], 100, 36],
    ["overlappende bygg", [[metricRing(0, 0, 10, 10)]], [[metricRing(2, 2, 8, 8)], [metricRing(5, 5, 9, 9)]], 100, 43],
    ["klipp ved tomtegrensen", [[metricRing(0, 0, 10, 10)]], [[metricRing(-5, 2, 5, 8)]], 100, 30],
    ["overlappende teiger", [[metricRing(0, 0, 10, 10)], [metricRing(5, 0, 15, 10)]], [[metricRing(0, 0, 15, 10)]], 150, 150],
    ["flere separate teiger", [[metricRing(0, 0, 5, 5)], [metricRing(10, 0, 15, 5)]], [[metricRing(0, 0, 15, 5)]], 50, 50],
    ["oppdelt bygg uten dobbelttelling", [[metricRing(0, 0, 10, 10)]], [[metricRing(0, 0, 5, 10)], [metricRing(5, 0, 10, 10)]], 100, 100],
    ["nabobygg utenfor tomten", [[metricRing(0, 0, 10, 10)]], [[metricRing(11, 0, 20, 10)]], 100, 0],
    ["tom bygningsliste", [[metricRing(0, 0, 10, 10)]], [], 100, 0],
    ["skrå kryssende kanter", [[metricRing(0, 0, 10, 10)]],
      [[[[0, 0], [10, 0], [0, 10], [0, 0]]], [[[0, 0], [10, 10], [0, 10], [0, 0]]]], 100, 75],
  ];
  for (const [name, parcels, buildings, expectedParcel, expectedBuilt] of areaCases) {
    await test(`Arealberegning med ${name}`, () => {
      for (const reversed of [false, true]) {
        const shapes = (polygons: number[][][][]) => polygons.map(rings => metricPolygon(
          reversed ? rings.map(ring => [...ring].reverse()) : rings));
        const area = calculateGarasjeAreal(shapes(parcels), shapes(buildings), { lat: 60, lon: 5.3 });
        assert(Math.abs(area.tomtearealM2 - expectedParcel) < 0.00001, `Tomteareal: ${area.tomtearealM2}`);
        assert(Math.abs(area.kartlagtBebygdArealM2 - expectedBuilt) < 0.00001, `Kartlagt areal: ${area.kartlagtBebygdArealM2}`);
        assert(Math.abs(area.kartlagtAndelProsent - expectedBuilt / expectedParcel * 100) < 0.00001);
      }
    });
  }
  await test("Arealberegningen har en uttrykkelig lokal gyldighetsgrense", () => {
    assert.throws(() => calculateGarasjeAreal([metricPolygon([metricRing(0, 0, 10000, 10000)])], [], { lat: 60, lon: 5.3 }), errorStatus(502));
    assert.throws(() => calculateGarasjeAreal([], [], { lat: 60, lon: 5.3 }), errorStatus(502));
    assert.throws(() => calculateGarasjeAreal(Array.from({ length: 501 }, () => metricPolygon([metricRing(0, 0, 10, 10)])), [], { lat: 60, lon: 5.3 }), errorStatus(502));
  });
  await test("Reelle kartdata gir beregnet tomt og flatedekning uten juridisk utnyttelsesgrense", () => {
    const area = grunnlag.arealberegning;
    assert(area.tomtearealM2 !== null && area.tomtearealM2 > 900 && area.tomtearealM2 < 1100);
    assert(area.kartlagtBebygdArealM2 !== null && area.kartlagtBebygdArealM2 > 60 && area.kartlagtBebygdArealM2 < 80);
    assert(area.kartlagtAndelProsent !== null && area.kartlagtAndelProsent > 0 && area.kartlagtAndelProsent < 100);
    assert(area.metode.includes("GRS80") && area.metode.includes("uten dobbelttelling"));
    assert(area.forbehold.some(f => f.includes("ikke juridisk BYA")));
    assert(area.forbehold.some(f => f.includes("Tillatt utnyttelse er ikke fastsatt")));
    assert(!("tillattUtnyttelse" in area));
  });
  await test("Sentralt soneregister har kilde, versjon og alle kontrollerte kodepar, uten tillatte grenser", () => {
    assert.equal(KPA2018_SONEKILDE.planId, "65270000");
    assert.equal(KPA2018_SONEKILDE.kommunenummer, "4601");
    assert.equal(KPA2018_SONEKILDE.versjon, "KPA2018");
    assert.equal(new URL(KPA2018_SONEKILDE.metadataUrl).searchParams.get("f"), "json");
    assert.equal(KPA2018_SONEKILDE.kontrollert, "2026-09-10");
    assert.deepEqual(AREALSONER.map(sone => ({
      value: `${sone.KPAREALFORMAL},${sone.AREALST}`, label: sone.navn, sonetype: sone.sonetype,
    })), zoneLegend);
    assert.equal(new Set(AREALSONER.map(s => `${s.kilde.url}/${s.kilde.planId}/${s.KPAREALFORMAL}/${s.AREALST}`)).size, AREALSONER.length);
    assert(AREALSONER.every(sone => sone.tillattUtnyttelse === undefined));
  });
  await test("Soneregisteret avviser annen plan, kommune, versjon og kilde", () => {
    const known = {
      kode: 1130, arealstatus: 2, sonenavn: "Sentrumskjerne", planId: "65270000",
      kommunenummer: "4601", versjon: "KPA2018", kildeUrl: KPA2018_SONEKILDE.url,
    };
    assert.equal(classifyArealsone(known), "sentrumskjerne");
    for (const patch of [
      { planId: "99999999" }, { kommunenummer: "0301" }, { versjon: "KPA2030" },
      { kildeUrl: "https://example.invalid/metadata" }, { kode: 9999 }, { arealstatus: 3 },
      { arealstatus: undefined }, { sonenavn: undefined }, { sonenavn: "Byfortettingssone" },
    ]) assert.equal(classifyArealsone({ ...known, ...patch }), "ukjent");
  });
  for (const { value, label, sonetype } of zoneLegend) {
    await test(`Soner leses fra begge KPA-feltene og tegnforklaringen: ${label}`, async () => {
      transform = (source, query, body) => {
        if (source === "kpa" && query) {
          const [code, status] = value.split(",").map(Number);
          Object.assign(body.features[0].attributes, { KPAREALFORMAL: code, AREALST: status, BESKRIVELSE: "Generell beskrivelse" });
        }
        return body;
      };
      const g = await getGarasjeGrunnlag(milde);
      assert.equal(g.arealformaal[0]?.arealstatus, Number(value.split(",")[1]));
      assert.equal(g.arealformaal[0]?.sonenavn, label);
      assert.equal(g.arealformaal[0]?.sonetype, sonetype);
      assert.equal(g.arealformaal[0]?.beskrivelse, "Generell beskrivelse");
    });
  }
  transform = (_source, _query, body) => body;
  await test("Sonenavnet kommer fra gjeldende kildemetadata, ikke en lokal kopi av kodene", async () => {
    transform = (source, query, body) => {
      if (source === "kpa" && !query) body.drawingInfo.renderer.uniqueValueInfos.find((item: any) => item.value === "5100,1").label = "Kildens oppdaterte sonenavn";
      return body;
    };
    const g = await getGarasjeGrunnlag(milde);
    assert.equal(g.arealformaal[0]?.sonenavn, "Kildens oppdaterte sonenavn");
    assert.equal(g.arealformaal[0]?.sonetype, "ukjent", "En endret tegnforklaring må kontrolleres før registeret kan brukes");
    transform = (_source, _query, body) => body;
  });
  await test("Ukjent kombinasjon og manglende AREALST utløser aldri gjettet sonenavn", async () => {
    for (const status of [3, null, undefined]) {
      transform = (source, query, body) => {
        if (source === "kpa" && query) Object.assign(body.features[0].attributes, { KPAREALFORMAL: 1130, AREALST: status });
        return body;
      };
      const g = await getGarasjeGrunnlag(milde);
      assert.equal(g.arealformaal[0]?.sonenavn, undefined);
      assert.equal(g.arealformaal[0]?.sonetype, "ukjent");
      assert.equal(g.arealformaal[0]?.kode, 1130);
      assert.equal(g.arealformaal[0]?.arealstatus, status ?? undefined);
      assert(g.uavklarteForhold.some(f => f.includes("Arealformålskoden alene")));
    }
    transform = (_source, _query, body) => body;
  });
  await test("Ustøttet arealformål beholder råkode og kildens navn med eksplisitt ukjent sonetype", async () => {
    transform = (source, query, body) => {
      if (source === "kpa" && !query) body.drawingInfo.renderer.uniqueValueInfos.push({ value: "1160,1", label: "Tjenesteyting" });
      if (source === "kpa" && query) Object.assign(body.features[0].attributes, { KPAREALFORMAL: 1160, AREALST: 1, BESKRIVELSE: "Tjenesteyting" });
      return body;
    };
    const g = await getGarasjeGrunnlag(milde);
    assert.deepEqual(g.arealformaal[0], {
      kode: 1160, arealstatus: 1, beskrivelse: "Tjenesteyting", sonenavn: "Tjenesteyting", sonetype: "ukjent", planId: "65270000",
    });
    assert(g.uavklarteForhold.some(f => f.includes("Sonetypen er ikke støttet")));
    transform = (_source, _query, body) => body;
  });
  await test("Kjent kodepar fra en annen plan arver ikke sonetypen fra KPA2018", async () => {
    transform = (source, query, body) => {
      if (source === "kpa" && query) body.features[0].attributes.PLANID = "99999999";
      return body;
    };
    const g = await getGarasjeGrunnlag(milde);
    assert.equal(g.arealformaal[0]?.sonetype, "ukjent");
    assert.equal(g.arealformaal[0]?.planId, "99999999");
    assert.equal(g.arealformaal[0]?.sonenavn, "LNF");
    assert.equal(g.arealformaal[0]?.kode, 5100);
    transform = (_source, _query, body) => body;
  });
  await test("Manglende tegnforklaring bevarer gyldige arealformål med ukjent sonetype", async () => {
    for (const drawingInfo of [undefined, null, {}, { renderer: null }]) {
      transform = (source, query, body) => {
        if (source === "kpa" && !query) body.drawingInfo = drawingInfo;
        return body;
      };
      const g = await getGarasjeGrunnlag(milde);
      assert.equal(g.kilder.find(k => k.id === "kpa")?.status, "ok");
      assert.deepEqual(g.arealformaal, [{
        kode: 5100, arealstatus: 1, beskrivelse: "LNF", planId: "65270000", sonetype: "ukjent",
      }]);
      assert(g.uavklarteForhold.some(f => f.includes("Sonetypen er ikke støttet")));
    }
    transform = (_source, _query, body) => body;
  });
  await test("Feil tegnforklaring bevarer råverdiene uten å velge feil sone", async () => {
    transform = (source, query, body) => {
      if (source === "kpa" && !query) body.drawingInfo.renderer.field2 = "NOE_ANNET";
      return body;
    };
    const g = await getGarasjeGrunnlag(milde);
    assert.equal(g.kilder.find(k => k.id === "kpa")?.status, "ok");
    assert.deepEqual(g.arealformaal, [{
      kode: 5100, arealstatus: 1, beskrivelse: "LNF", planId: "65270000", sonetype: "ukjent",
    }]);
    assert(g.uavklarteForhold.some(f => f.includes("Tegnforklaringen")));
    transform = (_source, _query, body) => body;
  });
  await test("Gruppert tegnforklaring støtter alle soner uten kommaseparert liste", async () => {
    for (const { value, label, sonetype } of zoneLegend) {
      transform = (source, query, body) => {
        if (source === "kpa" && !query) {
          body.drawingInfo.renderer = {
            type: "uniqueValue", field1: "KPAREALFORMAL", field2: "AREALST",
            uniqueValueGroups: [{ heading: "", classes: zoneLegend.map(row => ({
              label: row.label, values: [row.value.split(",")],
            })) }],
          };
        }
        if (source === "kpa" && query) {
          const [code, status] = value.split(",").map(Number);
          Object.assign(body.features[0].attributes, { KPAREALFORMAL: code, AREALST: status });
        }
        return body;
      };
      const g = await getGarasjeGrunnlag(milde);
      assert.equal(g.arealformaal[0]?.sonetype, sonetype);
      assert.equal(g.arealformaal[0]?.sonenavn, label);
      assert.equal(g.kilder.find(k => k.id === "kpa")?.status, "ok");
    }
    transform = (_source, _query, body) => body;
  });
  await test("To tegnforklaringer må være enige før sonen kan bekreftes", async () => {
    for (const label of ["LNF", "Annet sonenavn"]) {
      transform = (source, query, body) => {
        if (source === "kpa" && !query) {
          body.drawingInfo.renderer.uniqueValueGroups = [{
            classes: [{ label, values: [["5100", "1"]] }],
          }];
        }
        return body;
      };
      const g = await getGarasjeGrunnlag(milde);
      assert.equal(g.arealformaal[0]?.kode, 5100);
      assert.equal(g.arealformaal[0]?.arealstatus, 1);
      assert.equal(g.arealformaal[0]?.sonetype, label === "LNF" ? "lnf" : "ukjent");
      assert.equal(g.arealformaal[0]?.sonenavn, label === "LNF" ? "LNF" : undefined);
      assert.equal(g.kilder.find(k => k.id === "kpa")?.status, "ok");
    }
    transform = (_source, _query, body) => body;
  });
  await test("Uleselig tegnforklaring fjerner aldri gyldige arealformål", async () => {
    for (const renderer of [
      null, "ugyldig", [],
      { type: "uniqueValue", field1: "KPAREALFORMAL", field2: "AREALST", uniqueValueGroups: [{ classes: null }] },
      { type: "uniqueValue", field1: "KPAREALFORMAL", field2: "AREALST", uniqueValueGroups: [{ classes: [{ values: null }] }] },
      { type: "uniqueValue", field1: "KPAREALFORMAL", field2: "AREALST", fieldDelimiter: ";", uniqueValueInfos: [{ value: "5100,1", label: "LNF" }] },
    ]) {
      transform = (source, query, body) => {
        if (source === "kpa" && !query) body.drawingInfo.renderer = renderer;
        return body;
      };
      const g = await getGarasjeGrunnlag(milde);
      assert.deepEqual(g.arealformaal, [{
        kode: 5100, arealstatus: 1, beskrivelse: "LNF", planId: "65270000", sonetype: "ukjent",
      }]);
      assert.equal(g.kilder.find(k => k.id === "kpa")?.status, "ok");
      assert(g.uavklarteForhold.some(f => f.includes("Tegnforklaringen")));
    }
    transform = (_source, _query, body) => body;
  });
  await test("Milde har offentlig LNF-treff og et vellykket reguleringsplansøk uten treff", () => {
    assert.equal(grunnlag.arealformaal[0]?.kode, 5100);
    assert.equal(grunnlag.kilder.find(k => k.id === "reguleringsplan")?.status, "ingen_treff");
    assert.deepEqual(grunnlag.eiendomsgrenser[0]?.ringer, parcelRings);
    assert.deepEqual(grunnlag.bygninger[0]?.ringer, buildingRings);
    assert.equal(grunnlag.kilder.length, 6);
    assert(grunnlag.kilder.every(k => Number.isFinite(Date.parse(k.hentet))));
    assert(!JSON.stringify(grunnlag).includes("OFFENTLIG_EIER"));
    assert(!("scenario" in grunnlag) && !("datamodus" in grunnlag));
  });
  await test("Rådet beholder alle Litle Milde-vilkårene, også LNF og et plansøk uten treff", async () => {
    const g = await readGarasjeGrunnlag(new URLSearchParams({
      adresse: milde.adressetekst, kommunenummer: milde.kommunenummer,
      gnr: String(milde.gardsnummer), bnr: String(milde.bruksnummer),
      lat: String(milde.punkt.lat), lon: String(milde.punkt.lon)
    }));
    const vurdering = evaluateGarasje(tiltak, g);
    assert(vurdering.uavklarteForhold.length > 12, "Fixturen må fange den tidligere tolvpunktsgrensen");
    const lnf = vurdering.sjekker.find(sjekk => sjekk.id === "kommuneplan")!;
    const regulering = vurdering.sjekker.find(sjekk => sjekk.id === "reguleringsplan")!;
    assert.match(lnf.forklaring, /31\.3/);
    assert.equal(g.kilder.find(kilde => kilde.id === "reguleringsplan")?.status, "ingen_treff");
    assert.match(regulering.forklaring, /ikke bevis/);
    const raad = validateGarasjeRaad({
      antattUtfall: "maa_avklares", raad: "Kontakt kommunens byggesaksveileder.", maaAvklares: []
    }, vurdering);
    assert(raad);
    assert.deepEqual(raad.maaAvklares, vurdering.uavklarteForhold);
    assert.equal(raad.fraRegler, vurdering.uavklarteForhold.length);
    assert(raad.maaAvklares.includes(lnf.forklaring), "Hele LNF-forbeholdet må overleve");
    assert(raad.maaAvklares.includes(regulering.forklaring), "Et tomt plansøk må ikke bli byggetillatelse");
  });
  await test("Litle Milde berøres helt av gul støysone, og skissepunktet ligger inni", () => {
    const soner = grunnlag.planflater.filter(f => f.kategori === "hensynssone");
    assert.equal(soner.length, 1);
    assert.deepEqual(
      { ...soner[0]!, ringer: undefined },
      {
        kategori: "hensynssone", datasett: "stoy", sonekode: 220, sonenavn: "H220_1",
        navn: "Gul støysone", beskrivelse: findHensynssone(220)!.beskrivelse,
        kildetekst: "Sjøflyhavn - gul sone", berorer: "helt",
        hensynstype: "stoy", planId: "65270000", ringer: undefined,
      });
    const formaal = grunnlag.planflater.filter(f => f.kategori === "arealformaal");
    assert.equal(formaal[0]?.sonekode, 5100);
    assert.equal(formaal[0]?.arealstatus, 1);
    // Navnet kommer fra det kontrollerte soneregisteret, ikke fra kildens fritekst.
    assert.equal(formaal[0]?.navn, findArealsone(5100, 1, "65270000", "4601")?.navn);
    assert.equal(formaal[0]?.kildetekst, "LNF");
    assert.equal(grunnlag.kilder.find(k => k.id === "planflater")?.status, "ok");
    assert.equal(grunnlag.kilder.find(k => k.id === "planflater")?.uttrekksaar, 2018);
  });
  await test("Sonen navngis og avgjør ingenting", () => {
    const v = evaluateGarasje(tiltak, grunnlag);
    const sjekk = v.sjekker.find(s => s.id === "hensynssoner")!;
    assert.equal(sjekk.status, "uavklart");
    assert(sjekk.forklaring.includes("Gul støysone H220_1"));
    assert(sjekk.forklaring.includes("Sjøflyhavn - gul sone"));
    assert(sjekk.forklaring.includes("dekker hele den kartlagte eiendommen"));
    assert(sjekk.forklaring.includes("Skissepunktet ligger inne i sonen"));
    // Alt oppfylt nasjonalt, og sonen skal likevel ikke skyve utfallet noen vei.
    assert.equal(v.nasjonaltUnntak, "oppfylt");
    assert.equal(v.utfall, "maa_avklares");
    assert(!v.sjekker.some(s => s.id === "hensynssoner" && s.status !== "uavklart"));
    // Flatesvaret hører i kommuneplansjekken og ikke i en egen: det er det samme
    // forholdet sett bredere, og den sjekken siterer allerede planbestemmelsene,
    // som er der et arealformål får betydningen sin fra.
    const kommuneplan = v.sjekker.find(s => s.id === "kommuneplan")!;
    assert.equal(kommuneplan.status, "uavklart");
    assert(kommuneplan.forklaring.includes("LNF over hele eiendommen"));
    assert.equal(kommuneplan.kilde, GARASJE_KPA_URL);
    assert(!v.sjekker.some(s => s.id === "arealformaal-flate"));
  });
  await test("En eiendom uten sonetreff får det sagt, ikke fortiet", async () => {
    lokalePlanflater = url => ({
      kommunenummer: "4601", kildestatus: "tilgjengelig",
      kilde: { navn: "KPA2018", planId: "65270000", versjon: "KPA2018", filer: [], uttrekksaar: 2018, koordinatsystem: "EPSG:4326", syntetisk: false },
      type: "FeatureCollection", klippetTilUtsnitt: true, features: [], sok: url.search,
    });
    const g = await getGarasjeGrunnlag(milde);
    lokalePlanflater = null;
    assert.deepEqual(g.planflater, []);
    assert.equal(g.kilder.find(k => k.id === "planflater")?.status, "ingen_treff");
    const sjekk = evaluateGarasje(tiltak, g).sjekker.find(s => s.id === "hensynssoner")!;
    assert.equal(sjekk.status, "uavklart");
    assert(sjekk.forklaring.includes("Ingen hensynssone"));
    assert(sjekk.forklaring.includes("2018"));
  });
  await test("Manglende dekning i én av planrutene er ukjent, ikke et gyldig tomt treff", async () => {
    for (const udekket of ["hensynssoner", "arealformaal", "begge"]) {
      lokalePlanflater = url => {
        const route = url.pathname.endsWith("hensynssoner") ? "hensynssoner" : "arealformaal";
        const svar = planResponse(url, route === "hensynssoner" ? "hensynssone" : "arealformaal");
        return udekket === "begge" || route === udekket
          ? { ...svar, kildestatus: "ikke_dekket", features: [] } : svar;
      };
      const g = await getGarasjeGrunnlag(milde);
      const kilde = g.kilder.find(k => k.id === "planflater")!;
      assert.equal(kilde.status, "ikke_sjekket", udekket);
      assert.deepEqual(g.planflater, []);
      assert(kilde.merknad?.includes("ikke dekker"));
      assert(g.uavklarteForhold.some(f => f.includes("ikke dekker")));
      const sjekk = evaluateGarasje(tiltak, g).sjekker.find(s => s.id === "hensynssoner")!;
      assert.equal(sjekk.status, "uavklart");
      assert(!sjekk.forklaring.includes("Ingen hensynssone"));
    }
    lokalePlanflater = null;
  });
  await test("Ukjent dekningsstatus, feil kommune og ugyldig flate gir kildefeil", async () => {
    const invalid = [
      (svar: ReturnType<typeof planResponse>) => ({ ...svar, kildestatus: "ukjent", features: [] }),
      (svar: ReturnType<typeof planResponse>) => ({ ...svar, kildestatus: undefined, features: [] }),
      (svar: ReturnType<typeof planResponse>) => ({ ...svar, kommunenummer: "0301", features: [] }),
      (svar: ReturnType<typeof planResponse>) => ({ ...svar, kildestatus: "ikke_dekket" }),
      (svar: ReturnType<typeof planResponse>) => ({
        ...svar, features: svar.features.map(f => ({ ...f, properties: { ...f.properties, kommunenummer: "0301" } })),
      }),
      (svar: ReturnType<typeof planResponse>) => ({
        ...svar, features: svar.features.map(f => ({ ...f, geometry: { type: "Polygon", coordinates: [] } })),
      }),
      (svar: ReturnType<typeof planResponse>) => ({
        ...svar, features: svar.features.map(f => ({ ...f, geometry: { ...f.geometry, type: "MultiPolygon" } })),
      }),
    ];
    for (const change of invalid) {
      lokalePlanflater = url => change(planResponse(url, url.pathname.endsWith("hensynssoner") ? "hensynssone" : "arealformaal"));
      const g = await getGarasjeGrunnlag(milde);
      assert.equal(g.kilder.find(k => k.id === "planflater")?.status, "feil");
      assert.deepEqual(g.planflater, []);
    }
    lokalePlanflater = null;
  });
  await test("Et sonehull helt inne på tomten gir delvis dekning og skissepunkt utenfor sonen", async () => {
    const { lon, lat } = milde.punkt;
    const hull: [number, number][] = [[lon - 0.00001, lat - 0.00001], [lon + 0.00001, lat - 0.00001],
      [lon + 0.00001, lat + 0.00001], [lon - 0.00001, lat + 0.00001], [lon - 0.00001, lat - 0.00001]];
    for (const ring of [hull, hull.toReversed()]) {
      lokalePlanflater = url => {
        const svar = planResponse(url, url.pathname.endsWith("hensynssoner") ? "hensynssone" : "arealformaal");
        svar.features[0]!.geometry.coordinates.push(ring);
        return svar;
      };
      const g = await getGarasjeGrunnlag(milde, milde.punkt);
      assert.equal(g.kilder.find(k => k.id === "planflater")?.status, "ok");
      assert.equal(g.planflater.length, 2);
      assert(g.planflater.every(f => f.berorer === "delvis"));
      const sjekk = evaluateGarasje(tiltak, g).sjekker.find(s => s.id === "hensynssoner")!;
      assert(sjekk.forklaring.includes("berører deler av den kartlagte eiendommen"));
      assert(sjekk.forklaring.includes("Skissepunktet ligger utenfor sonen"));
      assert(!sjekk.forklaring.includes("dekker hele"));
    }
    transform = (source, _query, body) => {
      if (source === "eiendom") {
        const response = structuredClone(body) as ReturnType<typeof eiendomResponse>;
        response.features[0]!.geometry.coordinates.push(hull);
        return response;
      }
      return body;
    };
    const medTeighull = await getGarasjeGrunnlag(milde);
    assert(medTeighull.planflater.every(f => f.berorer === "helt"), "Et sonehull som er samme hull som i teigen, fjerner ikke noe av tomten");
    transform = (_source, _query, body) => body;
    lokalePlanflater = null;
  });
  await test("Et usignert plansvar avvises, og feilen skjules ikke som tomt treff", async () => {
    for (const kropp of [
      { type: "FeatureCollection", features: [], klippetTilUtsnitt: false, kildestatus: "tilgjengelig", kilde: { koordinatsystem: "EPSG:4326" } },
      { type: "FeatureCollection", features: [], klippetTilUtsnitt: true, kildestatus: "tilgjengelig", kilde: { koordinatsystem: "EPSG:25833" } },
      { type: "FeatureCollection", klippetTilUtsnitt: true, kildestatus: "tilgjengelig", kilde: { koordinatsystem: "EPSG:4326" } },
    ]) {
      lokalePlanflater = () => kropp;
      const g = await getGarasjeGrunnlag(milde);
      assert.equal(g.kilder.find(k => k.id === "planflater")?.status, "feil", JSON.stringify(kropp));
      assert.deepEqual(g.planflater, []);
      const sjekk = evaluateGarasje(tiltak, g).sjekker.find(s => s.id === "hensynssoner")!;
      assert.equal(sjekk.status, "uavklart");
      assert(sjekk.forklaring.includes("kunne ikke hentes"));
    }
    lokalePlanflater = null;
  });
  await test("En sonekode kodeverket ikke kjenner navngis ikke, men telles", async () => {
    lokalePlanflater = url => {
      const svar = planResponse(url, url.pathname.endsWith("hensynssoner") ? "hensynssone" : "arealformaal");
      if (url.pathname.endsWith("hensynssoner")) svar.features[0]!.properties.sonekode = 999;
      return svar;
    };
    const g = await getGarasjeGrunnlag(milde);
    lokalePlanflater = null;
    assert.deepEqual(g.planflater.filter(f => f.kategori === "hensynssone"), []);
    assert(g.uavklarteForhold.some(f => f.includes("sonekode sandkassens kodeverk ikke kjenner")));
  });
  await test("Kråkenestoppen bruker faktisk planidentitet, men ingen oppdiktede bestemmelser", async () => {
    const g = await getGarasjeGrunnlag(krakenes);
    assert.equal(g.arealformaal[0]?.kode, 1001);
    assert.equal(g.reguleringsplaner[0]?.planId, "6170063");
    assert.deepEqual(g.eiendomsgrenser[0]?.ringer, krakenesParcelRings);
    assert.deepEqual(g.eiendomsgrenser[0]?.teig, { gnr: 20, bnr: 1413, fnr: 0, teigId: 258839374 });
    assert.equal(new URL(g.reguleringsplaner[0]!.url).hostname, "www.arealplaner.no");
    const v = evaluateGarasje(tiltak, g);
    assert.equal(v.utfall, "maa_avklares");
    assert(v.sjekker.find(s => s.id === "reguleringsplan")?.forklaring.includes("ikke lest"));
    // Faresonen dekker bare deler av teigen her. «Delvis» er svaret på spørsmålet
    // innbyggeren stiller: går sonegrensen tvers gjennom tomten min.
    const sone = g.planflater.find(f => f.kategori === "hensynssone")!;
    assert.equal(sone.sonenavn, "H390_2");
    assert.equal(sone.navn, "Faresone annen fare");
    assert.equal(sone.berorer, "delvis");
    assert(v.sjekker.find(s => s.id === "hensynssoner")?.forklaring.includes("berører deler av den kartlagte eiendommen"));
  });
  await test("Eksisterende bebyggelse hentes automatisk med faktiske registerattributter", () => {
    assert.equal(grunnlag.bebyggelse.status, "bekreftet");
    assert.equal(grunnlag.bebyggelse.bebygd, true);
    assert.deepEqual(grunnlag.bebyggelse.bygninger, [
      { id: "14583", kobling: "geometri", objekttype: "AnnenBygning" },
      { id: "52224", kobling: "geometri", objekttype: "Bygning", bygningsnummer: 139536843,
        bygningstype: 111, bygningstypeNavn: "Enebolig", bygningsstatus: "TB", bygningsstatusNavn: "Tatt i bruk", bruksareal: 63 },
    ]);
    assert(grunnlag.bebyggelse.forklaring.includes("ikke en bekreftet registerkobling"));
    assert(grunnlag.bebyggelse.forklaring.includes("ikke at bebyggelsen er lovlig"));
    assert(grunnlag.uavklarteForhold.some(f => f.includes("BRA") && f.includes("ikke bebygd areal")));
    assert(!("bya" in grunnlag.bebyggelse) && !("utnyttelsesgrad" in grunnlag.bebyggelse));
  });
  await test("Faktisk nabobygning nær Kråkenestoppen utelates fra valgt eiendom", async () => {
    const g = await getGarasjeGrunnlag(krakenes);
    assert.equal(g.bygninger.length, 2, "Kartvisningen beholder også nabobygninger");
    assert.equal(g.bebyggelse.status, "bekreftet");
    assert.equal(g.bebyggelse.bebygd, true);
    assert.deepEqual(g.bebyggelse.bygninger.map(b => b.bygningsnummer), [9521836]);
    assert.equal(g.bebyggelse.bygninger[0]?.bruksareal, 138);
  });
  // Kartet polstrer teigen og strekker den korte siden til 4:3. En bred teig gir
  // derfor et utsnitt som er høyere enn teigen selv, og nabobygg langs over- og
  // underkanten mangler hvis oppslaget bare dekker teigen.
  await test("Bygningsoppslaget dekker hele kartutsnittet, ikke bare teigen", async () => {
    // Rundt Litle Milde 65: omtrent 450 m bred og 45 m høy, altså bredere enn
    // minsteboksen på 0.002 grader og for flat til å fylle 4:3 av seg selv.
    const bredTeig = [[5.2512, 60.25344], [5.2592, 60.25344], [5.2592, 60.25388], [5.2512, 60.25388], [5.2512, 60.25344]];
    for (const teig of [null, bredTeig]) {
      transform = (source, _query, body) => {
        if (source === "eiendom" && teig) body.features[0].geometry.coordinates = [teig];
        return body;
      };
      const g = await getGarasjeGrunnlag(milde);
      const [west, south, east, north] = bygningsKonvolutt.split(",").map(Number) as [number, number, number, number];
      const utsnitt = fitKartutsnitt(g.eiendomsgrenser, g.adresse.punkt);
      assert(west <= utsnitt.west && east >= utsnitt.east && south <= utsnitt.south && north >= utsnitt.north,
        `Konvolutten ${bygningsKonvolutt} må dekke kartutsnittet ${JSON.stringify(utsnitt)}`);
    }
    transform = (_source, _query, body) => body;
  });
  await test("Bare nabobygninger kan aldri bli bebyggelse på valgt eiendom", async () => {
    transform = (source, query, body) => source === "bygning" && query
      ? { ...body, features: [structuredClone(krakenesNeighbour)] } : body;
    const g = await getGarasjeGrunnlag(krakenes);
    assert.equal(g.kilder.find(k => k.id === "bygninger")?.status, "ok");
    assert.deepEqual(g.bebyggelse.bygninger, []);
    assert.equal(g.bebyggelse.status, "uavklart");
    assert.equal(g.bebyggelse.bebygd, null);
    transform = (_source, _query, body) => body;
  });
  await test("Null bygningsflater betyr ikke at tomten er ubebygd", async () => {
    transform = (source, query, body) => source === "bygning" && query ? { ...body, features: [] } : body;
    const g = await getGarasjeGrunnlag(milde);
    assert.equal(g.kilder.find(k => k.id === "bygninger")?.status, "ingen_treff");
    assert.equal(g.bebyggelse.status, "uavklart");
    assert.equal(g.bebyggelse.bebygd, null);
    assert.equal(g.arealberegning.kartlagtBebygdArealM2, 0);
    assert.equal(g.arealberegning.kartlagtAndelProsent, 0);
    assert(g.arealberegning.forbehold.some(f => f.includes("Null kartlagt flatedekning bekrefter ikke")));
    assert(g.bebyggelse.forklaring.includes("ikke et fullstendig bevis"));
    transform = (_source, _query, body) => body;
  });
  await test("Manglende registerattributter gir geometri, ikke falsk bekreftelse eller oppdiktet areal", async () => {
    transform = (source, query, body) => source === "bygning" && !query
      ? { ...body, fields: [{ name: "OBJECTID" }] } : body;
    const g = await getGarasjeGrunnlag(milde);
    assert.equal(g.bebyggelse.status, "uavklart");
    assert.equal(g.bebyggelse.bebygd, null);
    assert(g.bebyggelse.bygninger.length > 0);
    assert(g.bebyggelse.bygninger.every(b => b.bygningsnummer === undefined && b.bruksareal === undefined));
    transform = (_source, _query, body) => body;
  });
  for (const status of ["RA", "IG", "BR", "BA", "BF", "BU", "ukjent", null]) {
    await test(`Byggstatus ${status} gir ikke automatisk eksisterende bebyggelse`, async () => {
      transform = (source, query, body) => {
        if (source === "bygning" && query) for (const feature of body.features) feature.attributes.BYGGSTAT = status;
        return body;
      };
      const g = await getGarasjeGrunnlag(milde);
      assert.equal(g.bebyggelse.bebygd, null);
      assert.equal(g.bebyggelse.status, "uavklart");
    });
  }
  transform = (_source, _query, body) => body;
  for (const source of ["eiendom", "bygning"] as const) {
    for (const failure of ["forbidden", "truncated", "invalid-json"] as const) {
      await test(`Kildefeil ${source}/${failure} gir ukjent bebyggelse, ikke ubebygd`, async () => {
        transform = (current, query, body) => {
          if (current !== source || !query) return body;
          return failure === "forbidden" ? new Response("Ingen tilgang", { status: 403 })
            : failure === "invalid-json" ? new Response("<html>Feil</html>")
              : { ...body, exceededTransferLimit: true };
        };
        const g = await getGarasjeGrunnlag(milde);
        assert.equal(g.kilder.find(k => k.id === (source === "eiendom" ? "eiendomsgrenser" : "bygninger"))?.status, "feil");
        assert.equal(g.bebyggelse.bebygd, null);
        assert.equal(g.bebyggelse.status, "uavklart");
        assert.deepEqual(g.bebyggelse.bygninger, []);
        assert.equal(g.arealberegning.kartlagtBebygdArealM2, null);
        assert.equal(g.arealberegning.kartlagtAndelProsent, null);
        if (source === "eiendom") assert.equal(g.arealberegning.tomtearealM2, null);
        else assert(g.arealberegning.tomtearealM2! > 0);
      });
    }
  }
  transform = (_source, _query, body) => body;
  for (const flag of ["teigmedflerematrikkelenheter", "uregistrertjordsameie"]) {
    await test(`Felles teig med ${flag} bekrefter ikke bebyggelse på valgt matrikkelenhet`, async () => {
      transform = (source, _query, body) => {
        if (source === "eiendom") body.features[0].properties[flag] = true;
        return body;
      };
      const g = await getGarasjeGrunnlag(milde);
      assert(g.bebyggelse.bygninger.length > 0);
      assert.equal(g.bebyggelse.bebygd, null);
      assert.equal(g.bebyggelse.status, "uavklart");
      assert.equal(g.arealberegning.tomtearealM2, null);
      assert.equal(g.arealberegning.kartlagtBebygdArealM2, null);
      assert.equal(g.arealberegning.kartlagtAndelProsent, null);
    });
  }
  transform = (_source, _query, body) => body;
  await test("Bygningssøk dekker alle teiger, også utenfor kartpunktets nærområde", async () => {
    transform = (source, query, body) => {
      if (source === "eiendom") {
        const extra = structuredClone(body.features[0]);
        extra.properties.lokalid++;
        extra.geometry.coordinates = extra.geometry.coordinates.map((r: number[][]) => r.map(([x, y]) => [x! + 0.003, y]));
        body.features.push(extra);
      }
      if (source === "bygning" && query) {
        body.features = [structuredClone(mildeHouse)];
        body.features[0].geometry.rings = body.features[0].geometry.rings.map((r: number[][]) => r.map(([x, y]) => [x! + 0.003, y]));
      }
      return body;
    };
    urls.length = 0;
    const g = await getGarasjeGrunnlag(milde);
    assert.equal(g.bebyggelse.bebygd, true);
    const query = urls.find(u => u.pathname.includes("Bygning_Flate") && u.pathname.endsWith("/query"))!;
    assert(Number(query.searchParams.get("geometry")!.split(",")[2]) >= 5.2585238);
    transform = (_source, _query, body) => body;
  });
  await test("Bygg helt i et hull i teigen regnes ikke som bebyggelse på tomten", async () => {
    transform = (source, _query, body) => {
      if (source === "eiendom") body.features[0].geometry.coordinates = [
        [[5.25, 60.25], [5.25, 60.26], [5.26, 60.26], [5.26, 60.25], [5.25, 60.25]],
        [[5.254, 60.253], [5.256, 60.253], [5.256, 60.254], [5.254, 60.254], [5.254, 60.253]],
      ];
      return body;
    };
    const g = await getGarasjeGrunnlag(milde);
    assert.deepEqual(g.bebyggelse.bygninger, []);
    assert.equal(g.bebyggelse.bebygd, null);
    transform = (_source, _query, body) => body;
  });
  const rectangle = (left: number, bottom: number, right: number, top: number) =>
    [[left, bottom], [right, bottom], [right, top], [left, top], [left, bottom]];
  for (const [label, ring, expected] of [
    ["krysser uten innvendige hjørner", rectangle(5.254, 60.2534, 5.257, 60.2536), true],
    ["bare berører yttergrensen", rectangle(5.256, 60.2534, 5.257, 60.2536), null],
    ["teigen ligger inne i bygningsflaten", rectangle(5.254, 60.252, 5.257, 60.255), true],
  ] as const) {
    await test(`Geometrisk kobling: ${label}`, async () => {
      transform = (source, query, body) => {
        if (source === "eiendom") body.features[0].geometry.coordinates = [rectangle(5.255, 60.253, 5.256, 60.254)];
        if (source === "bygning" && query) {
          body.features = [structuredClone(mildeHouse)];
          body.features[0].geometry.rings = [ring];
        }
        return body;
      };
      assert.equal((await getGarasjeGrunnlag(milde)).bebyggelse.bebygd, expected);
    });
  }
  transform = (_source, _query, body) => body;
  for (const patch of [{ BYGGNR: "139536843" }, { BRUKSAREAL: -1 }, { BRUKSAREAL: "63" }, { BYGGTYP_NBR: -1 }]) {
    await test("Ugyldige registerattributter gir eksplisitt kildefeil", async () => {
      transform = (source, query, body) => {
        if (source === "bygning" && query) Object.assign(body.features[1].attributes, patch);
        return body;
      };
      const g = await getGarasjeGrunnlag(milde);
      assert.equal(g.kilder.find(k => k.id === "bygninger")?.status, "feil");
      assert.equal(g.bebyggelse.bebygd, null);
    });
  }
  transform = (_source, _query, body) => body;
  await test("Dupliserte flater godtas ikke som et komplett utvalg", async () => {
    transform = (source, query, body) => {
      if (source === "bygning" && query) body.features.push(structuredClone(body.features[0]));
      return body;
    };
    const g = await getGarasjeGrunnlag(milde);
    assert.equal(g.kilder.find(k => k.id === "bygninger")?.status, "feil");
    assert.equal(g.bebyggelse.bebygd, null);
    transform = (_source, _query, body) => body;
  });
  await test("Treffgrensen uten avkortingsflagg gir heller ikke bekreftet bebyggelse", async () => {
    transform = (source, query, body) => {
      if (source === "bygning" && query) body.features = Array.from({ length: 500 }, (_, i) => ({
        ...structuredClone(mildeHouse), attributes: { ...mildeHouse.attributes, OBJECTID: i + 1 },
      }));
      return body;
    };
    const g = await getGarasjeGrunnlag(milde);
    assert.equal(g.kilder.find(k => k.id === "bygninger")?.status, "feil");
    assert(g.kilder.find(k => k.id === "bygninger")?.merknad?.includes("treffgrensen"));
    assert.equal(g.bebyggelse.bebygd, null);
    transform = (_source, _query, body) => body;
  });
  await test("For fjerntliggende teiger gir ukjent bebyggelse uten et stort kartoppslag", async () => {
    transform = (source, _query, body) => {
      if (source === "eiendom") {
        const extra = structuredClone(body.features[0]);
        extra.properties.lokalid++;
        extra.geometry.coordinates = extra.geometry.coordinates.map((r: number[][]) => r.map(([x, y]) => [x! + 0.06, y]));
        body.features.push(extra);
      }
      return body;
    };
    urls.length = 0;
    const g = await getGarasjeGrunnlag(milde);
    assert.equal(g.bebyggelse.bebygd, null);
    assert.equal(g.kilder.find(k => k.id === "bygninger")?.status, "feil");
    assert(!urls.some(u => u.pathname.includes("Bygning_Flate") && u.pathname.endsWith("/query")));
    transform = (_source, _query, body) => body;
  });
  await test("Et hull i bygningsflaten fylles ikke av eiendomskoblingen", async () => {
    transform = (source, query, body) => {
      if (source === "bygning" && query) {
        body.features = [structuredClone(mildeHouse)];
        body.features[0].geometry.rings = [
          rectangle(5.25, 60.25, 5.26, 60.26),
          rectangle(5.254, 60.253, 5.256, 60.254).reverse(),
        ];
      }
      return body;
    };
    const g = await getGarasjeGrunnlag(milde);
    assert.deepEqual(g.bebyggelse.bygninger, []);
    assert.equal(g.bebyggelse.bebygd, null);
    transform = (_source, _query, body) => body;
  });
  await test("Bygningsflate lik hele tomten gir sammenfallende grenser og 100 prosent", async () => {
    transform = (source, query, body) => {
      if (source === "bygning" && query) {
        body.features = [structuredClone(mildeHouse)];
        body.features[0].geometry.rings = structuredClone(parcelRings);
      }
      return body;
    };
    const g = await getGarasjeGrunnlag(milde);
    assert.equal(g.bebyggelse.bebygd, true);
    assert.equal(g.arealberegning.kartlagtAndelProsent, 100);
    assert.equal(g.arealberegning.kartlagtBebygdArealM2, g.arealberegning.tomtearealM2);
    transform = (_source, _query, body) => body;
  });
  await test("Kompleksitetsgrense bevarer tomteareal og setter ukjent bygningsareal", async () => {
    transform = (source, query, body) => {
      if (source === "bygning" && query) body.features = Array.from({ length: 250 }, (_, i) => ({
        ...structuredClone(mildeHouse), attributes: { ...mildeHouse.attributes, OBJECTID: i + 1 },
      }));
      return body;
    };
    const g = await getGarasjeGrunnlag(milde);
    assert.equal(g.kilder.find(k => k.id === "bygninger")?.status, "ok");
    assert(g.arealberegning.tomtearealM2! > 0);
    assert.equal(g.arealberegning.kartlagtBebygdArealM2, null);
    assert.equal(g.arealberegning.kartlagtAndelProsent, null);
    assert(g.arealberegning.forbehold.some(f => f.includes("for detaljert")));
    transform = (_source, _query, body) => body;
  });
  await test("Kartverkets native GeoJSON bevarer identitet, kvalitet og oppdateringsdato", async () => {
    for (const [adresse, teigId] of [[milde, 259953783], [krakenes, 258839374]] as const) {
      const g = await getGarasjeGrunnlag(adresse);
      assert.equal(g.eiendomsgrenser[0]?.teigId, teigId);
      const second = adresse === krakenes;
      assert.deepEqual(g.eiendomsgeojson, eiendomResponse(second));
      assert.equal(g.eiendomsgrenser[0]?.kvalitetsklasse, second ? "Gult" : "Grønt");
      assert.equal(g.eiendomsgrenser[0]?.oppdatert, second ? "2020-06-16T06:59:59" : "2025-06-18T16:10:10");
      assert.equal(g.eiendomsgrenser[0]?.matrikkelnummer, second ? "20/1413" : "105/209");
      assert.equal(new URL(g.kilder.find(k => k.id === "eiendomsgrenser")!.url).hostname, "api.kartverket.no");
      if (second) assert(g.uavklarteForhold.some(f => f.includes("Gult")));
    }
    assert(!urls.some(u => u.pathname.includes("Eiendommer")));
  });
  await test("Manglende kvalitet er ukjent og ikke en oppdiktet klasse", async () => {
    transform = (source, _query, body) => {
      if (source === "eiendom") {
        delete body.features[0].properties["nøyaktighetsklasseteig"];
        delete body.features[0].properties.oppdateringsdato;
      }
      return body;
    };
    const g = await getGarasjeGrunnlag(milde);
    assert.equal(g.eiendomsgrenser[0]?.kvalitetsklasse, undefined);
    assert.equal(g.eiendomsgrenser[0]?.oppdatert, undefined);
    assert(g.uavklarteForhold.some(f => f.includes("ikke oppgitt")));
    transform = (_source, _query, body) => body;
  });
  await test("MultiPolygon og flere teiger bevares uten å velge bare hovedteigen", async () => {
    transform = (source, _query, body) => {
      if (source === "eiendom") {
        const f = body.features[0];
        const moved = f.geometry.coordinates.map((r: number[][]) => r.map(([x, y]) => [x! + 0.002, y!]));
        f.geometry = { type: "MultiPolygon", coordinates: [f.geometry.coordinates, moved] };
        const another = structuredClone(f);
        another.properties.lokalid += 1;
        another.properties["hovedområde"] = false;
        another.geometry = { type: "Polygon", coordinates: moved };
        body.features.push(another);
      }
      return body;
    };
    const g = await getGarasjeGrunnlag(milde);
    assert.equal(g.eiendomsgeojson?.features.length, 2);
    assert.equal(g.eiendomsgeojson?.features[0]?.geometry.type, "MultiPolygon");
    assert.equal(g.eiendomsgrenser.length, 3);
    assert.equal(g.eiendomsgrenser[0]?.id, "259953783-1");
    assert.equal(g.eiendomsgrenser[1]?.id, "259953783-2");
    assert.equal(g.eiendomsgrenser[2]?.teigId, 259953784);
    assert(Math.abs(g.arealberegning.tomtearealM2! - grunnlag.arealberegning.tomtearealM2! * 2) <= 0.02,
      "Den tredje, overlappende flaten skal ikke tredoble tomtearealet");
    assert.equal(g.arealberegning.kartlagtBebygdArealM2, grunnlag.arealberegning.kartlagtBebygdArealM2);
    transform = (_source, _query, body) => body;
  });
  await test("Gyldige hull bevares i native GeoJSON og blir utenfor valgt teig", async () => {
    const outer = [[5.25, 60.25], [5.25, 60.26], [5.26, 60.26], [5.26, 60.25], [5.25, 60.25]];
    const hole = [[5.255, 60.253], [5.2555, 60.253], [5.2555, 60.254], [5.255, 60.254], [5.255, 60.253]];
    transform = (source, _query, body) => {
      if (source === "eiendom") body.features[0].geometry.coordinates = [outer, hole];
      return body;
    };
    const g = await getGarasjeGrunnlag(milde);
    assert.equal(g.eiendomsgrenser[0]?.ringer.length, 2);
    assert.equal(evaluateGarasje(tiltak, g).sjekker.find(s => s.id === "plassering")?.status, "brudd");
    transform = (_source, _query, body) => body;
  });
  const badGeoJson: [string, (body: any) => void][] = [
    ["feil kommune", b => { b.features[0].properties.kommunenummer = "0301"; }],
    ["feil gårdsnummer", b => { b.features[0].properties.gardsnummer = 1; }],
    ["feil bruksnummer", b => { b.features[0].properties.bruksnummer = 2; }],
    ["feil festenummer", b => { b.features[0].properties.festenummer = 1; }],
    ["tekst i teig-ID", b => { b.features[0].properties.lokalid = "259953783"; }],
    ["manglende referanse", b => { delete b.features[0].properties.gardsnummer; }],
    ["punkt i stedet for område", b => { b.features[0].geometry = { type: "Point", coordinates: [5.255, 60.25] }; }],
    ["tom MultiPolygon", b => { b.features[0].geometry = { type: "MultiPolygon", coordinates: [] }; }],
    ["åpen ring", b => { b.features[0].geometry.coordinates[0].pop(); }],
    ["manglende koordinat", b => { b.features[0].geometry.coordinates[0][1] = [5.255]; }],
    ["ugyldig koordinat", b => { b.features[0].geometry.coordinates[0][1] = [5.255, NaN]; }],
    ["hull utenfor teigen", b => {
      b.features[0].geometry.coordinates.push([[5.26, 60.25], [5.27, 60.25], [5.27, 60.26], [5.26, 60.26], [5.26, 60.25]]);
    }],
    ["kryssende hull", b => {
      b.features[0].geometry.coordinates = [
        [[5.25, 60.25], [5.25, 60.26], [5.26, 60.26], [5.26, 60.25], [5.25, 60.25]],
        [[5.255, 60.255], [5.265, 60.255], [5.265, 60.257], [5.255, 60.257], [5.255, 60.255]],
      ];
    }],
    ["avkortingssignal", b => { b.exceededTransferLimit = true; }],
    ["neste side", b => { b.next = "some-page"; }],
    ["feil koordinatsystem", b => { b.crs = { type: "name", properties: { name: "EPSG:25832" } }; }],
    ["duplisert teig", b => { b.features.push(structuredClone(b.features[0])); }],
    ["ukjent kvalitetsklasse", b => { b.features[0].properties["nøyaktighetsklasseteig"] = "Sikker"; }],
    ["ugyldig oppdateringsdato", b => { b.features[0].properties.oppdateringsdato = "ikke en dato"; }],
    ["ugyldig flagg", b => { b.features[0].properties.teigmedflerematrikkelenheter = "false"; }],
  ];
  for (const [navn, corrupt] of badGeoJson) {
    await test(`Ugyldig eiendoms-GeoJSON avvises: ${navn}`, async () => {
      transform = (source, _query, body) => { if (source === "eiendom") corrupt(body); return body; };
      const g = await getGarasjeGrunnlag(milde);
      assert.equal(g.kilder.find(k => k.id === "eiendomsgrenser")?.status, "feil");
      assert.deepEqual(g.eiendomsgrenser, []);
      assert.equal(g.eiendomsgeojson, undefined);
      assert.equal(evaluateGarasje(tiltak, g).utfall, "maa_avklares");
    });
  }
  transform = (_source, _query, body) => body;
  await test("Nasjonale terskler er inklusive; LNF gir ikke automatisk søknadsplikt eller fritak", () => {
    const result = evaluateGarasje(tiltak, grunnlag);
    assert.equal(result.nasjonaltUnntak, "oppfylt");
    assert.equal(result.utfall, "maa_avklares");
    assert.equal(result.sjekker.find(s => s.id === "kommuneplan")?.status, "uavklart");
    assert(result.uavklarteForhold.some(f => f.includes("Ledningskart")));
  });
  await test("Desimaltall godtas uten avrunding", () => {
    assert.equal(evaluateGarasje({ ...tiltak, bra: 49.99, bya: 49.999, gesimshoyde: 2.95 }, grunnlag).nasjonaltUnntak, "oppfylt");
  });
  for (const [field, value] of Object.entries({
    bra: 50.001, bya: 50.001, monehoyde: 4.001, gesimshoyde: 3.001, etasjer: 2,
    avstandNabogrense: 0.999, avstandBygning: 0.999, beboelse: true, frittliggende: false,
    kjeller: true, bebygdEiendom: false, overVannAvlop: true,
  })) {
    await test(`Brudd på ${field} fanges`, () => {
      const v = evaluateGarasje({ ...tiltak, [field]: value }, grunnlag);
      assert.equal(v.nasjonaltUnntak, "brudd");
      assert.equal(v.utfall, "soknadspliktig");
    });
  }
  for (const field of ["frittliggende", "beboelse", "kjeller", "bebygdEiendom", "overVannAvlop", "avstandNabogrense", "avstandBygning"]) {
    await test(`Ukjent ${field} består ikke`, () => {
      const v = evaluateGarasje({ ...tiltak, [field]: null }, grunnlag);
      assert.equal(v.nasjonaltUnntak, "uavklart");
      assert.equal(v.utfall, "maa_avklares");
    });
  }
  for (const field of ["bra", "bya", "gesimshoyde", "monehoyde", "etasjer", "avstandNabogrense", "avstandBygning"]) {
    for (const value of [-1, NaN, Infinity, "1", undefined]) {
      await test(`Ugyldig ${field} avvises: ${String(value)}`, () => {
        assert.throws(() => validateGarasjeTiltak({ ...tiltak, [field]: value }), errorStatus(400));
      });
    }
  }
  await test("Andre ugyldige innsendte verdier avvises", () => {
    for (const input of [null, [], "{}", { ...tiltak, etasjer: 1.5 }, { ...tiltak, beboelse: "false" },
      { ...tiltak, kjeller: undefined }, { ...tiltak, arealformaal: 1001 }, { ...tiltak, bra: 0 },
      { ...tiltak, gesimshoyde: 4.1, monehoyde: 4 }]) {
      assert.throws(() => validateGarasjeTiltak(input), errorStatus(400));
    }
    for (const input of [null, [], { lat: "60", lon: 5 }, { lat: 60.3, lon: 181 },
      { lat: 60.3, lon: 5.3, url: "https://example.invalid" }]) {
      assert.throws(() => validateGarasjePunkt(input), errorStatus(400));
    }
  });
  await test("Søk avviser ugyldige og fødselsnummerlignende verdier før nettverk", async () => {
    const before = urls.length;
    for (const query of ["", "ab", "A".repeat(121), "01019012345", "Litle Milde &fnr=123", "Litle\nMilde"]) {
      await assert.rejects(searchGarasjeAdresser(query), errorStatus(400));
    }
    assert.equal(urls.length, before);
  });
  await test("Manglende kilder og tom liste med ukjente forhold kan aldri gi grønt", () => {
    const g = { ...grunnlag, kilder: [], uavklarteForhold: [] };
    assert.equal(evaluateGarasje(tiltak, g).utfall, "maa_avklares");
    assert.equal(evaluateGarasje(tiltak, g).sjekker.filter(s => s.id.startsWith("kilde-")).length, 6);
  });
  await test("Skissepunkt kontrolleres mot valgt eiendom, ikke bare avstand fra adressen", async () => {
    const inside = evaluateGarasje(tiltak, await getGarasjeGrunnlag(milde, milde.punkt));
    assert.equal(inside.sjekker.find(s => s.id === "plassering")?.status, "oppfylt");
    assert(inside.sjekker.find(s => s.id === "plassering")?.forklaring.includes("ikke at hele garasjen"));
    const outside = evaluateGarasje(tiltak, await getGarasjeGrunnlag(milde, { lat: milde.punkt.lat + 0.002, lon: milde.punkt.lon }));
    assert.equal(outside.sjekker.find(s => s.id === "plassering")?.status, "brudd");
    assert.equal(outside.utfall, "maa_avklares");
    await assert.rejects(getGarasjeGrunnlag(milde, krakenes.punkt), errorStatus(400));
  });
  await test("Hull i polygonen er ikke del av valgt eiendom", () => {
    const { lat, lon } = milde.punkt;
    const g: GarasjeGrunnlag = {
      ...grunnlag, eiendomsgrenser: [{ id: "polygon-test", ringer: [
        [[lon - 0.01, lat - 0.01], [lon - 0.01, lat + 0.01], [lon + 0.01, lat + 0.01], [lon + 0.01, lat - 0.01], [lon - 0.01, lat - 0.01]],
        [[lon - 0.001, lat - 0.001], [lon + 0.001, lat - 0.001], [lon + 0.001, lat + 0.001], [lon - 0.001, lat + 0.001], [lon - 0.001, lat - 0.001]],
      ] }],
    };
    assert.equal(evaluateGarasje(tiltak, g).sjekker.find(s => s.id === "plassering")?.status, "brudd");
  });
  await test("Gyldig null treff i adresse-API er ikke en feil", async () => {
    transform = () => ({ metadata: { totaltAntallTreff: 0 }, adresser: [] });
    assert.deepEqual(await searchGarasjeAdresser("Finnes ikke 12"), []);
  });
  for (const body of [null, {}, { adresser: [] }, { metadata: { totaltAntallTreff: 2 }, adresser: [] },
    { metadata: { totaltAntallTreff: 0 }, adresser: addressResponse(milde).adresser }, { error: { code: 500 } }]) {
    await test("Ugyldig adresseformat kan ikke bli et tomt søk", async () => {
      transform = () => body;
      await assert.rejects(searchGarasjeAdresser("Litle Milde 65", "4601"), errorStatus(502));
    });
  }
  await test("Feil kommune, koordinatsystem og matrikkelreferanse avvises", async () => {
    for (const patch of [{ kommunenummer: "0301" }, { gardsnummer: "105" }, { representasjonspunkt: { ...milde.punkt, epsg: "EPSG:4326" } }]) {
      transform = () => {
        const body = addressResponse(milde);
        Object.assign(body.adresser[0]!, patch);
        return body;
      };
      await assert.rejects(searchGarasjeAdresser("Litle Milde 65", "4601"), errorStatus(502));
    }
  });
  for (const [navn, broken] of [
    ["ArcGIS-feil med HTTP 200", { error: { code: 499, message: "Token required" } }],
    ["Manglende features", {}],
    ["Avkortet resultat", { features: [], exceededTransferLimit: true }],
    ["Feil attributtformat", { features: [{ attributes: { KPAREALFORMAL: "5100", PLANID: "65270000", BESKRIVELSE: "LNF" } }] }],
    ["HTML i stedet for JSON", new Response("<html>Feil</html>")],
    ["HTTP-feil", new Response("Tjenesten er nede", { status: 503 })],
  ] as const) {
    await test(`${navn} gir kildefeil, aldri ingen treff eller grønt`, async () => {
      transform = (source, query, body) => source === "kpa" && query ? broken : body;
      const g = await getGarasjeGrunnlag(milde);
      assert.equal(g.kilder.find(k => k.id === "kpa")?.status, "feil");
      assert.equal(evaluateGarasje(tiltak, g).utfall, "maa_avklares");
    });
  }
  await test("Manglende metadata stopper query", async () => {
    urls.length = 0;
    transform = (source, query, body) => source === "kpa" && !query ? { ...body, fields: [] } : body;
    const g = await getGarasjeGrunnlag(milde);
    assert.equal(g.kilder.find(k => k.id === "kpa")?.status, "feil");
    assert(!urls.some(u => decodeURIComponent(u.pathname).includes("Arealformål") && u.pathname.endsWith("/query")));
  });
  for (const patch of [
    { spatialReference: { wkid: 25832 } },
    { features: [{ attributes: { OBJECTID: 1 }, geometry: { rings: [[[5, 60], [5.1, 60], [5.1, 60.1], [5, 60.1]]] } }] },
    { features: [{ attributes: { OBJECTID: 1 }, geometry: { rings: [[[5, 60], [5.1, 60], [NaN, 60.1], [5, 60]]] } }] },
    { features: [{ attributes: { OBJECTID: 1 }, geometry: { rings: [[[5, 60], [5.1, 60], [5.2, 60], [5, 60]]] } }] },
  ]) {
    await test("Ugyldig bygningsgeometri gir kildefeil", async () => {
      transform = (source, query, body) => source === "bygning" && query ? { ...body, ...patch } : body;
      assert.equal((await getGarasjeGrunnlag(milde)).kilder.find(k => k.id === "bygninger")?.status, "feil");
    });
  }
  await test("Ingen eiendomstreff gir eksplisitt ukjent plassering", async () => {
    transform = (source, query, body) => source === "eiendom" && query ? { ...body, features: [] } : body;
    const g = await getGarasjeGrunnlag(milde, milde.punkt);
    assert.equal(g.kilder.find(k => k.id === "eiendomsgrenser")?.status, "ingen_treff");
    assert.equal(g.bebyggelse.bebygd, null);
    assert.equal(g.bebyggelse.status, "uavklart");
    assert.equal(evaluateGarasje(tiltak, g).sjekker.find(s => s.id === "plassering")?.status, "uavklart");
  });
  function localResponse(second = false) {
    const a = second ? krakenes : milde;
    const id = second ? 32713 : 8464;
    return {
      kommunenummer: "4601", kildestatus: "tilgjengelig",
      kilde: { navn: "Bergen kommunes teiguttrekk", fil: "matrikkel_bk_25.json", uttrekksaar: 2025, koordinatsystem: "EPSG:4326", syntetisk: false },
      type: "FeatureCollection", features: [{
        type: "Feature", id,
        geometry: { type: "Polygon", coordinates: structuredClone(second ? krakenesParcelRings : parcelRings) },
        properties: {
          OBJECTID: id, OBJTYPE: "Teig", GNR: a.gardsnummer, BNR: a.bruksnummer, FNR: 0, SNR: 0,
          AREAL: second ? 976.3 : 960, AREALMERKNAD: null, TINGLYST: "Ja", ANTALL_GID: 1,
          Shape_Length: 124, Shape_Area: second ? 976.3420999933496 : 959.9832765063059
        }
      }]
    };
  }
  for (const second of [false, true]) {
    await test("Lokal fil brukes først, med kilde-ID og ukjent grensekvalitet", async () => {
      transform = (_source, _query, body) => body;
      lokaleTeiger = () => localResponse(second);
      urls.length = 0;
      const g = await getGarasjeGrunnlag(second ? krakenes : milde);
      assert.equal(g.kilder.find(k => k.id === "eiendomsgrenser")?.fil, "matrikkel_bk_25.json");
      assert.equal(g.kilder.find(k => k.id === "eiendomsgrenser")?.uttrekksaar, 2025);
      assert.equal(g.eiendomsgeojson?.koordinatsystem, "EPSG:4326");
      assert.equal(g.eiendomsgrenser[0].kildeObjektId, second ? 32713 : 8464);
      assert.equal(g.eiendomsgrenser[0].registrertArealM2, second ? 976.3 : 960);
      assert.equal(g.eiendomsgrenser[0].teigId, undefined, "OBJECTID er ikke Matrikkel-teig-ID");
      assert.equal(g.eiendomsgrenser[0].kvalitetsklasse, undefined);
      assert.equal(g.eiendomsgrenser[0].oppdatert, undefined, "Uttrekksåret er ikke oppdateringstidspunktet");
      assert(g.arealberegning.tomtearealM2! > 900);
      assert(g.arealberegning.kilde.includes("matrikkel_bk_25.json"));
      assert(!g.arealberegning.kilde.includes("api.kartverket.no"));
      assert(g.arealberegning.metode.includes("teiger i EPSG:4326"));
      assert(!urls.some(url => url.hostname === "api.kartverket.no"), "Ingen offentlig teigforespørsel når lokal fil har treff");
      assert.equal(evaluateGarasje(tiltak, g).utfall, "maa_avklares");
    });
  }
  await test("LNF-vilkåret følger flyten når avstanden er større enn én meter", async () => {
    lokaleTeiger = () => localResponse();
    const g = await getGarasjeGrunnlag(milde);
    const vurdering = evaluateGarasje({ ...tiltak, avstandNabogrense: 2 }, g);
    const lnf = vurdering.sjekker.find(sjekk => sjekk.id === "kommuneplan");
    assert.equal(lnf?.status, "oppfylt");
    assert.match(lnf?.forklaring ?? "", /mer enn 1 m avstand/);
    const paaGrensen = evaluateGarasje({ ...tiltak, avstandNabogrense: 1 }, g);
    assert.equal(paaGrensen.sjekker.find(sjekk => sjekk.id === "kommuneplan")?.status, "uavklart");
  });
  await test("Manglende lokal teig gir synlig API-kilde uten å blande kilder", async () => {
    lokaleTeiger = () => ({ ...localResponse(), features: [] });
    urls.length = 0;
    const g = await getGarasjeGrunnlag(milde);
    const kilde = g.kilder.find(k => k.id === "eiendomsgrenser")!;
    assert.equal(kilde.fil, undefined);
    assert.equal(kilde.koordinatsystem, "EPSG:4258");
    assert(kilde.merknad?.includes("finnes ikke"));
    assert.equal(g.eiendomsgrenser[0].teigId, 259953783);
    assert.equal(g.eiendomsgrenser[0].kildeObjektId, undefined);
    assert(g.arealberegning.kilde.includes("api.kartverket.no"));
    assert(g.arealberegning.metode.includes("teiger i EPSG:4258"));
    assert(urls.some(url => url.hostname === "api.kartverket.no"));
  });
  await test("Flere lokale teiger og hull bevares", async () => {
    lokaleTeiger = () => {
      const body = localResponse();
      const other = structuredClone(body.features[0]);
      other.id += 1;
      other.properties.OBJECTID = other.id;
      const { lon, lat } = milde.punkt;
      body.features[0].geometry.coordinates = [
        [[lon - .001, lat - .001], [lon + .001, lat - .001], [lon + .001, lat + .001], [lon - .001, lat + .001], [lon - .001, lat - .001]],
        [[lon - .0001, lat - .0001], [lon - .0001, lat + .0001], [lon + .0001, lat + .0001], [lon + .0001, lat - .0001], [lon - .0001, lat - .0001]]
      ];
      body.features.push(other);
      return body;
    };
    const g = await getGarasjeGrunnlag(milde);
    assert.equal(g.eiendomsgrenser.length, 2);
    assert.equal(g.eiendomsgrenser[0].ringer.length, 2);
  });
  await test("Teig delt av flere matrikkelenheter gir ikke eget tomteareal", async () => {
    lokaleTeiger = () => {
      const body = localResponse();
      body.features[0].properties.ANTALL_GID = 2;
      return body;
    };
    const g = await getGarasjeGrunnlag(milde);
    assert.equal(g.arealberegning.tomtearealM2, null);
    assert.equal(g.bebyggelse.status, "uavklart");
  });
  await test("Manglende oppgitt areal fjerner ikke gyldig lokal geometri", async () => {
    lokaleTeiger = () => {
      const body = localResponse();
      return { ...body, features: body.features.map(f => ({ ...f, properties: { ...f.properties, AREAL: null } })) };
    };
    const g = await getGarasjeGrunnlag(milde);
    assert.equal(g.kilder.find(k => k.id === "eiendomsgrenser")?.status, "ok");
    assert.equal(g.eiendomsgrenser[0].registrertArealM2, undefined);
    assert(g.arealberegning.tomtearealM2! > 900);
  });
  await test("Null registrerte identiteter er ukjent, ikke en enkelt matrikkelenhet", async () => {
    lokaleTeiger = () => {
      const body = localResponse();
      body.features[0].properties.ANTALL_GID = 0;
      return body;
    };
    const g = await getGarasjeGrunnlag(milde);
    assert.equal(g.kilder.find(k => k.id === "eiendomsgrenser")?.status, "ok");
    assert.equal(g.eiendomsgeojson?.features[0].properties.antallMatrikkelenheter, 0);
    assert.equal(g.arealberegning.tomtearealM2, null);
    assert.equal(g.bebyggelse.bebygd, null);
  });
  const corruptLocal: [string, () => unknown][] = [
    ["HTTP-feil", () => Response.json({ feil: "Filen kan ikke leses" }, { status: 502 })],
    ["tom kropp", () => null],
    ["feil kommune", () => ({ ...localResponse(), kommunenummer: "0301" })],
    ["feil kildeformat", () => ({ ...localResponse(), kilde: { koordinatsystem: "EPSG:25832" } })],
    ["feil matrikkelenhet", () => localResponse(true)],
    ["duplikat", () => { const b = localResponse(); b.features.push(b.features[0]); return b; }],
    ["åpen ring", () => { const b = localResponse(); b.features[0].geometry.coordinates[0].pop(); return b; }],
    ["ugyldig areal", () => { const b = localResponse(); b.features[0].properties.AREAL = -1; return b; }]
  ];
  for (const [name, corrupt] of corruptLocal) {
    await test(`Lokal ${name} gir feil, ikke stille bytte til API`, async () => {
      lokaleTeiger = corrupt;
      urls.length = 0;
      const g = await getGarasjeGrunnlag(milde);
      assert.equal(g.kilder.find(k => k.id === "eiendomsgrenser")?.status, "feil");
      assert.equal(g.arealberegning.tomtearealM2, null);
      assert(!urls.some(url => url.hostname === "api.kartverket.no"));
    });
  }
  lokaleTeiger = null;
  await test("Begge ekte eiendommer får lokale naboteiger uten å endre eget areal", async () => {
    const store = createTeigStore();
    lokaleTeiger = url => store.getTeiger(parseTeigQuery(url.searchParams));
    lokaleNabotomter = url => store.getNaboteiger(parseNaboteigQuery(url.searchParams));
    for (const [adresse, expected] of [[milde, 3], [krakenes, 15]] as const) {
      urls.length = 0;
      const g = await getGarasjeGrunnlag(adresse);
      assert.equal(g.nabotomter?.kilde.status, "ok", g.nabotomter?.kilde.merknad);
      assert.equal(g.nabotomter?.tomter.length, expected);
      assert.equal(g.nabotomter?.kilde.fil, "matrikkel_bk_25.json");
      assert.equal(g.nabotomter?.kilde.koordinatsystem, "EPSG:4326");
      assert(g.nabotomter?.tomter.every(t => t.teig?.gnr !== adresse.gardsnummer || t.teig?.bnr !== adresse.bruksnummer));
      assert(g.nabotomter?.tomter.every(t => t.kvalitetsklasse === undefined && t.teig?.tvist === undefined));
      assert.equal(g.eiendomsgrenser.length, 1);
      assert(!g.kilder.some(k => k.id === "nabotomter"));
      assert(!urls.some(url => url.hostname === "api.kartverket.no"));
      const withNeighbours = g.nabotomter;
      g.nabotomter = { tomter: [], kilde: { ...withNeighbours!.kilde, status: "feil" } };
      const without = evaluateGarasje(tiltak, g);
      g.nabotomter = withNeighbours;
      assert.deepEqual(evaluateGarasje(tiltak, g), without);
      const baseline = g.arealberegning;
      const localRead: (url: URL) => unknown = url => store.getNaboteiger(parseNaboteigQuery(url.searchParams));
      lokaleNabotomter = () => Response.json({ feil: "Filen forsvant" }, { status: 502 });
      const failed = await getGarasjeGrunnlag(adresse);
      assert.equal(failed.nabotomter?.kilde.status, "feil");
      assert.deepEqual(failed.arealberegning, baseline);
      assert.deepEqual(failed.eiendomsgrenser, g.eiendomsgrenser);
      lokaleNabotomter = localRead;
    }
    lokaleTeiger = null;
    lokaleNabotomter = null;
  });
  await test("Valgt matrikkelenhet utelates med alle seksjoner, andre festenummer beholdes", async () => {
    lokaleTeiger = () => localResponse();
    lokaleNabotomter = url => {
      const body = localNeighbourResponse(url), neighbour = body.features[0];
      const selected = localResponse().features[0];
      const section = { ...selected, id: 900, properties: { ...selected.properties, OBJECTID: 900, SNR: 8 } };
      const feste = { ...selected, id: 901, properties: { ...selected.properties, OBJECTID: 901, FNR: 1 } };
      const otherGnr = { ...selected, id: 903, properties: { ...selected.properties, OBJECTID: 903, GNR: 106 } };
      const distant = { ...neighbour, id: 902, properties: { ...neighbour.properties, OBJECTID: 902 },
        geometry: { ...neighbour.geometry, coordinates: neighbour.geometry.coordinates.map(r => r.map(([x, y]) => [x + 1, y])) } };
      return { ...body, eiere: ["må ikke ut"], features: [
        selected, section, feste, otherGnr, distant,
        { ...neighbour, properties: { ...neighbour.properties, eiere: ["må ikke ut"], planGodkjent: true, kvalitetsklasse: "Grønt" } }
      ] };
    };
    const g = await getGarasjeGrunnlag(milde);
    assert.equal(g.nabotomter?.kilde.status, "ok");
    assert.deepEqual(g.nabotomter?.tomter.map(t => t.kildeObjektId), [901, 903, 987]);
    assert.equal(g.nabotomter?.tomter[0].teig?.fnr, 1);
    assert.equal(g.nabotomter?.tomter[2].registrertArealM2, 900);
    assert.equal(g.nabotomter?.tomter[2].kvalitetsklasse, undefined);
    assert(!JSON.stringify(g.nabotomter).includes("må ikke ut"));
    assert(!JSON.stringify(g.nabotomter).includes("planGodkjent"));
    lokaleNabotomter = null;
  });
  const brokenNeighbours: [string, (url: URL) => unknown][] = [
    ["kildefeil", () => Response.json({ feil: "Uleselig fil" }, { status: 502 })],
    ["avkortet", url => ({ ...localNeighbourResponse(url), avkortet: true })],
    ["ukjent fullstendighet", url => ({ ...localNeighbourResponse(url), avkortet: undefined })],
    ["feil kommune", url => ({ ...localNeighbourResponse(url), kommunenummer: "0301" })],
    ["feil koordinatsystem", url => { const b = localNeighbourResponse(url); b.kilde.koordinatsystem = "EPSG:25832"; return b; }],
    ["over 200 treff", url => { const b = localNeighbourResponse(url); b.features = Array(201).fill(b.features[0]); return b; }],
    ["duplikat", url => { const b = localNeighbourResponse(url); b.features.push(b.features[0]); return b; }],
  ];
  for (const [name, create] of brokenNeighbours) {
    await test(`Nabokildens ${name} vises som feil uten å endre vurderingen eller bytte kilde`, async () => {
      lokaleNabotomter = null;
      const baseline = await getGarasjeGrunnlag(milde);
      lokaleNabotomter = create;
      urls.length = 0;
      const g = await getGarasjeGrunnlag(milde);
      assert.equal(g.nabotomter?.kilde.status, "feil");
      assert.deepEqual(g.nabotomter?.tomter, []);
      assert.deepEqual(g.arealberegning, baseline.arealberegning);
      assert.deepEqual(evaluateGarasje(tiltak, g), evaluateGarasje(tiltak, baseline));
      assert(!urls.some(url => url.hostname === "api.kartverket.no"));
    });
  }
  await test("Tom lokal naboliste bruker dokumentert områdesøk med begrenset radius", async () => {
    lokaleNabotomter = url => ({ ...localNeighbourResponse(url), features: localResponse().features });
    apiNabotomter = () => {
      const selected = eiendomResponse(false).features[0];
      const section = { ...selected, properties: { ...selected.properties, lokalid: 99, seksjonsnummer: 3 } };
      const neighbour = { ...selected, properties: { ...selected.properties, lokalid: 100, bruksnummer: 210, matrikkelnummertekst: "105/210",
        eiere: ["må ikke ut"], planGodkjent: true } };
      const foreign = { ...selected, properties: { ...selected.properties, lokalid: 101, kommunenummer: "0301" } };
      const anlegg = { ...selected, properties: { ...selected.properties, lokalid: 102, objekttype: "Anleggsprojeksjonsflate" } };
      const distant = { ...neighbour, properties: { ...neighbour.properties, lokalid: 103 },
        geometry: { ...neighbour.geometry, coordinates: neighbour.geometry.coordinates.map(r => r.map(([x, y]) => [x + 1, y])) } };
      return { type: "FeatureCollection", features: [selected, section, neighbour, foreign, anlegg, distant] };
    };
    urls.length = 0;
    const g = await getGarasjeGrunnlag(milde);
    assert.equal(g.nabotomter?.tomter.length, 1, g.nabotomter?.kilde.merknad);
    assert.equal(g.nabotomter?.tomter[0].teigId, 100);
    assert.equal(g.nabotomter?.tomter[0].kvalitetsklasse, "Grønt");
    assert.equal(g.nabotomter?.tomter[0].oppdatert, "2025-06-18T16:10:10");
    assert.equal(g.nabotomter?.kilde.status, "ok");
    assert.equal(g.nabotomter?.kilde.fil, undefined);
    assert.equal(g.nabotomter?.kilde.koordinatsystem, "EPSG:4258");
    assert(g.nabotomter?.kilde.url.startsWith("https://api.kartverket.no/eiendom/v1/punkt/omrader?"));
    assert(g.nabotomter?.kilde.merknad?.includes("matrikkel_bk_25.json"));
    assert(!JSON.stringify(g.nabotomter).includes("må ikke ut"));
    assert(!JSON.stringify(g.nabotomter).includes("planGodkjent"));
    assert.equal(urls.filter(url => url.hostname === "api.kartverket.no").length, 1);
  });
  for (const [name, response] of [
    ["tom liste", { type: "FeatureCollection", features: [] }],
    ["over treffgrensen", { type: "FeatureCollection", features: Array(201).fill(eiendomResponse(false).features[0]) }],
    ["avkortet respons", { type: "FeatureCollection", features: [], exceededTransferLimit: true }],
    ["feil projeksjon", { type: "FeatureCollection", features: [], crs: { type: "name", properties: { name: "EPSG:25832" } } }],
    ["ukjent struktur", { eiendom: [] }],
    ["kildefeil", Response.json({ feil: "Nede" }, { status: 503 })],
  ] as const) {
    await test(`Nabokartets API-reserve håndterer ${name} eksplisitt`, async () => {
      apiNabotomter = () => response;
      const g = await getGarasjeGrunnlag(milde);
      assert.equal(g.nabotomter?.kilde.status, name === "tom liste" ? "ingen_treff" : "feil");
      assert.deepEqual(g.nabotomter?.tomter, []);
      assert.equal(g.eiendomsgrenser.length, 1);
    });
  }
  await test("API-naboteig uten kvalitet beholder ukjent, også utenfor Bergen", async () => {
    lokaleTeiger = null;
    lokaleNabotomter = () => ({
      kommunenummer: "0301", kildestatus: "ikke_dekket", type: "FeatureCollection", features: [], avkortet: false,
      kilde: { navn: "Bergen-uttrekk", fil: null, uttrekksaar: null, koordinatsystem: "EPSG:4326", syntetisk: false },
    });
    apiNabotomter = () => {
      const body = osloEiendomResponse(), p = body.features[0].properties;
      p.bruksnummer = 340;
      p.matrikkelnummertekst = "209/340";
      return { ...body, features: [{ ...body.features[0], properties: { ...p, "nøyaktighetsklasseteig": null } }] };
    };
    const g = await getGarasjeGrunnlag(oslo);
    assert.equal(g.nabotomter?.kilde.status, "ok", g.nabotomter?.kilde.merknad);
    assert.equal(g.nabotomter?.tomter[0].teig?.bnr, 340);
    assert.equal(g.nabotomter?.tomter[0].kvalitetsklasse, undefined);
    assert.equal(g.nabotomter?.kilde.fil, undefined);
    lokaleNabotomter = null;
    apiNabotomter = null;
  });
  await test("Tidsavbrudd gir feil uten syntetisk reserve", async () => {
    process.env.NODE_ENV = "test";
    process.env.GARASJE_TIMEOUT_MS = "15";
    globalThis.fetch = (_input, options) => new Promise((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Tidsgrensen ble ikke håndhevet")), 1000);
      options!.signal!.addEventListener("abort", () => { clearTimeout(timer); reject(options!.signal!.reason); }, { once: true });
    });
    await assert.rejects(searchGarasjeAdresser("Litle Milde 65"), errorStatus(502));
    const g = await getGarasjeGrunnlag(milde);
    assert(g.kilder.filter(k => k.id !== "adresse").every(k => k.status === "feil"));
    assert.equal(g.bebyggelse.bebygd, null);
    assert.equal(evaluateGarasje(tiltak, g).utfall, "maa_avklares");
    assert.equal(evaluateGarasje(tiltak, g).sjekker.find(s => s.id === "plassering")?.status, "uavklart");
    globalThis.fetch = fakeFetch;
  });
  await test("Et tidsavbrudd gjentas én gang, og et andre forsøk som svarer teller", async () => {
    // Bergens bygningslag svarer nesten alltid på rundt 120 ms, men har en hale
    // over åtte sekunder noen ganger i timen. Uten gjenforsøket falt «Bebygd
    // eiendom» til uavklart i de tilfellene, og et tiltak som oppfyller vilkårene
    // fikk «må avklares» i stedet for fritak.
    process.env.NODE_ENV = "test";
    process.env.GARASJE_TIMEOUT_MS = "15";
    let forsok = 0;
    globalThis.fetch = ((input: any, options: any) => {
      forsok++;
      if (forsok > 1) return fakeFetch(input, options);
      return new Promise((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Tidsgrensen ble ikke håndhevet")), 1000);
        options!.signal!.addEventListener("abort", () => { clearTimeout(timer); reject(options!.signal!.reason); }, { once: true });
      });
    }) as typeof fetch;
    const treff = await searchGarasjeAdresser("Litle Milde 65");
    assert.equal(treff.length, 1, "andre forsøk skal brukes når det første ble avbrutt");
    assert.equal(forsok, 2, "ett gjenforsøk, ikke flere");

    // Og to tidsavbrudd er fortsatt en kildefeil: gjenforsøket skjuler ingenting.
    forsok = 0;
    globalThis.fetch = ((_input: any, options: any) => new Promise((_resolve, reject) => {
      forsok++;
      const timer = setTimeout(() => reject(new Error("Tidsgrensen ble ikke håndhevet")), 1000);
      options!.signal!.addEventListener("abort", () => { clearTimeout(timer); reject(options!.signal!.reason); }, { once: true });
    })) as typeof fetch;
    await assert.rejects(searchGarasjeAdresser("Litle Milde 65"), errorStatus(502));
    assert.equal(forsok, 2);
    // Meldingen havner i kilde.merknad og dermed foran innbyggeren, så den skal si
    // at kilden var treg og at et nytt forsøk kan hjelpe - ikke at den er i stykker.
    const treg = await getGarasjeGrunnlag(milde);
    const bygningskilde = treg.kilder.find(k => k.id === "bygninger");
    assert.equal(bygningskilde?.status, "feil");
    assert.match(bygningskilde!.merknad!, /svarte ikke i tid, heller ikke på et nytt forsøk/);
    assert.match(bygningskilde!.merknad!, /Kjør sjekken på nytt/);
    assert(!/kunne ikke levere et gyldig svar/.test(bygningskilde!.merknad!));

    // En 502 fra kilden er kildens svar og skal ikke gjentas.
    forsok = 0;
    globalThis.fetch = (async () => { forsok++; return Response.json({ feil: "Nede" }, { status: 502 }); }) as typeof fetch;
    await assert.rejects(searchGarasjeAdresser("Litle Milde 65"), errorStatus(502));
    assert.equal(forsok, 1, "bare tidsavbrudd gjentas");
    globalThis.fetch = fakeFetch;
  });
  await test("Feil under lesing av svarkroppen blir 502", async () => {
    globalThis.fetch = async () => new Response(new ReadableStream({ start(c) { c.error(new Error("Brutt forbindelse")); } }));
    await assert.rejects(searchGarasjeAdresser("Litle Milde 65"), errorStatus(502));
    globalThis.fetch = fakeFetch;
  });
  await test("Kildeoverstyring tillates bare for lokal testserver", async () => {
    process.env.NODE_ENV = "production";
    process.env.GARASJE_ADRESSE_URL = "http://127.0.0.1:9999/sok";
    await assert.rejects(searchGarasjeAdresser("Litle Milde 65"), errorStatus(500));
    process.env.NODE_ENV = "test";
    process.env.GARASJE_ADRESSE_URL = "https://example.invalid/sok";
    await assert.rejects(searchGarasjeAdresser("Litle Milde 65"), errorStatus(500));
  });
  await test("Ingen oppdiktede planregler eller runtime-fixture er igjen", async () => {
    await assert.rejects(access(new URL("../data/garasje-grunnlag.json", import.meta.url)), { code: "ENOENT" });
    const code = await readFile(new URL("../apps/sandbox-backend/src/garasje-data.ts", import.meta.url), "utf8");
    assert(!/readFile|seedDir|datamodus|scenario|readSynthetic/.test(code));
  });
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
console.log(`Garasjesjekk: ${count} kontroller bestått uten nettverk eller kjørende tjenester.`);
