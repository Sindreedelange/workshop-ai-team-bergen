import { GARASJE_UTFALL, GARASJE_UTFALL_FRITAR, type GarasjeUtfall } from "../../shared/garasje.ts";

/**
 * Rådet på slutten av garasjesjekken: modellen leser hele grunnlaget, måler det mot
 * plangrunnlaget og sier hva som må avklares og hvorfor.
 *
 * Dette er den ene oppgaven i sandkassen som er tung nok til å være verdt en
 * reasoning-modell. Målt mot Litle Milde-casen var det bare reasoning-svaret som
 * rakk å rekkefølge tiltakene og fange servitutter; de øvrige oppgavene ble like
 * gode eller dårligere av tenkingen.
 *
 * Modulen ligger her og ikke i `server.ts` av samme grunn som
 * `sporsmaalsperrer.ts` gjør: `server.ts` kaller `server.listen` på toppnivå og kan
 * ikke importeres av en test. Den har ingen avhengigheter utover typene, så
 * `pnpm test:garasje-raad` kjører uten modell og uten tjenester.
 *
 * **Rådet er et tillegg til den deterministiske vurderingen, ikke en erstatning.**
 * `docs/garasjesjekk.md` sier at selve vurderingen alltid bruker faste regler, og
 * `evals/ai-policy.json` sier at modellen formulerer og ikke avgjør. Derfor er
 * grensen mot et mildere utfall en kodeklemme i `validateGarasjeRaad`, ikke en
 * setning i prompten: en prompt kan modellen overse.
 */

export type GarasjeRaad = {
  antattUtfall: GarasjeUtfall;
  raad: string;
  maaAvklares: string[];
  /**
   * Hvor mange av de første punktene i `maaAvklares` som kommer fra reglene. Lista
   * er slått sammen, så en klient som bare viser den mister ingenting - men uten
   * dette tallet kan den ikke skille reglenes forhold fra modellens tillegg, og
   * modellens omformulering av et regelpunkt ser da ut som et duplikat.
   */
  fraRegler: number;
  begrunnelse: string;
  /** Satt når klemmen nedenfor overstyrte modellens utfall. */
  overstyrt?: string;
};

function tekst(verdi: unknown, maksLengde: number): string {
  return typeof verdi === "string" ? verdi.trim().slice(0, maksLengde) : "";
}

function punktliste(verdi: unknown): string[] {
  if (!Array.isArray(verdi)) return [];
  return verdi.map(punkt => tekst(punkt, 300)).filter(Boolean);
}

/** Et utfall fra en ukontrollert kilde, eller null. Kalleren velger reserven. */
function tilUtfall(verdi: unknown): GarasjeUtfall | null {
  return GARASJE_UTFALL.includes(verdi as GarasjeUtfall) ? verdi as GarasjeUtfall : null;
}

export function validateGarasjeRaad(svar: unknown, vurdering: unknown): GarasjeRaad | null {
  if (!svar || typeof svar !== "object" || Array.isArray(svar)) return null;
  const felt = svar as Record<string, unknown>;
  const raad = tekst(felt.raad, 1200);
  if (!raad) return null;

  const regel = record(vurdering);
  const regelutfall = tilUtfall(regel.utfall) ?? "maa_avklares";
  const oensket = tilUtfall(felt.antattUtfall) ?? regelutfall;

  // Klemmen: bare reglene kan si at noe ikke er søknadspliktig. Et strengere råd enn
  // regelen er trygt - ofte riktig, når planbestemmelsene ikke er lest. Et mildere
  // råd er det som ikke er trygt, og det er dette som stopper det.
  const groent = oensket === GARASJE_UTFALL_FRITAR && regelutfall !== GARASJE_UTFALL_FRITAR;
  const antattUtfall = groent ? regelutfall : oensket;

  // Reglenes uavklarte forhold står alltid i lista, uansett hva modellen svarte.
  // En modell som glemmer dem kan da ikke skjule dem.
  const fraRegel = punktliste(regel.uavklarteForhold);
  const fraModell = punktliste(felt.maaAvklares);
  const maaAvklares = [...fraRegel, ...fraModell.filter(punkt => !fraRegel.includes(punkt))].slice(0, 12);

  return {
    antattUtfall,
    raad,
    maaAvklares,
    fraRegler: Math.min(fraRegel.length, maaAvklares.length),
    begrunnelse: tekst(felt.begrunnelse, 600),
    ...(groent
      ? { overstyrt: `Modellen foreslo «${GARASJE_UTFALL_FRITAR}», men den regelbaserte vurderingen ga «${regelutfall}». Rådet kan ikke gjøre utfallet mildere enn reglene.` }
      : {})
  };
}

function record(verdi: unknown): Record<string, unknown> {
  return verdi !== null && typeof verdi === "object" && !Array.isArray(verdi) ? verdi as Record<string, unknown> : {};
}

/**
 * Prompten får kunnskapsgrunnlaget og vurderingen, aldri rå kartgeometri eller
 * persondata: `buildGarasjeKunnskapsgrunnlag` har alt projisert ned på forhånd, og
 * det er den projeksjonen kallstedet skal sende hit.
 */
export function buildGarasjeRaadPrompt(kunnskap: unknown, vurdering: unknown): string {
  const regel = record(vurdering);
  return [
    "Du er en byggesaksveileder i en kommunal demosandkasse. Du gir råd, ikke vedtak.",
    "Vurder hele grunnlaget under mot de kommunale planforholdene, og si hva som må avklares og hvorfor.",
    "",
    `Den regelbaserte vurderingen har allerede avgjort utfallet: «${String(regel.utfall ?? "ikke_vurdert")}». Du skal ikke overstyre det.`,
    "Bare reglene kan si at noe ikke er søknadspliktig. Du kan si at mer må avklares.",
    "En uavklart, ukontrollert eller mislykket kilde er aldri fravær av begrensninger.",
    "Et sonenavn alene avgjør ikke om det er lov å bygge, og en lenke til bestemmelsene er ikke en gjennomgått bestemmelse.",
    "Kartlagt fotavtrykk er ikke juridisk BYA eller BRA. Oppgi ingen utnyttelsesgrense, sats eller frist som ikke står i grunnlaget.",
    "Ingen søknad er sendt, og ingenting du skriver er et kommunalt vedtak.",
    "",
    "Svar med kun gyldig JSON og ingen tekst utenfor JSON-en:",
    '{"antattUtfall":"<ikke_soknadspliktig|soknadspliktig|maa_avklares>","raad":"<to til fire setninger på bokmål>","maaAvklares":["<konkret punkt>"],"begrunnelse":"<kort>"}',
    "",
    `Regelbasert vurdering: ${JSON.stringify(vurdering ?? {})}`,
    `Kunnskapsgrunnlag: ${JSON.stringify(kunnskap ?? {})}`
  ].join("\n");
}
