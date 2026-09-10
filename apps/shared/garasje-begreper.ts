export type GarasjeBegrep = {
  id: string;
  navn: string;
  forklaring: string;
  kilde: string;
};

const hoydekilde = "https://www.dibk.no/regelverk/byggteknisk-forskrift-tek17/6/6-2";

export const GARASJE_BEGREPER: readonly GarasjeBegrep[] = [
  {
    id: "gesimshoyde",
    navn: "Gesimshøyde",
    forklaring: "Gesimsen er normalt der ytterveggen møter takets overside, ikke nødvendigvis takrennen. Høyden måles fra gjennomsnittet av ferdig planert terreng rundt bygningen. Takoppbygg og spesielle takformer kan endre målepunktet.",
    kilde: hoydekilde
  },
  {
    id: "monehoyde",
    navn: "Mønehøyde",
    forklaring: "Mønet er toppen der skrå takflater møtes. Høyden måles fra gjennomsnittet av ferdig planert terreng rundt bygningen. Flate tak har ikke et vanlig møne; avklar målepunktet for takformen i stedet for å sette høyden til null.",
    kilde: hoydekilde
  },
  {
    id: "bra",
    navn: "Bruksareal (BRA)",
    forklaring: "BRA er arealet innenfor ytterveggene, også plassen innvendige vegger tar. For en bygning summeres alle måleverdige plan. Åpent overbygd areal kan også telle med. BRA er derfor ikke bare den ledige gulvplassen til bilen.",
    kilde: "https://www.dibk.no/regelverk/byggteknisk-forskrift-tek17/5/5-4"
  },
  {
    id: "bya",
    navn: "Bebygd areal (BYA)",
    forklaring: "BYA beskriver bygningens fotavtrykk på bakken, målt fra utsiden av ytterveggene. Overbygde arealer og enkelte utstikkende bygningsdeler kan også telle med. I garasjeskjemaet spør vi om garasjen, ikke samlet bebygd areal på hele eiendommen.",
    kilde: "https://www.dibk.no/regelverk/byggteknisk-forskrift-tek17/5/5-2"
  },
  {
    id: "terreng",
    navn: "Ferdig planert terreng",
    forklaring: "Dette er bakken slik den skal være etter terrengarbeidene. Utgangspunktet for byggehøyder er gjennomsnittsnivået rundt bygningen, ikke bare det høyeste eller laveste hjørnet. Planbestemmelser kan angi et annet utgangspunkt.",
    kilde: hoydekilde
  },
  {
    id: "takform",
    navn: "Flatt tak og andre takformer",
    forklaring: "Et flatt tak har ikke et vanlig møne. Takkanter, takoppbygg og takformen kan påvirke hvor høyden skal måles. Se figurene hos DIBK, og be en fagperson eller kommunen avklare målepunktet. Skjemaet beregner ikke slike målepunkter.",
    kilde: hoydekilde
  }
];

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "")
    .replace(/ø/g, "o").replace(/æ/g, "ae");
}

export function isGarasjeKontekst(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const context = value as { tjeneste?: unknown; prosessId?: unknown; prosess?: { id?: unknown; navn?: unknown }; steg?: { visning?: unknown } };
  return context.prosessId === "garasjesjekk" || context.prosess?.id === "garasjesjekk" || context.steg?.visning === "garasje"
    || [context.tjeneste, context.prosess?.navn].some(name =>
      typeof name === "string" && ["garasjesjekk", "garasjesjekken"].includes(normalize(name).trim()));
}

export function findGarasjeBegreper(text: string): readonly GarasjeBegrep[] {
  const folded = normalize(text);
  const ids = new Set<string>();
  if (/\bgesims/.test(folded)) ids.add("gesimshoyde");
  if (/\bmone/.test(folded)) ids.add("monehoyde");
  if (/\bbra\b|\bbruksareal/.test(folded)) ids.add("bra");
  if (/\bbya\b|\bbebygd areal/.test(folded)) ids.add("bya");
  if (/\bterreng|\bbakken\b|\bskra tomt/.test(folded)) ids.add("terreng");
  if (/\bflatt?\s*tak|\bpulttak|\btakform|\btakoppbygg|\bparapet/.test(folded)) ids.add("takform");
  if (!ids.size && /\bhoyde|\btak\b|\btaket\b/.test(folded)) {
    ids.add("gesimshoyde");
    ids.add("monehoyde");
  }
  return GARASJE_BEGREPER.filter(begrep => ids.has(begrep.id));
}

export function buildGarasjeBegrepssvar(text: string, fieldId?: string): string | null {
  const matches = findGarasjeBegreper(text);
  const begreper = (matches.length ? matches : GARASJE_BEGREPER.filter(begrep => begrep.id === fieldId)).slice(0, 2);
  if (!begreper.length) return null;
  return [
    ...begreper.map(begrep => `${begrep.navn}: ${begrep.forklaring}`),
    ...new Set(begreper.map(begrep => `Kilde: ${begrep.kilde}`))
  ].join("\n\n");
}
