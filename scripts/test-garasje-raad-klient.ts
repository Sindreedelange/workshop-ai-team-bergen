import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { createContext, runInContext } from "node:vm";

class Element {
  id = "";
  textContent = "";
  href = "";
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  children: Element[] = [];
  parent?: Element;
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  append(...children: Element[]) { children.forEach(child => { child.parent = this; }); this.children.push(...children); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  querySelector(selector: string): Element | null {
    for (const child of this.children) {
      if (`#${child.id}` === selector) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }
}
const parent = new Element();
const context = createContext({
  document: {
    createElement: () => new Element(),
    createTextNode: (text: string) => { const node = new Element(); node.textContent = text; return node; }
  },
  parent
});
runInContext(stripTypeScriptTypes(await readFile("apps/demo-gui/src/client/garasje-raad.ts", "utf8"))
  .replace("export async function renderTiltaksraad", "async function renderTiltaksraad"), context);
context.request = async () => ({
  raad: "Kontakt kommunens rådgivere.",
  maaAvklares: Array.from({ length: 14 }, (_, i) => `Obligatorisk forhold ${i + 1}`),
  modell: "regelbasert",
  advarsel: "Kontroll anbefales",
  kilder: [{ tittel: "Lokal plan", side: 9, url: "https://example.test/plan", merknad: "OCR må kontrolleres" },
    { tittel: "Utrygg lenke", url: "javascript:alert(1)" }]
});
context.current = () => true;
await runInContext("renderTiltaksraad(parent, request, current)", context);
function all(node: Element): Element[] { return [node, ...node.children.flatMap(all)]; }
assert.equal(all(parent).filter(node => node.textContent.startsWith("Obligatorisk")).length, 14);
assert(all(parent).some(node => node.textContent === "Lokal plan, side 9" && node.href === "https://example.test/plan"));
assert(!all(parent).some(node => node.href.startsWith("javascript:")));
assert(all(parent).some(node => node.textContent.includes("Kontroll anbefales")));
context.request = async () => { throw new Error("Dokumenttjenesten svarer ikke"); };
await runInContext("renderTiltaksraad(parent, request, current)", context);
assert.equal(parent.children.length, 1, "Nytt råd skal erstatte forrige panel");
assert(all(parent).some(node => node.attributes.role === "alert" && node.textContent.includes("Dokumenttjenesten svarer ikke")));
context.current = () => false;
context.request = async () => ({ raad: "Foreldet råd" });
await runInContext("renderTiltaksraad(parent, request, current)", context);
assert(!all(parent).some(node => node.textContent === "Foreldet råd"), "Et sent svar skal ikke vises etter endringer");
console.log("Dokumentråd: alle vilkår, kildehenvisninger, feil og foreldede svar håndteres synlig og trygt.");
