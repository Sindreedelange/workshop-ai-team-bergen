import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { createContext, runInContext } from "node:vm";
import { validateByggetiltak } from "../apps/sandbox-backend/src/tiltakshjelpen.ts";
import { normalizeTiltakshjelpenSvar } from "../apps/sandbox-backend/src/tiltakshjelpen-prosess.ts";

class Element {
  id = "";
  value = "";
  textContent = "";
  hidden = false;
  disabled = false;
  focusCount = 0;
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  children: Element[] = [];
  parentElement: Element | null = null;
  listeners = new Map<string, (() => void)[]>();
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  append(...children: Element[]) {
    for (const child of children) child.parentElement = this;
    this.children.push(...children);
  }
  prepend(child: Element) {
    child.parentElement = this;
    this.children.unshift(child);
  }
  addEventListener(event: string, listener: () => void) {
    this.listeners.set(event, [...this.listeners.get(event) ?? [], listener]);
  }
  dispatch(event: string) { for (const listener of this.listeners.get(event) ?? []) listener(); }
  focus() { this.focusCount++; }
}
const root = new Element();
const login = new Element();
login.id = "login-panel";
const workspace = new Element();
workspace.id = "workspace";
workspace.hidden = true;
const property = new Element();
property.id = "property-step";
workspace.append(property);
root.append(login, workspace);
function descendants(node: Element): Element[] { return [node, ...node.children.flatMap(descendants)]; }
function byId(id: string): Element {
  const node = descendants(root).find(node => node.id === id);
  assert(node, `Mangler ${id}`);
  return node;
}
function button(text: string): Element {
  const node = descendants(root).find(node => node.textContent === text);
  assert(node);
  return node;
}
let changed = 0;
const confirmed: { type: string; description: string }[] = [];
let locked = false;
const context = createContext({
  document: { createElement: () => new Element(), getElementById: byId },
  options: {
    container: workspace,
    choices: [{ id: "bygg", label: "Frittliggende bygg" }, { id: "gjerde", label: "Gjerde" }, { id: "annet", label: "Annet eller usikkert" }],
    unknownType: "annet",
    suggest: (text: string) => text === "Et stakittgjerde" ? "gjerde" : null,
    locked: () => locked,
    changed: () => { changed++; },
    confirmed: (type: string, description: string) => { confirmed.push({ type, description }); }
  }
});
runInContext(stripTypeScriptTypes(await readFile("apps/demo-gui/src/client/tiltakshjelpen-tiltak.ts", "utf8"))
  .replace("export function createTiltaksvalg", "function createTiltaksvalg"), context);
const ui = runInContext("createTiltaksvalg(options)", context);
assert.equal(root.children[0].id, "login-panel", "Innlogging skal komme før tiltaksvalg");
assert.equal(byId("measure-step").parentElement, workspace, "Tiltaksvalg må ligge bak samme innlogging som eiendomsvalget");
assert.equal(workspace.hidden, true, "Opprettelse av tiltaksvalg må ikke åpne arbeidsområdet før innlogging");
assert.equal(workspace.children[0].id, "measure-step");
assert.equal(workspace.children[1], property, "Tiltakstypen skal fortsatt komme før eiendomsvalget etter innlogging");
for (const type of ["bygg", "gjerde", "annet"]) {
  byId("measure-type").value = type;
  for (const text of ["", " \n\t", "x".repeat(501)]) {
    byId("measure-description").value = text;
    const focused = byId("measure-description").focusCount;
    button("Bekreft tiltakstype").dispatch("click");
    assert.equal(confirmed.length, 0, "Manuelt typevalg må ikke bekrefte en ugyldig beskrivelse");
    assert.equal(byId("measure-description").attributes["aria-invalid"], "true");
    assert.equal(byId("measure-description").focusCount, focused + 1);
  }
}
byId("measure-description").value = "Et stakittgjerde";
button("Finn type tiltak").dispatch("click");
assert.equal(byId("measure-type").value, "gjerde");
assert.equal(confirmed.length, 0, "Et forslag er ikke et bekreftet tiltak");
button("Bekreft tiltakstype").dispatch("click");
assert.deepEqual(confirmed, [{ type: "gjerde", description: "Et stakittgjerde" }]);
assert.equal(byId("measure-description").attributes["aria-invalid"], "false");
const tiltak = {
  tiltakstype: confirmed[0].type, tiltaksbeskrivelse: confirmed[0].description,
  tiltakstypeBekreftet: true, hoyde: 0.9, motVeg: true, friSikt: true, aapenLett: true
};
assert.doesNotThrow(() => validateByggetiltak(tiltak), "Det bekreftede valget må kunne vurderes frittstående");
assert.doesNotThrow(() => normalizeTiltakshjelpenSvar({
  ...tiltak, adresse: "Kråkenestoppen 60", kommunenummer: "4601", gnr: 20, bnr: 1413,
  lat: 60.33304, lon: 5.31547, eiendomBekreftet: true, plasseringBekreftet: true
}), "Det bekreftede valget må også kunne lagres i prosessøkten");
byId("measure-description").dispatch("input");
assert.match(byId("measure-status").textContent, /endret/);
assert(changed > 0);
byId("measure-description").value = "Flere uklare tiltak";
button("Finn type tiltak").dispatch("click");
assert.match(byId("measure-status").textContent, /uklar/);
assert.equal(byId("measure-type").value, "annet", "Uklart tiltak må ikke arve forrige forslag");
locked = true;
ui.refresh();
assert.equal(byId("measure-description").disabled, true);
button("Bekreft tiltakstype").dispatch("click");
assert.equal(confirmed.length, 1);
locked = false;
ui.restore("bygg", "En bod");
assert.equal(byId("measure-type").value, "bygg");
assert.equal(byId("measure-description").value, "En bod");
assert.deepEqual(confirmed[1], { type: "bygg", description: "En bod" });
const beforeRestore = changed;
ui.restore("bygg", "");
assert.equal(confirmed.length, 2, "Et gammelt utkast uten beskrivelse må ikke bekreftes som et nytt typet tiltak");
assert.equal(changed, beforeRestore + 1);
assert.match(byId("measure-status").textContent, /Skriv en kort beskrivelse/);
assert.equal(byId("measure-description").attributes["aria-invalid"], "true");
console.log("Tiltaksvalg: forslag krever bekreftelse, uklare beskrivelser vises, og lagret valg kan gjenopprettes.");
