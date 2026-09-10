import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { createContext, runInContext } from "node:vm";
import { projectGarasjeDialogGrunnlag } from "../apps/shared/garasje-dialog.ts";
import type { GarasjeGrunnlag } from "../apps/shared/garasje.ts";

type Event = { target?: Element; key?: string; shiftKey?: boolean; preventDefault?: () => void };
class Element {
  value = "";
  hidden = false;
  disabled = false;
  textContent = "";
  className = "";
  type = "";
  min = "";
  max = "";
  step = "any";
  required = false;
  validationMessage = "Ugyldig verdi";
  focusCount = 0;
  parentElement?: Element;
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  children: Element[] = [];
  listeners = new Map<string, ((event: Event) => unknown)[]>();
  addEventListener(type: string, fn: (event: Event) => unknown) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), fn]);
  }
  dispatch(type: string, event: Event = {}) {
    for (const fn of this.listeners.get(type) || []) fn({ target: this, ...event });
  }
  append(...items: Element[]) { this.children.push(...items); }
  replaceChildren(...items: Element[]) { this.children = items; }
  setAttribute(key: string, value: string) { this.attributes[key] = value; }
  removeAttribute(key: string) { delete this.attributes[key]; }
  focus() { this.focusCount++; }
  scrollIntoView() {}
  checkValidity() {
    if (this.required && !this.value) return false;
    if (this.type !== "number" || !this.value) return true;
    const n = Number(this.value);
    return Number.isFinite(n) && n >= Number(this.min || "-Infinity") && n <= Number(this.max || "Infinity");
  }
}

const themeSource = stripTypeScriptTypes(await readFile("apps/demo-gui/src/client/garasje-tema.ts", "utf8"));
function theme(stored: string | null, denied = false) {
  const select = new Element();
  const note = new Element();
  const root = { dataset: {} as Record<string, string> };
  const storage = new Map<string, string>(stored === null ? [] : [["garasjesjekk-color-scheme", stored]]);
  let storageListener: (event: { key: string | null; newValue: string | null }) => void = () => {};
  const warnings: string[] = [];
  runInContext(themeSource, createContext({
    document: { readyState: "complete", documentElement: root, getElementById: (id: string) => id === "theme" ? select : note },
    HTMLSelectElement: Element, DOMException,
    console: { warn: (text: string) => warnings.push(text) },
    localStorage: {
      getItem: (key: string) => { if (denied) throw new DOMException("Blocked", "SecurityError"); return storage.get(key) ?? null; },
      setItem: (key: string, value: string) => { if (denied) throw new DOMException("Blocked", "SecurityError"); storage.set(key, value); }
    },
    window: { addEventListener: (_event: string, callback: typeof storageListener) => { storageListener = callback; } }
  }));
  return { select, note, root, storage, warnings, update: (value: string | null) => storageListener({ key: "garasjesjekk-color-scheme", newValue: value }) };
}
assert.equal(theme(null).root.dataset.colorScheme, "dark");
const light = theme("light");
assert.equal(light.root.dataset.colorScheme, "light");
light.select.value = "dark";
light.select.dispatch("change");
assert.equal(light.storage.get("garasjesjekk-color-scheme"), "dark");
assert.equal(theme(light.storage.get("garasjesjekk-color-scheme")!).root.dataset.colorScheme, "dark");
light.update("light");
assert.equal(light.root.dataset.colorScheme, "light");
const blocked = theme(null, true);
assert.equal(blocked.root.dataset.colorScheme, "dark");
assert(blocked.warnings.length > 0);
assert(blocked.note.textContent.includes("kan ikke lagres"));

const nodes = new Map<string, Element>();
const el = (id: string) => {
  if (!nodes.has(id)) nodes.set(id, new Element());
  return nodes.get(id)!;
};
const fields = [
  { id: "bya", label: "Areal", type: "tall", ukjentTillatt: false },
  { id: "gesimshoyde", label: "Gesims", type: "tall", ukjentTillatt: false },
  { id: "monehoyde", label: "Møne", type: "tall", ukjentTillatt: false }
];
for (const field of fields) {
  const node = el(field.id);
  node.type = "number";
  node.min = "0.01";
  node.max = "1000";
  node.required = true;
  node.parentElement = new Element();
}
let locked = false;
let changed = 0;
let answer: { type: string; tekst: string; svar?: number } = { type: "svar", tekst: "Jeg forstår 35", svar: 35 };
let resolveDelayed: ((value: typeof answer) => void) | undefined;
let delayed = false;
const context = createContext({
  document: { getElementById: el, createElement: () => new Element() },
  AbortController,
  options: {
    fields, locked: () => locked, changed: () => { changed++; },
    ask: () => delayed ? new Promise<typeof answer>(resolve => { resolveDelayed = resolve; }) : Promise.resolve(answer)
  }
});
const source = stripTypeScriptTypes(await readFile("apps/demo-gui/src/client/garasje-utfylling.ts", "utf8"))
  .replace("export function createGarasjeUtfylling", "function createGarasjeUtfylling");
runInContext(source, context);
const ui = runInContext("createGarasjeUtfylling(options)", context);
assert.equal(el("mode-agent").attributes["aria-pressed"], "true");
assert.equal(el("garage-fields").hidden, false);
el("mode-stepwise").dispatch("click");
assert.equal(el("agent-interview").hidden, false, "Den samme tekstboksen skal være tilgjengelig i stegvis modus");
assert.equal(el("bya").parentElement!.hidden, false);
assert.equal(el("gesimshoyde").parentElement!.hidden, true);
el("field-next").dispatch("click");
assert.equal(el("interview-error").hidden, false);
el("bya").value = "35";
el("bya").dispatch("input");
el("field-next").dispatch("click");
assert.equal(el("gesimshoyde").parentElement!.hidden, false);
el("mode-agent").dispatch("click");
assert.equal(el("bya").value, "35", "Modusbytte skal bevare feltverdier");
assert(el("dialog-question").textContent.includes("Gesims"));
answer = { type: "sporsmaal", tekst: "Gesims er der vegg og tak møtes." };
el("dialog-input").value = "Hva er gesims?";
el("dialog-send").dispatch("click");
await new Promise(resolve => setImmediate(resolve));
assert.equal(el("gesimshoyde").value, "");
assert.equal(el("dialog-proposal").hidden, true);
assert(el("dialog-question").textContent.includes("Gesims"), "Et spørsmål skal ikke flytte utfyllingen");
answer = { type: "svar", tekst: "Jeg forstår 3", svar: 3 };
el("dialog-input").value = "3 meter";
el("dialog-send").dispatch("click");
await new Promise(resolve => setImmediate(resolve));
assert.equal(el("gesimshoyde").value, "", "Agentforslaget skal ikke lagres uten bekreftelse");
const beforeRejection = changed;
el("dialog-reject").dispatch("click");
assert.equal(el("dialog-proposal").hidden, true);
assert.equal(el("interview-editing").hidden, false);
assert.match(el("interview-editing").textContent, /Du endrer «Gesims»/);
assert.match(el("dialog-input-label").textContent, /Endre svaret for «Gesims»/);
assert.equal(el("dialog-input").value, "3 meter", "Endring skal gjenopprette teksten innbyggeren skrev");
assert.equal(el("dialog-input").focusCount, 1, "Fokus skal flyttes til tekstboksen");
assert.equal(el("gesimshoyde").value, "");
assert.equal(changed, beforeRejection, "Et avvist forslag skal ikke endre lagrede svar");
el("dialog-send").dispatch("click");
await new Promise(resolve => setImmediate(resolve));
el("dialog-accept").dispatch("click");
assert.equal(el("gesimshoyde").value, "3");
assert.equal(el("interview-editing").hidden, true, "Endringsmeldingen skal forsvinne når svaret bekreftes");
assert(el("dialog-question").textContent.includes("Møne"));
el("mode-stepwise").dispatch("click");
el("monehoyde").value = "4";
el("monehoyde").dispatch("input");
el("field-next").dispatch("click");
assert.equal(el("interview-review").hidden, false);
assert.equal(el("assess").hidden, false);
assert.equal(ui.validateComplete(), true);
assert(changed > 0);
const beforeQuestion = changed;
answer = { type: "sporsmaal", tekst: "Du kan spørre om målene før du kjører sjekken." };
el("dialog-input").value = "Hva er mønehøyde?";
el("dialog-send").dispatch("click");
await new Promise(resolve => setImmediate(resolve));
assert.equal(el("interview-review").hidden, false, "Spørsmål i oppsummeringen skal ikke åpne et gammelt felt");
assert.equal(el("monehoyde").value, "4");
assert.equal(changed, beforeQuestion, "Fagspørsmål skal ikke endre svarutkastet");
answer = { type: "svar", tekst: "5", svar: 5 };
el("dialog-input").value = "5";
el("dialog-send").dispatch("click");
await new Promise(resolve => setImmediate(resolve));
assert.equal(el("dialog-proposal").hidden, true, "Endringer etter oppsummering må knyttes til riktig felt");
assert.equal(el("monehoyde").value, "4");
// A late agent response after switching mode must not propose or overwrite a value.
el("answer-summary").children[2].children[1].dispatch("click");
assert.equal(el("interview-review").hidden, true);
assert.equal(el("interview-editing").hidden, false);
assert.match(el("interview-editing").textContent, /Du endrer «Møne».*4/);
assert.equal(el("monehoyde").focusCount, 1, "Endring fra oppsummeringen skal fokusere riktig skjemafelt");
assert.equal(el("dialog-input").value, "4");
el("mode-agent").dispatch("click");
assert.match(el("dialog-input-label").textContent, /Endre svaret for «Møne»/);
delayed = true;
el("dialog-input").value = "5 meter";
el("dialog-send").dispatch("click");
el("mode-stepwise").dispatch("click");
resolveDelayed!({ type: "svar", tekst: "5", svar: 5 });
await new Promise(resolve => setImmediate(resolve));
assert.equal(el("monehoyde").value, "4");
assert.equal(el("dialog-proposal").hidden, true);
el("dialog-input").value = "5 meter";
el("dialog-send").dispatch("click");
el("field-next").dispatch("click");
resolveDelayed!({ type: "svar", tekst: "5", svar: 5 });
await new Promise(resolve => setImmediate(resolve));
assert.equal(el("interview-review").hidden, false);
assert.equal(el("dialog-proposal").hidden, true, "Et sent agentsvar skal ikke overleve neste steg i skjemaet");
assert.equal(el("monehoyde").value, "4");
locked = true;
ui.refresh();
assert.equal(el("dialog-send").disabled, true);
const html = await readFile("apps/demo-gui/src/garasje.html", "utf8");
assert(!html.includes("Prøv en case"));
assert(!html.includes("case-milde"));
assert(html.includes('data-color-scheme="dark"'));
const pageHeader = html.match(/<header class="page-header">([\s\S]*?)<\/header>/)?.[1];
assert(pageHeader, "Siden skal ha et toppfelt");
assert(pageHeader.includes('aria-label="Innstillinger"') && pageHeader.includes('id="theme"'), "Temavalget skal ligge i innstillingsfeltet i toppfeltet");
assert(!pageHeader.match(/<nav\b[\s\S]*?<\/nav>/)?.[0].includes('id="theme"'), "Temavalget skal ikke skjules sammen med navigasjonen i innebygd visning");
assert.equal((html.match(/id="theme"/g) || []).length, 1);
assert(html.includes('id="property-workspace" class="stack"'));
assert(html.includes('id="garage-step" class="panel stack" aria-labelledby="garage-heading" hidden'));
assert(html.includes("Bekreft plassering og fortsett"));
assert(html.includes('id="garage-form" class="stack" novalidate'));
assert.equal((html.match(/<textarea\b/g) || []).length, 1, "Svar og spørsmål skal dele én tekstboks");
assert(!html.includes('id="help-question"') && !html.includes('id="help-form"'));
const largeGrunnlag: GarasjeGrunnlag = {
  adresse: { adressetekst: "Ikke send adressen", kommunenummer: "4601", gardsnummer: 20, bruksnummer: 1413, festenummer: 0, undernummer: 0, punkt: { lat: 60.33, lon: 5.31 } },
  punkt: { lat: 60.33, lon: 5.31 }, arealformaal: [{ kode: 1001, planId: "65270000", beskrivelse: "Øvrig byggesone", sonenavn: "Øvrig byggesone", arealstatus: 1 }],
  eiendomsgrenser: [], bygninger: [], reguleringsplaner: [], kilder: [], uavklarteForhold: [],
  bebyggelse: { status: "uavklart", bebygd: null, bygninger: [], kilde: "", forklaring: "" },
  arealberegning: { tomtearealM2: 976, kartlagtBebygdArealM2: 200, kartlagtAndelProsent: 20.5, kilde: "", metode: "", forbehold: [] },
  nabotomter: {
    tomter: Array.from({ length: 100 }, (_, i) => ({ id: String(i), ringer: [Array.from({ length: 1000 }, () => [5.31, 60.33] as [number, number])] })),
    kilde: { id: "nabo", status: "ok", navn: "", url: "", hentet: "" }
  }
};
assert(JSON.stringify(largeGrunnlag).length > 30000);
const compact = JSON.stringify(projectGarasjeDialogGrunnlag(largeGrunnlag));
assert(compact.length < 2000);
assert(!compact.includes("ringer") && !compact.includes("nabotomter") && !compact.includes("Ikke send adressen"));
assert(compact.includes('"tomtearealM2":976'));

// Exercise the real selection/loading functions without needing running data services.
const pageSource = stripTypeScriptTypes(await readFile("apps/demo-gui/src/client/garasje.ts", "utf8"));
function functionBlock(start: string, end: string) {
  const from = pageSource.indexOf(start), to = pageSource.indexOf(end, from);
  assert(from >= 0 && to > from, `Mangler funksjonsblokk ${start}`);
  return pageSource.slice(from, to);
}
const propertyNodes = new Map<string, Element>();
const propertyEl = (id: string) => {
  if (!propertyNodes.has(id)) propertyNodes.set(id, new Element());
  return propertyNodes.get(id)!;
};
propertyEl("property-workspace").hidden = true;
const loads: string[] = [];
let finishLoad: (value: GarasjeGrunnlag) => void = () => {};
let failLoad: (error: Error) => void = () => {};
let maps = 0;
const selection = createContext({
  URLSearchParams,
  krevEl: propertyEl,
  form: propertyEl("garage-form"),
  svg: { querySelector: () => ({ removeAttribute() {} }) },
  utfylling: { cancel() {} },
  element: (_tag: string, text = "") => { const node = new Element(); node.textContent = text; return node; },
  fitKartutsnitt: () => ({ west: 5, east: 6, south: 60, north: 61 }),
  api: (url: string) => {
    loads.push(url);
    return new Promise<GarasjeGrunnlag>((resolve, reject) => { finishLoad = resolve; failLoad = reject; });
  },
  renderGrunnlag() {},
  renderMap() { maps++; },
  updateMarker() {},
  adresse: { ...largeGrunnlag.adresse, adressetekst: "Litle Milde 65", gardsnummer: 105, bruksnummer: 209, kommunenavn: "BERGEN" }
});
runInContext(`
  let propertyConfirmed = false, propertyVersion = 0, placementChosen = false, placementConfirmed = false;
  let busy = false, pendingSave = false;
  let grunnlag = null, vurdering = null, valgtAdresse = null, plassering = null, bounds = {};
  ${functionBlock("function invalidateResult", "async function perform")}
  ${functionBlock("function selectedQuery", "async function searchAdresse")}
  ${functionBlock("async function selectAdresse", "function renderGrunnlag")}
  ${functionBlock("function moveMarker", "const numericFields")}
`, selection);
await runInContext("selectAdresse(adresse)", selection);
assert.equal(loads.length, 0, "Adressevalg skal ikke hente kartdata");
assert.equal(propertyEl("property-workspace").hidden, true);
assert.equal(propertyEl("garage-form").hidden, true);
assert.equal(propertyEl("confirm-property").hidden, false);
assert.equal(propertyEl("property-facts").hidden, false);
assert.equal(propertyEl("property-facts").children[0].textContent, "Litle Milde 65");
assert.equal(propertyEl("property-facts").children[1].textContent, "gnr. 105, bnr. 209, Kommune: Bergen (4601)");
assert.equal(runInContext("formatEiendomsdetaljer({...adresse,kommunenummer:'0301',kommunenavn:'OSLO'})", selection),
  "gnr. 105, bnr. 209, Kommune: Oslo (0301)");
assert.equal(runInContext("formatEiendomsdetaljer({...adresse,kommunenavn:undefined})", selection),
  "gnr. 105, bnr. 209, Kommune: 4601");
await assert.rejects(runInContext("refreshGrunnlag()", selection), /Bekreft eiendommen/);
const firstLoad = runInContext("confirmProperty()", selection);
assert.equal(loads.length, 1);
assert.equal(propertyEl("property-workspace").hidden, true, "Kartet skjules mens data lastes");
finishLoad(largeGrunnlag);
await firstLoad;
assert.equal(propertyEl("property-workspace").hidden, false);
assert.equal(propertyEl("garage-form").hidden, true, "Adressebekreftelse skal ikke åpne garasjespørsmålene");
assert.equal(propertyEl("garage-step").hidden, true);
assert.equal(propertyEl("property-controls").hidden, true, "Adressevalget lukkes når eiendommen er bekreftet");
assert.equal(propertyEl("edit-property").hidden, false);
assert.equal(maps, 1);
await assert.rejects(runInContext("confirmPlacement()", selection), /Plasser garasjen/);
assert.equal(loads.length, 1, "Adressepunktet skal ikke automatisk godtas som garasjeplassering");
runInContext("moveMarker({lat:60.33,lon:5.3101})", selection);
assert.equal(propertyEl("garage-step").hidden, true, "Flytting av markøren skal ikke alene åpne neste steg");
const failedPlacement = runInContext("confirmPlacement()", selection);
failLoad(new Error("Plankilden er utilgjengelig"));
await assert.rejects(failedPlacement, /Plankilden er utilgjengelig/);
assert.equal(propertyEl("garage-form").hidden, true);
assert.equal(propertyEl("property-workspace").hidden, false, "Kartet beholdes slik at plasseringen kan bekreftes på nytt");
assert.match(propertyEl("placement-note").textContent, /Plasseringen er ikke bekreftet/);
const placementRetry = runInContext("confirmPlacement()", selection);
finishLoad(largeGrunnlag);
await placementRetry;
assert.equal(propertyEl("placement-step").hidden, true);
assert.equal(propertyEl("placement-summary").hidden, false);
assert.equal(propertyEl("garage-step").hidden, false);
assert.equal(propertyEl("garage-form").hidden, false);
assert.equal(propertyEl("garage-heading").focusCount, 1);
propertyEl("bya").value = "35";
runInContext("vurdering = {}; editPlacement()", selection);
assert.equal(propertyEl("placement-step").hidden, false);
assert.equal(propertyEl("garage-step").hidden, true);
assert.equal(runInContext("vurdering", selection), null, "Endring av plassering skal skjule tidligere vurdering");
const reconfirmed = runInContext("confirmPlacement()", selection);
finishLoad(largeGrunnlag);
await reconfirmed;
assert.equal(propertyEl("garage-form").hidden, false);
assert.equal(propertyEl("bya").value, "35", "Svarutkastet skal overleve ny bekreftelse av plasseringen");
assert.equal(maps, 3);
runInContext("clearConfirmation()", selection);
assert.equal(propertyEl("property-workspace").hidden, true, "Adresseendring skal skjule gammelt kart");
assert.equal(propertyEl("garage-form").hidden, true);
assert.equal(propertyEl("property-controls").hidden, false);
assert.equal(propertyEl("garage-step").hidden, true);
const failed = runInContext("confirmProperty()", selection);
failLoad(new Error("Kartkilden er utilgjengelig"));
await assert.rejects(failed, /Kartkilden er utilgjengelig/);
assert.equal(propertyEl("confirm-property").hidden, false);
assert.match(propertyEl("confirm-property").textContent, /Prøv å hente/);
assert.equal(propertyEl("property-workspace").hidden, true);
const retry = runInContext("confirmProperty()", selection);
finishLoad(largeGrunnlag);
await retry;
assert.equal(maps, 4);
runInContext("clearConfirmation()", selection);
const outdated = runInContext("confirmProperty()", selection);
await runInContext("selectAdresse({...adresse, adressetekst: 'En annen adresse'})", selection);
finishLoad(largeGrunnlag);
await assert.rejects(outdated, /Eiendomsvalget er endret/);
assert.equal(maps, 4, "Et sent svar fra tidligere eiendom skal ikke tegnes");
assert.equal(propertyEl("property-workspace").hidden, true);
assert.equal(propertyEl("confirm-property").textContent, "Bekreft eiendom");
const neighbourDetails = new Element(), neighbourLabels = new Element();
let drawnNeighbours = 0;
const neighbours = createContext({
  krevEl: (id: string) => id === "neighbour-details" ? neighbourDetails : new Element(),
  svg: { querySelector: () => neighbourLabels },
  document: { createElementNS: () => new Element() },
  drawPolygons: (id: string, polygons: unknown[], className: string) => {
    assert.equal(id, "map-neighbours");
    assert.equal(className, "neighbour");
    drawnNeighbours = polygons.length;
  },
  element: (_tag: string, text = "") => { const node = new Element(); node.textContent = text; return node; },
  addLink: (parent: Element, text: string) => { const node = new Element(); node.textContent = text; parent.append(node); },
  findNabotomtLabel: () => ({ x: 50, y: 50, width: 48 }),
  bounds: {},
  data: {
    eiendomsgrenser: [],
    nabotomter: {
      tomter: [{ id: "nabo-1", teig: { gnr: 105, bnr: 1, fnr: 0 }, registrertArealM2: 43054.9, ringer: [] }],
      kilde: { id: "nabotomter", navn: "Lokalt teiguttrekk", status: "ok", fil: "matrikkel_bk_25.json", url: "http://localhost/naboteiger" }
    }
  }
});
runInContext(functionBlock("function renderNeighbours", "function renderMap"), neighbours);
runInContext("renderNeighbours(data)", neighbours);
assert.equal(drawnNeighbours, 1, "Nabogrensen skal fortsatt tegnes på kartet");
assert.equal(neighbourLabels.children[0].textContent, "105/1", "Nabonummeret vises på kartet");
const neighbourText = neighbourDetails.children.map(node => node.textContent).join(" ");
assert(!neighbourText.includes("105/1") && !neighbourText.includes("43") && !neighbourText.includes("oppgitt teigareal"),
  "Detaljlisten over naboeiendommer skal ikke vises");

const mapNodes = new Map<string, Element>();
const mapEl = (id: string) => {
  if (!mapNodes.has(id)) mapNodes.set(id, new Element());
  return mapNodes.get(id)!;
};
const polygon: GarasjeGrunnlag["eiendomsgrenser"][number] = {
  id: "karttest", ringer: [[[5.31, 60.33], [5.311, 60.33], [5.311, 60.331], [5.31, 60.33]]]
};
const mapGrunnlag: GarasjeGrunnlag = {
  ...largeGrunnlag,
  eiendomsgrenser: [polygon], bygninger: [polygon],
  nabotomter: { tomter: [polygon], kilde: { id: "nabotomter", navn: "Karttest", url: "https://kart.test/nabo", status: "ok", hentet: "" } },
  kilder: [
    { id: "eiendomsgrenser", navn: "Teiger", url: "https://kart.test/teiger", status: "ok", hentet: "" },
    { id: "kpa", navn: "KPA", url: "https://kart.test/MapServer/0", status: "ok", hentet: "" }
  ]
};
let displayedGrunnlag: GarasjeGrunnlag | null = null;
const mapView = createContext({
  URL, URLSearchParams,
  krevEl: mapEl,
  svg: { querySelector: (selector: string) => mapEl(selector.slice(1)) },
  document: { createElementNS: () => new Element() },
  element: (_tag: string, text = "") => { const node = new Element(); node.textContent = text; return node; },
  addLink() {},
  findNabotomtLabel: () => null,
  fitKartutsnitt: () => ({ west: 5.31, east: 5.312, south: 60.33, north: 60.332 }),
  xy: ({ lon, lat }: { lon: number; lat: number }) => [lon, lat],
  renderGrunnlag: (data: GarasjeGrunnlag) => { displayedGrunnlag = data; },
  bounds: {}, grunnlag: null, vurdering: null, plassering: mapGrunnlag.punkt
});
runInContext(`
  ${functionBlock("function drawPolygons", "function moveMarker")}
  ${functionBlock("function renderVurdering", "async function loadPerson")}
`, mapView);
for (const count of [1, 0, 2]) {
  const fresh: GarasjeGrunnlag = {
    ...mapGrunnlag,
    eiendomsgrenser: Array.from({ length: count }, () => polygon),
    bygninger: Array.from({ length: count }, () => polygon),
    nabotomter: { tomter: Array.from({ length: count }, () => polygon), kilde: { ...mapGrunnlag.nabotomter!.kilde, status: count ? "ok" : "feil" } },
    kilder: mapGrunnlag.kilder.map(kilde => ({ ...kilde, status: count ? "ok" : "feil" }))
  };
  mapView.result = {
    grunnlag: fresh, sporingsId: "karttest",
    vurdering: { utfall: "maa_avklares", nasjonaltUnntak: "uavklart", forklaring: "Karttest", sjekker: [], uavklarteForhold: [] }
  };
  runInContext("renderVurdering(result)", mapView);
  assert.equal(displayedGrunnlag, fresh, "Kildefremvisningen skal bruke det ferske vurderingsgrunnlaget");
  for (const group of ["map-parcels", "map-buildings", "map-neighbours"]) {
    assert.equal(mapEl(group).children.length, count, `${group} skal tegnes på nytt både ved kildefeil og når kilden virker igjen`);
  }
  assert.equal(Boolean(mapEl("map-image").attributes.href), count > 0, "Gammelt bakgrunnskart skal fjernes ved kildefeil");
}
console.log("Garasje-UX: tema, ett felt av gangen, modusbytte, agentsvar, tydelig redigering og bevarte utkast besto.");
console.log("Eiendomsvalg: adresse før kart, bekreftet plassering før utfylling, nytt forsøk og avvisning av foreldede svar besto.");
console.log("Vurderingskart: teiger, bygninger, nabogrenser og bakgrunn følger det ferske grunnlaget ved feil og gjenoppretting.");
