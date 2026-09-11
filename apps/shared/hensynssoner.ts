/**
 * Hensynssonene i Bergens kommuneplan, og hvilken fil hver av dem ligger i.
 *
 * En hensynssone er et område kommuneplanen legger et hensyn på, hjemlet i
 * plan- og bygningsloven § 11-8. Sonen forbyr ikke i seg selv et tiltak; den sier
 * at noe må tas hensyn til, og hva det er, står i planbestemmelsene. Derfor
 * navngir sandkassen sonen og avgjør ingenting på den - se sjekken
 * «hensynssoner» i apps/sandbox-backend/src/garasje.ts.
 *
 * Sonekodene er nasjonale (H220, H310 og så videre) og står i kartforskriften
 * med SOSI-kodeverket som følger den. Nummeret i `HENSYNSONENAVN` etter
 * understreken - H220_1, H390_2 - er kommunens løpenummer for det enkelte
 * området, ikke en del av kodeverket.
 *
 * Uttrekket er KPA2018 og er frosset. Kilden som fortsatt gjelder er
 * planbestemmelsene, ikke denne filen.
 */

/** Hva slags hensyn sonen bærer. Gruppen sonekoden hører til, ikke sonen selv. */
export type Hensynssonetype = "stoy" | "fare" | "angitthensyn";

export type Hensynssonekode = {
  /** Den nasjonale sonekoden, uten H-en og uten kommunens løpenummer. */
  kode: number;
  type: Hensynssonetype;
  /** Klarspråk, det innbyggeren får se. Ikke kodeverkets egen ordlyd. */
  navn: string;
  /** Hva sonen betyr for en som vil bygge. Én setning, uten å konkludere. */
  beskrivelse: string;
};

export const HENSYNSSONER: readonly Hensynssonekode[] = [
  {
    kode: 220, type: "stoy", navn: "Gul støysone",
    beskrivelse: "Området er beregnet å ha støy over grenseverdien i T-1442. Støyfølsom bebyggelse har egne krav her; en garasje er normalt ikke støyfølsom.",
  },
  {
    kode: 310, type: "fare", navn: "Faresone ras og skred",
    beskrivelse: "Området er avmerket for ras- eller skredfare. Sikkerhetskravene i byggteknisk forskrift kapittel 7 gjelder, og kommunen kan kreve dokumentasjon.",
  },
  {
    kode: 320, type: "fare", navn: "Faresone flom",
    beskrivelse: "Området er avmerket for flomfare. Sikkerhetskravene i byggteknisk forskrift kapittel 7 gjelder, og kommunen kan kreve dokumentasjon.",
  },
  {
    kode: 350, type: "fare", navn: "Faresone brann og eksplosjon",
    beskrivelse: "Området er avmerket for brann- eller eksplosjonsfare, typisk nær anlegg eller ledninger med slik risiko.",
  },
  {
    kode: 390, type: "fare", navn: "Faresone annen fare",
    beskrivelse: "Området er avmerket for en annen fare enn ras, flom, brann eller eksplosjon. Hva faren er, står i planbestemmelsene.",
  },
  {
    kode: 530, type: "angitthensyn", navn: "Hensyn friluftsliv",
    beskrivelse: "Området er avsatt av hensyn til friluftslivet. I Bergen er byfjellsgrensene lagt hit.",
  },
  {
    kode: 550, type: "angitthensyn", navn: "Hensyn landskap",
    beskrivelse: "Området er avsatt av hensyn til landskapsbildet, og tiltak kan bli vurdert etter hvordan de virker i landskapet.",
  },
  {
    kode: 560, type: "angitthensyn", navn: "Hensyn naturmiljø",
    beskrivelse: "Området er avsatt av hensyn til naturverdier. Hvilke verdier det gjelder, står i planbestemmelsene.",
  },
  {
    kode: 570, type: "angitthensyn", navn: "Hensyn kulturmiljø",
    beskrivelse: "Området er avsatt av hensyn til kulturmiljø eller kulturminner. Tiltak kan utløse uttalelse fra kulturminnemyndigheten.",
  },
];

export function findHensynssone(kode: number): Hensynssonekode | undefined {
  return HENSYNSSONER.find(sone => sone.kode === kode);
}

/**
 * Om sonetypen er av det slaget som holder tilbake et fritak fra søknadsplikt.
 *
 * En hensynssone avgjør ikke om et tiltak er tillatt - det står i
 * planbestemmelsene, som sandkassen ikke leser. Men et fritak er en påstand om at
 * alt som gjelder eiendommen er kontrollert, og for en faresone er det ikke sant:
 * sikkerhetskravene i byggteknisk forskrift kapittel 7 gjelder, og kommunen kan
 * kreve dokumentasjon. En støysone eller et angitt hensyn stopper ikke fritaket -
 * de navngis i svaret i stedet, slik en garasje i gul støysone skal.
 *
 * Regelen som bruker dette bor i `sandbox-backend`; klassifiseringen bor her, hos
 * kodeverket, slik at en ny sonetype tvinger den som legger den inn til å svare på
 * spørsmålet i stedet for å arve et nei fra en strengsammenligning et lag unna.
 */
export function soneHindrerFritak(type: Hensynssonetype): boolean {
  return type === "fare";
}

export const KPA2018_PLANID = "65270000";
export const KPA2018_KOMMUNENUMMER = "4601";

/**
 * Datasettene uttrekket er delt i.
 *
 * Id-ene er felles fordi de står på tråden og i spesifikasjonens enum. Hvilken
 * fil og hvilken kolonne hver av dem har, er plan-mockens egen kunnskap om sine
 * seedfiler og står i `apps/plan-mock/src/datasett.ts` - på samme måte som
 * teigfilens form står i matrikkel-mock og ikke her.
 */
export const DATASETTIDER = [
  "stoy", "fare", "friluftsliv", "landskap", "naturmiljoe", "kulturmiljoe", "arealformaal"
] as const;
export type Datasettid = (typeof DATASETTIDER)[number];

/**
 * Taket på hvor stort et kartutsnitt plan-mock svarer på, i meter langs hver side.
 *
 * Større enn naboteigrutens 500 fordi garasjekartet strekker teigen med ti meters
 * marg til 4:3, og 492 av Bergens 21 258 teiger blir da over 500 meter brede.
 * Med 500 svarte ruten 400 for dem, og innbyggeren fikk «hensynssonene kunne ikke
 * hentes» der eiendommen var stor - altså i LNF og byfjellene, der sonene er.
 * Taket finnes fortsatt: det er dette og `PLANSONE_MAX_TREFF` som gjør at en åpen
 * rute ikke kan bes om hele kommunen.
 */
export const PLANSONE_MAX_SIDE_METER = 3000;

/**
 * Formen på tråden fra plan-mock.
 *
 * Geometrien er **klippet til kartutsnittet kallet ba om**, og det er ikke en
 * pyntesak: den største enkeltdelen i støysonefilen har 106 860 punkter og LNF-
 * flaten 86 027. Uklippet ville ett kartoppslag lastet ned flere megabyte og
 * tegnet en flate som dekker halve Bergen inn i et utsnitt på 240 × 180 meter.
 * Klippingen endrer ingen konklusjon om eiendommen, fordi utsnittet alltid er
 * bygget rundt teigen med margin, men den gjør at ringene har kanter langs
 * utsnittet som ikke er sonegrenser. Ingen avstand skal måles mot dem.
 */
export type PlansoneFeature = {
  type: "Feature";
  /** Uttrekkets OBJECTID. Unik i sitt datasett, ikke på tvers av dem. */
  id: number;
  geometry: { type: "Polygon"; coordinates: number[][][] };
  properties: {
    datasett: Datasettid;
    sonekode: number;
    /** HENSYNSONENAVN, for eksempel «H220_1». Arealformål har ingen. */
    sonenavn: string | null;
    /** AREALST. Bare arealformål har den. */
    arealstatus: number | null;
    beskrivelse: string | null;
    planId: string;
    kommunenummer: string;
  };
};

export type PlansoneSvar = {
  kommunenummer: string;
  kildestatus: "tilgjengelig" | "ikke_dekket";
  kilde: {
    navn: string;
    planId: string | null;
    versjon: string | null;
    filer: string[];
    /** Uttrekksåret i filnavnet, ikke en måledato. */
    uttrekksaar: number | null;
    koordinatsystem: "EPSG:4326";
    syntetisk: false;
  };
  type: "FeatureCollection";
  features: PlansoneFeature[];
  /** Klippet til utsnittet det ble spurt om. Se kommentaren over PlansoneFeature. */
  klippetTilUtsnitt: true;
};

/**
 * Taket på antall deler i ett svar.
 *
 * Høyere enn NABOTEIG_MAX_TREFF fordi en sone kan være oppstykket i mange små
 * deler i det samme utsnittet, mens en teig er én eiendom.
 */
export const PLANSONE_MAX_TREFF = 400;
