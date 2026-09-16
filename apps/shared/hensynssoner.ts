/**
 * Hensynssonene i Bergens kommuneplan.
 *
 * En hensynssone er et område kommuneplanen legger et hensyn på, hjemlet i
 * plan- og bygningsloven § 11-8. Sonen forbyr ikke i seg selv et tiltak; den sier
 * at noe må tas hensyn til, og hva det er, står i planbestemmelsene. Derfor
 * navngir sandkassen sonen og avgjør ingenting på den - se sjekken
 * «hensynssoner» i apps/sandbox-backend/src/tiltakshjelpen.ts.
 *
 * Sonekodene er nasjonale (H220, H310 og så videre) og står i kartforskriften
 * med SOSI-kodeverket som følger den. Nummeret i `HENSYNSONENAVN` etter
 * understreken - H220_1, H390_2 - er kommunens løpenummer for det enkelte
 * området, ikke en del av kodeverket.
 *
 * Sonene hentes fra Bergens egne karttjenester ved oppslag. Det som fortsatt ikke
 * leses er planbestemmelsene, og det er de som sier hva hensynet innebærer.
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
    kode: 210, type: "stoy", navn: "Rød støysone",
    beskrivelse: "Området er beregnet å ha støy godt over grenseverdien i T-1442. Støyfølsom bebyggelse bør ikke settes opp her; en garasje er normalt ikke støyfølsom.",
  },
  {
    kode: 220, type: "stoy", navn: "Gul støysone",
    beskrivelse: "Området er beregnet å ha støy over grenseverdien i T-1442. Støyfølsom bebyggelse har egne krav her; en garasje er normalt ikke støyfølsom.",
  },
  {
    kode: 230, type: "stoy", navn: "Stille område",
    beskrivelse: "Området er avsatt som stille, altså lite påvirket av støy. Hensynet gjelder å bevare den roen, ikke å skjerme mot støy utenfra.",
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
    kode: 510, type: "angitthensyn", navn: "Hensyn landbruk",
    beskrivelse: "Området er avsatt av hensyn til sammenhengende landbruksarealer. Hva det betyr for et tiltak, står i planbestemmelsene.",
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

/**
 * Hvilken hensynstype et datasett bærer, eller `null` for arealformålet.
 *
 * Kartlaget sier hva slags hensyn det handler om før sonekoden er slått opp, og
 * det er det som gjør `soneHindrerFritak` brukbar på en kode kodeverket ikke
 * kjenner. Uten den måtte «holder dette tilbake et fritak» vært besvart to
 * steder, én gang per sonekode og én gang per datasett, uten at noe holdt de to
 * svarene i takt. Her er det én klassifisering og ett predikat.
 *
 * Tabellen er total over `Datasettid`, så et nytt datasett tvinger fram et svar.
 */
export const DATASETTHENSYN: Record<Datasettid, Hensynssonetype | null> = {
  stoy: "stoy",
  fare: "fare",
  friluftsliv: "angitthensyn",
  landskap: "angitthensyn",
  naturmiljoe: "angitthensyn",
  kulturmiljoe: "angitthensyn",
  landbruk: "angitthensyn",
  arealformaal: null,
};

/**
 * Datasettene plangrunnlaget er delt i.
 *
 * Id-ene er felles fordi de står på tråden. Hvilket kartlag hos kommunen hver av
 * dem er, står i `apps/shared/tiltakshjelpen-kommuner.ts` - hos den som allerede
 * svarer på hvilket lag som gjelder for hvilken kommune.
 *
 * `landbruk` kom med da sonene ble hentet live: kommunen publiserer laget, og
 * uttrekket hadde det ikke. Den live kilden navngir altså flere soner enn filene
 * gjorde, og det kan ikke endre et utfall - `soneHindrerFritak` svarer bare `true`
 * for en faresone.
 */
export const DATASETTIDER = [
  "stoy", "fare", "friluftsliv", "landskap", "naturmiljoe", "kulturmiljoe", "landbruk", "arealformaal"
] as const;
export type Datasettid = (typeof DATASETTIDER)[number];
