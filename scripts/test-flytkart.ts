#!/usr/bin/env node

/*
 * Flytkartet, gren for gren, mot regelen som faktisk kjører.
 *
 * `docs/flytkart-tiltakssjekk.md` gjengir fagpersonens flytkart
 * (`data/Flytkart Hackathon.jpg`) som tekst, og sier for hver node om koden gjør
 * det samme. En slik påstand uten en navngitt sjekk er et ønske, og det er dette
 * skriptet som er sjekken: hvert vilkår i kartet har et tilfelle her, og de tre
 * stedene koden med hensikt svarer noe annet enn kartet er pinnet som avvik, slik
 * at de ikke kan forsvinne i en opprydding.
 *
 * `evaluateGarasje` er ren og synkron, og `grunnlag` er derfor et literal her.
 * Ingen tjenester, ingen modell og ingen nettverk - kjør med `pnpm test:flytkart`.
 */

import assert from "node:assert/strict";
import type { GarasjeGrunnlag, GarasjePlanflate, GarasjeSjekk, GarasjeVurdering } from "../apps/shared/garasje.ts";
import { beskrivGarasjeUtfall, GARASJE_UTFALL_FRITAR, utfallFritarForSoknad } from "../apps/shared/garasje.ts";
import { GARASJE_KOMMUNER } from "../apps/shared/garasje-kommuner.ts";
import type { Byggetiltak, ByggetiltakInput } from "../apps/shared/byggetiltak.ts";
import { BYGGETILTAK_KATALOG } from "../apps/shared/byggetiltak.ts";
import { KPA2018_SONEKILDE } from "../apps/shared/arealsoner.ts";
import { evaluateGarasje } from "../apps/sandbox-backend/src/garasje.ts";

/** Én gren av kartet, med vide felttyper slik at et tilfelle kan endre ett vilkår. */
type Gren<T extends Byggetiltak["tiltakstype"]> = Extract<Byggetiltak, { tiltakstype: T }>;

let count = 0;
const alleUtfall: GarasjeVurdering[] = [];
function test(navn: string, check: () => unknown): void {
  try { check(); count++; } catch (error) { console.error(`FEIL: ${navn}`); throw error; }
}

// Teigen er et lite kvadrat rundt punktet, så `plassering` blir oppfylt uten at
// noen ekte geometri må hentes. Kartet sier ingenting om teiger; sjekken finnes
// fordi et skissepunkt utenfor eiendommen ikke skal vurderes videre.
const punkt = { lat: 60.2537577976675, lon: 5.255241147052527 };
const teig: [number, number][][] = [[
  [punkt.lon - 0.001, punkt.lat - 0.001], [punkt.lon + 0.001, punkt.lat - 0.001],
  [punkt.lon + 0.001, punkt.lat + 0.001], [punkt.lon - 0.001, punkt.lat + 0.001],
  [punkt.lon - 0.001, punkt.lat - 0.001],
]];

const kilde = (id: string, navn: string, status: "ok" | "ingen_treff") =>
  ({ id, navn, url: "https://kart.bergen.kommune.no/", hentet: "2026-09-11T00:00:00.000Z", status });

type Sone = "lnf" | "byggesone";

/** Litle Milde er LNF uten reguleringsplan; Kråkenestoppen er byggesone med plan 6170063. */
function lagGrunnlag(sone: Sone): GarasjeGrunnlag {
  const lnf = sone === "lnf";
  return {
    adresse: {
      adressetekst: lnf ? "Litle Milde 65" : "Kråkenestoppen 60", kommunenummer: KPA2018_SONEKILDE.kommunenummer,
      kommunenavn: "BERGEN", gardsnummer: lnf ? 105 : 20, bruksnummer: lnf ? 209 : 1413,
      festenummer: 0, undernummer: 0, punkt,
    },
    punkt,
    arealformaal: [{
      kode: lnf ? 5100 : 1001, beskrivelse: lnf ? "LNF" : "Øvrig byggesone",
      planId: KPA2018_SONEKILDE.planId, arealstatus: 1,
    }],
    reguleringsplaner: lnf ? [] : [{
      planId: "6170063", navn: "FYLLINGSDALEN. BØNES ØST, FELT 19A, PLAN FOR BEBYGGELSE",
      url: "https://arealplaner.no/4601/arealplaner/6170063",
    }],
    eiendomsgrenser: [{ id: "teig-1", ringer: teig }],
    bygninger: [],
    planflater: [],
    bebyggelse: {
      status: "bekreftet", bebygd: true, bygninger: [],
      forklaring: "Kartlagt bebyggelse på teigen.", kilde: "https://kart.bergen.kommune.no/",
    },
    arealberegning: {
      tomtearealM2: 600, kartlagtBebygdArealM2: 120, kartlagtAndelProsent: 20,
      kilde: "https://kart.bergen.kommune.no/", metode: "Teiger i EPSG:4258", forbehold: [],
    },
    kilder: [
      kilde("adresse", "Kartverkets adresseregister", "ok"),
      kilde("eiendomsgrenser", "Kartverkets eiendoms-API", "ok"),
      kilde("kpa", "Bergen KPA2018 arealformål", "ok"),
      kilde("reguleringsplan", "Bergen reguleringsplaner", lnf ? "ingen_treff" : "ok"),
      kilde("bygninger", "Bergen bygningsflater", "ok"),
      kilde("planflater", "KPA2018-uttrekk 2018", "ok"),
    ],
    uavklarteForhold: [],
  };
}

function vurder(tiltak: ByggetiltakInput, sone: Sone = "lnf",
  endre: (grunnlag: GarasjeGrunnlag) => GarasjeGrunnlag = g => g): GarasjeVurdering {
  const vurdering = evaluateGarasje(tiltak, endre(lagGrunnlag(sone)));
  alleUtfall.push(vurdering);
  return vurdering;
}
const sjekk = (vurdering: GarasjeVurdering, id: string): GarasjeSjekk => {
  const treff = vurdering.sjekker.find(s => s.id === id);
  assert(treff, `Sjekken ${id} mangler i vurderingen.`);
  return treff;
};

/**
 * Ett brutt vilkår per tilfelle, slik at et brudd ikke kan skjule et annet.
 *
 * Både frittstående bygning og tilbygg har en slik tabell, og kroppen var skrevet
 * to ganger med den ene forskjellen at tilbygget ikke sjekket `nasjonaltUnntak` -
 * uten en oppgitt grunn, for det holder der også: et brudd slår en uavklart sjekk.
 */
function bryterVilkaar<T extends ByggetiltakInput>(
  navn: string, grunnform: T, rader: readonly [string, string, Partial<T>][]
): void {
  for (const [beskrivelse, id, endring] of rader) {
    test(`${navn} brytes av ${beskrivelse}`, () => {
      const vurdering = vurder({ ...grunnform, ...endring });
      assert.equal(sjekk(vurdering, id).status, "brudd", id);
      assert.equal(vurdering.nasjonaltUnntak, "brudd");
      assert.equal(vurdering.utfall, "soknadspliktig");
    });
  }
}

// --- Gren 1: frittstående bygning, SAK10 § 4-1 første ledd bokstav a ----------

const frittliggende: Gren<"frittliggende"> = {
  tiltakstype: "frittliggende", tiltaksbeskrivelse: "En dobbelgarasje", tiltakstypeBekreftet: true,
  bra: 49.5, bya: 45, gesimshoyde: 2.8, monehoyde: 3.9, etasjer: 1,
  frittliggende: true, beboelse: false, kjeller: false, bebygdEiendom: true,
  avstandNabogrense: 2, avstandBygning: 2, overVannAvlop: false,
};

test("Kartets ti vilkår for frittstående bygning er oppfylt for et tiltak som holder seg innenfor", () => {
  const vurdering = vurder(frittliggende);
  assert.equal(vurdering.nasjonaltUnntak, "oppfylt");
  for (const id of ["areal", "hoyde", "etasjer", "kjeller", "frittliggende", "beboelse",
    "bebygd", "nabogrense", "bygning", "vann-avlop"]) {
    assert.equal(sjekk(vurdering, id).status, "oppfylt", id);
    assert.equal(sjekk(vurdering, id).bestemmelse, "SAK10 § 4-1 første ledd bokstav a", id);
  }
});

// Verdiene ligger like over eller under kartets grense, som er der en regresjon vises.
const bruddPerVilkaar: [string, string, Partial<Gren<"frittliggende">>][] = [
  ["bruksarealet over 50 m2", "areal", { bra: 50.1 }],
  ["bebygd areal over 50 m2", "areal", { bya: 50.1 }],
  ["mønehøyden over 4,0 meter", "hoyde", { monehoyde: 4.1 }],
  ["gesimshøyden over 3,0 meter", "hoyde", { gesimshoyde: 3.1, monehoyde: 4 }],
  ["mer enn en etasje", "etasjer", { etasjer: 2 }],
  ["kjeller", "kjeller", { kjeller: true }],
  ["ikke frittliggende", "frittliggende", { frittliggende: false }],
  ["beboelse", "beboelse", { beboelse: true }],
  ["ubebygd eiendom", "bebygd", { bebygdEiendom: false }],
  ["under 1,0 meter til nabogrensen", "nabogrense", { avstandNabogrense: 0.9 }],
  ["under 1,0 meter til annen bygning", "bygning", { avstandBygning: 0.9 }],
  ["over vann- eller avløpsledninger", "vann-avlop", { overVannAvlop: true }],
];
bryterVilkaar("Vilkåret", frittliggende, bruddPerVilkaar);

test("Et ukjent svar er uavklart, aldri oppfylt", () => {
  const vurdering = vurder({ ...frittliggende, kjeller: null, avstandNabogrense: null });
  assert.equal(sjekk(vurdering, "kjeller").status, "uavklart");
  assert.equal(sjekk(vurdering, "nabogrense").status, "uavklart");
  assert.equal(vurdering.nasjonaltUnntak, "uavklart");
  assert.equal(vurdering.utfall, "maa_avklares");
});

// --- Kartets KPA18-node: bestemmelse § 31.3 ----------------------------------

test("LNF med mer enn 1 meter til nabogrensen oppfyller kartets § 31.3-vilkår", () => {
  const kommuneplan = sjekk(vurder(frittliggende), "kommuneplan");
  assert.equal(kommuneplan.status, "oppfylt");
  assert.equal(kommuneplan.bestemmelse, `Bergen KPA2018 § 31.3, plan ${KPA2018_SONEKILDE.planId}`);
  assert.match(kommuneplan.forklaring, /§ 31\.3-vilkåret i denne flyten om mer enn 1 m avstand er oppfylt/);
});

test("Akkurat 1 meter er ikke nok for § 31.3-vilkåret", () => {
  const vurdering = vurder({ ...frittliggende, avstandNabogrense: 1 });
  assert.equal(sjekk(vurdering, "nabogrense").status, "oppfylt");
  assert.equal(sjekk(vurdering, "kommuneplan").status, "uavklart");
});

test("Ukjent avstand gjør § 31.3-vilkåret uavklart i stedet for oppfylt", () => {
  const vurdering = vurder({ ...frittliggende, avstandNabogrense: null });
  assert.equal(sjekk(vurdering, "kommuneplan").status, "uavklart");
  assert.match(sjekk(vurdering, "kommuneplan").forklaring, /Avstanden er ikke oppgitt/);
});

test("Utenfor LNF er kommuneplanen uavklart uansett avstand", () => {
  const vurdering = vurder(frittliggende, "byggesone");
  assert.equal(sjekk(vurdering, "kommuneplan").status, "uavklart");
  assert.equal(sjekk(vurdering, "kommuneplan").bestemmelse, undefined);
});

// --- Gren 2: tilbygg, SAK10 § 4-1 første ledd bokstav b ----------------------

const tilbygg: Gren<"tilbygg"> = {
  tiltakstype: "tilbygg", tiltaksbeskrivelse: "Et tilbygg på fjorten kvadratmeter", tiltakstypeBekreftet: true,
  bra: 14, bya: 14, etasjer: 1, understottet: true, endrerBruk: false, nyBoenhet: false,
  bebygdEiendom: true, avstandNabogrense: 5, overVannAvlop: false,
};

test("Tilbygget vurderes etter bokstav b, ikke etter garasjens vilkår", () => {
  const vurdering = vurder(tilbygg);
  assert.equal(vurdering.tiltakstype, "tilbygg");
  assert.equal(sjekk(vurdering, "tilbygg-areal").bestemmelse, "SAK10 § 4-1 første ledd bokstav b");
  for (const id of ["areal", "hoyde", "nabogrense", "bygning"]) {
    assert.equal(vurdering.sjekker.find(s => s.id === id), undefined, id);
  }
});

const bruddPerTilbyggsvilkaar: [string, string, Partial<Gren<"tilbygg">>][] = [
  ["bruksarealet over 15 m2", "tilbygg-areal", { bra: 15.1 }],
  ["bebygd areal over 15 m2", "tilbygg-areal", { bya: 15.1 }],
  ["et tilbygg som ikke er understøttet", "tilbygg-understottet", { understottet: false }],
  ["mer enn to etasjer", "tilbygg-etasjer", { etasjer: 3 }],
  ["endret godkjent bruk", "tilbygg-bruk", { endrerBruk: true }],
  ["en ny selvstendig boenhet", "tilbygg-boenhet", { nyBoenhet: true }],
];
bryterVilkaar("Tilbyggsvilkåret", tilbygg, bruddPerTilbyggsvilkaar);

test("Garasjens 1-metersregel gjelder ikke for tilbygg, og avstanden må avklares", () => {
  const vurdering = vurder(tilbygg);
  const avstand = sjekk(vurdering, "tilbygg-nabogrense");
  assert.equal(avstand.status, "uavklart");
  assert.equal(avstand.bestemmelse, "Plan- og bygningsloven § 29-4 andre og tredje ledd");
  assert.match(avstand.forklaring, /Garasjens 1-metersregel gjelder ikke her/);
  assert.equal(sjekk(vurdering, "tilbygg-ledninger").bestemmelse, "Plan- og bygningsloven § 28-1");
  assert.equal(vurdering.nasjonaltUnntak, "uavklart");
});

test("§ 31.3-vilkåret flytter ikke kommuneplanen for et tilbygg", () => {
  assert.equal(sjekk(vurder(tilbygg), "kommuneplan").status, "uavklart");
});

// --- Gren 3: gjerde, SAK10 § 4-1 første ledd bokstav f nr. 3 -----------------

const gjerde: Gren<"gjerde"> = {
  tiltakstype: "gjerde", tiltaksbeskrivelse: "Et stakittgjerde mot veien", tiltakstypeBekreftet: true,
  hoyde: 1.2, motVeg: true, friSikt: true, aapenLett: true,
};

test("Et åpent, lett gjerde mot vei på under 1,5 meter oppfyller unntaket", () => {
  const vurdering = vurder(gjerde, "byggesone");
  assert.equal(vurdering.nasjonaltUnntak, "oppfylt");
  for (const id of ["gjerde-type", "gjerde-veg", "gjerde-hoyde", "gjerde-frisikt"]) {
    assert.equal(sjekk(vurdering, id).bestemmelse, "SAK10 § 4-1 første ledd bokstav f nr. 3", id);
  }
});

test("Over 1,5 meter mot vei er et brudd", () => {
  const vurdering = vurder({ ...gjerde, hoyde: 1.6 }, "byggesone");
  assert.equal(sjekk(vurdering, "gjerde-hoyde").status, "brudd");
  assert.equal(vurdering.utfall, "soknadspliktig");
});

test("Samme høyde uten vei er ikke et brudd, og et gjerde som ikke er mot vei sies å være utenfor § 20-2", () => {
  const vurdering = vurder({ ...gjerde, hoyde: 1.6, motVeg: false }, "byggesone");
  assert.equal(sjekk(vurdering, "gjerde-hoyde").status, "oppfylt");
  assert.match(sjekk(vurdering, "gjerde-veg").forklaring, /ikke er mot vei/);
});

test("Hindret frisikt er et brudd", () => {
  const vurdering = vurder({ ...gjerde, friSikt: false }, "byggesone");
  assert.equal(sjekk(vurdering, "gjerde-frisikt").status, "brudd");
});

test("Et tett gjerde er uavklart og ikke et avslag", () => {
  const vurdering = vurder({ ...gjerde, aapenLett: false }, "byggesone");
  assert.equal(sjekk(vurdering, "gjerde-type").status, "uavklart");
  assert.equal(vurdering.utfall, "maa_avklares");
});

test("Et dokumentert treff i plan 6170063 gir varselet om § 7 bokstav d", () => {
  const vurdering = vurder(gjerde, "byggesone");
  const plan = sjekk(vurdering, "gjerde-plan-6170063");
  assert.equal(plan.bestemmelse, "Reguleringsplan 6170063 § 7 bokstav d");
  assert.match(plan.forklaring, /0,9 m inkludert sokkel/);
  assert.match(plan.forklaring, /Grensen på 1,5 m i SAK10 erstatter ikke planbestemmelsen/);
  assert.equal(sjekk(vurdering, "gjerde-plan-6170063-hoyde").status, "uavklart");
  assert(vurdering.nesteSteg?.some(steg => /§ 7 bokstav d/.test(steg)));
});

test("En oppgitt høyde over 0,9 meter navngis mot plangrensen", () => {
  assert.match(sjekk(vurder({ ...gjerde, hoyde: 1.2 }, "byggesone"), "gjerde-plan-6170063-hoyde").forklaring,
    /Oppgitt høyde overstiger plangrensen på 0,9 m inkludert sokkel/);
  assert.doesNotMatch(sjekk(vurder({ ...gjerde, hoyde: 0.9 }, "byggesone"), "gjerde-plan-6170063-hoyde").forklaring,
    /overstiger plangrensen/);
});

test("Uten et plantreff finnes ingen 6170063-sjekk", () => {
  const vurdering = vurder(gjerde, "lnf");
  assert.equal(vurdering.sjekker.find(s => s.id.startsWith("gjerde-plan-")), undefined);
});

/*
 * Avvik fra kartet, med hensikt. Kartet konkluderer «Søknadspliktig tiltak
 * grunnet reguleringsplanens bestemmelse. Det er ikke mulig å søke dispensasjon
 * fra denne bestemmelsen». Regelen svarer «må avklares», fordi et krav om
 * kommunal godkjenning av utførelse, høyde og farge ikke i seg selv er et avslag,
 * og fordi planbestemmelsen ikke er lest maskinelt. Pinnet her, slik at en
 * senere endring av standpunktet blir et valg noen tar og ikke en bivirkning.
 */
test("Avvik: et plantreff for gjerde endrer ikke utfallet til søknadspliktig", () => {
  const vurdering = vurder(gjerde, "byggesone");
  assert.equal(sjekk(vurdering, "gjerde-plan-6170063").status, "uavklart");
  assert.equal(vurdering.utfall, "maa_avklares");
  assert.match(sjekk(vurdering, "gjerde-plan-6170063").forklaring,
    /godkjennings- eller dispensasjonsløp/);
});

// --- Gren 4: fasade eller tak, pbl. §§ 20-1 og 20-5 -------------------------

const fasade: Gren<"fasade"> = {
  tiltakstype: "fasade", tiltaksbeskrivelse: "Bytte taksteinen med lik takstein", tiltakstypeBekreftet: true,
  likUtforming: true, endrerUtseende: false, endrerBaering: false, endrerBrannkrav: false,
};

test("Kartets alternativ 1, lik taktekking, er vedlikehold og ikke et brudd", () => {
  const vurdering = vurder(fasade);
  assert.equal(sjekk(vurdering, "fasade-karakter").status, "oppfylt");
  assert.equal(sjekk(vurdering, "fasade-konstruksjon").status, "oppfylt");
  assert.match(sjekk(vurdering, "fasade-karakter").forklaring, /Vern og lokale planbestemmelser er likevel ikke avklart/);
});

test("Kartets alternativ 2, annet utseende, er uavklart og ikke avgjort av et nøkkelord", () => {
  const vurdering = vurder({ ...fasade, likUtforming: false, endrerUtseende: true });
  assert.equal(sjekk(vurdering, "fasade-karakter").status, "uavklart");
  assert.equal(sjekk(vurdering, "fasade-karakter").bestemmelse, "Plan- og bygningsloven § 20-5 første ledd bokstav f");
  assert.equal(vurdering.utfall, "maa_avklares");
});

test("Kartets alternativ 3, inngrep i bæring eller brannsikring, er søknadspliktig", () => {
  for (const endring of [{ endrerBaering: true }, { endrerBrannkrav: true }]) {
    const vurdering = vurder({ ...fasade, ...endring });
    assert.equal(sjekk(vurdering, "fasade-konstruksjon").status, "brudd");
    assert.equal(sjekk(vurdering, "fasade-konstruksjon").bestemmelse, "Plan- og bygningsloven § 20-1 første ledd bokstav b");
    assert.equal(vurdering.utfall, "soknadspliktig");
  }
});

test("Fasadegrenen ber innbyggeren ta bilder og beskrivelse til kommunen", () => {
  assert(vurder(fasade).nesteSteg?.some(steg => /kvalifisert fagperson/.test(steg)));
});

// --- Uklassifisert tiltak ---------------------------------------------------

test("Et uavklart tiltak får ingen av garasjereglene", () => {
  const vurdering = vurder({ tiltakstype: "ukjent", tiltaksbeskrivelse: "Noe jeg ikke vet hva er", tiltakstypeBekreftet: true });
  assert.equal(sjekk(vurdering, "tiltakstype").status, "uavklart");
  assert.equal(vurdering.sjekker.filter(s => s.bestemmelse?.includes("SAK10")).length, 0);
  assert.equal(vurdering.utfall, "maa_avklares");
});

test("Kartets fire grener og det uavklarte tiltaket er de samme fem typene som katalogen har", () => {
  assert.deepEqual(BYGGETILTAK_KATALOG.map(entry => entry.id),
    ["frittliggende", "tilbygg", "gjerde", "fasade", "ukjent"]);
});

// --- Kartets grønne boks: fritak med meldeplikt ------------------------------

/*
 * «Utfall: Du trenger ikke å søke, men må melde inn etter du er ferdig å bygge.»
 * Hvert tilfelle under fjerner ett ledd i hvitelisten, og utfallet skal da falle
 * tilbake til «må avklares». Uten et tilfelle per ledd kunne et ledd forsvinne
 * uten at noe ble rødt, og det er nettopp dette utfallet som ikke tåler det.
 */
const stoysone: GarasjePlanflate = {
  kategori: "hensynssone", datasett: "stoy", sonekode: 220, sonenavn: "H220_1", hensynstype: "stoy",
  navn: "Gul støysone", beskrivelse: "Støy over grenseverdien for støyfølsom bruk.",
  kildetekst: "Flystøy gul sone", berorer: "helt", planId: KPA2018_SONEKILDE.planId, ringer: teig,
};
const faresone: GarasjePlanflate = {
  ...stoysone, datasett: "fare", sonekode: 390, sonenavn: "H390_2", hensynstype: "fare",
  navn: "Faresone annen fare", beskrivelse: "Annen fare.", kildetekst: null,
};

test("Kartets grønne gren gir fritak med meldeplikt, og skjemalenken følger med", () => {
  const vurdering = vurder(frittliggende);
  assert.equal(vurdering.utfall, "meldeplikt");
  assert(utfallFritarForSoknad(vurdering.utfall));
  const meldeplikt = sjekk(vurdering, "meldeplikt");
  assert.equal(meldeplikt.status, "oppfylt");
  assert.equal(meldeplikt.kilde, GARASJE_KOMMUNER["4601"].meldeskjemaUrl);
  assert.equal(meldeplikt.bestemmelse, "Bergen KPA2018 § 31.3");
  assert(vurdering.nesteSteg?.some(steg => /Meld tiltaket inn til kommunen når det er ferdig bygget/.test(steg)));
  assert.match(vurdering.forklaring, /unntatt fra søknadsplikt, men skal meldes inn/);
});

/*
 * Forbeholdene må ikke motsi svaret. De tre faste setningene ble skrevet for en
 * verden der ingen fritak var mulig, og den første av dem sa at planbestemmelsene
 * må avklares. Sto den også under et fritak, ville innbyggeren lese «Ja, men du må
 * melde inn» og rett etterpå at ingenting er kontrollert.
 */
test("Fritaket sier ikke samtidig at planbestemmelsene må avklares", () => {
  const fritatt = vurder(frittliggende);
  const avklares = vurder({ ...frittliggende, avstandNabogrense: 1 });
  assert.equal(fritatt.utfall, "meldeplikt");
  assert.equal(avklares.utfall, "maa_avklares");
  assert(avklares.uavklarteForhold.some(f => /Gjeldende planbestemmelser, byggegrenser og tillatt utnyttelse må avklares/.test(f)));
  assert(!fritatt.uavklarteForhold.some(f => /Gjeldende planbestemmelser, byggegrenser og tillatt utnyttelse må avklares/.test(f)));
  // Det som fortsatt står, står fordi det er sant også under et fritak.
  assert(fritatt.uavklarteForhold.some(f => /bestemmelsesteksten er ikke lest maskinelt/i.test(f)));
  assert(fritatt.uavklarteForhold.some(f => /Ledningskart, flom, skred/.test(f)));
  assert(fritatt.uavklarteForhold.some(f => /Kartet viser et punkt/.test(f)));
});

test("En støysone holder ikke fritaket tilbake, men navngis i svaret", () => {
  const vurdering = vurder(frittliggende, "lnf", g => ({ ...g, planflater: [stoysone] }));
  assert.equal(vurdering.utfall, "meldeplikt");
  assert.match(sjekk(vurdering, "meldeplikt").forklaring, /Gul støysone H220_1/);
});

const utenMeldeplikt: [string, () => GarasjeVurdering][] = [
  ["tiltaket er et tilbygg", () => vurder(tilbygg)],
  ["et nasjonalt vilkår er ukjent", () => vurder({ ...frittliggende, kjeller: null })],
  ["avstanden er akkurat 1 meter, så § 31.3-vilkåret ikke er oppfylt", () => vurder({ ...frittliggende, avstandNabogrense: 1 })],
  ["eiendommen ligger i en byggesone der ingen bestemmelse er lest", () => vurder(frittliggende, "byggesone")],
  ["en reguleringsplan berører eiendommen", () => vurder(frittliggende, "lnf", g => ({
    ...g, reguleringsplaner: [{ planId: "6170063", navn: "Plan", url: "https://arealplaner.no/4601/arealplaner/6170063" }],
  }))],
  ["en faresone berører eiendommen", () => vurder(frittliggende, "lnf", g => ({ ...g, planflater: [faresone] }))],
  ["en kartkilde ikke svarte", () => vurder(frittliggende, "lnf", g => ({
    ...g, kilder: g.kilder.map(k => k.id === "bygninger" ? { ...k, status: "feil" as const } : k),
  }))],
  ["skissepunktet ligger utenfor eiendommen", () => vurder(frittliggende, "lnf", g => ({ ...g, eiendomsgrenser: [] }))],
  ["kommunen ikke har et meldeskjema", () => vurder(frittliggende, "lnf", g => ({
    ...g, adresse: { ...g.adresse, kommunenummer: "0301" },
  }))],
];
for (const [beskrivelse, kjor] of utenMeldeplikt) {
  test(`Fritaket holdes tilbake når ${beskrivelse}`, () => {
    const vurdering = kjor();
    assert.notEqual(vurdering.utfall, "meldeplikt", beskrivelse);
    assert.equal(vurdering.sjekker.find(s => s.id === "meldeplikt"), undefined, beskrivelse);
  });
}

test("En faresone kan holde tilbake fritaket, men aldri gjøre tiltaket søknadspliktig", () => {
  const vurdering = vurder(frittliggende, "lnf", g => ({ ...g, planflater: [faresone] }));
  assert.equal(vurdering.utfall, "maa_avklares");
  assert.equal(sjekk(vurdering, "hensynssoner").status, "uavklart");
  assert.equal(vurdering.nasjonaltUnntak, "oppfylt");
});

test("Svarsetningen sier ja med meldeplikt, nei ved søknadsplikt og kontakt kommunen ellers", () => {
  assert.equal(beskrivGarasjeUtfall(vurder(frittliggende)).tittel, "Ja, men du må melde inn");
  assert.equal(beskrivGarasjeUtfall(vurder({ ...frittliggende, bya: 60 })).tittel, "Nei, du må søke");
  assert.equal(beskrivGarasjeUtfall(vurder(frittliggende, "byggesone")).tittel, "Kontakt kommunen");
});

// --- Det ubetingede fritaket, som fortsatt ikke finnes ----------------------

/*
 * `ikke_soknadspliktig` er et fritak uten forbehold, og piloten gir det ikke:
 * et oppfylt nasjonalt unntak er ikke en kontrollert planbestemmelse. Kartets
 * grønne boks har en meldeplikt, og `meldeplikt` er derfor det eneste fritaket
 * som kan komme ut - og bare gjennom hvitelisten over.
 */
test(`Ingen gren gir det ubetingede ${GARASJE_UTFALL_FRITAR}`, () => {
  assert(alleUtfall.length > 40, "Tilfellene over må ha kjørt først.");
  assert.equal(alleUtfall.filter(v => v.utfall === GARASJE_UTFALL_FRITAR).length, 0);
  const fritak = alleUtfall.filter(v => utfallFritarForSoknad(v.utfall));
  assert(fritak.length > 0, "Kartets grønne gren skal kunne nås.");
  assert(fritak.every(v => v.utfall === "meldeplikt" && v.sjekker.some(s => s.id === "meldeplikt")));
  const utenFritak = alleUtfall.filter(v => v.nasjonaltUnntak === "oppfylt" && !utfallFritarForSoknad(v.utfall));
  assert(utenFritak.length > 0);
  assert(utenFritak.every(v => v.utfall === "maa_avklares"
    && /Piloten kan ikke konkludere med at du kan bygge uten søknad/.test(v.forklaring)),
    "Et oppfylt nasjonalt unntak alene gir «må avklares», ikke et fritak.");
});

console.log(`OK: ${count} tilfeller fra flytkartet stemmer med regelen.`);
