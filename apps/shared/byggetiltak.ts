import type { GarasjeTiltak } from "./garasje.ts";

export const BYGGETILTAK_TYPER = ["frittliggende", "tilbygg", "gjerde", "fasade", "ukjent"] as const;
export type Byggetiltakstype = (typeof BYGGETILTAK_TYPER)[number];
export function isByggetiltakstype(value: unknown): value is Byggetiltakstype {
  return typeof value === "string" && (BYGGETILTAK_TYPER as readonly string[]).includes(value);
}
export type ByggetiltakSporsmaal = {
  id: string;
  label: string;
  type: "number" | "boolean";
  min?: number;
  max?: number;
  integer?: boolean;
};
export type ByggetiltakFelt = {
  id: string;
  label: string;
  hint?: string;
  type: "tall" | "valg";
  ukjentTillatt: boolean;
  min?: number;
  max?: number;
  heltall?: boolean;
};
type Metadata<T extends Byggetiltakstype> = {
  tiltakstype: T;
  tiltaksbeskrivelse: string;
  tiltakstypeBekreftet: true;
};
export type Byggetiltak =
  | (Metadata<"frittliggende"> & GarasjeTiltak)
  | (Metadata<"tilbygg"> & {
      bra: number | null; bya: number | null; avstandNabogrense: number | null;
      etasjer: number | null; endrerBruk: boolean | null; nyBoenhet: boolean | null;
      understottet: boolean | null; bebygdEiendom: boolean | null;
      overVannAvlop: boolean | null;
    })
  | (Metadata<"gjerde"> & {
      hoyde: number | null; motVeg: boolean | null;
      friSikt: boolean | null; aapenLett: boolean | null;
    })
  | (Metadata<"fasade"> & {
      likUtforming: boolean | null; endrerBaering: boolean | null;
      endrerBrannkrav: boolean | null; endrerUtseende: boolean | null;
    })
  | Metadata<"ukjent">;

type WithoutRequiredBebyggelse<T> = T extends { bebygdEiendom: boolean | null }
  ? Omit<T, "bebygdEiendom"> & { bebygdEiendom?: boolean | null } : T;
/** Typed requests may omit lookup evidence; validation supplies null before the server lookup. */
export type ByggetiltakInput = WithoutRequiredBebyggelse<Byggetiltak>;

const number = (id: string, label: string, min = 0, integer = false): ByggetiltakSporsmaal =>
  ({ id, label, type: "number", min, max: 100_000, ...(integer ? { integer } : {}) });
const choice = (id: string, label: string): ByggetiltakSporsmaal => ({ id, label, type: "boolean" });

export const BYGGETILTAK_KATALOG: readonly {
  id: Byggetiltakstype; navn: string; beskrivelse: string; sporsmaal: readonly ByggetiltakSporsmaal[];
}[] = [
  {
    id: "frittliggende", navn: "Frittliggende bygning",
    beskrivelse: "Garasje, bod eller annen frittliggende bygning. Nasjonale vilkår i SAK10 § 4-1 første ledd bokstav a.",
    sporsmaal: [
      number("bra", "Bruksareal (BRA), i m²", 0.01), number("bya", "Bebygd areal (BYA), i m²", 0.01),
      number("gesimshoyde", "Gesimshøyde, i meter", 0.01), number("monehoyde", "Mønehøyde, i meter", 0.01),
      number("etasjer", "Antall etasjer", 1, true),
      choice("frittliggende", "Er bygningen frittliggende?"),
      choice("beboelse", "Skal bygningen brukes til beboelse, med kjøkken, stue, soverom eller våtrom?"),
      choice("kjeller", "Skal bygningen ha kjeller?"),
      number("avstandNabogrense", "Avstand til nabogrensen, i meter"),
      number("avstandBygning", "Avstand til annen bygning på eiendommen, i meter"),
      choice("overVannAvlop", "Plasseres bygningen over vann- eller avløpsledninger?"),
    ],
  },
  {
    id: "tilbygg", navn: "Tilbygg",
    beskrivelse: "Utvidelse som er festet til en eksisterende bygning. SAK10 § 4-1 første ledd bokstav b.",
    sporsmaal: [
      number("bra", "Tilbyggets bruksareal (BRA), i m²"),
      number("bya", "Tilbyggets bebygde areal (BYA), i m²", 0.01),
      number("etasjer", "Antall etasjer eller plan tilbygget knytter seg til", 1, true),
      choice("understottet", "Er tilbygget understøttet, uten utkraging?"),
      choice("endrerBruk", "Endrer tilbygget bygningens godkjente bruk?"),
      choice("nyBoenhet", "Opprettes en ny selvstendig boenhet?"),
      number("avstandNabogrense", "Avstand fra tilbygget til nabogrensen, i meter"),
      choice("overVannAvlop", "Plasseres tilbygget over vann- eller avløpsledninger?"),
    ],
  },
  {
    id: "gjerde", navn: "Gjerde",
    beskrivelse: "Åpen, lett innhegning. Levegg, støyskjerm og mur må vurderes særskilt.",
    sporsmaal: [
      number("hoyde", "Gjerdets samlede høyde inkludert sokkel, i meter", 0.01),
      choice("motVeg", "Er gjerdet mot vei?"),
      choice("friSikt", "Er fri sikt mot vei, avkjørsel og kryss avklart og ivaretatt?"),
      choice("aapenLett", "Er dette en åpen, lett innhegning, ikke levegg, støyskjerm eller mur?"),
    ],
  },
  {
    id: "fasade", navn: "Fasade eller tak",
    beskrivelse: "Skille mellom vedlikehold, endret utseende og inngrep i bæring eller brannsikring. Kommunen avklarer tvil.",
    sporsmaal: [
      choice("likUtforming", "Beholdes materialer, farge og utforming som før?"),
      choice("endrerUtseende", "Endres bygningens utseende eller karakter?"),
      choice("endrerBaering", "Endres bærende konstruksjoner?"),
      choice("endrerBrannkrav", "Berøres brannskiller eller andre brannkrav?"),
    ],
  },
  {
    id: "ukjent", navn: "Annet eller uavklart tiltak",
    beskrivelse: "Beskriv tiltaket. Kommunens byggesaksveiledning må avklare riktig tiltakstype og regler.",
    sporsmaal: [],
  },
];

export const BYGGETILTAK_ALTERNATIVER: readonly { id: Byggetiltakstype; label: string }[] =
  BYGGETILTAK_KATALOG.map(entry => ({ id: entry.id, label: entry.navn }));

export function getByggetiltakSporsmaal(type: Byggetiltakstype): readonly ByggetiltakSporsmaal[] {
  return BYGGETILTAK_KATALOG.find(entry => entry.id === type)?.sporsmaal ?? [];
}

export function getByggetiltakFelter(type: Byggetiltakstype): ByggetiltakFelt[] {
  return getByggetiltakSporsmaal(type).map(field => {
    const ukjentTillatt = type !== "frittliggende" || field.type === "boolean"
      || ["avstandNabogrense", "avstandBygning"].includes(field.id);
    return {
      id: field.id, label: field.label, type: field.type === "number" ? "tall" : "valg",
      ukjentTillatt, min: field.min, max: field.max, heltall: field.integer,
      hint: field.type === "boolean" ? "Svar ja, nei eller «vet ikke»."
        : `${field.integer ? "Oppgi antall som et heltall." : "Oppgi målet i enheten som står ved feltet."}${ukjentTillatt ? " Du kan svare «vet ikke»." : ""}`,
    };
  });
}

/** A proposal only. Neither keyword matching nor a confirmation decides legality. */
export function classifyByggetiltak(tekst: string): { tiltakstype: Byggetiltakstype; begrunnelse: string } {
  const text = tekst.toLocaleLowerCase("nb-NO").replaceAll("æ", "ae").replaceAll("ø", "o").replaceAll("å", "a");
  if (/\b(ikke|ingen|uten|kanskje|eller)\b/.test(text)) {
    return { tiltakstype: "ukjent", begrunnelse: "Beskrivelsen inneholder et forbehold eller alternativer. Velg og bekreft tiltakstypen selv." };
  }
  const matches: Byggetiltakstype[] = [];
  if (/\b(tilbygg(?:et)?|pabygg|utvidelse|utvide)\b/.test(text)) matches.push("tilbygg");
  if (/\b((?:stakitt|flettverks|netting)?gjerde(?:t)?|innhegning)\b/.test(text)) matches.push("gjerde");
  if (/\b(fasade(?:n)?|fasadeendring|tak(?:et)?|takstein|takplater|taktekking|kledning|vinduer|vindu)\b/.test(text)) matches.push("fasade");
  if (/\b(garasje(?:n)?|dobbelgarasje|bod(?:en)?|uthus|carport|frittliggende)\b/.test(text)) matches.push("frittliggende");
  // A påbygg is not an understøttet tilbygg; fences, walls and screening differ too.
  if (/\b(pabygg|levegg|stoyskjerm|mur)\b/.test(text) || matches.length !== 1) {
    return { tiltakstype: "ukjent", begrunnelse: "Beskrivelsen gir ikke én entydig tiltakstype i denne veilederen. Velg selv eller spør kommunen." };
  }
  const tiltakstype = matches[0];
  return { tiltakstype, begrunnelse: `Beskrivelsen kan passe med «${BYGGETILTAK_KATALOG.find(entry => entry.id === tiltakstype)!.navn}». Bekreft eller endre forslaget før spørsmålene besvares.` };
}

export function classifyByggetiltakType(tekst: string): Byggetiltakstype | null {
  const proposal = classifyByggetiltak(tekst);
  return proposal.tiltakstype === "ukjent" ? null : proposal.tiltakstype;
}
