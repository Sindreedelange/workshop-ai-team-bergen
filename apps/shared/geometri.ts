/**
 * Ren geometri på lengde- og breddegrader: kartutsnittet, flategeometrien og
 * vaktene som avgjør om et GeoJSON-objekt er en gyldig flate.
 *
 * Dette sto i matrikkelteig.ts mens matrikkel-mock var eneste leser. Navnet
 * `getTeigBounds` lovet matrikkel om noe som ikke vet hva en teig er, og
 * plan-mock indekserer hensynssoner med nøyaktig de samme regnestykkene og de
 * samme vaktene.
 *
 * Ingenting her kjenner et domene. Rekkefølgen på et koordinatpar er
 * [lengdegrad, breddegrad], slik GeoJSON krever, og ikke lat/lon slik
 * `GarasjePunkt` skriver det.
 */

export type Kartutsnitt = { vest: number; sor: number; ost: number; nord: number };

/** Polygon- eller MultiPolygon-ringer, uten krav til hvilke egenskaper de bærer. */
export type Flategeometri =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

/**
 * Taket på hvor stort et utsnitt kan være, i meter langs hver side.
 *
 * En parameter og ikke en konstant: 500 meter er skrevet for naboteigruten, der
 * det er en sperre mot bulkuttrekk av eiendommer. Plan-mock svarer på åpne
 * plandata og må dekke det utsnittet garasjekartet faktisk tegner, som for de
 * største teigene i Bergen er over 800 meter. Å arve et tak ingen har utledet
 * for den nye ruten er hvordan 2,3 prosent av eiendommene mistet
 * hensynssonesjekken uten at noe sa fra.
 */
export function isBoundedKartutsnitt(bounds: Kartutsnitt, maksSideMeter = 500): boolean {
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

/** Bare ringene i én polygondel. Se kommentaren over `spatial` i plan-mock. */
export function getRingBounds(rings: number[][][]): Kartutsnitt {
  return getGeometriBounds({ type: "Polygon", coordinates: rings });
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
 * `projectGarasjePunkt` er lineær, så det er det samme regnestykket.
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

// --- GeoJSON-vakter -------------------------------------------------------
//
// Begge de to tjenestene som leser et lokalt GeoJSON-uttrekk validerer med
// nøyaktig disse reglene. De sto i to kopier, og koordinatgrensene under er
// den slags regel som må endres begge steder eller ingen.

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonnegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function isNonnegativeInteger(value: unknown): value is number {
  return isNonnegativeNumber(value) && Number.isSafeInteger(value);
}

/**
 * En lukket ring med minst tre entydige punkter og gyldige koordinater.
 *
 * Entydigheten telles med to lagrede punkter og ikke med et Set av
 * «x,y»-strenger. Det er ikke mikrooptimering: målt på arealformålsfilen alene
 * kostet Set-varianten 150 ms mot 5 ms, altså tre ganger så mye som å parse de
 * 30 MB JSON den validerer, og bygde 724 000 midlertidige strenger. Over alle
 * filene var det omtrent to tredeler av kaldstarten.
 */
export function isRing(value: unknown): value is number[][] {
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

/** Polygondelene i geometrien, eller null om den ikke er en gyldig flate. */
export function polygonDeler(value: unknown): number[][][][] | null {
  if (!isObject(value)) return null;
  if (value.type === "Polygon" && isPolygon(value.coordinates)) return [value.coordinates];
  if (value.type === "MultiPolygon" && Array.isArray(value.coordinates)
    && value.coordinates.length > 0 && value.coordinates.every(isPolygon)) {
    return value.coordinates as number[][][][];
  }
  return null;
}

/** Geometrien som Polygon eller MultiPolygon, eller null. */
export function projectGeometri(value: unknown): Flategeometri | null {
  const deler = polygonDeler(value);
  if (!deler) return null;
  return deler.length === 1 && isObject(value) && value.type === "Polygon"
    ? { type: "Polygon", coordinates: deler[0]! }
    : { type: "MultiPolygon", coordinates: deler };
}

/**
 * Kommunenummer og kartutsnitt fra en spørrestreng.
 *
 * Delt fordi begge de to lokale geokildene tar nøyaktig dette settet, med de
 * samme reglene og de samme feilmeldingene. Tjenesten oppgir sin egen feiltype
 * og sitt eget tak, som er de to tingene som faktisk skiller dem.
 */
export function parseKartutsnittQuery(
  params: URLSearchParams, feil: (melding: string) => Error, maksSideMeter = 500
): Kartutsnitt & { kommunenummer: string } {
  const fields = ["kommunenummer", "vest", "sor", "ost", "nord"];
  for (const name of params.keys()) {
    if (!fields.includes(name) || params.getAll(name).length !== 1) {
      throw feil("Bruk bare kommunenummer, vest, sor, ost og nord, én gang hver.");
    }
  }
  const kommunenummer = params.get("kommunenummer") || "";
  if (!/^\d{4}$/.test(kommunenummer) || kommunenummer === "0000") {
    throw feil("kommunenummer må være fire sifre og kan ikke være 0000.");
  }
  const coordinate = (name: string): number => {
    const raw = params.get(name);
    if (raw === null || !/^-?\d+(?:\.\d+)?$/.test(raw)) throw feil(`${name} må være en endelig koordinat.`);
    return Number(raw);
  };
  const bounds = { vest: coordinate("vest"), sor: coordinate("sor"), ost: coordinate("ost"), nord: coordinate("nord") };
  if (!isBoundedKartutsnitt(bounds, maksSideMeter)) {
    throw feil(`Kartutsnittet må være gyldige lengde- og breddegrader, høyst ${maksSideMeter} meter langs hver side.`);
  }
  return { kommunenummer, ...bounds };
}
