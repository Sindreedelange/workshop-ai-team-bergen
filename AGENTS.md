# AGENTS Guide

> **The maintainer document, for agents changing the sandbox itself.** If you are a
> hackathon participant, `docs/oppdraget.md` is your starting point - you do not
> need to read this file, and nothing here is part of the participant materials.
> One exception: `CLAUDE.md` is `@AGENTS.md`, so in a fork this file is loaded for a
> participant's agent as well, and
> [New use-cases](#new-use-cases-diverge-before-you-build) is written for that case.

## Contents

<details>
<summary>All sections</summary>

- [What this repo is](#what-this-repo-is)
- [New use-cases: diverge before you build](#new-use-cases-diverge-before-you-build)
- [Service map (compose defaults)](#service-map-compose-defaults)
- [Data and state model (important)](#data-and-state-model-important)
- [Process-engine behavior to preserve](#process-engine-behavior-to-preserve)
- [Adding a new case: what the last one taught](#adding-a-new-case-what-the-last-one-taught)
- [Language](#language)
- [Project conventions you must follow](#project-conventions-you-must-follow)
- [Frontend: the KS Digital design system](#frontend-the-ks-digital-design-system)
- [Developer workflows](#developer-workflows)
- [Integration edges and env vars](#integration-edges-and-env-vars)
- [Matrikkel integration pattern](#matrikkel-integration-pattern)
- [Useful places before editing](#useful-places-before-editing)

</details>

## What this repo is
- `workshop-ai` is a municipal-dialog sandbox: process-driven user flows over synthetic data, with explicit consent, policy checks, and audit trail.
- Services are intentionally split by responsibility (UI, orchestration, mocks, AI, tools, agent) and communicate over HTTP, not shared internal libraries.

## New use-cases: diverge before you build

This section is for an agent helping a hackathon participant build something new. The
rest of the file is unchanged and still the maintainer document.

**A new use-case does not start by copying an existing one.** The pull is strong, and
this repo creates it: `docs/prosessmodell.md` says to copy `mal-enkel-soknad`,
`docs/bygg-selv.md` says to copy an existing service, and every demo case walks the
same road: `INFO` -> `DATA_FETCH` -> `CONSENT_REQUEST` -> `DATA_FETCH` -> `SJEKK` ->
`SUMMARY` -> `SUBMIT`. Those are recipes for the plumbing, not a template for the
idea. `docs/oppdraget.md` says the same thing to the participant: the demo clients
look like an answer to what to build, and they are not.

So when a participant asks for a new case, a new service or a new frontend and has not
settled what it should be, **do not write code on the first turn**. Read what the
sandbox actually offers, ask one question at a time, put up directions that genuinely
differ, and let the participant choose before anything is built.

`.claude/skills/nytt-bruksomraade/SKILL.md` carries the procedure and the axes the
alternatives have to differ on. Follow it. Skip it when the participant has already
decided. The rule is against building the default unexamined, not against
building. Once it is decided,
[Adding a new case: what the last one taught](#adding-a-new-case-what-the-last-one-taught)
is the list of checks the last case turned out to need.

What gets reused is the floor, not the shape: the frozen wire format, the consent
gate, rules outside the model, and the audit trail. What must not be assumed is the
rest: that the engine is linear, that a flow has seven steps, that the interface is a
chat, or that every service is a søknad.

## Service map (compose defaults)
- `apps/process-builder` (`3000`): process definition UI.
- `apps/demo-gui` (`3001`): dashboard at `/`, then three citizen-facing entrances -
  `/chat`, `/agent` and `/stegvis`. Shares `apps/shared/felles.css` and `client/felles.ts`
  with `process-builder`. The stylesheet is served at `/assets/*`; `felles.ts` is at
  `/delt/felles.ts`, type-stripped on the way out, because it is code rather than a
  static asset.
- `apps/sandbox-backend` (`8080`): core process/session engine, data access, policy + audit.
- `apps/fiks-simulator` (`8081`): mock external integrations (consent/tasks/register-like endpoints).
- `apps/matrikkel-mock` (`8085`): mock of Kartverket Matrikkel Geointegrasjon BasisService (SOAP + REST helpers). Runs from the shared `node:24-alpine` image on the same `./:/workspace` bind mount as every other service; `apps/matrikkel-mock/Dockerfile` exists only for running it standalone.
- `apps/pasientjournal-mock` (`8087`): mock of an elektronisk pasientjournal, serving the legeerklæringer the TT-kort case is assessed against. **This integration does not exist in reality** - a journal is owned by the virksomhet that provided the care, there is no national API for a legeerklæring, and today the citizen carries a stamped PDF and uploads it. The mock is the structured form of that attachment, and its README says so first. Two things are deliberate: `fnr` is required, so the surface never answers a bulk query, and it is behind Maskinporten rather than ID-porten - real health data sits behind HelseID at Norsk helsenett, which the sandbox does not have. The only *service* that reads `data/legeerklaeringer.json`; the gate reads it too.
- `apps/brreg-mcp`, `apps/folkeregister-mcp` (no port): **these two are real MCP** - JSON-RPC 2.0 over stdio, newline-delimited, verified against `@modelcontextprotocol/inspector`. They are standalone servers for an external client (Claude Code, Cursor) to spawn; nothing in the sandbox talks to them. In particular `tools-api` does **not** - it reads the same `data/brreg.seed.json` and `data/folkeregister.seed.json` off disk and exposes its own REST equivalents, so the four brreg/folkeregister tools exist twice, in two protocols. Their compose entries only keep the containers alive on an idle stdin; they are not a dependency of anything.
- `apps/politiattest-mock` (`8088`): mock of a politiattest, serving the attest the vandelskontroll case is assessed against. **This integration does not exist in reality** - there is no API for a politiattest, the attest is a locked PDF with no machine-readable content, it is issued to the citizen rather than to the kommune, and nobody can look it up. The mock is the structured form of the document the citizen presents, and its README says so first. It does not model politiets reaksjonsregister: it answers only for attests already issued for a stated formål. Three things are deliberate: `fnr` is required, so the surface never answers a bulk query; `formaal` is required too, because an attest exists for one purpose and a lookup without one is «what does this person have on them»; and it is behind Maskinporten rather than ID-porten. The only *service* that reads `data/politiattester.json`; the gate reads it too.
- `apps/ai-gateway` (`8082`): AI provider abstraction (`mock|ollama|openrouter|bedrock`). Switch live, no restart, at `GET /admin` (or `POST /admin/provider`) - persisted to `state/ai-provider-override.json`, which overrides `AI_PROVIDER`/`BEDROCK_MODEL_ID` on next boot. Also exposes `POST /ai/velg-verktoy` for dynamic step-tool discovery.
- `apps/tools-api` (`8083`): 25 tool endpoints wrapping backend + AI + matrikkel, over REST. Includes `suggest_step_tools`, `matrikkel_finn_veger`, `matrikkel_hent_eiendom`, `matrikkel_hent_eiere`. The catalogue is `GET /verktoy`; a tool is invoked over `POST /verktoy/invoke` or `POST /verktoy/{name}/invoke`.
- `apps/process-agent` (`8084`): agent API using the tool endpoints. Discovers which tools to call per step via `suggest_step_tools` - but **also carries hardcoded shortcuts** for the `fartsdempende-tiltak` case: step ids `velg-gate`, `hent-gate`, `boliger-bekreft` and `begrunnelse`, plus the tool name `matrikkel_finn_veger`. The dynamic path is real; it is not the only path.

## Data and state model (important)
- **Six files under `data/` are generated and must not be hand-edited:**
  `personer.json`, `husstander.json`, `inntekter.json`, `krr.json`,
  `folkeregister.seed.json` and
  `eierforhold.json`. `scripts/importer-tenor.ts` builds all six, plus
  `docs/testpersoner.md`, from two sources: `data/kuratert.json` (the 51 hand-authored
  threshold fixtures) and `data/tenor/*.json` (the raw extracts). Edit a curated row in
  `personer.json` directly and the next import reverts it - so `pnpm test` compares the
  curated rows against `kuratert.json` and fails instead.
- The import **rebuilds**; it used to be additive, which meant a second run was a no-op
  and the data could only grow, never be cleaned. Ids stay stable because `personId` and
  `husstandId` are read back from `personer.json` as a ledger; `--glem-id-er` assigns
  from scratch and gives the same result on unchanged input.
- **A rule that more than one caller needs lives in one module, and that module lives
  in `apps/shared/`** - `alder.ts`, `foedselsnummer.ts` (modulus 11 and Skatteetaten's
  +80 synthetic marker), `handleevne.ts` (who may act, and on whose behalf),
  `skjerming.ts` (masking), `samtykke.ts` (the samtykke kodeverk and expiry),
  `legeerklaering.ts` (the shape of a legeerklæring, and which one is the current
  one - read by the journal mock, the backend and the gate), `politiattest.ts` (the
  shape of a politiattest, its four kodeverk, and which attest applies for a formål),
  `hjemmel.ts` (the short title each act this sandbox cites actually has, and the
  spellings that are quotations - see Language point 5). None of
  them may import `regler.ts`. `vilkaar.ts` (the vedtak) is the same kind of module but
  stays in `sandbox-backend`: only the backend and the gate read it.
- Seed/reference data lives in `data/*.json` (tracked, read-only during normal runs).
- Runtime mutations go to `state/*.json` (gitignored), so demos do not dirty the repo.
  `_backup/` is the exception, deliberately left out of `.gitignore` so the KI-spor can
  leave the machine.
- `readJson` (`apps/shared/jsonstore.ts`) reads `state/` first and falls back to
  `data/`. `./start.sh --reset` copies `state/` to `_backup/`, then clears it.
- **Every write to a *shared* file under `state/` goes through `updateJson`** in that
  same module, which does the whole read-modify-write inside one queue. The store
  exports no plain writer at all, and that is deliberate: writing a copy the request
  read earlier is the lost update that cost this repo a søknad, a prosess and a
  participant's step, in four separate places. A guard that has to be remembered is not
  a guard. `pnpm test:concurrency` pins it for `prosessoekter.json`, `soknader.json`
  and `prosessdefinisjoner.json`, and   `pnpm test:samtykke` for `samtykker.json`.
  Mutations of the same prosessøkt additionally compare `oppdatert` inside that
  queue; a request holding an older snapshot gets 409 instead of restoring stale
  answers or results. `pnpm test:concurrency` races that case directly.
  Two files stay outside the store and may: `state/ai-provider-override.json`
  (`ai-gateway`) and `state/digdir-nokkel.json` (`digdir-mock`) have exactly one writer
  each, in one service, so there is no second reader to lose an update to.
- **The whole repo is TypeScript** - every service, every script, and the browser
  code. There is no build step: Node type-strips `.ts` on load, and the two frontends
  strip the client files at serve time (`apps/shared/assets.ts`). `tsconfig.json`
  has no `allowJs`, so a `.js` file imported from `.ts` is a compile error.
- `apps/sandbox-backend` is split into modules (`routes.ts`, `prosess.ts`,
  `ressurser.ts`, `vilkaar.ts`, `regler.ts`, `state.ts`, `revisjon.ts`, `types.ts`, `routing.ts`,
  `errors.ts`, `upstream.ts`, `config.ts`). `server.ts` only wires up the HTTP server.
- **`apps/shared/` is the shared layer, and it is below every service.** It was called
  `shared-ui` while it only held frontend files; it now holds backend plumbing and the
  domain leaves as well, so the name was a claim it had stopped meeting. Two modules are
  used by every service: `http.ts` (CORS, JSON and text responses, request bodies - the
  CORS policy is a parameter, because the six copies it replaced had drifted apart) and
  `errors.ts` (`feilmelding`/`feilkode` for caught `unknown`). The rest are used by
  whoever needs them: `assets.ts` (static files and type stripping - the two frontends),
  `registerdata.ts` (the shapes of `brreg.seed.json` and `folkeregister.seed.json` -
  `tools-api`, `fiks-simulator`, `matrikkel-mock` and `skjerming.ts`),
  `geometri.ts` (the map extent, the GeoJSON guards and the ray cast - the rule and
  the browser both answer whether a point is inside a flate, which is the reason it
  is one module and not two),
  `hensynssoner.ts` (the KPA2018 sone kodeverk, the datasett ids and the wire shape -
  which ArcGIS layer each dataset is lives with the kommune registry, in
  `apps/shared/tiltakshjelpen-kommuner.ts`),
  `innbyggerdata.ts` (the shapes of `personer.json`,
  `husstander.json`, the two plass-datasets and `samtykker.json` - `sandbox-backend` and
  `fiks-simulator`), `jsonstore.ts` (`seedDir`/`stateDir`, `readJson`, `updateJson` - the
  state I/O above and the one write queue that replaced three copies of it), the
  domain modules above, and `statemachine.ts` under `samtykke.ts`.
- **The arrows between apps form a DAG, and `pnpm test:imports` fails if they stop.**
  `sandbox-backend` and `fiks-simulator` used to import each other - the backend took the
  samtykke kodeverk from fiks, fiks took masking, fødselsnummer validation and its
  `Person` type from the backend - and `sandbox-backend` and `digdir-mock` had the same
  knot, one leaf wide. Every single arrow was locally right: importing the rule beats
  keeping a second copy of it. The defect existed only in the sum, which is why no
  reviewer caught it in a diff and why it is checked instead of remembered. What the
  check bans is the arrow *back*, not the arrow: four services get their token client
  from `digdir-mock`, which owns the protocol, and that is what a service boundary is
  for. `apps/shared` additionally must import nothing from any app - a shared layer that
  reaches back into a service is beside the services, not below them, and drags whatever
  it touched into every test.
- **Browser code lives in a `client/` directory, and each one has its own
  `tsconfig.json`** extending `tsconfig.client-base.json` (DOM lib, no `@types/node`,
  `moduleDetection: "legacy"`). The root config excludes `**/client/**`.
  The per-directory configs are not cosmetic: tsserver - the language service behind
  IntelliJ, WebStorm and VS Code - picks a file's project by walking up for a file
  named exactly `tsconfig.json`. A single `tsconfig.client.json` at the root was
  invisible to it, so every editor put the client files in an inferred project and
  reported `Cannot find name renderTopNav` on every line that used felles.ts.
  Each app's client config must include `../../../shared/client/**/*.ts` too:
  `felles.ts` is a classic script, so its declarations are global rather than
  imported, and they only resolve inside the same program.

## Process-engine behavior to preserve
- Flow is definition-driven (see `data/prosessdefinisjoner.json`), not UI-hardcoded.
- Seven step types exist (`apps/sandbox-backend/src/types.ts`): `INFO`, `QUESTION`,
  `DATA_FETCH`, `CONSENT_REQUEST`, `SJEKK`, `SUMMARY`, `SUBMIT`. There is no `CONFIRMATION`.
- Actual sequence in the flagship case `redusert-foreldrebetaling-barnehage`:
  `INFO` -> `DATA_FETCH` -> `CONSENT_REQUEST` -> `DATA_FETCH` -> `SJEKK` -> `SUMMARY` -> `SUBMIT`.
- The forward path is linear: `/neste` increments `stegIndex` only after the active
  step is complete. There is no branching or conditional jump, and `/neste` never
  executes a step. `/forrige` is the explicit way back. `/svar` accepts only the
  active `QUESTION`; when a changed answer is saved after moving back, every later
  answer and result is deleted so stale data cannot complete those steps. Rerunning
  an action also clears its previous result and all later evidence before the attempt.
  Only one `/handling` may run per økt at a time, so concurrent SUBMIT calls cannot
  duplicate the søknad before completion is saved. Other mutation routes return 409
  while that action runs, so navigation cannot move the økt out from under it.
- `SJEKK` is a deterministic rules evaluation in the backend. Decisions must stay
  reproducible and auditable - never move eligibility logic into the model. The model
  formulates (`SUMMARY`); it does not compute or decide.
- **`VANDELSKONTROLL` answers three ways, and that is the point.** `godkjent` and
  `krever_manuell_vurdering` both let the søknad through - the second because an
  anmerkning that no statute excludes outright is an egnethetsvurdering a person makes,
  so the engine must not decide it. Only the outcomes the law decides are decided here.
  `grunnlag.vandelsutfall` names the branch, and `scripts/valider-data.ts` counts the
  six branches from it rather than mirroring the rule.
- **The politiattest read is minimised before anything else sees it.** `minimerAttest`
  in `apps/sandbox-backend/src/politiattest.ts` returns type, date and a count, never
  what the anmerkninger are about. The `DATA_FETCH` result is stored on the session and
  goes into the `SUMMARY` prompt and `state/ai-trace.jsonl`; straffedommer are artikkel
  10-opplysninger and do not need to pass through a model to be phrased. The rule reads
  the whole attest; every other caller reads the minimised view. `pnpm test:vilkaar`
  pins that the grunnlag carries no category.
- **Eligibility logic lives in one place: `vilkaar.ts`.** `evaluateVilkaar` is the only way
  in; `regelHandlers` is private, so a new rule type does not widen the interface. The
  module is pure and synchronous - the income basis arrives as a parameter - so an outcome
  can be pinned with a literal `tilstand` object and no running services. `regler.ts` is
  the I/O half (the Fiks beregning, the samtykke predicates) and `vilkaar.ts` must never
  import it back: that arrow is what keeps a rules test from paying for a 2048-bit RSA
  keypair at module load.
  **`scripts/valider-data.ts` imports the rule rather than mirroring it.** It used to
  carry its own copy of every rule, so `data/forventet-utfall.json` - the pinned
  outcomes the workshop text rests on - was validated against the copy. Never reintroduce
  a second implementation for the gate's convenience, and never regenerate
  `forventet-utfall.json` from the rules: an oracle derived from what it tests cannot
  fail. `alderVed` lives in `alder.ts` for the same reason, shared by the rules, the gate
  and `scripts/importer-tenor.ts`.
- Consent gating is enforced before protected data reads; do not bypass this in UI or agent logic.
- A citizen may ask a free question at any point (`POST /ai/sporsmaal`). That path is
  **stateless by design**: it never calls `/svar`, `/handling` or `/neste`, and it never
  changes `stegIndex`. The flow pauses and is redisplayed; it does not move. Keep it that
  way - the engine is linear, so a question mistaken for an answer is unrecoverable.
- The audit entry for a consented read records the purpose from the **consent**, not the
  catalogue label. Purpose limitation is the reason consent was asked for.
- Consent gating and audit are enforced centrally in `runRessurs()`
  (`apps/sandbox-backend/src/ressurser.ts`), not per route. One catalog entry is
  simultaneously an HTTP endpoint, a valid `DATA_FETCH` target and a valid `SJEKK`
  target. Do not route around this.
- **What a non-ok answer from another service means is decided in one place:
  `upstream.ts`.** `callUpstream` raises the failure as ours, `tryUpstream` hands it
  back so a best-effort call can degrade into an advarsel - and no fetch in the
  engine is awaited anywhere else. Four readings of the same status existed before
  it, each locally reasonable: the samtykke calls raised the upstream status, the
  beregning threw a plain Error and so reported «Intern feil i sandbox-backend» for
  a Fiks that broke, the Fiks task looked only at `ok` so a 403 was silence where an
  unreachable Fiks was an advarsel - and `matrikkel.ts` had it right, alone. Three
  were wrong; the fourth is now the shared one.
  The rule: no contact, a 5xx, or a body that is not JSON is 502 - the last of those
  used to be a SyntaxError thrown from inside the failure path. A 4xx is passed
  through only where the call sets `relayStatus`, which the two samtykke calls do
  because there the upstream is judging the citizen's own request. The beregning and
  the matrikkel lookups do not: Fiks refusing our machine token is our
  infrastructure problem, and answering 403 for it would collide with the 403 this
  backend uses for «samtykke mangler». `pnpm test:upstream` pins all of it,
  including that the call sites still hand their fetches over.
  **One caller retries, and only a timeout.** `readJson` in `tiltakshjelpen-data.ts` sends a
  map lookup twice, four seconds then eight, because Bergen's building layer answers
  in about 120 ms and then occasionally not at all: measured from a container, the
  tail runs 2.6 to 4.7 seconds and sometimes past the ceiling. That made «Bebygd
  eiendom» - a condition SAK10 § 4-1 bokstav a requires - go unresolved a few times
  an hour, so a tiltak that met every condition got «må avklares» instead of the
  exemption. The retry wraps the *send*, not `callUpstream`, so what a non-ok answer
  means is still decided once, on the final outcome; a 4xx, a 5xx or a body that is
  not JSON is the source answering and is never repeated. A timeout also gets its own
  citizen-facing sentence, because that string ends up in `kilde.merknad`: «svarte ikke
  i tid» and «kjør sjekken på nytt» is both truer and actionable where «kunne ikke
  levere et gyldig svar» reads as a broken source. `pnpm test:tiltakshjelpen` pins the retry,
  that two timeouts are still a source failure, and that a 502 is not retried.
- Audit events are first-class output (`state/revisjonslogg.json`); keep behavior observable.

## Adding a new case: what the last one taught

This section is about the checks a case needs once it is decided what to build.
[New use-cases: diverge before you build](#new-use-cases-diverge-before-you-build)
is about the step before it, and is the one to read first.

The politiattest case was reviewed end to end after it landed, and the bugs it
turned up were not in the prose - every one of them sat under a paragraph in this
file that described the intended behaviour correctly. What was missing was a check
under the paragraph. Six shapes, all of which recurred:

**A claim about a surface must be checked on every route of it.** This file said
`fnr` is required "so the surface never answers a bulk query". It was required on
`/attester` and not on `/attester/{attestId}`, and the same copy-paste sat in
`pasientjournal-mock`. Note which paragraphs here held up: the ones that end with
"`pnpm test:concurrency` pins it". A claim with no named check is a wish - and this
paragraph was one for a while: the fix landed on the two routes and pinned nothing.
`pnpm test:parametere` now calls every route the specs mark as requiring a query
parameter, once per parameter, with a valid token.

**A check that cannot resolve its subject must fail, not skip.** The `security`
comparison in `sjekk-openapi-dekning.ts` was `if (!rute) continue`, and `rute` was
never set for eight of the nine services - so it passed for years without ever
comparing anything. The scanner now reads the token guard out of the code, and a
route whose guard it cannot recognise is an error rather than an assumed-open
route: openness has to be declared in `aapneRuter`, the way `ikkeRuter` already
works.

**Coverage counted across a group hides a hole in one member.** The six
VANDELSKONTROLL branches were counted across all three ordninger, so barnehage
covered skole's - and `politiattest-skole` turned out to declare an absolute
exclusion no test person ever triggered. Count per member unless there is a stated
reason not to, and then state it. Only `absolutt_utelukkelse` is counted per
ordning today (`scripts/valider-data.ts`, `utelukketPerOrdning`); the other five
branches are still counted across the group, with the reason in a comment beside
them - `stottekontakt` cannot reach an absolute exclusion at all, because the law
leaves every anmerkning there to skjønn.

**A union type over data from a file is documentation, not a check.**
`absoluttUtelukkelse?: Anmerkningskategori[]` is erased at runtime. Validate the
kodeverk in `scripts/valider-data.ts` on **every** file the rule reads, not just
the one that looks like the data - `satser.json` is as much an input as
`politiattester.json`.

**A kodeverk nobody reads is a claim the code does not honour.** `REAKSJONER`
exists because only a conviction excludes from a job, and `reaksjon` had one
occurrence in `apps/`: its own type declaration. `pnpm test:kodeverk` pins that
every kodeverk in `apps/shared` has a field someone actually reads.

**Dates are arithmetic on the ISO string, never `new Date()` plus the local
getters.** Every runner and container is UTC, so this class is invisible in CI by
construction - and it bites the machines that are not: parsing as UTC, computing
with the local setters and going back out through `toISOString()` made
`byggAttestbevis` write an expiry one day early in Europe/Oslo, and right in CI.
Use `alderVed` and `maanederEtter` in `apps/shared/alder.ts`; CI now runs the
rules once in Norwegian time. `pnpm test:vilkaar` pins the month boundaries
`maanederEtter` exists for - the 30th, the 31st, a leap February and a year
rollover - because every date in the vandel block happened to be a safe one, so a
regression to `setMonth` semantics was green.

The one operation string arithmetic cannot do is the inverse: turning an *instant*
into a Norwegian calendar field, because that needs a timezone. `norskKalenderaar`
in the same module is the one place it happens, and it reads `Europe/Oslo`
explicitly rather than the host's zone - `new Date().getFullYear()` in
`sisteInntektsaar` answered last year's number for a Norwegian citizen for the hour
between 23:00 UTC and midnight on New Year's Eve, and no test in UTC could see it.
That is the only local-getter site the repo had. `pnpm test:vilkaar` pins the
boundary from both sides and fails on the naive version even under `TZ=UTC`.

One more, from the same review and not on the list above because it is about
runtime rather than about a check: **a gate is time-of-read, not time-of-fetch.**
`DATA_FETCH` results were consent-gated when they were fetched and then re-served
on every later read of the økt, so a withdrawn consent changed nothing. The raw
field is called `resultaterRaa` for that reason, and nothing outside
`resultaterNaa` reads it: the økt response, the `SUMMARY` prompt and the
søknadsdokument are all handed the gated view, `buildProsessoektRespons` and
`buildSoknadsdokument` require it as a parameter, and a fourth reader that skipped
the gate would not compile. Which steps the gate covers is `erKatalogsteg`, not a
list of step types - a list had `SJEKK` missing, and the vilkårsvurdering carries
the income in its own grunnlag.

**A step that derives from a gated result is gated too, and that is not the same
test.** `SUMMARY` has no `api`, so the catalogue cannot answer for it - and its text
is written *from* the gated results and quotes the income in plain words, more than
the `SJEKK` grunnlag carries. It is therefore held behind the union of every kilde
the process needs consent for. `SUMMARY` and `SUBMIT` additionally refuse with 403
when anything was gated away, before the model is called: a summary or a
søknadsdokument built on a withdrawn basis is a record that does not say what the
decision rests on, and the honest answer is to stop rather than to emit a partial
one. `pnpm test:revisjon` pins all of it.

- **En hensynssone navngis, den avgjør ikke.** Sjekken `hensynssoner` i
  `evaluateTiltakshjelpen` er alltid `uavklart`, og den står etter at `nasjonaltUnntak` er
  regnet ut, så den kan ikke flytte `utfall`. Grunnen er ikke forsiktighet: en
  hensynssone hjemlet i plan- og bygningsloven § 11-8 sier at et hensyn gjelder for
  området, mens om tiltaket er tillatt står i planbestemmelsene, som piloten ikke
  leser - og de leses ikke. Det samme gjelder
  `arealformaal-flate`. `pnpm test:tiltakshjelpen` pinner at et treff ikke endrer utfallet.
  Med én tilføyelse, som går den andre veien: en **faresone** holder tilbake
  `meldeplikt`-fritaket under, fordi et fritak er en påstand om at alt som gjelder er
  kontrollert. Hvilke sonetyper det gjelder står i `soneHindrerFritak` i
  `apps/shared/hensynssoner.ts`, hos kodeverket som eier hva en sone betyr, slik at
  en ny sonetype tvinger et svar i stedet for å arve et nei fra en
  strengsammenligning i regelen. Sonen kan altså ikke gjøre et tiltak søknadspliktig, men den kan hindre
  at det blir fritatt. Støysoner og angitte hensyn stopper ikke fritaket; de navngis i
  sjekkens tekst i stedet. `pnpm test:flytkart` pinner begge retninger.
- **`meldeplikt` er det ene fritaket piloten gir, og det ligger bak en hviteliste.**
  Fagpersonens flytkart har en grønn boks for frittstående bygning: «Du trenger ikke å
  søke, men må melde inn etter du er ferdig å bygge.» `vurderMeldeplikt` i
  `apps/sandbox-backend/src/tiltakshjelpen.ts` er den boksen, og vilkårene er en hviteliste og
  ikke «ingen sjekk er uavklart» - sjekkene for kommuneplan, reguleringsplan og
  hensynssoner er uavklarte ved design, så et krav om at ingenting er uavklart ville
  aldri slått til. Hvert ledd har en grunn ved seg, og hvert ledd som kan felle et
  kall alene har et avvisende tilfelle i `pnpm test:flytkart` - `frittliggende` kan
  ikke, fordi kommuneplanvilkåret bare gjelder den grenen, og leddet står for at
  hvitelisten skal si hva den krever. To følger er verdt å kjenne: fritaket kan i dag bare oppstå i
  LNF, fordi KPA2018 § 31.3 er den eneste planbestemmelsen piloten faktisk
  kontrollerer, og utfallet varierer mellom to ellers like kall når kommunens
  bygningskart ikke svarer - manglende kunnskap er aldri et fritak.
  `ikke_soknadspliktig` finnes fortsatt i kodeverket og er fortsatt uoppnåelig: et
  fritak uten en plikt til å melde inn har piloten ingen hjemmel til å gi.
- **Klemmen i `tiltakshjelpen-raad.ts` leser modellens egne setninger, ikke regelens sitat.**
  Den hindrer modellen fra å gjøre utfallet mildere enn reglene, og den leser hele
  prosaen og ikke bare utfallsfeltet. Da den leste *alt*, traff den reglenes egne
  forbehold: `hensynssoner` sier ordrett at sonen «sier at et hensyn gjelder for
  området, ikke om tiltaket er tillatt», og prompten ber modellen gjenta reglenes
  uavklarte forhold. Målt mot en lokal modell ble rådet derfor byttet ut i fem av sju
  grener, og «før du kan bygge» slo ut på samme måte. `modellensEgenProsa` luker ut det
  som er sitert fra vurderingen, og `harTillatendeProsa` avviser et treff der ordene
  rett foran nekter eller gjør setningen betinget. Grensen mot et mildere utfall er
  uendret. `pnpm test:tiltakshjelpen-raad` pinner begge retninger, inkludert at «du trenger
  ikke søke, og tiltaket er tillatt» fortsatt stoppes.
- **Innbyggeren ser hvilken kilde som hentes mens den hentes.**
  `GET /api/garasje/grunnlag/hendelser` er et søsken til `/api/garasje/grunnlag`
  med de samme parameterne, og svarer med `text/event-stream`: én `kilde`-hendelse
  når et oppslag settes i gang, én til når det er ferdig, og `grunnlag` til slutt.
  Ruten går gjennom `runRessurs` som alle andre katalogsteg - samtykkeporten og
  revisjonssporet håndheves der, og en strømmerute er ikke et unntak.
  **Strømmen åpnes først når noe faktisk skal sendes**, og det er en avgjort
  forskjell og ikke en detalj: åpnet vi den med en gang, ville statuslinjen vært
  skrevet før valideringen kjørte, og en 400, 403 eller 404 hadde blitt en 200 med
  en feilhendelse i - altså en annen feilsemantikk enn JSON-tvillingen for nøyaktig
  samme ressurs. Rekker noe å bli sendt først, er statuslinjen låst, og da går
  feilen som en `feil`-hendelse.
  Statusen `henter` finnes bare på strømmen. Et lagret grunnlag har den aldri.
  Hver kilde som gjør et oppslag melder seg to ganger, også nabokartet: det ligger
  i samme `Promise.all`, så innbyggeren venter på det selv om vilkårene ikke hviler
  på det. `adresse` melder seg én gang, fordi den er hentet før strømmen finnes.
  Klienten hadde tre `setTimeout` på 2,5, 6 og 13 sekunder som byttet ut én
  setning etter en tidsplan kalibrert mot serverens tålmodighet. Den var gjettet:
  kildene hentes i parallell og svarer i ulik rekkefølge, så teksten kunne verken
  si hvilken kilde som var treg eller hvem som allerede hadde svart.
  `pnpm test:tiltakshjelpen` driver nå hendelsene i stedet for klokken - både
  klientens tegning av dem og selve ruten, hendelsesrekkefølgen, at en
  valideringsfeil fortsatt er en JSON-400, og at rammeformatet tåler en kropp med
  linjeskift.
- **Grunnlaget gjenbrukes i tretti sekunder, per eiendom.** Hvert kall vifter ut
  mot de samme seks kildene, og flere kall om samme eiendom følger tett på
  hverandre: sjekken etter kartet, og et nytt oppslag når tiltakstypen bekreftes.
  Verdt å vite om hva gjenbruket **ikke** dekker: plasseringen står i nøkkelen, og
  grensesnittet krever at innbyggeren flytter markøren før plasseringen kan
  bekreftes, så oppslaget for kartet og oppslaget for plasseringen har ulik nøkkel
  og deler aldri svar. Nøkkelen er det som avgjør grunnlaget -
  adresse, gnr/bnr, kommune og plassering - og ikke hele spørringen: `sporingsId`
  og tiltaksopplysningene varierer mellom to kall om samme eiendom. Tiltakstypen
  står med vilje ikke i nøkkelen: grensesnittet henter grunnlaget én gang før typen
  er bekreftet og én gang etter, så med den i nøkkelen bommet gjenbruket alltid på
  det andre kallet. Varslene for typen legges på etterpå, som ren utregning.
  Revisjonssporet lyver ikke om alderen: `kilde.hentet` er tidspunktet kilden
  faktisk svarte. `nullstillFerskeGrunnlag` finnes for testene, som bytter
  oppstrøm mellom to ellers like kall.
- **Planflatene hentes fra kommunens egne kartlag, og avgjørelsen tas på hele
  flaten.** De kom en stund fra et frosset uttrekk klippet til kartutsnittet, fordi
  punktoppslaget ble antatt å være det eneste kommunen svarte på. Det stemte ikke: en
  utsnittsspørring med `returnGeometry=true` gir hele flater fra de samme lagene.
  Ringene som går ut på tråden er likevel klippet til kartutsnittet, og forskjellen
  fra den gamle ordningen er hvor klippingen står: `berorer` er avgjort på hele
  polygonet først, og bare det kartet skal tegne er trimmet etterpå. Ett arealformål
  i LNF er ett polygon over 27 x 40 kilometer, altså 396 kB for et teigutsnitt på 138
  x 200 meter, mot 82 byte klippet. Følgen å kjenne: kantene langs utsnittet er ikke
  sonegrenser, så ingen avstand skal måles mot de tegnede ringene - det gjelder
  tegningen, ikke vurderingen, og `kilde.merknad` sier begge deler.
  **Utsnittssjekken står på featuren, ikke på polygondelen.** ArcGIS svarer med hele
  geometrien til det som treffer utsnittet, og en multiflate har deler langt unna.
  Sto sjekken på delen, ville en enslig del noen hundre meter borte felt hele
  plankilden - og med den hvert fritak `vurderMeldeplikt` kan gi, siden `alleKilderOk`
  er en hviteliste.
  Tre ting til er verdt å vite om oppslaget, og hver av dem har en sjekk i
  `pnpm test:tiltakshjelpen`. **Gruppelag kan ikke spørres**: faresone og støysone er
  grupper hos kommunen, så barnelagene spørres hver for seg - et gruppelag i
  laglisten ville feilet i kjøring framfor i gjennomlesning. **Esri legger flere ytre
  ringer i samme feature**, så svaret deles i polygondeler på fortegnet til arealet;
  uten det leses den andre flaten som et hull, og «helt» gjelder grunn sonen ikke
  dekker. Og **flatene forenkles** med `maxAllowableOffset` til om lag to meter: et
  utsnitt på tre kilometer ga 5,8 MB uten, og 536 kB med. Det er ekte sonegrenser,
  men ikke oppmålte, og den setningen står i `kilde.merknad` innbyggeren ser.
  **Lagoppsettet huskes** mellom oppslag, ellers ville tretten sonelag tatt ett
  grunnlagskall fra rundt 13 til rundt 35 utgående forespørsler.

## Language

One rule, here, for every word written in this repo. `CONTRIBUTING.md`,
`.github/copilot-instructions.md`, `docs/designsystem.md` and
`.claude/skills/ksd-designsystem/SKILL.md` name the ban and point here.

**No prose file owns a list of field names.** `openapi/*.yaml` does. Prose may show a
handful as examples, never as the list: a pointer saying "never rename a wire field"
cannot drift, while one saying "`melding`, `feil`, `grunnlag`" can, and did. The rule
used to live in six files carrying four different versions of the same list.

Be precise about what that buys you. `pnpm test:openapi` compares routes, methods,
`security` and the kodeverk enums against the code, in both directions. It does **not**
compare response field names, so the specs are the best list there is rather than a
checked one. Trust them over any prose copy, and read the code when it matters.

### 1. Prose or identifier. Decide this first, every time.

**Prose** is what a human reads as language: markdown, code comments, and string
literals that are printed, rendered or logged.

**Identifier** is everything else: variable, function and type names, file and directory
names, JSON keys, URL paths, query parameters, header names, enum and status values,
kodeverk, process and step ids, CSS class names, env vars, npm script names, and the
value a shell function `echo`s for a caller to consume.

Language work rewrites prose. It never renames an identifier - not to fix a spelling,
not to fix an outright typo. `nodvenligord` in `apps/ai-gateway/src/server.ts` is
misspelled in every language and stays exactly as it is. When you cannot tell which side
a string is on, treat it as an identifier.

### 2. A string compared against user input is a pattern, not prose. Never touch it.

This is the same decision as point 1, and the one that costs most to get wrong.

The test is mechanical. If the string sits on the right-hand side of `includes`,
`startsWith`, `endsWith`, `match` or `test`, or inside a `Set` or array that is
searched, or inside a regex - and the left-hand side comes from a request body, a query
parameter or an input field - then it is a **pattern**. It matches what people actually
type, and people type `kjor pa`, `avsla`, `ma jeg` and `nar` without the letters.

Correcting the spelling of a pattern deletes half its coverage in silence. Nothing
throws, no test goes red, no log line appears. The guard simply stops firing.

There is deliberately no list of the sites here. The test above finds them, and a list
would be incomplete the week after it was written. `pnpm test:sperrer` pins the ones in
`apps/ai-gateway/src/sporsmaalsperrer.ts`; everywhere else this rule is the only guard,
which is why it reads as a ban rather than a caution.

Some of those files carry the same phrase twice, once with the letters and once without
- `"kjør på"` beside `"kjor pa"`. That is not a style to preserve. It exists because
`foldNorwegian` in `sporsmaalsperrer.ts` is not exported, so the other normalisers do not
fold, and the duplicates paper over it. Export it and fold in one place, and the
duplicates can go. Until then, leave them alone: deleting one half without the other is
the silent failure this point is about.

### 3. Identifiers: English for the plumbing, Norwegian for the domain.

**English** for anything technical - the plumbing a developer from any country would
recognise: `callModel`, `jsonResponse`, `readRequestBody`, `writeTrace`, `buildPrompt`,
`compilePathPattern`, `HttpError`, `readState`, `errorBody`, `newId`. Verbs are English
too: `find…`, `read…`, `write…`, `build…`, `validate…`, `check…`.

**Norwegian** for the domain - the words a Norwegian caseworker would use, and which
have no honest English equivalent in this context: `samtykke`, `inntekt`, `beregning`,
`prosessoekt`, `revisjonslogg`, `husstand`, `ordning`, `satser`, `foreldrebetaling`,
`matrikkel`, `soknad`, `steg`, `vilkaar`.

Mixed compounds are expected and correct: `getInntektForPerson`, `validateProsessvalg`,
`buildBeregning`, `hasValidSamtykke`. English verb, Norwegian domain noun.

**The wire format is frozen and stays Norwegian.** Field names in JSON responses and
endpoint paths are the contract every team builds against, and the trap is that they
look like ordinary words: `melding`, `feil`, `grunnlag`, `svar`, `steg` and `verktoy`
read as prose and are not. Never rename one. A local variable may be `message`; the
response key stays `melding`.

Those six are examples. `openapi/*.yaml` is the list, and the only one worth trusting.

The one place this does not apply is `ai-gateway`'s trace surface (`/trace`,
`state/ai-trace.jsonl`), which is developer tooling rather than service contract and is
English throughout, apart from `sporingsId`, which correlates with the domain field.
`apps/ai-gateway/README.md` names those fields; do not copy them here.

### 4. Identifiers transliterate. Prose does not.

An identifier built from a Norwegian word drops the letters: `noekkel`, `foer`,
`rekkefoelge`, `prosessoekt`, `vilkaar`, `soknad`, `verktoy`, `foedselsnummer`,
`sporsmaalsperrer.ts`, `test-prosessoekt-lukket.ts`.

This describes what the repo already is. It is not a target to move toward, and the
transliteration is **not consistent and is not being made consistent**: `ø` becomes `oe`
in `noekkel` and `prosessoekt` but plain `o` in `soknad` and `verktoy`, and `å` becomes
`aa` in `vilkaar` and `sporsmaal`. All of them stay. `verktoy` is a frozen wire field
and `prosessoekt` names a state file, so renaming for tidiness is exactly the change
point 1 exists to prevent.

Prose never transliterates, and never escapes. Write `søknad`, `verktøy`, `vilkår`,
`spørsmål`, `økt` and `kjører` with the letters, including when the prose is describing
an identifier that lacks them, and write `ø` rather than `ø`. Everything here is
UTF-8 - code, JSON, YAML, Markdown and scripts alike - and every HTML response goes out
as `charset=utf-8`, so nothing needs an escape. The one exception is `start.bat`, for a
reason that has nothing to do with style; see point 9.

### 5. Norwegian prose takes `-en`, not `-a`.

`filen`, `listen`, `ruten`, `mappen`, `linjen`, `siden`, `kilden`, `økten`. Never
`fila`, `lista`, `ruta`, `mappa`, `linja`. Bokmål permits both; this repo picks one so
the docs read in a single register. It is a house style, not a claim about correct
Norwegian.

**It applies to our own prose, and stops at a quotation.** The TT-kort case is
modelled on Vestland fylkeskommune, which writes nynorsk, and the `formaal` in
`data/prosessdefinisjoner.json` is lifted word for word from their form - the
`hensikt` field beside it says so, and that string is what lands in the
revisjonslogg. `vilkaar.ts` carries a passage from their rettleiing inside
guillemets for the same reason. A statute name is not ours to re-spell either:
A house style that rewrites a source is no longer quoting it.

`apps/shared/hjemmel.ts` holds the short title each act this sandbox cites actually
has, with its Lovdata id, and the spellings that are quotations rather than titles.
The register is a module and not a paragraph because which title an act has is not
something a reader can reason out: `opplæringslova` is nynorsk because the 2023 act
was passed that way and `barnehageloven` is bokmål because the 2005 one was, so a
paragraph citing both is correct rather than inconsistent - and `Opplæringslova` was
renamed to `opplæringsloven` in a spelling sweep with nothing turning red, because a
statute name is only a string in a `kilde`. `pnpm test` now reads every statute name
out of the seed files it validates and fails on one the register does not carry - the
BRREG and Tenor extracts are outside it, because a statute name an external register
writes is not ours to re-spell. A spelling that is a
quotation is exempted by file and by the position of the hit, the way `EXCEPTIONS` in
`scripts/check-dokumentasjon.ts` is - exempting the spelling alone would have made
`forvaltningslova` legal everywhere, and exempting it per file made it legal anywhere
in that file. A registered quotation that goes missing is itself an error, because the
sweep the register exists to catch is the one that "corrects" the quotation.

### 6. No em dash.

**Write a plain hyphen (`-`), never an em dash (`—`).** The em dash reads as generic AI
output, so it is banned everywhere: prose, code comments, string literals, YAML, shell
scripts and commit messages. Where a dash construction is wanted, write a spaced
hyphen (` - `); often a comma, colon or full stop reads better. An en dash (`–`)
survives only inside a numeric range with no spaces around it (`2–5 år`, `2.–3. trinn`),
never as a sentence dash.

The one inside backticks above has to exist in order to name the character. Do not
"fix" it, and do not add another anywhere.

### 7. Quotation marks.

Norwegian prose uses guillemets with no space inside: «samtykke mangler», «hva skjer
videre». Curly `“ ” ’` are banned in prose. English prose - this file and
`.github/copilot-instructions.md` - uses the straight `"`. Apostrophes are straight `'`.

A guillemet inside a TypeScript string is just a character and needs no escaping. A
curly quote inside a regex is a pattern, not prose - see point 2.

### 8. Plain Norwegian. Say it the way a colleague would.

Norwegian has a formal administrative register that sounds precise and is merely heavy.
It is the register an assistant drifts into when it is trying to sound careful, and it
is the likeliest way for otherwise correct prose here to become hard to read.

| Heavy | Write instead |
|---|---|
| «regner opp», «oppregningen» | «har listene», «lister hvilke felter det gjelder» |
| «usann», «usanne» | «feil» |
| «sveip», «sveipet», om et søk og erstatt | «søk» |
| «anvendes», «benyttes» | «brukes» |
| «samt» | «og» |
| «vedkommende» | «personen», «den personen» |
| «forestå», «hensyntatt», «vedrørende», «anføre», «således», «derved», «eksempelvis» | say it the ordinary way |

Every one of those is correct Norwegian, and that is the point: correct is not the bar.
Being understood on the first read is. The pattern behind them is reaching for a raised
or literary word where an everyday one exists, so the test is whether you would say it
out loud to a colleague. Add a row whenever a new one is caught.

This point covers **commit messages and pull request descriptions**, not only the files
in the repo. Point 6 already reaches that far, and so does this one.

The exception is vocabulary that belongs to the domain rather than to the register.
`data/brreg.seed.json` and `data/tenor/*.json` carry `erverv` and `innehaver` because
BRREG and Tenor do; those are external schemas and are not prose. A legal or
caseworking term that is genuinely the right word stays, and `samtykke`, `vedtak`,
`hjemmel` and `foreldreansvar` are not heavy just because they are formal.

### 9. Which language a file is written in.

**Norwegian**, because participants read these: `README.md`, `CONTRIBUTING.md`,
everything under `docs/`, every `apps/*/README.md`, `openapi/README.md`,
`evals/README.md`, `examples/*/README.md`, the step *names* in
`.github/workflows/ci.yml`, and everything `start.sh` and the `scripts/*` checks print
to the console.

**English**, because these are instructions to a machine that reads them in English:
this file, `CLAUDE.md`, `.github/copilot-instructions.md`, and the comments inside
`ci.yml`.

**A tool description is English for the same reason.** The `description` and
`inputSchema` strings in `apps/tools-api` are what a client puts in front of a model
when it picks a tool, so they are the model's prompt rather than anyone's
documentation. Keep them English, and keep the domain nouns Norwegian inside them the
way point 3 says: «Get one organisation by organisasjonsnummer.» The README beside such
a service is the opposite case - no client loads it, a person setting it up reads it, so
it is Norwegian like every other `apps/*/README.md`.

**Code comments follow the identifier rule instead**: English for the technical,
Norwegian where the comment reasons in the domain, and one language per block - a block
never switches midway. Write them only where they earn their place, and explain *why*,
not *what*; if a comment restates the code, delete it rather than translate it. A
Norwegian word inside an English comment is fine when it is a **quotation** - an
identifier, a JSON key, a kodeverk value, a line of user-facing text. Translating a
quotation breaks the link to the thing it points at.

**`start.bat` is the carve-out.** `.gitattributes` pins `*.bat` to CRLF, and `cmd.exe`
reads a batch file in the console code page rather than UTF-8, so Norwegian letters in
an `echo` line come out as mojibake on a Norwegian Windows box - and a UTF-8 BOM makes
`@echo off` itself fail. The file is plain ASCII today and has no `chcp`. Its prose is
therefore **Norwegian written without æ/ø/å**: prefer wording that avoids them
(`Starter tjenester`, `Klar`) and transliterate only where the word is unavoidable. This
is the one place prose transliterates, and the file carries a `rem` saying why so nobody
"fixes" it later.

## Project conventions you must follow
- Prefer existing endpoint patterns from current services and examples in `README.md` / `docs/api-oversikt.md`.
- When API behavior changes, update matching OpenAPI docs in `openapi/*.yaml`.
- Keep changes scoped to one app unless cross-service change is required.
- **A new package version must be at least seven days old before it enters the repo.**
  `minimumReleaseAge` in `pnpm-workspace.yaml` and `cooldown` in `.github/dependabot.yml`
  enforce it. Dependabot security updates are exempt, and that exemption is npm-only:
  the `docker` and `docker-compose` ecosystems get version updates and no security
  updates at all, so a CVE in an image waits out the full seven days like any other bump.
- **Nothing floats. Every dependency carries a version a bot can bump.**
  A floating reference does not merely block the bot, it negates the rule above:
  `cooldown` delays a pull request, and `:latest` needs none, so the bytes change on the
  next `docker compose pull` at zero days of age. The norm outside this repo is the same.
  NIST SP 800-190 says to address images by immutable names that carry the version, and
  OpenSSF Scorecard's `Pinned-Dependencies` scores a digest above a tag. Images here
  stop at the tag: `sbom-images.yml` splits an image reference on its last colon, and a
  digest contains one.
  Four pins no bot reaches, each for a reason. `ks-no/github-actions-public/...@main`:
  that repo has no tags, so a SHA pin would freeze it rather than follow it.
  `node:24-alpine`, in `docker-compose.yml` and `apps/matrikkel-mock/Dockerfile`: a
  moving tag inside the major, so Dependabot can only offer the next major, which
  `.github/dependabot.yml` ignores. `pnpm` in `packageManager`: dependabot-core#4830 is
  still open, so it drifts until someone moves it by hand. `VERSION` in
  `scripts/hent-designsystem.ts`: deliberate while the design system is pre-1.0, and the
  script says why. Do not add a fifth without saying why here.

## Frontend: the KS Digital design system
- Components, their API and their accessibility requirements are documented at
  <https://designsystemet.no/no>. Look them up there.
- **Participant frontends are expected to live in their own project, outside this repo**,
  talking to the sandbox APIs (every service answers `Access-Control-Allow-Origin: *`; see
  `docs/bygg-selv.md`). There they install the design system from npm. The rules below are
  for work done *inside* this repo.
- `docs/designsystem.md` covers both setups, the cascade trap and the pitfalls, and
  `http://localhost:3001/ds-eksempel` is it running. Read the doc before writing markup.
- Inside this repo the design system ships as **plain CSS** (`apps/shared/ds-base.css` +
  `ds-ksdigital.css`, vendored from `@ks-digital/designsystem-themes`, refreshed by
  `pnpm ds:hent`). That is the only reason it fits a repo with one dependency and no
  build step. Do not reach for the React or Angular packages here.
- **Never load `felles.css` and the design system CSS on the same page.** `felles.css` has
  no `@layer`, and unlayered rules outrank every layer in the cascade, so it silently
  overrides `@layer ds` and `@layer ksd`: Inter disappears and every button variant
  collapses to the same blue. It looks like the stylesheet failed to load. It did not - it
  was overridden. To override the design system deliberately, declare `@layer side;` (it
  lands after `ksd`) and put your rules there.
- Never edit the two vendored files. `pnpm ds:hent` overwrites them.
- `demo-gui` and `process-builder` keep their existing look. A new frontend is a new file,
  because those two are what other teams read to understand the sandbox.
- The naming rule above still applies. Class names are technical, so they are English;
  the wire format stays Norwegian no matter how the UI is styled.

## Developer workflows
- Install + run all services:
```bash
pnpm install
docker compose up --build
```
- Stop stack:
```bash
docker compose down -t 0
```
- Quick checks that need no running services - run these first:
```bash
pnpm lint            # tsc --noEmit
pnpm test            # valider-data.ts: referential integrity across all datasets
pnpm test:sperrer    # guardrails on /ai/sporsmaal as pure functions
pnpm test:vilkaar    # the vedtak in vilkaar.ts, as pure functions against fixtures
pnpm test:foedselsnummer  # modulus 11 and the +80 synthetic marker, pure functions
pnpm test:handleevne      # who may act and on whose behalf, pure functions
pnpm test:imports         # the import graph between apps is a DAG, pure text analysis
pnpm test:startup         # launcher lifecycle with fake Docker/curl, no running stack
pnpm test:parametere      # required query parameters per route, read off the specs
pnpm test:upstream        # what a non-ok answer from another service means, pure functions
pnpm test:innlevering     # the rules hent-innleveringer.ts pushes team branches by, pure functions
pnpm test:forsendelse     # SvarUt channel decision and time-derived status, pure functions
pnpm test:kontrakt   # starts its own backend + fiks on 18080/18081 against a fresh STATE_DIR
pnpm test:agent:dialog     # starts isolated services with the AI mock, through actual submission
pnpm test:tools-matrikkel  # starts tools-api, matrikkel-mock and a fake Geonorge service
pnpm test:agent:matrikkel  # starts process-agent and a fake tools-api
pnpm test:matrikkel-mock   # starts its own matrikkel-mock
```
- After editing source files in `apps/`, restart the affected containers so Node picks up the changes:
```bash
./start.sh --reload          # recreates all Node services (picks up compose config changes too)
docker compose restart sandbox-backend demo-gui   # targeted restart if you only changed those two
```
  Source files are volume-mounted (`./:/workspace`), so no image rebuild is needed - a restart is enough.
- All eleven Node services (`sandbox-backend`, `demo-gui`, `ai-gateway`, `tools-api`,
  `process-agent`, `fiks-simulator`, `process-builder`, `matrikkel-mock`, `digdir-mock`,
  `pasientjournal-mock`, `politiattest-mock`) are volume-mounted and run via `scripts/dev.sh`, which selects the right watcher automatically:
  - **Linux** and **macOS with Docker Desktop 4.15+** (VirtioFS default): `node --watch` - inotify
    events propagate natively; restarts are immediate.
  - **Windows** (Docker Desktop with project on Windows filesystem, `C:\...`): `nodemon --legacy-watch`
    polling - inotify does not propagate through Docker Desktop's 9P volume mount, so `start.bat`
    sets `WATCH_POLL=1` to switch to polling automatically.
  Any file you save is detected and the Node process restarts - **no manual action needed for normal
  code edits**. Watch for the log line `Change detected in '...'` (inotify) or `restarting due to changes...`
  (nodemon) to confirm it triggered.
- `matrikkel-mock` used to be the exception - a baked image with no volume mount, so every seed
  change needed `--build`. It no longer is: it reads the work tree like the rest, and
  `apps/matrikkel-mock/Dockerfile` survives only for running it standalone outside Compose.
- `./start.sh --reload` is still useful when you change `docker-compose.yml` itself (e.g. environment
  variables), since `--watch` only restarts the Node process, not the container.
- `pnpm test:kontrakt` writes a normalised, deterministic dump - identifiers and
  timestamps are replaced with placeholders, so two runs of the same code are
  byte-identical. Use it as a regression gate around refactors:
```bash
pnpm test:kontrakt --ut state/foer.json
# ...refactor...
pnpm test:kontrakt --ut state/etter.json
diff state/foer.json state/etter.json
```
- These need the stack running (`./start.sh`):
```bash
pnpm test:agent
pnpm test:agent:nl
pnpm test:bergen-matrikkel
```
- Optional orchestrated startup script (model selection/reset): `./start.sh --help`.
- CI (`.github/workflows/ci.yml`) runs `lint`, `test:chat-intent`, `test`, `test:sperrer`,
  `test:oppsummering`, `test:skjerming`, `test:vilkaar`, `test:reasoning`, `test:tiltakshjelpen-raad`, `test:tiltakshjelpen`, `test:flytkart`, `test:foedselsnummer`, `test:handleevne`,
  `test:samtykke`, `test:forsendelse`, `test:upstream`, `test:innlevering`, `test:concurrency`,
  `test:replay`, `test:chat`, `test:parametere`, `test:imports`, `test:startup`, `test:kodeverk`,
  `test:revisjon`, `test:openapi`, `test:docs`, `test:agent:dialog`, `test:tools-matrikkel`,
  `test:agent:matrikkel`, `test:matrikkel-mock`, `test:matrikkel-id` and `test:kontrakt` on every PR
  and on push to main, and uploads the contract dump as an artifact. It deliberately
  does **not** run `test:eval` (needs a live model). `test:agent:dialog` starts its own
  isolated services with the AI mock and runs `test:agent` and `test:agent:nl` through
  actual submission. Running `test:agent` or `test:agent:nl` on its own needs the
  stack. `test:tools-matrikkel`, `test:agent:matrikkel` and `test:matrikkel-mock` start their own
  services; they need neither a running stack nor a model.
- Every service in `docker-compose.yml` has a `healthcheck`, and `tools-api`
  and `process-agent` wait on `condition: service_healthy`. `./start.sh` still polls
  `/helse` itself, since the macOS path uses `--no-deps`.

## Integration edges and env vars
- In Compose, services call each other by container DNS (`http://sandbox-backend:8080`, etc.).
- Common env vars: `BACKEND_BASE_URL`, `AI_BASE_URL`, `TOOLS_BASE_URL`, `MATRIKKEL_BASE_URL`, `AI_PROVIDER`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `BEDROCK_AWS_REGION`, `BEDROCK_AWS_ACCESS_KEY_ID`, `BEDROCK_AWS_SECRET_ACCESS_KEY`, `BEDROCK_AWS_SESSION_TOKEN`, `BEDROCK_MODEL_ID`, `PASIENTJOURNAL_BASE_URL`, `POLITIATTEST_BASE_URL`, `STATE_DIR` - which
  `docker-compose.yml` never passes on, so it is read only by scripts you start
  yourself, never by a service under compose.
- `tools-api` uses `MATRIKKEL_BASE_URL` (default `http://matrikkel-mock:8085`) to reach the Matrikkel mock.
- `ai-gateway` falls back to template text when the provider is unavailable, setting an
  `advarsel` field. Check `GET /helse` - it reports `modellNaaBar` plus a `feil` string
  explaining why. Status is always 200: the service is alive even when the model is not.
  `demo-gui` shows a banner on `/chat` and `/agent`, and `./start.sh` warns on startup.
- **All model calls go through one function**, `callModel` in `apps/ai-gateway/src/server.ts`.
  Adding a provider is one function with the signature `(prompt, temperatur, signal)`
  returning `{ tekst, modell }`, plus a branch in `callModel`. Do not reintroduce
  per-provider copies of each task - that is what this replaced.
- Every model call is traced to `state/ai-trace.jsonl`: prompt, response, model, duration,
  and whether it failed. Read it at `GET /trace` (HTML) or `GET /trace.json` (JSON, filterable
  by `sporingsId`, `task`, `limit`). This is the fastest way to see what the model
  actually received, before heuristics and validation touched it.
- Model calls time out after `AI_TIMEOUT_MS` (default 180000) and fall back rather than
  hanging.
- **`/ai/sporsmaal` is the one endpoint where a citizen writes free text and gets free
  text back, so its guardrails run in code, not only in the prompt.** They live in
  `apps/ai-gateway/src/sporsmaalsperrer.ts`, a dependency-free module kept separate from
  `server.ts` because that file calls `server.listen` at the top level and cannot be
  imported by a test. `pnpm test:sperrer` covers them and runs in CI - it needs neither
  the stack nor a model. The endpoint has no data access of its own: it answers only from
  the grounding the caller sends, which is what makes it structurally unable to reach
  consent-gated data. Do not give it a backend data client.
  Two topics never reach the model at all: prompt-injection attempts, and privacy
  questions, which are answered from `PERSONVERN` in that module. An invented privacy
  claim has no tell a code check can find - no number, no decision - so it gets a fixed
  answer instead.
- **Changing a prompt? Run the evals.** `pnpm test:eval` scores the AI layer against
  datasets in `evals/`, with a pass threshold per dataset and a non-zero exit below it.
  `evals/ai-policy.json` is the executable form of `ai-no-decisions`: the model phrases,
  it does not compute or decide. Baseline before, compare after - see `evals/README.md`.
  Deliberately kept out of CI, since it needs a running model.
- `/ai/*` request bodies put everything under `kontekst` - except `/ai/tolk-svar` and
  `/ai/sporsmaal`, which take `tekst` at the top level.
- `/ai/tolk-svar`, `/ai/velg-prosess` and `/ai/velg-verktoy` run heuristics first and only
  call the model when the heuristic does not match. Four endpoints work but have no code
  callers in the sandbox: `/ai/dialogforslag`, `/ai/risikosjekk`, `/ai/klarsprak` (only
  `start.sh` probes it) and `/ai/forklar-databruk`. They are there for teams to use.
- **Addresses come from Geonorge at lookup time. Only four hand-authored streets sit
  on disk.** `MATRIKKEL_DATA_FILE` overrides the file `matrikkel-mock` seeds from; the
  default is `data/matrikkel.seed.json`, which holds Storgata, Nordnesveien,
  Fjøsangerveien and Laksevågvegen in Bergen. None of them exist in the real register:
  they are authored so the demos have a fixed property to point at, and the synthetic
  population is anchored to them. Everything else is resolved live.
  The 12.6 MB `data/matrikkel.json` is gone, and so is `scripts/hent-matrikkel.ts`.
- **The id is the join, and it is built in one place.** `byggMatrikkelId` in
  `apps/shared/adresse.ts` derives `matr-geo-{kommunenummer}-{adressekode}-{husnummer}{husbokstav}`
  from a Geonorge address. Three callers must agree on it: `scripts/importer-tenor.ts`
  stamps it into `data/personer.json` and `data/eierforhold.json`, and both
  `matrikkel-mock` and `tools-api` rebuild it for every live lookup. They used to
  disagree - the live path appended gnr and bnr - and the failure is silent, because a
  property with no registered owner is a valid answer. `pnpm test:matrikkel-id` pins the
  formula against `data/geonorge.fixtur.json`, and `pnpm test:matrikkel-mock` pins that
  ownership still joins over HTTP.
  **Ownership is not in the matrikkel:** it lives in `data/eierforhold.json`
  (`EIERFORHOLD_DATA_FILE`) and is merged in both on the seed path and on the live one,
  because title is in the grunnbok. `eiere` is only in the response from
  `/mock/matrikkel/eiendommer` when `personId` is given.
- **`scripts/check-matrikkel-data-source.ts` is the check that keeps the file from
  coming back.** It fails when `data/matrikkel.json` or `data/matrikkel_bk_25.json`
  exists, when the fixture grows past 2 MB, or when a running mock says it read
  something other than the fixture. A re-added extract would otherwise work perfectly
  and silently serve frozen data. Run it with `pnpm check:matrikkel-source`.
- `tools-api` uses `MATRIKKEL_BASE_URL` (default `http://matrikkel-mock:8085`) for mock
  lookups, and `MATRIKKEL_MODE=live|mock|hybrid` for street lookups. All three places
  that set it - the code default, `docker-compose.yml` and `.env.example` - say `mock`.
  The old reason for that default was that the seed held every Bergen street; it does
  not any more. The reason now is better: `mock` is one hop to the one service that
  knows how to build a `matrikkelId` and how to merge ownership, and it degrades to 404
  («Fant ikke …») rather than 500 when the network is down. `live` still rethrows on
  network failure, so every street lookup becomes a 500 when you are offline - and
  offline is now the common failure rather than the rare one.

## Matrikkel integration pattern
- `apps/matrikkel-mock` exposes a matrikkel over SOAP (Geointegrasjon path) and REST helper endpoints. Four hand-authored Bergen streets come from `data/matrikkel.seed.json`; everything else is a live Geonorge address lookup, and a lookup the seed misses is the normal case rather than the exception.
- **It is the only reader of the matrikkel seed.** `sandbox-backend` reaches it over HTTP via `MATRIKKEL_BASE_URL`; nothing else opens the file. Keeping two read paths meant keeping two copies of the same post-processing in step by hand.
- `data/matrikkel.seed.json` is the small curated fixture; keep it small, readable, and deterministic.
- **There is no teig route any more.** `/mock/matrikkel/teiger` and `/mock/matrikkel/naboteiger` read a 96.6 MB extract covering Bergen alone, and `sandbox-backend` used them first with Kartverket as the fallback. The fallback is now the whole path: `api.kartverket.no/eiendom/v1` answers for the whole country, is not frozen at an extract year, and carries grensekvalitet, tvist and oppdateringsdato - three fields the extract never had, so they always read as unknown.
- In `live` mode `tools-api` queries the Geonorge address API directly, with no local copy of Norway.
- `apps/tools-api` wraps matrikkel via three tools: `matrikkel_finn_veger`, `matrikkel_hent_eiendom`, `matrikkel_hent_eiere`.
- `matrikkel_hent_eiendom` and `matrikkel_hent_eiere` accept an exact address, e.g. `Storgata 5`.
- `apps/tools-api` also exposes `suggest_step_tools`: given a process step definition, calls `ai-gateway /ai/velg-verktoy` and returns which tools are relevant (context and/or validation).
- `apps/process-agent` calls `suggest_step_tools` on every QUESTION step to discover tools
  dynamically. It *additionally* hardcodes step ids and one tool name for the
  `fartsdempende-tiltak` case - see the service map above. Improving that agent is a
  hackathon task, not a bug to fix before the event.

## Useful places before editing
- Architecture/context: `docs/architecture.md`, `docs/prosessmodell.md`, `docs/sikkerhet-og-personvern.md`.
- The tiltakssjekk case: `docs/tiltakshjelpen.md` for the service, and
  `docs/flytkart-tiltakssjekk.md` for the caseworker's flowchart written out node by
  node, with a column saying where the code agrees and where it deliberately does not.
- Frontend and styling: `docs/designsystem.md`, and `apps/demo-gui/src/ds-eksempel.html` for working markup.
- Contracts: `openapi/README.md`, `openapi/sandbox-backend.yaml`, `openapi/process-agent.yaml`, `openapi/tools-api.yaml`, `openapi/matrikkel-mock.yaml`, `openapi/pasientjournal-mock.yaml`,
  `openapi/politiattest-mock.yaml`, `openapi/ai-gateway.yaml`.
- End-to-end behavior examples: `scripts/test-agent-flow.ts`, `scripts/test-agent-natural-language.ts`, `scripts/test-tools-matrikkel.ts`, `scripts/test-process-agent-matrikkel.ts`, `scripts/test-bergen-matrikkel-bulk.ts`.
