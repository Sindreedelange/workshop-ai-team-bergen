import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { createContext, runInContext } from "node:vm";
import { ringerInneholder } from "../apps/shared/geometri.ts";

const source = stripTypeScriptTypes(await readFile("apps/demo-gui/src/client/garasje.ts", "utf8"));
function block(start: string, end: string): string {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert(from >= 0 && to > from);
  return source.slice(from, to);
}
let displayed = 0;
let warnings = 0;
const parcel = { id: "test", ringer: [[[5, 60], [5.01, 60], [5.01, 60.01], [5, 60.01], [5, 60]]] };
const map = { eiendomsgrenser: [parcel], kilder: [{ id: "eiendomsgrenser", status: "ok" }] };
const context = createContext({
  ringerInneholder,
  kartgrunnlag: map,
  plassering: { lat: 60.005, lon: 5.005 },
  propertyConfirmed: true,
  tiltakstypeBekreftet: true,
  tiltaksvalg: { focus() {} },
  placementChosen: true,
  placementConfirmed: false,
  refreshGrunnlag: async () => {},
  updatePlacementStatus: () => { warnings++; },
  renderPropertySteps: () => { displayed++; },
  krevEl: () => ({ focus() {} })
});
runInContext(block("function placementOnProperty", "function updatePlacementStatus"), context);
runInContext(block("async function confirmPlacement", "function editPlacement"), context);
await runInContext("confirmPlacement()", context);
assert.equal(context.placementConfirmed, true);
assert.equal(displayed, 1);
context.placementConfirmed = false;
context.plassering = { lat: 60.02, lon: 5.005 };
await assert.rejects(runInContext("confirmPlacement()", context), /utenfor den valgte eiendommen/);
assert.equal(context.placementConfirmed, false);
assert.equal(displayed, 1, "Et punkt på nabotomten må ikke åpne spørsmålene");
assert.equal(warnings, 1);
context.plassering = { lat: 60.005, lon: 5.005 };
context.refreshGrunnlag = async () => { context.plassering = { lat: 60.02, lon: 5.005 }; };
await assert.rejects(runInContext("confirmPlacement()", context), /Velg et nytt punkt/);
assert.equal(context.placementConfirmed, false, "Sperren må bruke grunnlaget etter oppfrisking");
context.refreshGrunnlag = async () => { throw new Error("Plankilden er utilgjengelig"); };
await assert.rejects(runInContext("confirmPlacement()", context), /Plankilden er utilgjengelig/);
assert.equal(context.placementConfirmed, false);
context.kartgrunnlag = { ...map, kilder: [{ id: "eiendomsgrenser", status: "feil" }] };
assert.equal(runInContext("placementOnProperty()", context), null, "Feilet kartoppslag er ukjent, ikke et gyldig punkt");
context.kartgrunnlag = { ...map, eiendomsgrenser: [] };
assert.equal(runInContext("placementOnProperty()", context), null);
context.placementChosen = false;
await assert.rejects(runInContext("confirmPlacement()", context), /Plasser tiltaket/);
context.tiltakstypeBekreftet = false;
await assert.rejects(runInContext("confirmPlacement()", context), /Bekreft tiltakstypen/);
console.log("Plassering: punkt på nabotomten stoppes før neste side, og manglende kart er eksplisitt ukjent.");
