import type { FrittliggendeTiltak } from "../../shared/tiltakshjelpen.ts";
import { getByggetiltakSporsmaal, isByggetiltakstype, type Byggetiltak, type Byggetiltakstype } from "../../shared/byggetiltak.ts";
import { HttpError } from "./errors.ts";
import { validateByggetiltak, validateFrittliggendeTiltak } from "./tiltakshjelpen.ts";
import { readTiltakshjelpenRequest, readTiltakshjelpenKommune } from "./tiltakshjelpen-request.ts";

const numberFields = ["gnr", "bnr", "lat", "lon", "bra", "bya", "gesimshoyde", "monehoyde", "etasjer"] as const;
const booleanFields = ["frittliggende", "beboelse", "kjeller", "overVannAvlop"] as const;
const distanceFields = ["avstandNabogrense", "avstandBygning"] as const;
const confirmationFields = ["eiendomBekreftet", "plasseringBekreftet"] as const;
const allowedFields: readonly string[] = ["adresse", "kommunenummer", "bebygdEiendom", ...numberFields, ...booleanFields, ...distanceFields, ...confirmationFields];

function readNumber(value: unknown, field: string): number {
  const text = typeof value === "string" ? value.trim().replace(",", ".") : null;
  if (typeof value !== "number" && (text === null || !/^-?\d+(?:\.\d+)?$/.test(text))) {
    throw new HttpError(`${field} må være et tall.`, 400);
  }
  const number = text === null ? value as number : Number(text);
  if (!Number.isFinite(number)) throw new HttpError(`${field} må være et endelig tall.`, 400);
  return number;
}

function readChoice(value: unknown, field: string): "ja" | "nei" | "vet-ikke" {
  if (value === true) return "ja";
  if (value === false) return "nei";
  if (value === null) return "vet-ikke";
  if (typeof value === "string") {
    const text = value.trim().toLocaleLowerCase("nb-NO");
    if (["ja", "true", "bekreftet"].includes(text)) return "ja";
    if (["nei", "false"].includes(text)) return "nei";
    if (["vet-ikke", "vet ikke", "ukjent"].includes(text)) return "vet-ikke";
  }
  throw new HttpError(`${field} må besvares med ja, nei eller vet ikke.`, 400);
}

function isUnknown(value: unknown): boolean {
  return value === null || (typeof value === "string"
    && ["vet-ikke", "vet ikke", "ukjent"].includes(value.trim().toLocaleLowerCase("nb-NO")));
}

export function normalizeTiltakshjelpenSvar(input: unknown): Record<string, string | number> {
  if (input && typeof input === "object" && !Array.isArray(input) && Object.hasOwn(input, "tiltakstype")) {
    return normalizeByggetiltakSvar(input as Record<string, unknown>);
  }
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some(key => !allowedFields.includes(key))) {
    throw new HttpError("Tiltaksprosjektet må bare inneholde de dokumenterte svarfeltene, ikke planvurderinger eller datagrunnlag.", 400);
  }
  const fields = input as Record<string, unknown>;
  if (typeof fields.adresse !== "string") throw new HttpError("En full adresse er påkrevd.", 400);
  const svar: Record<string, string | number> = { adresse: fields.adresse.trim() };
  if (fields.kommunenummer !== undefined) {
    svar.kommunenummer = readTiltakshjelpenKommune(new URLSearchParams({ kommunenummer: String(fields.kommunenummer) }))!;
  }
  // Older clients supplied this field. Validate the legacy value, but never use
  // it as evidence of existing buildings: that comes from the property lookup.
  if (fields.bebygdEiendom !== undefined) readChoice(fields.bebygdEiendom, "bebygdEiendom");
  for (const field of numberFields) svar[field] = readNumber(fields[field], field);
  for (const field of booleanFields) svar[field] = readChoice(fields[field], field);
  for (const field of distanceFields) svar[field] = isUnknown(fields[field]) ? "vet-ikke" : readNumber(fields[field], field);
  for (const field of confirmationFields) {
    if (readChoice(fields[field], field) !== "ja") {
      throw new HttpError(`${field} må bekreftes uttrykkelig før sjekken kan kjøres.`, 400);
    }
    svar[field] = "ja";
  }
  readTiltakshjelpenRequest(buildTiltakshjelpenSok(svar));
  buildTiltakshjelpenTiltak(svar);
  return svar;
}

function normalizeByggetiltakSvar(fields: Record<string, unknown>): Record<string, string | number> {
  if (!isByggetiltakstype(fields.tiltakstype)) {
    throw new HttpError("Velg en dokumentert tiltakstype eller ukjent.", 400);
  }
  const type = fields.tiltakstype;
  const questions = getByggetiltakSporsmaal(type);
  const common = ["adresse", "kommunenummer", "gnr", "bnr", "lat", "lon", ...confirmationFields,
    "tiltakstype", "tiltaksbeskrivelse", "tiltakstypeBekreftet"];
  const allowed = [...common, ...questions.map(q => q.id), ...(["frittliggende", "tilbygg"].includes(type) ? ["bebygdEiendom"] : [])];
  if (Object.keys(fields).some(key => !allowed.includes(key))) {
    throw new HttpError("Svaret inneholder opplysninger som ikke tilhører den bekreftede tiltakstypen.", 400);
  }
  if (typeof fields.adresse !== "string") throw new HttpError("En full adresse er påkrevd.", 400);
  if (typeof fields.tiltaksbeskrivelse !== "string" || !fields.tiltaksbeskrivelse.trim()
    || fields.tiltaksbeskrivelse.length > 2000) {
    throw new HttpError("Beskriv tiltaket med mellom 1 og 2000 tegn.", 400);
  }
  const svar: Record<string, string | number> = {
    adresse: fields.adresse.trim(), tiltakstype: type, tiltaksbeskrivelse: fields.tiltaksbeskrivelse.trim(),
  };
  if (fields.kommunenummer !== undefined) {
    svar.kommunenummer = readTiltakshjelpenKommune(new URLSearchParams({ kommunenummer: String(fields.kommunenummer) }))!;
  }
  for (const field of ["gnr", "bnr", "lat", "lon"]) svar[field] = readNumber(fields[field], field);
  for (const field of [...confirmationFields, "tiltakstypeBekreftet"]) {
    if (readChoice(fields[field], field) !== "ja") {
      throw new HttpError(`${field} må bekreftes uttrykkelig før sjekken kan kjøres.`, 400);
    }
    svar[field] = "ja";
  }
  if (fields.bebygdEiendom !== undefined) readChoice(fields.bebygdEiendom, "bebygdEiendom");
  for (const field of questions) {
    svar[field.id] = field.type === "boolean" ? readChoice(fields[field.id], field.id)
      : isUnknown(fields[field.id]) ? "vet-ikke" : readNumber(fields[field.id], field.id);
  }
  readTiltakshjelpenRequest(buildTiltakshjelpenSok(svar));
  buildTiltakshjelpenTiltak(svar);
  return svar;
}

export function buildTiltakshjelpenSok(svar: Record<string, string | number>): URLSearchParams {
  return new URLSearchParams(Object.fromEntries(
    ["adresse", "gnr", "bnr", "lat", "lon", "kommunenummer", "tiltakstype"].filter(field => svar[field] !== undefined).map(field => [field, String(svar[field])])
  ));
}

export function buildTiltakshjelpenTiltak(svar: Record<string, string | number>): FrittliggendeTiltak | Byggetiltak {
  if (Object.hasOwn(svar, "tiltakstype")) {
    const type = svar.tiltakstype as Byggetiltakstype;
    return validateByggetiltak({
      tiltakstype: type, tiltaksbeskrivelse: svar.tiltaksbeskrivelse,
      tiltakstypeBekreftet: svar.tiltakstypeBekreftet === "ja",
      ...(["frittliggende", "tilbygg"].includes(type) ? { bebygdEiendom: null } : {}),
      ...Object.fromEntries(getByggetiltakSporsmaal(type).map(field => [
        field.id, svar[field.id] === "vet-ikke" ? null
          : field.type === "boolean" ? svar[field.id] === "ja" ? true : svar[field.id] === "nei" ? false : undefined
            : svar[field.id],
      ])),
    });
  }
  return validateFrittliggendeTiltak({
    bebygdEiendom: null,
    ...Object.fromEntries(["bra", "bya", "gesimshoyde", "monehoyde", "etasjer"].map(field => [field, svar[field]])),
    ...Object.fromEntries(booleanFields.map(field => [field, svar[field] === "vet-ikke" ? null : svar[field] === "ja"])),
    ...Object.fromEntries(distanceFields.map(field => [field, svar[field] === "vet-ikke" ? null : svar[field]]))
  });
}
