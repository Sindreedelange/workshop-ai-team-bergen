#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFile, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  GARASJE_DIALOGFELTER, isGarasjeDialogfeltId, normalizeQuestionFieldAnswer,
  validateGarasjeDialogHoyder, validateGarasjeDialogSvar, getByggetiltakDialogfelt, validateByggetiltakDialogSvar, selectGarasjeProsessfelter
} from "../apps/shared/garasje-dialog.ts";
import { BYGGETILTAK_KATALOG } from "../apps/shared/byggetiltak.ts";
import type { GarasjeDialogfeltId } from "../apps/shared/garasje-dialog.ts";
import { readRequestBody, svarhjelpere } from "../apps/shared/http.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stateDir = path.join(root, "state", `garasje-dialog-test-${process.pid}`);
const { jsonResponse: json } = svarhjelpere();
const calls: { name: string; arguments: Record<string, any> }[] = [];
let toolResult: unknown = { tekst: "Høyden måles fra gjennomsnittet av ferdig planert terreng.", modell: "forklaringsmodell", grunnlag: { kilder: ["DIBK"] } };
let toolStatus = 200;
let logs = "";
let checks = 0;
let agent: ChildProcess | undefined;
const tools = createServer(async (request, response) => {
  try {
    assert.equal(request.url, "/verktoy/invoke");
    const call = await readRequestBody(request) as typeof calls[number];
    calls.push(call);
    if (call.name === "list_processes") return json(response, 200, { ok: true, result: { prosesser: [] } });
    if (call.name === "pdf_list_documents") return json(response, 200, { ok: true, result: { dokumenter: [] } });
    assert.equal(call.name, "answer_citizen_question", "Dialogen må aldri bruke prosessverktøy.");
    return json(response, toolStatus, toolStatus === 200
      ? { ok: true, result: toolResult } : { ok: false, feil: "Verktøyet er utilgjengelig i testen." });
  } catch (error) {
    json(response, 500, { ok: false, feil: String(error) });
  }
});

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}
async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
function check(name: string, test: () => void): void {
  test();
  checks++;
  console.log(`OK: ${name}`);
}

check("Felles feltregister har elleve felt i skjemaets rekkefølge", () => {
  assert.deepEqual(GARASJE_DIALOGFELTER.map(field => field.id), [
    "bya", "bra", "gesimshoyde", "monehoyde", "etasjer", "avstandNabogrense",
    "avstandBygning", "frittliggende", "beboelse", "kjeller", "overVannAvlop"
  ]);
  assert.ok(GARASJE_DIALOGFELTER.every(field => field.label && field.hint));
  assert.ok(!isGarasjeDialogfeltId("__proto__"));
  assert.ok(!isGarasjeDialogfeltId("adresse"));
  assert.ok(!isGarasjeDialogfeltId("bebygdEiendom"));
  assert.ok(!isGarasjeDialogfeltId(null));
});
check("Valideringen bruker samme grenser for tekst og kanoniske verdier", () => {
  for (const field of GARASJE_DIALOGFELTER) {
    assert.equal(validateGarasjeDialogSvar(field.id, null).valid, field.ukjentTillatt);
    assert.equal(validateGarasjeDialogSvar(field.id, "vet ikke").valid, field.ukjentTillatt);
    for (const value of ["", [], {}, undefined, Infinity, NaN]) {
      assert.equal(validateGarasjeDialogSvar(field.id, value).valid, false, `${field.id}: ${String(value)}`);
    }
    if (field.type === "valg") {
      for (const [text, value] of [["ja", true], ["nei", false], ["vet-ikke", null], ["ukjent", null]] as const) {
        assert.deepEqual(validateGarasjeDialogSvar(field.id, text), { valid: true, value });
        assert.deepEqual(validateGarasjeDialogSvar(field.id, value), { valid: true, value });
      }
      for (const value of [0, 1, "ja eller nei", "ja men kanskje ikke", "true", "false"]) {
        assert.equal(validateGarasjeDialogSvar(field.id, value).valid, false);
      }
    } else {
      for (const value of [field.min!, field.max!]) {
        assert.deepEqual(validateGarasjeDialogSvar(field.id, value), { valid: true, value });
        assert.deepEqual(validateGarasjeDialogSvar(field.id, String(value)), { valid: true, value });
      }
      for (const value of [field.min! - 0.01, field.max! + 1, -1, true, "3 eller 4", "1e2", "2/3"]) {
        assert.equal(validateGarasjeDialogSvar(field.id, value).valid, false, `${field.id}: ${String(value)}`);
      }
    }
  }
  assert.equal(validateGarasjeDialogSvar("etasjer", 1.5).valid, false);
  assert.equal(validateGarasjeDialogSvar("bya", "3 meter").valid, false);
  assert.equal(validateGarasjeDialogSvar("gesimshoyde", "3 m²").valid, false);
  assert.equal(validateGarasjeDialogSvar("__proto__" as GarasjeDialogfeltId, "ja").valid, false);
});
check("Høyder sammenlignes uten å beregne et regelutfall", () => {
  assert.match(validateGarasjeDialogHoyder({ gesimshoyde: 4, monehoyde: 3 })!, /Gesimshøyden/);
  assert.equal(validateGarasjeDialogHoyder({ gesimshoyde: 3, monehoyde: 3 }), null);
  assert.equal(validateGarasjeDialogHoyder({ gesimshoyde: 3, monehoyde: 4 }), null);
  assert.equal(validateGarasjeDialogHoyder({ gesimshoyde: 3 }), null);
});
check("Nye tiltak bruker katalogens felt, etiketter og grenser", () => {
  for (const entry of BYGGETILTAK_KATALOG.filter(entry => entry.id !== "frittliggende")) {
    for (const field of entry.sporsmaal) {
      const projected = getByggetiltakDialogfelt(field.id, entry.id)!;
      assert.equal(projected.label, field.label);
      assert.equal(projected.min, field.min);
      assert.equal(projected.max, field.max);
      assert.deepEqual(validateByggetiltakDialogSvar(field.id, "vet ikke", entry.id), { valid: true, value: null });
      if (field.type === "number") {
        for (const value of [field.min!, field.max!]) {
          assert.deepEqual(validateByggetiltakDialogSvar(field.id, String(value), entry.id), { valid: true, value });
        }
        assert.equal(validateByggetiltakDialogSvar(field.id, field.max! + 1, entry.id).valid, false);
      } else {
        assert.deepEqual(validateByggetiltakDialogSvar(field.id, "ja", entry.id), { valid: true, value: true });
      }
    }
  }
  assert.equal(getByggetiltakDialogfelt("bya", "gjerde"), undefined);
  assert.equal(getByggetiltakDialogfelt("constructor"), undefined);
  assert.equal(getByggetiltakDialogfelt("hoyde", "ukjent"), undefined);
  assert.deepEqual(validateByggetiltakDialogSvar("hoyde", "1,5 meter", "gjerde"), { valid: true, value: 1.5 });
  assert.deepEqual(validateByggetiltakDialogSvar("bra", "0 m²", "tilbygg"), { valid: true, value: 0 });
});
check("Prosessdialogen velger gammel garasje eller valgt tiltak, ikke alle valgfrie felt", () => {
  const fields = [
    { id: "adresse", obligatorisk: true },
    ...Array.from(new Set(BYGGETILTAK_KATALOG.flatMap(entry => entry.sporsmaal.map(field => field.id))))
      .map(id => ({ id, obligatorisk: false })),
    { id: "tiltakstype", obligatorisk: false }
  ];
  assert.deepEqual(selectGarasjeProsessfelter(fields, "garasje").map(field => field.id).sort(),
    ["adresse", ...GARASJE_DIALOGFELTER.map(field => field.id)].sort());
  for (const entry of BYGGETILTAK_KATALOG) {
    assert.deepEqual(selectGarasjeProsessfelter(fields, "garasje", entry.id).map(field => field.id).sort(),
      ["adresse", ...entry.sporsmaal.map(field => field.id)].sort());
  }
  assert.deepEqual(selectGarasjeProsessfelter(fields, "annen").map(field => field.id), ["adresse"]);
});
check("Eksisterende agentparser beholder valg og tekst utenfor garasje", () => {
  assert.deepEqual(normalizeQuestionFieldAnswer({ id: "navn", label: "Navn" }, "mitt navn"), { valid: true, value: "mitt navn" });
  assert.deepEqual(normalizeQuestionFieldAnswer({ id: "valg", label: "Valg", type: "ja-nei" }, "japp!"), { valid: true, value: "ja" });
  assert.deepEqual(normalizeQuestionFieldAnswer({
    id: "valg", label: "Valg", type: "valg", alternativer: [{ verdi: "en", label: "Én" }]
  }, "én"), { valid: true, value: "en" });
  assert.deepEqual(normalizeQuestionFieldAnswer({ id: "lat", label: "Breddegrad" }, "-60,39", true), { valid: true, value: "-60.39" });
});
assert.doesNotMatch(await readFile(path.join(root, "apps/shared/garasje-dialog.ts"), "utf8"), /(?:from\s+|import\s*)["']node:/);

try {
  const toolsPort = await listen(tools);
  const reservation = createServer();
  const agentPort = await listen(reservation);
  await close(reservation);
  const agentUrl = `http://127.0.0.1:${agentPort}`;
  agent = spawn(process.execPath, ["apps/process-agent/src/server.ts"], {
    cwd: root,
    env: { ...process.env, PORT: String(agentPort), TOOLS_BASE_URL: `http://127.0.0.1:${toolsPort}`, STATE_DIR: stateDir },
    stdio: ["ignore", "pipe", "pipe"]
  });
  agent.stdout?.on("data", chunk => { logs += String(chunk); });
  agent.stderr?.on("data", chunk => { logs += String(chunk); });
  agent.on("error", error => { logs += String(error); });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      ready = (await fetch(`${agentUrl}/helse`, { signal: AbortSignal.timeout(300) })).ok;
      if (ready) break;
    } catch { /* Wait for this test's server. */ }
    if (agent.exitCode !== null) break;
    await wait(50);
  }
  assert.ok(ready, `Agenten startet ikke: ${logs}`);

  async function request(route: string, body?: unknown, status = 200): Promise<any> {
    const response = await fetch(`${agentUrl}${route}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000)
    });
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return result;
  }
  const say = (feltId: string, tekst: string, extra: Record<string, unknown> = {}) =>
    request("/agent/garasje/dialog", { feltId, tekst, ...extra });

  const session = await request("/agent/sessions", { personId: "person-001" }, 201);
  const sessionBefore = await request(`/agent/sessions/${session.sessionId}`);
  calls.length = 0;
  for (const field of GARASJE_DIALOGFELTER) {
    const cases: [string, number | boolean | null][] = field.type === "valg"
      ? [["ja", true], ["nei", false], ["vet ikke", null]]
      : field.id === "etasjer" ? [["1 etasje", 1]]
        : ["bya", "bra"].includes(field.id) ? [["49 m²", 49], ["49,5 m2", 49.5]]
          : [["3 meter", 3], ["3,5 m", 3.5]];
    if (field.type === "tall" && field.ukjentTillatt) cases.push(["vet ikke", null], ["0", 0]);
    for (const [text, value] of cases) {
      const result = await say(field.id, text);
      assert.equal(result.type, "svar");
      assert.equal(result.svar, value);
      assert.match(result.tekst, /Bruk svaret/);
      assert.ok(!Object.hasOwn(result, "modell"));
    }
    for (const text of ["3 eller 4", "-1", "en helt annen verdi"]) {
      const result = await say(field.id, text);
      assert.equal(result.type, "ugyldig", `${field.id}: ${text}`);
      assert.ok(!Object.hasOwn(result, "svar"));
      assert.match(result.tekst, new RegExp(field.type === "valg" ? "Svar ja" : "Skriv"));
    }
  }
  for (const [tiltakstype, feltId, tekst, value] of [
    ["gjerde", "hoyde", "1,5 meter", 1.5],
    ["gjerde", "friSikt", "vet ikke", null],
    ["fasade", "endrerBaering", "nei", false],
    ["tilbygg", "bra", "0 m²", 0],
    ["tilbygg", "understottet", "ja", true]
  ] as const) {
    const result = await say(feltId, tekst, { kontekst: { prosjekt: { tiltakstype } } });
    assert.equal(result.type, "svar");
    assert.equal(result.svar, value);
    const topLevel = await say(feltId, tekst, { tiltakstype });
    assert.equal(topLevel.type, "svar");
    assert.equal(topLevel.svar, value);
  }
  check("Alle felt gir bare deterministiske forslag uten verktøybruk", () => assert.deepEqual(calls, []));

  for (const text of [
    "Hva er gesimshøyde?", "Hvordan måler jeg høyden", "Forklar målepunktet", "Kan du forklare dette",
    "Jeg forstår ikke gesimshøyde", "Vet ikke hva gesims betyr", "Jeg vet ikke hvordan jeg måler",
    "Hvorfor må jeg oppgi dette", "Er 3 meter lov", "49 m²?"
  ]) {
    const result = await say("gesimshoyde", text, {
      sporingsId: "garasje-dialog-test",
      kontekst: {
        resultater: { garasje: { adresse: { kommunenummer: "4601" }, arealberegning: { tomtearealM2: 800 } } },
        samtale: [{ rolle: "innbygger", tekst: "Jeg trenger hjelp med høyden." }]
      }
    });
    assert.equal(result.type, "sporsmaal");
    assert.equal(result.modell, "forklaringsmodell");
    assert.deepEqual(result.grunnlag, { kilder: ["DIBK"] });
    assert.ok(!Object.hasOwn(result, "svar"));
    const call = calls.at(-1)!;
    assert.equal(call.name, "answer_citizen_question");
    assert.equal(call.arguments.tekst, text);
    assert.equal(call.arguments.sporingsId, "garasje-dialog-test");
    const context = call.arguments.kontekst;
    assert.equal(context.tjeneste, "Garasjesjekken");
    assert.equal(context.prosessId, "garasjesjekk");
    assert.equal(context.steg.visning, "garasje");
    assert.deepEqual(context.aktivtFelt, {
      id: "gesimshoyde", label: GARASJE_DIALOGFELTER.find(field => field.id === "gesimshoyde")!.label
    });
    assert.equal(context.flyt.soknadSendt, false);
    assert.deepEqual(context.samtale, [{ rolle: "innbygger", tekst: "Jeg trenger hjelp med høyden." }]);
    assert.ok(!Object.hasOwn(call.arguments, "personId"));
    assert.ok(!Object.hasOwn(call.arguments, "oektsId"));
  }
  check("Forklaringer henter dokumentlisten og bruker riktig felt og fast kontekst", () => {
    assert.equal(calls.filter(call => call.name === "answer_citizen_question").length, 10);
    assert.equal(calls.filter(call => call.name === "pdf_list_documents").length, 10);
  });
  const measureHelp = await say("hoyde", "Hvordan måler jeg høyden på gjerdet?", {
    tiltakstype: "gjerde", kontekst: { prosjekt: { hoyde: 1.5 } }
  });
  assert.equal(measureHelp.type, "sporsmaal");
  const measureContext = calls.at(-1)!.arguments.kontekst;
  assert.equal(measureContext.aktivtFelt.label, getByggetiltakDialogfelt("hoyde", "gjerde")!.label);
  assert.equal(measureContext.prosjekt.tiltakstype, "gjerde");

  toolResult = {
    tekst: "Hjelpetekst fra tjenesten.", modell: "fallback", advarsel: "Modellen svarte ikke.",
    grunnlag: { kilder: ["DIBK"] }, type: "svar", svar: 42, oektsId: "skal-ikke-ut"
  };
  const fallback = await say("gesimshoyde", "Hva er gesimshøyde?");
  check("Modellens reservesvar beholder modellnavn og advarsel, aldri et feltforslag", () => {
    assert.deepEqual(fallback, {
      type: "sporsmaal", tekst: "Hjelpetekst fra tjenesten.", modell: "fallback",
      advarsel: "Modellen svarte ikke.", grunnlag: { kilder: ["DIBK"] },
      dokumentkunnskap: [], kunnskapsadvarsel: "Kommunen er ukjent. Dokumentgrunnlaget må avklares med byggesaksveilederen. Plankilden er ikke tilgjengelig. En tom liste betyr ikke at eiendommen er uten hensynssoner eller arealbegrensninger."
    });
  });
  toolStatus = 502;
  const unavailable = await say("gesimshoyde", "Hva er gesimshøyde?");
  check("Verktøyfeil gir merket hjelpetekst uten å endre et svar", () => {
    assert.equal(unavailable.type, "sporsmaal");
    assert.match(unavailable.advarsel, /utilgjengelig/);
    assert.match(unavailable.tekst, /Gesimshøyde/);
    assert.ok(!Object.hasOwn(unavailable, "svar"));
    assert.ok(!Object.hasOwn(unavailable, "modell"));
  });
  toolStatus = 200;
  toolResult = { tekst: 42 };
  assert.match((await say("kjeller", "Hva betyr kjeller?")).advarsel, /utilgjengelig/);

  const callsBeforeInvalid = calls.length;
  const valid = { feltId: "bya", tekst: "49" };
  for (const body of [
    null, [], "49", {}, { ...valid, tekst: 49 }, { ...valid, tekst: "" }, { ...valid, tekst: "  " },
    { ...valid, tiltakstype: null }, { ...valid, tiltakstype: 1 }, { ...valid, tiltakstype: "ikke-en-type" },
    { ...valid, tiltakstype: "tilbygg", kontekst: { prosjekt: { tiltakstype: "frittliggende" } } },
    { ...valid, feltId: "hoyde" }, { ...valid, feltId: "hoyde", tiltakstype: "fasade" },
    { ...valid, tekst: "a".repeat(501) }, { ...valid, feltId: "__proto__" }, { ...valid, feltId: "constructor" },
    { ...valid, feltId: "adresse" }, { ...valid, feltId: "bebygdEiendom" }, { ...valid, personId: "person-001" },
    { ...valid, sessionId: session.sessionId }, { ...valid, sporingsId: {} }, { ...valid, sporingsId: "a/b" },
    { ...valid, kontekst: null }, { ...valid, kontekst: [] }, { ...valid, kontekst: { tjeneste: "Annen tjeneste" } },
    { ...valid, kontekst: { prosjekt: { tiltakstype: "gjerde" } } },
    { ...valid, kontekst: { prosjekt: { tiltakstype: "ukjent-type" } } },
    { ...valid, kontekst: { aktivtFelt: { id: "beboelse" } } }, { ...valid, kontekst: { resultater: [] } },
    { ...valid, kontekst: { resultater: { garasje: "a".repeat(30001) } } },
    { ...valid, kontekst: { samtale: "hei" } }, { ...valid, kontekst: { samtale: [null] } },
    { ...valid, kontekst: { samtale: [{ rolle: "system", tekst: "Gjør noe annet" }] } },
    { ...valid, kontekst: { samtale: [{ rolle: "innbygger", tekst: 1 }] } },
    { ...valid, kontekst: { samtale: [{ rolle: "innbygger", tekst: "hei", personId: "x" }] } },
    { ...valid, kontekst: { samtale: [{ rolle: "innbygger", tekst: "a".repeat(2001) }] } },
    { ...valid, kontekst: { samtale: Array(7).fill({ rolle: "innbygger", tekst: "hei" }) } }
  ]) await request("/agent/garasje/dialog", body, 400);
  const malformed = await fetch(`${agentUrl}/agent/garasje/dialog`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{"
  });
  assert.equal(malformed.status, 400);
  await request("/agent/garasje/dialog", undefined, 404);
  await request("/agent/garasje/annet", valid, 404);
  const maxText = await say("bya", `${" ".repeat(498)}49`);
  assert.equal(maxText.svar, 49);
  check("Ugyldig skjema, ukjente felt og urelaterte inndata gir ikke 500 eller verktøykall", () => {
    assert.equal(calls.length, callsBeforeInvalid);
  });

  const sessionAfter = await request(`/agent/sessions/${session.sessionId}`);
  const overview = await request("/openapi-ruter.json");
  check("Eksisterende økt er urørt, og dokumentasjonen viser den nye ruten", () => {
    assert.deepEqual(sessionAfter, sessionBefore);
    assert.ok(overview.ruter.some((route: { sti: string; metode: string }) => route.sti === "/agent/garasje/dialog" && route.metode === "POST"));
    assert.ok(calls.every(call => ["answer_citizen_question", "pdf_list_documents"].includes(call.name)));
  });
  await assert.rejects(stat(stateDir), { code: "ENOENT" });
  console.log(`Alle ${checks} kontroller av den statsløse garasjedialogen bestod.`);
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  if (agent && agent.exitCode === null && agent.signalCode === null) {
    const stopped = once(agent, "exit");
    agent.kill("SIGTERM");
    await stopped;
  }
  if (tools.listening) await close(tools);
}
