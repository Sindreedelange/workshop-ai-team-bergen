import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { createContext, runInContext } from "node:vm";

class Element {
  id = "";
  value = "";
  textContent = "";
  hidden = false;
  disabled = false;
  focusCount = 0;
  dataset: Record<string, string> = {};
  children: Element[] = [];
  parentElement: Element | null = null;
  listeners = new Map<string, (() => void)[]>();
  setAttribute() {}
  append(...children: Element[]) {
    for (const child of children) child.parentElement = this;
    this.children.push(...children);
  }
  insertBefore(child: Element, before: Element) {
    child.parentElement = this;
    this.children.splice(this.children.indexOf(before), 0, child);
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
root.append(login);
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
    choices: [{ id: "bygg", label: "Frittliggende bygg" }, { id: "gjerde", label: "Gjerde" }, { id: "annet", label: "Annet eller usikkert" }],
    unknownType: "annet",
    suggest: (text: string) => text === "Et stakittgjerde" ? "gjerde" : null,
    locked: () => locked,
    changed: () => { changed++; },
    confirmed: (type: string, description: string) => { confirmed.push({ type, description }); }
  }
});
runInContext(stripTypeScriptTypes(await readFile("apps/demo-gui/src/client/garasje-tiltak.ts", "utf8"))
  .replace("export function createTiltaksvalg", "function createTiltaksvalg"), context);
const ui = runInContext("createTiltaksvalg(options)", context);
assert.equal(root.children[0].id, "measure-step");
byId("measure-description").value = "Et stakittgjerde";
button("Finn type tiltak").dispatch("click");
assert.equal(byId("measure-type").value, "gjerde");
assert.equal(confirmed.length, 0, "Et forslag er ikke et bekreftet tiltak");
button("Bekreft tiltakstype").dispatch("click");
assert.deepEqual(confirmed, [{ type: "gjerde", description: "Et stakittgjerde" }]);
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
console.log("Tiltaksvalg: forslag krever bekreftelse, uklare beskrivelser vises, og lagret valg kan gjenopprettes.");
