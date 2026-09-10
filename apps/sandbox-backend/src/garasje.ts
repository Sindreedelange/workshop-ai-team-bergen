import type { GarasjeGrunnlag, GarasjePolygon, GarasjePunkt, GarasjeSjekk, GarasjeTiltak, GarasjeVurdering } from "../../shared/garasje.ts";
import { HttpError } from "./errors.ts";
import { GARASJE_NASJONALE_KRAV } from "../../shared/garasje-regelgrunnlag.ts";
import { findGarasjeKommunekilder } from "../../shared/garasje-kommuner.ts";
import { KPA2018_SONEKILDE } from "../../shared/arealsoner.ts";

export const GARASJE_SAK10_URL = GARASJE_NASJONALE_KRAV.kilde;
export const GARASJE_KPA_URL = findGarasjeKommunekilder(KPA2018_SONEKILDE.kommunenummer)!.kpa.bestemmelserUrl;

export function validateGarasjePunkt(input: unknown): GarasjePunkt {
  if (!isRecord(input) || Object.keys(input).some(key => !["lat", "lon"].includes(key))
    || !isNumber(input.lat) || !isNumber(input.lon)
    || input.lat <= -90 || input.lat >= 90 || input.lon < -180 || input.lon > 180) {
    throw new HttpError("Plasseringen må ha gyldig breddegrad og lengdegrad.", 400);
  }
  return { lat: input.lat, lon: input.lon };
}

const numericFields = ["bra", "bya", "gesimshoyde", "monehoyde", "etasjer"] as const;
const booleanFields = ["frittliggende", "beboelse", "kjeller", "bebygdEiendom", "overVannAvlop"] as const;
const distanceFields = ["avstandNabogrense", "avstandBygning"] as const;
const tiltakFields: readonly string[] = [...numericFields, ...booleanFields, ...distanceFields];

export function validateGarasjeTiltak(input: unknown): GarasjeTiltak {
  if (!isRecord(input) || Object.keys(input).some(key => !tiltakFields.includes(key))) {
    throw new HttpError("Tiltaket må bare inneholde de dokumenterte opplysningene om garasjen.", 400);
  }
  for (const field of numericFields) {
    if (!isNumber(input[field]) || input[field] <= 0 || input[field] > 100_000
      || (field === "etasjer" && !Number.isInteger(input[field]))) {
      throw new HttpError(`${field} må være et positivt, endelig tall${field === "etasjer" ? " uten desimaler" : ""}.`, 400);
    }
  }
  if ((input.gesimshoyde as number) > (input.monehoyde as number)) {
    throw new HttpError("Gesimshøyden kan ikke være større enn mønehøyden.", 400);
  }
  for (const field of booleanFields) {
    if (input[field] !== null && typeof input[field] !== "boolean") {
      throw new HttpError(`${field} må være true, false eller null når det er ukjent.`, 400);
    }
  }
  for (const field of distanceFields) {
    if (input[field] !== null && (!isNumber(input[field]) || input[field] < 0 || input[field] > 100_000)) {
      throw new HttpError(`${field} må være et endelig tall fra 0, eller null når avstanden er ukjent.`, 400);
    }
  }
  return Object.fromEntries(tiltakFields.map(field => [field, input[field]])) as GarasjeTiltak;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function containsPunkt(p: GarasjePunkt, shape: GarasjePolygon): boolean {
  let inside = false;
  for (const ring of shape.ringer) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!, b = ring[j]!;
      const cross = (p.lon - a[0]) * (b[1] - a[1]) - (p.lat - a[1]) * (b[0] - a[0]);
      if (Math.abs(cross) < 1e-14 && p.lon >= Math.min(a[0], b[0]) && p.lon <= Math.max(a[0], b[0])
        && p.lat >= Math.min(a[1], b[1]) && p.lat <= Math.max(a[1], b[1])) return true;
      if ((a[1] > p.lat) !== (b[1] > p.lat)
        && p.lon < (b[0] - a[0]) * (p.lat - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
  }
  return inside;
}

export function evaluateGarasje(tiltak: GarasjeTiltak, grunnlag: GarasjeGrunnlag): GarasjeVurdering {
  const t = validateGarasjeTiltak(tiltak);
  const krav = GARASJE_NASJONALE_KRAV.tallkrav;
  const sjekker: GarasjeSjekk[] = [];
  function check(id: string, navn: string, value: boolean | null, forklaring: string): void {
    sjekker.push({ id, navn, status: value === null ? "uavklart" : value ? "oppfylt" : "brudd", forklaring, kilde: GARASJE_SAK10_URL });
  }
  check("areal", "BRA og BYA", t.bra <= krav.bra.verdi && t.bya <= krav.bya.verdi,
    `Oppgitt BRA er ${t.bra} m² og BYA er ${t.bya} m². Grensene er henholdsvis ${krav.bra.verdi} og ${krav.bya.verdi} m².`);
  check("hoyde", "Møne- og gesimshøyde", t.monehoyde <= krav.monehoyde.verdi && t.gesimshoyde <= krav.gesimshoyde.verdi,
    `Oppgitt mønehøyde er ${t.monehoyde} m og gesimshøyde er ${t.gesimshoyde} m. Grensene er ${krav.monehoyde.verdi} og ${krav.gesimshoyde.verdi} m, målt fra ferdig planert terrengs gjennomsnittsnivå.`);
  check("etasjer", "Én etasje", t.etasjer === krav.etasjer.verdi, `Du har oppgitt ${t.etasjer} etasje(r). Unntaket gjelder ${krav.etasjer.verdi} etasje.`);
  check("kjeller", "Uten kjeller", t.kjeller === null ? null : !t.kjeller,
    t.kjeller === null ? "Det er ikke avklart om garasjen får kjeller." : "Garasjen kan ikke underbygges med kjeller.");
  check("frittliggende", "Frittliggende bygning", t.frittliggende, "Dette unntaket gjelder en frittliggende bygning.");
  check("beboelse", "Ikke til beboelse", t.beboelse === null ? null : !t.beboelse,
    "Bygningen skal ikke brukes til beboelse. DIBK presiserer at den ikke kan inneholde kjøkken, stue, soverom eller våtrom.");
  check("bebygd", "Bebygd eiendom", t.bebygdEiendom, "Eiendommen må være bebygd. Kartlagte bygningsflater dokumenterer ikke alene at bebyggelsen er lovlig.");
  check("nabogrense", "Avstand til nabogrense", t.avstandNabogrense === null ? null : t.avstandNabogrense >= krav.avstandNabogrense.verdi,
    t.avstandNabogrense === null ? "Avstanden til nabogrensen er ukjent." : `Oppgitt avstand er ${t.avstandNabogrense} m. Det kreves minst ${krav.avstandNabogrense.verdi} m. Avstanden er ikke beregnet fra kartet.`);
  check("bygning", "Avstand til annen bygning", t.avstandBygning === null ? null : t.avstandBygning >= krav.avstandBygning.verdi,
    t.avstandBygning === null ? "Avstanden til annen bygning på eiendommen er ukjent." : `Oppgitt avstand er ${t.avstandBygning} m. Det kreves minst ${krav.avstandBygning.verdi} m til annen bygning på eiendommen. Avstanden er ikke beregnet fra kartet.`);
  check("vann-avlop", "Ikke over vann- og avløpsledninger", t.overVannAvlop === null ? null : !t.overVannAvlop,
    "Garasjen kan ikke plasseres over vann- og avløpsledninger. Pilotens kart kontrollerer ikke ledninger; vurderingen bygger på ditt svar.");
  const nasjonaltUnntak = sjekker.some(s => s.status === "brudd") ? "brudd"
    : sjekker.some(s => s.status === "uavklart") ? "uavklart" : "oppfylt";
  const eiendomskilde = grunnlag.kilder.find(k => k.id === "eiendomsgrenser");
  const hasEiendomsgrense = eiendomskilde?.status === "ok" && grunnlag.eiendomsgrenser.length > 0;
  const punktPaaEiendom = hasEiendomsgrense
    ? grunnlag.eiendomsgrenser.some(shape => containsPunkt(grunnlag.punkt, shape)) : null;
  sjekker.push({
    id: "plassering", navn: "Skissepunkt på valgt eiendom",
    status: punktPaaEiendom === null ? "uavklart" : punktPaaEiendom ? "oppfylt" : "brudd",
    kilde: eiendomskilde?.url ?? "https://kart.bergen.kommune.no/arcgis/rest/services/Basis_kartdata/Eiendommer/MapServer/3",
    forklaring: punktPaaEiendom === null
      ? "Eiendomsflaten mangler eller kunne ikke hentes. Det er ukjent om skissepunktet ligger på valgt eiendom."
      : punktPaaEiendom
        ? "Skissepunktet ligger på den kartlagte eiendomsteigen ved adressen. Dette sier ikke at hele garasjen ligger på eiendommen eller oppfyller avstandskrav. Et adressepunkt er heller ikke en bekreftet garasjeplassering."
        : "Skissepunktet ligger utenfor den kartlagte eiendomsteigen ved valgt adresse. Flytt punktet eller avklar eiendomsgrensen. Dette er ikke en vurdering av søknadsplikt eller byggetillatelse på en annen eiendom.",
  });
  const kommunekilder = findGarasjeKommunekilder(grunnlag.adresse.kommunenummer);
  const bestemmelseskilde = kommunekilder?.kpa.bestemmelserUrl || GARASJE_SAK10_URL;
  const lnf = grunnlag.adresse.kommunenummer === KPA2018_SONEKILDE.kommunenummer
    && grunnlag.arealformaal.some(formaal => formaal.kode === 5100 && formaal.planId === KPA2018_SONEKILDE.planId);
  sjekker.push({
    id: "kommuneplan", navn: "Kommuneplan og LNF", status: "uavklart", kilde: bestemmelseskilde,
    forklaring: lnf
      ? "Punktet ligger i LNF. KPA2018 § 31.3 omtaler små tiltak på fradelt og bebygd boligeiendom uten negativ påvirkning på LNF-verdiene. Retningslinjene stiller flere vilkår. Dette er ikke et generelt fritak fra søknad eller dispensasjon. Eiendommens forhold må avklares."
      : "Et arealformål alene avgjør ikke om en garasje er tillatt. KPA-bestemmelser, byggegrenser og utnyttelsesgrad er ikke kontrollert.",
  }, {
    id: "reguleringsplan", navn: "Reguleringsplanens bestemmelser", status: "uavklart",
    kilde: grunnlag.reguleringsplaner[0]?.url ?? bestemmelseskilde,
    forklaring: grunnlag.reguleringsplaner.length
      ? "Planområder er funnet, men bestemmelsene om blant annet garasjer, plassering og gjerder er ikke lest eller kontrollert av piloten."
      : "Ingen funnet reguleringsplan er ikke bevis på at tiltaket er avklart. Kildestatus og øvrige plangrunnlag må kontrolleres.",
  });
  for (const id of ["adresse", "kpa", "reguleringsplan", "eiendomsgrenser", "bygninger"]) {
    const kilde = grunnlag.kilder.find(k => k.id === id);
    if (!kilde || (kilde.status !== "ok" && !(id === "reguleringsplan" && kilde.status === "ingen_treff"))) {
      sjekker.push({
        id: `kilde-${id}`, navn: `Datagrunnlag: ${kilde?.navn ?? id}`, status: "uavklart",
        forklaring: kilde?.merknad ?? "Datagrunnlaget mangler eller er ikke avklart.", kilde: kilde?.url ?? GARASJE_KPA_URL,
      });
    }
  }
  const uavklarteForhold = [...new Set([
    ...grunnlag.uavklarteForhold,
    "Gjeldende planbestemmelser, hensynssoner, byggegrenser og tillatt utnyttelse må avklares for hele tiltaket.",
    "Ledningskart, flom, skred, grunnforhold, kulturminner, naturverdier og avstand til vei, sjø og vassdrag er ikke kontrollert.",
    "Kartet viser et punkt, ikke garasjens utstrekning. Grensekvalitet, mål og lovlig etablert bebyggelse er ikke bekreftet.",
    ...sjekker.filter(s => s.status === "uavklart").map(s => s.forklaring),
  ])];
  // National thresholds alone cannot establish compliance with local plans.
  return {
    utfall: nasjonaltUnntak === "brudd" ? "soknadspliktig" : "maa_avklares",
    nasjonaltUnntak, sjekker, uavklarteForhold,
    forklaring: nasjonaltUnntak === "brudd"
      ? "Opplysningene oppfyller ikke det nasjonale unntaket for denne typen garasje. Tiltaket må som utgangspunkt omsøkes eller endres. Eventuelle andre unntak må avklares med kommunen. Dette er ikke et vedtak."
      : punktPaaEiendom === false
        ? "Skissepunktet ligger utenfor valgt eiendom. Plasseringen må endres eller avklares før kontrollen kan brukes videre. Punktet sier ikke noe om hele garasjens utstrekning."
        : nasjonaltUnntak === "oppfylt"
          ? "Opplysningene oppfyller de kontrollerte nasjonale vilkårene, men planforhold og andre krav er ikke avklart. Piloten kan ikke konkludere med at du kan bygge uten søknad."
          : "Det mangler opplysninger om nasjonale vilkår, og planforhold og andre krav må avklares før søknadsplikten kan avgjøres.",
  };
}
