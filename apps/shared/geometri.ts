/**
 * Ren geometri på lengde- og breddegrader: kartutsnittet, flategeometrien og
 * ray casten som avgjør om et punkt ligger inne i en flate.
 *
 * Modulen finnes fordi `ringerInneholder` besvarer det samme spørsmålet fra to
 * kanter: serveren avgjør om skissepunktet ligger i en planflate, og nettleseren
 * viser det samme mens markøren dras. To kopier svarte forskjellig på et punkt
 * nøyaktig på kanten, og det er ikke en forskjell noen har bestemt.
 *
 * Den var en stund større. De to mockene som leste et innsjekket GeoJSON-uttrekk
 * indekserte med de samme vaktene, og de vaktene bodde her - men uttrekkene er
 * borte, og kildene svarer nå i Esris eget format. Det som ble igjen er det som
 * faktisk deles.
 *
 * Ingenting her kjenner et domene. Rekkefølgen på et koordinatpar er
 * [lengdegrad, breddegrad], slik GeoJSON krever, og ikke lat/lon slik
 * `TiltakshjelpenPunkt` skriver det.
 */

export type Kartutsnitt = { vest: number; sor: number; ost: number; nord: number };

/** Polygon- eller MultiPolygon-ringer, uten krav til hvilke egenskaper de bærer. */
type Flategeometri =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

/**
 * Taket på hvor stort et utsnitt kan være, i meter langs hver side.
 *
 * Den ble en parameter fordi to ruter trengte hvert sitt tak, og den står som
 * parameter selv om bare naboteigoppslaget er igjen: taket er en sperre mot
 * bulkuttrekk av eiendommer og hører til ruten som trenger den, ikke til
 * geometrien. Å arve et tak ingen har utledet for en ny rute er hvordan 2,3
 * prosent av eiendommene mistet hensynssonesjekken uten at noe sa fra.
 */
export function isBoundedKartutsnitt(bounds: Kartutsnitt, maksSideMeter: number): boolean {
  const { vest, sor, ost, nord } = bounds;
  if (![vest, sor, ost, nord].every(Number.isFinite)
    || vest < -180 || ost > 180 || sor <= -90 || nord >= 90 || vest >= ost || sor >= nord) return false;
  const nearEquator = sor <= 0 && nord >= 0 ? 0 : Math.min(Math.abs(sor), Math.abs(nord));
  return (nord - sor) * 111700 <= maksSideMeter
    && (ost - vest) * 111700 * Math.cos(nearEquator * Math.PI / 180) <= maksSideMeter;
}

export function getGeometriBounds(geometry: Flategeometri): Kartutsnitt {
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

export function intersectsKartutsnitt(a: Kartutsnitt, b: Kartutsnitt): boolean {
  return a.vest <= b.ost && a.ost >= b.vest && a.sor <= b.nord && a.nord >= b.sor;
}

/**
 * Ray casting mot ringene, med even-odd slik at hull teller som utenfor.
 *
 * Ett sted, fordi svaret er synlig for innbyggeren fra to kanter: serveren
 * avgjør om skissepunktet ligger i en planflate, og nettleseren viser det samme
 * mens markøren dras. To kopier svarte forskjellig på et punkt nøyaktig på
 * kanten, og det er ikke en forskjell noen har bestemt.
 *
 * Kalles både i pikselplanet og i lengde-/breddegrader; projeksjonen i
 * `projectTiltakshjelpenPunkt` er lineær, så det er det samme regnestykket.
 */
export function ringerInneholder(x: number, y: number, ringer: readonly (readonly (readonly number[])[])[]): boolean {
  let inne = false;
  for (const ring of ringer) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!, b = ring[j]!;
      // Et punkt nøyaktig på kanten regnes som innenfor. Det er sonegrensen selv,
      // og en innbygger som treffer den skal ikke få «utenfor».
      const kryss = (x - a[0]!) * (b[1]! - a[1]!) - (y - a[1]!) * (b[0]! - a[0]!);
      if (Math.abs(kryss) < 1e-14 && x >= Math.min(a[0]!, b[0]!) && x <= Math.max(a[0]!, b[0]!)
        && y >= Math.min(a[1]!, b[1]!) && y <= Math.max(a[1]!, b[1]!)) return true;
      if ((a[1]! > y) !== (b[1]! > y) && x < (b[0]! - a[0]!) * (y - a[1]!) / (b[1]! - a[1]!) + a[0]!) inne = !inne;
    }
  }
  return inne;
}

export type BoundaryPoint = {
  point: [number, number];
  distanceMeters: number;
  inside: boolean;
  polygonIndex: number;
  ringIndex: number;
  segmentIndex: number;
};

/**
 * Local GRS80 estimate from a marker to mapped polygon edges, including holes.
 * This is not a building setback: no footprint, legal boundary or survey quality
 * is known here. All parts must be usable; ignoring an invalid part could choose
 * the wrong nearest edge or incorrectly declare the marker outside.
 */
export function nearestPointOnPolygonBoundary(
  point: readonly [number, number], polygons: readonly (readonly (readonly (readonly number[])[])[])[]
): BoundaryPoint | null {
  const [lon, lat] = point;
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) >= 90
    || !polygons.length || !polygons.every(isPolygon)) return null;
  const latitude = lat * Math.PI / 180;
  const a = 6378137, f = 1 / 298.257222101, e2 = f * (2 - f);
  const denominator = 1 - e2 * Math.sin(latitude) ** 2;
  const eastScale = a / Math.sqrt(denominator) * Math.cos(latitude) * Math.PI / 180;
  const northScale = a * (1 - e2) / denominator ** 1.5 * Math.PI / 180;
  let nearest: BoundaryPoint | null = null;
  for (const [polygonIndex, rings] of polygons.entries()) {
    for (const [ringIndex, ring] of rings.entries()) {
      const projected = ring.map(([x, y]) => [(x! - lon) * eastScale, (y! - lat) * northScale]);
      // The approximation is for parcel-scale maps, not antimeridian crossings
      // or continent-sized geometries.
      if (ring.some(([x, y]) => Math.abs(x! - lon) > 0.05 || Math.abs(y! - lat) > 0.025)) return null;
      let twiceArea = 0;
      const origin = projected[0]!;
      for (let segmentIndex = 0; segmentIndex < projected.length - 1; segmentIndex++) {
        const start = projected[segmentIndex]!, end = projected[segmentIndex + 1]!;
        twiceArea += (start[0]! - origin[0]!) * (end[1]! - origin[1]!)
          - (end[0]! - origin[0]!) * (start[1]! - origin[1]!);
        const dx = end[0]! - start[0]!, dy = end[1]! - start[1]!;
        const lengthSquared = dx * dx + dy * dy;
        if (!lengthSquared) continue;
        const t = Math.max(0, Math.min(1, -(start[0]! * dx + start[1]! * dy) / lengthSquared));
        const x = start[0]! + t * dx, y = start[1]! + t * dy;
        const distanceMeters = Math.hypot(x, y);
        if (nearest === null || distanceMeters < nearest.distanceMeters) {
          nearest = {
            point: [lon + x / eastScale, lat + y / northScale], distanceMeters,
            inside: false, polygonIndex, ringIndex, segmentIndex,
          };
        }
      }
      if (Math.abs(twiceArea) < 1e-8) return null;
    }
  }
  if (nearest) nearest.inside = polygons.some(rings => ringerInneholder(lon, lat, rings));
  return nearest;
}

// --- GeoJSON-vakter -------------------------------------------------------

/**
 * En lukket ring med minst tre entydige punkter og gyldige koordinater.
 *
 * Entydigheten telles med to lagrede punkter og ikke med et Set av
 * «x,y»-strenger. Det er ikke mikrooptimering: målt på det gamle
 * arealformålsuttrekket kostet Set-varianten 150 ms mot 5 ms, altså tre ganger så
 * mye som å parse de 30 MB JSON den validerte, og bygde 724 000 midlertidige
 * strenger.
 */
function isRing(value: unknown): value is number[][] {
  if (!Array.isArray(value) || value.length < 4) return false;
  let entydige = 0;
  let foerste: number[] | undefined;
  let andre: number[] | undefined;
  for (const position of value) {
    if (!Array.isArray(position) || (position.length !== 2 && position.length !== 3)
      || !position.every((coordinate: unknown) => typeof coordinate === "number" && Number.isFinite(coordinate))
      || position[0] < -180 || position[0] > 180 || position[1] < -90 || position[1] > 90) return false;
    if (entydige < 3) {
      if (foerste === undefined) { foerste = position; entydige = 1; }
      else if (position[0] !== foerste[0] || position[1] !== foerste[1]) {
        if (andre === undefined) { andre = position; entydige = 2; }
        else if (position[0] !== andre[0] || position[1] !== andre[1]) entydige = 3;
      }
    }
  }
  const first: number[] = value[0];
  const last: number[] = value[value.length - 1];
  return entydige >= 3 && first.length === last.length && first.every((coordinate, i) => coordinate === last[i]);
}

export function isPolygon(value: unknown): value is number[][][] {
  return Array.isArray(value) && value.length > 0 && value.every(isRing);
}

