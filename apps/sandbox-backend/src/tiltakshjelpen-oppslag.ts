import { HttpError } from "./errors.ts";
import { alleTiltakshjelpenKilder } from "../../shared/tiltakshjelpen.ts";
import type { TiltakshjelpenGrunnlag, TiltakshjelpenKilde } from "../../shared/tiltakshjelpen.ts";
import { getTiltakshjelpenGrunnlag, searchTiltakshjelpenAdresser, type Kildehendelse } from "./tiltakshjelpen-data.ts";
import { readTiltakshjelpenRequest } from "./tiltakshjelpen-request.ts";
import { findTiltakshjelpenKommunekilder } from "../../shared/tiltakshjelpen-kommuner.ts";
import { getByggetiltakPlanvarsler } from "./tiltakshjelpen.ts";
import type { Byggetiltakstype } from "../../shared/byggetiltak.ts";

/**
 * Grunnlag hentet for et øyeblikk siden, per nøyaktig spørring.
 *
 * Flere kall om samme eiendom følger tett på hverandre - sjekken etter kartet, og
 * et nytt oppslag når tiltakstypen bekreftes - og hvert av dem vifter ut mot de
 * samme seks kildene. Uten dette betaler innbyggeren ventetiden og kommunen
 * forespørslene om igjen for det samme svaret.
 *
 * Hva det ikke dekker: plasseringen står i nøkkelen, og grensesnittet krever at
 * markøren er flyttet før plasseringen kan bekreftes. Oppslaget for kartet og
 * oppslaget for plasseringen har derfor ulik nøkkel og deler aldri svar. Å endre
 * på det krever å dele grunnlaget i en teigavledet halvdel og en punktavledet, og
 * det er en større omskriving enn en nøkkel.
 *
 * Levetiden er kort med vilje. Et vedtak skal hvile på ferske opplysninger, og
 * tretti sekunder er kort nok til at ingen kilde rekker å endre seg og langt nok
 * til å dekke tiden mellom de to kallene. Revisjonssporet lyver ikke om alderen:
 * `kilde.hentet` er tidspunktet kilden faktisk svarte, ikke tidspunktet svaret
 * ble gjenbrukt.
 */
const GRUNNLAG_LEVETID_MS = 30_000;
/**
 * Taket på antall grunnlag som holdes samtidig.
 *
 * Levetiden begrenser alderen, ikke antallet. Et grunnlag bærer teiger,
 * planflater og bygningsflater som polygoner, og er lett flere megabyte i minnet -
 * uten et tak ville mange samtidige oppslag på ulike eiendommer holdt dem alle.
 */
const GRUNNLAG_MAKS_ANTALL = 50;
/**
 * Grunnlaget, og timeren som skal glemme det.
 *
 * Timeren står i kartet og ikke bare i lukkingen sin, fordi den ellers holder
 * grunnlaget i live i tretti sekunder etter at det er kastet ut. Da er det ikke
 * `GRUNNLAG_MAKS_ANTALL` som er taket, men antall ulike oppslag i løpet av tretti
 * sekunder - og hvert grunnlag bærer titusener av koordinatpar.
 */
type Ferskt = { grunnlag: Promise<TiltakshjelpenGrunnlag>; utloep: ReturnType<typeof setTimeout> };
const ferskeGrunnlag = new Map<string, Ferskt>();

/** Glemmer de ferske grunnlagene. Finnes for testene, som bytter oppstrøm mellom to like kall. */
export function nullstillFerskeGrunnlag(): void {
  for (const { utloep } of ferskeGrunnlag.values()) clearTimeout(utloep);
  ferskeGrunnlag.clear();
}

/** Tar oppføringen ut, og stopper timeren som ellers ville holdt den i live. */
function kastUt(noekkel: string): void {
  const oppfoering = ferskeGrunnlag.get(noekkel);
  if (!oppfoering) return;
  clearTimeout(oppfoering.utloep);
  ferskeGrunnlag.delete(noekkel);
}

/**
 * Grunnlaget for én eiendom. **Den ene veien inn.**
 *
 * Gjenbruket ligger her og ikke i en søsterfunksjon, fordi et navnevalg på
 * kallstedet da avgjør hvor ferskt svaret er - og ett av fire kallsteder valgte
 * allerede feil uten at noe sa fra. To veier til den samme avgjørelsen skal ikke
 * kunne ha ulik ferskhet og ulikt antall forespørsler mot kommunen.
 */
export async function readTiltakshjelpenGrunnlag(
  sok: URLSearchParams, paaKilde?: Kildehendelse
): Promise<Readonly<TiltakshjelpenGrunnlag>> {
  // Nøkkelen er det som avgjør grunnlaget, ikke hele spørringen. `sporingsId` og
  // tiltaksopplysningene varierer mellom to kall om nøyaktig samme eiendom, og
  // ville gjort gjenbruket til noe som aldri slo til.
  const request = readTiltakshjelpenRequest(sok);
  // Tiltakstypen står ikke i nøkkelen, og det er ikke en forglemmelse.
  // Grensesnittet henter grunnlaget én gang før typen er bekreftet og én gang
  // etter, så med den i nøkkelen bommet gjenbruket alltid på det andre kallet -
  // fjorten forespørsler til kommunen og et sekunds venting for noe som bare er
  // en lokal utregning over det samme grunnlaget.
  const noekkel = JSON.stringify([
    request.adresse, request.gnr, request.bnr, request.kommunenummer ?? null,
    request.plassering?.lat ?? null, request.plassering?.lon ?? null,
  ]);
  const truffet = ferskeGrunnlag.get(noekkel);
  if (truffet) {
    const grunnlag = await truffet.grunnlag;
    // Kildene meldes også på et gjenbruk, med tidspunktet de faktisk svarte.
    // Uten det ville listen stått tom, og innbyggeren ville trodd at ingenting
    // ble hentet - mens sannheten er at det ble hentet for et øyeblikk siden.
    //
    // `alleTiltakshjelpenKilder` og ikke `kilder`: nabokartet står utenfor den
    // listen, og en rad som forsvinner ved andre oppslag om samme eiendom leses
    // som en kilde som ikke ble hentet.
    for (const kilde of alleTiltakshjelpenKilder(grunnlag)) paaKilde?.(kilde);
    return medTiltaksvarsler(grunnlag, request.tiltakstype);
  }
  const grunnlag = byggGrunnlag(request, paaKilde);
  // Alltid med identitetssjekk, aldri på nøkkelen alene: et oppslag som lever
  // lenger enn levetiden er allerede kastet ut av sin egen timer, og nøkkelen kan
  // imens være fylt av et nytt. Uten sjekken sletter den gamle det ferske svaret.
  const glem = () => { if (ferskeGrunnlag.get(noekkel)?.grunnlag === grunnlag) kastUt(noekkel); };
  // Et feilet oppslag skal ikke stå som svaret i tretti sekunder - og heller ikke
  // et som lyktes med en kilde nede. «Kjør sjekken på nytt» står i merknaden når
  // en kilde ikke svarte i tid, og et gjenbruk ville spilt av det samme svaret
  // uten å røre kilden. Da er rådet feil.
  // `alleTiltakshjelpenKilder` og ikke `kilder`: nabokartet står utenfor den
  // listen, så en tidsavbrutt nabokilde ville ellers blitt liggende som svaret i
  // tretti sekunder - og det er nettopp den kilden som ber innbyggeren kjøre
  // sjekken på nytt. Et gjenbruk spiller da av det samme svaret uten å røre kilden.
  grunnlag.then(
    ferdig => { if (alleTiltakshjelpenKilder(ferdig).some(kilde => kilde.status === "feil")) glem(); },
    glem
  );
  // Eldste først ut når taket er nådd. Map bevarer innsettingsrekkefølgen, og
  // siden det slettes én før hver innsetting kan taket aldri overskrides med mer.
  if (ferskeGrunnlag.size >= GRUNNLAG_MAKS_ANTALL) kastUt(ferskeGrunnlag.keys().next().value!);
  // Utløpet er en egen timer og ikke en aldersjekk ved neste oppslag: uten den
  // blir det siste grunnlaget liggende til prosessen får en ny forespørsel, som
  // på en stille maskin kan være til den stoppes. `unref` holder ikke prosessen
  // i live for dens skyld.
  const utloep = setTimeout(glem, GRUNNLAG_LEVETID_MS);
  utloep.unref();
  ferskeGrunnlag.set(noekkel, { grunnlag, utloep });
  return medTiltaksvarsler(await grunnlag, request.tiltakstype);
}

/**
 * Planvarslene for den bekreftede tiltakstypen, lagt på uten et nytt oppslag.
 *
 * `getByggetiltakPlanvarsler` er ren utregning over grunnlaget som allerede er
 * hentet. Et grunt kopi er nok: varslene er det eneste feltet som endres, og
 * resten deles med de andre som gjenbruker det samme oppslaget.
 */
function medTiltaksvarsler(
  grunnlag: Readonly<TiltakshjelpenGrunnlag>, tiltakstype: Byggetiltakstype | undefined
): Readonly<TiltakshjelpenGrunnlag> {
  if (tiltakstype === undefined) return grunnlag;
  return { ...grunnlag, tiltaksvarsler: getByggetiltakPlanvarsler(tiltakstype, grunnlag) };
}

/**
 * Bygger grunnlaget fra kildene, uten gjenbruk.
 *
 * Eksportert bare for testene, som bytter oppstrøm mellom to ellers like kall og
 * skal møte kilden hver gang. Tjenestene går gjennom `readTiltakshjelpenGrunnlag`.
 *
 * Objektet den bygger deles av alle som gjenbruker det i tretti sekunder, så ingen
 * kaller skal skrive i det. `Readonly` på veien ut sier det, men håndhever det ikke:
 * typen er grunn, så `grunnlag.kilder.push(...)` kompilerer fortsatt. Et dypt
 * lesetak ville krevd `readonly` på hver liste i `TiltakshjelpenGrunnlag`, og den
 * typen går inn i `evaluateTiltakshjelpen` og hver tegnefunksjon som leser den -
 * så dette er en avtale, ikke en sperre. Skal den bli en sperre, må den bli det
 * i selve typen.
 */
export function hentTiltakshjelpenGrunnlag(sok: URLSearchParams, paaKilde?: Kildehendelse) {
  return byggGrunnlag(readTiltakshjelpenRequest(sok), paaKilde);
}

type Tiltakshjelpenforesporsel = ReturnType<typeof readTiltakshjelpenRequest>;

async function byggGrunnlag(request: Tiltakshjelpenforesporsel, paaKilde?: Kildehendelse) {
  const adresser = await searchTiltakshjelpenAdresser(request.adresse, request.kommunenummer);
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
  const grunnlag = await getTiltakshjelpenGrunnlag(adresse, request.plassering, paaKilde);
  const kommune = findTiltakshjelpenKommunekilder(adresse.kommunenummer);
  if (!kommune) {
    grunnlag.uavklarteForhold.push("Kommunens planbestemmelser må kobles til eiendommen og kontrolleres. Bestemmelser fra en annen kommune kan ikke brukes.");
    return grunnlag;
  }
  const bestemmelser: TiltakshjelpenKilde = {
    id: "kpa-bestemmelser",
    navn: `${kommune.navn}: bestemmelser og retningslinjer (${kommune.kpa.versjon}, plan ${kommune.kpa.planId})`,
    url: kommune.kpa.bestemmelserUrl,
    hentet: new Date().toISOString(),
    status: "ikke_sjekket",
    merknad: "Dokumentlenken er registrert som nødvendig vurderingsgrunnlag. PDF-innholdet er ikke automatisk lest eller kontrollert. Tidspunktet gjelder registreringen av kildebehovet."
  };
  grunnlag.kilder.push(bestemmelser);
  paaKilde?.(bestemmelser);
  grunnlag.uavklarteForhold.push(
    `Bestemmelsene i ${kommune.kpa.versjon} for ${kommune.navn} må gjøres tilgjengelige og relevante vilkår kontrolleres før planforholdet kan avklares. Karttreff erstatter ikke dokumentgrunnlaget.`
  );
  return grunnlag;
}
