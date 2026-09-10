export type MatrikkelTeigGeometri =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

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

export type MatrikkelKartutsnitt = { vest: number; sor: number; ost: number; nord: number };
export const NABOTEIG_MAX_TREFF = 200;

export type MatrikkelNaboteigSvar = MatrikkelTeigSvar & {
  /** Alle indekstreff i utsnittet, ikke en garanti for at uttrekket dekker alle eiendommer. */
  avkortet: false;
};

export function isBoundedKartutsnitt(bounds: MatrikkelKartutsnitt): boolean {
  const { vest, sor, ost, nord } = bounds;
  if (![vest, sor, ost, nord].every(Number.isFinite)
    || vest < -180 || ost > 180 || sor <= -90 || nord >= 90 || vest >= ost || sor >= nord) return false;
  const nearEquator = sor <= 0 && nord >= 0 ? 0 : Math.min(Math.abs(sor), Math.abs(nord));
  return (nord - sor) * 111700 <= 500
    && (ost - vest) * 111700 * Math.cos(nearEquator * Math.PI / 180) <= 500;
}

export function getTeigBounds(geometry: MatrikkelTeigGeometri): MatrikkelKartutsnitt {
  const bounds = { vest: Infinity, sor: Infinity, ost: -Infinity, nord: -Infinity };
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  for (const rings of polygons) for (const ring of rings) for (const position of ring) {
    bounds.vest = Math.min(bounds.vest, position[0]!);
    bounds.sor = Math.min(bounds.sor, position[1]!);
    bounds.ost = Math.max(bounds.ost, position[0]!);
    bounds.nord = Math.max(bounds.nord, position[1]!);
  }
  return bounds;
}

export function intersectsKartutsnitt(a: MatrikkelKartutsnitt, b: MatrikkelKartutsnitt): boolean {
  return a.vest <= b.ost && a.ost >= b.vest && a.sor <= b.nord && a.nord >= b.sor;
}
