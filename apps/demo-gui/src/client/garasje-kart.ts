import type { GarasjePolygon, GarasjePunkt } from "../../../shared/garasje.ts";
import { nearestPointOnPolygonBoundary, ringerInneholder } from "../../../shared/geometri.ts";

export type Kartutsnitt = { west: number; east: number; south: number; north: number };
const metersPerDegree = 111320;

export type GarasjeGrenseavstand = {
  punkt: GarasjePunkt;
  avstandMeter: number;
  innenfor: boolean;
  polygonId: string;
  ringIndex: number;
  segmentIndex: number;
};

/** Marker-to-mapped-edge estimate only. Null preserves unknown geometry, not zero distance. */
export function nearestPolygonBoundary(punkt: GarasjePunkt, polygons: readonly GarasjePolygon[]): GarasjeGrenseavstand | null {
  const nearest = nearestPointOnPolygonBoundary([punkt.lon, punkt.lat], polygons.map(polygon => polygon.ringer));
  if (!nearest) return null;
  return {
    punkt: { lon: nearest.point[0], lat: nearest.point[1] },
    avstandMeter: nearest.distanceMeters, innenfor: nearest.inside,
    polygonId: polygons[nearest.polygonIndex]!.id, ringIndex: nearest.ringIndex, segmentIndex: nearest.segmentIndex,
  };
}

export const findNaermesteTomtegrense = nearestPolygonBoundary;

export function fitKartutsnitt(polygons: GarasjePolygon[], center: GarasjePunkt): Kartutsnitt {
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const polygon of polygons) {
    for (const ring of polygon.ringer) {
      for (const [lon, lat] of ring) {
        west = Math.min(west, lon); east = Math.max(east, lon);
        south = Math.min(south, lat); north = Math.max(north, lat);
      }
    }
  }
  const lonMeters = metersPerDegree * Math.cos(center.lat * Math.PI / 180);
  if (!Number.isFinite(west)) {
    return {
      west: center.lon - 120 / lonMeters, east: center.lon + 120 / lonMeters,
      south: center.lat - 90 / metersPerDegree, north: center.lat + 90 / metersPerDegree
    };
  }
  const bounds = {
    west: west - 10 / lonMeters, east: east + 10 / lonMeters,
    south: south - 10 / metersPerDegree, north: north + 10 / metersPerDegree
  };
  const width = (bounds.east - bounds.west) * lonMeters;
  const height = (bounds.north - bounds.south) * metersPerDegree;
  if (width / height < 640 / 480) {
    const extra = (height * 640 / 480 - width) / lonMeters / 2;
    bounds.west -= extra;
    bounds.east += extra;
  } else {
    const extra = (width * 480 / 640 - height) / metersPerDegree / 2;
    bounds.south -= extra;
    bounds.north += extra;
  }
  return bounds;
}

export function projectGarasjePunkt(punkt: GarasjePunkt, bounds: Kartutsnitt): [number, number] {
  return [
    (punkt.lon - bounds.west) / (bounds.east - bounds.west) * 640,
    (bounds.north - punkt.lat) / (bounds.north - bounds.south) * 480
  ];
}

export function unprojectGarasjePunkt(x: number, y: number, bounds: Kartutsnitt): GarasjePunkt {
  return {
    lon: bounds.west + Math.max(0, Math.min(1, x)) * (bounds.east - bounds.west),
    lat: bounds.north - Math.max(0, Math.min(1, y)) * (bounds.north - bounds.south)
  };
}

export type KartLabel = { x: number; y: number; width: number };

/** Labels need a visible interior position, not a bounding-box centre that can sit on another parcel. */
export function findNabotomtLabel(
  polygon: GarasjePolygon, selected: GarasjePolygon[], bounds: Kartutsnitt, width: number, occupied: KartLabel[]
): KartLabel | null {
  const rings = polygon.ringer.map(ring => ring.map(([lon, lat]) => projectGarasjePunkt({ lon, lat }, bounds)));
  const excluded = selected.map(shape => shape.ringer.map(ring => ring.map(([lon, lat]) => projectGarasjePunkt({ lon, lat }, bounds))));
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const ring of rings) for (const [x, y] of ring) {
    xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);
    ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
  }
  const left = Math.max(width / 2 + 6, xmin), right = Math.min(634 - width / 2, xmax);
  const top = Math.max(18, ymin), bottom = Math.min(462, ymax);
  const candidates: KartLabel[] = [];
  for (let y = top; y <= bottom; y += 16) for (let x = left; x <= right; x += 16) candidates.push({ x, y, width });
  candidates.sort((a, b) =>
    Math.hypot(a.x - (left + right) / 2, a.y - (top + bottom) / 2)
    - Math.hypot(b.x - (left + right) / 2, b.y - (top + bottom) / 2));
  for (const candidate of candidates) {
    const { x, y } = candidate;
    if (occupied.some(other => Math.abs(x - other.x) < (width + other.width) / 2 + 6 && Math.abs(y - other.y) < 26)) continue;
    const samples = [[x, y], [x - width / 2, y - 10], [x + width / 2, y - 10], [x - width / 2, y + 8], [x + width / 2, y + 8]];
    if (samples.every(([sx, sy]) => ringerInneholder(sx!, sy!, rings) && !excluded.some(shape => ringerInneholder(sx!, sy!, shape)))) return candidate;
  }
  return null;
}
