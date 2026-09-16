import type { Datasettid } from "./hensynssoner.ts";

type TiltakshjelpenKartlag = { path: string; navn: string };

/**
 * Ett barnelag under kommunens hensynssonetjeneste.
 *
 * `id` er lagnummeret i ArcGIS-tjenesten, og `kodefelt` kolonnen sonekoden står i.
 * Kolonnenavnet varierer fra lag til lag fordi kommunen eksporterer ett lag per
 * hensynstype og kaller kodekolonnen opp etter laget. Det er kildens form, ikke
 * vår, og leseren må lese feltnavnet herfra i stedet for å gjette.
 */
export type TiltakshjelpenSonelag = { datasett: Datasettid; id: number; kodefelt: string };

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
   * Hensynssonene, som flater.
   *
   * `path` peker på tjenesten, og hvert barnelag spørres for seg. Gruppelagene
   * over dem - 14 for faresone, 21 for støysone - står med vilje ikke i listen:
   * ArcGIS svarer ikke på en spørring mot et gruppelag, så en oppføring der ville
   * feilet i kjøring i stedet for i gjennomlesning.
   *
   * Arealformål står ikke her heller. Det er det samme laget som `kpa`, og det er
   * en forbedring: punktoppslaget og flateoppslaget leste før to ulike kilder for
   * samme faktum, én live og én frossen, og kunne bli uenige.
   */
  hensynssoner: TiltakshjelpenKartlag & { lag: readonly TiltakshjelpenSonelag[] };
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
    hensynssoner: {
      path: "KPA2018/KPA2018_Hensynssoner_imagelayer/MapServer",
      navn: "Bergen KPA2018 hensynssoner",
      lag: [
        { datasett: "friluftsliv", id: 0, kodefelt: "KPANGITTHENSYN" },
        { datasett: "kulturmiljoe", id: 1, kodefelt: "KPANGITTHENSYN" },
        { datasett: "landbruk", id: 2, kodefelt: "KPANGITTHENSYN" },
        { datasett: "landskap", id: 3, kodefelt: "KPANGITTHENSYN" },
        { datasett: "naturmiljoe", id: 4, kodefelt: "KPANGITTHENSYN" },
        { datasett: "fare", id: 15, kodefelt: "KPFARE" },
        { datasett: "fare", id: 16, kodefelt: "KPFARE" },
        { datasett: "fare", id: 17, kodefelt: "KPFARE" },
        { datasett: "fare", id: 18, kodefelt: "KPFARE" },
        { datasett: "fare", id: 19, kodefelt: "KPFARE" },
        { datasett: "stoy", id: 22, kodefelt: "KPSTOY" },
        { datasett: "stoy", id: 23, kodefelt: "KPSTOY" },
        { datasett: "stoy", id: 24, kodefelt: "KPSTOY" },
      ],
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

export function getTiltakshjelpenKartlagUrl(kommune: TiltakshjelpenKommunekilder, lag: "kpa" | "reguleringsplan" | "bygninger" | "hensynssoner"): string {
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
