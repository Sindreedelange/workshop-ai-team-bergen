import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { createContext, runInContext } from "node:vm";
import { ringerInneholder } from "../apps/shared/geometri.ts";
import { nearestPolygonBoundary } from "../apps/demo-gui/src/client/tiltakshjelpen-kart.ts";
import { projectTiltakshjelpenDialogGrunnlag } from "../apps/shared/tiltakshjelpen-dialog.ts";
import { beskrivTiltakshjelpenUtfall, hensynssonenavn } from "../apps/shared/tiltakshjelpen.ts";
import type { TiltakshjelpenGrunnlag } from "../apps/shared/tiltakshjelpen.ts";

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
  placeholder = "";
  required = false;
  validationMessage = "Ugyldig verdi";
  focusCount = 0;
  parentElement?: Element;
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  children: Element[] = [];
  get options() { return this.children; }
  listeners = new Map<string, ((event: Event) => unknown)[]>();
  addEventListener(type: string, fn: (event: Event) => unknown, options?: { signal?: AbortSignal }) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), event => {
      if (!options?.signal?.aborted) return fn(event);
    }]);
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

const themeSource = stripTypeScriptTypes(await readFile("apps/demo-gui/src/client/tiltakshjelpen-tema.ts", "utf8"));
function theme(stored: string | null, denied = false, legacy: string | null = null) {
  const select = new Element();
  const note = new Element();
  const root = { dataset: {} as Record<string, string> };
  const storage = new Map<string, string>(stored === null ? [] : [["tiltakshjelpen-color-scheme", stored]]);
  if (legacy !== null) storage.set("garasjesjekk-color-scheme", legacy);
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
  return { select, note, root, storage, warnings, update: (value: string | null) => storageListener({ key: "tiltakshjelpen-color-scheme", newValue: value }) };
}
assert.equal(theme(null).root.dataset.colorScheme, "dark");
const light = theme("light");
assert.equal(light.root.dataset.colorScheme, "light");
light.select.value = "dark";
light.select.dispatch("change");
assert.equal(light.storage.get("tiltakshjelpen-color-scheme"), "dark");
assert.equal(theme(light.storage.get("tiltakshjelpen-color-scheme")!).root.dataset.colorScheme, "dark");
assert.equal(theme(null, false, "light").root.dataset.colorScheme, "light", "Gammelt temavalg skal fortsatt brukes");
assert.equal(theme("dark", false, "light").root.dataset.colorScheme, "dark", "Nytt temavalg skal gå foran det gamle");
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
  { id: "bya", label: "BYA", type: "tall", ukjentTillatt: false },
  { id: "bra", label: "BRA", type: "tall", ukjentTillatt: false },
  { id: "gesimshoyde", label: "Gesims", type: "tall", ukjentTillatt: false },
  { id: "monehoyde", label: "Møne", type: "tall", ukjentTillatt: false },
  { id: "etasjer", label: "Etasjer", type: "tall", ukjentTillatt: false },
  { id: "avstandNabogrense", label: "Avstand", type: "tall", ukjentTillatt: true },
  { id: "beboelse", label: "Beboelse", type: "valg", ukjentTillatt: true }
];
for (const field of fields) {
  const node = el(field.id);
  node.type = field.type === "tall" ? "number" : "select";
  node.min = "0.01";
  node.max = "1000";
  node.required = !field.ukjentTillatt;
  node.parentElement = new Element();
}
let locked = false;
let changed = 0;
let answer: {
  type: string; tekst: string; svar?: number | boolean | null;
  advarsel?: string; kunnskapsadvarsel?: string;
  dokumentkunnskap?: {
    documentId: string; title?: string; page: number; canonicalUrl?: string;
    checkRecommended?: boolean; qualityWarnings?: string[];
  }[];
} = { type: "svar", tekst: "Jeg forstår 35", svar: 35 };
let resolveDelayed: ((value: typeof answer) => void) | undefined;
let delayed = false;
const requests: { fieldId: string; text: string; signal: AbortSignal }[] = [];
const context = createContext({
  document: { getElementById: el, createElement: () => new Element() },
  AbortController,
  options: {
    fields, locked: () => locked, changed: () => { changed++; },
    ask: (fieldId: string, text: string, signal: AbortSignal) => {
      requests.push({ fieldId, text, signal });
      return delayed ? new Promise<typeof answer>(resolve => { resolveDelayed = resolve; }) : Promise.resolve(answer);
    }
  }
});
const source = stripTypeScriptTypes(await readFile("apps/demo-gui/src/client/tiltakshjelpen-utfylling.ts", "utf8"))
  .replace("export function createTiltakshjelpenUtfylling", "function createTiltakshjelpenUtfylling");
runInContext(source, context);
const ui = runInContext("createTiltakshjelpenUtfylling(options)", context);
const settled = () => new Promise(resolve => setImmediate(resolve));
const write = (id: string, value: string) => { el(id).value = value; el(id).dispatch("input"); };
const send = async (text: string, response: typeof answer) => {
  answer = response;
  el("dialog-input").value = text;
  el("dialog-send").dispatch("click");
  await settled();
};
assert.equal(el("mode-agent").attributes["aria-pressed"], "true");
assert.equal(el("dialog-group").children.length, 2, "BYA og BRA skal vises sammen i agentmodus");
assert.match(el("dialog-input").placeholder, /BYA.*m²/);
assert.equal(el("dialog-next").disabled, true);
el("mode-stepwise").dispatch("click");
assert.equal(el("agent-interview").hidden, false, "Den samme tekstboksen skal være tilgjengelig i stegvis modus");
assert.equal(el("bya").parentElement!.hidden, false);
assert.equal(el("bra").parentElement!.hidden, false, "BYA og BRA skal stå på samme side");
assert.equal(el("gesimshoyde").parentElement!.hidden, true);
el("field-next").dispatch("click");
assert.equal(el("interview-error").hidden, false);
write("bya", "35");
el("field-next").dispatch("click");
assert.equal(el("gesimshoyde").parentElement!.hidden, true, "Begge arealene må besvares før neste gruppe");
write("bra", "30");
el("field-next").dispatch("click");
assert.equal(el("gesimshoyde").parentElement!.hidden, false);
assert.equal(el("monehoyde").parentElement!.hidden, false, "Gesims og møne skal stå på samme side");
el("mode-agent").dispatch("click");
assert.equal(el("bya").value, "35", "Modusbytte skal bevare feltverdier");
assert.equal(el("bra").value, "30");
assert(el("dialog-question").textContent.includes("Gesims"));
assert.equal(el("dialog-input").placeholder, "For eksempel 3,5 meter");
await send("Hva er gesims?", { type: "sporsmaal", tekst: "Gesims er der vegg og tak møtes." });
assert.equal(el("gesimshoyde").value, "");
assert.equal(el("dialog-proposal").hidden, true);
assert(el("dialog-question").textContent.includes("Gesims"), "Et spørsmål skal ikke flytte utfyllingen");
const beforeDocumentQuestion = changed;
await send("Hva sier planen om høyden?", {
  type: "sporsmaal", tekst: "Avklar høyden i den gjeldende planen.",
  advarsel: "Modellens svar er bare veiledning.",
  kunnskapsadvarsel: "Søket dekker ikke hele planen.",
  dokumentkunnskap: [
    { documentId: "pdf-plan", title: "KPA2018", page: 7, canonicalUrl: "https://example.test/plan",
      checkRecommended: true, qualityWarnings: ["OCR-teksten må kontrolleres."] },
    { documentId: "pdf-ukjent", page: 2, canonicalUrl: "javascript:alert(1)" }
  ]
});
assert.equal(el("gesimshoyde").value, "");
assert.equal(changed, beforeDocumentQuestion, "Dokumenthjelp må ikke endre svaret");
assert.match(el("dialog-answer").textContent, /Modellens svar er bare veiledning/);
assert.match(el("dialog-answer").textContent, /Dokumentgrunnlag: Søket dekker ikke hele planen/);
assert.equal(el("dialog-sources").hidden, false);
const citation = el("dialog-sources").children[0];
assert.equal(citation.children[0].textContent, "KPA2018, side 7");
assert.equal(citation.children[0].attributes.href, "https://example.test/plan");
assert.equal(citation.children[0].attributes.rel, "noopener noreferrer");
assert.match(citation.children[1].textContent, /Kontroll anbefales.*OCR/);
assert.match(el("dialog-sources").children[1].textContent, /pdf-ukjent, side 2.*Kildelenke mangler eller er ugyldig/);
assert.equal(el("dialog-sources").children[1].children.length, 0, "Utrygge kilde-URL-er må ikke bli lenker");
el("mode-stepwise").dispatch("click");
assert.equal(el("dialog-sources").hidden, true, "Kilder fra chatten skal ikke følge med ved modusbytte");
el("mode-agent").dispatch("click");
await send("Hvor finnes planen?", {
  type: "sporsmaal", tekst: "Spør kommunen om gjeldende bestemmelser.",
  kunnskapsadvarsel: "PDF-kunnskapsbasen er utilgjengelig.", dokumentkunnskap: []
});
assert.match(el("dialog-answer").textContent, /PDF-kunnskapsbasen er utilgjengelig/);
assert.equal(el("dialog-sources").hidden, true);
await send("3 meter", { type: "svar", tekst: "Jeg forstår 3", svar: 3 });
assert.doesNotMatch(el("dialog-answer").textContent, /PDF|Søket/);
assert.equal(el("dialog-sources").children.length, 0, "Tidligere kilder skal fjernes når et nytt svar vises");
assert.equal(el("gesimshoyde").value, "", "Agentforslaget skal ikke lagres uten bekreftelse");
assert.equal(el("dialog-editor").hidden, true, "Bekreftelsesknappene skal erstatte tekstboksen");
const beforeHelp = changed;
el("dialog-more").dispatch("click");
assert.equal(el("dialog-editor").hidden, false);
await send("Er det målt fra bakken?", { type: "svar", tekst: "Agenten feiltolket spørsmålet", svar: 7 });
assert.equal(el("gesimshoyde").value, "");
assert.equal(changed, beforeHelp, "Hjelp skal være statsløs selv hvis modellen foreslår et svar");
assert.match(el("dialog-proposal-text").textContent, /3 for/, "Hjelp skal ikke erstatte det ubekreftede forslaget");
el("dialog-resume").dispatch("click");
assert.equal(el("dialog-editor").hidden, true);
const beforeRejection = changed;
el("dialog-reject").dispatch("click");
assert.equal(el("dialog-proposal").hidden, true);
assert.equal(el("interview-editing").hidden, false);
assert.match(el("interview-editing").textContent, /Du endrer «Gesims»/);
assert.match(el("dialog-input-label").textContent, /Endre svaret for «Gesims»/);
assert.equal(el("dialog-input").value, "3 meter", "Endring skal gjenopprette teksten innbyggeren skrev");
assert(el("dialog-input").focusCount > 0, "Fokus skal flyttes til tekstboksen");
assert.equal(el("gesimshoyde").value, "");
assert.equal(changed, beforeRejection, "Et avvist forslag skal ikke endre lagrede svar");
await send("3 meter", { type: "svar", tekst: "3", svar: 3 });
el("dialog-accept").dispatch("click");
assert.equal(el("gesimshoyde").value, "3");
assert.equal(el("interview-editing").hidden, true, "Endringsmeldingen skal forsvinne når svaret bekreftes");
assert(el("dialog-question").textContent.includes("Møne"));
assert.equal(el("dialog-answer").textContent, "", "Forrige svar skal ikke følge med til et annet mål i gruppen");
assert.equal(el("dialog-group").children.length, 2);
el("mode-stepwise").dispatch("click");
assert.equal(el("dialog-log").hidden, true, "Stegvis visning skal ikke vise chatlogg");
write("monehoyde", "4");
el("field-next").dispatch("click");
assert.match(el("dialog-input").placeholder, /etasje/);
write("etasjer", "1");
el("field-next").dispatch("click");
assert.match(el("dialog-input").placeholder, /meter.*vet ikke/);
el("field-next").dispatch("click");
assert.equal(el("avstandNabogrense").parentElement!.hidden, false, "Tomt felt skal ikke bli et implisitt «Vet ikke»");
el("avstandNabogrense").parentElement!.children[0].children[0].dispatch("click");
el("field-next").dispatch("click");
el("field-previous").dispatch("click");
el("field-previous").dispatch("click");
write("etasjer", "2");
assert.equal(el("field-next").textContent, "Tilbake til spørsmål 5");
el("field-next").dispatch("click");
assert.match(el("dialog-input").placeholder, /ja eller nei/, "Neste skal hoppe tilbake til spørsmålet brukeren kom fra");
const stepwiseChoices = el("beboelse").parentElement!.children[0].children;
stepwiseChoices[1].dispatch("click");
assert.equal(el("beboelse").value, "false");
assert.equal(stepwiseChoices[1].attributes["aria-pressed"], "true");
assert.equal(stepwiseChoices[1].dataset.variant, undefined, "Valgt nei-svar skal vises som primærknapp");
assert.equal(stepwiseChoices[0].attributes["aria-pressed"], "false");
assert.equal(stepwiseChoices[0].dataset.variant, "secondary");
el("mode-agent").dispatch("click");
assert.match(el("dialog-input").placeholder, /ja eller nei/);
assert.deepEqual(el("dialog-choices").children.map(child => child.textContent), ["Ja", "Nei", "Vet ikke"]);
const beforeChoice = requests.length;
el("dialog-help").dispatch("click");
await send("Hva regnes som beboelse?", { type: "sporsmaal", tekst: "Beboelse gjelder bruk av bygget." });
assert.equal(el("beboelse").value, "false", "Et spørsmål om feltet skal ikke fjerne valgt nei-svar");
el("dialog-resume").dispatch("click");
el("dialog-choices").children[1].dispatch("click");
assert.equal(requests.length, beforeChoice + 1, "Ja/nei skal ikke være avhengig av et modellkall");
assert.equal(el("beboelse").value, "false");
assert.equal(el("interview-review").hidden, false);
assert.equal(el("assess").hidden, false);
assert.equal(ui.validateComplete(), true);
assert(changed > 0);
const beforeQuestion = changed;
await send("Hva er mønehøyde?", { type: "sporsmaal", tekst: "Du kan spørre om målene før du kjører sjekken." });
assert.equal(el("interview-review").hidden, false, "Spørsmål i oppsummeringen skal ikke åpne et gammelt felt");
assert.equal(el("monehoyde").value, "4");
assert.equal(changed, beforeQuestion, "Fagspørsmål skal ikke endre svarutkastet");
await send("5", { type: "svar", tekst: "5", svar: 5 });
assert.equal(el("dialog-proposal").hidden, true, "Endringer etter oppsummering må knyttes til riktig felt");
assert.equal(el("monehoyde").value, "4");
// Editing an earlier answer preserves later answers and returns directly to the review.
el("answer-summary").children[0].children[1].dispatch("click");
assert.equal(el("interview-review").hidden, true);
assert.equal(el("interview-editing").hidden, false);
assert.match(el("interview-editing").textContent, /Du endrer «BYA».*35/);
el("mode-stepwise").dispatch("click");
write("bya", "40");
assert.equal(el("bra").value, "30");
assert.equal(el("gesimshoyde").value, "3");
assert.equal(el("monehoyde").value, "4");
assert.equal(el("beboelse").value, "false");
assert.equal(ui.validateComplete(), false, "Det endrede svaret skal bekreftes på nytt");
el("mode-agent").dispatch("click");
assert.equal(el("dialog-next").textContent, "Tilbake til oversikten");
assert.equal(el("dialog-next").disabled, false, "Agentmodus skal kunne bekrefte et gyldig endret svar");
el("dialog-next").dispatch("click");
assert.equal(el("interview-review").hidden, false, "Endring fra oversikten skal gå rett tilbake til oversikten");
assert.equal(el("bya").value, "40");
assert.equal(ui.validateComplete(), true, "Senere gyldige svar skal fortsatt være bekreftet");
assert.match(el("answer-summary").children[0].children[0].textContent, /40/);
el("answer-summary").children[2].children[1].dispatch("click");
assert.match(el("dialog-question").textContent, /Gesims/);
// Cancelled replies must never change the current group, proposal, or saved values.
delayed = true;
el("dialog-input").value = "5 meter";
el("dialog-send").dispatch("click");
const cancelled = requests.at(-1)!;
el("mode-stepwise").dispatch("click");
assert.equal(cancelled.signal.aborted, true);
resolveDelayed!({ type: "svar", tekst: "5", svar: 5 });
await settled();
assert.equal(el("monehoyde").value, "4");
assert.equal(el("dialog-proposal").hidden, true);
assert.equal(el("dialog-answer").textContent, "", "Modusbytte skal fjerne tidligere svar og avvise sene svar");
el("dialog-input").value = "5 meter";
el("dialog-send").dispatch("click");
el("field-next").dispatch("click");
resolveDelayed!({ type: "svar", tekst: "5", svar: 5 });
await settled();
assert.equal(el("dialog-proposal").hidden, true, "Et sent agentsvar skal ikke overleve neste steg i skjemaet");
assert.equal(el("monehoyde").value, "4");
assert.equal(el("interview-review").hidden, false);
assert.equal(ui.validateComplete(), true);
el("answer-summary").children[6].children[1].dispatch("click");
el("mode-agent").dispatch("click");
el("dialog-choices").children[2].dispatch("click");
assert.equal(el("beboelse").value, "");
assert.equal(ui.validateComplete(), true, "Et eksplisitt «Vet ikke» er et gyldig svar der det er tillatt");
assert.match(el("answer-summary").children[6].children[0].textContent, /Vet ikke/);
locked = true;
ui.refresh();
assert.equal(el("dialog-send").disabled, true);
assert.equal(el("field-next").disabled, true);
locked = false;
el("answer-summary").children[2].children[1].dispatch("click");
el("dialog-input").value = "6 meter";
el("dialog-send").dispatch("click");
ui.destroy();
resolveDelayed!({ type: "svar", tekst: "6", svar: 6 });
await settled();
assert.equal(el("gesimshoyde").value, "3");
const beforeDestroyed = requests.length;
el("dialog-send").dispatch("click");
assert.equal(requests.length, beforeDestroyed, "Utskifting av tiltak skal fjerne gamle hendelseslyttere");
runInContext("options.fields = []", context);
const emptyUi = runInContext("createTiltakshjelpenUtfylling(options)", context);
assert.equal(emptyUi.validateComplete(), true);
assert.equal(el("agent-interview").hidden, true, "Tiltak uten standardspørsmål skal ikke spørre om et tilfeldig garasjefelt");
assert.equal(el("interview-review").hidden, false);
const measureFields = [
  { id: "hoyde", label: "Gjerdets høyde", type: "tall", ukjentTillatt: false },
  { id: "friSikt", label: "Fri sikt", type: "valg", ukjentTillatt: true }
];
for (const field of measureFields) {
  const node = el(field.id);
  node.parentElement = new Element();
  node.type = field.type === "tall" ? "number" : "select";
  node.required = !field.ukjentTillatt;
}
context.measureFields = measureFields;
runInContext("options.fields = measureFields", context);
const measureUi = runInContext("createTiltakshjelpenUtfylling(options)", context);
assert.equal(el("dialog-input").placeholder, "For eksempel 0,9 meter");
el("mode-stepwise").dispatch("click");
write("hoyde", "1.2");
el("field-next").dispatch("click");
el("mode-agent").dispatch("click");
el("dialog-choices").children[0].dispatch("click");
assert.equal(el("friSikt").value, "true");
assert.equal(measureUi.validateComplete(), true, "Andre tiltakstyper skal ikke kreve garasjens høydefelter");
measureUi.destroy();
for (const field of measureFields) el(field.id).parentElement = new Element();
runInContext("createTiltakshjelpenUtfylling(options)", context);
delayed = false;
const beforeRecreated = requests.length;
await send("1,5 meter", { type: "svar", tekst: "1,5", svar: 1.5 });
assert.equal(requests.length, beforeRecreated + 1, "Nytt tiltak skal ha nøyaktig én aktiv lytter på send-knappen");
assert.equal(requests.at(-1)!.fieldId, "hoyde");
const html = await readFile("apps/demo-gui/src/tiltakshjelpen.html", "utf8");
assert(!html.includes("Prøv en case"));
assert(!html.includes("case-milde"));
assert(html.includes('data-color-scheme="dark"'));
assert(html.indexOf('href="/assets/ds-morketema.css"') > html.indexOf('href="/assets/ds-ksdigital.css"'));
assert.match(html, /<svg id="placement-map"[^>]*tabindex="0"[^>]*aria-describedby="map-help"/);
assert(html.indexOf('id="measure-plan-notices"') > html.indexOf('id="placement-map"'),
  "Varsler som tømmes ved markørflytting må stå etter kartet, så kartet ikke hopper under draget");
assert.match(html, /touch-action: none; user-select: none;/);
assert(html.indexOf('id="result-follow-up"') < html.indexOf('id="result-limitations"'));
assert(html.indexOf('id="result-limitations"') < html.indexOf('id="result-fulfilled"'),
  "Både uavklarte vilkår og forbehold skal stå før oppfylte vilkår");
const pageHeader = html.match(/<header class="page-header">([\s\S]*?)<\/header>/)?.[1];
assert(pageHeader, "Siden skal ha et toppfelt");
assert(pageHeader.includes('aria-label="Innstillinger"') && pageHeader.includes('id="theme"'), "Temavalget skal ligge i innstillingsfeltet i toppfeltet");
assert(!pageHeader.match(/<nav\b[\s\S]*?<\/nav>/)?.[0].includes('id="theme"'), "Temavalget skal ikke skjules sammen med navigasjonen i innebygd visning");
assert.equal((html.match(/id="theme"/g) || []).length, 1);
assert(html.includes('id="property-workspace" class="stack"'));
assert(html.includes('id="measure-step" class="panel stack" aria-labelledby="measure-heading" hidden'));
assert(html.includes("Bekreft plassering og fortsett"));
assert(html.includes('id="measure-form" class="stack" novalidate'));
assert.equal((html.match(/<textarea\b/g) || []).length, 1, "Svar og spørsmål skal dele én tekstboks");
assert(!html.includes('id="help-question"') && !html.includes('id="help-form"'));
assert(html.includes("<title>Tiltakshjelpen - kan du bygge uten å søke?</title>"));
assert(html.includes(">Bekreft svar</button>") && html.includes(">Jeg har flere spørsmål</button>"));
assert(html.includes(">Jeg lurer på noe</button>") && html.includes('id="dialog-next"'));
assert(!/id="move-(north|south|east|west)"/.test(html), "Retningsknapper skal være erstattet med piltaster i kartet");
const largeGrunnlag: TiltakshjelpenGrunnlag = {
  adresse: { adressetekst: "Ikke send adressen", kommunenummer: "4601", gardsnummer: 20, bruksnummer: 1413, festenummer: 0, undernummer: 0, punkt: { lat: 60.33, lon: 5.31 } },
  punkt: { lat: 60.33, lon: 5.31 }, arealformaal: [{ kode: 1001, planId: "65270000", beskrivelse: "Øvrig byggesone", sonenavn: "Øvrig byggesone", arealstatus: 1 }],
  eiendomsgrenser: [], bygninger: [], reguleringsplaner: [], planflater: [], kilder: [], uavklarteForhold: [],
  bebyggelse: { status: "uavklart", bebygd: null, bygninger: [], kilde: "", forklaring: "" },
  arealberegning: { tomtearealM2: 976, kartlagtBebygdArealM2: 200, kartlagtAndelProsent: 20.5, kilde: "", metode: "", forbehold: [] },
  nabotomter: {
    tomter: Array.from({ length: 100 }, (_, i) => ({ id: String(i), ringer: [Array.from({ length: 1000 }, () => [5.31, 60.33] as [number, number])] })),
    kilde: { id: "nabo", status: "ok", navn: "", url: "", hentet: "" }
  }
};
assert(JSON.stringify(largeGrunnlag).length > 30000);
const compact = JSON.stringify(projectTiltakshjelpenDialogGrunnlag(largeGrunnlag));
assert(compact.length < 2000);
assert(!compact.includes("ringer") && !compact.includes("nabotomter") && !compact.includes("Ikke send adressen"));
assert(compact.includes('"tomtearealM2":976'));

// Exercise the real selection/loading functions without needing running data services.
const pageSource = stripTypeScriptTypes(await readFile("apps/demo-gui/src/client/tiltakshjelpen.ts", "utf8"));
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
let finishLoad: (value: TiltakshjelpenGrunnlag) => void = () => {};
let failLoad: (error: Error) => void = () => {};
let maps = 0;
const selection = createContext({
  URLSearchParams,
  krevEl: propertyEl,
  form: propertyEl("measure-form"),
  svg: { querySelector: () => ({ removeAttribute() {} }) },
  utfylling: { cancel() {} },
  element: (_tag: string, text = "") => { const node = new Element(); node.textContent = text; return node; },
  fitKartutsnitt: () => ({ west: 5, east: 6, south: 60, north: 61 }),
  api: (url: string) => {
    loads.push(url);
    return new Promise<TiltakshjelpenGrunnlag>((resolve, reject) => { finishLoad = resolve; failLoad = reject; });
  },
  renderGrunnlag() {},
  renderMap() { maps++; },
  updateMarker() {},
  updateZoneStatus() {},
  updatePlacementStatus() {},
  placementOnProperty: () => null,
  adresse: { ...largeGrunnlag.adresse, adressetekst: "Litle Milde 65", gardsnummer: 105, bruksnummer: 209, kommunenavn: "BERGEN" }
});
runInContext(`
  let propertyConfirmed = false, propertyVersion = 0, placementChosen = false, placementConfirmed = false;
  let tiltakstypeBekreftet = true, tiltakstype = "frittliggende", tiltaksvalg = undefined;
  let busy = false, pendingSave = false;
  let grunnlag = null, vurdering = null, valgtAdresse = null, plassering = null, bounds = {};
  let kartgrunnlag = null, planflater = [], plankilde = undefined;
  ${functionBlock("function invalidateResult", "async function perform")}
  ${functionBlock("function selectedQuery", "async function searchAdresse")}
  ${functionBlock("async function selectAdresse", "function renderGrunnlag")}
  ${functionBlock("function moveMarker", "const numericFields")}
`, selection);
await runInContext("selectAdresse(adresse)", selection);
assert.equal(loads.length, 0, "Adressevalg skal ikke hente kartdata");
assert.equal(propertyEl("property-workspace").hidden, true);
assert.equal(propertyEl("measure-form").hidden, true);
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
assert.equal(propertyEl("measure-form").hidden, true, "Adressebekreftelse skal ikke åpne garasjespørsmålene");
assert.equal(propertyEl("measure-step").hidden, true);
assert.equal(propertyEl("property-controls").hidden, true, "Adressevalget lukkes når eiendommen er bekreftet");
assert.equal(propertyEl("edit-property").hidden, false);
assert.equal(maps, 1);
await assert.rejects(runInContext("confirmPlacement()", selection), /Plasser tiltaket/);
assert.equal(loads.length, 1, "Adressepunktet skal ikke automatisk godtas som garasjeplassering");
runInContext("moveMarker({lat:60.33,lon:5.3101})", selection);
assert.equal(propertyEl("measure-step").hidden, true, "Flytting av markøren skal ikke alene åpne neste steg");
const failedPlacement = runInContext("confirmPlacement()", selection);
failLoad(new Error("Plankilden er utilgjengelig"));
await assert.rejects(failedPlacement, /Plankilden er utilgjengelig/);
assert.equal(propertyEl("measure-form").hidden, true);
assert.equal(propertyEl("property-workspace").hidden, false, "Kartet beholdes slik at plasseringen kan bekreftes på nytt");
assert.match(propertyEl("placement-note").textContent, /Plasseringen er ikke bekreftet/);
const placementRetry = runInContext("confirmPlacement()", selection);
finishLoad(largeGrunnlag);
await placementRetry;
assert.equal(propertyEl("placement-step").hidden, true);
assert.equal(propertyEl("placement-summary").hidden, false);
assert.equal(propertyEl("measure-step").hidden, false);
assert.equal(propertyEl("measure-form").hidden, false);
assert.equal(propertyEl("measure-heading").focusCount, 1);
propertyEl("bya").value = "35";
runInContext("vurdering = {}; editPlacement()", selection);
assert.equal(propertyEl("placement-step").hidden, false);
assert.equal(propertyEl("measure-step").hidden, true);
assert.equal(runInContext("vurdering", selection), null, "Endring av plassering skal skjule tidligere vurdering");
const reconfirmed = runInContext("confirmPlacement()", selection);
finishLoad(largeGrunnlag);
await reconfirmed;
assert.equal(propertyEl("measure-form").hidden, false);
assert.equal(propertyEl("bya").value, "35", "Svarutkastet skal overleve ny bekreftelse av plasseringen");
assert.equal(maps, 3);
runInContext("clearConfirmation()", selection);
assert.equal(propertyEl("property-workspace").hidden, true, "Adresseendring skal skjule gammelt kart");
assert.equal(propertyEl("measure-form").hidden, true);
assert.equal(propertyEl("property-controls").hidden, false);
assert.equal(propertyEl("measure-step").hidden, true);
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
  planflater: [],
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
const polygon: TiltakshjelpenGrunnlag["eiendomsgrenser"][number] = {
  id: "karttest", ringer: [[[5.31, 60.33], [5.311, 60.33], [5.311, 60.331], [5.31, 60.33]]]
};
const mapGrunnlag: TiltakshjelpenGrunnlag = {
  ...largeGrunnlag,
  eiendomsgrenser: [polygon], bygninger: [polygon],
  nabotomter: { tomter: [polygon], kilde: { id: "nabotomter", navn: "Karttest", url: "https://kart.test/nabo", status: "ok", hentet: "" } },
  kilder: [
    { id: "eiendomsgrenser", navn: "Teiger", url: "https://kart.test/teiger", status: "ok", hentet: "" },
    { id: "kpa", navn: "KPA", url: "https://kart.test/MapServer/0", status: "ok", hentet: "" }
  ]
};
let displayedGrunnlag: TiltakshjelpenGrunnlag | null = null;
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
  renderGrunnlag: (data: TiltakshjelpenGrunnlag) => { displayedGrunnlag = data; },
  async renderTiltaksraad() {},
  ringerInneholder,
  nearestPolygonBoundary,
  beskrivTiltakshjelpenUtfall,
  hensynssonenavn,
  bounds: {}, grunnlag: null, kartgrunnlag: null, plankilde: undefined,
  vurdering: null, planflater: [], plassering: mapGrunnlag.punkt
});
runInContext(`
  ${functionBlock("function drawPolygons", "function moveMarker")}
  ${functionBlock("function renderVurdering", "async function loadPerson")}
`, mapView);
for (const count of [1, 0, 2]) {
  const fresh: TiltakshjelpenGrunnlag = {
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
/*
 * Svaret innbyggeren leser først, og reglenes egne neste steg.
 *
 * Gjennomgangen ba om «et tydelig svar, selv om det er «Du bør kontakte lokale
 * rådgivere»». Utfallet sto som et kodenavn i overskriften, og `nesteSteg` - som
 * navngir bestemmelsene innbyggeren skal spørre kommunen om - ble hentet fra
 * backend og aldri vist.
 */
mapView.result = {
  grunnlag: mapGrunnlag, sporingsId: "svartest",
  vurdering: {
    utfall: "soknadspliktig", nasjonaltUnntak: "brudd", forklaring: "Regelforklaringen.",
    sjekker: [{ id: "areal", navn: "BRA og BYA", status: "brudd", forklaring: "For stort.", kilde: "https://dibk.test/4-1" }],
    uavklarteForhold: [], nesteSteg: ["Send kommunen skisse og mål.", "Be om avklaring av dispensasjon."]
  }
};
runInContext("renderVurdering(result)", mapView);
assert.equal(mapEl("result-heading").textContent, "Nei, du må søke",
  "Overskriften skal svare innbyggeren, ikke gjenta kodenavnet på utfallet");
/** All tekst under en node, siden den falske DOM-en ikke arver textContent nedover. */
const alleOrd = (node: Element): string =>
  [node.textContent, ...node.children.map(alleOrd)].filter(Boolean).join(" ");
const svartekst = alleOrd(mapEl("result-summary"));
assert.match(svartekst, /Nei\. Slik tiltaket er beskrevet/, "Svaret skal stå som én setning");
assert.match(svartekst, /Det avgjørende er bra og bya/, "Det avgjørende vilkåret skal navngis");
assert.match(svartekst, /Regelforklaringen/, "Regelens egen forklaring skal fortsatt stå");
assert.match(svartekst, /Send kommunen skisse og mål/, "nesteSteg fra reglene skal vises");
assert.match(svartekst, /Be om avklaring av dispensasjon/, "alle punktene i nesteSteg skal vises");

mapView.result = {
  grunnlag: mapGrunnlag, sporingsId: "svartest",
  vurdering: {
    utfall: "maa_avklares", nasjonaltUnntak: "oppfylt", forklaring: "Planforhold er ikke avklart.",
    sjekker: [{ id: "reguleringsplan", navn: "Reguleringsplanens bestemmelser", status: "uavklart", forklaring: "Ikke lest.", kilde: "https://plan.test" }],
    uavklarteForhold: []
  }
};
runInContext("renderVurdering(result)", mapView);
assert.equal(mapEl("result-heading").textContent, "Kontakt kommunen",
  "Et uavklart utfall skal også gi et tydelig svar");
assert.match(alleOrd(mapEl("result-summary")),
  /Vi kan ikke svare ja eller nei.*Det står igjen å avklare reguleringsplanens bestemmelser/s,
  "Svaret skal si hva som står igjen å avklare");

const mixedVurdering = {
  utfall: "maa_avklares", nasjonaltUnntak: "oppfylt", forklaring: "Planforhold er ikke avklart.",
  sjekker: [
    { id: "areal", navn: "Areal", status: "oppfylt", forklaring: "Arealet er innenfor grensen.", kilde: "" },
    { id: "plan", navn: "Plan", status: "uavklart", forklaring: "Planen må leses.", kilde: "" },
    { id: "punkt", navn: "Plassering", status: "brudd", forklaring: "Utenfor tomten.", kilde: "" },
    { id: "hoyde", navn: "Høyde", status: "oppfylt", forklaring: "Høyden er innenfor grensen.", kilde: "" }
  ],
  uavklarteForhold: [
    "Planen må leses.",
    "En eller flere teiger har usikker eller ukjent grensekvalitet. Det påvirker arealanslaget.",
    "En eller flere teiger har usikker eller ukjent grensekvalitet. Det påvirker arealanslaget."
  ]
};
const originalVurdering = JSON.stringify(mixedVurdering);
mapView.result = { grunnlag: mapGrunnlag, sporingsId: "sortering", vurdering: mixedVurdering };
runInContext("renderVurdering(result)", mapView);
assert.deepEqual(mapEl("checks").children.map(node => node.children[0].textContent),
  ["Ikke oppfylt: Plassering", "Må avklares: Plan"]);
assert.deepEqual(mapEl("fulfilled-checks").children.map(node => node.children[0].textContent),
  ["Oppfylt: Areal", "Oppfylt: Høyde"]);
assert.equal(mapEl("result-caveats").children.length, 1, "Forbehold skal vises én gang, uten å gjenta sjekkens forklaring");
assert.match(alleOrd(mapEl("result-caveats")), /usikker eller ukjent grensekvalitet/);
assert.doesNotMatch(alleOrd(mapEl("result-caveats")), /Må avklares:/,
  "Databegrensninger er ikke flere vilkår brukeren kan fylle ut");
assert.equal(JSON.stringify(mixedVurdering), originalVurdering, "Visningen skal ikke endre regelresultatet eller nedlastingsgrunnlaget");
for (const id of ["result-follow-up", "result-limitations", "result-fulfilled"]) assert.equal(mapEl(id).hidden, false);
mapView.result = {
  grunnlag: mapGrunnlag, sporingsId: "tomt-resultat",
  vurdering: { ...mixedVurdering, sjekker: [], uavklarteForhold: [] }
};
runInContext("renderVurdering(result)", mapView);
for (const id of ["result-follow-up", "result-limitations", "result-fulfilled"]) assert.equal(mapEl(id).hidden, true);

// Bygningsflatene dekker hele oppslagskonvolutten. Bare de som bebyggelsen har
// sammenholdt med teigen er egne bygg; resten er nabobygg og skal se annerledes ut.
const flate = (id: string) => ({ ...polygon, id });
const byggGrunnlag = (
  bygninger: string[], egne: string[], status: TiltakshjelpenGrunnlag["kilder"][number]["status"], merknad?: string
): TiltakshjelpenGrunnlag => ({
  ...mapGrunnlag,
  bygninger: bygninger.map(flate),
  bebyggelse: {
    ...mapGrunnlag.bebyggelse!,
    bygninger: egne.map(id => ({ id, kobling: "geometri" as const })),
  },
  kilder: [...mapGrunnlag.kilder, { id: "bygninger", navn: "Bygningskart", url: "https://kart.test/bygg", status, hentet: "", ...(merknad ? { merknad } : {}) }],
});
const tegnetBygg = () => [mapEl("map-buildings").children.length, mapEl("map-buildings-neighbour").children.length];

mapView.data = byggGrunnlag(["1", "2", "3"], ["2"], "ok");
runInContext("renderMap(data)", mapView);
assert.deepEqual(tegnetBygg(), [1, 2], "Bare bygg som bebyggelsen har koblet til teigen skal tegnes som egne");
assert.match(mapEl("building-status").textContent, /1 bygningsflater på din tomt og 2 på nabotomter/);

mapView.data = byggGrunnlag(["1", "2"], [], "ok");
runInContext("renderMap(data)", mapView);
assert.deepEqual(tegnetBygg(), [2, 0],
  "Uten en avklart bebyggelse skal ingen flater påstås å ligge på nabotomt");
assert.match(mapEl("building-status").textContent, /ikke avklart/);

mapView.data = byggGrunnlag([], [], "ingen_treff");
runInContext("renderMap(data)", mapView);
assert.deepEqual(tegnetBygg(), [0, 0]);
assert.match(mapEl("building-status").textContent, /Ingen bygningsflater/);

mapView.data = byggGrunnlag([], [], "feil", "Kartlaget svarte ikke.");
runInContext("renderMap(data)", mapView);
assert.match(mapEl("building-status").textContent, /Bygningskartet kunne ikke hentes\. Kartlaget svarte ikke\./,
  "En kildefeil skal forklares ved kartet, ikke bare inne i kildelisten");

// Planflatene er eiendommens, ikke punktets. De tegnes under teiglaget, får klasse
// etter hensynstypen, og statuslinjen skal si både hva eiendommen berører og hvor
// markøren står - det siste regnet ut i nettleseren mens markøren flyttes.
const soneRinger: [number, number][][] = [[
  [5.3105, 60.3305], [5.312, 60.3305], [5.312, 60.332], [5.3105, 60.332], [5.3105, 60.3305]
]];
const felles = { sonekode: 220, beskrivelse: "", kildetekst: null, berorer: "delvis" as const, planId: "65270000", ringer: soneRinger };
const hensynssone = (sonenavn: string, hensynstype: "stoy" | "fare" | "angitthensyn"): TiltakshjelpenGrunnlag["planflater"][number] =>
  ({ ...felles, kategori: "hensynssone", datasett: hensynstype, sonenavn, hensynstype, navn: "Gul støysone" });
const arealformaal = (): TiltakshjelpenGrunnlag["planflater"][number] =>
  ({ ...felles, kategori: "arealformaal", datasett: "arealformaal", arealstatus: 1, navn: "LNF" });
const soneKlasser = () => mapEl("map-zones").children.map((barn: Element) => barn.attributes.class);

mapView.data = {
  ...mapGrunnlag,
  planflater: [hensynssone("H220_1", "stoy"), arealformaal()],
  kilder: [...mapGrunnlag.kilder, { id: "planflater", navn: "Plan", url: "http://localhost:8089/mock/plan/hensynssoner", status: "ok", hentet: "" }],
};
runInContext("renderMap(data)", mapView);
assert.deepEqual(soneKlasser(), ["zone zone-arealformaal", "zone zone-stoy"],
  "Arealformålet skal tegnes først, så en hensynssone aldri blir liggende under det");
assert.match(mapEl("zone-status").textContent, /Gul støysone H220_1/);
assert.match(mapEl("zone-status").textContent, /utenfor alle flatene/,
  "Markøren står utenfor flaten i denne fixturen");

// Markøren inne i flaten: svaret skal snu uten et nytt kall til serveren.
mapView.plassering = { lat: 60.331, lon: 5.311 };
runInContext("updateZoneStatus()", mapView);
// «foreløpig» er ikke pynt: dette er regnet ut i nettleseren mens markøren dras,
// og serveren fastslår det først ved «Bekreft plassering».
assert.match(mapEl("zone-status").textContent, /Markøren står foreløpig i LNF, Gul støysone H220_1/);

mapView.data = { ...mapGrunnlag, planflater: [] };
runInContext("renderMap(data)", mapView);
assert.deepEqual(soneKlasser(), []);
assert.match(mapEl("zone-status").textContent, /ikke avklart/, "En kilde som mangler skal ikke bli tolket som et tomt treff");
mapView.data = {
  ...mapGrunnlag, planflater: [],
  kilder: [...mapGrunnlag.kilder, { id: "planflater", navn: "Plan", url: "", status: "ingen_treff", hentet: "" }]
};
runInContext("renderMap(data)", mapView);
assert.match(mapEl("zone-status").textContent, /Ingen hensynssoner eller arealformål/);

mapView.data = {
  ...mapGrunnlag, planflater: [],
  kilder: [...mapGrunnlag.kilder, { id: "planflater", navn: "Plan", url: "", status: "feil", hentet: "", merknad: "Plankilden svarte ikke." }],
};
mapView.grunnlag = mapView.data;
runInContext("renderMap(data)", mapView);
assert.match(mapEl("zone-status").textContent, /ikke avklart\. Plankilden svarte ikke\./,
  "En kildefeil skal forklares ved kartet, ikke bare inne i kildelisten");
mapView.grunnlag = null;

/*
 * Ventemeldingene, som er det eneste innbyggeren har å gå etter når kommunens
 * kartlag bruker flere sekunder og serveren prøver en gang til. Uten dem sto den
 * første etiketten stille i opptil tolv sekunder, og det ser ut som en hengt side.
 */
const ventenoder = new Map<string, Element>();
const ventEl = (id: string) => {
  if (!ventenoder.has(id)) ventenoder.set(id, new Element());
  return ventenoder.get(id)!;
};
const timere = new Map<number, { fn: () => void; ms: number }>();
let nesteTimer = 1;
const venting = createContext({
  krevEl: ventEl,
  document: { querySelectorAll: () => [] as unknown[] },
  feilmelding: (error: unknown) => String((error as Error).message),
  setTimeout: (fn: () => void, ms: number) => { timere.set(nesteTimer, { fn, ms }); return nesteTimer++; },
  clearTimeout: (id: number) => { timere.delete(id); },
  busy: false, pendingSave: false, tiltaksvalg: null, utfylling: null
});
runInContext(functionBlock("const VENTEMELDINGER", "function addLink"), venting);
const fyrAv = (ms: number) => {
  for (const [id, timer] of [...timere]) if (timer.ms === ms) { timere.delete(id); timer.fn(); }
};

let slippVidere: (() => void) | undefined;
const venter = new Promise<void>(resolve => { slippVidere = resolve; });
const utfort = runInContext("perform('Henter kart og opplysninger om eiendommen …', () => oppdrag)",
  Object.assign(venting, { oppdrag: venter }));
assert.equal(ventEl("progress").textContent, "Henter kart og opplysninger om eiendommen …",
  "etiketten skal stå med en gang");
assert.equal(timere.size, 3, "tre ventemeldinger er satt opp, ikke flere");
fyrAv(2500);
assert.match(ventEl("progress").textContent, /Henter fortsatt kart og planer fra kommunen/,
  "etter noen sekunder skal siden si at den fortsatt jobber, og hos hvem");
fyrAv(6000);
assert.match(ventEl("progress").textContent, /svarer tregt akkurat nå, og vi prøver en gang til/,
  "gjenforsøket skal være synlig, slik at ventingen er til å forstå");
assert.match(ventEl("progress").textContent, /Du trenger ikke gjøre noe/);
fyrAv(13000);
assert.match(ventEl("progress").textContent, /Vi gjør ferdig vurderingen med de kildene som svarte/,
  "og til slutt hva som skjer når kilden ikke svarer");
slippVidere!();
await utfort;
assert.equal(ventEl("progress").textContent, "", "statuslinjen tømmes når oppslaget er ferdig");
assert.equal(timere.size, 0, "timerne må ryddes, ellers skriver de over en ferdig side");

// En feil skal vise feilmeldingen, og heller ikke da får en gammel timer skrive over den.
let velt: ((grunn: Error) => void) | undefined;
const feiler = new Promise<void>((_resolve, reject) => { velt = reject; });
const feilet = runInContext("perform('Henter planer for plasseringen …', () => oppdrag)",
  Object.assign(venting, { oppdrag: feiler }));
fyrAv(2500);
velt!(new Error("Kilden svarte ikke"));
await feilet;
assert.equal(ventEl("error").textContent, "Kilden svarte ikke");
assert.equal(timere.size, 0);
assert.match(ventEl("progress").textContent, /Kunne ikke fullføre/);

console.log("Hensynssoner: flatene tegnes under teigen, i riktig rekkefølge, og markøren melder sone før bekreftelse.");
console.log("Bygge-UX: tema, grupperte mål, synlige ja/nei-svar, rask retur etter endring, skjult historikk, statsløs hjelp og bekreftelse besto.");
console.log("Eiendomsvalg: adresse før kart, bekreftet plassering før utfylling, nytt forsøk og avvisning av foreldede svar besto.");
console.log("Vurderingskart: teiger, bygninger, nabogrenser og bakgrunn følger det ferske grunnlaget ved feil og gjenoppretting.");
console.log("Bygningslaget: egne bygg skilles fra nabobygg, og kildestatusen forklares ved kartet.");
console.log("Svaret: overskriften svarer ja, nei eller kontakt kommunen, og reglenes neste steg vises.");
console.log("Venting: statuslinjen forteller at kommunens kartlag er tregt og at det prøves igjen, og timerne ryddes.");
