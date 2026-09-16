// FALSK GEONORGE
//
// Den ene falske adressetjenesten testene svarer fra. Både
// scripts/test-matrikkel-mock.ts og scripts/test-tools-matrikkel.ts sto med hver
// sin, og de gikk fra hverandre: den ene foldet «ø» til «o», den andre slettet
// den, så en gate med æ, ø eller å fikk ulikt svar i de to. Fiksturen har
// `Bjørn Bondes vei` nettopp for å prøve det.
//
// Den bor i scripts/ og ikke i apps/shared/ fordi ingen tjeneste bruker den.
// Matchingen og folderegelen den hviler på ligger i scripts/geonorge.ts, sammen
// med klienten importen bruker.

import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GeonorgeAdresse } from "../apps/shared/registerdata.ts";
import { fiksturSok } from "./geonorge.ts";

/**
 * Adressene i data/geonorge.fixtur.json, fanget fra den ekte tjenesten.
 *
 * Stien regnes ut fra modulen og ikke fra arbeidskatalogen, slik søskenskriptene
 * i scripts/ gjør: en test kjørt fra en annen katalog enn reporoten skal ikke
 * feile på ENOENT.
 */
export function lesGeonorgeFikstur(): GeonorgeAdresse[] {
  const fil = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data/geonorge.fixtur.json");
  return (JSON.parse(readFileSync(fil, "utf8")) as { adresser: GeonorgeAdresse[] }).adresser;
}

/**
 * En tjener som svarer på `/sok` fra fiksturen.
 *
 * Fiksturen er fanget fra Geonorge nettopp fordi den må bære `adressekode`,
 * `gardsnummer` og `representasjonspunkt` - feltene matrikkel-id-en hviler på.
 * En fikstur skrevet for hånd ville vært grønn mens det ekte feilet.
 */
export function lagGeonorgeFikstur(): Server {
  const adresser = lesGeonorgeFikstur();
  return createServer((request, response) => {
    const url = new URL(request.url!, `http://${request.headers.host}`);
    if (request.method !== "GET" || url.pathname !== "/sok") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(fiksturSok(
      adresser, url.searchParams.get("sok") || "", url.searchParams.get("kommunenummer"))));
  });
}
