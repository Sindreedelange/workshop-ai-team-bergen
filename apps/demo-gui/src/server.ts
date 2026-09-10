import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KLIENTSKRIPT, send, sendFil } from "../../shared/assets.ts";
import { buildClientKonfigurasjon } from "../../shared/client-konfigurasjon.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sharedDir = path.join(__dirname, "..", "..", "shared");
const deltKlientDir = path.join(sharedDir, "client");
const klientDir = path.join(__dirname, "client");
const port = Number(process.env.PORT) || 3001;

// Whitelisted, because the filename comes from the URL. Never join user input
// onto a directory path without one.
const ASSETS: Record<string, string> = {
  "felles.css": "text/css; charset=utf-8",
  // Vendored design system, see docs/designsystem.md. Flat filenames on purpose:
  // the lookup below joins the URL name onto a directory, so no name may contain a slash.
  "ds-base.css": "text/css; charset=utf-8",
  "ds-ksdigital.css": "text/css; charset=utf-8",
  "ds-morketema.css": "text/css; charset=utf-8",
  // The service registry. Dashboard and API explorer both read it, so the list of
  // services exists once instead of once per page. See apps/shared/tjenester.json.
  "tjenester.json": "application/json; charset=utf-8"
};

// Delt klientkode, servert til begge frontendene. .ts, og nettleseren merker
// ingenting: den går etter Content-Type, og shared/assets.ts stripper
// typene på vei ut.
const DELTE_KLIENTFILER: Record<string, string> = {
  "felles.ts": KLIENTSKRIPT
};

const DELTE_MODULER: Record<string, string> = {
  "garasje-dialog.ts": KLIENTSKRIPT,
  "garasje-kunnskap.ts": KLIENTSKRIPT,
  "garasje-begreper.ts": KLIENTSKRIPT,
  "garasje-regelgrunnlag.ts": KLIENTSKRIPT,
  "garasje-kommuner.ts": KLIENTSKRIPT,
  "garasje.ts": KLIENTSKRIPT,
  "arealsoner.ts": KLIENTSKRIPT,
  "hensynssoner.ts": KLIENTSKRIPT,
  "geometri.ts": KLIENTSKRIPT,
  "byggetiltak.ts": KLIENTSKRIPT
};

// One script per page, served from this app rather than shared because that is
// where they belong. Same whitelist rule as above, same reason.
const KLIENTFILER: Record<string, string> = {
  "dashboard.ts": KLIENTSKRIPT,
  "stegvis.ts": KLIENTSKRIPT,
  "chat.ts": KLIENTSKRIPT,
  "fallback-intent.ts": KLIENTSKRIPT,
  "agent.ts": KLIENTSKRIPT,
  "utforsker.ts": KLIENTSKRIPT,
  "ds-eksempel.ts": KLIENTSKRIPT,
  "garasje.ts": KLIENTSKRIPT,
  "garasje-kart.ts": KLIENTSKRIPT,
  "garasje-tema.ts": KLIENTSKRIPT,
  "garasje-tiltak.ts": KLIENTSKRIPT,
  "garasje-raad.ts": KLIENTSKRIPT,
  "garasje-utfylling.ts": KLIENTSKRIPT,
  "garasje-prosess.ts": KLIENTSKRIPT,
  "callback.ts": KLIENTSKRIPT
};

const sider: Record<string, string> = {
  "/": "dashboard.html",
  "/dashboard": "dashboard.html",
  "/stegvis": "stegvis.html",
  // Ruten het /stegvis lenge før filen gjorde. Aliaset står fordi noen kan ha
  // bokmerket det.
  "/index.html": "stegvis.html",
  "/chat": "chat.html",
  "/chat.html": "chat.html",
  "/agent": "agent.html",
  "/agent.html": "agent.html",
  "/utforsker": "utforsker.html",
  // Template for teams building their own frontend. See docs/designsystem.md.
  "/ds-eksempel": "ds-eksempel.html",
  "/garasje": "garasje.html",
  // The redirect_uri registered with ID-porten. Same path for every page: the page
  // to return to travels in `state`, not in the callback URL.
  "/callback": "callback.html"
};

const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
  const sti = (request.url || "/").split("?")[0];

  if (sti === "/helse") {
    send(response, 200, JSON.stringify({ status: "ok", tjeneste: "demo-gui" }), "application/json; charset=utf-8");
    return;
  }

  if (sti === "/garasje-config.json" || sti === "/klient-config.json") {
    send(response, 200, JSON.stringify(buildClientKonfigurasjon()), "application/json; charset=utf-8");
    return;
  }

  if (sti === "/klient-konfigurasjon") {
    send(response, 200, `globalThis.sandkasseKonfigurasjon = ${JSON.stringify(buildClientKonfigurasjon())};`, KLIENTSKRIPT);
    return;
  }

  for (const [prefiks, katalog, tillatte] of [
    // /delt/ før /assets/: felles.ts er .ts og strippes, resten er statiske
    // filer som sendes uendret. Rekkefølgen betyr ingenting her siden
    // prefiksene ikke overlapper, men holder de to slagene fra hverandre.
    ["/delt/", deltKlientDir, DELTE_KLIENTFILER],
    ["/shared/", sharedDir, DELTE_MODULER],
    ["/assets/", sharedDir, ASSETS],
    ["/client/", klientDir, KLIENTFILER]
  ] as const) {
    if (!sti.startsWith(prefiks)) continue;
    const navn = sti.slice(prefiks.length);
    const contentType = tillatte[navn];
    if (!contentType) {
      send(response, 404, "Fant ikke fil.", "text/plain; charset=utf-8");
      return;
    }
    await sendFil(response, path.join(katalog, navn), contentType);
    return;
  }

  const side = sider[sti];
  if (side) {
    await sendFil(response, path.join(__dirname, side), "text/html; charset=utf-8");
    return;
  }

  send(response, 404, "Fant ikke side.", "text/plain; charset=utf-8");
});

server.listen(port, () => {
  console.log(`Demo-GUI kjører på http://localhost:${port}`);
});
