import type { GarasjeGrunnlag, GarasjePolygon, GarasjePunkt, GarasjeSjekk, GarasjeTiltak, GarasjeVurdering } from "../../shared/garasje.ts";
import { HttpError } from "./errors.ts";
import { GARASJE_NASJONALE_KRAV } from "../../shared/garasje-regelgrunnlag.ts";
import { findGarasjeKommunekilder } from "../../shared/garasje-kommuner.ts";
import { KPA2018_SONEKILDE } from "../../shared/arealsoner.ts";
import { ringerInneholder } from "../../shared/geometri.ts";
import { getByggetiltakSporsmaal, isByggetiltakstype, type Byggetiltak, type ByggetiltakInput, type Byggetiltakstype } from "../../shared/byggetiltak.ts";

export const GARASJE_SAK10_URL = GARASJE_NASJONALE_KRAV.kilde;
export const GARASJE_KPA_URL = findGarasjeKommunekilder(KPA2018_SONEKILDE.kommunenummer)!.kpa.bestemmelserUrl;

export function validateGarasjePunkt(input: unknown): GarasjePunkt {
  if (!isRecord(input) || Object.keys(input).some(key => !["lat", "lon"].includes(key))
    || !isNumber(input.lat) || !isNumber(input.lon)
    || input.lat <= -90 || input.lat >= 90 || input.lon < -180 || input.lon > 180) {
    throw new HttpError("Plasseringen må ha gyldig breddegrad og lengdegrad.", 400);
  }
  return { lat: input.lat, lon: input.lon };
}

const numericFields = ["bra", "bya", "gesimshoyde", "monehoyde", "etasjer"] as const;
const booleanFields = ["frittliggende", "beboelse", "kjeller", "bebygdEiendom", "overVannAvlop"] as const;
const distanceFields = ["avstandNabogrense", "avstandBygning"] as const;
const tiltakFields: readonly string[] = [...numericFields, ...booleanFields, ...distanceFields];

export function validateGarasjeTiltak(input: unknown): GarasjeTiltak {
  if (!isRecord(input) || Object.keys(input).some(key => !tiltakFields.includes(key))) {
    throw new HttpError("Tiltaket må bare inneholde de dokumenterte opplysningene om garasjen.", 400);
  }
  for (const field of numericFields) {
    if (!isNumber(input[field]) || input[field] <= 0 || input[field] > 100_000
      || (field === "etasjer" && !Number.isInteger(input[field]))) {
      throw new HttpError(`${field} må være et positivt, endelig tall${field === "etasjer" ? " uten desimaler" : ""}.`, 400);
    }
  }
  if ((input.gesimshoyde as number) > (input.monehoyde as number)) {
    throw new HttpError("Gesimshøyden kan ikke være større enn mønehøyden.", 400);
  }
  for (const field of booleanFields) {
    if (input[field] !== null && typeof input[field] !== "boolean") {
      throw new HttpError(`${field} må være true, false eller null når det er ukjent.`, 400);
    }
  }
  for (const field of distanceFields) {
    if (input[field] !== null && (!isNumber(input[field]) || input[field] < 0 || input[field] > 100_000)) {
      throw new HttpError(`${field} må være et endelig tall fra 0, eller null når avstanden er ukjent.`, 400);
    }
  }
  return Object.fromEntries(tiltakFields.map(field => [field, input[field]])) as GarasjeTiltak;
}

export function validateByggetiltak(input: unknown): GarasjeTiltak | Byggetiltak {
  if (!isRecord(input) || !Object.hasOwn(input, "tiltakstype")) return validateGarasjeTiltak(input);
  if (!isByggetiltakstype(input.tiltakstype)) {
    throw new HttpError("Velg en dokumentert tiltakstype eller ukjent.", 400);
  }
  const type = input.tiltakstype;
  const questions = getByggetiltakSporsmaal(type);
  const fields = ["tiltakstype", "tiltaksbeskrivelse", "tiltakstypeBekreftet", ...questions.map(q => q.id),
    ...(["frittliggende", "tilbygg"].includes(type) ? ["bebygdEiendom"] : [])];
  if (Object.keys(input).some(key => !fields.includes(key))) {
    throw new HttpError("Tiltaket inneholder opplysninger som ikke tilhører den bekreftede tiltakstypen.", 400);
  }
  if (typeof input.tiltaksbeskrivelse !== "string" || !input.tiltaksbeskrivelse.trim()
    || input.tiltaksbeskrivelse.length > 2000 || input.tiltakstypeBekreftet !== true) {
    throw new HttpError("Beskriv tiltaket med høyst 2000 tegn og bekreft tiltakstypen uttrykkelig.", 400);
  }
  const bebygdEiendom = input.bebygdEiendom === undefined ? null : input.bebygdEiendom;
  if (type === "frittliggende") {
    validateGarasjeTiltak({ ...Object.fromEntries(tiltakFields.map(key => [key, input[key]])), bebygdEiendom });
  } else {
    for (const field of questions) {
      const value = input[field.id];
      if (value === null) continue;
      if (field.type === "boolean" ? typeof value !== "boolean"
        : !isNumber(value) || value < field.min! || value > field.max! || (field.integer && !Number.isInteger(value))) {
        throw new HttpError(`${field.label} må besvares med ${field.type === "boolean" ? "true eller false" : "et gyldig tall"}, eller null når det er ukjent.`, 400);
      }
    }
    if (type === "tilbygg" && bebygdEiendom !== null && typeof bebygdEiendom !== "boolean") {
      throw new HttpError("bebygdEiendom må være true, false eller null.", 400);
    }
  }
  return {
    ...input, tiltaksbeskrivelse: input.tiltaksbeskrivelse.trim(),
    ...(["frittliggende", "tilbygg"].includes(type) ? { bebygdEiendom } : {}),
  } as Byggetiltak;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Om punktet ligger i flaten.
 *
 * Selve strålekastingen ligger i `apps/shared/geometri.ts`, fordi nettleseren
 * svarer på det samme spørsmålet mens markøren dras. To kopier ga forskjellig
 * svar for et punkt nøyaktig på grensen, og det var ingen som hadde bestemt.
 */
export function containsPunkt(p: GarasjePunkt, shape: Pick<GarasjePolygon, "ringer">): boolean {
  return ringerInneholder(p.lon, p.lat, shape.ringer);
}

function evaluateFrittliggende(t: GarasjeTiltak): GarasjeSjekk[] {
  const krav = GARASJE_NASJONALE_KRAV.tallkrav;
  const sjekker: GarasjeSjekk[] = [];
  function check(id: string, navn: string, value: boolean | null, forklaring: string): void {
    sjekker.push({ id, navn, status: value === null ? "uavklart" : value ? "oppfylt" : "brudd", forklaring, kilde: GARASJE_SAK10_URL, bestemmelse: "SAK10 § 4-1 første ledd bokstav a" });
  }
  check("areal", "BRA og BYA", t.bra <= krav.bra.verdi && t.bya <= krav.bya.verdi,
    `Oppgitt BRA er ${t.bra} m² og BYA er ${t.bya} m². Grensene er henholdsvis ${krav.bra.verdi} og ${krav.bya.verdi} m².`);
  check("hoyde", "Møne- og gesimshøyde", t.monehoyde <= krav.monehoyde.verdi && t.gesimshoyde <= krav.gesimshoyde.verdi,
    `Oppgitt mønehøyde er ${t.monehoyde} m og gesimshøyde er ${t.gesimshoyde} m. Grensene er ${krav.monehoyde.verdi} og ${krav.gesimshoyde.verdi} m, målt fra ferdig planert terrengs gjennomsnittsnivå.`);
  check("etasjer", "Én etasje", t.etasjer === krav.etasjer.verdi, `Du har oppgitt ${t.etasjer} etasje(r). Unntaket gjelder ${krav.etasjer.verdi} etasje.`);
  check("kjeller", "Uten kjeller", t.kjeller === null ? null : !t.kjeller,
    t.kjeller === null ? "Det er ikke avklart om bygningen får kjeller." : "Bygningen kan ikke underbygges med kjeller.");
  check("frittliggende", "Frittliggende bygning", t.frittliggende, "Dette unntaket gjelder en frittliggende bygning.");
  check("beboelse", "Ikke til beboelse", t.beboelse === null ? null : !t.beboelse,
    "Bygningen skal ikke brukes til beboelse. DIBK presiserer at den ikke kan inneholde kjøkken, stue, soverom eller våtrom.");
  check("bebygd", "Bebygd eiendom", t.bebygdEiendom, "Eiendommen må være bebygd. Kartlagte bygningsflater dokumenterer ikke alene at bebyggelsen er lovlig.");
  check("nabogrense", "Avstand til nabogrense", t.avstandNabogrense === null ? null : t.avstandNabogrense >= krav.avstandNabogrense.verdi,
    t.avstandNabogrense === null ? "Avstanden til nabogrensen er ukjent." : `Oppgitt avstand er ${t.avstandNabogrense} m. Det kreves minst ${krav.avstandNabogrense.verdi} m. Avstanden er ikke beregnet fra kartet.`);
  check("bygning", "Avstand til annen bygning", t.avstandBygning === null ? null : t.avstandBygning >= krav.avstandBygning.verdi,
    t.avstandBygning === null ? "Avstanden til annen bygning på eiendommen er ukjent." : `Oppgitt avstand er ${t.avstandBygning} m. Det kreves minst ${krav.avstandBygning.verdi} m til annen bygning på eiendommen. Avstanden er ikke beregnet fra kartet.`);
  check("vann-avlop", "Ikke over vann- og avløpsledninger", t.overVannAvlop === null ? null : !t.overVannAvlop,
    "Bygningen kan ikke plasseres over vann- og avløpsledninger. Pilotens kart kontrollerer ikke ledninger; vurderingen bygger på ditt svar.");
  return sjekker;
}

function evaluateOtherTiltak(t: Exclude<Byggetiltak, { tiltakstype: "frittliggende" }>): GarasjeSjekk[] {
  const sjekker: GarasjeSjekk[] = [];
  function check(id: string, navn: string, value: boolean | null, forklaring: string, bestemmelse: string, kilde: string = GARASJE_SAK10_URL): void {
    sjekker.push({ id, navn, status: value === null ? "uavklart" : value ? "oppfylt" : "brudd", forklaring, bestemmelse, kilde });
  }
  if (t.tiltakstype === "tilbygg") {
    const provision = "SAK10 § 4-1 første ledd bokstav b";
    check("tilbygg-areal", "BRA og BYA høyst 15 m²",
      t.bra !== null && t.bra > 15 || t.bya !== null && t.bya > 15 ? false : t.bra === null || t.bya === null ? null : true,
      `Oppgitt BRA: ${t.bra ?? "ukjent"} m². BYA: ${t.bya ?? "ukjent"} m². Ingen av arealene kan overstige 15 m² etter dette unntaket.`, provision);
    check("tilbygg-understottet", "Understøttet tilbygg", t.understottet,
      "Unntaket gjelder understøttet tilbygg, ikke påbygg eller en utkraget utvidelse.", provision);
    check("tilbygg-etasjer", "Høyst to etasjer eller plan", t.etasjer === null ? null : t.etasjer <= 2,
      `Tilbygget knytter seg til ${t.etasjer ?? "ukjent antall"} etasjer eller plan. Unntaket gjelder høyst to.`, provision);
    check("tilbygg-bruk", "Ingen endring av godkjent bruk", t.endrerBruk === null ? null : !t.endrerBruk,
      "Tilbygget kan ikke endre bygningens godkjente bruk. En garasje kan ikke utvides med soverom etter dette unntaket.", provision);
    check("tilbygg-boenhet", "Ingen ny selvstendig boenhet", t.nyBoenhet === null ? null : !t.nyBoenhet,
      "Tilbygget kan ikke opprette en ny selvstendig boenhet uten søknad.", provision);
    check("tilbygg-bebygd", "Eksisterende bebyggelse", t.bebygdEiendom,
      "Et tilbygg forutsetter en eksisterende bygning. Kartlagte bygningsflater bekrefter ikke at bygningen er lovlig.", provision);
    // The four-metre starting point has exceptions and is not the whole distance rule.
    check("tilbygg-nabogrense", "Avstand til nabogrense må avklares", null,
      `Oppgitt avstand er ${t.avstandNabogrense ?? "ukjent"} m. Utgangspunktet i pbl. § 29-4 andre ledd er minst halve bygningens høyde og minst 4 m, med mindre planen bestemmer annet. Kommunen må avklare høyde, plan og eventuell godkjenning av nærmere plassering. Garasjens 1-metersregel gjelder ikke her.`,
      "Plan- og bygningsloven § 29-4 andre og tredje ledd", "https://lovdata.no/lov/2008-06-27-71/§29-4");
  } else if (t.tiltakstype === "gjerde") {
    const provision = "SAK10 § 4-1 første ledd bokstav f nr. 3";
    check("gjerde-type", "Åpen, lett innhegning", t.aapenLett === true ? true : null,
      "Unntaket gjelder åpen, enkel og lett innhegning. Levegg, tett gjerde, støyskjerm og mur trenger en annen vurdering; et nei er ikke et vedtak om avslag.", provision);
    check("gjerde-veg", "Innhegning mot vei", t.motVeg === null ? null : true,
      t.motVeg === false
        ? "Du oppgir at gjerdet ikke er mot vei. Innhegning som ikke er mot vei er i utgangspunktet ikke søknadspliktig, men planbestemmelser og andre krav gjelder fortsatt."
        : "Innhegning mot vei omfattes av den særskilte høyde- og frisiktkontrollen.", provision);
    check("gjerde-hoyde", "Høyde mot vei", t.motVeg === null || t.hoyde === null ? null : t.motVeg ? t.hoyde <= 1.5 : true,
      `Oppgitt samlet høyde er ${t.hoyde ?? "ukjent"} m. Grensen i dette unntaket er 1,5 m for innhegning mot vei. Den er ikke en generell tillatt høyde i alle planer.`, provision);
    check("gjerde-frisikt", "Fri sikt mot vei", t.friSikt,
      "Gjerdet må ikke hindre sikten i frisiktsoner mot vei. Frisikt må også avklares ved avkjørsel og kryss.", provision);
  } else if (t.tiltakstype === "fasade") {
    const structural = t.endrerBaering === true || t.endrerBrannkrav === true;
    check("fasade-konstruksjon", "Bæring og brannsikring", structural ? false
      : t.endrerBaering === null || t.endrerBrannkrav === null ? null : true,
      structural
        ? "Du oppgir inngrep i bæring eller brannsikring. Dette kan ikke behandles som vanlig vedlikehold. Be en kvalifisert fagperson og kommunen avklare søknad, ansvar og tekniske krav."
        : "At bæring og brannsikring ikke endres må være avklart. Et ukjent svar er ikke vanlig vedlikehold.",
      "Plan- og bygningsloven § 20-1 første ledd bokstav b", "https://lovdata.no/lov/2008-06-27-71/§20-1");
    const unchanged = t.likUtforming === true && t.endrerUtseende === false && !structural
      && t.endrerBaering === false && t.endrerBrannkrav === false;
    check("fasade-karakter", "Vedlikehold eller fasadeendring", unchanged ? true : null,
      unchanged
        ? "Svarene beskriver vedlikehold med samme materialer, farge og utforming, uten endret bæring eller brannsikring. Vern og lokale planbestemmelser er likevel ikke avklart."
        : "Endrede materialer, farge eller taktekking kan endre bygningens karakter. Ikke enhver utseendeendring krever søknad. Kommunen må vurdere bygningen og dokumentert tidligere utførelse; et nøkkelord kan ikke avgjøre dette.",
      "Plan- og bygningsloven § 20-5 første ledd bokstav f", "https://lovdata.no/lov/2008-06-27-71/§20-5");
  } else {
    check("tiltakstype", "Tiltakstypen er uavklart", null,
      "Beskrivelsen passer ikke sikkert i de kontrollerte tiltakstypene. Kommunens byggesaksveiledning må avklare riktig regel før mål eller søknadsplikt kan vurderes.",
      "Plan- og bygningsloven §§ 20-1 og 20-5", "https://lovdata.no/lov/2008-06-27-71/§20-1");
  }
  return sjekker;
}

export function getByggetiltakPlanvarsler(tiltakstype: Byggetiltakstype, grunnlag: GarasjeGrunnlag): GarasjeSjekk[] {
  if (!isByggetiltakstype(tiltakstype)) {
    throw new HttpError("Velg en dokumentert tiltakstype eller ukjent.", 400);
  }
  const formaalsflater = grunnlag.planflater.filter(f => f.kategori === "arealformaal");
  const kommunekilder = findGarasjeKommunekilder(grunnlag.adresse.kommunenummer);
  const bestemmelseskilde = kommunekilder?.kpa.bestemmelserUrl || GARASJE_SAK10_URL;
  const lnf = grunnlag.adresse.kommunenummer === KPA2018_SONEKILDE.kommunenummer
    && grunnlag.kilder.some(k => k.id === "kpa" && k.status === "ok")
    && grunnlag.arealformaal.some(formaal => formaal.kode === 5100 && formaal.planId === KPA2018_SONEKILDE.planId);
  const sjekker: GarasjeSjekk[] = [{
    id: "kommuneplan", navn: "Kommuneplan og LNF", status: "uavklart", kilde: bestemmelseskilde,
    ...(lnf ? { bestemmelse: "Bergen KPA2018 § 31.3, plan 65270000" } : {}),
    forklaring: (lnf
      ? "Punktet ligger i LNF. KPA2018 § 31.3 omtaler små tiltak på fradelt og bebygd boligeiendom uten negativ påvirkning på LNF-verdiene. Retningslinjene stiller flere vilkår. Fradeling, lovlig boligbruk, tiltakets størrelse og virkningen på LNF-verdiene er ikke avklart av kartet. En avstand på 1 m til nabogrensen er ikke tilstrekkelig. Be kommunen vurdere alle vilkårene og om dispensasjon er nødvendig. Dette er ikke et generelt fritak fra søknad eller dispensasjon."
      : "Et arealformål alene avgjør ikke om tiltaket er tillatt. KPA-bestemmelser, byggegrenser og utnyttelsesgrad er ikke kontrollert.")
      // Punktoppslaget over svarer for ett punkt. Flatene fra uttrekket svarer for
      // hele teigen, og et formål som bare dekker deler av eiendommen er nettopp
      // det innbyggeren ikke ser når svaret gjelder ett punkt. Det hører i denne
      // sjekken og ikke i en egen: det er det samme forholdet, sett bredere.
      + (formaalsflater.length
        ? ` Målt mot hele den kartlagte eiendommen berører den ${formaalsflater.map(f =>
            `${f.navn}${f.berorer === "helt" ? " over hele eiendommen" : " over deler av eiendommen"}`).join(", ")}`
          + ". Deler eiendommen seg mellom flere formål, gjelder ikke nødvendigvis det samme for hele tiltaket som for skissepunktet."
        : ""),
  }, {
    id: "reguleringsplan", navn: "Reguleringsplanens bestemmelser", status: "uavklart",
    kilde: grunnlag.reguleringsplaner[0]?.url ?? bestemmelseskilde,
    forklaring: grunnlag.reguleringsplaner.length
      ? "Planområder er funnet. De særskilt navngitte bestemmelsene nedenfor er avgrensede kontroller. Øvrige bestemmelser om plassering og tillatt utnyttelse er ikke lest eller kontrollert."
      : "Ingen funnet reguleringsplan er ikke bevis på at tiltaket er avklart. Kildestatus og øvrige plangrunnlag må kontrolleres.",
  }];
  const gjerdeplan = grunnlag.adresse.kommunenummer === "4601"
    && grunnlag.kilder.some(k => k.id === "reguleringsplan" && k.status === "ok")
    ? grunnlag.reguleringsplaner.find(plan => plan.planId === "6170063") : undefined;
  if (tiltakstype === "gjerde" && gjerdeplan) {
    sjekker.push({
      id: "gjerde-plan-6170063", navn: "Gjerdet må avklares med kommunen", status: "uavklart",
      kilde: gjerdeplan.url, bestemmelse: "Reguleringsplan 6170063 § 7 bokstav d",
      forklaring: "Planoppslaget treffer plan 6170063. § 7 bokstav d krever kommunal godkjenning av gjerdets utførelse, høyde og farge og angir høyst 0,9 m inkludert sokkel. "
        + "Grensen på 1,5 m i SAK10 erstatter ikke planbestemmelsen. Be kommunen bekrefte gjeldende plan, bestemmelsens anvendelse og riktig godkjennings- eller dispensasjonsløp. Krav om godkjenning er ikke i seg selv et avslag eller en automatisk konklusjon om byggesøknad.",
    });
  }
  return sjekker;
}

export function evaluateGarasje(tiltak: GarasjeTiltak | ByggetiltakInput, grunnlag: GarasjeGrunnlag): GarasjeVurdering {
  const t = validateByggetiltak(tiltak);
  const tiltakstype = "tiltakstype" in t ? t.tiltakstype : "frittliggende";
  const sjekker = !("tiltakstype" in t) || t.tiltakstype === "frittliggende"
    ? evaluateFrittliggende(t) : evaluateOtherTiltak(t);
  const nasjonaltUnntak = sjekker.some(s => s.status === "brudd") ? "brudd"
    : sjekker.some(s => s.status === "uavklart") ? "uavklart" : "oppfylt";
  const eiendomskilde = grunnlag.kilder.find(k => k.id === "eiendomsgrenser");
  const hasEiendomsgrense = eiendomskilde?.status === "ok" && grunnlag.eiendomsgrenser.length > 0;
  const punktPaaEiendom = hasEiendomsgrense
    ? grunnlag.eiendomsgrenser.some(shape => containsPunkt(grunnlag.punkt, shape)) : null;
  sjekker.push({
    id: "plassering", navn: "Skissepunkt på valgt eiendom",
    status: punktPaaEiendom === null ? "uavklart" : punktPaaEiendom ? "oppfylt" : "brudd",
    kilde: eiendomskilde?.url ?? "https://kart.bergen.kommune.no/arcgis/rest/services/Basis_kartdata/Eiendommer/MapServer/3",
    forklaring: punktPaaEiendom === null
      ? "Eiendomsflaten mangler eller kunne ikke hentes. Det er ukjent om skissepunktet ligger på valgt eiendom."
      : punktPaaEiendom
        ? `Skissepunktet ligger på den kartlagte eiendomsteigen ved adressen. Dette sier ikke at hele ${"tiltakstype" in t ? "tiltaket" : "garasjen"} ligger på eiendommen eller oppfyller avstandskrav. Et adressepunkt er heller ikke en bekreftet plassering for tiltaket.`
        : "Skissepunktet ligger utenfor den kartlagte eiendomsteigen ved valgt adresse. Flytt punktet eller avklar eiendomsgrensen. Dette er ikke en vurdering av søknadsplikt eller byggetillatelse på en annen eiendom.",
  });
  const plankilde = grunnlag.kilder.find(k => k.id === "planflater");
  const hensynssoner = grunnlag.planflater.filter(f => f.kategori === "hensynssone");
  const navngi = (f: typeof hensynssoner[number]) =>
    `${f.navn}${f.sonenavn ? ` ${f.sonenavn}` : ""}${f.kildetekst ? ` (${f.kildetekst})` : ""}`
    + `, som ${f.berorer === "helt" ? "dekker hele den kartlagte eiendommen" : "berører deler av den kartlagte eiendommen"}`
    + `. Skissepunktet ligger ${containsPunkt(grunnlag.punkt, f) ? "inne i" : "utenfor"} sonen.`;
  const bestemmelseskilde = findGarasjeKommunekilder(grunnlag.adresse.kommunenummer)?.kpa.bestemmelserUrl || GARASJE_SAK10_URL;
  const planvarsler = getByggetiltakPlanvarsler(tiltakstype, grunnlag);
  sjekker.push(...planvarsler);
  const gjerdeplan = planvarsler.find(sjekk => sjekk.id === "gjerde-plan-6170063");
  if ("tiltakstype" in t && t.tiltakstype === "gjerde" && gjerdeplan) {
    sjekker.push({
      ...gjerdeplan, id: "gjerde-plan-6170063-hoyde", navn: "Oppgitt gjerdehøyde mot plangrensen",
      forklaring: `Oppgitt høyde er ${t.hoyde ?? "ukjent"} m. `
        + (t.hoyde !== null && t.hoyde > 0.9 ? "Oppgitt høyde overstiger plangrensen på 0,9 m inkludert sokkel. " : "")
        + "Kommunens godkjenning og bestemmelsens anvendelse må fortsatt avklares.",
    });
  }
  if ("tiltakstype" in t && t.tiltakstype === "tilbygg") {
    sjekker.push({
      id: "tilbygg-ledninger", navn: "Ledninger og byggegrunn", status: "uavklart",
      kilde: "https://lovdata.no/lov/2008-06-27-71/§28-1", bestemmelse: "Plan- og bygningsloven § 28-1",
      forklaring: `Du oppgir ${t.overVannAvlop === null ? "at det er ukjent om tilbygget er" : t.overVannAvlop ? "plassering" : "ingen plassering"} over vann- eller avløpsledninger. Avklar ledninger, sikker byggegrunn og lokale avstandskrav med kommunen eller ledningseieren. Dette er ikke garasjens særskilte ledningsvilkår.`,
    });
  }
  // Sonen er alltid uavklart. En hensynssone hjemlet i plan- og bygningsloven
  // § 11-8 sier at et hensyn gjelder for området, ikke om et tiltak er tillatt -
  // det står i planbestemmelsene, som piloten ikke leser. Sjekken står dessuten
  // etter at nasjonaltUnntak er regnet ut, så den kan ikke endre utfallet.
  sjekker.push({
    id: "hensynssoner", navn: "Hensynssoner i kommuneplanen", status: "uavklart",
    kilde: plankilde?.url ?? bestemmelseskilde,
    forklaring: plankilde?.status !== "ok" && plankilde?.status !== "ingen_treff"
      ? "Hensynssonene kunne ikke hentes. Det er ukjent om eiendommen berøres av en hensynssone."
      : hensynssoner.length
        ? `Eiendomsgrensen berører ${hensynssoner.length === 1 ? "én hensynssone" : `${hensynssoner.length} hensynssoner`} i KPA2018: `
          + `${hensynssoner.map(navngi).join(" ")} Sonen sier at et hensyn gjelder for området, ikke om tiltaket er tillatt. `
          + "Uttrekket er fra 2018; gjeldende plan og bestemmelser må leses."
        : "Ingen hensynssone i KPA2018-uttrekket berører den kartlagte eiendommen. Uttrekket er fra 2018 og dekker ikke byggegrenser, "
          + "reguleringsplanens egne soner eller forhold utenfor kommuneplanen.",
  });
  for (const id of ["adresse", "kpa", "reguleringsplan", "eiendomsgrenser", "bygninger", "planflater"]) {
    const kilde = grunnlag.kilder.find(k => k.id === id);
    if (!kilde || (kilde.status !== "ok" && !(id === "reguleringsplan" && kilde.status === "ingen_treff"))) {
      sjekker.push({
        id: `kilde-${id}`, navn: `Datagrunnlag: ${kilde?.navn ?? id}`, status: "uavklart",
        forklaring: kilde?.merknad ?? "Datagrunnlaget mangler eller er ikke avklart.", kilde: kilde?.url ?? GARASJE_KPA_URL,
      });
    }
  }
  const uavklarteForhold = [...new Set([
    ...grunnlag.uavklarteForhold,
    "Gjeldende planbestemmelser, byggegrenser og tillatt utnyttelse må avklares for hele tiltaket. Hensynssonene er navngitt fra et frosset KPA2018-uttrekk, ikke lest ut av bestemmelsene.",
    "Ledningskart, flom, skred, grunnforhold, kulturminner, naturverdier og avstand til vei, sjø og vassdrag er ikke kontrollert.",
    "Kartet viser et punkt, ikke tiltakets utstrekning. Grensekvalitet, mål og lovlig etablert bebyggelse er ikke bekreftet.",
    ...sjekker.filter(s => s.status === "uavklart").map(s => s.forklaring),
  ])];
  // National thresholds alone cannot establish compliance with local plans.
  return {
    tiltakstype,
    utfall: nasjonaltUnntak === "brudd" ? "soknadspliktig" : "maa_avklares",
    nasjonaltUnntak, sjekker, uavklarteForhold,
    forklaring: nasjonaltUnntak === "brudd"
      ? "Opplysningene oppfyller ikke det kontrollerte nasjonale unntaket for denne tiltakstypen. Tiltaket må som utgangspunkt omsøkes eller endres. Eventuelle andre unntak må avklares med kommunen. Dette betyr ikke at tiltaket er forbudt eller at en søknad blir avslått. Dette er ikke et vedtak."
      : punktPaaEiendom === false
        ? "Skissepunktet ligger utenfor valgt eiendom. Plasseringen må endres eller avklares før kontrollen kan brukes videre. Punktet sier ikke noe om hele tiltakets utstrekning."
        : nasjonaltUnntak === "oppfylt"
          ? "Opplysningene oppfyller de kontrollerte nasjonale vilkårene, men planforhold og andre krav er ikke avklart. Piloten kan ikke konkludere med at du kan bygge uten søknad."
          : "Det mangler opplysninger om nasjonale vilkår, og planforhold og andre krav må avklares før søknadsplikten kan avgjøres. Uavklart er ikke det samme som forbudt.",
    nesteSteg: [
      "Send kommunen tiltakets beskrivelse, adresse, gårds- og bruksnummer, skisse, mål og de navngitte planbestemmelsene. Be om avklaring av søknadsplikt og eventuelt behov for dispensasjon.",
      ...(tiltakstype === "fasade" ? ["Legg ved bilder av dagens fasade eller tak og beskrivelse av nye materialer, farge og konstruksjon. Be kommunens byggesaksveiledning og en kvalifisert fagperson avklare karakterendring, vern, bæring og brannsikring."] : []),
      ...(gjerdeplan && tiltakstype === "gjerde" ? ["Be kommunen avklare godkjenning av gjerdets utførelse, høyde og farge etter plan 6170063 § 7 bokstav d. Legg ved samlet høyde inkludert sokkel og dokumentasjon på frisikt."] : []),
    ],
  };
}
