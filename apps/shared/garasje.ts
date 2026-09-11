import type { Arealsonetype } from "./arealsoner.ts";
import type { Hensynssonetype } from "./hensynssoner.ts";
import type { Byggetiltakstype } from "./byggetiltak.ts";
export type { Byggetiltak, ByggetiltakInput, Byggetiltakstype } from "./byggetiltak.ts";

export type GarasjePunkt = { lat: number; lon: number };

export type GarasjeAdresse = {
  adressetekst: string;
  kommunenummer: string;
  kommunenavn?: string;
  gardsnummer: number;
  bruksnummer: number;
  festenummer: number;
  undernummer: number;
  punkt: GarasjePunkt;
};

export type GarasjeKilde = {
  id: string;
  navn: string;
  url: string;
  hentet: string;
  status: "ok" | "ingen_treff" | "feil" | "ikke_sjekket";
  merknad?: string;
  fil?: string;
  uttrekksaar?: number;
  koordinatsystem?: "EPSG:4326" | "EPSG:4258";
};

/** Geographic [longitude, latitude] rings. Source CRS is retained with the geometry and source. */
export type GarasjePolygon = {
  id: string;
  ringer: [number, number][][];
  teig?: GarasjeTeig;
  teigId?: number;
  kvalitetsklasse?: string;
  oppdatert?: string;
  matrikkelnummer?: string;
  kildeObjektId?: number;
  registrertArealM2?: number;
};

export type GarasjeTeig = {
  gnr: number;
  bnr: number;
  /** Festenummer, ikke fødselsnummer. */
  fnr: number;
  teigId?: number;
  kvalitet?: string;
  tvist?: string;
};

/** Normalised parcel GeoJSON. A dataset OBJECTID is never a Matrikkel teig ID. */
export type GarasjeEiendomsGeoJson = {
  type: "FeatureCollection";
  koordinatsystem?: "EPSG:4326" | "EPSG:4258";
  features: {
    type: "Feature";
    geometry:
      | { type: "Polygon"; coordinates: [number, number][][] }
      | { type: "MultiPolygon"; coordinates: [number, number][][][] };
    properties: {
      kommunenummer: string;
      gardsnummer: number;
      bruksnummer: number;
      festenummer: number;
      seksjonsnummer: number;
      lokalid?: number;
      kildeObjektId?: number;
      kildefil?: string;
      registrertArealM2?: number;
      arealmerknad?: string | null;
      tinglyst?: string;
      antallMatrikkelenheter?: number;
      objekttype: "Teig";
      matrikkelnummertekst: string;
      "nøyaktighetsklasseteig"?: string;
      oppdateringsdato?: string;
      "hovedområde"?: boolean;
      teigmedflerematrikkelenheter?: boolean;
      uregistrertjordsameie?: boolean;
    };
  }[];
};

export type GarasjeArealformaal = {
  kode: number;
  beskrivelse: string;
  planId: string;
  arealstatus?: number;
  /** Kommunens tegnforklaring for kombinasjonen KPAREALFORMAL og AREALST. */
  sonenavn?: string;
  sonetype?: Arealsonetype;
};

export type GarasjePlan = {
  planId: string;
  navn: string;
  url: string;
};

export type GarasjeEksisterendeBygning = {
  id: string;
  /** Geometrisk treff på teigen, ikke bekreftet registerkobling til matrikkelenheten. */
  kobling: "geometri";
  objekttype?: string;
  bygningsnummer?: number;
  bygningstype?: number;
  bygningstypeNavn?: string;
  bygningsstatus?: string;
  bygningsstatusNavn?: string;
  /** Registrert BRA fra kilden, ikke BYA eller beregnet utnyttelsesgrad. */
  bruksareal?: number;
};

export type GarasjeBebyggelse = {
  /** Bekrefter kartlagt eksisterende bebyggelse, aldri at den er lovlig. */
  status: "bekreftet" | "uavklart";
  bebygd: boolean | null;
  bygninger: GarasjeEksisterendeBygning[];
  forklaring: string;
  kilde: string;
};

export type GarasjeArealberegning = {
  tomtearealM2: number | null;
  kartlagtBebygdArealM2: number | null;
  kartlagtAndelProsent: number | null;
  kilde: string;
  metode: string;
  forbehold: string[];
};

/** Tomter i kartutsnittet, ikke bekreftet grensenabo eller vurdert eiendom. */
export type GarasjeNabotomter = {
  tomter: GarasjePolygon[];
  kilde: GarasjeKilde;
};

/**
 * En planflate fra KPA2018 som berører eiendommen.
 *
 * To kategorier med vilje i én liste: de tegnes i det samme kartet og hentes fra
 * den samme kilden, men de er ikke det samme rettslig. En hensynssone legger et
 * hensyn på området (plan- og bygningsloven § 11-8); et arealformål sier hva
 * området er satt av til. Regelen leser bare hensynssonene - arealformålet
 * avgjøres fortsatt av det live punktoppslaget mot kommunens kart, som er
 * kontrollert mot tegnforklaringen.
 *
 * En union og ikke én flat form med nullbare felter: `hensynstype` finnes bare
 * for en hensynssone og `arealstatus` bare for et arealformål, og med dem som
 * valgfrie på begge måtte tegnekoden skrive en reservefarge for en hensynssone
 * uten type. Den reserven kunne ikke inntreffe og ville uansett tegnet en
 * faresone grønn. Nå kan den ikke skrives.
 *
 * Ringene er klippet til kartutsnittet plan-mock ble spurt om, så de har kanter
 * som ikke er sonegrenser. De skal tegnes og brukes til å svare på om sonen
 * berører eiendommen. Ingen avstand skal måles mot dem.
 */
type GarasjePlanflateFelles = {
  /** Datasettet hos plan-mock: «stoy», «fare», «arealformaal», … */
  datasett: string;
  sonekode: number;
  /** Klarspråksnavnet fra et kontrollert register, ikke kildens egen tekst. */
  navn: string;
  /** Hva flaten betyr for en som vil bygge. */
  beskrivelse: string;
  /**
   * Kildens egen BESKRIVELSE, ordrett - «Eikås motorsport - gul sone». Det er
   * den som sier hva hensynet konkret gjelder. Kilden har skrivefeil
   * («Naturomåde»); de står som de står, fordi teksten er kommunens og ikke vår.
   */
  kildetekst: string | null;
  /** «helt» når hele den kartlagte eiendommen ligger inne i flaten, ellers «delvis». */
  berorer: "helt" | "delvis";
  planId: string;
  ringer: [number, number][][];
};

export type GarasjePlanflate =
  | (GarasjePlanflateFelles & {
      kategori: "hensynssone";
      /** HENSYNSONENAVN, for eksempel «H220_1». */
      sonenavn: string;
      hensynstype: Hensynssonetype;
    })
  | (GarasjePlanflateFelles & {
      kategori: "arealformaal";
      /** AREALST. Sammen med sonekoden er det nøkkelen til soneregisteret. */
      arealstatus: number;
    });

export type GarasjeGrunnlag = {
  adresse: GarasjeAdresse;
  punkt: GarasjePunkt;
  arealformaal: GarasjeArealformaal[];
  reguleringsplaner: GarasjePlan[];
  eiendomsgrenser: GarasjePolygon[];
  eiendomsgeojson?: GarasjeEiendomsGeoJson;
  nabotomter?: GarasjeNabotomter;
  bygninger: GarasjePolygon[];
  /** Hensynssoner og arealformål fra KPA2018 som berører eiendommen. */
  planflater: GarasjePlanflate[];
  bebyggelse: GarasjeBebyggelse;
  arealberegning: GarasjeArealberegning;
  kilder: GarasjeKilde[];
  uavklarteForhold: string[];
  tiltaksvarsler?: GarasjeSjekk[];
};

export type GarasjeTiltak = {
  bra: number;
  bya: number;
  gesimshoyde: number;
  monehoyde: number;
  etasjer: number;
  frittliggende: boolean | null;
  beboelse: boolean | null;
  kjeller: boolean | null;
  bebygdEiendom: boolean | null;
  avstandNabogrense: number | null;
  avstandBygning: number | null;
  overVannAvlop: boolean | null;
};

export type GarasjeSjekk = {
  id: string;
  navn: string;
  status: "oppfylt" | "brudd" | "uavklart";
  forklaring: string;
  kilde: string;
  bestemmelse?: string;
};

/**
 * Utfallene vurderingen kan gi. En as const-liste og ikke bare en union, fordi en
 * union er borte ved kjøretid: hver kaller som skulle validere et utfall skrev
 * verdiene av på nytt, og en fjerde verdi i unionen gjorde ingenting rødt.
 *
 * `GARASJE_UTFALL_FRITAR` er det ene utfallet som slipper innbyggeren fri fra å
 * søke. Alvorsordenen bor her, ved kodeverket, av samme grunn som `SLIPPER_GJENNOM`
 * i `vilkaar.ts` bor ved regelen: en kaller skal kunne sammenligne uten å
 * klassifisere selv.
 */
export const GARASJE_UTFALL = ["ikke_soknadspliktig", "meldeplikt", "soknadspliktig", "maa_avklares"] as const;
export type GarasjeUtfall = (typeof GARASJE_UTFALL)[number];
export const GARASJE_UTFALL_FRITAR = "ikke_soknadspliktig" as const;

/**
 * Utfallene som ikke krever en søknad. To, ikke ett, fordi fagpersonens flytkart
 * skiller dem: et tiltak kan være fritatt fra søknad og likevel ha en plikt til å
 * meldes inn til kommunen når det er ferdig. `meldeplikt` er derfor en egen verdi og
 * ikke et flagg ved siden av `ikke_soknadspliktig` - et flagg måtte hver kaller
 * huske å lese, mens en verdi i kodeverket over ikke kan glemmes.
 *
 * `utfallFritarForSoknad` er stedet en kaller spør «slipper innbyggeren å søke?»
 * uten å klassifisere selv. Klemmen i `garasje-raad.ts` leser den, og det er derfor
 * et tredje mildt utfall aldri kan smette forbi den ved at noen bare sammenlignet
 * med ett navn. Listen er ikke eksportert: predikatet er hele grensesnittet.
 */
const UTEN_SOKNAD: readonly GarasjeUtfall[] = ["ikke_soknadspliktig", "meldeplikt"];
export const utfallFritarForSoknad = (utfall: GarasjeUtfall): boolean => UTEN_SOKNAD.includes(utfall);

export type GarasjeVurdering = {
  tiltakstype?: Byggetiltakstype;
  utfall: GarasjeUtfall;
  nasjonaltUnntak: "oppfylt" | "brudd" | "uavklart";
  forklaring: string;
  sjekker: GarasjeSjekk[];
  uavklarteForhold: string[];
  nesteSteg?: string[];
};

/**
 * Det ene svaret innbyggeren skal lese, og hvorfor det ble slik.
 *
 * Gjennomgangen av løsningen ba om «et tydelig svar, selv om det er «Du bør
 * kontakte lokale rådgivere»». Vurderingen hadde svaret, men bare som en
 * kodeverdi og en lang forklaring: klienten skrev «Dette må avklares før du
 * bygger» og deretter fjorten sjekker, uten noen setning som svarte ja, nei
 * eller kontakt kommunen.
 *
 * Funksjonen bor her og ikke i klienten fordi den leser alvorsordenen ved
 * kodeverket over, og fordi en andre inngang - chat, agent eller et annet
 * lag - skal kunne si det samme. Tiltakssiden er den ene kalleren i dag. Den
 * avgjør ingenting: `utfall` er alt bestemt av reglene, og det avgjørende
 * vilkåret er navngitt fra sjekkene, aldri utledet.
 *
 * Tabellen er nøklet på hele kodeverket og ikke en if-kjede med en hale, slik at
 * et nytt utfall blir en kompileringsfeil her - der setningen velges - og ikke
 * bare i klientens fargekart.
 */
export type GarasjeSvarsetning = {
  /** Kort overskrift: «Nei, du må søke», «Kontakt kommunen». */
  tittel: string;
  /** Én setning som svarer innbyggeren. */
  svar: string;
  /** Hvilke vilkår som gjorde det, navngitt fra sjekkene. Tom når ingen skiller seg ut. */
  begrunnelse: string;
};

export function beskrivGarasjeUtfall(vurdering: GarasjeVurdering): GarasjeSvarsetning {
  // Sjekkene som avgjorde, i klarspråk: høyst tre navn, føyd sammen slik en
  // nordmann skriver en liste. `Intl.ListFormat` gjør det samme som en håndskrevet
  // «a, b og c», og er måten resten av repoet formaterer for nb-NO.
  const avgjorende = (status: GarasjeSjekk["status"]): string =>
    new Intl.ListFormat("nb-NO", { style: "long", type: "conjunction" }).format(
      vurdering.sjekker.filter(sjekk => sjekk.status === status).map(sjekk => sjekk.navn).slice(0, 3),
    ).toLocaleLowerCase("nb-NO");
  const setninger: Record<GarasjeUtfall, () => GarasjeSvarsetning> = {
    soknadspliktig: () => ({
      tittel: "Nei, du må søke",
      svar: "Nei. Slik tiltaket er beskrevet, må du søke kommunen før du bygger.",
      begrunnelse: avgjorende("brudd") ? `Det avgjørende er ${avgjorende("brudd")}.` : "",
    }),
    meldeplikt: () => ({
      tittel: "Ja, men du må melde inn",
      svar: "Ja. Tiltaket er unntatt fra søknadsplikt etter de vilkårene som er kontrollert her, men du må melde det inn til kommunen når det er ferdig bygget.",
      begrunnelse: vurdering.sjekker.find(sjekk => sjekk.id === "meldeplikt")?.forklaring ?? "",
    }),
    ikke_soknadspliktig: () => ({
      tittel: "Ja, du kan bygge uten å søke",
      svar: "Ja. Reglene som er kontrollert her, krever ingen søknad for tiltaket slik du har beskrevet det.",
      begrunnelse: "Kontroller at opplysningene fortsatt stemmer, og husk at andre krav enn søknadsplikten kan gjelde.",
    }),
    maa_avklares: () => ({
      tittel: "Kontakt kommunen",
      svar: "Vi kan ikke svare ja eller nei på dette. Kontakt kommunens plan- og byggesaksrådgivere før du bygger.",
      begrunnelse: avgjorende("uavklart") ? `Det står igjen å avklare ${avgjorende("uavklart")}.` : "",
    }),
  };
  return setninger[vurdering.utfall]();
}

/**
 * Navnet på en hensynssone slik innbyggeren skal lese det: «Gul støysone H220_1».
 *
 * Her, ved siden av `GarasjePlanflate`, fordi både regelen og kartet skriver
 * setningen «Eiendommen berøres av …» og de skrev den hver sin vei. Klienten kan
 * ikke importere fra `sandbox-backend` og omvendt, så en delt funksjon er det ene
 * stedet begge kan hente den fra.
 */
export function hensynssonenavn(flate: Extract<GarasjePlanflate, { kategori: "hensynssone" }>): string {
  return `${flate.navn} ${flate.sonenavn}`;
}
