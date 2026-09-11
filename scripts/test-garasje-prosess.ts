import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { signJwt } from "../apps/digdir-mock/src/jwt.ts";
import type { GarasjeAdresse, GarasjeGrunnlag, GarasjeVurdering } from "../apps/shared/garasje.ts";
import type { ProsessDefinisjon, ProsessSteg, Prosessoekt } from "../apps/sandbox-backend/src/types.ts";

const stateDir = path.resolve("state", `test-garasje-prosess-${randomUUID()}`);
await mkdir(stateDir, { recursive: true });
process.env.STATE_DIR = stateDir;
process.env.AUTH_ENFORCE = "true";
process.env.DIGDIR_BASE_URL = "http://garasje-prosess-digdir.test";
process.env.DIGDIR_ISSUER = process.env.DIGDIR_BASE_URL;
process.env.MATRIKKEL_BASE_URL = "http://garasje-prosess-matrikkel.test";
process.env.PLAN_BASE_URL = "http://garasje-prosess-plan.test";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const kid = "garasje-prosess-test";
const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" };
const addresses: GarasjeAdresse[] = [
  { adressetekst: "Litle Milde 65", kommunenummer: "4601", gardsnummer: 105, bruksnummer: 209, festenummer: 0, undernummer: 0, punkt: { lat: 60.2536577976675, lon: 5.255241147052527 } },
  { adressetekst: "Kråkenestoppen 60", kommunenummer: "4601", gardsnummer: 20, bruksnummer: 1413, festenummer: 0, undernummer: 0, punkt: { lat: 60.33304009061054, lon: 5.315468234797857 } }
];
const people: { personId: string; syntetiskFodselsnummer: string }[] =
  JSON.parse(await readFile(new URL("../data/personer.json", import.meta.url), "utf8"));
type Result = { melding: string; grunnlag: GarasjeGrunnlag; vurdering: GarasjeVurdering; sporingsId: string };
type Session = Omit<Prosessoekt, "resultaterRaa"> & {
  avslutning?: string; sluttmelding?: string; aktivtSteg: ProsessSteg;
  aktivtStegFullfort: boolean; resultater: Record<string, Result>;
};
const realFetch = globalThis.fetch;
let backendUrl = "";
let failAddress = false;
let failOwnership = false;
let revokeOwnership = false;
let failPlans = false;
let failBuildings = false;
let ownershipReads = 0;
let publicReads = 0;

globalThis.fetch = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (backendUrl && url.origin === backendUrl) return realFetch(input, options);
  if (url.hostname === "garasje-prosess-digdir.test") {
    assert.equal(url.pathname, "/jwks");
    return Response.json({ keys: [jwk] });
  }
  // Ingen kommuneplandekning i denne fixturen, som for teigene over. Uten en egen
  // gren her ville planoppslaget falt gjennom til ArcGIS-grenen nederst, fått et
  // lagmetadatasvar og blitt en kildefeil ingen la merke til.
  if (url.hostname === "garasje-prosess-plan.test") {
    assert(url.pathname.startsWith("/mock/plan/"), url.pathname);
    return Response.json({
      kommunenummer: url.searchParams.get("kommunenummer"), kildestatus: "ikke_dekket",
      kilde: {
        navn: "Bergen kommuneplan 2018", planId: null, versjon: null, filer: [],
        uttrekksaar: null, koordinatsystem: "EPSG:4326", syntetisk: false,
      },
      type: "FeatureCollection", klippetTilUtsnitt: true, features: []
    });
  }
  if (url.hostname === "garasje-prosess-matrikkel.test") {
    if (url.pathname === "/mock/matrikkel/teiger" || url.pathname === "/mock/matrikkel/naboteiger") {
      return Response.json({
        kommunenummer: url.searchParams.get("kommunenummer"), kildestatus: "ikke_dekket",
        kilde: { navn: "Lokalt teiguttrekk", fil: null, uttrekksaar: null, koordinatsystem: "EPSG:4326", syntetisk: false },
        type: "FeatureCollection", features: [], ...(url.pathname === "/mock/matrikkel/naboteiger" ? { avkortet: false } : {})
      });
    }
    assert.equal(url.pathname, "/mock/matrikkel/eiendommer");
    ownershipReads++;
    if (failOwnership) return Response.json({ feil: "Utilgjengelig" }, { status: 503 });
    if (revokeOwnership) return Response.json([]);
    const index = url.searchParams.get("personId") === "person-396" ? 1 : 0;
    const a = addresses[index];
    return Response.json([{
      matrikkelId: `garasje-fixture-${index}`, adresse: a.adressetekst,
      gnr: a.gardsnummer, bnr: a.bruksnummer, kommune: "BERGEN", kommunenummer: "4601",
      adressenavn: index ? "Kråkenestoppen" : "Litle Milde", bruksenhetstype: "bolig"
    }]);
  }
  assert(["ws.geonorge.no", "api.kartverket.no", "kart.bergen.kommune.no"].includes(url.hostname),
    `Uventet nettverk: ${url.origin}`);
  assert.equal(new Headers(options?.headers).get("Authorization"), null);
  assert(!url.href.includes("person-") && !url.searchParams.has("personId"));
  assert(!people.some(person => url.href.includes(person.syntetiskFodselsnummer)));
  publicReads++;
  if (url.hostname === "ws.geonorge.no") {
    if (failAddress) return Response.json({ feil: "Utilgjengelig" }, { status: 503 });
    const matches = addresses.filter(a => a.adressetekst.toLocaleLowerCase("nb-NO")
      === (url.searchParams.get("sok") || "").toLocaleLowerCase("nb-NO"));
    return Response.json({
      metadata: { totaltAntallTreff: matches.length },
      adresser: matches.map(a => ({ ...a, representasjonspunkt: { ...a.punkt, epsg: "EPSG:4258" } }))
    });
  }
  const second = url.hostname === "api.kartverket.no"
    ? url.searchParams.get("matrikkelnummer")?.includes("20/1413") || url.searchParams.get("bruksnummer") === "1413"
      || Number(url.searchParams.get("nord")) > 60.3
    : Number(url.searchParams.get("geometry")?.split(",")[1]) > 60.3;
  const a = addresses[second ? 1 : 0];
  const { lat: y, lon: x } = a.punkt;
  const ring = [[x - .001, y - .001], [x + .001, y - .001], [x + .001, y + .001], [x - .001, y + .001], [x - .001, y - .001]];
  if (url.hostname === "api.kartverket.no") {
    return Response.json({
      type: "FeatureCollection", features: [{
        type: "Feature", geometry: { type: "Polygon", coordinates: [ring] },
        properties: {
          kommunenummer: "4601", gardsnummer: a.gardsnummer,
          bruksnummer: a.bruksnummer + (url.pathname === "/eiendom/v1/punkt/omrader" ? 1 : 0),
          festenummer: 0, seksjonsnummer: 0, lokalid: second ? 258839374 : 259953783,
          objekttype: "Teig", matrikkelnummertekst: `${a.gardsnummer}/${a.bruksnummer}`,
          "nøyaktighetsklasseteig": "Grønt"
        }
      }]
    });
  }
  const pathname = decodeURIComponent(url.pathname);
  const source = pathname.includes("Arealformål") ? "kpa" : pathname.includes("Reguleringsplaner") ? "plan" : "bygning";
  const fields = {
    kpa: ["KPAREALFORMAL", "BESKRIVELSE", "PLANID"], plan: ["PLANID", "PLANNAVN"],
    bygning: ["OBJECTID", "OBJTYPE", "BYGGNR", "BYGGTYP_NBR", "BYGGTYPE", "BYGGSTAT", "STATUS"]
  };
  if (failPlans && source === "kpa") return Response.json({ error: { code: 503 } });
  if (failBuildings && source === "bygning") return Response.json({ error: { code: 503 } });
  if (!pathname.endsWith("/query")) {
    return Response.json({ geometryType: "esriGeometryPolygon", capabilities: "Query,Map", fields: fields[source].map(name => ({ name })) });
  }
  const buildingRing = ring.map(([lon, lat]) => [x + (lon - x) / 4, y + (lat - y) / 4]);
  const features = source === "kpa" ? [{
    attributes: { KPAREALFORMAL: second ? 1001 : 5100, BESKRIVELSE: second ? "Øvrig byggesone" : "LNF", PLANID: "65270000" }
  }] : source === "plan" ? [] : [{
    attributes: { OBJECTID: 1, OBJTYPE: "Bygning", BYGGNR: 100000001, BYGGTYP_NBR: 111, BYGGTYPE: "Enebolig", BYGGSTAT: "TB", STATUS: "Tatt i bruk" },
    geometry: { rings: [buildingRing] }
  }];
  return Response.json({ geometryType: "esriGeometryPolygon", spatialReference: { wkid: 4258 }, features });
};

const { handleRequest } = await import("../apps/sandbox-backend/src/routes.ts");
const { normalizeProsess, readState } = await import("../apps/sandbox-backend/src/state.ts");
const { lagreStegSvar, runStegHandling, buildProsessoektRespons } = await import("../apps/sandbox-backend/src/prosess.ts");
const { runRessurs } = await import("../apps/sandbox-backend/src/ressurser.ts");
const { buildGarasjeSok, buildGarasjeTiltak, normalizeGarasjeSvar } = await import("../apps/sandbox-backend/src/garasje-prosess.ts");
const server = createServer(handleRequest);
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert(address && typeof address !== "string");
backendUrl = `http://127.0.0.1:${address.port}`;
function token(personId: string): string {
  const person = people.find(p => p.personId === personId);
  assert(person);
  const now = Math.floor(Date.now() / 1000);
  return signJwt({
    iss: `${process.env.DIGDIR_ISSUER}/idporten`, aud: "sandbox-backend", pid: person.syntetiskFodselsnummer,
    acr: "idporten-loa-high", client_id: "garasje-prosess-test", iat: now, exp: now + 300
  }, { kid, privateKey });
}
const tokens = [token("person-395"), token("person-396")];
async function request<T>(route: string, body?: unknown, status = 200, index = 0): Promise<T> {
  const response = await fetch(`${backendUrl}${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(index >= 0 ? { Authorization: `Bearer ${tokens[index]}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const result = await response.json();
  assert.equal(response.status, status, `${route}: ${JSON.stringify(result)}`);
  return result as T;
}
function answer(index = 0): Record<string, unknown> {
  const a = addresses[index];
  return {
    adresse: a.adressetekst, gnr: a.gardsnummer, bnr: a.bruksnummer,
    lat: a.punkt.lat + .0001, lon: a.punkt.lon,
    eiendomBekreftet: true, plasseringBekreftet: true,
    bra: "49,5", bya: 50, gesimshoyde: 3, monehoyde: 4, etasjer: 1,
    frittliggende: true, beboelse: false, kjeller: false,
    avstandNabogrense: 1, avstandBygning: 1, overVannAvlop: false
  };
}
async function start(index = 0): Promise<Session> {
  const session = await request<Session>("/api/prosessoekter", { prosessId: "garasjesjekk", personId: `person-${395 + index}` }, 201, index);
  assert.equal(session.avslutning, "veiledning");
  const base = `/api/prosessoekter/${session.oektsId}`;
  await request(`${base}/handling`, {}, 200, index);
  await request(`${base}/neste`, {}, 200, index);
  await request(`${base}/neste`, {}, 400, index);
  const mine = await request<{ oekt: Session; resultat: { eiendommer: { adresse: string }[] } }>(`${base}/handling`, {}, 200, index);
  assert.equal(mine.resultat.eiendommer[0].adresse, addresses[index].adressetekst);
  const next = await request<Session>(`${base}/neste`, {}, 200, index);
  assert.equal(next.aktivtSteg.id, "garasje-prosjekt");
  assert.equal(next.aktivtSteg.type === "QUESTION" && next.aktivtSteg.visning, "garasje");
  return next;
}
async function ready(index = 0, fields = answer(index)): Promise<Session> {
  const session = await start(index);
  const base = `/api/prosessoekter/${session.oektsId}`;
  const saved = await request<Session>(`${base}/svar`, { svar: fields }, 200, index);
  assert(saved.aktivtStegFullfort);
  return request<Session>(`${base}/neste`, {}, 200, index);
}
try {
  const definitions = await request<ProsessDefinisjon[]>("/api/prosesser");
  assert.equal(definitions[0]?.id, "redusert-foreldrebetaling-barnehage", "Eksisterende standardvalg må beholdes");
  assert.equal(definitions[1]?.id, "sfo-moderasjon", "Eksisterende menyrekkefølge må beholdes");
  const definition = definitions.find(p => p.id === "garasjesjekk");
  assert(definition);
  assert.equal(definition.navn, "Kan du bygge uten å søke?");
  assert.equal(definition.redigering.status, "publisert");
  assert.deepEqual(definition.steg.map(s => s.type), ["INFO", "DATA_FETCH", "QUESTION", "DATA_FETCH"]);
  const question = definition.steg[2];
  assert(question.type === "QUESTION" && !question.felter?.some(field => field.id === "bebygdEiendom"),
    "Bebyggelse skal hentes fra eiendommen, ikke spørres om på nytt");
  assert.throws(() => normalizeProsess({ ...definition, avslutning: "soknad" }));
  assert.throws(() => normalizeProsess({ ...definition, steg: [...definition.steg, { id: "send", type: "SUBMIT" }] }));
  assert.throws(() => normalizeProsess({ ...definition, steg: [{ id: "intro", type: "INFO" }] }));
  assert.throws(() => normalizeProsess({ id: "feil", steg: [{ type: "INFO", visning: "garasje" }] }));
  await request("/api/prosessoekter", { prosessId: definition.id, personId: "person-395" }, 401, -1);
  await request("/api/prosessoekter", { prosessId: definition.id, personId: "person-396" }, 403);
  await request("/api/garasje/prosess/sjekk?personId=person-395", undefined, 400);
  assert.equal(publicReads, 0);

  const edit = await start();
  const editBase = `/api/prosessoekter/${edit.oektsId}`;
  await request(`${editBase}/neste`, {}, 400);
  for (const route of ["svar", "handling"]) {
    for (const invalid of [
      { ...answer(), bra: "" }, { ...answer(), bra: "40m2" }, { ...answer(), bra: -1 },
      { ...answer(), lat: null }, { ...answer(), etasjer: 1.2 },
      { ...answer(), gesimshoyde: 5 }, { ...answer(), avstandNabogrense: -1 },
      { ...answer(), frittliggende: "kanskje" }, { ...answer(), eiendomBekreftet: false },
      { ...answer(), plasseringBekreftet: null }, { ...answer(), planGodkjent: true },
      { ...answer(), grunnlag: { kommuneplan: "oppfylt" } }
    ]) await request(`${editBase}/${route}`, { svar: invalid }, 400);
  }
  const untouched = await request<Session>(editBase);
  assert.equal(untouched.svar["garasje-prosjekt"], undefined);
  assert.equal(untouched.status, "AKTIV");
  const saved = await request<{ oekt: Session }>(`${editBase}/handling`, { svar: answer() });
  assert.equal((saved.oekt.svar["garasje-prosjekt"] as Record<string, unknown>).bra, 49.5);
  assert.equal((saved.oekt.svar["garasje-prosjekt"] as Record<string, unknown>).frittliggende, "ja");
  assert.equal((saved.oekt.svar["garasje-prosjekt"] as Record<string, unknown>).bebygdEiendom, undefined);
  await request(`${editBase}/neste`, {});
  await request(`${editBase}/forrige`, {});
  await request(`${editBase}/svar`, { svar: { ...answer(), bra: 50.01 } });
  await request(`${editBase}/neste`, {});
  const changed = await request<{ oekt: Session; resultat: Result }>(`${editBase}/handling`, {});
  assert.equal(changed.resultat.vurdering.utfall, "soknadspliktig");
  assert.equal(changed.oekt.status, "FULLFORT", "Søknadsplikt er veiledning, ikke avvist søknad");

  for (const index of [0, 1]) {
    const session = await ready(index);
    const base = `/api/prosessoekter/${session.oektsId}`;
    await request(base, undefined, 403, 1 - index);
    await request(`${base}/handling`, {}, 403, 1 - index);
    const before = ownershipReads;
    const result = await request<{ oekt: Session; resultat: Result }>(`${base}/handling`, {}, 200, index);
    assert.equal(ownershipReads, before + 1, "Eierforhold må kontrolleres på nytt");
    assert.equal(result.oekt.status, "FULLFORT");
    assert.equal(result.oekt.sluttmelding, "Veiledningen er ferdig. Ingen søknad er sendt.");
    assert.equal(result.resultat.vurdering.nasjonaltUnntak, "oppfylt", JSON.stringify(result.resultat.grunnlag.bebyggelse));
    // Ikke fritak, og to forhold hindrer det hver for seg: svaret oppgir akkurat
    // 1 meter til nabogrensen, mens KPA2018 § 31.3-vilkåret krever mer enn 1 meter,
    // og fixturen har med hensikt ingen kommuneplandekning, så planflatene er
    // ikke sjekket. Begge er pinnet her, for ellers ville et fritak i denne økten
    // se ut som et valgt utfall i stedet for et utilgjengelig et.
    // `pnpm test:flytkart` dekker hvitelisten for fritaket vilkår for vilkår.
    assert.equal(result.resultat.vurdering.utfall, "maa_avklares");
    assert.equal(result.resultat.vurdering.sjekker.find(s => s.id === "meldeplikt"), undefined);
    assert(result.resultat.vurdering.sjekker.some(s => s.id === "kilde-planflater"));
    assert.equal(result.resultat.grunnlag.adresse.bruksnummer, addresses[index].bruksnummer);
    assert.equal(result.resultat.grunnlag.nabotomter?.tomter[0].teig?.bnr, addresses[index].bruksnummer + 1);
    assert.equal(result.resultat.grunnlag.nabotomter?.kilde.status, "ok");
    assert.equal(result.resultat.grunnlag.punkt.lat, Number(answer(index).lat));
    const areal = result.resultat.grunnlag.arealberegning;
    assert(areal.tomtearealM2 !== null && areal.tomtearealM2 > 0);
    assert(areal.kartlagtBebygdArealM2 !== null && areal.kartlagtBebygdArealM2 > 0
      && areal.kartlagtBebygdArealM2 < areal.tomtearealM2);
    assert(areal.kartlagtAndelProsent !== null && areal.kartlagtAndelProsent > 0 && areal.kartlagtAndelProsent < 100);
    assert(areal.metode && areal.kilde && areal.forbehold.length);
    assert.equal(result.resultat.grunnlag.kilder.find(k => k.id === "kpa-bestemmelser")?.status, "ikke_sjekket");
    assert(result.resultat.vurdering.sjekker.every(s => s.forklaring && new URL(s.kilde)));
    const stored = await request<Session>(base, undefined, 200, index);
    assert.deepEqual(stored.resultater["garasje-vurdering"], result.resultat);
    for (const route of ["handling", "neste", "forrige", "svar"]) {
      await request(`${base}/${route}`, { svar: answer(index) }, 400, index);
    }
  }

  const unknown = await ready(0, { ...answer(), frittliggende: null, overVannAvlop: "vet-ikke", avstandNabogrense: null });
  const normalized = unknown.svar["garasje-prosjekt"] as Record<string, unknown>;
  assert.equal(normalized.avstandNabogrense, "vet-ikke");
  assert.equal(normalized.frittliggende, "vet-ikke");
  const unknownResult = await request<{ resultat: Result }>(`/api/prosessoekter/${unknown.oektsId}/handling`, {});
  assert.equal(unknownResult.resultat.vurdering.nasjonaltUnntak, "uavklart");
  assert.equal(unknownResult.resultat.vurdering.utfall, "maa_avklares");

  const foreign = await ready(0, answer(1));
  const beforeForeign = publicReads;
  await request(`/api/prosessoekter/${foreign.oektsId}/handling`, {}, 403);
  assert.equal(publicReads, beforeForeign, "Andres eiendom må stoppes før offentlige oppslag");
  assert.equal((await request<Session>(`/api/prosessoekter/${foreign.oektsId}`)).status, "AKTIV");

  const retry = await ready();
  const retryBase = `/api/prosessoekter/${retry.oektsId}`;
  for (const failure of ["ownership", "revoked", "address"]) {
    failOwnership = failure === "ownership";
    revokeOwnership = failure === "revoked";
    failAddress = failure === "address";
    await request(`${retryBase}/handling`, {}, failure === "revoked" ? 403 : 502);
    const active = await request<Session>(retryBase);
    assert.equal(active.status, "AKTIV");
    assert.equal(active.aktivtStegFullfort, false);
    assert.equal(active.resultater["garasje-vurdering"], undefined);
    assert.equal(active.sluttmelding, undefined);
  }
  failAddress = false;
  failPlans = true;
  const degraded = await request<{ oekt: Session; resultat: Result }>(`${retryBase}/handling`, {});
  assert.equal(degraded.oekt.status, "FULLFORT");
  assert.equal(degraded.resultat.grunnlag.kilder.find(k => k.id === "kpa")?.status, "feil");
  assert.equal(degraded.resultat.vurdering.utfall, "maa_avklares");
  failPlans = false;

  const existing = await ready(0, { ...answer(), bebygdEiendom: false });
  const existingResult = await request<{ resultat: Result }>(`/api/prosessoekter/${existing.oektsId}/handling`, {});
  assert.equal(existingResult.resultat.grunnlag.bebyggelse.status, "bekreftet");
  assert.equal(existingResult.resultat.vurdering.nasjonaltUnntak, "oppfylt", "Et gammelt manuelt nei skal ikke overstyre hentet bebyggelse");
  const missing = await ready(0, { ...answer(), bebygdEiendom: true });
  failBuildings = true;
  const missingResult = await request<{ resultat: Result }>(`/api/prosessoekter/${missing.oektsId}/handling`, {});
  assert.equal(missingResult.resultat.grunnlag.bebyggelse.status, "uavklart");
  assert.equal(missingResult.resultat.vurdering.nasjonaltUnntak, "uavklart", "Et manuelt ja kan ikke fylle et hull i eiendomsgrunnlaget");
  assert.equal(missingResult.resultat.vurdering.utfall, "maa_avklares");
  assert(missingResult.resultat.grunnlag.arealberegning.tomtearealM2 !== null);
  assert.equal(missingResult.resultat.grunnlag.arealberegning.kartlagtBebygdArealM2, null);
  assert.equal(missingResult.resultat.grunnlag.arealberegning.kartlagtAndelProsent, null);
  failBuildings = false;

  const standaloneSvar = normalizeGarasjeSvar(answer());
  const standaloneQuery = buildGarasjeSok(standaloneSvar);
  standaloneQuery.set("tiltak", JSON.stringify({ ...buildGarasjeTiltak(standaloneSvar), bebygdEiendom: false }));
  const standalone = await request<Omit<Result, "melding">>(`/api/garasje/sjekk?${standaloneQuery}`);
  assert.equal(standalone.vurdering.nasjonaltUnntak, "oppfylt");
  failBuildings = true;
  standaloneQuery.set("tiltak", JSON.stringify({ ...buildGarasjeTiltak(standaloneSvar), bebygdEiendom: true }));
  const standaloneMissing = await request<Omit<Result, "melding">>(`/api/garasje/sjekk?${standaloneQuery}`);
  assert.equal(standaloneMissing.vurdering.nasjonaltUnntak, "uavklart");
  assert.equal(standaloneMissing.vurdering.utfall, "maa_avklares");
  failBuildings = false;

  const state = await readState();
  const raw = structuredClone(state.prosessoekter.find(o => o.oektsId === retry.oektsId)!);
  raw.status = "AKTIV";
  raw.stegIndex = 2;
  raw.svar["garasje-vurdering"] = "gammelt svar";
  lagreStegSvar(raw, definition, definition.steg[2], { ...answer(), bya: 45 });
  assert.equal(raw.resultaterRaa["garasje-vurdering"], undefined);
  assert.equal(raw.svar["garasje-vurdering"], undefined);
  raw.stegIndex = 3;
  await assert.rejects(() => runRessurs(state, "GET",
    new URL("http://localhost/api/garasje/prosess/sjekk?personId=person-396"),
    { oekt: raw, steg: definition.steg[3], sporingsId: raw.sporingsId }), /annen person/);
  await assert.rejects(() => runRessurs(state, "GET",
    new URL("http://localhost/api/garasje/prosess/sjekk?personId=person-395&grunnlag=oppfylt"),
    { oekt: raw, steg: definition.steg[3], sporingsId: raw.sporingsId }), /lagrede svar/);
  await assert.rejects(() => runRessurs(state, "GET",
    new URL("http://localhost/api/garasje/prosess/sjekk?personId=person-395"),
    { oekt: { ...raw, stegIndex: 2 }, steg: definition.steg[3], sporingsId: raw.sporingsId }), /aktiv prosessøkt/);
  const ordinary = { ...definition, id: "vanlig-datahenting", avslutning: undefined, steg: [definition.steg[1]] };
  raw.stegIndex = 0;
  raw.prosessId = ordinary.id;
  await runStegHandling(state, raw, ordinary, {}, { type: "system", clientId: "test", scope: ["ks:innbyggerdialog:les"], consumer: null });
  assert.equal(raw.status, "AKTIV", "Eksisterende prosesser skal ikke få ny fullføring som standard");
  assert(!("avslutning" in buildProsessoektRespons(raw, ordinary, {})));
  const revisjon = JSON.parse(await readFile(path.join(stateDir, "revisjonslogg.json"), "utf8")) as {
    handling: string; ressurs: string; sporingsId: string; grunnlag?: { datagrunnlag?: GarasjeGrunnlag };
  }[];
  assert(revisjon.some(e => e.handling === "GARASJE_VURDERT" && e.grunnlag?.datagrunnlag?.kilder.length));
  assert.equal(revisjon.filter(e => e.handling === "VEILEDNING_FULLFORT").length, 7);
  assert(!revisjon.some(e => /SOKNAD|SVARUT|OPPGAVE|SJEKK_AVVIST/.test(e.handling)));
  const files = await readdir(stateDir);
  assert(!files.some(file => /soknad|oppgave|forsendelse|ai-trace/.test(file)), "Veiledningen skal ikke opprette søknad, oppgave, forsendelse eller KI-kall");
  console.log("Garasjeprosess: begge eiere, svarvalidering, hjemmel, nye oppslag, retry, ukjent, revisjon og fullføring uten søknad besto uten eksternt nettverk.");
} finally {
  globalThis.fetch = realFetch;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await rm(stateDir, { recursive: true, force: true });
}
