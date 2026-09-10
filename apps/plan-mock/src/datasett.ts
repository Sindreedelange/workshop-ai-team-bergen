/**
 * Hvilken fil hvert plandatasett ligger i, og hvilke kolonner det bruker.
 *
 * Dette er plan-mockens kunnskap om sine egne seedfiler, og hører her av samme
 * grunn som teigfilens form hører i `apps/matrikkel-mock/src/teiger.ts`: bare
 * denne tjenesten leser filene. Det som er felles - kodeverket, datasett-id-ene
 * og formen på tråden - står i `apps/shared/hensynssoner.ts`.
 *
 * `kodefelt` varierer fra fil til fil fordi kommunen eksporterer ett lag per
 * hensynstype og gir kodekolonnen navn etter laget. Det er datasettets form,
 * ikke vår, og leseren må lese feltnavnet herfra i stedet for å gjette.
 */
import type { Datasettid } from "../../shared/hensynssoner.ts";

export type Plandatasett = {
  /** Identifikatoren på tråden. Fryst når den først står. */
  id: Datasettid;
  fil: string;
  /** Kolonnen sonekoden står i. Se kommentaren over. */
  kodefelt: string;
  /** Kolonnen med sonenavnet, når datasettet har et. Arealformål har det ikke. */
  navnefelt: string | null;
  /** OBJTYPE, som er sin egen verdi per fil. Leseren avviser en fil som ikke bærer den. */
  objekttype: string;
};

export const HENSYNSSONEDATASETT: readonly Plandatasett[] = [
  { id: "stoy", fil: "KpStøySone_gul_2018.geojson", kodefelt: "KPSTOY", navnefelt: "HENSYNSONENAVN", objekttype: "KpStøySone" },
  { id: "fare", fil: "KpFareSone_2018.geojson", kodefelt: "KPFARE", navnefelt: "HENSYNSONENAVN", objekttype: "KpFareSone" },
  { id: "friluftsliv", fil: "KpAngitthensyn_friluftsliv_2018.geojson", kodefelt: "KPANGITTHENSYN", navnefelt: "HENSYNSONENAVN", objekttype: "KpAngittHensynSone" },
  { id: "landskap", fil: "KpAngitthensyn_landskap_2018.geojson", kodefelt: "KPANGITTHENSYN", navnefelt: "HENSYNSONENAVN", objekttype: "KpAngittHensynSone" },
  { id: "naturmiljoe", fil: "KpAngitthensyn_naturmiljø_2018.geojson", kodefelt: "KPANGITTHENSYN", navnefelt: "HENSYNSONENAVN", objekttype: "KpAngittHensynSone" },
  { id: "kulturmiljoe", fil: "KpAngitthensyn_kulturmiljø_2018.geojson", kodefelt: "KPANGITTHENSYN", navnefelt: "HENSYNSONENAVN", objekttype: "KpAngittHensynSone" },
];

export const AREALFORMAALDATASETT: Plandatasett = {
  id: "arealformaal", fil: "KpArealformålOmråde_2018.geojson",
  kodefelt: "KPAREALFORMAL", navnefelt: null, objekttype: "KpArealformålOmråde",
};
