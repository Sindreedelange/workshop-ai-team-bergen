import { HttpError } from "./errors.ts";
import { getGarasjeGrunnlag, searchGarasjeAdresser } from "./garasje-data.ts";
import { readGarasjeRequest } from "./garasje-request.ts";
import { findGarasjeKommunekilder } from "../../shared/garasje-kommuner.ts";
import { getByggetiltakPlanvarsler } from "./garasje.ts";

export async function readGarasjeGrunnlag(sok: URLSearchParams) {
  const request = readGarasjeRequest(sok);
  const adresser = await searchGarasjeAdresser(request.adresse, request.kommunenummer);
  const normalized = (tekst: string) => tekst.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("nb-NO");
  const treff = adresser.filter(adresse =>
    normalized(adresse.adressetekst) === normalized(request.adresse) &&
    adresse.gardsnummer === request.gnr && adresse.bruksnummer === request.bnr &&
    (!request.kommunenummer || adresse.kommunenummer === request.kommunenummer)
  );
  if (treff.length !== 1) {
    throw new HttpError("Fant ikke én entydig adresse med oppgitt gnr./bnr. Søk etter adressen på nytt og velg riktig treff.", 404);
  }
  const adresse = treff[0];
  if (request.plassering) {
    const north = (request.plassering.lat - adresse.punkt.lat) * 111320;
    const east = (request.plassering.lon - adresse.punkt.lon) *
      111320 * Math.cos(adresse.punkt.lat * Math.PI / 180);
    // A request bound, not a property-boundary or building-distance calculation.
    if (Math.hypot(north, east) > 500) {
      throw new HttpError("Plasseringen er mer enn 500 meter fra adressen. Velg riktig eiendom først.", 400);
    }
  }
  const grunnlag = await getGarasjeGrunnlag(adresse, request.plassering);
  if (request.tiltakstype !== undefined) {
    grunnlag.tiltaksvarsler = getByggetiltakPlanvarsler(request.tiltakstype, grunnlag);
  }
  const kommune = findGarasjeKommunekilder(adresse.kommunenummer);
  if (!kommune) {
    grunnlag.uavklarteForhold.push("Kommunens planbestemmelser må kobles til eiendommen og kontrolleres. Bestemmelser fra en annen kommune kan ikke brukes.");
    return grunnlag;
  }
  grunnlag.kilder.push({
    id: "kpa-bestemmelser",
    navn: `${kommune.navn}: bestemmelser og retningslinjer (${kommune.kpa.versjon}, plan ${kommune.kpa.planId})`,
    url: kommune.kpa.bestemmelserUrl,
    hentet: new Date().toISOString(),
    status: "ikke_sjekket",
    merknad: "Dokumentlenken er registrert som nødvendig vurderingsgrunnlag. PDF-innholdet er ikke automatisk lest eller kontrollert. Tidspunktet gjelder registreringen av kildebehovet."
  });
  grunnlag.uavklarteForhold.push(
    `Bestemmelsene i ${kommune.kpa.versjon} for ${kommune.navn} må gjøres tilgjengelige og relevante vilkår kontrolleres før planforholdet kan avklares. Karttreff erstatter ikke dokumentgrunnlaget.`
  );
  return grunnlag;
}
