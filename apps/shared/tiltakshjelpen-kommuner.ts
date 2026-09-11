type TiltakshjelpenKartlag = { path: string; navn: string };

export type TiltakshjelpenKommunekilder = {
  kommunenummer: string;
  navn: string;
  kartBaseUrl: string;
  kpa: TiltakshjelpenKartlag & {
    planId: string;
    versjon: string;
    bestemmelserUrl: string;
    /** Henvisning til veiledning, ikke automatisk tillatelse eller utnyttelsesgrense. */
    lnfBestemmelse?: string;
  };
  reguleringsplan: TiltakshjelpenKartlag & { planportalUrl: string };
  bygninger: TiltakshjelpenKartlag;
  /**
   * Kommunens skjema for å melde inn et tiltak som ikke krever søknad.
   *
   * Plikten til å melde inn er kommunens egen, ikke en nasjonal regel, og skjemaet
   * er derfor et kommuneoppsett og ikke en konstant. En kommune uten oppføring her
   * kan ikke få utfallet `meldeplikt`: da vet vi ikke hvor innbyggeren skal melde.
   */
  meldeskjemaUrl?: string;
  /**
   * Kontaktinformasjon som vises når Tiltakshjelpen ikke kan svare ja eller nei.
   * Den er kommunespesifikk, slik at en kommune uten oppsett ikke arver Bergens tilbud.
   */
  uavklartVeiledning?: {
    tekst: string;
    lenketekst: string;
    url: string;
  };
};

// Nasjonale adresse- og eiendomsoppslag er uavhengige av dette registeret.
// En kommune uten adapter skal aldri arve en annen kommunes kart eller regler.
export const TILTAKSHJELPEN_KOMMUNER = {
  "4601": {
    kommunenummer: "4601",
    navn: "Bergen",
    kartBaseUrl: "https://kart.bergen.kommune.no/arcgis/rest/services/",
    kpa: {
      path: "KPA2018/KPA_2018_Arealformål/MapServer/0",
      navn: "Bergen KPA2018 arealformål",
      planId: "65270000",
      versjon: "KPA2018",
      bestemmelserUrl: "https://api.arealplaner.no/api/kunder/bergen4601/dokumenter/1487/download/b65270000.pdf",
      lnfBestemmelse: "§ 31.3",
    },
    reguleringsplan: {
      path: "Plan/Reguleringsplaner_på_grunnen/MapServer/44",
      navn: "Bergen reguleringsplanområder på grunnen",
      planportalUrl: "https://www.arealplaner.no/bergen4601/gi",
    },
    bygninger: {
      path: "Basis_kartdata/Bygning_Flate/MapServer/0",
      navn: "Bergen bygningsflater",
    },
    meldeskjemaUrl: "https://www.bergen.kommune.no/innbyggerhjelpen/planer-bygg-og-eiendom/bygging/byggesak/bygge-uten-byggesoknad#3",
    uavklartVeiledning: {
      tekst: "Jeg anbefaler deg å kontakte en av våre veiledere for mer veiledning. Du kan bestille 15 minutters veiledning her:",
      lenketekst: "Detaljer - Bergen kommune",
      url: "https://billett.bergen.kommune.no/Detaljer/EVENT/L0EJCc_QgK0aPZxOdubFjw$$/O2tBqPIXaEx-O3OkdCqCRYGttGB2VrtIiaTf-LlsFT1K6ZQMM-MmWG02wTX6lT-gXRXuePSO2tG6gmuzmlyhIQ$$?unpublished=CEyPlOoPzhvD5goXu5JRlg$$",
    },
  },
} as const satisfies Readonly<Record<string, TiltakshjelpenKommunekilder>>;

export function findTiltakshjelpenKommunekilder(kommunenummer: string): TiltakshjelpenKommunekilder | undefined {
  if (!Object.hasOwn(TILTAKSHJELPEN_KOMMUNER, kommunenummer)) return undefined;
  return (TILTAKSHJELPEN_KOMMUNER as Readonly<Record<string, TiltakshjelpenKommunekilder>>)[kommunenummer];
}

export function getTiltakshjelpenKartlagUrl(kommune: TiltakshjelpenKommunekilder, lag: "kpa" | "reguleringsplan" | "bygninger"): string {
  return new URL(kommune[lag].path, kommune.kartBaseUrl).href;
}

export function findTiltakshjelpenKommune(kommunenummer: string) {
  const kommune = findTiltakshjelpenKommunekilder(kommunenummer);
  if (!kommune) return undefined;
  return {
    kommunenummer: kommune.kommunenummer,
    navn: kommune.navn,
    planId: kommune.kpa.planId,
    versjon: kommune.kpa.versjon,
    planbestemmelserUrl: kommune.kpa.bestemmelserUrl,
    kpaArealformalUrl: getTiltakshjelpenKartlagUrl(kommune, "kpa"),
    reguleringsplanUrl: getTiltakshjelpenKartlagUrl(kommune, "reguleringsplan"),
    bygningerUrl: getTiltakshjelpenKartlagUrl(kommune, "bygninger"),
    ...(kommune.kpa.lnfBestemmelse ? { lnfBestemmelse: kommune.kpa.lnfBestemmelse } : {}),
  };
}
