/*
 * Unit tests for byggMatrikkelId in apps/shared/adresse.ts.
 *
 * Pure functions over data/geonorge.fixtur.json. No stack, no port, no network.
 *
 * Hvorfor denne testen finnes: id-en er den eneste koblingen mellom en adresse
 * hentet live fra Geonorge og eierskapet i data/eierforhold.json. Går de to fra
 * hverandre, svarer oppslaget «ingen eiere» i stedet for å feile - et stille tap
 * som ingen annen sjekk ville fanget.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { byggMatrikkelId, lesMatrikkelId } from "../apps/shared/adresse.ts";
import { lesGeonorgeFikstur } from "./geonorge-fikstur.ts";
import type { GeonorgeAdresse } from "../apps/shared/registerdata.ts";

let bestatt = 0;
const feil: string[] = [];

function check(navn: string, betingelse: unknown, detalj = ""): void {
  if (betingelse) {
    bestatt += 1;
    return;
  }
  feil.push(`${navn}${detalj ? ` - ${detalj}` : ""}`);
}

const fikstur = { adresser: lesGeonorgeFikstur() };
// Stien regnes ut fra modulen, ikke fra arbeidskatalogen: en test som bare virker
// når den kjøres fra reporoten er en test som feiler på ENOENT et annet sted.
const repoRot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const eierforhold = JSON.parse(readFileSync(path.join(repoRot, "data/eierforhold.json"), "utf8")) as Record<string, unknown>;
const eierrader = Object.values(eierforhold).find(Array.isArray) as { matrikkelId: string }[];

// --- formen ----------------------------------------------------------------

// Formen leses av `lesMatrikkelId`, ved siden av byggeren. Et regex-par her ville
// vært en andre implementasjon av samme form, og den forrige hadde allerede drevet
// fra byggeren: den godtok nøyaktig én bokstav der byggeren skriver hele `bokstav`.
const VEGADRESSE = /^matr-geo-\d{4}-\d+-\d+[A-ZÆØÅ]*$/u;
const MATRIKKELADRESSE = /^matr-geo-\d{4}-g\d+-b\d+-f\d+-u\d+$/u;

check(
  "hver adresse i fiksturen gir en id på dokumentert form",
  fikstur.adresser.every(a => VEGADRESSE.test(byggMatrikkelId(a))),
  fikstur.adresser.map(byggMatrikkelId).find(id => !VEGADRESSE.test(id))
);

// --- id-en skiller adressene -----------------------------------------------

const ider = fikstur.adresser.map(byggMatrikkelId);
check(
  "id-en er unik over hele fiksturen",
  new Set(ider).size === ider.length,
  `${new Set(ider).size} unike av ${ider.length}`
);

// --- den gjenskaper id-ene som allerede står i de genererte filene ----------
//
// Dette er testens kjerne. `data/eierforhold.json` og `data/personer.json` er
// preget av importen, og live-oppslaget må komme fram til nøyaktig samme streng.

check(
  "id-en følger formelen kommunenummer-adressekode-husnummer[bokstav]",
  fikstur.adresser.every(a =>
    byggMatrikkelId(a) === `matr-geo-${a.kommunenummer}-${a.adressekode}-${a.nummer}${String(a.bokstav || "").toUpperCase()}`)
);

const dekket = eierrader.filter(rad => ider.includes(rad.matrikkelId));
check(
  "fiksturen dekker eierforhold, så koblingen faktisk blir prøvd",
  dekket.length > 0,
  `${dekket.length} av ${eierrader.length}`
);

check(
  "hver matr-geo-id i eierforhold.json har en form live-veien kan produsere",
  eierrader.every(rad => !rad.matrikkelId.startsWith("matr-geo-")
    || VEGADRESSE.test(rad.matrikkelId) || MATRIKKELADRESSE.test(rad.matrikkelId)),
  eierrader.map(r => r.matrikkelId).find(id => id.startsWith("matr-geo-")
    && !VEGADRESSE.test(id) && !MATRIKKELADRESSE.test(id))
);

// --- matrikkeladressen -----------------------------------------------------
//
// Uttrekket hadde ingen. Uten en egen gren ville alle matrikkeladresser i en
// kommune fått `matr-geo-{kommune}-0-0`, altså én id for tusenvis av eiendommer.

const matrikkeladresse: GeonorgeAdresse = {
  kommunenummer: "4601", objtype: "Matrikkeladresse",
  gardsnummer: 12, bruksnummer: 3, festenummer: 0, undernummer: 2
};
check(
  "en matrikkeladresse får sin egen form",
  MATRIKKELADRESSE.test(byggMatrikkelId(matrikkeladresse)),
  byggMatrikkelId(matrikkeladresse)
);
check(
  "to matrikkeladresser på samme gårds- og bruksnummer skilles av undernummeret",
  byggMatrikkelId(matrikkeladresse) !== byggMatrikkelId({ ...matrikkeladresse, undernummer: 3 })
);
check(
  "en matrikkeladresse kollapser aldri til adressekode 0",
  !byggMatrikkelId(matrikkeladresse).startsWith("matr-geo-4601-0-")
);

// --- normalisering ---------------------------------------------------------

const grunn: GeonorgeAdresse = {
  kommunenummer: "4601", adressekode: 42, nummer: 10, bokstav: "a"
};
check("husbokstaven skrives med stor forbokstav", byggMatrikkelId(grunn) === "matr-geo-4601-42-10A");
check("mellomrom rundt husbokstaven faller bort",
  byggMatrikkelId({ ...grunn, bokstav: " a " }) === "matr-geo-4601-42-10A");
check("en adresse uten husbokstav får ingen etterhengt bokstav",
  byggMatrikkelId({ ...grunn, bokstav: "" }) === "matr-geo-4601-42-10");
check("adressekode 0 er en ekte kode og ikke en manglende",
  byggMatrikkelId({ ...grunn, adressekode: 0 }) === "matr-geo-4601-0-10A");

// --- porten og byggeren -----------------------------------------------------
//
// De to må være enige, og det er nettopp der de gled fra hverandre før:
// `valider-data.ts` bar sitt eget regex-par som godtok nøyaktig én bokstav, så en
// id byggeren faktisk kan lage sto som «finnes ikke i noe register» framfor som
// en formfeil.

check(
  "lesMatrikkelId godtar hver id byggeren lager, og finner kommunen i den",
  fikstur.adresser.every(a => lesMatrikkelId(byggMatrikkelId(a))?.kommunenummer === a.kommunenummer),
  fikstur.adresser.map(byggMatrikkelId).find(id => lesMatrikkelId(id) === null)
);
check(
  "lesMatrikkelId godtar matrikkeladresseformen og en flerbokstavs husbokstav",
  lesMatrikkelId(byggMatrikkelId(matrikkeladresse))?.kommunenummer === "4601"
    && lesMatrikkelId(byggMatrikkelId({ ...grunn, bokstav: "AB" })) !== null
);
check("lesMatrikkelId avviser en id på en form ingen Geonorge-adresse gir",
  lesMatrikkelId("matr-storg-001") === null && lesMatrikkelId("matr-geo-460-42-10") === null);

// --- report ----------------------------------------------------------------
if (feil.length > 0) {
  console.error(`test-matrikkel-id: ${feil.length} av ${bestatt + feil.length} sjekker feilet.`);
  for (const linje of feil) console.error(`  - ${linje}`);
  process.exit(1);
}
console.log(`test-matrikkel-id ok. ${bestatt} sjekker over ${fikstur.adresser.length} ekte adresser, uten nett.`);
