import assert from "node:assert/strict";
import { buildTiltakshjelpenKunnskapsgrunnlag, projectTiltakshjelpenDokumentkunnskap, projectTiltakshjelpenPlanflater } from "../apps/shared/tiltakshjelpen-kunnskap.ts";
import { projectTiltakshjelpenDialogGrunnlag } from "../apps/shared/tiltakshjelpen-dialog.ts";
import type { TiltakshjelpenGrunnlag, TiltakshjelpenPlanflate } from "../apps/shared/tiltakshjelpen.ts";
import { retrieveTiltakshjelpenKunnskap } from "../apps/process-agent/src/tiltakshjelpen-kunnskap.ts";
import { FRITTLIGGENDE_NASJONALE_KRAV } from "../apps/shared/frittliggende-regelgrunnlag.ts";

const empty = buildTiltakshjelpenKunnskapsgrunnlag();
assert.equal(empty.regelutfall, "ikke_vurdert");
assert.equal(empty.planbestemmelserKontrollert, false);
assert.equal(empty.arealFraKart.tomtearealM2, null);
assert.equal(empty.nasjonaleKrav, FRITTLIGGENDE_NASJONALE_KRAV);
assert(empty.nasjonaleKrav);
assert.equal(empty.nasjonaleKrav.tallkrav.bra.verdi, 50);
assert.equal(empty.nasjonaleKrav.tallkrav.gesimshoyde.enhet, "m");
assert.equal(empty.kildeTilPlanbestemmelser, null);
assert(empty.sonetyper.every(sone => sone.navnerom === "no:4601:65270000:KPA2018"));
assert.equal(empty.kommunaleOppsett[0].bestemmelserUrl, "https://api.arealplaner.no/api/kunder/bergen4601/dokumenter/1487/download/b65270000.pdf");
assert(empty.begreper.some(begrep => begrep.id === "monehoyde"));
const result = buildTiltakshjelpenKunnskapsgrunnlag({
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
const invalid = buildTiltakshjelpenKunnskapsgrunnlag({
  resultater: { garasje: { arealberegning: { tomtearealM2: Infinity, kartlagtBebygdArealM2: -1 } } }
});
assert.equal(invalid.arealFraKart.tomtearealM2, null);
assert.equal(invalid.arealFraKart.kartlagtBebygdArealM2, null);
const oslo = buildTiltakshjelpenKunnskapsgrunnlag({
  resultater: { garasje: { adresse: { kommunenummer: "0301" } } }
});
assert.equal(oslo.kommunenummer, "0301");
assert.equal(oslo.kildeTilPlanbestemmelser, null, "Oslo skal ikke få Bergen-PDF-en som beslutningsgrunnlag");
for (const tiltakstype of ["gjerde", "tilbygg", "fasade", "ukjent"]) {
  const context = buildTiltakshjelpenKunnskapsgrunnlag({ prosjekt: { tiltakstype } });
  assert.equal(context.nasjonaleKrav, null, `${tiltakstype} må ikke få nasjonale garasjegrenser`);
  assert.equal(context.nasjonaleKravGjelderTiltakstype, null);
  assert.match(context.tiltak!.regelgrenser, /Ingen egne kildebekreftede tallgrenser/);
  assert.doesNotMatch(JSON.stringify(context), /"regelsett":"sak10-frittliggende-bygning"/);
}
assert.equal(buildTiltakshjelpenKunnskapsgrunnlag({ prosjekt: { tiltakstype: 123 } }).nasjonaleKrav, null);
assert.deepEqual(buildTiltakshjelpenKunnskapsgrunnlag({
  prosjekt: { tiltakstype: "gjerde", hoyde: 1.5, bya: 50, monehoyde: 4 }
}).prosjekt, { tiltakstype: "gjerde", hoyde: 1.5 });
assert.equal(buildTiltakshjelpenKunnskapsgrunnlag({
  resultater: { "garasje-vurdering": { vurdering: { tiltakstype: "gjerde", utfall: "maa_avklares" } } }
}).tiltak?.id, "gjerde", "Sluttrådet bruker vurderingens tiltakstype uten et ekstra typefelt");
assert.equal(buildTiltakshjelpenKunnskapsgrunnlag({
  prosjekt: { tiltakstype: "frittliggende" },
  resultater: { "garasje-vurdering": { vurdering: { tiltakstype: "gjerde", utfall: "maa_avklares" } } }
}).nasjonaleKrav, null, "Vurderingens tiltakstype går foran et gammelt prosjektutkast");
const canonicalUrl = empty.kommunaleOppsett[0].bestemmelserUrl;
const context = { resultater: { garasje: { adresse: { kommunenummer: "4601" } } } };
const calls: { name: string; args: Record<string, unknown> }[] = [];
const retrieved = await retrieveTiltakshjelpenKunnskap(context, "byggegrense", async (name, args) => {
  calls.push({ name, args });
  return name === "pdf_list_documents" ? { count: 2, dokumenter: [
    { documentId: "wrong", status: "extracted", source: { filename: "Oslo.pdf" } },
    { documentId: "right", status: "extracted", source: { canonicalUrl, sha256: "a".repeat(64) } }
  ] } : { count: 2, warnings: ["Testvarsel fra indeksen."], treff: [
    { documentId: "wrong", page: 2, text: "Skal ikke med fra feil dokument" },
    { documentId: "right", page: 7, title: "Planbestemmelser", authority: "binding", text: "Kildetekst ".repeat(500), knowledgeStatus: "ready", checkRecommended: false, sourceSha256: "a".repeat(64) }
  ] };
});
assert.equal(calls[1].args.documentId, "right");
assert.match(String(calls[1].args.query), /4601/);
assert.equal(retrieved.dokumentkunnskap.length, 1);
assert.equal(retrieved.dokumentkunnskap[0].page, 7);
assert.equal(retrieved.dokumentkunnskap[0].canonicalUrl, canonicalUrl);
assert.equal(retrieved.dokumentkunnskap[0].text?.length, 1800);
assert.equal(retrieved.dokumentkunnskap[0].truncated, true);
assert.equal(retrieved.dokumentkunnskap[0].scopeVerified, false);
assert.equal(retrieved.dokumentkunnskap[0].checkRecommended, true);
assert.equal(retrieved.dokumentkunnskap[0].sourceSha256, "a".repeat(64));
assert.match(retrieved.kunnskapsadvarsel, /Testvarsel fra indeksen/);
assert.equal(buildTiltakshjelpenKunnskapsgrunnlag({ ...context, ...retrieved }).planbestemmelserKontrollert, false);
const incomplete = projectTiltakshjelpenDokumentkunnskap([{ text: "tekst", page: -1, canonicalUrl: "javascript:alert(1)", checkRecommended: false }])[0];
assert.equal(incomplete.page, undefined);
assert.equal(incomplete.canonicalUrl, undefined);
assert.equal(incomplete.checkRecommended, true);
assert(incomplete.qualityWarnings.length > 0);
const noScope = await retrieveTiltakshjelpenKunnskap({}, "spørsmål", async () => { throw new Error("Skal ikke gjøre bredt søk"); });
assert.match(noScope.kunnskapsadvarsel, /ukjent/);
const unavailable = await retrieveTiltakshjelpenKunnskap(context, "spørsmål", async () => { throw new Error("Planlagt testfeil"); });
assert.match(unavailable.kunnskapsadvarsel, /utilgjengelig/);
const noMatch = await retrieveTiltakshjelpenKunnskap({ resultater: { garasje: { adresse: { kommunenummer: "0301" } } } }, "plan", async () => ({
  dokumenter: [{ documentId: "bergen", status: "extracted", source: { canonicalUrl } }]
}));
assert.equal(noMatch.dokumentkunnskap.length, 0);
const provided = await retrieveTiltakshjelpenKunnskap(context, "plan", async name => name === "pdf_list_documents"
  ? { dokumenter: [{ documentId: "provided", status: "extracted", source: { filename: "b65270000.pdf" } }] }
  : { treff: [{ documentId: "provided", page: 1, text: "Et opplastet utdrag.", checkRecommended: false }] });
assert.equal(provided.dokumentkunnskap.length, 1, "Et kjent plandokument kan hentes selv om opplasteren ikke oppga URL");
assert.equal(provided.dokumentkunnskap[0].canonicalUrl, undefined);
assert.equal(provided.dokumentkunnskap[0].checkRecommended, true, "Et filnavn bekrefter ikke kildens opphav");
assert.equal(provided.dokumentkunnskap[0].sourceSha256, undefined);
assert(provided.dokumentkunnskap[0].qualityWarnings.some(warning => warning.includes("Kildehash mangler")));
const diverseContext = { resultater: { garasje: {
  adresse: { kommunenummer: "4601" }, reguleringsplaner: [{ planId: "6170063", navn: "Lokal plan" }]
} } };
const documentCalls: string[] = [];
const diverse = await retrieveTiltakshjelpenKunnskap(diverseContext, "gjerde", async (name, args) => {
  if (name === "pdf_list_documents") return { count: 4, dokumenter: [
    ...["kpa-1", "kpa-2", "kpa-3"].map(documentId => ({
      documentId, status: "extracted", source: { canonicalUrl, sha256: "a".repeat(64) }
    })),
    { documentId: "local", status: "extracted", source: { filename: "r6170063.pdf", sha256: "a".repeat(64) } }
  ] };
  documentCalls.push(String(args.documentId));
  return { count: 3, warnings: [], treff: [1, 2, 3].map(page => ({
    documentId: args.documentId, page, chunkId: `${args.documentId}:${page}`,
    text: `Utdrag ${page} fra ${args.documentId}`, sourceSha256: "a".repeat(64)
  })) };
});
assert.deepEqual(documentCalls, ["kpa-1", "local", "kpa-2"], "En lokal plan må velges før flere KPA-dokumenter");
assert.deepEqual(diverse.dokumentkunnskap.map(hit => hit.documentId), documentCalls,
  "Hvert valgt dokument skal få plass før neste treff fra samme dokument");
assert.equal(diverse.dokumentkunnskap.length, 3);
assert.match(diverse.kunnskapsadvarsel, /1 relevante dokumenter ble utelatt/);
assert.match(diverse.kunnskapsadvarsel, /Viser 3 av 9 hentede utdrag/);
const missingLocal = await retrieveTiltakshjelpenKunnskap(diverseContext, "plan", async name => name === "pdf_list_documents"
  ? { count: 1, dokumenter: [{ documentId: "kpa", status: "extracted", source: { canonicalUrl } }] }
  : { count: 1, warnings: [], treff: [{ documentId: "kpa", page: 1, text: "Bare KPA." }] });
assert.match(missingLocal.kunnskapsadvarsel, /Plan 6170063 mangler brukbare utdrag/);
const rings: [number, number][][] = [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]];
const planflater: TiltakshjelpenPlanflate[] = [
  { kategori: "hensynssone", datasett: "stoy", sonekode: 220, navn: "Gul støysone", beskrivelse: "Støy må vurderes.",
    kildetekst: "H220 fra kommunens kart", sonenavn: "H220_1", hensynstype: "stoy", planId: "65270000", berorer: "delvis", ringer: rings },
  { kategori: "hensynssone", datasett: "fare", sonekode: 390, navn: "Annen fare", beskrivelse: "Fare må vurderes.",
    kildetekst: null, sonenavn: "H390_2", hensynstype: "fare", planId: "65270000", berorer: "delvis",
    ringer: [...rings, [[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5], [0.5, 0.5]]] },
  { kategori: "arealformaal", datasett: "arealformaal", sonekode: 5100, arealstatus: 1, navn: "LNF", beskrivelse: "Landbruk, natur og friluftsliv.",
    kildetekst: null, planId: "65270000", berorer: "delvis", ringer: [[[2, 0], [4, 0], [4, 4], [2, 4], [2, 0]]] }
];
const zoneGround: TiltakshjelpenGrunnlag = {
  adresse: { adressetekst: "IKKE_ADRESSE", kommunenummer: "4601", gardsnummer: 1, bruksnummer: 2, festenummer: 0, undernummer: 0, punkt: { lat: 1, lon: 1 } },
  punkt: { lat: 1, lon: 1 }, planflater, arealformaal: [], reguleringsplaner: [], eiendomsgrenser: [], bygninger: [],
  bebyggelse: { status: "uavklart", bebygd: null, bygninger: [], forklaring: "Ukjent", kilde: "test" },
  arealberegning: { tomtearealM2: null, kartlagtBebygdArealM2: null, kartlagtAndelProsent: null, kilde: "test", metode: "test", forbehold: [] },
  kilder: [{ id: "planflater", navn: "KPA2018", status: "ok", url: "https://example.test/?vest=0", hentet: "2026-09-10", uttrekksaar: 2018 }],
  uavklarteForhold: []
};
const projectedZones = projectTiltakshjelpenDialogGrunnlag(zoneGround);
const zoneKnowledge = buildTiltakshjelpenKunnskapsgrunnlag({ resultater: projectedZones });
assert.deepEqual(zoneKnowledge.planflater.map(zone => [zone.sonekode, zone.hensynstype, zone.punktIFlate]), [
  [220, "stoy", true], [390, "fare", false], [5100, null, false]
]);
assert.equal(zoneKnowledge.planflater[0].sonenavn, "H220_1");
assert.equal(zoneKnowledge.planflater[2].navn, "LNF");
assert.equal(zoneKnowledge.planflater[0].berorer, "delvis");
assert.equal(zoneKnowledge.planflater[0].planId, "65270000");
assert.equal(zoneKnowledge.planflatekilde.status, "ok");
assert.equal(zoneKnowledge.planflatekilde.uttrekksaar, 2018);
assert.deepEqual(zoneKnowledge.planflater, projectTiltakshjelpenPlanflater(zoneGround).planflater, "Punktkontrollen bevares gjennom begge projeksjonene");
assert.doesNotMatch(JSON.stringify(projectedZones), /ringer|coordinates|IKKE_ADRESSE|"lat"|"lon"|vest=/);
assert.equal(projectTiltakshjelpenPlanflater({ ...zoneGround, punkt: { lat: 0, lon: 1 } }).planflater[0].punktIFlate, true,
  "Punkt på sonegrensen er innenfor, som i felles geometrimodul");
const failedZones = buildTiltakshjelpenKunnskapsgrunnlag({ resultater: projectTiltakshjelpenDialogGrunnlag({
  ...zoneGround, planflater: [], kilder: [{ ...zoneGround.kilder[0], status: "feil", merknad: "Plankilden svarte ikke." }]
}) });
assert.equal(failedZones.planflatekilde.status, "feil");
assert.match(failedZones.planflatedekning.advarsel!, /tom liste betyr ikke/);
assert.match(failedZones.planflatekilde.merknad!, /svarte ikke/);
assert.equal(projectTiltakshjelpenPlanflater({ ...zoneGround, kilder: [] }).planflater[0].punktIFlate, null);
const manyZones = projectTiltakshjelpenPlanflater({ ...zoneGround,
  planflater: [...Array.from({ length: 10 }, () => ({ ...planflater[0], beskrivelse: "lang kildetekst ".repeat(40) })), ...planflater.slice(1)]
});
assert.equal(manyZones.planflater.length, 8);
assert(manyZones.planflater.some(zone => zone.sonekode === 390) && manyZones.planflater.some(zone => zone.sonekode === 5100));
assert.equal(manyZones.planflatedekning.utelatt, 4);
assert.match(manyZones.planflatedekning.advarsel!, /8 av 12/);
assert.match(manyZones.planflatedekning.advarsel!, /kildeteksten er forkortet/);
assert.deepEqual(projectTiltakshjelpenPlanflater(manyZones).planflatedekning, manyZones.planflatedekning);
console.log("Tiltakshjelpens kunnskapsgrunnlag: felles regelkilde, begreper, ukjente forhold og begrenset modellgrunnlag besto.");
