import assert from "node:assert/strict";
import { readTiltakshjelpenKommune, readTiltakshjelpenRequest, readTiltakshjelpenSearch, readTiltakshjelpenTiltakJson, readTiltakshjelpenTiltakstype } from "../apps/sandbox-backend/src/tiltakshjelpen-request.ts";
import { HttpError } from "../apps/sandbox-backend/src/errors.ts";

const base = { adresse: "Litle Milde 65", gnr: "105", bnr: "209" };
const query = (extra: Record<string, string> = {}) => new URLSearchParams({ ...base, ...extra });
const badRequest = (error: unknown) => error instanceof HttpError && error.status === 400;

assert.equal(readTiltakshjelpenSearch(new URLSearchParams({ sok: " Litle Milde 65 " })), base.adresse);
for (const sok of ["", "ab", "a".repeat(161)]) {
  assert.throws(() => readTiltakshjelpenSearch(new URLSearchParams({ sok })), badRequest);
}
assert.deepEqual(readTiltakshjelpenRequest(query()), { adresse: base.adresse, gnr: 105, bnr: 209, plassering: undefined });
assert.deepEqual(readTiltakshjelpenRequest(query({ lat: "60.25", lon: "5.25" })).plassering, { lat: 60.25, lon: 5.25 });
const invalidQueries: Record<string, string>[] = [
  { adresse: "" }, { gnr: "" }, { gnr: "NaN" }, { bnr: "0" }, { gnr: "1.5" },
  { lat: "60.2" }, { lon: "5.2" }, { lat: "", lon: "5.2" },
  { lat: "Infinity", lon: "5.2" }, { lat: "91", lon: "5.2" }, { lat: "60.2", lon: "181" }, { kommunenummer: "0000" }, { kommunenummer: "46" }
];
for (const extra of invalidQueries) {
  assert.throws(() => readTiltakshjelpenRequest(query(extra)), badRequest);
}
assert.equal(readTiltakshjelpenKommune(new URLSearchParams()), undefined);
assert.equal(readTiltakshjelpenTiltakstype(new URLSearchParams()), undefined);
assert.equal(readTiltakshjelpenRequest(query({ tiltakstype: "gjerde" })).tiltakstype, "gjerde");
assert.equal(readTiltakshjelpenTiltakstype(new URLSearchParams({ tiltakstype: "ukjent" })), "ukjent");
for (const value of ["", "garasje", "oppdiktet"]) {
  assert.throws(() => readTiltakshjelpenRequest(query({ tiltakstype: value })), badRequest);
}
assert.throws(() => readTiltakshjelpenTiltakstype(new URLSearchParams("tiltakstype=gjerde&tiltakstype=fasade")), badRequest);
assert.equal(readTiltakshjelpenRequest(query({ kommunenummer: "0301", lat: "59.91", lon: "10.75" })).kommunenummer, "0301");
for (const felt of ["adresse", "gnr", "bnr"]) {
  const sok = query();
  sok.delete(felt);
  assert.throws(() => readTiltakshjelpenRequest(sok), badRequest);
}
assert.deepEqual(readTiltakshjelpenTiltakJson(new URLSearchParams({ tiltak: '{"bya":49.5}' })), { bya: 49.5 });
for (const tiltak of ["", "{", " ".repeat(5001)]) {
  assert.throws(() => readTiltakshjelpenTiltakJson(new URLSearchParams({ tiltak })), badRequest);
}
console.log("Tiltakshjelpen: parameterkontrollene besto.");
