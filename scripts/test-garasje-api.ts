import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { signJwt } from "../apps/digdir-mock/src/jwt.ts";
import type { GarasjeAdresse, GarasjeGrunnlag, GarasjeVurdering } from "../apps/shared/garasje.ts";

const stateDir = await mkdtemp(path.join(tmpdir(), "garasje-api-"));
process.env.STATE_DIR = stateDir;
process.env.AUTH_ENFORCE = "true";
process.env.DIGDIR_BASE_URL = "http://garasje-digdir.test";
process.env.DIGDIR_ISSUER = "http://garasje-digdir.test";
process.env.MATRIKKEL_BASE_URL = "http://garasje-matrikkel.test";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const kid = "garasje-test";
const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" };
const addresses: GarasjeAdresse[] = [
  { adressetekst: "Litle Milde 65", kommunenummer: "4601", gardsnummer: 105, bruksnummer: 209, festenummer: 0, undernummer: 0, punkt: { lat: 60.2536577976675, lon: 5.255241147052527 } },
  { adressetekst: "Kråkenestoppen 60", kommunenummer: "4601", gardsnummer: 20, bruksnummer: 1413, festenummer: 0, undernummer: 0, punkt: { lat: 60.33304009061054, lon: 5.315468234797857 } }
];
type Result = { grunnlag: GarasjeGrunnlag; vurdering: GarasjeVurdering };
const asJson = <T>(response: Response): Promise<T> => response.json() as Promise<T>;
const people: { personId: string; syntetiskFodselsnummer: string; bostedsadresse: { adressenavn: string } }[] =
  JSON.parse(await readFile(new URL("../data/personer.json", import.meta.url), "utf8"));
const realFetch = globalThis.fetch;
const publicRequests: string[] = [];
let failPlans = false;
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
    assert.equal(url.pathname, "/eiendom/v1/geokoding");
    assert.equal(url.searchParams.get("omrade"), "true");
    assert.equal(url.searchParams.get("utkoordsys"), "4258");
    const second = url.searchParams.get("matrikkelnummer")?.includes("20/1413")
      || url.searchParams.get("bruksnummer") === "1413";
    const a = addresses[second ? 1 : 0];
    const { lon: x, lat: y } = a.punkt;
    return Response.json({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [[[x - .001, y - .001], [x + .001, y - .001], [x + .001, y + .001], [x - .001, y + .001], [x - .001, y - .001]]] },
        properties: {
          kommunenummer: "4601", gardsnummer: a.gardsnummer, bruksnummer: a.bruksnummer,
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
  const source = pathname.includes("Arealformål") ? "kpa"
    : pathname.includes("Reguleringsplaner") ? "plan"
      : pathname.includes("Eiendommer") ? "eiendom" : "bygning";
  const fields = {
    kpa: ["KPAREALFORMAL", "AREALST", "BESKRIVELSE", "PLANID"], plan: ["PLANID", "PLANNAVN"],
    eiendom: ["OBJECTID", "GNR", "BNR", "FNR"], bygning: ["OBJECTID", "OBJTYPE", "BYGGNR", "BYGGSTAT"]
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
  const features = source === "kpa" ? [{
    attributes: { KPAREALFORMAL: second ? 1001 : 5100, AREALST: 1, BESKRIVELSE: second ? "Øvrig byggesone" : "LNF", PLANID: "65270000" }
  }] : source === "plan" ? second ? [{
    attributes: { PLANID: "6170063", PLANNAVN: "Bønes øst, felt 19A" }
  }] : [] : [{
    attributes: { OBJECTID: 1, GNR: adresse.gardsnummer, BNR: adresse.bruksnummer, FNR: 0, OBJTYPE: "Bygning", BYGGNR: 123456789, BYGGSTAT: "TB" }, geometry
  }];
  return Response.json({ geometryType: "esriGeometryPolygon", spatialReference: { wkid: 4258 }, features });
};

const { handleRequest } = await import("../apps/sandbox-backend/src/routes.ts");
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
  assert.equal((await asJson<GarasjeAdresse[]>(await request("/api/garasje/adresser?sok=Ingen%20adresse"))).length, 0);
  for (const index of [0, 1]) {
    const result = await asJson<GarasjeGrunnlag>(await request(`/api/garasje/grunnlag?${query(index)}`));
    assert.equal(result.adresse.bruksnummer, addresses[index].bruksnummer);
    assert(result.arealformaal.length, JSON.stringify(result.kilder));
    assert.equal(result.arealformaal[0].kode, index ? 1001 : 5100);
    assert(result.eiendomsgrenser.length > 0);
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
  q.set("tiltak", JSON.stringify({ ...tiltak, bra: 50.01 }));
  assert.equal((await asJson<Result>(await request(`/api/garasje/sjekk?${q}`))).vurdering.utfall, "soknadspliktig");
  failPlans = true;
  q.set("tiltak", JSON.stringify(tiltak));
  const failed = await asJson<Result>(await request(`/api/garasje/sjekk?${q}`));
  assert.equal(failed.vurdering.utfall, "maa_avklares");
  assert.equal(failed.grunnlag.kilder.find(k => k.id === "kpa")?.status, "feil");
  const audit = JSON.parse(await readFile(path.join(stateDir, "revisjonslogg.json"), "utf8"));
  const event = audit.find((e: { handling: string; sporingsId: string }) => e.handling === "GARASJE_VURDERT" && e.sporingsId === "garasje-integrasjon");
  assert(event?.grunnlag.datagrunnlag.kilder.length);
  assert.equal(event.grunnlag.tiltak.bra, tiltak.bra);
  assert.equal(event.aktor.type, "innbygger");
  assert(audit.some((e: { handling: string; ressurs: string }) => e.handling === "DATA_LES" && e.ressurs === "garasje-plangrunnlag"));
  console.log("Garasjesjekk: API, innlogging, egne adresser, kildefeil og revisjonsspor besto uten eksternt nettverk.");
} finally {
  globalThis.fetch = realFetch;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await rm(stateDir, { recursive: true, force: true });
}
