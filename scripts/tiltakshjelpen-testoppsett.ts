/**
 * Å bytte oppstrøm for tiltakssjekken, og glemme alt produksjonsveien husker.
 *
 * Tiltakssjekken har to prosesslange memoer: grunnlaget gjenbrukes i tretti
 * sekunder per eiendom, og lagmetadataen fra kommunens ArcGIS hentes én gang per
 * lag. En test som snur et feilflagg uten å glemme dem får det forrige svaret
 * tilbake og beviser ingenting - grønt, uten å ha prøvd det den skulle.
 *
 * Paringen bodde i tre testfiler, og de tre var allerede uenige om hvilke memoer
 * som fantes: to av dem glemte bare grunnlaget. Et fjerde memo ville blitt lagt
 * inn ett sted og glemt de andre, og den feilen viser seg som en grønn test.
 * Derfor én kilde, som importerer begge nullstillingene selv.
 *
 * Den ligger i `scripts/` og ikke i `apps/shared/`: ingen tjeneste bruker den,
 * bare testene. Det er samme grense som `scripts/geonorge-fikstur.ts` står på.
 */

import { nullstillLagmetadata } from "../apps/sandbox-backend/src/tiltakshjelpen-data.ts";
import { nullstillFerskeGrunnlag } from "../apps/sandbox-backend/src/tiltakshjelpen-oppslag.ts";

/** Glemmer alt produksjonsveien husker mellom to ellers like kall. */
export function glemOppslag(): void {
  nullstillFerskeGrunnlag();
  nullstillLagmetadata();
}

/** Endrer oppstrøm, og glemmer i samme slengen. Rekkefølgen er ikke valgfri. */
export function bytt(endre: () => void): void {
  endre();
  glemOppslag();
}
