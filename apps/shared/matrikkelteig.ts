import type { Flategeometri } from "./geometri.ts";

/** Teiggeometrien er en vanlig flate; navnet står for lesbarheten i signaturene. */
export type MatrikkelTeigGeometri = Flategeometri;

export type MatrikkelTeigEgenskaper = {
  OBJECTID: number;
  OBJTYPE: "Teig";
  GNR: number;
  BNR: number;
  FNR: number;
  SNR: number;
  AREAL: number | null;
  AREALMERKNAD: string | null;
  TINGLYST: string;
  ANTALL_GID: number;
  Shape_Area: number;
  Shape_Length: number;
};

export type MatrikkelTeigFeature = {
  type: "Feature";
  /** Uttrekkets OBJECTID, ikke en global teigidentifikator. */
  id: number;
  geometry: MatrikkelTeigGeometri;
  properties: MatrikkelTeigEgenskaper;
};

export type MatrikkelTeigSvar = {
  kommunenummer: string;
  kildestatus: "tilgjengelig" | "ikke_dekket";
  kilde: {
    navn: string;
    fil: string | null;
    /** Året i filnavnet, ikke en måledato. */
    uttrekksaar: number | null;
    koordinatsystem: "EPSG:4326";
    syntetisk: false;
  };
  type: "FeatureCollection";
  features: MatrikkelTeigFeature[];
};

export const NABOTEIG_MAX_TREFF = 200;

export type MatrikkelNaboteigSvar = MatrikkelTeigSvar & {
  /** Alle indekstreff i utsnittet, ikke en garanti for at uttrekket dekker alle eiendommer. */
  avkortet: false;
};
