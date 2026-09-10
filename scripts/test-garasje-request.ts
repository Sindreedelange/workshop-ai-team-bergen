import assert from "node:assert/strict";
import { readGarasjeKommune, readGarasjeRequest, readGarasjeSearch, readGarasjeTiltakJson, readGarasjeTiltakstype } from "../apps/sandbox-backend/src/garasje-request.ts";
import { HttpError } from "../apps/sandbox-backend/src/errors.ts";

const base = { adresse: "Litle Milde 65", gnr: "105", bnr: "209" };
const query = (extra: Record<string, string> = {}) => new URLSearchParams({ ...base, ...extra });
const badRequest = (error: unknown) => error instanceof HttpError && error.status === 400;

assert.equal(readGarasjeSearch(new URLSearchParams({ sok: " Litle Milde 65 " })), base.adresse);
for (const sok of ["", "ab", "a".repeat(161)]) {
  assert.throws(() => readGarasjeSearch(new URLSearchParams({ sok })), badRequest);
}
assert.deepEqual(readGarasjeRequest(query()), { adresse: base.adresse, gnr: 105, bnr: 209, plassering: undefined });
assert.deepEqual(readGarasjeRequest(query({ lat: "60.25", lon: "5.25" })).plassering, { lat: 60.25, lon: 5.25 });
const invalidQueries: Record<string, string>[] = [
  { adresse: "" }, { gnr: "" }, { gnr: "NaN" }, { bnr: "0" }, { gnr: "1.5" },
  { lat: "60.2" }, { lon: "5.2" }, { lat: "", lon: "5.2" },
  { lat: "Infinity", lon: "5.2" }, { lat: "91", lon: "5.2" }, { lat: "60.2", lon: "181" }, { kommunenummer: "0000" }, { kommunenummer: "46" }
];
for (const extra of invalidQueries) {
  assert.throws(() => readGarasjeRequest(query(extra)), badRequest);
}
assert.equal(readGarasjeKommune(new URLSearchParams()), undefined);
assert.equal(readGarasjeTiltakstype(new URLSearchParams()), undefined);
assert.equal(readGarasjeRequest(query({ tiltakstype: "gjerde" })).tiltakstype, "gjerde");
assert.equal(readGarasjeTiltakstype(new URLSearchParams({ tiltakstype: "ukjent" })), "ukjent");
for (const value of ["", "garasje", "oppdiktet"]) {
  assert.throws(() => readGarasjeRequest(query({ tiltakstype: value })), badRequest);
}
assert.throws(() => readGarasjeTiltakstype(new URLSearchParams("tiltakstype=gjerde&tiltakstype=fasade")), badRequest);
assert.equal(readGarasjeRequest(query({ kommunenummer: "0301", lat: "59.91", lon: "10.75" })).kommunenummer, "0301");
for (const felt of ["adresse", "gnr", "bnr"]) {
  const sok = query();
  sok.delete(felt);
  assert.throws(() => readGarasjeRequest(sok), badRequest);
}
assert.deepEqual(readGarasjeTiltakJson(new URLSearchParams({ tiltak: '{"bya":49.5}' })), { bya: 49.5 });
for (const tiltak of ["", "{", " ".repeat(5001)]) {
  assert.throws(() => readGarasjeTiltakJson(new URLSearchParams({ tiltak })), badRequest);
}
console.log("Garasjesjekk: parameterkontrollene besto.");
