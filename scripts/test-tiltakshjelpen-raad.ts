import assert from "node:assert/strict";
import { buildTiltakshjelpenRaadFallback, buildTiltakshjelpenRaadPrompt, harTillatendeProsa, validateTiltakshjelpenRaad } from "../apps/ai-gateway/src/tiltakshjelpen-raad.ts";
import { TILTAKSHJELPEN_UTFALL, TILTAKSHJELPEN_UTFALL_FRITAR } from "../apps/shared/tiltakshjelpen.ts";
import { createServer, type Server } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, rm } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import { readRequestBody, svarhjelpere } from "../apps/shared/http.ts";
import { projectTiltakshjelpenPlanflater } from "../apps/shared/tiltakshjelpen-kunnskap.ts";

/** validateTiltakshjelpenRaad svarer null når det ikke er noe råd. Her er det alltid ett. */
function kreves<T>(verdi: T | null, hva: string): T {
  assert(verdi, `${hva} skulle gitt et råd`);
  return verdi;
}

// Klemmen er hele poenget: bare reglene kan si at noe ikke er søknadspliktig.
// Prompten ber om det samme, men en prompt kan modellen overse, og da er dette
// det som står igjen.
const uavklart = {
  utfall: "maa_avklares",
  uavklarteForhold: ["Planbestemmelser for KPA2018 er ikke kontrollert."]
};

const forsoktGroent = kreves(validateTiltakshjelpenRaad({
  antattUtfall: "ikke_soknadspliktig",
  raad: "Nasjonale grenser er oppfylt, så du kan bygge uten å søke.",
  maaAvklares: [],
  begrunnelse: "Størrelse og høyder er innenfor."
}, uavklart), "et grønt forslag mot en uavklart vurdering");
assert.equal(forsoktGroent.antattUtfall, "maa_avklares", "et råd kan ikke gjøre utfallet mildere enn reglene");
assert(forsoktGroent.overstyrt?.includes("maa_avklares"), "overstyringen skal si hva som skjedde");
assert.deepEqual(forsoktGroent.maaAvklares, uavklart.uavklarteForhold,
  "reglenes uavklarte forhold står i lista selv om modellen svarte med en tom liste");
assert.equal(forsoktGroent.fraRegler, 1, "klienten må kunne skille reglenes forhold fra modellens tillegg");
assert.doesNotMatch(forsoktGroent.raad, /du kan bygge uten å søke/i);
assert.match(forsoktGroent.raad, /byggesaksveileder/);
for (const raad of ["Du kan bygge uten å søke.", "Du trenger ikke søke.", "Planbestemmelsene er kontrollert.", "Alle vilkår er oppfylt."]) {
  const result = kreves(validateTiltakshjelpenRaad({ antattUtfall: "maa_avklares", raad }, uavklart), raad);
  assert.notEqual(result.raad, raad, "Også grønn prosa med et allerede konservativt utfallsfelt må erstattes");
  assert.ok(result.overstyrt);
}
/*
 * Klemmen skal lese modellens løfte, ikke regelens forbehold.
 *
 * Målt mot en lokal modell ble rådet erstattet i fem av sju grener, og hver gang
 * på reglenes egen tekst: sjekken `hensynssoner` sier at sonen «sier at et hensyn
 * gjelder for området, ikke om tiltaket er tillatt», og modellen gjentok den fordi
 * prompten ber om det. Advarselen «før du kan bygge» slo ut på samme måte. Begge
 * er det motsatte av en tillatelse.
 */
const sitertForbehold = {
  utfall: "maa_avklares",
  uavklarteForhold: ["Sonen sier at et hensyn gjelder for området, ikke om tiltaket er tillatt."],
  sjekker: [{ id: "hensynssoner", status: "uavklart", forklaring: "Skissepunktet ligger inne i sonen. Sonen sier at et hensyn gjelder for området, ikke om tiltaket er tillatt." }]
};
const beholdt = kreves(validateTiltakshjelpenRaad({
  antattUtfall: "maa_avklares",
  raad: "Gjerdet må avklares med kommunen før du kan bygge. Planbestemmelsen i § 7 bokstav d krever godkjenning.",
  maaAvklares: ["Sonen sier at et hensyn gjelder for området, ikke om tiltaket er tillatt."],
  begrunnelse: "Planbestemmelsene og hensynssonene er ikke kontrollert."
}, sitertForbehold), "et forbehold sitert fra regelen");
assert.equal(beholdt.overstyrt, undefined, "et sitat fra regelen er ikke modellens løfte om tillatelse");
assert.match(beholdt.raad, /§ 7 bokstav d/, "den konkrete begrunnelsen skal nå innbyggeren");
assert.match(beholdt.begrunnelse, /ikke kontrollert/);

// Meldeplikt er også et fritak, og klemmen leser hele kodeverket og ikke ett navn.
const forsoktMeldeplikt = kreves(validateTiltakshjelpenRaad({
  antattUtfall: "meldeplikt",
  raad: "Meld tiltaket inn til kommunen når det er ferdig.",
  maaAvklares: [], begrunnelse: "Vilkårene ser oppfylt ut."
}, uavklart), "et meldepliktforslag mot en uavklart vurdering");
assert.equal(forsoktMeldeplikt.antattUtfall, "maa_avklares", "modellen kan ikke gi fritak med meldeplikt");
assert(forsoktMeldeplikt.overstyrt?.includes("maa_avklares"));
const meldepliktFraRegel = kreves(validateTiltakshjelpenRaad({
  antattUtfall: "meldeplikt",
  raad: "Meld tiltaket inn til kommunen når det er ferdig bygget.",
  maaAvklares: [], begrunnelse: "Vilkårene i hvitelisten er oppfylt."
}, { utfall: "meldeplikt", uavklarteForhold: [] }), "et meldepliktråd når regelen sa meldeplikt");
assert.equal(meldepliktFraRegel.antattUtfall, "meldeplikt");
assert.equal(meldepliktFraRegel.overstyrt, undefined);
assert.doesNotMatch(meldepliktFraRegel.raad, /byggesaksveileder/,
  "et fritak skal ikke få påklistret setningen om å ta forholdene til byggesaksveilederen");
/*
 * Klemmens predikat er «mildere enn reglene», og prosasjekken er bare et anslag på
 * det. Har reglene selv gitt fritaket, må anslaget være av: ellers kastes et riktig
 * råd om meldeplikt fordi det sier sant at innbyggeren ikke trenger å søke.
 */
const meldepliktGrunnlag = { utfall: "meldeplikt", uavklarteForhold: [], sjekker: [] };
const riktigMeldeplikt = kreves(validateTiltakshjelpenRaad({
  antattUtfall: "meldeplikt",
  raad: "Du trenger ikke å søke for denne garasjen, men du må melde den inn til kommunen når den er ferdig.",
  maaAvklares: [], begrunnelse: "Vilkårene i hvitelisten er oppfylt."
}, meldepliktGrunnlag), "et råd som gjentar reglenes eget fritak");
assert.equal(riktigMeldeplikt.overstyrt, undefined,
  "«du trenger ikke å søke» er reglenes eget svar når utfallet er meldeplikt, ikke modellens løfte");
assert.match(riktigMeldeplikt.raad, /melde den inn/);

// Og plikten må stå i teksten selv når modellen glemmer den, siden prosasjekken er
// av for denne grenen.
const glemtMelding = kreves(validateTiltakshjelpenRaad({
  antattUtfall: "meldeplikt", raad: "Du trenger ikke å søke for denne garasjen.", maaAvklares: []
}, meldepliktGrunnlag), "et fritaksråd uten meldeplikten");
assert.match(glemtMelding.raad, /Husk å melde tiltaket inn til kommunen når det er ferdig bygget/);
assert.equal(glemtMelding.overstyrt, undefined);

const meldepliktReserve = buildTiltakshjelpenRaadFallback({ utfall: "meldeplikt", uavklarteForhold: [] });
assert.equal(meldepliktReserve.antattUtfall, "meldeplikt");
assert.match(meldepliktReserve.raad, /meldes inn til kommunen når det er ferdig bygget/);

assert(!harTillatendeProsa("sonen sier at et hensyn gjelder for området, ikke om tiltaket er tillatt."));
assert(!harTillatendeProsa("avklar dette med kommunen før du kan bygge."));
assert(!harTillatendeProsa("det er ikke avklart om du kan bygge uten å søke."));
assert(harTillatendeProsa("du kan bygge uten å søke."));
assert(harTillatendeProsa("du trenger ikke søke."));
assert(harTillatendeProsa("planbestemmelsene er kontrollert."));
assert(harTillatendeProsa("tiltaket er lovlig."));
assert(harTillatendeProsa("du trenger ikke søke, og tiltaket er tillatt."),
  "et nektende ord lenger tilbake i setningen gjelder et annet verb og skal ikke slippe løftet gjennom");

const manyConditions = Array.from({ length: 15 }, (_, i) => `${i}: ${"vilkår ".repeat(70)}Behold siste setning.`);
const complete = kreves(validateTiltakshjelpenRaad({ raad: "Kontakt byggesaksveilederen.", maaAvklares: ["Nytt punkt"] },
  { ...uavklart, uavklarteForhold: manyConditions }), "lange regelvilkår");
assert.deepEqual(complete.maaAvklares.slice(0, 15), manyConditions);
assert.equal(complete.fraRegler, 15);
assert.equal(complete.maaAvklares.length, 16);

// Strengere enn reglene er trygt, og ofte riktig når bestemmelsene ikke er lest.
const strengere = kreves(validateTiltakshjelpenRaad({
  antattUtfall: "maa_avklares",
  raad: "Bestemmelsene er ikke gjennomgått, så forholdet må avklares.",
  maaAvklares: ["Les KPA2018-bestemmelsene."],
  begrunnelse: "PDF-en er ikke innlest."
}, { utfall: "ikke_soknadspliktig", uavklarteForhold: [] }), "et strengere råd");
assert.equal(strengere.antattUtfall, "maa_avklares");
assert.equal(strengere.overstyrt, undefined, "et strengere råd er ikke en overstyring");

// Reglenes forhold kommer først, og et duplikat fra modellen legges ikke til to ganger.
const duplikat = kreves(validateTiltakshjelpenRaad({
  antattUtfall: "maa_avklares",
  raad: "Forholdet må avklares.",
  maaAvklares: ["Planbestemmelser for KPA2018 er ikke kontrollert.", "Juridisk utnyttelsesgrad er ukjent."],
  begrunnelse: ""
}, uavklart), "et råd med duplikat");
assert.deepEqual(duplikat.maaAvklares, [
  "Planbestemmelser for KPA2018 er ikke kontrollert.",
  "Juridisk utnyttelsesgrad er ukjent."
]);
assert.equal(duplikat.fraRegler, 1, "bare det første punktet kom fra reglene");

// Et ukjent utfall fra modellen faller til reglenes, ikke til det grønne.
const tull = kreves(validateTiltakshjelpenRaad({ antattUtfall: "helt_greit", raad: "Noe tekst.", maaAvklares: [] }, uavklart), "et ukjent utfall fra modellen");
assert.equal(tull.antattUtfall, "maa_avklares");

// Et ukjent utfall i *vurderingen* er ikke et grønt lys heller.
const utenVurdering = kreves(validateTiltakshjelpenRaad({ antattUtfall: "ikke_soknadspliktig", raad: "Noe tekst." }, {}), "en vurdering uten utfall");
assert.equal(utenVurdering.antattUtfall, "maa_avklares",
  "mangler vurderingen et utfall, er svaret at forholdet må avklares");

// Uten et råd er det ingenting å vise, og da skal kallstedet feile i stedet for å
// sende en tom boble videre til innbyggeren.
assert.equal(validateTiltakshjelpenRaad({ antattUtfall: "maa_avklares", raad: "   " }, uavklart), null);
assert.equal(validateTiltakshjelpenRaad(null, uavklart), null);
assert.equal(validateTiltakshjelpenRaad("maa_avklares", uavklart), null);

// Kodeverket bor i apps/shared og er derivert til typen, så det finnes ingen kopi
// å holde i takt. Det som er verdt å feste er at det ene fritakende utfallet er med
// i listen: en omdøping som gjør dem uenige ville gjort klemmen til en no-op.
assert(TILTAKSHJELPEN_UTFALL.includes(TILTAKSHJELPEN_UTFALL_FRITAR),
  "det fritakende utfallet må være et gyldig utfall, ellers klemmer klemmen ingenting");

// Prompten: den regelbaserte vurderingen skal stå der, og persondata skal ikke.
// Kallstedet projiserer gjennom buildTiltakshjelpenKunnskapsgrunnlag, så det som sendes
// hit er allerede uten identitet - men prompten skal ikke finne på å legge til noe.
const prompt = buildTiltakshjelpenRaadPrompt(
  { kommunenummer: "4601", planbestemmelserKontrollert: false },
  uavklart
);
assert(prompt.includes("«maa_avklares»"), "prompten skal si hva reglene allerede har avgjort");
assert(prompt.includes("Bare reglene kan si at noe ikke er søknadspliktig, og bare reglene kan si at det holder å melde inn."));
assert(prompt.includes("aldri fravær av begrensninger"));
assert(!/fødselsnummer|personId/i.test(prompt));
const projectedPrompt = buildTiltakshjelpenRaadPrompt({}, { ...uavklart, personId: "SKAL_IKKE_MED",
  sjekker: [{ id: "plan", forklaring: manyConditions[0], geometry: "IKKE_GEOMETRI", kilde: "https://dibk.no" }] });
assert(!/SKAL_IKKE_MED|IKKE_GEOMETRI/.test(projectedPrompt));
assert(projectedPrompt.includes(manyConditions[0]));
assert.equal(validateTiltakshjelpenRaad({ raad: "x".repeat(1201) }, uavklart), null, "Lang prosa må ikke kuttes midt i et forbehold");

console.log("Tiltakshjelpens råd: klemmen mot et mildere utfall, reglenes uavklarte forhold og promptgrensene besto.");

// Real agent -> tools -> gateway wiring, with only the document store and model
// replaced. Every service and state directory belongs to this test.
const stateDir = `state/garasje-raad-test-${process.pid}`;
const { jsonResponse: json } = svarhjelpere();
const canonicalUrl = "https://api.arealplaner.no/api/kunder/bergen4601/dokumenter/1487/download/b65270000.pdf";
let pdfAvailable = true;
let chunkHash = "a".repeat(64);
let modelStatus = 200;
let modelText = JSON.stringify({ antattUtfall: "maa_avklares", raad: "Du kan bygge uten å søke.", maaAvklares: [] });
let lastPrompt = "";
let lastModelRequest: Record<string, unknown> = {};
const searches: Record<string, unknown>[] = [];
const upstream = createServer(async (request, response) => {
  if (request.url === "/api/tags") return json(response, 200, { models: [{ name: "qwen2.5:7b" }, { name: "qwen3-vl:4b" }] });
  if (request.url === "/api/generate") {
    const body = await readRequestBody(request) as { prompt: string };
    lastModelRequest = body;
    lastPrompt = body.prompt;
    return json(response, modelStatus, { response: modelText });
  }
  if (!pdfAvailable) return json(response, 503, { feil: "Planlagt testfeil" });
  if (request.url === "/dokumenter") return json(response, 200, { count: 3, dokumenter: [
    { documentId: "pdf-bergen", profile: "arealplan", status: "extracted",
      source: { kind: "provided", filename: "b65270000.pdf", canonicalUrl, sha256: "a".repeat(64), retrievedAt: "2026-09-10T10:00:00Z" },
      uploadedAt: "2026-09-10T10:00:00Z", size: 1234 },
    { documentId: "pdf-oslo", profile: "arealplan", status: "extracted",
      source: { kind: "provided", filename: "oslo.pdf", canonicalUrl: "https://oslo.kommune.no/plan.pdf", sha256: "b".repeat(64), retrievedAt: "2026-09-10T10:00:00Z" },
      uploadedAt: "2026-09-10T10:00:00Z", size: 2345 },
    { documentId: "pdf-local", profile: "arealplan", status: "extracted",
      source: { kind: "provided", filename: "r6170063.pdf", canonicalUrl: null, sha256: "a".repeat(64), retrievedAt: "2026-09-10T10:00:00Z" },
      uploadedAt: "2026-09-10T10:00:00Z", size: 3456 }
  ] });
  if (request.url === "/sok") {
    const query = await readRequestBody(request) as Record<string, unknown>;
    searches.push(query);
    return json(response, 200, { count: 3, warnings: ["Kontroller at indeksen dekker hele dokumentet."], treff: [7, 8, 9].map(page => ({
      documentId: query.documentId, chunkId: `${query.documentId}:${page}`,
      title: query.documentId === "pdf-local" ? "Plan 6170063, syntetisk testutdrag" : "Planbestemmelser KPA2018",
      profile: "arealplan", sourceSha256: chunkHash, score: 0.91,
      page, pageType: "content", text: "Byggegrense må avklares med kommunen.", authority: "binding",
      knowledgeStatus: "check-recommended", checkRecommended: true, qualityWarnings: ["Kontroller OCR mot sidebildet."]
    })) });
  }
  json(response, 404, { feil: "Ukjent teststi" });
});
async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  return address.port;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
const children: ChildProcess[] = [];
let logs = "";
async function start(app: string, env: Record<string, string>) {
  const reservation = createServer();
  const port = await listen(reservation);
  await close(reservation);
  const child = spawn(process.execPath, [`apps/${app}/src/server.ts`], {
    env: { ...process.env, ...env, PORT: String(port), STATE_DIR: `${process.cwd()}/${stateDir}` },
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.push(child);
  child.stdout?.on("data", data => { logs += data; });
  child.stderr?.on("data", data => { logs += data; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/helse`, { signal: AbortSignal.timeout(300) })).ok) return base;
    } catch (error) {
      if (child.exitCode !== null) throw new Error(`${app}: ${String(error)}\n${logs}`);
    }
    await wait(50);
  }
  throw new Error(`${app} startet ikke:\n${logs}`);
}
async function post(base: string, route: string, body: unknown) {
  const response = await fetch(`${base}${route}`, { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  const result = await response.json() as Record<string, any>;
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
}
try {
  await mkdir(stateDir, { recursive: true });
  const upstreamUrl = `http://127.0.0.1:${await listen(upstream)}`;
  const ai = await start("ai-gateway", { AI_PROVIDER: "mock", OLLAMA_BASE_URL: upstreamUrl, OLLAMA_MODEL: "qwen2.5:7b", AI_TIMEOUT_MS: "1000" });
  const tools = await start("tools-api", { AI_BASE_URL: ai, PDF_EXTRACTOR_BASE_URL: upstreamUrl });
  const agent = await start("process-agent", { TOOLS_BASE_URL: tools });
  const projectedZones = projectTiltakshjelpenPlanflater({
    punkt: { lat: 1, lon: 1 },
    kilder: [{ id: "planflater", navn: "KPA2018", status: "ok", uttrekksaar: 2018 }],
    planflater: [
      { kategori: "hensynssone", datasett: "stoy", sonekode: 220, sonenavn: "H220_1", navn: "Gul støysone",
        hensynstype: "stoy", planId: "65270000", berorer: "delvis",
        ringer: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]] },
      { kategori: "arealformaal", datasett: "arealformaal", sonekode: 5100, navn: "LNF", arealstatus: 1,
        planId: "65270000", berorer: "delvis", ringer: [[[2, 0], [4, 0], [4, 4], [2, 4], [2, 0]]] }
    ]
  });
  const context = {
    resultater: { "garasje-vurdering": { vurdering: { ...uavklart, uavklarteForhold: manyConditions },
      grunnlag: { adresse: { kommunenummer: "4601" }, ...projectedZones } } }, prosjekt: { bya: 49 }
  };
  const ask = () => post(agent, "/agent/garasje/raad", { kontekst: context });
  const mock = await ask();
  assert.equal(mock.modell, "mock");
  assert.equal(mock.tenkte, false);
  assert.match(mock.advarsel, /Mock/);
  assert.deepEqual(mock.maaAvklares, manyConditions);
  assert.equal(mock.dokumentkunnskap[0].page, 7);
  assert.equal(mock.dokumentkunnskap[0].canonicalUrl, canonicalUrl);
  assert.equal(mock.dokumentkunnskap[0].sourceSha256, "a".repeat(64));
  assert.match(mock.kunnskapsadvarsel, /indeksen dekker/);
  assert.equal(mock.dokumentkunnskap[0].scopeVerified, false);
  assert.equal(searches.at(-1)?.documentId, "pdf-bergen");
  const dialogue = await post(agent, "/agent/garasje/dialog", { feltId: "bya", tekst: "Hva er byggegrensen?", kontekst: context });
  assert.equal(dialogue.type, "sporsmaal");
  assert.equal(dialogue.dokumentkunnskap[0].page, 7);
  assert(!Object.hasOwn(dialogue, "svar"));
  await post(ai, "/admin/provider", { provider: "ollama" });
  const unsafe = await ask();
  assert.equal(lastModelRequest.model, "qwen2.5:7b");
  for (const option of ["think", "reasoning", "reasoning_effort", "chat_template_kwargs"]) {
    assert(!Object.hasOwn(lastModelRequest, option), `Qwen2.5 skal ikke få tenkeinnstillingen ${option}`);
  }
  assert.equal(unsafe.tenkte, false, "En reasoning-oppgave med Ollama rapporterer uten tenking");
  assert.equal(unsafe.antattUtfall, "maa_avklares");
  assert.doesNotMatch(unsafe.raad, /du kan bygge uten å søke/i);
  assert.match(unsafe.overstyrt, /erstattet/);
  assert.match(lastPrompt, /Byggegrense må avklares med kommunen/);
  assert.match(lastPrompt, /"page":7/);
  assert.match(lastPrompt, /"planbestemmelserKontrollert":false/);
  assert.match(lastPrompt, /"sonenavn":"H220_1"/);
  assert.match(lastPrompt, /"navn":"LNF"/);
  assert.match(lastPrompt, /"punktIFlate":true/);
  assert.match(lastPrompt, /"punktIFlate":false/);
  assert.match(lastPrompt, /"planflatekilde":\{"id":"planflater","status":"ok"/);
  assert.doesNotMatch(lastPrompt, /"ringer"|"coordinates"|"lat"|"lon"/);
  const combined = await post(agent, "/agent/garasje/raad", { kontekst: {
    ...context, resultater: { "garasje-vurdering": {
      vurdering: uavklart, grunnlag: { adresse: { kommunenummer: "4601" },
        reguleringsplaner: [{ planId: "6170063", navn: "Lokal plan" }] }
    } }
  } });
  assert.equal(combined.dokumentkunnskap.length, 3);
  assert.deepEqual([...new Set(combined.dokumentkunnskap.map((hit: { documentId: string }) => hit.documentId))],
    ["pdf-bergen", "pdf-local"]);
  assert.match(combined.kunnskapsadvarsel, /Viser 3 av 6 hentede utdrag/);
  assert.match(lastPrompt, /"documentId":"pdf-bergen"/);
  assert.match(lastPrompt, /"documentId":"pdf-local"/);
  modelText = "Oppgi den samlede høyden inkludert sokkel. Avklar usikre opplysninger med kommunens byggesaksveileder.";
  const fenceHelp = await post(agent, "/agent/garasje/dialog", {
    tiltakstype: "gjerde", feltId: "hoyde", tekst: "Hvordan måler jeg gjerdet?",
    kontekst: { ...context, prosjekt: { hoyde: 1.5, bya: 50, monehoyde: 4 } }
  });
  assert.equal(fenceHelp.type, "sporsmaal");
  assert.match(lastPrompt, /"nasjonaleKrav"\s*:\s*null/);
  assert.doesNotMatch(lastPrompt, /sak10-frittliggende-bygning/);
  assert.doesNotMatch(lastPrompt, /"monehoyde"\s*:\s*4/);
  assert.match(lastPrompt, /"tiltakstype"\s*:\s*"gjerde"/);
  assert.match(lastPrompt, /H220_1/);
  assert.match(lastPrompt, /"navn"\s*:\s*"LNF"/);
  const failedZoneAdvice = await post(agent, "/agent/garasje/raad", { kontekst: {
    resultater: { "garasje-vurdering": { vurdering: uavklart, grunnlag: {
      adresse: { kommunenummer: "4601" },
      ...projectTiltakshjelpenPlanflater({ planflater: [], kilder: [{ id: "planflater", status: "feil", merknad: "Kilden svarte ikke." }] })
    } } }
  } });
  assert.match(failedZoneAdvice.kunnskapsadvarsel, /tom liste betyr ikke/);
  assert.match(lastPrompt, /"status":"feil"/);
  assert.match(lastPrompt, /Kilden svarte ikke/);
  modelText = "ikke gyldig JSON";
  const malformed = await ask();
  assert.equal(malformed.modell, "regelbasert-reserve");
  assert.match(malformed.advarsel, /ugyldig/);
  modelStatus = 503;
  const failed = await ask();
  assert.equal(failed.modell, "regelbasert-reserve");
  assert.deepEqual(failed.maaAvklares, manyConditions);
  chunkHash = "b".repeat(64);
  const stale = await ask();
  assert.equal(stale.dokumentkunnskap.length, 0);
  assert.match(stale.kunnskapsadvarsel, /kildehashen ikke stemmer/);
  pdfAvailable = false;
  const noDocs = await ask();
  assert.equal(noDocs.dokumentkunnskap.length, 0);
  assert.match(noDocs.kunnskapsadvarsel, /utilgjengelig/);
  assert.match(noDocs.raad, /byggesaksveileder/);
  const health = await (await fetch(`${ai}/helse`)).json() as Record<string, unknown>;
  assert(Object.hasOwn(health, "visionModel") && Object.hasOwn(health, "reasoning"));
  console.log("Tiltakshjelpens råd: agent, dokumentavgrensning, kildehenvisninger, mock og eksplisitte reservesvar besto.");
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  for (const child of children.reverse()) {
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, "exit");
      child.kill("SIGTERM");
      await stopped;
    }
  }
  if (upstream.listening) await close(upstream);
  await rm(stateDir, { recursive: true, force: true });
}
