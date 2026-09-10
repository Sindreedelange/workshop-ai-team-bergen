import { GARASJE_KOMMUNER, getGarasjeKartlagUrl } from "./garasje-kommuner.ts";

export type Arealsonetype =
  | "sentrumskjerne"
  | "byfortettingssone"
  | "ytre_fortettingssone"
  | "ovrig_byggesone"
  | "lnf"
  | "gronnstruktur"
  | "ukjent";

export type Arealsonekilde = {
  kommunenummer: string;
  planId: string;
  versjon: string;
  url: string;
  metadataUrl: string;
  kontrollert: string;
};

export type Arealsone = {
  sonetype: Exclude<Arealsonetype, "ukjent">;
  navn: string;
  KPAREALFORMAL: number;
  AREALST: number;
  kilde: Arealsonekilde;
  /** Bare en kontrollert planbestemmelse kan fylle dette, aldri sonenavnet. */
  tillattUtnyttelse?: {
    verdi: number;
    enhet: string;
    bestemmelse: string;
    kilde: string;
  };
};

export const KPA2018_SONEKILDE: Arealsonekilde = {
  kommunenummer: "4601",
  planId: "65270000",
  versjon: "KPA2018",
  url: getGarasjeKartlagUrl(GARASJE_KOMMUNER["4601"], "kpa"),
  metadataUrl: `${getGarasjeKartlagUrl(GARASJE_KOMMUNER["4601"], "kpa")}?f=json`,
  kontrollert: "2026-09-10",
};

// Kilden skiller sonene med begge feltene, ikke KPAREALFORMAL alene.
// Radene gjengir den kontrollerte tegnforklaringen. Ingen utnyttelsesgrenser
// er fastsatt her; gjeldende bestemmelser må leses for det konkrete tiltaket.
export const AREALSONER: readonly Arealsone[] = [
  { sonetype: "sentrumskjerne", navn: "Sentrumskjerne", KPAREALFORMAL: 1130, AREALST: 2, kilde: KPA2018_SONEKILDE },
  { sonetype: "byfortettingssone", navn: "Byfortettingssone", KPAREALFORMAL: 1130, AREALST: 1, kilde: KPA2018_SONEKILDE },
  { sonetype: "ytre_fortettingssone", navn: "Ytre fortettingssone", KPAREALFORMAL: 1001, AREALST: 2, kilde: KPA2018_SONEKILDE },
  { sonetype: "ovrig_byggesone", navn: "Øvrig byggesone", KPAREALFORMAL: 1001, AREALST: 1, kilde: KPA2018_SONEKILDE },
  { sonetype: "lnf", navn: "LNF", KPAREALFORMAL: 5100, AREALST: 1, kilde: KPA2018_SONEKILDE },
  { sonetype: "gronnstruktur", navn: "Grønnstruktur", KPAREALFORMAL: 3001, AREALST: 1, kilde: KPA2018_SONEKILDE },
  { sonetype: "gronnstruktur", navn: "Grønnstruktur, framtidig", KPAREALFORMAL: 3001, AREALST: 2, kilde: KPA2018_SONEKILDE },
];

export function classifyArealsone(input: {
  kode: number;
  arealstatus?: number;
  sonenavn?: string;
  planId: string;
  kommunenummer: string;
  versjon: string;
  kildeUrl: string;
}): Arealsonetype {
  const matches = AREALSONER.filter(sone =>
    sone.KPAREALFORMAL === input.kode && sone.AREALST === input.arealstatus
    && sone.navn === input.sonenavn
    && sone.kilde.planId === input.planId && sone.kilde.kommunenummer === input.kommunenummer
    && sone.kilde.versjon === input.versjon && sone.kilde.url === input.kildeUrl);
  // Changed source labels or a different plan require re-verification.
  return matches.length === 1 ? matches[0]!.sonetype : "ukjent";
}

export function listGarasjeSonetyper() {
  return AREALSONER.map(sone => {
    const navnerom = `no:${sone.kilde.kommunenummer}:${sone.kilde.planId}:${sone.kilde.versjon}`;
    return {
      ...sone,
      id: `${navnerom}:${sone.KPAREALFORMAL}:${sone.AREALST}`,
      navnerom,
      kilde: { ...sone.kilde },
    };
  });
}
