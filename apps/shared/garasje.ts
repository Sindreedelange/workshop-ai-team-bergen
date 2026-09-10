import type { Arealsonetype } from "./arealsoner.ts";
import type { Hensynssonetype } from "./hensynssoner.ts";

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
};

export type GarasjeVurdering = {
  utfall: "ikke_soknadspliktig" | "soknadspliktig" | "maa_avklares";
  nasjonaltUnntak: "oppfylt" | "brudd" | "uavklart";
  forklaring: string;
  sjekker: GarasjeSjekk[];
  uavklarteForhold: string[];
};
