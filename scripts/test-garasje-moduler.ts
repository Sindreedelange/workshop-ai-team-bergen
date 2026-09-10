import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { setTimeout as wait } from "node:timers/promises";

const probe = createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const address = probe.address();
assert(address && typeof address !== "string");
const port = address.port;
await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
const child = spawn(process.execPath, ["apps/demo-gui/src/server.ts"], {
  env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"]
});
let logs = "";
child.stdout.on("data", chunk => { logs += chunk; });
child.stderr.on("data", chunk => { logs += chunk; });
const exited = once(child, "exit");
const base = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Klienten stoppet: ${logs}`);
    try {
      ready = (await fetch(`${base}/helse`)).ok;
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
    if (ready) break;
    await wait(50);
  }
  assert(ready, `Klienten startet ikke: ${logs}`);
  const html = await (await fetch(`${base}/garasje`)).text();
  assert(html.includes('/assets/ds-morketema.css'), "Tiltakssiden må laste rettelsen for mørkt tema");
  assert(html.indexOf('/assets/ds-morketema.css') > html.indexOf('/assets/ds-ksdigital.css'),
    "Temarettelsen må lastes etter det vendorede temaet");
  assert(!html.includes('/assets/felles.css'), "Ulagede stiler må ikke overstyre designsystemet");
  const embedded = await fetch(`${base}/garasje?integrert=sporsmaal&oektsId=test&stegId=garasje-prosjekt`);
  assert.equal(embedded.status, 200);
  assert.equal(await embedded.text(), html, "Innebygd og frittstående tiltakssjekk må laste samme tema og klientmoduler");
  const visited = new Set<string>();
  async function checkModule(url: URL): Promise<void> {
    if (visited.has(url.href)) return;
    assert.equal(url.origin, base, "Klientmoduler skal ikke lastes fra en ekstern tjeneste");
    visited.add(url.href);
    const response = await fetch(url);
    assert.equal(response.status, 200, `Modulen ${url.pathname} må kunne lastes`);
    assert.match(response.headers.get("content-type") ?? "", /javascript/);
    const source = await response.text();
    for (const match of source.matchAll(/\b(?:import|export)\s+(?:[^"'();]*?\s+from\s*)?["']([^"']+)["']/g)) {
      await checkModule(new URL(match[1], url));
    }
  }
  for (const match of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) await checkModule(new URL(match[1], base));
  assert(visited.has(`${base}/shared/geometri.ts`), "Testen må følge den delte geometrimodulen");
  assert.equal((await fetch(`${base}/shared/jsonstore.ts`)).status, 404, "Delte filer må fortsatt være eksplisitt tillatt");
  const css = await fetch(`${base}/assets/ds-morketema.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type") ?? "", /text\/css/);
  console.log(`Klientmoduler: ${visited.size} skript og alle deres avhengigheter kan lastes fra tiltakssiden.`);
} finally {
  child.kill("SIGTERM");
  await exited;
}
