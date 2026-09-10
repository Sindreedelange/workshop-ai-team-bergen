import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  AI_FACTORY_MODELS,
  OPPGAVE_REASONING,
  PROVIDER_REASONING,
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

for (const [oppgave, { grunn }] of Object.entries(OPPGAVE_REASONING)) {
  assert(grunn.length > 30, `OPPGAVE_REASONING.${oppgave} mangler målingen som er grunnen`);
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
  "hver oppgave i server.ts skal stå i OPPGAVE_REASONING, med en begrunnelse");

const ukjenteITabellen = Object.keys(OPPGAVE_REASONING).filter(oppgave => !alleOppgaver.includes(oppgave));
assert.deepEqual(ukjenteITabellen, [], "tabellen navngir oppgaver som ikke finnes i server.ts lenger");

/* ── Hvilke providere som kan ─────────────────────────────────────────────── */

const providerListe = kilde.match(/const AI_PROVIDERS = \[([^\]]+)\]/);
assert(providerListe, "fant ikke AI_PROVIDERS i server.ts");
const providere = [...providerListe[1].matchAll(/"([a-z-]+)"/g)].map(treff => treff[1]);
for (const provider of providere) {
  assert(Object.hasOwn(PROVIDER_REASONING, provider), `${provider} mangler i PROVIDER_REASONING`);
  assert(PROVIDER_REASONING[provider].grunn.length > 20, `${provider} mangler en grunn`);
}
assert.deepEqual(
  Object.entries(PROVIDER_REASONING).filter(([, evne]) => evne.stotter).map(([navn]) => navn),
  ["telenor-ai-factory"],
  "bare målt støtte teller. Å påstå støtte vi ikke har prøvd gir en oppgave som ser ut som den tenker uten å gjøre det"
);
assert.equal(providerKanReasoning("telenor-ai-factory"), true);
assert.equal(providerKanReasoning("bedrock"), false);
assert.equal(providerKanReasoning("en-provider-som-ikke-finnes"), false);

/* ── Hvilken modell reasoning-oppgavene kjører på ─────────────────────────── */

// Den virkelige listen, ikke en kopi: en modell som mister tenkemodus i
// AI_FACTORY_MODELS skal slå ut her, ikke bare i en fiktiv liste.
const NEMOTRON = "NVIDIA-Nemotron-3-Super-120B-A12B-FP8";
assert.equal(AI_FACTORY_MODELS.filter(modell => modell.reasoningAnbefalt).length, 1,
  "nøyaktig én modell skal være anbefalt til tenking, ellers avgjør rekkefølgen i listen");
assert(AI_FACTORY_MODELS.some(modell => modell.reasoning === false),
  "listen skal si hvilke modeller som ikke kan tenke, ellers er valget ikke et oppslag");
for (const modell of AI_FACTORY_MODELS) {
  assert(modell.merknad.length > 20, `${modell.id} mangler målingen bak reasoning-flagget`);
}

// Regresjonen dette festet: «den første som kan tenke» ga GLM-5.2, altså nettopp
// modellen som ble kuttet av taket på en full garasjevurdering.
assert.deepEqual(velgReasoningModell(AI_FACTORY_MODELS), { modell: NEMOTRON },
  "uten et ønske skal den anbefalte tas, ikke den første i listen");
assert.deepEqual(velgReasoningModell(AI_FACTORY_MODELS, ""), { modell: NEMOTRON });
assert.deepEqual(velgReasoningModell(AI_FACTORY_MODELS, "GLM-5.2-FP8"), { modell: "GLM-5.2-FP8" },
  "en modell som kan tenke skal brukes som bedt om, også når en annen er anbefalt");

const utenTenking = velgReasoningModell(AI_FACTORY_MODELS, "Qwen3-Coder-Next-FP8");
assert.equal(utenTenking.modell, NEMOTRON);
assert(utenTenking.advarsel?.includes("Qwen3-Coder-Next-FP8"),
  "advarselen skal navngi modellen som ble byttet ut, ellers ser byttet ut som en tilfeldighet");
assert(utenTenking.advarsel?.includes("ingen tenkemodus"));

const ukjent = velgReasoningModell(AI_FACTORY_MODELS, "en-modell-som-ikke-finnes");
assert.equal(ukjent.modell, NEMOTRON);
assert(ukjent.advarsel?.includes("ikke en kjent modell"));

assert.deepEqual(velgReasoningModell([{ id: "bare-denne", reasoning: true }]), { modell: "bare-denne" },
  "uten en anbefalt modell er den første som kan riktig svar");
const ingen = velgReasoningModell([{ id: "kan-ikke", reasoning: false }], "kan-ikke");
assert.equal(ingen.modell, null, "uten en modell som kan tenke skal svaret være at ingen kan");
assert(ingen.advarsel?.includes("tenkemodus"));
assert.deepEqual(velgReasoningModell([]), { modell: null, advarsel: "Ingen av de tilgjengelige modellene har en tenkemodus." });

/* ── At koden faktisk bruker tabellene ────────────────────────────────────── */

assert(/reasoningForOppgave\(valg\.task\) && providerKanReasoning\(aiProvider\)/.test(kilde),
  "callModel skal lese policyen ut fra oppgaven og gate den på provideren, ikke vente på at hvert kallsted husker det");
assert(/PROVIDER_TIMEOUT_TAK\[aiProvider\] \?\? Infinity/.test(kilde),
  "taket skal være et oppslag per provider, ikke en sammenligning mot et providernavn i callModel");
assert(/chat_template_kwargs:\s*\{\s*enable_thinking:\s*reasoning\s*\}/.test(kilde),
  "flagget sendes ikke, så oppgaven arver modellens standard i stedet for sin egen policy");
assert(/callAiFactory\(prompt, temperature, systemMessage, signal, reasoning\)/.test(kilde),
  "kallstedet i callModel slipper reasoning-valget, så garasje-raad tenker ikke");
assert(/svar\.tenkte = reasoning;/.test(kilde),
  "callModel skal sette tenkte selv - et kallsted som utleder det fra tenketeksten gjetter");

// Taket gjelder tenketokenene også. Et max_tokens her spiser budsjettet på tenkingen
// og lar content stå tom med finish_reason «length» - et tomt svar som ser ut som en
// modellfeil. Sjekken finnes fordi feilen er usynlig.
const aiFactoryKall = kilde.slice(kilde.indexOf("async function callAiFactory"), kilde.indexOf("// --- Bedrock"));
assert(!/max_tokens/.test(aiFactoryKall),
  "et tak på svaret kutter tenkingen og gir et tomt svar i stedet for en feil");

// Tenkingen skal vises, ikke bare lagres: et felt ingen ser oppfyller ikke
// begrunnelsen om etterprøvbarhet.
assert(/reasoningResponse: svar\.reasoning/.test(kilde), "tenkingen skal til KI-sporet");
assert(/l\.reasoningResponse/.test(kilde), "tenkingen skal vises i /trace, ellers er den lagret uten leser");

console.log("Reasoning: oppgavepolicyen, providerevnene, modellvalget og koblingen i callModel besto.");
