import type { GeonorgeAdresse } from "./registerdata.ts";

export type Adresse = {
  adressenavn: string;
  husnummer: number;
  husbokstav: string;
  adressetilleggsnavn?: string;
  postnummer?: string;
  poststed?: string;
};

export function buildEiendomKey(eiendom: {
  matrikkelId?: unknown;
  kommunenummer?: unknown;
  gnr?: unknown;
  bnr?: unknown;
  festenummer?: unknown;
  undernummer?: unknown;
  postnummer?: unknown;
}): string {
  return JSON.stringify([eiendom.matrikkelId, eiendom.kommunenummer, eiendom.gnr, eiendom.bnr,
    eiendom.festenummer, eiendom.undernummer, eiendom.postnummer]);
}

function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

export function parseAdresse(value: unknown): Adresse | null {
  if (typeof value !== "string") return null;
  const text = value.normalize("NFKC").replace(/\s+/gu, " ").trim()
    .replace(/(?:,\s*|\s+)(?:norge|norway)$/iu, "");
  const supplement = text.match(/^([^,]+),\s*(?=[\p{L}\d][\p{L}\d .'-]*?\s+[1-9]\d*)/u);
  const main = supplement ? text.slice(supplement[0].length) : text;
  const match = main.match(/^([\p{L}\d][\p{L}\d .'-]*?)\s+([1-9]\d*)\s*([\p{L}]?)(?:(?:\s*,\s*|\s+)(\d{4})(?:\s+([\p{L}][\p{L} .'-]*))?)?$/iu);
  if (!match || !/\p{L}/u.test(match[1]) || !Number.isSafeInteger(Number(match[2]))) return null;
  return {
    adressenavn: match[1].replace(/\s+/gu, " ").trim(),
    husnummer: Number(match[2]),
    husbokstav: match[3].toUpperCase(),
    adressetilleggsnavn: supplement?.[1].trim(),
    postnummer: match[4],
    poststed: match[5]?.trim()
  };
}

export function adressekjerne(adresse: Adresse): string {
  return `${adresse.adressenavn} ${adresse.husnummer}${adresse.husbokstav}`;
}

export function adresseSoek(adresse: Adresse): string {
  return [adresse.adressetilleggsnavn, adressekjerne(adresse),
    [adresse.postnummer, adresse.poststed].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

export function matchesAdresse(
  query: Adresse,
  candidate: unknown,
  postnummer?: string,
  poststed?: string,
  adressetilleggsnavn?: string
): boolean {
  const parsed = parseAdresse(candidate);
  return parsed !== null
    && normalize(query.adressenavn) === normalize(parsed.adressenavn)
    && query.husnummer === parsed.husnummer
    && query.husbokstav === parsed.husbokstav
    && (!query.adressetilleggsnavn || normalize(query.adressetilleggsnavn)
      === normalize(adressetilleggsnavn || parsed.adressetilleggsnavn || ""))
    && (!query.postnummer || query.postnummer === (postnummer || parsed.postnummer))
    && (!query.poststed || normalize(query.poststed) === normalize(poststed || parsed.poststed || ""));
}

type Adressefelter = {
  adressenavn?: unknown;
  husnummer?: unknown;
  husbokstav?: unknown;
  adresse?: unknown;
  adressetilleggsnavn?: unknown;
  postnummer?: unknown;
  poststed?: unknown;
};

export function matchesAdresseFields(query: Adresse, candidate: Adressefelter): boolean {
  if (!candidate || typeof candidate.adressenavn !== "string"
    || !Number.isInteger(candidate.husnummer) || Number(candidate.husnummer) <= 0
    || (candidate.husbokstav != null && typeof candidate.husbokstav !== "string")) return false;
  const display = parseAdresse(candidate.adresse);
  const supplement = typeof candidate.adressetilleggsnavn === "string"
    ? candidate.adressetilleggsnavn : display?.adressetilleggsnavn;
  const postnummer = typeof candidate.postnummer === "string" ? candidate.postnummer : undefined;
  const poststed = typeof candidate.poststed === "string" ? candidate.poststed : undefined;
  const core = `${candidate.adressenavn} ${candidate.husnummer}${candidate.husbokstav || ""}`;
  // Presentation text may include a building/farm name. The structured address is
  // authoritative; a parseable display must still agree about street and number.
  return matchesAdresse(query, core, postnummer, poststed, supplement)
    && (!display || matchesAdresse(
      { ...display, adressetilleggsnavn: undefined, postnummer: undefined, poststed: undefined }, core));
}

// --- Matrikkel-id fra en Geonorge-adresse ----------------------------------

/**
 * Identifikatoren en adresse får i sandkassen, utledet av adressen selv.
 *
 * Den bor her, og ikke i den enkelte tjenesten, fordi tre kallere må komme fram
 * til nøyaktig samme streng: `scripts/importer-tenor.ts` preger den inn i
 * `data/eierforhold.json` og `data/personer.json`, mens `matrikkel-mock` og
 * `tools-api` bygger den på nytt for hvert live-oppslag mot Geonorge. Blir de
 * uenige, slutter eierskapet å koble - og det skjer uten en eneste feilmelding,
 * fordi et oppslag uten treff i eierregisteret ser ut som en eiendom uten eier.
 *
 * Formen er `matr-geo-{kommunenummer}-{adressekode}-{husnummer}{husbokstav}`.
 * Over de 18 329 vegadressene uttrekket hadde, er den tuppelen unik, og gnr/bnr
 * la ingenting til - derfor står de ikke i id-en.
 */
export function byggMatrikkelId(adresse: GeonorgeAdresse): string {
  const kommunenummer = String(adresse?.kommunenummer || "").trim();
  const adressekode = heltall(adresse?.adressekode);
  const husnummer = heltall(adresse?.nummer);
  const husbokstav = String(adresse?.bokstav || "").trim().toUpperCase();

  // En matrikkeladresse har ingen adressekode, og uten en egen gren ville alle
  // slike i en kommune blitt `matr-geo-4601-0-0` - én id for tusenvis av
  // eiendommer. Geonorge gir i stedet gårds-, bruks-, feste- og undernummer,
  // og det firetallet er det som skiller dem.
  if (adressekode === null || husnummer === null) {
    return `matr-geo-${kommunenummer}-g${heltall(adresse?.gardsnummer) ?? 0}`
      + `-b${heltall(adresse?.bruksnummer) ?? 0}`
      + `-f${heltall(adresse?.festenummer) ?? 0}`
      + `-u${heltall(adresse?.undernummer) ?? 0}`;
  }
  return `matr-geo-${kommunenummer}-${adressekode}-${husnummer}${husbokstav}`;
}

/**
 * Kommunenummeret en matrikkel-id bærer, eller `null` for en id på ukjent form.
 *
 * Den står her, ved siden av byggeren, fordi formen ellers må skrives om igjen av
 * hver som skal lese den - og det hadde allerede skjedd: både `valider-data.ts` og
 * `test-matrikkel-id.ts` bar hvert sitt regex-par, og begge krevde nøyaktig én
 * bokstav der `byggMatrikkelId` skriver hele `bokstav` uansett lengde. En port som
 * avviser en id byggeren faktisk kan lage er verre enn ingen port.
 */
export function lesMatrikkelId(id: string): { kommunenummer: string } | null {
  const treff = /^matr-geo-(\d{4})-(?:\d+-\d+[A-ZÆØÅ]*|g\d+-b\d+-f\d+-u\d+)$/u.exec(id);
  return treff ? { kommunenummer: treff[1]! } : null;
}

function heltall(verdi: unknown): number | null {
  if (verdi === null || verdi === undefined || verdi === "") return null;
  const tall = Number(verdi);
  return Number.isSafeInteger(tall) ? tall : null;
}
