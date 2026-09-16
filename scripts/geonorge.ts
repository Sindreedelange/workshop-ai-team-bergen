// GEONORGE-OPPSLAG
//
// The paged street query against Geonorge's open address API, and the exact-name
// filter that goes with it. Both `scripts/importer-tenor.ts` and
// `scripts/hent-geonorge-fikstur.ts` need them, and they must agree: the importer
// mints the matrikkel ids the population is joined on, and the fixture is what the
// offline tests replay. A second copy that drifted would make a green test lie.

import type { GeonorgeAdresse } from "../apps/shared/registerdata.ts";

export const GEONORGE_BASE_URL =
  process.env.GEONORGE_ADRESSE_API_BASE_URL || "https://ws.geonorge.no/adresser/v1";

const SIDESTOERRELSE = 1000;

/** Folding, not display. Kept as one rule so the importer and the fake Geonorge fold a street name the same way. */
export function normaliserGatenavn(verdi: unknown): string {
  return String(verdi || "")
    .toLowerCase()
    .replace(/[æ]/g, "ae")
    .replace(/[ø]/g, "o")
    .replace(/[å]/g, "a")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Every address on one street in one kommune.
 *
 * The API matches on prefix, so «Fjellgata» also returns «Fjellgaten». Only the
 * exact street is wanted - otherwise a person's address would join to a property
 * in a different street with a similar name.
 */
export async function hentGate(
  kommunenummer: string,
  adressenavn: string
): Promise<GeonorgeAdresse[]> {
  const adresser: GeonorgeAdresse[] = [];
  for (let side = 0; ; side += 1) {
    const url = `${GEONORGE_BASE_URL}/sok?kommunenummer=${encodeURIComponent(kommunenummer)}`
      + `&adressenavn=${encodeURIComponent(adressenavn)}`
      + `&treffPerSide=${SIDESTOERRELSE}&side=${side}&asciiKompatibel=false`;
    const svar = await fetch(url, { headers: { Accept: "application/json" } });
    if (!svar.ok) {
      throw new Error(`Geonorge svarte ${svar.status} for ${adressenavn} i ${kommunenummer}.`);
    }
    const data = (await svar.json()) as { adresser?: GeonorgeAdresse[] };
    const treff = data.adresser || [];
    adresser.push(...treff.filter(a => normaliserGatenavn(a.adressenavn) === normaliserGatenavn(adressenavn)));
    if (treff.length < SIDESTOERRELSE) break;
  }
  return adresser;
}

/**
 * Treffer en fikstur-adresse søketeksten?
 *
 * Den ekte tjenesten søker fritt. En ren delstrengsjekk ryker så snart kalleren
 * tar med postnummer eller adressetillegg, så kjernen - gatenavn, husnummer og
 * bokstav - sammenlignes begge veier.
 *
 * Regelen står her og ikke i hver test, fordi to kopier allerede hadde gått fra
 * hverandre: den ene foldet `ø` til `o`, den andre slettet den. De to falske
 * tjenestene svarte da ulikt for en gate med æ, ø eller å - og fiksturen har
 * `Bjørn Bondes vei` nettopp for å prøve dem.
 */
function fiksturTreff(adresse: GeonorgeAdresse, sok: string): boolean {
  const spor = normaliserGatenavn(sok);
  if (!spor) return false;
  const kjerne = normaliserGatenavn(`${adresse.adressenavn}${adresse.nummer}${adresse.bokstav || ""}`);
  return normaliserGatenavn(adresse.adressetekst).includes(spor)
    || normaliserGatenavn(adresse.adressenavn).includes(spor)
    || kjerne.includes(spor) || spor.includes(kjerne);
}

/**
 * Hele svaret en falsk Geonorge gir på et `/sok`, fra en fikstur.
 *
 * Konvolutten - `metadata.totaltAntallTreff` og `adresser` - er Geonorges
 * kontrakt, og den sto i to testfiler. Selve tjeneren er forskjellig i de to
 * (den ene har scenarioer og feilinjeksjon), men det den svarer med er ikke.
 */
export function fiksturSok(
  adresser: readonly GeonorgeAdresse[], sok: string, kommunenummer?: string | null
): { metadata: { totaltAntallTreff: number }; adresser: GeonorgeAdresse[] } {
  const treff = adresser.filter(adresse =>
    (!kommunenummer || adresse.kommunenummer === kommunenummer) && fiksturTreff(adresse, sok));
  return { metadata: { totaltAntallTreff: treff.length }, adresser: treff };
}
