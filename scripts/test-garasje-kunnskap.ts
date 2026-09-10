import assert from "node:assert/strict";
import { buildGarasjeKunnskapsgrunnlag } from "../apps/shared/garasje-kunnskap.ts";
import { GARASJE_NASJONALE_KRAV } from "../apps/shared/garasje-regelgrunnlag.ts";

const empty = buildGarasjeKunnskapsgrunnlag();
assert.equal(empty.regelutfall, "ikke_vurdert");
assert.equal(empty.planbestemmelserKontrollert, false);
assert.equal(empty.arealFraKart.tomtearealM2, null);
assert.equal(empty.nasjonaleKrav, GARASJE_NASJONALE_KRAV);
assert.equal(empty.nasjonaleKrav.tallkrav.bra.verdi, 50);
assert.equal(empty.nasjonaleKrav.tallkrav.gesimshoyde.enhet, "m");
assert.equal(empty.kildeTilPlanbestemmelser, null);
assert(empty.sonetyper.every(sone => sone.navnerom === "no:4601:65270000:KPA2018"));
assert.equal(empty.kommunaleOppsett[0].bestemmelserUrl, "https://api.arealplaner.no/api/kunder/bergen4601/dokumenter/1487/download/b65270000.pdf");
assert(empty.begreper.some(begrep => begrep.id === "monehoyde"));
const result = buildGarasjeKunnskapsgrunnlag({
  personId: "SKAL_IKKE_MED", syntetiskFodselsnummer: "IKKE_IDENTITET",
  resultater: {
    "garasje-vurdering": {
      grunnlag: {
        adresse: "IKKE_ADRESSE",
        eiendomsgeojson: { geometry: "IKKE_GEOMETRI".repeat(10000) },
        arealformaal: [{ kode: 5100, arealstatus: 1, sonenavn: "LNF", planId: "65270000" }],
        arealberegning: { tomtearealM2: 1000, kartlagtBebygdArealM2: 100, kartlagtAndelProsent: 10 }
      },
      vurdering: { utfall: "maa_avklares" }
    }
  }
});
assert.equal(result.arealFraKart.kartlagtAndelProsent, 10);
assert.equal(result.arealFraKart.tillattUtnyttelse, "uavklart");
assert.equal(result.regelutfall, "maa_avklares");
assert.equal(result.soner[0].navn, "LNF");
const serialized = JSON.stringify(result);
for (const unwanted of ["SKAL_IKKE_MED", "IKKE_IDENTITET", "IKKE_ADRESSE", "IKKE_GEOMETRI"]) assert(!serialized.includes(unwanted));
assert(serialized.length < 10000, `Grunnlaget bør være lite for mindre modeller, fikk ${serialized.length} tegn`);
const invalid = buildGarasjeKunnskapsgrunnlag({
  resultater: { garasje: { arealberegning: { tomtearealM2: Infinity, kartlagtBebygdArealM2: -1 } } }
});
assert.equal(invalid.arealFraKart.tomtearealM2, null);
assert.equal(invalid.arealFraKart.kartlagtBebygdArealM2, null);
const oslo = buildGarasjeKunnskapsgrunnlag({
  resultater: { garasje: { adresse: { kommunenummer: "0301" } } }
});
assert.equal(oslo.kommunenummer, "0301");
assert.equal(oslo.kildeTilPlanbestemmelser, null, "Oslo skal ikke få Bergen-PDF-en som beslutningsgrunnlag");
console.log("Garasjekunnskap: felles regelkilde, begreper, ukjente forhold og begrenset modellgrunnlag besto.");
