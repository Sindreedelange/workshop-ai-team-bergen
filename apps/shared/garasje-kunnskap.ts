import { GARASJE_BEGREPER } from "./garasje-begreper.ts";
import { GARASJE_NASJONALE_KRAV } from "./garasje-regelgrunnlag.ts";
import { listGarasjeSonetyper } from "./arealsoner.ts";
import { GARASJE_UTFALL } from "./garasje.ts";
import { GARASJE_KOMMUNER, findGarasjeKommunekilder } from "./garasje-kommuner.ts";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Project only bounded, useful facts; raw maps and personal data never enter the model context. */
export function buildGarasjeKunnskapsgrunnlag(context: unknown = {}) {
  const input = record(context);
  const resultater = record(input.resultater);
  const vurderingsresultat = record(resultater["garasje-vurdering"]);
  const grunnlag = record(vurderingsresultat.grunnlag ?? resultater.garasje);
  const areal = record(grunnlag.arealberegning);
  const vurdering = record(vurderingsresultat.vurdering);
  const adresse = record(grunnlag.adresse);
  const kommunenummer = typeof adresse.kommunenummer === "string" ? adresse.kommunenummer : null;
  const kommune = kommunenummer ? findGarasjeKommunekilder(kommunenummer) : undefined;
  const value = (input: unknown) => typeof input === "number" && Number.isFinite(input) && input >= 0 ? input : null;
  return {
    begreper: GARASJE_BEGREPER,
    nasjonaleKrav: GARASJE_NASJONALE_KRAV,
    kommunenummer,
    kommunaleOppsett: Object.values(GARASJE_KOMMUNER).map(kommune => ({
      kommunenummer: kommune.kommunenummer, navn: kommune.navn,
      planId: kommune.kpa.planId, versjon: kommune.kpa.versjon,
      bestemmelserUrl: kommune.kpa.bestemmelserUrl
    })),
    sonetyper: listGarasjeSonetyper(),
    kildeTilPlanbestemmelser: kommune?.kpa.bestemmelserUrl ?? null,
    planbestemmelserKontrollert: false,
    soner: Array.isArray(grunnlag.arealformaal) ? grunnlag.arealformaal.slice(0, 8).map(item => {
      const sone = record(item);
      return {
        kode: value(sone.kode), arealstatus: value(sone.arealstatus),
        navn: typeof sone.sonenavn === "string" ? sone.sonenavn.slice(0, 100) : null,
        planId: typeof sone.planId === "string" && /^\d{1,30}$/.test(sone.planId) ? sone.planId : null
      };
    }) : [],
    arealFraKart: {
      tomtearealM2: value(areal.tomtearealM2),
      kartlagtBebygdArealM2: value(areal.kartlagtBebygdArealM2),
      kartlagtAndelProsent: value(areal.kartlagtAndelProsent),
      juridiskUtnyttelsesgrad: "uavklart",
      tillattUtnyttelse: "uavklart",
      forklaring: "Kartlagt fotavtrykk er ikke juridisk BYA eller BRA. Parkering, overbygg, måleregler og gjeldende planbestemmelser må avklares."
    },
    regelutfall: (GARASJE_UTFALL as readonly string[]).includes(String(vurdering.utfall))
      ? String(vurdering.utfall) : "ikke_vurdert",
    avgrensning: "Forklar bare grunnlaget. Ingen søknad er sendt. Sonenavn alene avgjør ikke om det er lov å bygge, og en PDF-lenke er ikke en gjennomgått bestemmelse."
  };
}
