type GarasjeKartlag = { path: string; navn: string };

export type GarasjeKommunekilder = {
  kommunenummer: string;
  navn: string;
  kartBaseUrl: string;
  kpa: GarasjeKartlag & {
    planId: string;
    versjon: string;
    bestemmelserUrl: string;
    /** Henvisning til veiledning, ikke automatisk tillatelse eller utnyttelsesgrense. */
    lnfBestemmelse?: string;
  };
  reguleringsplan: GarasjeKartlag & { planportalUrl: string };
  bygninger: GarasjeKartlag;
  /**
   * Kommunens skjema for å melde inn et tiltak som ikke krever søknad.
   *
   * Plikten til å melde inn er kommunens egen, ikke en nasjonal regel, og skjemaet
   * er derfor et kommuneoppsett og ikke en konstant. En kommune uten oppføring her
   * kan ikke få utfallet `meldeplikt`: da vet vi ikke hvor innbyggeren skal melde.
   */
  meldeskjemaUrl?: string;
};

// Nasjonale adresse- og eiendomsoppslag er uavhengige av dette registeret.
// En kommune uten adapter skal aldri arve en annen kommunes kart eller regler.
export const GARASJE_KOMMUNER = {
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
  },
} as const satisfies Readonly<Record<string, GarasjeKommunekilder>>;

export function findGarasjeKommunekilder(kommunenummer: string): GarasjeKommunekilder | undefined {
  if (!Object.hasOwn(GARASJE_KOMMUNER, kommunenummer)) return undefined;
  return (GARASJE_KOMMUNER as Readonly<Record<string, GarasjeKommunekilder>>)[kommunenummer];
}

export function getGarasjeKartlagUrl(kommune: GarasjeKommunekilder, lag: "kpa" | "reguleringsplan" | "bygninger"): string {
  return new URL(kommune[lag].path, kommune.kartBaseUrl).href;
}

export function findGarasjeKommune(kommunenummer: string) {
  const kommune = findGarasjeKommunekilder(kommunenummer);
  if (!kommune) return undefined;
  return {
    kommunenummer: kommune.kommunenummer,
    navn: kommune.navn,
    planId: kommune.kpa.planId,
    versjon: kommune.kpa.versjon,
    planbestemmelserUrl: kommune.kpa.bestemmelserUrl,
    kpaArealformalUrl: getGarasjeKartlagUrl(kommune, "kpa"),
    reguleringsplanUrl: getGarasjeKartlagUrl(kommune, "reguleringsplan"),
    bygningerUrl: getGarasjeKartlagUrl(kommune, "bygninger"),
    ...(kommune.kpa.lnfBestemmelse ? { lnfBestemmelse: kommune.kpa.lnfBestemmelse } : {}),
  };
}
