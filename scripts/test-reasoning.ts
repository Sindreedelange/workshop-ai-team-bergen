import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  IKKE_REASONING_OPPGAVER,
  REASONING_OPPGAVER,
  REASONING_PROVIDERE,
  providerKanReasoning,
  reasoningForOppgave,
  uvurderteOppgaver,
  velgReasoningModell
} from "../apps/ai-gateway/src/reasoning.ts";

const kilde = await readFile(new URL("../apps/ai-gateway/src/server.ts", import.meta.url), "utf8");

/* ── Hvilke oppgaver som tenker ───────────────────────────────────────────── */

assert.equal(reasoningForOppgave("garasje-raad"), true);
assert.equal(reasoningForOppgave("oppsummering"), false, "målt: modellen skrev om teksten den skulle gjengi");
assert.equal(reasoningForOppgave("tolk-svar"), false, "målt: samme treff, opptil 12 ganger latensen");
assert.equal(reasoningForOppgave("en-oppgave-som-ikke-finnes"), false, "en ukjent oppgave tenker ikke");
assert.equal(reasoningForOppgave(undefined), false);
assert.equal(reasoningForOppgave(null), false);

const begge = Object.keys(REASONING_OPPGAVER).filter(oppgave => Object.hasOwn(IKKE_REASONING_OPPGAVER, oppgave));
assert.deepEqual(begge, [], "en oppgave kan ikke både tenke og ikke tenke");

for (const [tabellnavn, tabell] of [["REASONING_OPPGAVER", REASONING_OPPGAVER], ["IKKE_REASONING_OPPGAVER", IKKE_REASONING_OPPGAVER]] as const) {
  for (const [oppgave, grunn] of Object.entries(tabell)) {
    assert(grunn.length > 30, `${tabellnavn}.${oppgave} mangler målingen som er grunnen`);
  }
}

/*
 * Driftvakten: en oppgave som får nytt navn i server.ts mister policyen sin i
 * stillhet, og en ny oppgave arver «tenker ikke» uten at noen har vurdert den.
 * Oppgavenavnene står to steder i koden - som `task: "..."` og som de fem
 * generiske /ai/-stiene, der stien er navnet.
 */
const fraLiteral = [...kilde.matchAll(/task: "([a-z-]+)"/g)].map(treff => treff[1]);
const stiListe = kilde.match(/const gyldigeStier = \[([^\]]+)\]/);
assert(stiListe, "fant ikke gyldigeStier i server.ts");
const fraStier = [...stiListe[1].matchAll(/"\/ai\/([a-z-]+)"/g)].map(treff => treff[1]);
const alleOppgaver = [...new Set([...fraLiteral, ...fraStier])].sort();
assert(alleOppgaver.length >= 10, `fant bare ${alleOppgaver.length} oppgaver i server.ts`);
assert(alleOppgaver.includes("garasje-raad") && alleOppgaver.includes("oppsummering"));
assert.deepEqual(uvurderteOppgaver(alleOppgaver), [],
  "hver oppgave i server.ts skal stå i én av de to tabellene, med en begrunnelse");

const ukjenteITabellene = [...Object.keys(REASONING_OPPGAVER), ...Object.keys(IKKE_REASONING_OPPGAVER)]
  .filter(oppgave => !alleOppgaver.includes(oppgave));
assert.deepEqual(ukjenteITabellene, [], "tabellene navngir oppgaver som ikke finnes i server.ts lenger");

/* ── Hvilke providere som kan ─────────────────────────────────────────────── */

const providerListe = kilde.match(/const AI_PROVIDERS = \[([^\]]+)\]/);
assert(providerListe, "fant ikke AI_PROVIDERS i server.ts");
const providere = [...providerListe[1].matchAll(/"([a-z-]+)"/g)].map(treff => treff[1]);
for (const provider of providere) {
  assert(Object.hasOwn(REASONING_PROVIDERE, provider), `${provider} mangler i REASONING_PROVIDERE`);
  assert(REASONING_PROVIDERE[provider].grunn.length > 20, `${provider} mangler en grunn`);
}
assert.deepEqual(
  Object.entries(REASONING_PROVIDERE).filter(([, evne]) => evne.stotter).map(([navn]) => navn),
  ["telenor-ai-factory"],
  "bare målt støtte teller. Å påstå støtte vi ikke har prøvd gir en oppgave som ser ut som den tenker uten å gjøre det"
);
assert.equal(providerKanReasoning("telenor-ai-factory"), true);
assert.equal(providerKanReasoning("bedrock"), false);
assert.equal(providerKanReasoning("en-provider-som-ikke-finnes"), false);

/* ── Hvilken modell reasoning-oppgavene kjører på ─────────────────────────── */

// Samme rekkefølge og evner som AI_FACTORY_MODELS i server.ts: GLM står først
// fordi den er standardmodellen ellers, og Nemotron er den anbefalte til tenking.
const modeller = [
  { id: "GLM-5.2-FP8", reasoning: true },
  { id: "NVIDIA-Nemotron-3-Super-120B-A12B-FP8", reasoning: true, reasoningAnbefalt: true },
  { id: "Qwen3-Coder-Next-FP8", reasoning: false }
];
const NEMOTRON = "NVIDIA-Nemotron-3-Super-120B-A12B-FP8";

// Regresjonen dette festet: «den første som kan tenke» ga GLM-5.2, altså nettopp
// modellen som ble kuttet av taket på en full garasjevurdering.
assert.deepEqual(velgReasoningModell(modeller), { modell: NEMOTRON },
  "uten et ønske skal den anbefalte tas, ikke den første i listen");
assert.deepEqual(velgReasoningModell(modeller, ""), { modell: NEMOTRON });

assert.deepEqual(velgReasoningModell(modeller, "GLM-5.2-FP8"), { modell: "GLM-5.2-FP8" },
  "en modell som kan tenke skal brukes som bedt om, også når en annen er raskere");

const utenTenking = velgReasoningModell(modeller, "Qwen3-Coder-Next-FP8");
assert.equal(utenTenking.modell, NEMOTRON);
assert(utenTenking.advarsel?.includes("Qwen3-Coder-Next-FP8"),
  "advarselen skal navngi modellen som ble byttet ut, ellers ser byttet ut som en tilfeldighet");
assert(utenTenking.advarsel?.includes("ingen tenkemodus"));

const ukjent = velgReasoningModell(modeller, "en-modell-som-ikke-finnes");
assert.equal(ukjent.modell, NEMOTRON);
assert(ukjent.advarsel?.includes("ikke en kjent modell"));

assert.deepEqual(velgReasoningModell([{ id: "bare-denne", reasoning: true }]), { modell: "bare-denne" },
  "uten en anbefalt modell er den første som kan riktig svar");

const ingen = velgReasoningModell([{ id: "Qwen3-Coder-Next-FP8", reasoning: false }], "Qwen3-Coder-Next-FP8");
assert.equal(ingen.modell, null, "uten en modell som kan tenke skal svaret være at ingen kan");
assert(ingen.advarsel?.includes("tenkemodus"));
assert.deepEqual(velgReasoningModell([]), { modell: null, advarsel: "Ingen av de tilgjengelige modellene har en tenkemodus." });

/* ── At koden faktisk bruker tabellene ────────────────────────────────────── */

assert(/valg\.reasoning \?\? reasoningForOppgave\(valg\.task\)/.test(kilde),
  "callModel skal lese policyen ut fra oppgaven, ikke vente på at hvert kallsted husker den");
assert(/reasoningOensket && providerKanReasoning\(aiProvider\)/.test(kilde),
  "en reasoning-oppgave hos en provider uten støtte skal kjøre uten tenking, ikke sende et flagg ingen leser");
assert(/reasoning,\n\s*reasoningOensket,/.test(kilde),
  "sporet skal ha begge tallene, så et svar som ikke tenkte ikke ser ut som ett som gjorde det");

const garasjeKall = kilde
  .slice(kilde.indexOf("async function adviseGarasjeWithAi"), kilde.indexOf("async function getIntentFromModel"))
  // Uten dette treffer sjekken kommentaren som forklarer hvorfor linjen ikke er der.
  .replace(/\/\/[^\n]*/g, "");
assert(!/reasoning: true/.test(garasjeKall),
  "kallstedet skal ikke gjenta det tabellen sier - to steder som sier det samme er ett som kan bli glemt");
assert(/task: "garasje-raad"/.test(garasjeKall));

const modellisteIKode = kilde.slice(kilde.indexOf("const AI_FACTORY_MODELS"), kilde.indexOf("let aiFactoryModel"));
assert(/reasoning: false/.test(modellisteIKode) && /reasoning: true/.test(modellisteIKode),
  "modellisten skal si hvilke modeller som kan tenke, så valget er et oppslag og ikke en hardkodet streng");
assert.equal((modellisteIKode.match(/reasoningAnbefalt: true/g) || []).length, 1,
  "nøyaktig én modell skal være anbefalt til tenking, ellers avgjør rekkefølgen i listen");

console.log("Reasoning: oppgavepolicyen, providerevnene, modellvalget og koblingen i callModel besto.");
