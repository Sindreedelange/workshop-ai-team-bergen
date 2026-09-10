import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { cors, svarhjelpere } from "../../shared/http.ts";
import { feilmelding } from "../../shared/errors.ts";
import { docsHtml, routeOverview } from "../../shared/openapi.ts";
import { createPlanStore, parsePlanQuery, PlanError } from "./planlag.ts";
import { AREALFORMAALDATASETT, HENSYNSSONEDATASETT } from "./datasett.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const openapiFile = path.resolve(__dirname, "../../../openapi/plan-mock.yaml");
const port = Number(process.env.PORT || 8090);

// Ingen token. KPA2018 er åpne plandata uten personopplysninger, og oppslaget
// svarer på et kartutsnitt og ikke på en person - det er ikke noe her å knytte
// til noen. Matrikkel-mock står åpen av samme grunn.
const { jsonResponse, textResponse } = svarhjelpere({ cors: cors("GET,OPTIONS") });

const planStore = createPlanStore();

// Rutene svarer for hver sin kategori, og datasettene er hele forskjellen mellom
// dem. Selve stien står likevel skrevet ut i hver gren under: scripts/sjekk-openapi-dekning.ts
// leser rutene ut av koden, og en sti den ikke kan se er en udokumentert flate.

const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
  const url = new URL(request.url!, `http://${request.headers.host}`);

  if (request.method === "OPTIONS") {
    jsonResponse(response, 204, {});
    return;
  }

  try {
    if (request.method === "GET" && url.pathname === "/mock/plan/hensynssoner") {
      jsonResponse(response, 200, await planStore.hent(parsePlanQuery(url.searchParams), HENSYNSSONEDATASETT));
      return;
    }

    if (request.method === "GET" && url.pathname === "/mock/plan/arealformaal") {
      jsonResponse(response, 200, await planStore.hent(parsePlanQuery(url.searchParams), [AREALFORMAALDATASETT]));
      return;
    }

    if (request.method === "GET" && url.pathname === "/helse") {
      jsonResponse(response, 200, {
        status: "ok",
        tjeneste: "plan-mock",
        plan: "KPA2018",
        kommunenummer: "4601",
        datasett: planStore.getStatus(),
        tidspunkt: new Date().toISOString(),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/openapi.yaml") {
      textResponse(response, 200, await readFile(openapiFile, "utf8"), "text/yaml; charset=utf-8");
      return;
    }

    // Den samme spesifikasjonen, lest. Se kommentaren i tools-api.
    if (request.method === "GET" && url.pathname === "/openapi-ruter.json") {
      jsonResponse(response, 200, await routeOverview(openapiFile));
      return;
    }

    // Samme side som de andre mockene, generert av spesifikasjonen. En håndskrevet
    // liste over tjenestens egne ruter ville vært en tredje kopi som driver i stillhet.
    if (request.method === "GET" && url.pathname === "/docs") {
      textResponse(response, 200, docsHtml(await routeOverview(openapiFile), "http://localhost:3001/utforsker"),
        "text/html; charset=utf-8");
      return;
    }

    jsonResponse(response, 404, { feil: "Fant ikke endepunkt." });
  } catch (error) {
    if (error instanceof PlanError) {
      jsonResponse(response, error.status, { feil: feilmelding(error) });
      return;
    }
    jsonResponse(response, 500, { feil: "Intern feil i plan-mock.", detalj: feilmelding(error) });
  }
});

server.listen(port, () => {
  console.log(`Plan-mock kjører på http://localhost:${port}`);
});
