import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { test } from "node:test";
import { createTeigStore, parseTeigQuery, parseNaboteigQuery, TeigError } from "../apps/matrikkel-mock/src/teiger.ts";
import { getGeometriBounds } from "../apps/shared/geometri.ts";
import type { MatrikkelTeigFeature } from "../apps/shared/matrikkelteig.ts";

function feature(id = 1, snr = 0, fnr = 0): MatrikkelTeigFeature {
  return {
    type: "Feature", id,
    geometry: {
      type: "Polygon",
      coordinates: [
        [[5, 60], [5.01, 60], [5.01, 60.01], [5, 60.01], [5, 60]],
        [[5.002, 60.002], [5.002, 60.003], [5.003, 60.003], [5.003, 60.002], [5.002, 60.002]]
      ]
    },
    properties: {
      OBJECTID: id, OBJTYPE: "Teig", GNR: 105, BNR: 209, FNR: fnr, SNR: snr,
      AREAL: 1200, AREALMERKNAD: null, TINGLYST: "Ja", ANTALL_GID: 1, Shape_Area: 1200.3, Shape_Length: 150.4
    }
  };
}

const query = { kommunenummer: "4601", gnr: 105, bnr: 209, fnr: 0 };
const queryString = "kommunenummer=4601&gnr=105&bnr=209";
const naboQueryString = "kommunenummer=4601&vest=5.001&sor=60.001&ost=5.004&nord=60.004";
const naboQuery = parseNaboteigQuery(new URLSearchParams(naboQueryString));
const valid = { type: "FeatureCollection", features: [feature()] };
const isDatasetError = (error: unknown) => error instanceof TeigError && error.status === 502;

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

await test("Matrikkelteiger fra lokalt Bergen-uttrekk", async (t) => {
  const fixtureDir = path.resolve("state", `test-matrikkel-teiger-${randomUUID()}`);
  await mkdir(fixtureDir, { recursive: true });
  const file = path.join(fixtureDir, "teiger.json");
  const save = (value: unknown) => writeFile(file, JSON.stringify(value), "utf8");

  try {
    await t.test("Parametere er eksplisitte og festenummer har standardverdi 0", () => {
      assert.deepEqual(parseTeigQuery(new URLSearchParams(queryString)), query);
      assert.equal(parseTeigQuery(new URLSearchParams(`${queryString}&fnr=2`)).fnr, 2);
      assert.equal(parseTeigQuery(new URLSearchParams("kommunenummer=4601&gnr=105&bnr=0")).bnr, 0);
      for (const input of [
        "", "gnr=105&bnr=209", "kommunenummer=4601&bnr=209", "kommunenummer=4601&gnr=105",
        "kommunenummer=46&gnr=105&bnr=209", "kommunenummer=abcd&gnr=105&bnr=209",
        ...["", "0", "-1", "1.5", "1e2", "NaN", "Infinity", "9007199254740992", "105abc", " 105"]
          .map((value) => `kommunenummer=4601&gnr=${encodeURIComponent(value)}&bnr=209`),
        ...["", "-1", "0.5", "NaN"].map((value) => `${queryString}&fnr=${value}`),
        `${queryString}&gnr=106`, `${queryString}&snr=1`, `${queryString}&fil=annen.json`,
        `${queryString}&url=https://example.invalid`, "kommunenummer=4601&gnr=105&bnr=-1"
      ]) {
        assert.throws(() => parseTeigQuery(new URLSearchParams(input)),
          (error) => error instanceof TeigError && error.status === 400, input);
      }
    });

    await t.test("Udekket kommune leser ikke Bergen-filen, heller ikke når den mangler", async () => {
      const store = createTeigStore(file);
      assert.equal(store.getStatus().status, "ikke_lastet");
      for (const kommunenummer of ["0201", "0301"]) {
        const result = await store.getTeiger({ ...query, kommunenummer });
        assert.equal(result.kommunenummer, kommunenummer);
        assert.equal(result.kildestatus, "ikke_dekket");
        assert.deepEqual(result.features, []);
        assert.equal(result.kilde.fil, null);
        assert.equal(result.kilde.uttrekksaar, null);
        assert.equal(result.kilde.syntetisk, false);
        const neighbours = await store.getNaboteiger({ ...naboQuery, kommunenummer });
        assert.equal(neighbours.kildestatus, "ikke_dekket");
        assert.deepEqual(neighbours.features, []);
        assert.equal(neighbours.kilde.fil, null);
      }
      assert.equal(store.getStatus().status, "ikke_lastet");
      await assert.rejects(store.getTeiger(query), isDatasetError);
      await assert.rejects(store.getNaboteiger(naboQuery), isDatasetError);
      assert.equal(store.getStatus().status, "feil");
      await save(valid);
      assert.equal((await store.getTeiger(query)).features.length, 1);
      assert.equal(store.getStatus().status, "tilgjengelig");
    });

    await t.test("Nabosøk krever fem entydige parametere og et lite gyldig utsnitt", () => {
      for (const field of ["kommunenummer", "vest", "sor", "ost", "nord"]) {
        const params = new URLSearchParams(naboQueryString);
        params.delete(field);
        assert.throws(() => parseNaboteigQuery(params), error => error instanceof TeigError && error.status === 400);
      }
      for (const [field, value] of [
        ["kommunenummer", "0000"], ["vest", ""], ["vest", "NaN"], ["ost", "Infinity"], ["sor", "-91"],
        ["nord", "90"], ["vest", "-181"], ["ost", "181"], ["vest", "5.005"], ["nord", "60.001"],
        ["nord", "60.02"], ["ost", "5.02"], ["vest", " 5.001"], ["vest", "0x5"]
      ]) {
        const params = new URLSearchParams(naboQueryString);
        params.set(field, value);
        assert.throws(() => parseNaboteigQuery(params), error => error instanceof TeigError && error.status === 400, `${field}=${value}`);
      }
      for (const suffix of ["&vest=5.001", "&gnr=105", "&personId=person-395", "&fil=annen.json"]) {
        assert.throws(() => parseNaboteigQuery(new URLSearchParams(naboQueryString + suffix)));
      }
    });

    await t.test("Naboindeksen bevarer hull, utelater fjerne teiger og avviser avkorting", async () => {
      const nearby = feature(2);
      nearby.properties.BNR = 210;
      const distant = feature(3);
      distant.geometry = { type: "Polygon", coordinates: [[[6, 61], [6.001, 61], [6.001, 61.001], [6, 61]]] };
      await save({ ...valid, features: [feature(), { ...nearby, properties: { ...nearby.properties, eiere: ["skal ikke ut"] } }, distant] });
      const store = createTeigStore(file);
      const selected = await store.getTeiger(query);
      const loaded = store.getStatus().lastetTidspunkt;
      const result = await store.getNaboteiger(naboQuery);
      assert.deepEqual(result.features.map(f => f.id), [1, 2]);
      assert.strictEqual(result.features[0], selected.features[0]);
      assert.equal(result.features[0].geometry.coordinates.length, 2);
      assert.equal(result.avkortet, false);
      assert.equal(store.getStatus().lastetTidspunkt, loaded);
      assert(!JSON.stringify(result).includes("eiere"));
      assert.deepEqual((await store.getNaboteiger({ ...naboQuery, vest: 7, ost: 7.003 })).features, []);
      await save({ ...valid, features: Array.from({ length: 201 }, (_, i) => feature(i + 1)) });
      await assert.rejects(store.getNaboteiger(naboQuery), error => error instanceof TeigError && error.status === 400);
      await save(valid);
      assert.equal((await store.getNaboteiger(naboQuery)).features.length, 1);
      await writeFile(file, "ugyldig");
      await assert.rejects(store.getNaboteiger(naboQuery), isDatasetError);
      await save(valid);
    });

    await t.test("Alle teiger, seksjoner og hull beholdes uten fremmede felter", async () => {
      const first = feature();
      const section = feature(2, 3);
      section.properties.ANTALL_GID = 0;
      const multi = feature(3);
      multi.geometry = { type: "MultiPolygon", coordinates: [first.geometry.coordinates as number[][][], [
        [[5.02, 60], [5.03, 60], [5.03, 60.01], [5.02, 60]]
      ]] };
      multi.properties.AREAL = null;
      multi.properties.AREALMERKNAD = "Areal mangler i kilden";
      multi.properties.TINGLYST = "-";
      multi.properties.ANTALL_GID = 2;
      const unrelated = feature(5);
      unrelated.properties.BNR = 210;
      await save({
        ...valid,
        eiere: ["skal ikke ut"],
        features: [
          { ...first, eiere: ["skal ikke ut"], properties: { ...first.properties, eiere: ["skal ikke ut"], TEIGID: "oppdiktet" },
            geometry: { ...first.geometry, eier: "skal ikke ut" } },
          section, multi, feature(4, 0, 1), unrelated
        ]
      });
      const store = createTeigStore(file);
      const result = await store.getTeiger(query);
      assert.deepEqual(result.features, [first, section, multi]);
      assert.deepEqual((await store.getTeiger({ ...query, fnr: 1 })).features, [feature(4, 0, 1)]);
      assert.equal(result.kilde.fil, "teiger.json");
      assert.equal(result.kilde.uttrekksaar, null);
      assert.equal(result.kilde.koordinatsystem, "EPSG:4326");
      assert(!JSON.stringify(result).includes("skal ikke ut"));
      assert(!JSON.stringify(result).includes("TEIGID"));
      assert.equal(store.getStatus().antallTeiger, 5);
      assert.equal(store.getStatus().antallEiendommer, 3);
      const missing = await store.getTeiger({ ...query, bnr: 999 });
      assert.equal(missing.kildestatus, "tilgjengelig");
      assert.deepEqual(missing.features, []);
    });

    await t.test("Samtidige og gjentatte kall deler indeks, filendring erstatter den", async () => {
      await save(valid);
      const store = createTeigStore(file);
      const results = await Promise.all(Array.from({ length: 12 }, () => store.getTeiger(query)));
      for (const result of results) assert.strictEqual(result.features, results[0].features);
      const lastet = store.getStatus().lastetTidspunkt;
      assert.strictEqual((await store.getTeiger(query)).features, results[0].features);
      assert.equal(store.getStatus().lastetTidspunkt, lastet);
      await save({ ...valid, features: [feature(7)] });
      await utimes(file, new Date("2025-01-02T00:00:00Z"), new Date("2025-01-02T00:00:00Z"));
      const changed = await store.getTeiger(query);
      assert.equal(changed.features[0].id, 7);
      assert.notStrictEqual(changed.features, results[0].features);
      await writeFile(file, "ikke JSON", "utf8");
      await assert.rejects(store.getTeiger(query), isDatasetError);
      assert.equal(store.getStatus().antallTeiger, undefined);
      await save(valid);
      assert.equal((await store.getTeiger(query)).features[0].id, 1);
    });

    await t.test("Hele datasettet valideres før indeksen publiseres", async () => {
      const store = createTeigStore(file);
      const malformed: unknown[] = [
        null, [], {}, { type: "FeatureCollection", features: {} },
        { ...valid, crs: { type: "name", properties: { name: "EPSG:25832" } } },
        { ...valid, features: [feature(), feature()] }
      ];
      for (const [key, value] of Object.entries(feature().properties)) {
        const missing = { ...feature().properties } as Record<string, unknown>;
        delete missing[key];
        malformed.push({ ...valid, features: [{ ...feature(), properties: missing }] });
        malformed.push({ ...valid, features: [{ ...feature(), properties: {
          ...feature().properties, [key]: typeof value === "number" ? String(value) : false
        } }] });
      }
      const badGeometries = [
        null, { type: "Point", coordinates: [5, 60] },
        { type: "Polygon", coordinates: [] }, { type: "MultiPolygon", coordinates: [] },
        { type: "Polygon", coordinates: [[[5, 60], [6, 60], [5, 61]]] },
        { type: "Polygon", coordinates: [[[5, 60], [6, 60], [5, 61], [5, 62]]] },
        { type: "Polygon", coordinates: [[[5, 60], [5, 60], [5, 60], [5, 60]]] },
        { type: "Polygon", coordinates: [[[5, 60], [181, 60], [5, 61], [5, 60]]] },
        { type: "Polygon", coordinates: [[[5, 60], [6, 91], [5, 61], [5, 60]]] },
        { type: "Polygon", coordinates: [[[5, 60], [6, null], [5, 61], [5, 60]]] },
        { type: "Polygon", coordinates: [[[5, 60], [6, "60"], [5, 61], [5, 60]]] },
        { type: "Polygon", coordinates: [[[5, 60], [6, 60, 0, 0], [5, 61], [5, 60]]] },
        { type: "MultiPolygon", coordinates: [[], feature().geometry.coordinates] }
      ];
      for (const geometry of badGeometries) malformed.push({ ...valid, features: [{ ...feature(), geometry }] });
      malformed.push({ ...valid, features: [{ ...feature(), id: 9 }] });
      malformed.push({ ...valid, features: [{ ...feature(), properties: { ...feature().properties, GNR: 1.5 } }] });
      malformed.push({ ...valid, features: [feature(), { ...feature(2), geometry: null }] });
      for (const value of malformed) {
        await save(value);
        await assert.rejects(store.getTeiger(query), isDatasetError);
        assert.equal(store.getStatus().status, "feil");
      }
      await writeFile(file, JSON.stringify(valid).replace('"AREAL":1200', '"AREAL":1e999'), "utf8");
      await assert.rejects(store.getTeiger(query), isDatasetError);
      await writeFile(file, JSON.stringify(valid).replace("[5,60]", "[1e999,60]"), "utf8");
      await assert.rejects(store.getTeiger(query), isDatasetError);
      await save(valid);
      assert.equal((await store.getTeiger(query)).features[0].id, 1);
      await rm(file);
      await assert.rejects(store.getTeiger(query), isDatasetError);
      await save(valid);
      assert.equal((await store.getTeiger(query)).features[0].id, 1);
      await assert.rejects(createTeigStore(fixtureDir).getTeiger(query), isDatasetError);
    });

    await t.test("Det ekte uttrekket dekker begge eiendommene uten å endre identitet", async () => {
      const store = createTeigStore(path.resolve("data/matrikkel_bk_25.json"));
      const [first, second] = await Promise.all([
        store.getTeiger(query), store.getTeiger({ ...query, gnr: 20, bnr: 1413 })
      ]);
      assert.deepEqual(first.features.map((f) => f.id), [8464]);
      assert.deepEqual(second.features.map((f) => f.id), [32713]);
      assert.equal(first.features[0].properties.OBJECTID, 8464);
      assert.equal(second.features[0].properties.OBJECTID, 32713);
      assert.equal(first.kilde.uttrekksaar, 2025);
      assert.equal(first.kilde.fil, "matrikkel_bk_25.json");
      assert.equal(first.kilde.syntetisk, false);
      assert.equal(store.getStatus().antallTeiger, 21258);
      for (const [selected, expectedIds] of [
        [first, [45569, 45588, 84381]],
        [second, [1657, 1958, 24351, 31812, 31889, 32010, 32012, 32694, 32695, 32696, 32697, 32711, 32712, 32714, 75564]]
      ] as const) {
        const bounds = getGeometriBounds(selected.features[0].geometry), d = 15 / 111320;
        const dx = d / Math.cos((bounds.sor + bounds.nord) / 2 * Math.PI / 180);
        const result = await store.getNaboteiger({ kommunenummer: "4601",
          vest: bounds.vest - dx, sor: bounds.sor - d, ost: bounds.ost + dx, nord: bounds.nord + d });
        const neighbours = result.features.filter(f => f.id !== selected.features[0].id);
        assert.deepEqual(neighbours.map(f => f.id), expectedIds);
        assert(neighbours.every(f => f.properties.BNR !== selected.features[0].properties.BNR
          || f.properties.GNR !== selected.features[0].properties.GNR));
        assert.equal(result.kilde.fil, "matrikkel_bk_25.json");
        assert(!JSON.stringify(result).includes("eiere"));
      }
    });

    await t.test("HTTP-ruten isolerer kommunen, feiler lukket og lar helsen være uavhengig", async () => {
      const port = await freePort();
      const base = `http://127.0.0.1:${port}`;
      const httpFile = path.join(fixtureDir, "http-teiger.json");
      const eierFile = path.join(fixtureDir, "eiere.json");
      await writeFile(eierFile, '{"eierforhold":[]}');
      let output = "";
      const child = spawn(process.execPath, ["apps/matrikkel-mock/src/server.ts"], {
        env: {
          ...process.env, PORT: String(port), STATE_DIR: fixtureDir,
          MATRIKKEL_DATA_FILE: path.resolve("data/matrikkel.seed.json"),
          MATRIKKEL_TEIG_DATA_FILE: httpFile, EIERFORHOLD_DATA_FILE: eierFile,
          GEONORGE_ADRESSE_API_BASE_URL: "http://127.0.0.1:1"
        },
        stdio: ["ignore", "pipe", "pipe"]
      });
      child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
      child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
      const stopped = once(child, "exit");
      async function get(url: string, status = 200): Promise<Record<string, any>> {
        const response = await fetch(`${base}${url}`, { signal: AbortSignal.timeout(5000) });
        const body = await response.json() as Record<string, any>;
        assert.equal(response.status, status, `${url}: ${JSON.stringify(body)}`);
        return body;
      }
      try {
        let ready = false;
        for (let attempt = 0; attempt < 80; attempt += 1) {
          if (child.exitCode !== null) throw new Error(`Matrikkel-mock stoppet: ${output}`);
          try {
            const response = await fetch(`${base}/helse`, { signal: AbortSignal.timeout(1000) });
            if (response.ok) { ready = true; break; }
          } catch { /* Startup is retried below. */ }
          await wait(50);
        }
        assert(ready, `Matrikkel-mock startet ikke: ${output}`);
        assert.equal((await get("/helse")).teigdatasett.status, "ikke_lastet");
        for (const field of ["kommunenummer", "vest", "sor", "ost", "nord"]) {
          const params = new URLSearchParams(naboQueryString);
          params.delete(field);
          await get(`/mock/matrikkel/naboteiger?${params}`, 400);
        }
        const uncovered = await get(`/mock/matrikkel/naboteiger?${naboQueryString.replace("4601", "0301")}`);
        assert.equal(uncovered.kildestatus, "ikke_dekket");
        assert.deepEqual(uncovered.features, []);
        for (const kommunenummer of ["0201", "0301"]) {
          const result = await get(`/mock/matrikkel/teiger?kommunenummer=${kommunenummer}&gnr=105&bnr=209`);
          assert.equal(result.kildestatus, "ikke_dekket");
          assert.deepEqual(result.features, []);
          assert.equal(result.kilde.fil, null);
        }
        assert.equal((await get("/helse")).teigdatasett.status, "ikke_lastet");
        for (const input of [
          "", "gnr=105&bnr=209", "kommunenummer=4601&bnr=209", "kommunenummer=4601&gnr=105",
          "kommunenummer=4601&gnr=abc&bnr=209", `${queryString}&fnr=-1`,
          `${queryString}&gnr=1`, `${queryString}&snr=4`
        ]) {
          assert.equal(typeof (await get(`/mock/matrikkel/teiger?${input}`, 400)).feil, "string");
        }
        assert.equal((await get("/helse")).teigdatasett.status, "ikke_lastet");
        const missing = await get(`/mock/matrikkel/teiger?${queryString}`, 502);
        await get(`/mock/matrikkel/naboteiger?${naboQueryString}`, 502);
        assert.equal(typeof missing.feil, "string");
        assert(!JSON.stringify(missing).includes(fixtureDir));
        assert.equal((await get("/helse")).teigdatasett.status, "feil");
        await writeFile(httpFile, JSON.stringify({
          ...valid, features: [feature(), feature(2, 4), {
            ...feature(3, 0, 1), properties: { ...feature(3, 0, 1).properties, eiere: ["hemmelig"] }
          }]
        }));
        const requests = await Promise.all(Array.from({ length: 8 }, () => get(`/mock/matrikkel/teiger?${queryString}`)));
        const neighbours = await get(`/mock/matrikkel/naboteiger?${naboQueryString}`);
        assert.deepEqual(neighbours.features.map((f: MatrikkelTeigFeature) => f.id), [1, 2, 3]);
        assert.equal(neighbours.avkortet, false);
        assert(!JSON.stringify(neighbours).includes("hemmelig"));
        for (const result of requests) assert.deepEqual(result.features.map((f: MatrikkelTeigFeature) => f.id), [1, 2]);
        assert.equal(requests[0].kilde.fil, "http-teiger.json");
        assert.equal(requests[0].kilde.uttrekksaar, null);
        const festenummer = await get(`/mock/matrikkel/teiger?${queryString}&fnr=1`);
        assert.deepEqual(festenummer.features.map((f: MatrikkelTeigFeature) => f.id), [3]);
        assert(!JSON.stringify(festenummer).includes("hemmelig"));
        assert.equal((await get("/helse")).teigdatasett.antallTeiger, 3);
        const noMatch = await get("/mock/matrikkel/teiger?kommunenummer=4601&gnr=1&bnr=1");
        assert.equal(noMatch.kildestatus, "tilgjengelig");
        assert.deepEqual(noMatch.features, []);
        const zeroBnr = await get("/mock/matrikkel/teiger?kommunenummer=4601&gnr=105&bnr=0");
        assert.equal(zeroBnr.kildestatus, "tilgjengelig");
        assert.deepEqual(zeroBnr.features, []);
        await writeFile(httpFile, '{"type":"FeatureCollection","features":[null]}');
        await get(`/mock/matrikkel/teiger?${queryString}`, 502);
        assert.equal((await get("/helse")).teigdatasett.status, "feil");
        await writeFile(httpFile, "{ødelagt JSON}");
        await get(`/mock/matrikkel/teiger?${queryString}`, 502);
        await rm(httpFile);
        await get(`/mock/matrikkel/teiger?${queryString}`, 502);
        await writeFile(httpFile, JSON.stringify(valid));
        assert.equal((await get(`/mock/matrikkel/teiger?${queryString}`)).features[0].id, 1);
        assert.equal((await get("/helse")).teigdatasett.status, "tilgjengelig");
        const many = Array.from({ length: 501 }, (_, index) => feature(index + 1, index % 3));
        await writeFile(httpFile, JSON.stringify({ ...valid, features: many }));
        const allMatches = await get(`/mock/matrikkel/teiger?${queryString}`);
        assert.deepEqual(allMatches.features, many, "API-et skal ikke avkorte flere enn 500 treff.");
        assert.equal((await get("/helse")).teigdatasett.antallTeiger, 501);
        assert((await get("/mock/matrikkel/gater")).length > 0);
        assert.equal((await get("/mock/matrikkel/eiendom-oppslag?adresse=Storgata%205")).adresse, "Storgata 5");
        await get("/mock/matrikkel/teiger/datasett", 404);
        await get("/data/matrikkel_bk_25.json", 404);
        const spec = await fetch(`${base}/openapi.yaml`);
        assert((await spec.text()).includes("/mock/matrikkel/teiger:"));
      } finally {
        child.kill("SIGTERM");
        await stopped;
      }
    });
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), valid);
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});
