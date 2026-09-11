import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { createContext, runInContext } from "node:vm";
import { ringerInneholder } from "../apps/shared/geometri.ts";
import { unprojectTiltakshjelpenPunkt } from "../apps/demo-gui/src/client/tiltakshjelpen-kart.ts";

const source = stripTypeScriptTypes(await readFile("apps/demo-gui/src/client/tiltakshjelpen.ts", "utf8"));
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

type Pointer = {
  pointerId: number; clientX: number; clientY: number; button: number; isPrimary: boolean;
  preventDefault: () => void;
};
const listeners = new Map<string, (event: Pointer) => void>();
const captured = new Set<number>();
const moved: { lat: number; lon: number }[] = [];
let prevented = 0;
let focused = 0;
const pointerContext = createContext({
  busy: false, pendingSave: false, propertyConfirmed: true, placementConfirmed: false, valgtAdresse: {},
  bounds: { west: 5, east: 6, south: 60, north: 61 },
  unprojectTiltakshjelpenPunkt,
  moveMarker: (point: { lat: number; lon: number }) => moved.push(point),
  DOMPoint: class {
    x: number; y: number;
    constructor(x: number, y: number) { this.x = x; this.y = y; }
    matrixTransform(matrix: { left: number; top: number; scale: number }) {
      return { x: (this.x - matrix.left) / matrix.scale, y: (this.y - matrix.top) / matrix.scale };
    }
  },
  svg: {
    addEventListener: (type: string, handler: (event: Pointer) => void) => listeners.set(type, handler),
    setPointerCapture: (id: number) => captured.add(id),
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: (id: number) => captured.delete(id),
    focus: () => { focused++; },
    getScreenCTM: () => ({ inverse: () => ({ left: 100, top: 200, scale: 0.5 }) })
  }
});
runInContext(block("function placeFromPointer", 'svg.addEventListener("keydown"'), pointerContext);
function pointer(type: string, values: Partial<Pointer> = {}) {
  listeners.get(type)!({
    pointerId: 1, clientX: 260, clientY: 320, button: 0, isPrimary: true,
    preventDefault: () => { prevented++; }, ...values
  });
}
pointer("pointerdown");
assert.deepEqual(moved.at(-1), { lon: 5.5, lat: 60.5 }, "Pekeren må projiseres gjennom SVG-transformasjonen");
assert(captured.has(1));
assert.equal(focused, 1);
assert.equal(prevented, 1, "Nettleserens standarddrag og tekstmarkering må ikke overta");
pointer("pointerdown", { pointerId: 2, isPrimary: false });
pointer("pointermove", { pointerId: 2, clientX: 300 });
assert.equal(moved.length, 1, "En ekstra finger skal ikke flytte markøren");
pointer("pointermove", { clientX: 420, clientY: 200 });
assert.deepEqual(moved.at(-1), { lon: 6, lat: 61 });
pointer("pointerup", { clientX: 180, clientY: 380 });
assert.deepEqual(moved.at(-1), { lon: 5.25, lat: 60.25 }, "Også siste posisjon ved slipp må lagres");
assert(!captured.has(1));
const afterRelease = moved.length;
pointer("pointermove");
assert.equal(moved.length, afterRelease, "Pekerbevegelse etter slipp skal ikke flytte tiltaket");
for (const type of ["pointercancel", "lostpointercapture"]) {
  pointer("pointerdown");
  pointer(type);
  const beforeMove: number = moved.length;
  pointer("pointermove");
  assert.equal(moved.length, beforeMove, `${type} må avslutte draget`);
  pointer("pointerdown");
  assert.equal(moved.length, beforeMove + 1, "Et nytt drag må virke etter avbrudd");
  pointer("pointerup");
}
for (const flag of ["busy", "pendingSave", "placementConfirmed"]) {
  pointerContext[flag] = true;
  const before: number = moved.length;
  pointer("pointerdown");
  assert.equal(moved.length, before, `${flag} må låse kartet`);
  pointerContext[flag] = false;
}
pointerContext.propertyConfirmed = false;
const beforeUnconfirmed = moved.length;
pointer("pointerdown");
assert.equal(moved.length, beforeUnconfirmed);
const beforeDrag = prevented;
pointer("dragstart");
assert.equal(prevented, beforeDrag + 1);
console.log("Plassering: punkt på nabotomten stoppes før neste side, og manglende kart er eksplisitt ukjent.");
