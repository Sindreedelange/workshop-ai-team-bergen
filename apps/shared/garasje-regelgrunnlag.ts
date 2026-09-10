export const GARASJE_NASJONALE_KRAV = {
  regelsett: "sak10-frittliggende-bygning",
  versjon: "2026-09-10",
  kilde: "https://www.dibk.no/regelverk/sak/2/4/4-1",
  virkeomraade: "Nasjonalt unntak for mindre frittliggende bygning på bebygd eiendom. Alle øvrige vilkår må også være oppfylt.",
  tallkrav: {
    bra: { navn: "Bruksareal", operator: "maks", verdi: 50, enhet: "m²" },
    bya: { navn: "Bebygd areal for den nye garasjen", operator: "maks", verdi: 50, enhet: "m²" },
    monehoyde: { navn: "Mønehøyde", operator: "maks", verdi: 4, enhet: "m" },
    gesimshoyde: { navn: "Gesimshøyde", operator: "maks", verdi: 3, enhet: "m" },
    etasjer: { navn: "Etasjer", operator: "lik", verdi: 1, enhet: "etasje" },
    avstandNabogrense: { navn: "Avstand til nabogrense", operator: "min", verdi: 1, enhet: "m" },
    avstandBygning: { navn: "Avstand til annen bygning på eiendommen", operator: "min", verdi: 1, enhet: "m" }
  },
  andreVilkaar: [
    "Frittliggende bygning på bebygd eiendom",
    "Ingen beboelse eller overnatting",
    "Ingen kjeller",
    "Ikke over vann- eller avløpsledninger",
    "Høyder måles fra ferdig planert terrengs gjennomsnittsnivå",
    "Gjeldende planbestemmelser og andre myndighetskrav må være oppfylt"
  ],
  uavklart: "Manglende opplysning er ukjent, aldri automatisk oppfylt.",
  modellrolle: "Forklar begreper og faste regler. Ikke beregn eller avgjør om den konkrete garasjen er tillatt."
} as const;
