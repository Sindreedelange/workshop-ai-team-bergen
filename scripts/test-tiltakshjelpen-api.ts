import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { signJwt } from "../apps/digdir-mock/src/jwt.ts";
import { konvoluttring } from "./tiltakshjelpen-kartfikstur.ts";
import type { TiltakshjelpenAdresse, TiltakshjelpenGrunnlag, TiltakshjelpenKilde, TiltakshjelpenVurdering } from "../apps/shared/tiltakshjelpen.ts";
import { HENDELSE, HENDELSESSKILLE, formaterHendelse, lesHendelse } from "../apps/shared/hendelsesstroem.ts";

const stateDir = await mkdtemp(path.join(tmpdir(), "garasje-api-"));
process.env.STATE_DIR = stateDir;
process.env.AUTH_ENFORCE = "true";
process.env.DIGDIR_BASE_URL = "http://garasje-digdir.test";
process.env.DIGDIR_ISSUER = "http://garasje-digdir.test";
process.env.MATRIKKEL_BASE_URL = "http://garasje-matrikkel.test";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const kid = "garasje-test";
const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" };
const addresses: TiltakshjelpenAdresse[] = [
  { adressetekst: "Litle Milde 65", kommunenummer: "4601", gardsnummer: 105, bruksnummer: 209, festenummer: 0, undernummer: 0, punkt: { lat: 60.2536577976675, lon: 5.255241147052527 } },
  { adressetekst: "Kråkenestoppen 60", kommunenummer: "4601", gardsnummer: 20, bruksnummer: 1413, festenummer: 0, undernummer: 0, punkt: { lat: 60.33304009061054, lon: 5.315468234797857 } }
];
type Result = { grunnlag: TiltakshjelpenGrunnlag; vurdering: TiltakshjelpenVurdering };
const asJson = <T>(response: Response): Promise<T> => response.json() as Promise<T>;
const people: { personId: string; syntetiskFodselsnummer: string; bostedsadresse: { adressenavn: string } }[] =
  JSON.parse(await readFile(new URL("../data/personer.json", import.meta.url), "utf8"));
const realFetch = globalThis.fetch;
const publicRequests: string[] = [];
let failPlans = false;
let failNeighbours = false;
let backendUrl = "";

globalThis.fetch = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (backendUrl && url.origin === backendUrl) return realFetch(input, options);
  if (url.hostname === "garasje-digdir.test") {
    assert.equal(url.pathname, "/jwks");
    return Response.json({ keys: [jwk] });
  }
  if (url.hostname === "garasje-matrikkel.test") {
    assert.equal(url.pathname, "/mock/matrikkel/eiendommer");
    const index = url.searchParams.get("personId") === "person-396" ? 1 : 0;
    const adresse = addresses[index];
    return Response.json([{
      matrikkelId: index ? "matr-geo-4601-33957-60" : "matr-geo-4601-33832-65",
      adresse: adresse.adressetekst, adressenavn: index ? "Kråkenestoppen" : "Litle Milde",
      kommunenummer: adresse.kommunenummer, gnr: adresse.gardsnummer, bnr: adresse.bruksnummer,
      kommune: "BERGEN", bruksenhetstype: "bolig", eiere: [`person-${395 + index}`]
    }]);
  }
  assert(["ws.geonorge.no", "api.kartverket.no", "kart.bergen.kommune.no"].includes(url.hostname), `Uventet nettverk: ${url}`);
  assert.equal(new Headers(options?.headers).get("Authorization"), null, "Token må aldri sendes ut");
  assert(!url.href.includes("person-") && !url.searchParams.has("personId"), "Person-ID må aldri sendes ut");
  for (const person of people) assert(!url.href.includes(person.syntetiskFodselsnummer), "Fødselsnummer må aldri sendes ut");
  publicRequests.push(url.href);
  if (url.hostname === "api.kartverket.no") {
    const neighbours = url.pathname === "/eiendom/v1/punkt/omrader";
    // Nabokilden er Kartverkets områdesok, ikke lenger en egen mockrute. Flagget
    // står derfor her: leste det ingen, sammenlignet testen lykkeveien med seg selv.
    if (neighbours && failNeighbours) return Response.json({ feil: "Utilgjengelig" }, { status: 503 });
    if (!neighbours) {
      assert.equal(url.pathname, "/eiendom/v1/geokoding");
      assert.equal(url.searchParams.get("omrade"), "true");
    }
    assert.equal(url.searchParams.get("utkoordsys"), "4258");
    const second = url.searchParams.get("matrikkelnummer")?.includes("20/1413")
      || url.searchParams.get("bruksnummer") === "1413" || Number(url.searchParams.get("nord")) > 60.3;
    const a = addresses[second ? 1 : 0];
    const { lon: x, lat: y } = a.punkt;
    return Response.json({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [[[x - .001, y - .001], [x + .001, y - .001], [x + .001, y + .001], [x - .001, y + .001], [x - .001, y - .001]]] },
        properties: {
          kommunenummer: "4601", gardsnummer: a.gardsnummer, bruksnummer: a.bruksnummer + (neighbours ? 1 : 0),
          festenummer: 0, seksjonsnummer: 0, lokalid: second ? 258839374 : 259953783,
          objekttype: "Teig", "hovedområde": true, "nøyaktighetsklasseteig": second ? "Gult" : "Grønt",
          oppdateringsdato: "2025-06-18T16:10:10", teigmedflerematrikkelenheter: false,
          uregistrertjordsameie: false, matrikkelnummertekst: `${a.gardsnummer}/${a.bruksnummer}`
        }
      }]
    });
  }
  if (url.hostname === "ws.geonorge.no") {
    const sok = url.searchParams.get("sok") ?? "";
    const treff = sok.includes("Kråkenes") ? [addresses[1]] : sok.includes("Milde") ? [addresses[0]] : [];
    return Response.json({
      metadata: { totaltAntallTreff: treff.length },
      adresser: treff.map(adresse => ({
        ...adresse, undernummer: null, representasjonspunkt: { ...adresse.punkt, epsg: "EPSG:4258" }
      }))
    });
  }
  const pathname = decodeURIComponent(url.pathname);
  const source = pathname.includes("Hensynssoner_imagelayer") ? "sone"
    : pathname.includes("Arealformål") ? "kpa"
    : pathname.includes("Reguleringsplaner") ? "plan"
      : pathname.includes("Eiendommer") ? "eiendom" : "bygning";
  const fields = {
    kpa: ["KPAREALFORMAL", "AREALST", "BESKRIVELSE", "PLANID"], plan: ["PLANID", "PLANNAVN"],
    eiendom: ["OBJECTID", "GNR", "BNR", "FNR"], bygning: ["OBJECTID", "OBJTYPE", "BYGGNR", "BYGGSTAT"],
    // Kommunen eksporterer ett lag per hensynstype, og kodekolonnen heter opp
    // etter laget. Fasaden svarer med alle tre, slik den ekte tjenesten gjør per lag.
    sone: ["KPANGITTHENSYN", "KPFARE", "KPSTOY", "HENSYNSONENAVN", "BESKRIVELSE", "PLANID"]
  };
  if (failPlans && source === "kpa") return Response.json({ error: { code: 503, message: "Utilgjengelig" } });
  if (!pathname.endsWith("/query")) {
    return Response.json({
      geometryType: "esriGeometryPolygon", capabilities: "Query,Map", fields: fields[source].map(name => ({ name })),
      ...(source === "kpa" ? { drawingInfo: { renderer: {
        type: "uniqueValue", field1: "KPAREALFORMAL", field2: "AREALST",
        fieldDelimiter: ",",
        uniqueValueInfos: [
          { label: "LNF", value: "5100,1" },
          { label: "Øvrig byggesone", value: "1001,1" }
        ]
      } } } : {})
    });
  }
  const second = Number(url.searchParams.get("geometry")!.split(",")[1]) > 60.3;
  const adresse = addresses[second ? 1 : 0];
  const { lon: x, lat: y } = adresse.punkt;
  const geometry = { rings: [[[x - .001, y - .001], [x + .001, y - .001], [x + .001, y + .001], [x - .001, y + .001], [x - .001, y - .001]]] };
  if (source === "sone") {
    // Gul støysone (lag 23) dekker hele utsnittet, og dermed hele teigen. Flaten
    // bygges av utsnittet forespørselen ba om, ikke av faste koordinater.
    const lagId = Number(url.pathname.split("/").filter(Boolean).at(-2));
    return Response.json({
      geometryType: "esriGeometryPolygon", spatialReference: { wkid: 4258 },
      features: lagId === 23
        ? [{ attributes: { KPSTOY: 220, HENSYNSONENAVN: "H220_1", BESKRIVELSE: "Sjøflyhavn - gul sone", PLANID: "65270000" },
          geometry: { rings: [konvoluttring(url)] } }]
        : [],
    });
  }
  const features = source === "kpa" ? [{
    attributes: { KPAREALFORMAL: second ? 1001 : 5100, AREALST: 1, BESKRIVELSE: second ? "Øvrig byggesone" : "LNF", PLANID: "65270000" },
    ...(url.searchParams.get("returnGeometry") === "true" ? { geometry: { rings: [konvoluttring(url)] } } : {})
  }] : source === "plan" ? second ? [{
    attributes: { PLANID: "6170063", PLANNAVN: "Bønes øst, felt 19A" }
  }] : [] : [{
    attributes: { OBJECTID: 1, GNR: adresse.gardsnummer, BNR: adresse.bruksnummer, FNR: 0, OBJTYPE: "Bygning", BYGGNR: 123456789, BYGGSTAT: "TB" }, geometry
  }];
  return Response.json({ geometryType: "esriGeometryPolygon", spatialReference: { wkid: 4258 }, features });
};

const { handleRequest } = await import("../apps/sandbox-backend/src/routes.ts");
const { bytt, glemOppslag } = await import("./tiltakshjelpen-testoppsett.ts");

const server = createServer(handleRequest);
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert(address && typeof address !== "string");
backendUrl = `http://127.0.0.1:${address.port}`;
function token(personId: string, aud = "sandbox-backend"): string {
  const person = people.find(p => p.personId === personId);
  assert(person, `Testpersonen ${personId} må finnes`);
  const now = Math.floor(Date.now() / 1000);
  return signJwt({
    iss: "http://garasje-digdir.test/idporten", aud, pid: person.syntetiskFodselsnummer,
    acr: "idporten-loa-high", client_id: "garasje-api-test", iat: now, exp: now + 120
  }, { kid, privateKey });
}
const bearer = token("person-395");
const tiltak = {
  bra: 49.5, bya: 50, gesimshoyde: 3, monehoyde: 4, etasjer: 1,
  frittliggende: true, beboelse: false, kjeller: false, bebygdEiendom: true,
  avstandNabogrense: 1, avstandBygning: 1, overVannAvlop: false
};
function query(index = 0): URLSearchParams {
  const a = addresses[index];
  return new URLSearchParams({ adresse: a.adressetekst, gnr: String(a.gardsnummer), bnr: String(a.bruksnummer) });
}
async function request(route: string, status = 200, auth: string | null = bearer): Promise<Response> {
  const response = await fetch(`${backendUrl}${route}`, { headers: auth ? { Authorization: `Bearer ${auth}` } : {} });
  assert.equal(response.status, status, `${route}: ${response.status}`);
  return response;
}
try {
  await request("/api/garasje/adresser?sok=Litle%20Milde%2065", 401, null);
  assert.equal(publicRequests.length, 0, "Innlogging skal sjekkes før eksternt oppslag");
  await request("/api/garasje/adresser?sok=Litle%20Milde%2065", 401, token("person-395", "tools-api"));
  for (const [id, street] of [["person-395", "Litle Milde"], ["person-396", "Kråkenestoppen"]]) {
    const auth = token(id);
    const visible = await asJson<{ personId: string }[]>(await request("/api/personer", 200, auth));
    assert.equal(visible.length, 1);
    assert.equal(visible[0].personId, id);
    const person = await asJson<{ bostedsadresse: { adressenavn: string } }>(await request(`/api/personer/${id}`, 200, auth));
    assert.equal(person.bostedsadresse.adressenavn, street);
    const mine = await asJson<{ eiendommer: { adresse: string }[] }>(await request(`/api/matrikkel/mine-eiendommer?personId=${id}`, 200, auth));
    assert.equal(mine.eiendommer[0].adresse, addresses[id === "person-395" ? 0 : 1].adressetekst);
  }
  await request("/api/matrikkel/mine-eiendommer?personId=person-396", 403);
  assert.equal((await asJson<TiltakshjelpenAdresse[]>(await request("/api/garasje/adresser?sok=Ingen%20adresse"))).length, 0);
  for (const index of [0, 1]) {
    const result = await asJson<TiltakshjelpenGrunnlag>(await request(`/api/garasje/grunnlag?${query(index)}`));
    assert.equal(result.adresse.bruksnummer, addresses[index].bruksnummer);
    assert(result.arealformaal.length, JSON.stringify(result.kilder));
    assert.equal(result.arealformaal[0].kode, index ? 1001 : 5100);
    assert(result.eiendomsgrenser.length > 0);
    assert.equal(result.nabotomter?.kilde.status, "ok");
    assert.equal(result.nabotomter?.tomter[0].teig?.bnr, addresses[index].bruksnummer + 1);
    assert.equal(result.nabotomter?.kilde.koordinatsystem, "EPSG:4258");
    const document = result.kilder.find(k => k.id === "kpa-bestemmelser");
    assert.equal(document?.status, "ikke_sjekket", "En registrert PDF-lenke er ikke en kontrollert bestemmelse");
    assert.equal(document?.url, "https://api.arealplaner.no/api/kunder/bergen4601/dokumenter/1487/download/b65270000.pdf");
  }
  for (const field of ["adresse", "gnr", "bnr"]) {
    const missing = query();
    missing.delete(field);
    await request(`/api/garasje/grunnlag?${missing}`, 400);
  }
  const wrong = query();
  wrong.set("gnr", "9999");
  await request(`/api/garasje/grunnlag?${wrong}`, 404);
  const q = query();
  await request(`/api/garasje/sjekk?${q}`, 400);
  q.set("tiltak", JSON.stringify({ ...tiltak, planGodkjent: true }));
  await request(`/api/garasje/sjekk?${q}`, 400);
  q.set("tiltak", JSON.stringify(tiltak));
  q.set("sporingsId", "garasje-integrasjon");
  const result = await asJson<Result>(await request(`/api/garasje/sjekk?${q}`));
  assert.equal(result.vurdering.nasjonaltUnntak, "oppfylt");
  assert.equal(result.vurdering.utfall, "maa_avklares", "LNF er verken automatisk avslag eller et ukritisk ja");
  assert.equal(result.grunnlag.arealformaal[0].beskrivelse, "LNF");
  const apiTeigkilde = result.grunnlag.kilder.find(k => k.id === "eiendomsgrenser")!;
  assert.equal(apiTeigkilde.koordinatsystem, "EPSG:4258");
  assert(result.grunnlag.arealberegning.kilde.includes(apiTeigkilde.url));
  assert.match(result.grunnlag.arealberegning.metode, /teiger i EPSG:4258/);
  q.set("tiltak", JSON.stringify({ ...tiltak, bra: 50.01 }));
  assert.equal((await asJson<Result>(await request(`/api/garasje/sjekk?${q}`))).vurdering.utfall, "soknadspliktig");
  // Revisjonssporet bærer nå en Kartverket-URL der det før bar et filnavn. Det er
  // endringen som er lettest å overse i en gammel logg, så den er pinnet her.
  // Gjenbruket glemmes først, slik at kildene faktisk blir spurt.
  glemOppslag();
  publicRequests.length = 0;
  q.set("tiltak", JSON.stringify(tiltak));
  q.set("sporingsId", "garasje-teig-integrasjon");
  const teigResult = await asJson<Result>(await request(`/api/garasje/sjekk?${q}`));
  const teigkilde = teigResult.grunnlag.kilder.find(k => k.id === "eiendomsgrenser")!;
  assert.equal(teigkilde.koordinatsystem, "EPSG:4258");
  assert(teigkilde.url.startsWith("https://api.kartverket.no/eiendom/v1/geokoding?"));
  assert(teigResult.grunnlag.arealberegning.kilde.includes("api.kartverket.no"));
  assert(publicRequests.some(url => url.startsWith("https://api.kartverket.no/")));
  // Innbyggeren henter grunnlaget for kartet og igjen for sjekken, sekunder etter.
  // Uten gjenbruket betaler hun ventetiden og kommunen forespørslene to ganger for
  // det samme svaret.
  publicRequests.length = 0;
  const gjenbrukt = await asJson<Result>(await request(`/api/garasje/sjekk?${q}`));
  assert.deepEqual(gjenbrukt.grunnlag.kilder, teigResult.grunnlag.kilder);
  assert.deepEqual(publicRequests, [], "Et gjentatt oppslag om samme eiendom skal ikke spørre kildene på nytt");
  // --- hendelsesstrømmen ----------------------------------------------------
  //
  // Den er hele grunnen til at innbyggeren ser hvilken kilde som hentes. Ingenting
  // drev den før: UX-testen bytter ut leseren, så rammeformatet, den late åpningen
  // og feilsemantikken var uprøvd på begge sider.
  glemOppslag();
  const stroemsvar = await request(`/api/garasje/grunnlag/hendelser?${q}`);
  assert.equal(stroemsvar.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const hendelser: { navn: string; data: string }[] = [];
  const tekst = await stroemsvar.text();
  for (const blokk of tekst.split(HENDELSESSKILLE)) {
    const hendelse = lesHendelse(blokk);
    if (hendelse) hendelser.push(hendelse);
  }
  assert.equal(hendelser.at(-1)?.navn, HENDELSE.grunnlag, "Grunnlaget kommer sist");
  assert(!hendelser.some(h => h.navn === HENDELSE.feil));
  const stroemGrunnlag = JSON.parse(hendelser.at(-1)!.data) as TiltakshjelpenGrunnlag;
  const kildehendelser = hendelser.filter(h => h.navn === HENDELSE.kilde)
    .map(h => JSON.parse(h.data) as TiltakshjelpenKilde);
  // Hver kilde i grunnlaget melder seg, og siste melding er den lagrede statusen.
  for (const kilde of stroemGrunnlag.kilder) {
    const meldinger = kildehendelser.filter(k => k.id === kilde.id);
    assert(meldinger.length >= 1, `Kilden ${kilde.id} meldte seg aldri`);
    assert.equal(meldinger.at(-1)!.status, kilde.status);
  }
  // De som faktisk gjør et oppslag melder fra både når det settes i gang og når
  // det er ferdig. `henter` finnes bare på strømmen - et lagret grunnlag har den
  // aldri. `adresse` står utenfor: den er hentet før strømmen finnes, og en
  // henter-melding for den ville vært en påstand om venting som ikke skjer.
  // `nabotomter` står i listen fordi innbyggeren venter på den - den ligger i
  // samme Promise.all - selv om vilkårene ikke hviler på den.
  for (const id of ["eiendomsgrenser", "kpa", "reguleringsplan", "bygninger", "planflater", "nabotomter"]) {
    const meldinger = kildehendelser.filter(k => k.id === id);
    assert(meldinger.length >= 2, `Kilden ${id} meldte seg ${meldinger.length} ganger`);
    assert.equal(meldinger[0]!.status, "henter", `Kilden ${id} meldte ikke fra da oppslaget startet`);
  }
  assert.equal(kildehendelser.filter(k => k.id === "adresse").length, 1,
    "Adressen er hentet før strømmen finnes, så den melder seg én gang med sitt endelige svar");
  assert(!stroemGrunnlag.kilder.some(k => k.status === "henter"), "Et lagret grunnlag har aldri statusen henter");
  // Gjenbruket melder de samme kildene, nabokartet inkludert. Det står utenfor
  // `kilder` fordi vilkårene ikke hviler på det, så et gjenbruk som bare spilte av
  // `kilder` ville latt raden forsvinne ved andre oppslag om samme eiendom - og en
  // rad som forsvinner leses som en kilde som ikke ble hentet.
  const gjenbruktStroem = await request(`/api/garasje/grunnlag/hendelser?${q}`);
  const gjenbrukteKilder = (await gjenbruktStroem.text()).split(HENDELSESSKILLE)
    .map(lesHendelse).filter(h => h?.navn === HENDELSE.kilde)
    .map(h => JSON.parse(h!.data) as TiltakshjelpenKilde);
  assert.deepEqual(
    gjenbrukteKilder.map(k => k.id).sort(),
    [...new Set(kildehendelser.map(k => k.id))].sort(),
    "Et gjenbrukt grunnlag skal melde de samme kildene som det ferske"
  );
  assert(gjenbrukteKilder.every(k => k.status !== "henter"),
    "Et gjenbruk henter ingenting, så ingen kilde er underveis");

  // En feil før den første hendelsen beholder statuskoden sin. Åpnet vi strømmen
  // med en gang, ville en 400 blitt en 200 med en feilhendelse i - altså en annen
  // feilsemantikk enn JSON-tvillingen for nøyaktig samme ressurs.
  const ugyldig = query();
  ugyldig.delete("gnr");
  const avvist = await request(`/api/garasje/grunnlag/hendelser?${ugyldig}`, 400);
  assert.match(avvist.headers.get("content-type") || "", /application\/json/);
  // Rammeformatet, begge veier: en kropp med linjeskift og guillemetter må komme
  // helt fram. Bryter den ene enden formatet, mister den andre halen i stillhet.
  const rundtur = lesHendelse(formaterHendelse(HENDELSE.kilde, { merknad: "to\nlinjer og \u00abhermetegn\u00bb" }).split(HENDELSESSKILLE)[0]!);
  assert.equal(rundtur?.navn, HENDELSE.kilde);
  assert.equal(JSON.parse(rundtur!.data).merknad, "to\nlinjer og \u00abhermetegn\u00bb");

  bytt(() => { failNeighbours = true; });
  const missingNeighbours = await asJson<Result>(await request(`/api/garasje/sjekk?${q}`));
  assert.equal(missingNeighbours.grunnlag.nabotomter?.kilde.status, "feil",
    "Flagget må nå fram til nabokilden, ellers sammenligner testen lykkeveien med seg selv");
  assert.deepEqual(missingNeighbours.grunnlag.eiendomsgrenser, teigResult.grunnlag.eiendomsgrenser,
    "En nabokilde som feiler skal ikke endre eiendommens egne grenser");
  // Et grunnlag med en kilde nede skal ikke bli liggende som svaret i tretti
  // sekunder. Nabokartet står utenfor `kilder`, så en ugyldiggjøring som bare så
  // på den listen ville lagret det feilede svaret - og nettopp den kilden ber
  // innbyggeren kjøre sjekken på nytt. Flagget snus uten å glemme gjenbruket, så
  // et lagret svar ville vist seg som «feil» igjen.
  failNeighbours = false;
  const etterFeil = await asJson<Result>(await request(`/api/garasje/sjekk?${q}`));
  assert.equal(etterFeil.grunnlag.nabotomter?.kilde.status, "ok",
    "Et grunnlag med en feilet nabokilde skal ikke gjenbrukes");

  bytt(() => { failPlans = true; });
  q.set("tiltak", JSON.stringify(tiltak));
  const failed = await asJson<Result>(await request(`/api/garasje/sjekk?${q}`));
  assert.equal(failed.vurdering.utfall, "maa_avklares");
  assert.equal(failed.grunnlag.kilder.find(k => k.id === "kpa")?.status, "feil");
  const sone = result.grunnlag.planflater.find(f => f.kategori === "hensynssone");
  assert.equal(sone?.kategori === "hensynssone" ? sone.sonenavn : null, "H220_1");
  assert.equal(sone?.berorer, "helt");
  const plankilde = result.grunnlag.kilder.find(k => k.id === "planflater")!;
  assert(plankilde.url.includes("Hensynssoner_imagelayer"));
  assert.equal(result.vurdering.sjekker.find((s: { id: string }) => s.id === "hensynssoner")?.status, "uavklart");
  const audit = JSON.parse(await readFile(path.join(stateDir, "revisjonslogg.json"), "utf8"));
  const teigEvent = audit.find((e: { handling: string; sporingsId: string }) => e.handling === "GARASJE_VURDERT" && e.sporingsId === "garasje-teig-integrasjon");
  const lagretTeigkilde = teigEvent.grunnlag.datagrunnlag.kilder.find((k: { id: string }) => k.id === "eiendomsgrenser");
  assert(String(lagretTeigkilde.url).startsWith("https://api.kartverket.no/"));
  assert.deepEqual(teigEvent.grunnlag.datagrunnlag.arealberegning, teigResult.grunnlag.arealberegning,
    "Lagret arealgrunnlag skal ha samme kilde og koordinatsystem som API-svaret");
  const event = audit.find((e: { handling: string; sporingsId: string }) => e.handling === "GARASJE_VURDERT" && e.sporingsId === "garasje-integrasjon");
  assert(event?.grunnlag.datagrunnlag.kilder.length);
  assert.equal(event.grunnlag.tiltak.bra, tiltak.bra);
  assert.equal(event.aktor.type, "innbygger");
  assert(audit.some((e: { handling: string; ressurs: string }) => e.handling === "DATA_LES" && e.ressurs === "garasje-plangrunnlag"));
  console.log("Tiltakshjelpen: API, innlogging, egne adresser, kildefeil og revisjonsspor besto uten eksternt nettverk.");
} finally {
  globalThis.fetch = realFetch;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await rm(stateDir, { recursive: true, force: true });
}
