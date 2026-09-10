import type { GarasjePolygon, GarasjePunkt } from "../../../shared/garasje.ts";

export type Kartutsnitt = { west: number; east: number; south: number; north: number };
const metersPerDegree = 111320;

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
