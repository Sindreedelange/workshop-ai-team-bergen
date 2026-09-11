import { HttpError } from "./errors.ts";
import { isByggetiltakstype, type Byggetiltakstype } from "../../shared/byggetiltak.ts";

export function readTiltakshjelpenTiltakstype(sok: URLSearchParams): Byggetiltakstype | undefined {
  const values = sok.getAll("tiltakstype");
  if (values.length === 0) return undefined;
  if (values.length !== 1 || !isByggetiltakstype(values[0])) {
    throw new HttpError("tiltakstype må være én dokumentert tiltakstype, eller ukjent.", 400);
  }
  return values[0];
}

export function readTiltakshjelpenKommune(sok: URLSearchParams): string | undefined {
  const kommune = sok.get("kommunenummer");
  if (kommune === null) return undefined;
  if (!/^\d{4}$/.test(kommune) || kommune === "0000") {
    throw new HttpError("kommunenummer må ha fire sifre.", 400);
  }
  return kommune;
}

export function readTiltakshjelpenSearch(sok: URLSearchParams): string {
  const tekst = sok.get("sok")?.trim();
  if (!tekst || tekst.length < 3 || tekst.length > 120) {
    throw new HttpError("Adressesøket må ha mellom 3 og 120 tegn.", 400);
  }
  return tekst;
}

export function readTiltakshjelpenRequest(sok: URLSearchParams) {
  const adresse = sok.get("adresse")?.trim();
  if (!adresse || adresse.length < 3 || adresse.length > 120) {
    throw new HttpError("En full adresse er påkrevd (3–120 tegn).", 400);
  }
  const gnr = readNumber(sok, "gnr", 1, 100000, true);
  const bnr = readNumber(sok, "bnr", 1, 1000000, true);
  const lat = sok.get("lat");
  const lon = sok.get("lon");
  if ((lat === null) !== (lon === null)) {
    throw new HttpError("Plasseringen må ha både lat og lon.", 400);
  }
  const plassering = lat === null ? undefined : {
    lat: readNumber(sok, "lat", -90, 90),
    lon: readNumber(sok, "lon", -180, 180)
  };
  const kommunenummer = readTiltakshjelpenKommune(sok);
  const tiltakstype = readTiltakshjelpenTiltakstype(sok);
  return { adresse, gnr, bnr, plassering, ...(kommunenummer ? { kommunenummer } : {}), ...(tiltakstype ? { tiltakstype } : {}) };
}

function readNumber(sok: URLSearchParams, felt: string, min: number, max: number, integer = false): number {
  const tekst = sok.get(felt);
  const verdi = tekst === null || tekst.trim() === "" ? NaN : Number(tekst);
  if (!Number.isFinite(verdi) || verdi < min || verdi > max || (integer && !Number.isSafeInteger(verdi))) {
    throw new HttpError(`${felt} må være ${integer ? "et heltall" : "et tall"} mellom ${min} og ${max}.`, 400);
  }
  return verdi;
}

export function readTiltakshjelpenTiltakJson(sok: URLSearchParams): unknown {
  const tekst = sok.get("tiltak");
  if (!tekst || tekst.length > 5000) {
    throw new HttpError("Opplysninger om tiltaket er påkrevd i tiltak (maks 5000 tegn).", 400);
  }
  try {
    return JSON.parse(tekst);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new HttpError("Tiltaksopplysningene i tiltak må være gyldig JSON.", 400);
  }
}
