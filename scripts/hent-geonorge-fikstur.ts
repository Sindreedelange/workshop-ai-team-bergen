#!/usr/bin/env node

// GEONORGE-FIKSTUR
//
// Builds data/geonorge.fixtur.json: a captured slice of Geonorge's open address
// API, used to drive the fake upstream the offline tests run against.
//
// Why a capture rather than something authored: the fixture must carry
// `adressekode`, `gardsnummer` and `representasjonspunkt`, which is exactly what
// `byggMatrikkelId` rests on. A fixture written by hand would be green while the
// real thing failed.
//
// Why it is not a register: nothing in the sandbox reads it. Only the fake server
// inside a test does. `pnpm check:matrikkel-source` keeps that honest by holding
// the file under the same size ceiling as the seed - an extract that came back
// under a fixture's name would fail there.
//
// Network is needed to run this, not to run the sandbox or the tests.
//
// Bruk: node scripts/hent-geonorge-fikstur.ts [--tørrkjør]

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { feilmelding } from "../apps/shared/errors.ts";
import { byggMatrikkelId } from "../apps/shared/adresse.ts";
import { hentGate, GEONORGE_BASE_URL } from "./geonorge.ts";
import type { GeonorgeAdresse } from "../apps/shared/registerdata.ts";

const repoRot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataKatalog = path.join(repoRot, "data");
const utfil = path.join(dataKatalog, "geonorge.fixtur.json");
const toerrkjoer = process.argv.includes("--tørrkjør") || process.argv.includes("--torrkjor");

/**
 * Hvilke gater fiksturen dekker, og hvorfor hver av dem er med.
 *
 * Grunnen står ved hver rad fordi en fikstur uten begrunnelse blir trimmet av
 * neste leser: en gate ser overflødig ut helt til testen som trengte den ryker.
 */
const GATER: readonly { kommunenummer: string; adressenavn: string; grunn: string }[] = [
  { kommunenummer: "0301", adressenavn: "Kirkeveien", grunn: "eierforhold" },
  { kommunenummer: "0301", adressenavn: "Lindebergåsen", grunn: "eierforhold" },
  { kommunenummer: "1103", adressenavn: "Løkkeveien", grunn: "eierforhold" },
  { kommunenummer: "1508", adressenavn: "Inste Holen", grunn: "eierforhold" },
  { kommunenummer: "3416", adressenavn: "Mobekkvegen", grunn: "eierforhold" },
  { kommunenummer: "5001", adressenavn: "Eventyrvegen", grunn: "eierforhold" },
  { kommunenummer: "1514", adressenavn: "Haugsbygda", grunn: "adressetilleggsnavn" },
  { kommunenummer: "1824", adressenavn: "Vefsnvegen", grunn: "adressetilleggsnavn" },
  { kommunenummer: "0301", adressenavn: "Colletts gate", grunn: "husbokstav" },
  { kommunenummer: "0301", adressenavn: "Ellen Gleditsch' vei", grunn: "apostrof i gatenavnet" },
  { kommunenummer: "4601", adressenavn: "Øvre-Eide", grunn: "bindestrek i gatenavnet" },
  { kommunenummer: "0301", adressenavn: "P. A. Munchs vei", grunn: "punktum og flere ord" },
  { kommunenummer: "0301", adressenavn: "Bjørn Bondes vei", grunn: "æøå" },
];

/** Feltene sandkassen faktisk leser. Resten av svaret er ikke vårt å bevare. */
function beholdFelter(adresse: GeonorgeAdresse): GeonorgeAdresse {
  return {
    adressenavn: adresse.adressenavn,
    adressetekst: adresse.adressetekst,
    nummer: adresse.nummer,
    bokstav: adresse.bokstav,
    kommunenummer: adresse.kommunenummer,
    kommunenavn: adresse.kommunenavn,
    postnummer: adresse.postnummer,
    poststed: adresse.poststed,
    gardsnummer: adresse.gardsnummer,
    bruksnummer: adresse.bruksnummer,
    festenummer: adresse.festenummer,
    undernummer: adresse.undernummer,
    adressekode: adresse.adressekode,
    adressetilleggsnavn: adresse.adressetilleggsnavn,
    objtype: adresse.objtype,
    representasjonspunkt: adresse.representasjonspunkt,
  };
}

/**
 * Hvor mange adresser en gate bidrar med utover dem eierforholdet peker på.
 *
 * Hele gater ville gitt 1243 adresser og over en halv megabyte. Taket holder
 * fiksturen lesbar uten å svekke det den skal bevise: hver adresse et eierforhold
 * peker på blir med uansett, og resten er der for at adresseparsingen skal møte
 * ekte norske adressestrenger i bredde.
 */
const PER_GATE = 40;

async function main() {
  const eierforhold = JSON.parse(await readFile(path.join(dataKatalog, "eierforhold.json"), "utf8"));
  const eierIder: string[] = (Object.values(eierforhold).find(Array.isArray) as { matrikkelId: string }[])
    .map(rad => rad.matrikkelId);
  const eiet = new Set(eierIder);

  const adresser: GeonorgeAdresse[] = [];
  for (const gate of GATER) {
    const treff = (await hentGate(gate.kommunenummer, gate.adressenavn)).map(beholdFelter);
    if (treff.length === 0) {
      throw new Error(`Ingen treff for ${gate.adressenavn} i ${gate.kommunenummer}. Gaten er borte eller omdøpt.`);
    }
    const maa = treff.filter(a => eiet.has(byggMatrikkelId(a)));
    const resten = treff.filter(a => !eiet.has(byggMatrikkelId(a)));
    const valgt = [...maa, ...resten.slice(0, Math.max(0, PER_GATE - maa.length))];
    adresser.push(...valgt);
    console.log(`  ${gate.adressenavn} (${gate.kommunenummer}): ${valgt.length} av ${treff.length} adresser - ${gate.grunn}`);
  }

  const ider = new Set(adresser.map(byggMatrikkelId));
  if (ider.size !== adresser.length) {
    throw new Error(`Fiksturen gir ${ider.size} unike matrikkel-id-er for ${adresser.length} adresser. Id-formelen skiller dem ikke.`);
  }

  const dekket = eierIder.filter(id => ider.has(id)).length;
  if (dekket === 0) {
    throw new Error("Ingen av eierforholdene treffer en adresse i fiksturen. Da beviser den ikke at eierskapet kobler.");
  }

  const fikstur = {
    beskrivelse: "Fanget svar fra Geonorges åpne adresse-API. Inndata til den falske "
      + "oppstrømstjenesten i testene, ikke et register noen tjeneste leser.",
    kilde: { navn: "Geonorge adresser v1", url: GEONORGE_BASE_URL, hentet: new Date().toISOString().slice(0, 10) },
    syntetisk: false,
    gater: GATER,
    antallAdresser: adresser.length,
    eierforholdDekket: dekket,
    adresser,
  };

  console.log(`\n${adresser.length} adresser, ${dekket} av ${eierIder.length} eierforhold dekket.`);
  if (toerrkjoer) {
    console.log("Tørrkjøring - ingenting skrevet.");
    return;
  }
  await writeFile(utfil, `${JSON.stringify(fikstur, null, 2)}\n`, "utf8");
  console.log(`Skrev ${path.relative(repoRot, utfil)}`);
}

main().catch(error => {
  console.error(feilmelding(error));
  process.exit(1);
});
