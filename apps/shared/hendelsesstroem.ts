/**
 * Formen på en hendelsesstrøm, delt av den som skriver og den som leser.
 *
 * `text/event-stream` skrives av `apps/shared/http.ts` og leses av
 * `apps/demo-gui/src/client/tiltakshjelpen.ts`. To ender av ett format, og de
 * sto beskrevet hvert sitt sted: skilletegnet, feltnavnene og de tre
 * hendelsesnavnene. En server som la til en ekstra `data:`-linje ville mistet
 * halen i nettleseren uten at noe sa fra, og et omdøpt hendelsesnavn ville
 * feilet i kjøring med en tom fremdriftsliste som eneste spor.
 *
 * Modulen er fri for Node-typer med vilje, slik at klientkoden kan importere den.
 */

/** Blank linje mellom to hendelser. */
export const HENDELSESSKILLE = "\n\n";

/** Hendelsene tiltakssjekkens grunnlagsstrøm sender. */
export const HENDELSE = {
  /** Én kilde, ved oppstart og igjen når den har svart. */
  kilde: "kilde",
  /** Hele grunnlaget, til slutt. */
  grunnlag: "grunnlag",
  /** Oppslaget kunne ikke fullføres. Strømmen lukkes etter denne. */
  feil: "feil",
} as const;

/** Én hendelse, ferdig formatert. Kroppen er alltid én linje. */
export function formaterHendelse(hendelse: string, data: unknown): string {
  return `event: ${hendelse}\ndata: ${JSON.stringify(data)}${HENDELSESSKILLE}`;
}

/** Navn og kropp fra én hendelse, eller null hvis blokken ikke er en. */
export function lesHendelse(blokk: string): { navn: string; data: string } | null {
  const navn = /^event: (.*)$/m.exec(blokk)?.[1];
  const start = blokk.indexOf("data: ");
  if (!navn || start === -1) return null;
  return { navn, data: blokk.slice(start + "data: ".length) };
}
