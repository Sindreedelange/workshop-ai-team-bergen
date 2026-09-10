import type { Arealsonetype } from "./arealsoner.ts";

export type GarasjePunkt = { lat: number; lon: number };

export type GarasjeAdresse = {
  adressetekst: string;
  kommunenummer: string;
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
};

/** Coordinates are [longitude, latitude] in EPSG:4258, including any inner rings. */
export type GarasjePolygon = {
  id: string;
  ringer: [number, number][][];
  teig?: GarasjeTeig;
  teigId?: number;
  kvalitetsklasse?: string;
  oppdatert?: string;
  matrikkelnummer?: string;
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

/** Native Kartverket GeoJSON, requested in EPSG:4258 like the map's rings. */
export type GarasjeEiendomsGeoJson = {
  type: "FeatureCollection";
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
      lokalid: number;
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

export type GarasjeGrunnlag = {
  adresse: GarasjeAdresse;
  punkt: GarasjePunkt;
  arealformaal: GarasjeArealformaal[];
  reguleringsplaner: GarasjePlan[];
  eiendomsgrenser: GarasjePolygon[];
  eiendomsgeojson?: GarasjeEiendomsGeoJson;
  bygninger: GarasjePolygon[];
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
