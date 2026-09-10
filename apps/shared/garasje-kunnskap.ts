import { GARASJE_BEGREPER } from "./garasje-begreper.ts";
import { GARASJE_NASJONALE_KRAV } from "./garasje-regelgrunnlag.ts";
import { listGarasjeSonetyper } from "./arealsoner.ts";
import { GARASJE_UTFALL } from "./garasje.ts";
import { GARASJE_KOMMUNER, findGarasjeKommunekilder } from "./garasje-kommuner.ts";
import { BYGGETILTAK_KATALOG, isByggetiltakstype } from "./byggetiltak.ts";
import { isPolygon, ringerInneholder } from "./geometri.ts";
import { findHensynssone } from "./hensynssoner.ts";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Compute point overlap before dropping geometry; re-projecting preserves that fact and coverage. */
export function projectGarasjePlanflater(value: unknown) {
  const input = record(value);
  const rows = Array.isArray(input.planflater) ? input.planflater : [];
  const source = record((Array.isArray(input.kilder) ? input.kilder.find(item => record(item).id === "planflater") : undefined)
    ?? input.planflatekilde);
  const status = ["ok", "ingen_treff", "feil", "ikke_sjekket"].includes(String(source.status))
    ? String(source.status) : "ikke_sjekket";
  const available = status === "ok" || status === "ingen_treff";
  const point = record(input.punkt);
  const hasPoint = typeof point.lon === "number" && Number.isFinite(point.lon) && Math.abs(point.lon) <= 180
    && typeof point.lat === "number" && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90;
  const text = (value: unknown, max: number) => typeof value === "string" ? value.slice(0, max) : null;
  const projected = rows.map(item => {
    const row = record(item);
    const code = typeof row.sonekode === "number" && Number.isSafeInteger(row.sonekode) && row.sonekode >= 0 ? row.sonekode : null;
    const kategori = row.kategori === "hensynssone" || row.kategori === "arealformaal" ? row.kategori : "ukjent";
    let punktIFlate: boolean | null = null;
    if (available) {
      if (Object.hasOwn(row, "ringer")) {
        if (hasPoint && isPolygon(row.ringer)) punktIFlate = ringerInneholder(Number(point.lon), Number(point.lat), row.ringer);
      } else if (typeof row.punktIFlate === "boolean") punktIFlate = row.punktIFlate;
    }
    return {
      kategori, datasett: text(row.datasett, 40), sonekode: code,
      hensynstype: kategori === "hensynssone" && code !== null ? findHensynssone(code)?.type ?? null : null,
      sonenavn: text(row.sonenavn, 80), navn: text(row.navn, 120),
      beskrivelse: text(row.beskrivelse, 240), kildetekst: text(row.kildetekst, 200),
      planId: typeof row.planId === "string" && /^[a-zA-Z0-9_-]{1,40}$/.test(row.planId) ? row.planId : null,
      arealstatus: typeof row.arealstatus === "number" && Number.isSafeInteger(row.arealstatus) ? row.arealstatus : null,
      berorer: row.berorer === "helt" || row.berorer === "delvis" ? row.berorer : "ukjent",
      punktIFlate,
      forkortet: row.forkortet === true || ([["datasett", 40], ["sonenavn", 80], ["navn", 120], ["beskrivelse", 240], ["kildetekst", 200]] as const)
        .some(([key, limit]) => typeof row[key] === "string" && row[key].length > limit)
    };
  });
  const selected: typeof projected = [];
  const types = new Set<string>();
  const prioritized = [...projected].sort((a, b) => Number(b.punktIFlate === true) - Number(a.punktIFlate === true));
  // Preserve different zone types before taking several pieces of the same zone.
  for (const row of prioritized) {
    const key = `${row.planId}:${row.kategori}:${row.sonekode}`;
    if (selected.length < 8 && !types.has(key)) { selected.push(row); types.add(key); }
  }
  for (const row of prioritized) if (selected.length < 8 && !selected.includes(row)) selected.push(row);
  const previous = record(input.planflatedekning);
  const total = typeof previous.antall === "number" && Number.isSafeInteger(previous.antall)
    ? Math.max(rows.length, previous.antall) : rows.length;
  const warnings: string[] = [];
  if (!available) warnings.push("Plankilden er ikke tilgjengelig. En tom liste betyr ikke at eiendommen er uten hensynssoner eller arealbegrensninger.");
  if (total > selected.length) warnings.push(`Viser ${selected.length} av ${total} planflater. Øvrige flater er utelatt fra forklaringsgrunnlaget.`);
  if (selected.some(row => row.punktIFlate === null)) warnings.push("Punktets forhold til én eller flere soner er ukjent.");
  if (selected.some(row => row.kategori === "ukjent")) warnings.push("Én eller flere planflater har ukjent kategori.");
  const sourceTruncated = source.forkortet === true || typeof source.merknad === "string" && source.merknad.length > 400;
  if (sourceTruncated || selected.some(row => row.forkortet)) warnings.push("Noe av kildeteksten er forkortet. Les hele kilden før vilkår vurderes.");
  return {
    planflater: selected,
    planflatekilde: { id: "planflater", status, navn: text(source.navn, 150), merknad: text(source.merknad, 400),
      uttrekksaar: typeof source.uttrekksaar === "number" && Number.isSafeInteger(source.uttrekksaar) ? source.uttrekksaar : null,
      forkortet: sourceTruncated },
    planflatedekning: { antall: total, vist: selected.length, utelatt: total - selected.length,
      advarsel: warnings.length ? warnings.join(" ") : null },
    planflateavgrensning: "Overlapp beskriver den kartlagte eiendommen. Punktkontrollen gjelder bare grunnlagets skissepunkt, ikke hele tiltaket. Utenfor en sone betyr ikke at hele tiltaket er utenfor. Soner og kildeuttrekk er ikke en kontroll av gjeldende planbestemmelser eller en byggetillatelse."
  };
}

export function projectGarasjeDokumentkunnskap(value: unknown) {
  if (!Array.isArray(value)) return [];
  const text = (value: unknown, limit: number) => typeof value === "string" ? value.slice(0, limit) : undefined;
  return value.filter(item => typeof record(item).text === "string").slice(0, 3).map(item => {
    const hit = record(item);
    const page = typeof hit.page === "number" && Number.isInteger(hit.page) && hit.page > 0 ? hit.page : undefined;
    const documentId = text(hit.documentId, 200);
    const canonicalUrl = typeof hit.canonicalUrl === "string" && /^https?:\/\/[^\s]+$/.test(hit.canonicalUrl)
      ? hit.canonicalUrl.slice(0, 1000) : undefined;
    const truncated = String(hit.text).length > 1800 || hit.truncated === true;
    const qualityWarnings = Array.isArray(hit.qualityWarnings)
      ? hit.qualityWarnings.filter((warning): warning is string => typeof warning === "string").slice(0, 6).map(warning => warning.slice(0, 300)) : [];
    if (!documentId || !page || !canonicalUrl) qualityWarnings.push("Dokument, side eller kildeadresse mangler.");
    if (truncated) qualityWarnings.push("Utdraget er forkortet; hele bestemmelsen må leses.");
    return {
      documentId, chunkId: text(hit.chunkId, 200), title: text(hit.title, 200), page, canonicalUrl,
      sourceSha256: text(hit.sourceSha256, 64), authority: text(hit.authority, 50),
      text: text(hit.text, 1800), knowledgeStatus: text(hit.knowledgeStatus, 50),
      ruleIds: Array.isArray(hit.ruleIds) ? hit.ruleIds.filter((id): id is string => typeof id === "string").slice(0, 8).map(id => id.slice(0, 100)) : [],
      checkRecommended: true,
      scopeVerified: false,
      truncated, qualityWarnings: [...new Set(qualityWarnings)]
    };
  });
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
  const prosjekt = projectGarasjeProsjekt(input.prosjekt);
  if (typeof vurdering.tiltakstype === "string"
    && BYGGETILTAK_KATALOG.some(entry => entry.id === vurdering.tiltakstype)) {
    prosjekt.tiltakstype = vurdering.tiltakstype;
  }
  const requestedType = vurdering.tiltakstype ?? record(input.prosjekt).tiltakstype;
  if (requestedType !== undefined && !isByggetiltakstype(requestedType)) prosjekt.tiltakstype = "ukjent";
  const tiltak = BYGGETILTAK_KATALOG.find(entry => entry.id === prosjekt.tiltakstype);
  const frittliggende = prosjekt.tiltakstype === undefined || prosjekt.tiltakstype === "frittliggende";
  const relevantFields = new Set(tiltak?.sporsmaal.map(field => field.id));
  if (!frittliggende) {
    for (const key of Object.keys(prosjekt)) {
      if (key !== "tiltakstype" && !relevantFields.has(key)) delete prosjekt[key];
    }
  }
  const value = (input: unknown) => typeof input === "number" && Number.isFinite(input) && input >= 0 ? input : null;
  return {
    begreper: frittliggende ? GARASJE_BEGREPER : GARASJE_BEGREPER.filter(begrep => relevantFields.has(begrep.id)),
    nasjonaleKrav: frittliggende ? GARASJE_NASJONALE_KRAV : null,
    nasjonaleKravGjelderTiltakstype: frittliggende ? "frittliggende" : null,
    tiltak: tiltak ? {
      id: tiltak.id, navn: tiltak.navn, beskrivelse: tiltak.beskrivelse,
      kilde: GARASJE_NASJONALE_KRAV.kilde,
      regelgrenser: frittliggende ? "Se nasjonaleKrav."
        : "Ingen egne kildebekreftede tallgrenser er lagt inn i dette forklaringsgrunnlaget. Bruk den deterministiske vurderingen, relevant DIBK-veiledning og kommunens byggesaksveileder."
    } : null,
    kommunenummer,
    kommunaleOppsett: Object.values(GARASJE_KOMMUNER).map(kommune => ({
      kommunenummer: kommune.kommunenummer, navn: kommune.navn,
      planId: kommune.kpa.planId, versjon: kommune.kpa.versjon,
      bestemmelserUrl: kommune.kpa.bestemmelserUrl
    })),
    sonetyper: listGarasjeSonetyper(),
    kildeTilPlanbestemmelser: kommune?.kpa.bestemmelserUrl ?? null,
    planbestemmelserKontrollert: false,
    ...projectGarasjePlanflater(grunnlag),
    reguleringsplaner: Array.isArray(grunnlag.reguleringsplaner) ? grunnlag.reguleringsplaner.slice(0, 8).map(item => {
      const plan = record(item);
      return {
        planId: typeof plan.planId === "string" && /^[a-zA-Z0-9_-]{1,40}$/.test(plan.planId) ? plan.planId : null,
        navn: typeof plan.navn === "string" ? plan.navn.slice(0, 150) : null
      };
    }) : [],
    dokumentkunnskap: projectGarasjeDokumentkunnskap(input.dokumentkunnskap),
    kunnskapsadvarsel: typeof input.kunnskapsadvarsel === "string" ? input.kunnskapsadvarsel.slice(0, 600) : undefined,
    prosjekt,
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

export function projectGarasjeProsjekt(value: unknown): Record<string, number | boolean | string | null> {
  const input = record(value);
  const output: Record<string, number | boolean | string | null> = {};
  for (const key of ["bya", "bra", "gesimshoyde", "monehoyde", "hoyde", "etasjer", "avstandNabogrense", "avstandBygning"]) {
    if (input[key] === null || (typeof input[key] === "number" && Number.isFinite(input[key]) && input[key] >= 0 && input[key] <= 100000)) output[key] = input[key] as number | null;
  }
  for (const key of ["frittliggende", "beboelse", "kjeller", "overVannAvlop", "aapenLett", "endrerBaering", "endrerBrannkrav", "endrerBruk", "endrerUtseende", "friSikt", "likUtforming", "motVeg", "nyBoenhet", "understottet"]) {
    if (input[key] === null || typeof input[key] === "boolean") output[key] = input[key] as boolean | null;
  }
  for (const key of ["tiltakstype", "tiltaksvalg"]) {
    if (typeof input[key] === "string" && /^[a-z_-]{1,50}$/.test(input[key])) output[key] = input[key];
  }
  return output;
}
