#!/usr/bin/env node

/*
 * Holder påstanden om at ingen tjeneste leser en innsjekket registerfil.
 *
 * Sandkassen hentet en gang 12,6 MB adressegrunnlag fra disk. Nå spør den
 * Geonorge ved oppslag, og det eneste som ligger igjen er de fire håndskrevne
 * bergensgatene i data/matrikkel.seed.json. Det er lett å miste: et uttrekk som
 * ble lagt tilbake «bare for demoen» ville virket, og ingen test ville sagt fra.
 *
 * Sjekken går derfor begge veier. Den ser at de store filene er borte fra disk,
 * og - når mocken kjører - at den faktisk leser fiksturen og ikke noe annet.
 *
 * Bruk: node scripts/check-matrikkel-data-source.ts [--url=...] [--data-file=...]
 */

import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { feilmelding } from "../apps/shared/errors.ts";

const repoRot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultUrl = process.env.MATRIKKEL_HEALTH_URL || "http://localhost:8085/helse";
const defaultDataFile = process.env.MATRIKKEL_DATA_FILE || "data/matrikkel.seed.json";

/** Filer som ikke skal komme tilbake, og hva de ble erstattet av. */
const FORBUDTE_FILER: readonly { fil: string; erstattetAv: string }[] = [
  { fil: "data/matrikkel.json", erstattetAv: "Geonorges adresse-API, ved oppslag" },
  { fil: "data/matrikkel_bk_25.json", erstattetAv: "Kartverkets eiendoms-API, ved oppslag" },
];

/** Taket på hvor stor en sporet datafil under data/ får være. */
const MAKS_MEGABYTE = 2;

function parseArgs(argv: string[]) {
  const opts = { url: defaultUrl, dataFile: defaultDataFile };
  for (const arg of argv) {
    if (arg.startsWith("--url=")) opts.url = arg.slice("--url=".length);
    if (arg.startsWith("--data-file=")) opts.dataFile = arg.slice("--data-file=".length);
  }
  return opts;
}

/** Størrelsen i byte, eller null om filen ikke finnes. Étt syscall, ikke to. */
async function filstoerrelse(filbane: string): Promise<number | null> {
  try {
    return (await stat(path.resolve(repoRot, filbane))).size;
  } catch {
    return null;
  }
}

function formatKilde(kilde: { fil?: string; format?: string; [felt: string]: unknown } | null): string {
  if (!kilde) return "ukjent";
  const fil = kilde.fil ? ` fil=${kilde.fil}` : "";
  return `${kilde.format || "ukjent"}${fil}`.trim();
}

/** Første halvdel: filene som ikke skal finnes. Krever verken nett eller tjeneste. */
async function sjekkDisk(): Promise<string[]> {
  const feil: string[] = [];
  for (const { fil, erstattetAv } of FORBUDTE_FILER) {
    const bytes = await filstoerrelse(fil);
    if (bytes !== null) {
      feil.push(
        `${fil} er tilbake (${(bytes / 1024 / 1024).toFixed(1)} MB). Den ble erstattet av ${erstattetAv}, `
        + `og en tjeneste som leser den igjen svarer fra en frossen kopi uten å si fra.`
      );
    }
  }
  // Begge de sporede filene har et tak, og det er det taket som holder skillet
  // mellom en fikstur og et uttrekk ærlig. Uten det kunne et uttrekk kommet
  // tilbake under et navn sjekken over ikke kjenner.
  for (const { fil, hva } of [
    { fil: "data/matrikkel.seed.json", hva: "De fire håndskrevne bergensgatene er demoenes faste holdepunkt." },
    { fil: "data/geonorge.fixtur.json", hva: "Den falske Geonorge i testene svarer fra den, og ingen tjeneste leser den." },
  ]) {
    const bytes = await filstoerrelse(fil);
    if (bytes === null) {
      feil.push(`${fil} mangler. ${hva}`);
    } else if (bytes > MAKS_MEGABYTE * 1024 * 1024) {
      feil.push(
        `${fil} er ${(bytes / 1024 / 1024).toFixed(1)} MB. Over ${MAKS_MEGABYTE} MB er den et uttrekk `
        + `med et annet navn, ikke en fikstur.`
      );
    }
  }
  return feil;
}

/** Andre halvdel: hva den kjørende mocken faktisk leste. Hoppes over om den er nede. */
async function sjekkTjeneste(url: string, dataFile: string): Promise<string[]> {
  let body: any;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Svarene er any med vilje - se scripts/test-agent-natural-language.ts for begrunnelsen.
    body = await res.json();
  } catch (error) {
    console.log(`matrikkel-mock svarer ikke på ${url} (${feilmelding(error)}). Hopper over kildesjekken.`);
    return [];
  }

  const kilde = body.kilde || null;
  console.log("matrikkel-mock datakilde (live)");
  if (kilde?.fil) console.log(`- fil: ${kilde.fil}`);
  if (kilde?.format) console.log(`- format: ${kilde.format}`);
  if (body.antallGater !== undefined) console.log(`- antallGater: ${body.antallGater}`);
  if (body.antallEiendommer !== undefined) console.log(`- antallEiendommer: ${body.antallEiendommer}`);
  if (body.lastetTidspunkt) console.log(`- lastetTidspunkt: ${body.lastetTidspunkt}`);
  if (!kilde?.fil && !kilde?.format) console.log(`- kilde: ${formatKilde(kilde)}`);

  const lest = String(kilde?.fil || "");
  if (lest && !lest.endsWith("matrikkel.seed.json") && !lest.endsWith(path.basename(dataFile))) {
    return [`Mocken leser ${lest}. Den skal lese fiksturen og hente resten fra Geonorge.`];
  }
  return [];
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const feil = [...await sjekkDisk(), ...await sjekkTjeneste(opts.url, opts.dataFile)];
  if (feil.length > 0) {
    console.error(`\n${feil.length} problem med matrikkelkilden:`);
    for (const linje of feil) console.error(`  - ${linje}`);
    process.exitCode = 1;
    return;
  }
  console.log("\nMatrikkelkilden er som den skal: fiksturen på disk, resten fra API.");
}

main();
