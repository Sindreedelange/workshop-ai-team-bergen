import assert from "node:assert/strict";
import { buildGarasjeRaadPrompt, validateGarasjeRaad } from "../apps/ai-gateway/src/garasje-raad.ts";
import { GARASJE_UTFALL, GARASJE_UTFALL_FRITAR } from "../apps/shared/garasje.ts";

/** validateGarasjeRaad svarer null når det ikke er noe råd. Her er det alltid ett. */
function kreves<T>(verdi: T | null, hva: string): T {
  assert(verdi, `${hva} skulle gitt et råd`);
  return verdi;
}

// Klemmen er hele poenget: bare reglene kan si at noe ikke er søknadspliktig.
// Prompten ber om det samme, men en prompt kan modellen overse, og da er dette
// det som står igjen.
const uavklart = {
  utfall: "maa_avklares",
  uavklarteForhold: ["Planbestemmelser for KPA2018 er ikke kontrollert."]
};

const forsoktGroent = kreves(validateGarasjeRaad({
  antattUtfall: "ikke_soknadspliktig",
  raad: "Nasjonale grenser er oppfylt, så du kan bygge uten å søke.",
  maaAvklares: [],
  begrunnelse: "Størrelse og høyder er innenfor."
}, uavklart), "et grønt forslag mot en uavklart vurdering");
assert.equal(forsoktGroent.antattUtfall, "maa_avklares", "et råd kan ikke gjøre utfallet mildere enn reglene");
assert(forsoktGroent.overstyrt?.includes("maa_avklares"), "overstyringen skal si hva som skjedde");
assert.deepEqual(forsoktGroent.maaAvklares, uavklart.uavklarteForhold,
  "reglenes uavklarte forhold står i lista selv om modellen svarte med en tom liste");
assert.equal(forsoktGroent.fraRegler, 1, "klienten må kunne skille reglenes forhold fra modellens tillegg");

// Strengere enn reglene er trygt, og ofte riktig når bestemmelsene ikke er lest.
const strengere = kreves(validateGarasjeRaad({
  antattUtfall: "maa_avklares",
  raad: "Bestemmelsene er ikke gjennomgått, så forholdet må avklares.",
  maaAvklares: ["Les KPA2018-bestemmelsene."],
  begrunnelse: "PDF-en er ikke innlest."
}, { utfall: "ikke_soknadspliktig", uavklarteForhold: [] }), "et strengere råd");
assert.equal(strengere.antattUtfall, "maa_avklares");
assert.equal(strengere.overstyrt, undefined, "et strengere råd er ikke en overstyring");

// Reglenes forhold kommer først, og et duplikat fra modellen legges ikke til to ganger.
const duplikat = kreves(validateGarasjeRaad({
  antattUtfall: "maa_avklares",
  raad: "Forholdet må avklares.",
  maaAvklares: ["Planbestemmelser for KPA2018 er ikke kontrollert.", "Juridisk utnyttelsesgrad er ukjent."],
  begrunnelse: ""
}, uavklart), "et råd med duplikat");
assert.deepEqual(duplikat.maaAvklares, [
  "Planbestemmelser for KPA2018 er ikke kontrollert.",
  "Juridisk utnyttelsesgrad er ukjent."
]);
assert.equal(duplikat.fraRegler, 1, "bare det første punktet kom fra reglene");

// Et ukjent utfall fra modellen faller til reglenes, ikke til det grønne.
const tull = kreves(validateGarasjeRaad({ antattUtfall: "helt_greit", raad: "Noe tekst.", maaAvklares: [] }, uavklart), "et ukjent utfall fra modellen");
assert.equal(tull.antattUtfall, "maa_avklares");

// Et ukjent utfall i *vurderingen* er ikke et grønt lys heller.
const utenVurdering = kreves(validateGarasjeRaad({ antattUtfall: "ikke_soknadspliktig", raad: "Noe tekst." }, {}), "en vurdering uten utfall");
assert.equal(utenVurdering.antattUtfall, "maa_avklares",
  "mangler vurderingen et utfall, er svaret at forholdet må avklares");

// Uten et råd er det ingenting å vise, og da skal kallstedet feile i stedet for å
// sende en tom boble videre til innbyggeren.
assert.equal(validateGarasjeRaad({ antattUtfall: "maa_avklares", raad: "   " }, uavklart), null);
assert.equal(validateGarasjeRaad(null, uavklart), null);
assert.equal(validateGarasjeRaad("maa_avklares", uavklart), null);

// Kodeverket bor i apps/shared og er derivert til typen, så det finnes ingen kopi
// å holde i takt. Det som er verdt å feste er at det ene fritakende utfallet er med
// i listen: en omdøping som gjør dem uenige ville gjort klemmen til en no-op.
assert(GARASJE_UTFALL.includes(GARASJE_UTFALL_FRITAR),
  "det fritakende utfallet må være et gyldig utfall, ellers klemmer klemmen ingenting");

// Prompten: den regelbaserte vurderingen skal stå der, og persondata skal ikke.
// Kallstedet projiserer gjennom buildGarasjeKunnskapsgrunnlag, så det som sendes
// hit er allerede uten identitet - men prompten skal ikke finne på å legge til noe.
const prompt = buildGarasjeRaadPrompt(
  { kommunenummer: "4601", planbestemmelserKontrollert: false },
  uavklart
);
assert(prompt.includes("«maa_avklares»"), "prompten skal si hva reglene allerede har avgjort");
assert(prompt.includes("Bare reglene kan si at noe ikke er søknadspliktig."));
assert(prompt.includes("aldri fravær av begrensninger"));
assert(!/fødselsnummer|personId/i.test(prompt));

console.log("Garasjeråd: klemmen mot et mildere utfall, reglenes uavklarte forhold og promptgrensene besto.");
