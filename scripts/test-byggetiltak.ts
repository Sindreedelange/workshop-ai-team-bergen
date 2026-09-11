import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { BYGGETILTAK_ALTERNATIVER, BYGGETILTAK_KATALOG, BYGGETILTAK_TYPER, classifyByggetiltak, classifyByggetiltakType, getByggetiltakFelter, getByggetiltakSporsmaal, type Byggetiltak } from "../apps/shared/byggetiltak.ts";
import type { TiltakshjelpenGrunnlag, FrittliggendeTiltak, TiltakshjelpenVurdering } from "../apps/shared/tiltakshjelpen.ts";
import { evaluateTiltakshjelpen, getByggetiltakPlanvarsler, validateByggetiltak, validateFrittliggendeTiltak } from "../apps/sandbox-backend/src/tiltakshjelpen.ts";
import { buildTiltakshjelpenTiltak, normalizeTiltakshjelpenSvar } from "../apps/sandbox-backend/src/tiltakshjelpen-prosess.ts";
import { HttpError } from "../apps/sandbox-backend/src/errors.ts";
import type { Caller } from "../apps/sandbox-backend/src/autentisering.ts";

const grunnlag: TiltakshjelpenGrunnlag = {
  adresse: { adressetekst: "Testveien 1", kommunenummer: "4601", gardsnummer: 1, bruksnummer: 2,
    festenummer: 0, undernummer: 0, punkt: { lat: 60.3, lon: 5.3 } },
  punkt: { lat: 60.3, lon: 5.3 },
  arealformaal: [{ kode: 5100, beskrivelse: "LNF", planId: "65270000" }],
  reguleringsplaner: [{ planId: "6170063", navn: "Plan fra kontrollert testgrunnlag", url: "https://www.arealplaner.no/bergen4601/arealplaner/6170063" }],
  eiendomsgrenser: [{ id: "teig-1", ringer: [[[5.29, 60.29], [5.31, 60.29], [5.31, 60.31], [5.29, 60.31], [5.29, 60.29]]] }],
  bygninger: [], planflater: [],
  bebyggelse: { status: "bekreftet", bebygd: true, bygninger: [], forklaring: "Testgrunnlag", kilde: "https://example.test/bygg" },
  arealberegning: { tomtearealM2: null, kartlagtBebygdArealM2: null, kartlagtAndelProsent: null, kilde: "https://example.test/areal", metode: "Test", forbehold: [] },
  kilder: ["adresse", "kpa", "reguleringsplan", "eiendomsgrenser", "bygninger", "planflater"].map(id => ({
    id, navn: id, status: "ok", url: `https://example.test/${id}`, hentet: "2026-09-10T00:00:00Z",
  })),
  uavklarteForhold: [],
};
const legacy: FrittliggendeTiltak = {
  bra: 50, bya: 50, monehoyde: 4, gesimshoyde: 3, etasjer: 1, frittliggende: true,
  beboelse: false, kjeller: false, bebygdEiendom: true, avstandNabogrense: 1, avstandBygning: 1, overVannAvlop: false,
};
const fixtures = {
  frittliggende: { ...legacy, tiltakstype: "frittliggende", tiltaksbeskrivelse: "En frittliggende garasje", tiltakstypeBekreftet: true },
  tilbygg: { tiltakstype: "tilbygg", tiltaksbeskrivelse: "Et understøttet tilbygg", tiltakstypeBekreftet: true,
    bra: 15, bya: 15, etasjer: 2, understottet: true, endrerBruk: false, nyBoenhet: false,
    bebygdEiendom: true, avstandNabogrense: 4, overVannAvlop: false },
  gjerde: { tiltakstype: "gjerde", tiltaksbeskrivelse: "Et gjerde mot veien", tiltakstypeBekreftet: true,
    hoyde: 0.9, motVeg: true, friSikt: true, aapenLett: true },
  fasade: { tiltakstype: "fasade", tiltaksbeskrivelse: "Skifte taktekking", tiltakstypeBekreftet: true,
    likUtforming: true, endrerUtseende: false, endrerBaering: false, endrerBrannkrav: false },
  ukjent: { tiltakstype: "ukjent", tiltaksbeskrivelse: "Et annet tiltak", tiltakstypeBekreftet: true },
} satisfies Record<string, Byggetiltak>;
const beforePlanvarsler = structuredClone(grunnlag);
for (const fixture of Object.values(fixtures)) {
  const early = getByggetiltakPlanvarsler(fixture.tiltakstype, grunnlag);
  const assessment = evaluateTiltakshjelpen(fixture, grunnlag);
  assert(early.length > 0 && early.every(warning => warning.status === "uavklart"));
  for (const warning of early) {
    const actual = assessment.sjekker.find(item => item.id === warning.id);
    if (warning.id === "kommuneplan" && fixture.tiltakstype === "frittliggende") {
      assert.match(actual?.forklaring ?? "", /mer enn 1 m avstand/);
    } else {
      assert.deepEqual(actual, warning);
    }
  }
}
assert.deepEqual(grunnlag, beforePlanvarsler, "Tidlig planveiledning skal være en ren funksjon.");
const common = { adresse: "Testveien 1", kommunenummer: "4601", gnr: 1, bnr: 2,
  lat: 60.3, lon: 5.3, eiendomBekreftet: true, plasseringBekreftet: true };
const badRequest = (error: unknown) => error instanceof HttpError && error.status === 400;
const check = (result: TiltakshjelpenVurdering, id: string) => {
  const found = result.sjekker.find(item => item.id === id);
  assert(found, `Mangler kontroll: ${id}`);
  return found;
};

for (const [tekst, expected] of [
  ["Jeg vil bygge garasje", "frittliggende"], ["Ny bod", "frittliggende"],
  ["Et tilbygg", "tilbygg"], ["Gjerde mot vei", "gjerde"], ["Bytte takplater", "fasade"],
  ["Jeg skal bygge et stakittgjerde", "gjerde"], ["Endre stakittgjerdet", "gjerde"],
  ["Et flettverksgjerde", "gjerde"], ["Et nettinggjerde", "gjerde"],
  ["En gjerdefabrikk", "ukjent"], ["Et skjermgjerde", "ukjent"], ["Et murgjerde", "ukjent"],
  ["Garasje og stakittgjerde", "ukjent"], ["Ikke et stakittgjerde", "ukjent"],
  ["Bytte vinduer", "fasade"], ["Skifte taket", "fasade"], ["Bygge levegg", "ukjent"], ["Påbygg", "ukjent"],
  ["Ikke en garasje", "ukjent"], ["Garasje eller gjerde", "ukjent"], ["En fontene", "ukjent"],
]) assert.equal(classifyByggetiltak(tekst).tiltakstype, expected, tekst);
assert.deepEqual(BYGGETILTAK_KATALOG.map(item => item.id), [...BYGGETILTAK_TYPER]);
assert.deepEqual(BYGGETILTAK_ALTERNATIVER, BYGGETILTAK_KATALOG.map(item => ({ id: item.id, label: item.navn })));
assert.equal(classifyByggetiltakType("Et gjerde"), "gjerde");
assert.equal(classifyByggetiltakType("En fontene"), null);
assert.equal(getByggetiltakFelter("frittliggende").find(field => field.id === "bra")?.ukjentTillatt, false);
assert.equal(getByggetiltakFelter("frittliggende").find(field => field.id === "avstandNabogrense")?.ukjentTillatt, true);
assert.equal(getByggetiltakFelter("tilbygg").find(field => field.id === "bra")?.ukjentTillatt, true);
assert.equal(getByggetiltakFelter("tilbygg").find(field => field.id === "etasjer")?.heltall, true);
assert.equal(getByggetiltakFelter("gjerde").find(field => field.id === "hoyde")?.type, "tall");
assert.equal(getByggetiltakFelter("gjerde").find(field => field.id === "friSikt")?.type, "valg");
assert.deepEqual(getByggetiltakFelter("ukjent"), []);
assert(!getByggetiltakSporsmaal("gjerde").some(field => ["bra", "bya", "monehoyde", "etasjer"].includes(field.id)));
assert.deepEqual(validateFrittliggendeTiltak(legacy), legacy);
const { bebygdEiendom: _legacyBebyggelse, ...legacyWithoutBebyggelse } = legacy;
assert.throws(() => validateFrittliggendeTiltak(legacyWithoutBebyggelse), badRequest);
assert.throws(() => validateByggetiltak(legacyWithoutBebyggelse), badRequest);
for (const fixture of [fixtures.frittliggende, fixtures.tilbygg]) {
  const { bebygdEiendom: _bebyggelse, ...request } = fixture;
  const normalized = validateByggetiltak(request);
  assert("bebygdEiendom" in normalized && normalized.bebygdEiendom === null);
  assert(!("bebygdEiendom" in request), "Normaliseringen skal ikke endre klientens objekt.");
  assert.equal(evaluateTiltakshjelpen(request, grunnlag).utfall, "maa_avklares");
  assert.throws(() => validateByggetiltak({ ...request, bebygdEiendom: "ja" }), badRequest);
}
assert.equal(evaluateTiltakshjelpen(legacy, grunnlag).tiltakstype, "frittliggende");
assert.equal(evaluateTiltakshjelpen(legacy, grunnlag).nasjonaltUnntak, "oppfylt");
assert.equal(evaluateTiltakshjelpen({ ...legacy, bya: 50.01 }, grunnlag).utfall, "soknadspliktig");
assert.equal(evaluateTiltakshjelpen({ ...legacy, avstandNabogrense: null }, grunnlag).utfall, "maa_avklares");
assert.match(check(evaluateTiltakshjelpen(legacy, grunnlag), "kommuneplan").forklaring, /fradelt.*bebygd.*LNF-verdiene/);
assert.match(check(evaluateTiltakshjelpen(legacy, grunnlag), "kommuneplan").forklaring, /1 m.*ikke tilstrekkelig/);

for (const fixture of Object.values(fixtures)) {
  assert.deepEqual(validateByggetiltak(fixture), fixture);
  for (const invalid of [
    { ...fixture, tiltakstypeBekreftet: false }, { ...fixture, tiltakstypeBekreftet: "ja" },
    { ...fixture, tiltaksbeskrivelse: "" }, { ...fixture, tiltaksbeskrivelse: "x".repeat(2001) },
    { ...fixture, grunnlag: { planGodkjent: true } }, { ...fixture, planGodkjent: true },
    { ...fixture, tiltakstype: "oppdiktet" },
  ]) assert.throws(() => validateByggetiltak(invalid), badRequest);
  const normalized = normalizeTiltakshjelpenSvar({ ...common, ...fixture });
  assert.equal(normalized.tiltakstypeBekreftet, "ja");
  assert.equal(normalized.bebygdEiendom, undefined);
  const reconstructed = buildTiltakshjelpenTiltak(normalized);
  assert.equal("tiltakstype" in reconstructed && reconstructed.tiltakstype, fixture.tiltakstype);
  assert.equal(evaluateTiltakshjelpen(reconstructed, grunnlag).utfall, "maa_avklares");
  assert.throws(() => normalizeTiltakshjelpenSvar({ ...common, ...fixture, tiltakstypeBekreftet: null }), badRequest);
  for (const field of getByggetiltakSporsmaal(fixture.tiltakstype)) {
    const missing: Record<string, unknown> = { ...fixture };
    delete missing[field.id];
    assert.throws(() => validateByggetiltak(missing), badRequest, `${fixture.tiltakstype}.${field.id}`);
    assert.throws(() => normalizeTiltakshjelpenSvar({ ...common, ...missing }), badRequest);
    if (fixture.tiltakstype !== "frittliggende") {
      const unknown = { ...fixture, [field.id]: null };
      assert.equal(evaluateTiltakshjelpen(validateByggetiltak(unknown), grunnlag).utfall, "maa_avklares");
      assert.equal(normalizeTiltakshjelpenSvar({ ...common, ...unknown })[field.id], "vet-ikke");
    }
  }
}
assert.throws(() => validateByggetiltak({ ...fixtures.gjerde, bra: 0 }), badRequest);
assert.throws(() => validateByggetiltak({ ...fixtures.fasade, bebygdEiendom: null }), badRequest);
assert.throws(() => normalizeTiltakshjelpenSvar({ ...common, ...fixtures.gjerde, bra: 0 }), badRequest);
assert.throws(() => validateByggetiltak({ ...fixtures.gjerde, hoyde: Infinity }), badRequest);
assert.throws(() => validateByggetiltak({ ...fixtures.tilbygg, etasjer: 1.5 }), badRequest);
assert.equal(normalizeTiltakshjelpenSvar({ ...common, ...fixtures.gjerde, hoyde: "0,9" }).hoyde, 0.9);

for (const change of [{ bra: 15.01 }, { bya: 15.01 }, { etasjer: 3 }, { understottet: false }, { nyBoenhet: true }, { endrerBruk: true }]) {
  assert.equal(evaluateTiltakshjelpen({ ...fixtures.tilbygg, ...change }, grunnlag).utfall, "soknadspliktig");
}
assert.equal(check(evaluateTiltakshjelpen(fixtures.tilbygg, grunnlag), "tilbygg-areal").status, "oppfylt");
assert.equal(check(evaluateTiltakshjelpen({ ...fixtures.tilbygg, bra: 0 }, grunnlag), "tilbygg-areal").status, "oppfylt");
assert.match(check(evaluateTiltakshjelpen(fixtures.tilbygg, grunnlag), "tilbygg-nabogrense").forklaring, /1-metersregel gjelder ikke/);
assert.equal(check(evaluateTiltakshjelpen(fixtures.gjerde, grunnlag), "gjerde-hoyde").status, "oppfylt");
assert.equal(evaluateTiltakshjelpen({ ...fixtures.gjerde, hoyde: 1.5 }, grunnlag).nasjonaltUnntak, "oppfylt");
assert.equal(evaluateTiltakshjelpen({ ...fixtures.gjerde, hoyde: 1.51 }, grunnlag).utfall, "soknadspliktig");
assert.equal(evaluateTiltakshjelpen({ ...fixtures.gjerde, friSikt: false }, grunnlag).utfall, "soknadspliktig");
assert.equal(evaluateTiltakshjelpen({ ...fixtures.gjerde, motVeg: false, hoyde: 1.6 }, grunnlag).nasjonaltUnntak, "oppfylt");
for (const hoyde of [0.9, 0.91]) {
  const assessment = evaluateTiltakshjelpen({ ...fixtures.gjerde, hoyde }, grunnlag);
  const local = check(assessment, "gjerde-plan-6170063");
  assert.equal(local.status, "uavklart");
  assert.equal(local.bestemmelse, "Reguleringsplan 6170063 § 7 bokstav d");
  assert.equal(local.kilde, grunnlag.reguleringsplaner[0].url);
  assert.equal(assessment.utfall, "maa_avklares");
  assert.match(local.forklaring, /utførelse, høyde og farge.*0,9 m inkludert sokkel/);
  assert.equal(check(assessment, "gjerde-plan-6170063-hoyde").forklaring.includes("overstiger"), hoyde > 0.9);
}
for (const changed of [
  { ...grunnlag, reguleringsplaner: [] },
  { ...grunnlag, reguleringsplaner: [{ ...grunnlag.reguleringsplaner[0], planId: "61700630" }] },
  { ...grunnlag, adresse: { ...grunnlag.adresse, kommunenummer: "0301" } },
  { ...grunnlag, kilder: grunnlag.kilder.filter(source => source.id !== "reguleringsplan") },
]) {
  assert(!evaluateTiltakshjelpen(fixtures.gjerde, changed).sjekker.some(item => item.id === "gjerde-plan-6170063"));
  assert(!getByggetiltakPlanvarsler("gjerde", changed).some(item => item.id === "gjerde-plan-6170063"));
}
assert(!evaluateTiltakshjelpen(legacy, grunnlag).sjekker.some(item => item.id === "gjerde-plan-6170063"));
assert.equal(check(evaluateTiltakshjelpen(fixtures.fasade, grunnlag), "fasade-karakter").status, "oppfylt");
assert.equal(check(evaluateTiltakshjelpen({ ...fixtures.fasade, likUtforming: false, endrerUtseende: true }, grunnlag), "fasade-karakter").status, "uavklart");
assert.equal(evaluateTiltakshjelpen({ ...fixtures.fasade, endrerBaering: true }, grunnlag).utfall, "soknadspliktig");
assert.equal(evaluateTiltakshjelpen({ ...fixtures.fasade, endrerBrannkrav: true }, grunnlag).utfall, "soknadspliktig");
assert(evaluateTiltakshjelpen(fixtures.fasade, grunnlag).nesteSteg?.some(step => /bilder.*fagperson/.test(step)));
assert.equal(check(evaluateTiltakshjelpen(fixtures.ukjent, grunnlag), "tiltakstype").status, "uavklart");

// Both catalog handlers must dispatch the branch, not rebuild a garage with zero measurements.
const stateDir = path.resolve("state", `test-byggetiltak-${randomUUID()}`);
await mkdir(stateDir, { recursive: true });
process.env.STATE_DIR = stateDir;
process.env.AUTH_ENFORCE = "true";
process.env.MATRIKKEL_BASE_URL = "http://byggetiltak-matrikkel.test";
process.env.PLAN_BASE_URL = "http://byggetiltak-plan.test";
const realFetch = globalThis.fetch;
let ownershipReads = 0;
let sourceReads = 0;
globalThis.fetch = async (input) => {
  sourceReads++;
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === "ws.geonorge.no") {
    return Response.json({ metadata: { totaltAntallTreff: 1 }, adresser: [{ ...grunnlag.adresse, representasjonspunkt: { ...grunnlag.punkt, epsg: "EPSG:4258" } }] });
  }
  if (url.hostname === "byggetiltak-matrikkel.test" && url.pathname === "/mock/matrikkel/eiendommer") {
    ownershipReads++;
    return Response.json([{ matrikkelId: "test-eiendom", adresse: common.adresse, gnr: 1, bnr: 2,
      kommunenummer: "4601", kommune: "BERGEN", bruksenhetstype: "bolig" }]);
  }
  if (url.hostname === "kart.bergen.kommune.no") {
    const pathname = decodeURIComponent(url.pathname);
    const plan = pathname.includes("Reguleringsplaner");
    const kpa = pathname.includes("Arealformål");
    if (plan || kpa) {
      if (!pathname.endsWith("/query")) return Response.json({
        geometryType: "esriGeometryPolygon", capabilities: "Query,Map",
        fields: (plan ? ["PLANID", "PLANNAVN"] : ["KPAREALFORMAL", "AREALST", "BESKRIVELSE", "PLANID"]).map(name => ({ name })),
      });
      return Response.json({ features: [{ attributes: plan
        ? { PLANID: "6170063", PLANNAVN: "Plan fra kontrollert testgrunnlag" }
        : { KPAREALFORMAL: 5100, AREALST: 1, BESKRIVELSE: "LNF", PLANID: "65270000" } }] });
    }
  }
  assert(["byggetiltak-matrikkel.test", "byggetiltak-plan.test", "api.kartverket.no", "kart.bergen.kommune.no"].includes(url.hostname), `Uventet nettverk: ${url.origin}`);
  return Response.json({ feil: "Ingen kartdekning i denne testen" }, { status: 503 });
};
try {
  const { readState } = await import("../apps/sandbox-backend/src/state.ts");
  const { runRessurs } = await import("../apps/sandbox-backend/src/ressurser.ts");
  const { lagreStegSvar, erStegFullfort } = await import("../apps/sandbox-backend/src/prosess.ts");
  const state = await readState();
  const person = state.personer[0];
  const caller: Caller = { type: "innbygger", pid: person.syntetiskFodselsnummer, acr: "idporten-loa-high", clientId: "test" };
  const earlyQuery = new URLSearchParams({ adresse: common.adresse, kommunenummer: "4601", gnr: "1", bnr: "2", tiltakstype: "gjerde" });
  const early = await runRessurs(state, "GET", new URL(`http://localhost/api/garasje/grunnlag?${earlyQuery}`),
    { sporingsId: "test-byggetiltak", kaller: caller }) as TiltakshjelpenGrunnlag;
  const earlyFence = early.tiltaksvarsler?.find(warning => warning.id === "gjerde-plan-6170063");
  assert(earlyFence, "Plantreffet skal gi gjerdevarsel uten mål eller valgt skissepunkt.");
  assert.equal(earlyFence.bestemmelse, "Reguleringsplan 6170063 § 7 bokstav d");
  assert.match(earlyFence.forklaring, /kommunal godkjenning.*utførelse, høyde og farge/);
  assert.equal(earlyFence.kilde, early.reguleringsplaner.find(plan => plan.planId === "6170063")?.url);
  assert.equal(earlyFence.status, "uavklart");
  assert.equal(evaluateTiltakshjelpen(fixtures.gjerde, early).utfall, "maa_avklares");
  assert.deepEqual(check(evaluateTiltakshjelpen(fixtures.gjerde, early), earlyFence.id), earlyFence);
  earlyQuery.delete("tiltakstype");
  const legacyGrunnlag = await runRessurs(state, "GET", new URL(`http://localhost/api/garasje/grunnlag?${earlyQuery}`),
    { sporingsId: "test-byggetiltak", kaller: caller }) as TiltakshjelpenGrunnlag;
  assert.equal(legacyGrunnlag.tiltaksvarsler, undefined);
  const beforeInvalid = sourceReads;
  for (const type of ["oppdiktet", ""]) {
    earlyQuery.set("tiltakstype", type);
    await assert.rejects(runRessurs(state, "GET", new URL(`http://localhost/api/garasje/grunnlag?${earlyQuery}`),
      { sporingsId: "test-byggetiltak", kaller: caller }), badRequest);
  }
  assert.equal(sourceReads, beforeInvalid, "Ugyldig type må stoppes før oppslag.");
  const definition = state.prosesser.find(item => item.id === "garasjesjekk")!;
  const question = definition.steg[2];
  assert(question.type === "QUESTION");
  for (const entry of BYGGETILTAK_KATALOG) {
    for (const field of entry.sporsmaal) assert(question.felter?.some(item => item.id === field.id), `Prosessen mangler ${field.id}`);
  }
  for (const fixture of Object.values(fixtures)) {
    const clientInput = Object.fromEntries(Object.entries(fixture).filter(([key]) => key !== "bebygdEiendom"));
    const query = new URLSearchParams({ adresse: common.adresse, kommunenummer: "4601", gnr: "1", bnr: "2", lat: "60.3", lon: "5.3", tiltak: JSON.stringify(clientInput) });
    const direct = await runRessurs(state, "GET", new URL(`http://localhost/api/garasje/sjekk?${query}`),
      { sporingsId: "test-byggetiltak", kaller: caller }) as { vurdering: TiltakshjelpenVurdering };
    assert.equal(direct.vurdering.tiltakstype, fixture.tiltakstype);
    assert.equal(direct.vurdering.utfall, "maa_avklares");
    query.set("tiltakstype", fixture.tiltakstype === "gjerde" ? "fasade" : "gjerde");
    await assert.rejects(runRessurs(state, "GET", new URL(`http://localhost/api/garasje/sjekk?${query}`),
      { sporingsId: "test-byggetiltak", kaller: caller }), badRequest);
    const session = {
      oektsId: randomUUID(), prosessId: definition.id, personId: person.personId, stegIndex: 2,
      status: "AKTIV" as const, svar: {}, resultaterRaa: {}, opprettet: "2026-09-10T00:00:00Z",
      oppdatert: "2026-09-10T00:00:00Z", sporingsId: "test-byggetiltak", resultatKilder: {}, aktivtSamtykkeId: null,
    };
    assert.throws(() => lagreStegSvar(session, definition, question, { ...common, ...fixture, tiltakstypeBekreftet: false }), badRequest);
    assert(!erStegFullfort(session, question, {}));
    lagreStegSvar(session, definition, question, { ...common, ...clientInput });
    assert(erStegFullfort(session, question, {}));
    session.stegIndex = 3;
    const reads = ownershipReads;
    const embedded = await runRessurs(state, "GET", new URL(`http://localhost/api/garasje/prosess/sjekk?personId=${person.personId}`),
      { sporingsId: "test-byggetiltak", kaller: caller, personId: person.personId, oekt: session, steg: definition.steg[3] }) as { vurdering: TiltakshjelpenVurdering };
    assert.equal(ownershipReads, reads + 1);
    assert.equal(embedded.vurdering.tiltakstype, fixture.tiltakstype);
    assert.deepEqual(embedded.vurdering, direct.vurdering);
  }
  const audit = JSON.parse(await readFile(path.join(stateDir, "revisjonslogg.json"), "utf8"));
  const fences = audit.filter((row: { handling: string; grunnlag?: { tiltak?: Byggetiltak } }) =>
    row.handling === "GARASJE_VURDERT" && row.grunnlag?.tiltak?.tiltakstype === "gjerde");
  assert.equal(fences.length, 2);
  assert(fences.every((row: { grunnlag: { tiltak: object } }) => !("bra" in row.grunnlag.tiltak)));
} finally {
  globalThis.fetch = realFetch;
  await rm(stateDir, { recursive: true, force: true });
}
console.log("Byggetiltak: klassifisering, bekreftelse, alle tiltakstyper, lokale forbehold, begge ressursruter og prosessvar besto.");
