import type { GarasjeGrunnlag } from "./garasje.ts";

export type GarasjeDialogfeltId =
  | "bya" | "bra" | "gesimshoyde" | "monehoyde" | "etasjer"
  | "avstandNabogrense" | "avstandBygning"
  | "frittliggende" | "beboelse" | "kjeller" | "overVannAvlop";

export type GarasjeDialogfelt = {
  readonly id: GarasjeDialogfeltId;
  readonly label: string;
  readonly hint: string;
  readonly type: "tall" | "valg";
  readonly min?: number;
  readonly max?: number;
  readonly heltall?: boolean;
  readonly ukjentTillatt: boolean;
};

export const GARASJE_DIALOGFELTER: readonly GarasjeDialogfelt[] = [
  { id: "bya", label: "Bebygd areal (BYA), m²", hint: "Byggets fotavtrykk, inkludert areal som skal medregnes.", type: "tall", min: 0.01, max: 10000, ukjentTillatt: false },
  { id: "bra", label: "Bruksareal (BRA), m²", hint: "Bruksarealet innenfor omsluttende vegger.", type: "tall", min: 0.01, max: 10000, ukjentTillatt: false },
  { id: "gesimshoyde", label: "Høyde der vegg og tak møtes (gesimshøyde), meter", hint: "Måles fra gjennomsnittet av bakken rundt bygget etter terrengarbeidene. Spør KI om takformen eller målepunktet er uklart.", type: "tall", min: 0.01, max: 100, ukjentTillatt: false },
  { id: "monehoyde", label: "Høyde til mønet på taket (mønehøyde), meter", hint: "Måles fra samme gjennomsnittsnivå som gesimshøyden. Et flatt tak har ikke et vanlig møne; avklar målepunktet.", type: "tall", min: 0.01, max: 100, ukjentTillatt: false },
  { id: "etasjer", label: "Antall etasjer", hint: "Alle etasjer i det planlagte bygget.", type: "tall", min: 1, max: 100, heltall: true, ukjentTillatt: false },
  { id: "avstandNabogrense", label: "Avstand til nabogrense, meter", hint: "Korteste avstand fra bygget. Svar «vet ikke» hvis avstanden er ukjent.", type: "tall", min: 0, max: 10000, ukjentTillatt: true },
  { id: "avstandBygning", label: "Avstand til annen bygning på eiendommen, meter", hint: "Korteste avstand. Svar «vet ikke» hvis avstanden er ukjent.", type: "tall", min: 0, max: 10000, ukjentTillatt: true },
  { id: "frittliggende", label: "Er garasjen frittliggende?", hint: "Svar ja, nei eller «vet ikke».", type: "valg", ukjentTillatt: true },
  { id: "beboelse", label: "Skal bygget brukes til beboelse eller overnatting?", hint: "Svar ja, nei eller «vet ikke».", type: "valg", ukjentTillatt: true },
  { id: "kjeller", label: "Skal bygget ha kjeller?", hint: "Svar ja, nei eller «vet ikke».", type: "valg", ukjentTillatt: true },
  { id: "overVannAvlop", label: "Skal garasjen stå over vann- eller avløpsledninger?", hint: "Svar ja, nei eller «vet ikke».", type: "valg", ukjentTillatt: true }
];

type QuestionField = {
  id: string;
  label: string;
  type?: string;
  alternativer?: (string | { verdi: string; label: string })[];
};
type FieldAnswer = { valid: true; value: string } | { valid: false; retryMessage?: string };
export type GarasjeDialogSvar = number | boolean | null;
export type GarasjeDialogValidering =
  | { valid: true; value: GarasjeDialogSvar }
  | { valid: false; retryMessage: string };

function normalizeFieldText(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
}

export function normalizeGarasjeNumber(field: QuestionField, answer: string): FieldAnswer | null {
  const area = ["bra", "bya"].includes(field.id);
  const distance = ["avstandNabogrense", "avstandBygning"].includes(field.id);
  const length = distance || ["gesimshoyde", "monehoyde"].includes(field.id);
  const integer = ["gnr", "bnr", "etasjer"].includes(field.id);
  const coordinate = ["lat", "lon"].includes(field.id);
  if (!area && !length && !integer && !coordinate) return null;

  const text = answer.trim().toLowerCase();
  if (distance && ["vet ikke", "vet-ikke", "ukjent"].includes(text)) return { valid: true, value: "vet-ikke" };
  const pattern = area ? /^([+-]?\d+(?:[.,]\d+)?)\s*(?:m2|m²|kvm|kvadratmeter)?$/
    : length ? /^([+-]?\d+(?:[.,]\d+)?)\s*(?:m|meter)?$/
      : field.id === "etasjer" ? /^([+]?\d+)\s*(?:etasje|etasjer)?$/
        : integer ? /^([+]?\d+)$/
          : /^([+-]?\d+(?:[.,]\d+)?)$/;
  const match = text.match(pattern);
  const value = match ? Number(match[1].replace(",", ".")) : NaN;
  const valid = Number.isFinite(value)
    && (coordinate ? field.id === "lat" ? Math.abs(value) <= 90 : Math.abs(value) <= 180
      : distance ? value >= 0 : value > 0)
    && (!integer || Number.isSafeInteger(value));
  if (!valid) {
    const hint = area ? "Skriv ett positivt areal, for eksempel 49 m² eller 49,5 m²."
      : length ? `Skriv ett mål i meter, for eksempel 3 meter eller 3,5 m.${distance ? " Du kan også svare «vet ikke»." : " Høyden må være større enn null."}`
        : integer ? `Skriv ett positivt heltall${field.id === "etasjer" ? ", for eksempel 1 etasje" : ""}.`
          : "Skriv én koordinat som tall, for eksempel 60,39. Bruk kartet hvis du er usikker.";
    return { valid: false, retryMessage: `${field.label}: ${hint}` };
  }
  return { valid: true, value: String(value) };
}

export function normalizeQuestionFieldAnswer(field: QuestionField, answer: string, garasje = false): FieldAnswer {
  if (garasje) {
    const numeric = normalizeGarasjeNumber(field, answer);
    if (numeric) return numeric;
  }
  if (field.type === "ja-nei") {
    const folded = normalizeFieldText(answer);
    if (["ja", "japp", "yes"].includes(folded)) return { valid: true, value: "ja" };
    if (["nei", "no"].includes(folded)) return { valid: true, value: "nei" };
    return { valid: false };
  }
  if (field.type !== "valg" || !field.alternativer?.length) {
    return { valid: true, value: answer };
  }
  const folded = normalizeFieldText(answer);
  const match = field.alternativer.find((alternativ) => {
    const value = typeof alternativ === "string" ? alternativ : alternativ.verdi;
    const label = typeof alternativ === "string" ? alternativ : alternativ.label;
    return normalizeFieldText(value) === folded || normalizeFieldText(label) === folded;
  });
  if (!match) return { valid: false };
  return { valid: true, value: typeof match === "string" ? match : match.verdi };
}

export function isGarasjeDialogfeltId(value: unknown): value is GarasjeDialogfeltId {
  return typeof value === "string" && GARASJE_DIALOGFELTER.some(field => field.id === value);
}

/** Validerer ett oppgitt mål eller valg, ikke om garasjen kan bygges. */
export function validateGarasjeDialogSvar(feltId: GarasjeDialogfeltId, answer: unknown): GarasjeDialogValidering {
  const field = GARASJE_DIALOGFELTER.find(field => field.id === feltId);
  if (!field) return { valid: false, retryMessage: "Velg et kjent garasjefelt." };
  const invalid = (message = field.hint): GarasjeDialogValidering => ({
    valid: false, retryMessage: `${field.label}: ${message}`
  });
  if (answer === null) return field.ukjentTillatt ? { valid: true, value: null } : invalid("Dette feltet trenger et tall.");
  if (field.type === "valg" && typeof answer === "boolean") return { valid: true, value: answer };
  let value: unknown = answer;
  if (typeof answer === "string") {
    if (!answer.trim() || answer.length > 500) return invalid();
    const unknown = normalizeQuestionFieldAnswer({
      ...field, type: "valg", alternativer: [{ verdi: "vet-ikke", label: "vet ikke" }, "ukjent"]
    }, answer);
    if (unknown.valid) return field.ukjentTillatt ? { valid: true, value: null } : invalid("Dette feltet trenger et tall.");
    const parsed = normalizeQuestionFieldAnswer({ ...field, type: field.type === "valg" ? "ja-nei" : "tall" }, answer, true);
    if (!parsed.valid) return { valid: false, retryMessage: parsed.retryMessage || `${field.label}: ${field.hint}` };
    value = field.type === "valg" ? parsed.value === "ja" : Number(parsed.value);
  }
  if (field.type === "valg") return typeof value === "boolean" ? { valid: true, value } : invalid();
  if (typeof value !== "number" || !Number.isFinite(value)) return invalid("Skriv ett gyldig tall.");
  if (field.heltall && !Number.isSafeInteger(value)) return invalid("Skriv ett heltall.");
  if (value < field.min! || value > field.max!) return invalid(`Skriv et tall fra ${String(field.min).replace(".", ",")} til ${field.max}.`);
  return { valid: true, value };
}

/** Sammenligner bare høyder; et tomt felt må valideres når det besvares. */
export function validateGarasjeDialogHoyder(svar: { gesimshoyde?: unknown; monehoyde?: unknown }): string | null {
  return typeof svar.gesimshoyde === "number" && typeof svar.monehoyde === "number" && svar.gesimshoyde > svar.monehoyde
    ? "Gesimshøyden kan ikke være større enn mønehøyden." : null;
}

/** A field conversation needs a few facts, never parcel/neighbor geometry or personal identifiers. */
export function projectGarasjeDialogGrunnlag(grunnlag: GarasjeGrunnlag | null) {
  if (!grunnlag) return {};
  return {
    garasje: {
      adresse: { kommunenummer: grunnlag.adresse.kommunenummer },
      arealformaal: grunnlag.arealformaal.slice(0, 8).map(sone => ({
        kode: sone.kode, arealstatus: sone.arealstatus,
        sonenavn: sone.sonenavn?.slice(0, 100), planId: sone.planId.slice(0, 30)
      })),
      arealberegning: {
        tomtearealM2: grunnlag.arealberegning.tomtearealM2,
        kartlagtBebygdArealM2: grunnlag.arealberegning.kartlagtBebygdArealM2,
        kartlagtAndelProsent: grunnlag.arealberegning.kartlagtAndelProsent
      }
    }
  };
}
