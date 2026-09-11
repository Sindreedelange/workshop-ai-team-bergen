import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { createContext, runInContext } from "node:vm";
import { webcrypto } from "node:crypto";
import { buildClientKonfigurasjon } from "../apps/shared/client-konfigurasjon.ts";

const config = buildClientKonfigurasjon({
  BACKEND_PUBLIC_URL: "http://localhost:19080", IDPORTEN_PUBLIC_URL: "http://localhost:19086",
  AI_PUBLIC_URL: "http://localhost:19082", AGENT_PUBLIC_URL: "http://localhost:19084"
});
assert.equal(config.idportenBaseUrl, "http://localhost:19086");
assert.equal(buildClientKonfigurasjon({}).idportenBaseUrl, "http://localhost:8086");
assert.equal(buildClientKonfigurasjon({ GARASJE_BACKEND_PUBLIC_URL: "http://localhost:19080" }).backendBaseUrl, config.backendBaseUrl);

const storage: Record<string, string> = Object.create({
  getItem: (key: string) => Object.hasOwn(storage, key) ? storage[key] : null,
  setItem: (key: string, value: string) => { storage[key] = value; },
  removeItem: (key: string) => { delete storage[key]; }
});
let redirect = "";
const login = createContext({
  sandkasseKonfigurasjon: config, crypto: webcrypto, TextEncoder, URLSearchParams,
  btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
  atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
  sessionStorage: storage,
  location: { origin: "http://localhost:13001", pathname: "/chat", search: "?prosess=garasjesjekk", assign: (url: string) => { redirect = url; } }
});
runInContext(stripTypeScriptTypes(await readFile("apps/shared/client/felles.ts", "utf8")), login);
assert.equal(await runInContext("requireLogin()", login), false);
const url = new URL(redirect);
assert.equal(url.origin, config.idportenBaseUrl);
assert.equal(url.searchParams.get("state"), "/chat?prosess=garasjesjekk");
assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:13001/callback");
assert(Object.hasOwn(storage, "sandkasse-pkce-verifier"));
const token = (issuer: string, pid = "syntetisk-test", lifetime = 100) => `header.${Buffer.from(JSON.stringify({
  iss: `${issuer}/idporten`, pid, exp: Math.floor(Date.now() / 1000) + lifetime
})).toString("base64url")}.signature`;
storage["sandkasse-idporten-token"] = token(config.idportenBaseUrl);
for (const page of ["/chat", "/agent", "/stegvis", "/garasje"]) {
  login.location.pathname = page;
  redirect = "";
  assert.equal(await runInContext("requireLogin()", login), true, `${page} skal gjenbruke samme innlogging`);
  assert.equal(redirect, "");
}
storage["sandkasse-idporten-token"] = token("http://localhost:8086");
assert.equal(await runInContext("requireLogin()", login), false, "Token fra en annen utsteder må ikke gjenbrukes");

class Element {
  isConnected = true;
  hidden = true;
  textContent = "";
  value = "";
  children: Element[] = [];
  get options() { return this.children; }
  contentWindow = { postMessage: (message: unknown) => { replies.push(message); } };
  height = "";
  attributes: Record<string, string> = {};
  append(...nodes: Element[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: Element[]) { this.children = nodes; }
  remove() { this.isConnected = false; }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  removeAttribute(name: string) { delete this.attributes[name]; }
}

const authNodes = new Map<string, Element>();
const authEl = (id: string) => {
  if (!authNodes.has(id)) authNodes.set(id, new Element());
  return authNodes.get(id)!;
};
let requests = 0;
let responseStatus = 401;
Object.assign(login, {
  backendBase: config.backendBaseUrl, AbortSignal,
  krevEl: authEl, form: authEl("garage-form"),
  svg: { querySelector: authEl },
  utfylling: { cancel() {} },
  fetch: async () => { requests++; return Response.json({ feil: "Avvist forespørsel" }, { status: responseStatus }); }
});
const garageSource = stripTypeScriptTypes(await readFile("apps/demo-gui/src/client/garasje.ts", "utf8"));
const apiStart = garageSource.indexOf("function expireLogin");
const apiEnd = garageSource.indexOf("async function perform", apiStart);
assert(apiStart >= 0 && apiEnd > apiStart);
runInContext(`
  let valgtAdresse = {}, plassering = {}, grunnlag = {}, vurdering = {};
  let propertyConfirmed = true, propertyVersion = 0, placementChosen = true, placementConfirmed = true;
  let kartgrunnlag = null, planflater = [], plankilde, tiltakstypeBekreftet = false;
  ${garageSource.slice(apiStart, apiEnd)}
`, login);
for (const issuer of ["http://localhost:8086", config.idportenBaseUrl]) {
  storage["sandkasse-idporten-token"] = token(issuer);
  redirect = "";
  requests = 0;
  assert.equal(runInContext("tokenValid()", login), true, "Testtokenet skal fortsatt være innenfor levetiden");
  await assert.rejects(runInContext('api("/api/personer")', login), /Logg inn igjen/);
  assert.equal(Object.hasOwn(storage, "sandkasse-idporten-token"), false, "401 skal slette det avviste tokenet");
  assert.equal(authEl("login-panel").hidden, false);
  assert.equal(authEl("logout").hidden, true);
  assert.equal(authEl("workspace").hidden, true);
  assert.equal(authEl("garage-form").hidden, true);
  assert.equal(runInContext("vurdering", login), null);
  assert.equal(await runInContext("requireLogin()", login), false, "Neste innlogging skal navigere til ID-porten");
  assert.equal(new URL(redirect).origin, config.idportenBaseUrl);
  assert.equal(requests, 1, "Ny innlogging skal ikke gjenta den avviste forespørselen");
}
responseStatus = 503;
storage["sandkasse-idporten-token"] = token(config.idportenBaseUrl);
await assert.rejects(runInContext('api("/api/personer")', login), /Avvist forespørsel/);
assert.equal(runInContext("tokenValid()", login), true, "En kildefeil skal ikke logge brukeren ut");

storage["sandkasse-idporten-token"] = token(config.idportenBaseUrl, "syntetisk-test", -1);
requests = 0;
authEl("workspace").hidden = false;
authEl("login-panel").hidden = true;
await assert.rejects(runInContext('api("/api/personer")', login), /Logg inn igjen/);
assert.equal(requests, 0, "Et utløpt token skal avvises før nettverkskallet");
assert.equal(authEl("workspace").hidden, true, "Utløpt innlogging skal skjule både tiltak og eiendom");
assert.equal(authEl("login-panel").hidden, false, "Utløpt innlogging skal gi en vei tilbake til ID-porten");

const personer = [
  { personId: "person-395", syntetiskFodselsnummer: "syntetisk-milda", visningsnavn: "Milda Garasjetest",
    skjermet: false, bostedsadresse: { adressenavn: "Litle Milde", husnummer: 65, kommunenummer: "4601" } },
  { personId: "person-396", syntetiskFodselsnummer: "syntetisk-kaare", visningsnavn: "Kåre Garasjetest",
    skjermet: false, bostedsadresse: { adressenavn: "Kråkenestoppen", husnummer: 60, kommunenummer: "4601" } }
];
const personRequests: string[] = [];
const searches: { tekst: string; kommune: string }[] = [];
let activePerson = personer[0];
let propertyStatus = 200;
Object.assign(login, {
  myAddress: authEl("my-address"), searchInput: authEl("address-search"),
  element: (_tag: string, text: string) => Object.assign(new Element(), { textContent: text }),
  searchAdresse: async (tekst: string, kommune: string) => { searches.push({ tekst, kommune }); },
  fetch: async (url: string, options: RequestInit) => {
    assert.equal(new Headers(options.headers).get("Authorization"), `Bearer ${storage["sandkasse-idporten-token"]}`);
    const path = url.slice(config.backendBaseUrl.length);
    personRequests.push(path);
    if (path === "/api/personer") return Response.json(personer);
    if (path === `/api/personer/${activePerson.personId}`) return Response.json(activePerson);
    assert.equal(path, `/api/matrikkel/mine-eiendommer?personId=${activePerson.personId}`,
      "Eieroppslaget skal gjelde den innloggede personen");
    if (propertyStatus !== 200) return Response.json({ feil: "Eieroppslaget feilet" }, { status: propertyStatus });
    const bosted = {
      adresse: `${activePerson.bostedsadresse.adressenavn} ${activePerson.bostedsadresse.husnummer}`,
      kommune: "BERGEN", kommunenummer: "4601", gnr: 105, bnr: 209
    };
    return Response.json({ eiendommer: [
      { adresse: "Annen eiendom 1", kommune: "BERGEN", kommunenummer: "4601", gnr: 20, bnr: 1 },
      bosted, bosted
    ] });
  }
});
const personStart = garageSource.indexOf("async function loadPerson");
const personEnd = garageSource.indexOf("function configureFields", personStart);
assert(personStart >= 0 && personEnd > personStart);
runInContext(`let embeddedOekt = null, adressevalg = []; ${garageSource.slice(personStart, personEnd)}`, login);
for (const person of personer) {
  activePerson = person;
  storage["sandkasse-idporten-token"] = token(config.idportenBaseUrl, person.syntetiskFodselsnummer);
  personRequests.length = 0;
  searches.length = 0;
  await runInContext("loadPerson()", login);
  assert.equal(authEl("login-panel").hidden, true);
  assert.equal(authEl("workspace").hidden, false);
  assert.equal(authEl("logged-in").textContent, `Innlogget som ${person.visningsnavn}`);
  assert.equal(authEl("logout").hidden, false);
  assert.deepEqual(personRequests, ["/api/personer", `/api/personer/${person.personId}`,
    `/api/matrikkel/mine-eiendommer?personId=${person.personId}`]);
  const adresse = `${person.bostedsadresse.adressenavn} ${person.bostedsadresse.husnummer}`;
  assert.deepEqual(searches, [{ tekst: adresse, kommune: "4601" }], "Eid bosted skal foreslås før andre eiendommer");
  assert.equal(authEl("my-address").children.length, 3, "Eierlisten skal fjerne duplikater");
  assert.match(authEl("my-address").children[1].textContent, /Bosted og registrert eiendom/);
}
propertyStatus = 401;
searches.length = 0;
await assert.rejects(runInContext("loadPerson()", login), /Logg inn igjen/,
  "Avvist innlogging under eieroppslaget må ikke skjules som en kildefeil");
assert.equal(authEl("workspace").hidden, true);
assert.equal(authEl("login-panel").hidden, false);
assert.equal(searches.length, 0, "Ingen adresse skal velges etter avvist innlogging");

propertyStatus = 503;
storage["sandkasse-idporten-token"] = token(config.idportenBaseUrl, activePerson.syntetiskFodselsnummer);
await runInContext("loadPerson()", login);
assert.equal(authEl("workspace").hidden, false, "En kildefeil skal fortsatt tillate manuelt adressesøk");
assert.match(authEl("address-note").textContent, /Egne eiendommer kunne ikke hentes/);
assert.equal(runInContext("tokenValid()", login), true);

activePerson = { ...activePerson, skjermet: true };
personRequests.length = 0;
await runInContext("loadPerson()", login);
assert.deepEqual(personRequests, ["/api/personer", `/api/personer/${activePerson.personId}`],
  "Skjermet adresse skal ikke utløse eieroppslag");
assert.match(authEl("address-note").textContent, /Adressen er skjermet/);
assert.equal(searches.length, 0);

const replies: unknown[] = [];
let listener: ((event: Record<string, unknown>) => Promise<void>) | null = null;
const ui = createContext({
  document: { createElement: () => new Element() },
  location: { origin: "http://localhost:13001" },
  window: {
    addEventListener: (_type: string, callback: typeof listener) => { listener = callback; },
    removeEventListener: () => { listener = null; }
  },
  URLSearchParams
});
const source = await readFile("apps/demo-gui/src/client/garasje-prosess.ts", "utf8");
runInContext(stripTypeScriptTypes(source).replace("export function mountGarasjeProsess", "function mountGarasjeProsess"), ui);
const container = new Element();
let saves = 0;
ui.options = {
  container,
  oekt: { oektsId: "garage-test", prosessId: "garasjesjekk", status: "AKTIV", aktivtSteg: { id: "garasje-prosjekt", type: "QUESTION", visning: "garasje" } },
  save: async () => { saves++; }
};
const dispose = runInContext("mountGarasjeProsess(options)", ui);
const frame = container.children[1];
assert(frame.attributes.sandbox.includes("allow-forms"), "Skjemasvar må kunne sendes fra kartsteget");
assert(frame.attributes.sandbox.includes("allow-popups"), "Kildelenker skal kunne åpnes");
assert(frame.attributes.sandbox.includes("allow-modals"), "Vurderingen skal kunne skrives ut");
async function emit(origin: string, source: unknown, data: unknown) {
  assert(listener);
  await listener({ origin, source, data });
}
const answer = { type: "garasje-svar", oektsId: "garage-test", stegId: "garasje-prosjekt", svar: { bra: 49 } };
await emit("https://example.test", frame.contentWindow, answer);
await emit("http://localhost:13001", {}, answer);
await emit("http://localhost:13001", frame.contentWindow, { ...answer, stegId: "stale-step" });
assert.equal(saves, 0);
await emit("http://localhost:13001", frame.contentWindow, answer);
assert.equal(saves, 1);
assert.equal((replies[0] as { type: string }).type, "garasje-lagret");
await emit("http://localhost:13001", frame.contentWindow, { type: "garasje-hoyde", hoyde: 1500 });
assert.equal(frame.height, "1500");
dispose();
assert.equal(listener, null);
assert.equal(frame.isConnected, false);
console.log("Garasjeklient: innlogging først, person og eiendom, utløpt innlogging, skjerming og avgrenset kartkommunikasjon besto.");
