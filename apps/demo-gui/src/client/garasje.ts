import {
  beskrivGarasjeUtfall, hensynssonenavn,
  type GarasjeAdresse, type GarasjeGrunnlag, type GarasjePlanflate, type GarasjePolygon,
  type GarasjePunkt, type GarasjeTiltak, type GarasjeVurdering
} from "../../../shared/garasje.ts";
import type { Hensynssonetype } from "../../../shared/hensynssoner.ts";
import { findNabotomtLabel, fitKartutsnitt, nearestPolygonBoundary, projectGarasjePunkt, unprojectGarasjePunkt, type KartLabel } from "./garasje-kart.ts";
import { ringerInneholder } from "../../../shared/geometri.ts";
import { createGarasjeUtfylling, type GarasjeDialogReply } from "./garasje-utfylling.ts";
import { projectGarasjeDialogGrunnlag } from "../../../shared/garasje-dialog.ts";
import { BYGGETILTAK_TYPER, BYGGETILTAK_KATALOG, classifyByggetiltak, getByggetiltakFelter, type Byggetiltakstype } from "../../../shared/byggetiltak.ts";
import { createTiltaksvalg } from "./garasje-tiltak.ts";
import { renderTiltaksraad, type Tiltaksraad } from "./garasje-raad.ts";

type GarasjeSvar = { grunnlag: GarasjeGrunnlag; vurdering: GarasjeVurdering; sporingsId: string; raad?: Tiltaksraad };
type Innbygger = Person & {
  skjermet: boolean;
  bostedsadresse?: {
    adressenavn?: string; husnummer?: number; husbokstav?: string;
    kommunenummer?: string; postnummer?: string; poststed?: string;
  } | null;
};
type Adressevalg = { tekst: string; kommune?: string; gnr?: number; bnr?: number; kilde: string };

let backendBase = "";
let idportenBase = "";
let agentBase = "";
let utfylling: ReturnType<typeof createGarasjeUtfylling> | undefined;
const pageParams = new URLSearchParams(location.search);
const embedded = pageParams.has("integrert");
const embeddedOektId = pageParams.get("oektsId");
const embeddedStegId = pageParams.get("stegId");
let embeddedOekt: Prosessoekt | null = null;
let pendingSave = false;
let tiltakstype: Byggetiltakstype = "frittliggende";
let tiltaksbeskrivelse = "";
let tiltakstypeBekreftet = false;
let tiltaksvalg: ReturnType<typeof createTiltaksvalg<Byggetiltakstype>> | undefined;
const measureDrafts = new Map<Byggetiltakstype, Record<string, string>>();
const helpHistory: { rolle: string; tekst: string }[] = [];
let helpFieldId: string | null = null;
let busy = false;
let propertyConfirmed = false;
let propertyVersion = 0;
let placementChosen = false;
let placementConfirmed = false;
let valgtAdresse: GarasjeAdresse | null = null;
let plassering: GarasjePunkt | null = null;
let grunnlag: GarasjeGrunnlag | null = null;
let kartgrunnlag: GarasjeGrunnlag | null = null;
// Planflatene hører til eiendommen og ikke til punktet, så de blir stående når
// markøren flyttes og plangrunnlaget for punktet forkastes. Bare svaret på om
// punktet ligger inne i en flate regnes om, og serveren bekrefter det etterpå.
let planflater: GarasjePlanflate[] = [];
let plankilde: GarasjeGrunnlag["kilder"][number] | undefined;
let vurdering: GarasjeSvar | null = null;
let adressevalg: Adressevalg[] = [];
let bounds = { west: 0, east: 0, south: 0, north: 0 };
const svg = document.querySelector<SVGSVGElement>("#placement-map")!;
const searchInput = krevEl<HTMLInputElement>("address-search");
const myAddress = krevEl<HTMLSelectElement>("my-address");
const form = krevEl<HTMLFormElement>("garage-form");

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}

function expireLogin(): never {
  logOut();
  valgtAdresse = null;
  plassering = null;
  grunnlag = null;
  clearConfirmation();
  krevEl("workspace").hidden = true;
  krevEl("property-workspace").hidden = true;
  krevEl("property-facts").hidden = true;
  krevEl("logged-in").textContent = "";
  krevEl("logout").hidden = true;
  krevEl("login-panel").hidden = false;
  throw new Error("Innloggingen er utløpt eller ugyldig. Logg inn igjen for å fortsette.");
}

async function api<T>(path: string): Promise<T> {
  if (!tokenValid()) expireLogin();
  const response = await fetch(`${backendBase}${path}`, {
    headers: withToken(), signal: AbortSignal.timeout(60000), cache: "no-store"
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) expireLogin();
    throw new Error(data.feil || `Oppslaget feilet (HTTP ${response.status}).`);
  }
  return data as T;
}

function invalidateResult(): void {
  vurdering = null;
  krevEl("assessment").hidden = true;
}

function renderPropertySteps(): void {
  krevEl("property-controls").hidden = propertyConfirmed;
  krevEl("edit-property").hidden = !propertyConfirmed;
  krevEl("placement-step").hidden = placementConfirmed;
  krevEl("placement-summary").hidden = !placementConfirmed;
  krevEl("garage-step").hidden = !placementConfirmed || !tiltakstypeBekreftet;
  form.hidden = !placementConfirmed || !tiltakstypeBekreftet;
}

function clearConfirmation(): void {
  utfylling?.cancel();
  propertyConfirmed = false;
  propertyVersion++;
  placementChosen = false;
  placementConfirmed = false;
  grunnlag = null;
  kartgrunnlag = null;
  planflater = [];
  plankilde = undefined;
  krevEl("property-workspace").hidden = true;
  krevEl("plan-facts").replaceChildren();
  krevEl("measure-plan-notices").replaceChildren();
  krevEl("sources").replaceChildren();
  svg.querySelector("#map-image")!.removeAttribute("href");
  krevEl("building-status").textContent = "";
  krevEl("neighbour-status").textContent = "";
  renderPropertySteps();
  krevEl("confirm-property").hidden = true;
  krevEl("confirm-note").textContent = "";
  invalidateResult();
}

/**
 * Hva som står i statuslinjen mens et kartoppslag drar ut, og etter hvor lenge.
 *
 * Kommunens kartlag svarer nesten alltid på et øyeblikk, men har en hale på flere
 * sekunder, og serveren prøver da en gang til. Uten disse setningene sto den
 * første etiketten helt stille i opptil tolv sekunder, og det ser ut som om siden
 * har hengt seg opp. Tekstene sier hva som skjer og hos hvem, slik at ventingen er
 * noe man kan forstå framfor noe man må tolke.
 */
const VENTEMELDINGER: readonly { etter: number; tekst: string }[] = [
  { etter: 2500, tekst: "Henter fortsatt kart og planer fra kommunen. Dette tar av og til noen sekunder." },
  { etter: 6000, tekst: "Kommunens kartlag svarer tregt akkurat nå, og vi prøver en gang til. Du trenger ikke gjøre noe." },
  { etter: 13000, tekst: "Kartlaget svarte ikke i tid. Vi gjør ferdig vurderingen med de kildene som svarte, og sier hva som mangler." },
];

async function perform(label: string, action: () => Promise<void>): Promise<void> {
  if (busy || pendingSave) return;
  busy = true;
  tiltaksvalg?.refresh();
  krevEl("error").hidden = true;
  krevEl("progress").textContent = label;
  const ventetimere = VENTEMELDINGER.map(melding =>
    setTimeout(() => { krevEl("progress").textContent = melding.tekst; }, melding.etter));
  const controls = document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>(
    "button, #workspace input, #workspace select"
  );
  controls.forEach(control => { control.disabled = true; });
  try {
    await action();
    krevEl("progress").textContent = "";
  } catch (error) {
    krevEl("error").textContent = feilmelding(error);
    krevEl("error").hidden = false;
    krevEl("progress").textContent = "Kunne ikke fullføre. Kontroller meldingen og prøv igjen.";
  } finally {
    for (const timer of ventetimere) clearTimeout(timer);
    controls.forEach(control => { control.disabled = pendingSave; });
    busy = false;
    tiltaksvalg?.refresh();
    utfylling?.refresh();
  }
}

function addLink(parent: HTMLElement, label: string, url: string): void {
  if (!url) {
    parent.append(element("span", `${label} (ingen kilde koblet til kommunen)`));
    return;
  }
  const target = new URL(url);
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    parent.append(element("span", `${label} (ugyldig kildelenke)`));
    return;
  }
  const link = element("a", label, "ds-link");
  link.href = target.href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  parent.append(link);
}

function selectedQuery(): URLSearchParams {
  if (!valgtAdresse || !plassering) throw new Error("Velg en eiendom først.");
  const query = new URLSearchParams({
    adresse: valgtAdresse.adressetekst,
    kommunenummer: valgtAdresse.kommunenummer,
    gnr: String(valgtAdresse.gardsnummer), bnr: String(valgtAdresse.bruksnummer),
    lat: String(plassering.lat), lon: String(plassering.lon)
  });
  if (tiltakstypeBekreftet) query.set("tiltakstype", tiltakstype);
  return query;
}

async function searchAdresse(tekst: string, kommunenummer?: string): Promise<void> {
  clearConfirmation();
  valgtAdresse = null;
  plassering = null;
  grunnlag = null;
  krevEl("property-workspace").hidden = true;
  krevEl("property-facts").hidden = true;
  const results = krevEl("address-results");
  results.replaceChildren();
  searchInput.value = tekst;
  const search = new URLSearchParams({ sok: tekst });
  if (kommunenummer) search.set("kommunenummer", kommunenummer);
  const treff = await api<GarasjeAdresse[]>(`/api/garasje/adresser?${search}`);
  if (!treff.length) {
    results.append(element("p", "Ingen adresser funnet. Kontroller gatenavn, husnummer og kommune. Syntetiske bostedsadresser finnes ikke alltid i det offentlige registeret.", "ds-paragraph"));
  } else if (treff.length === 1) {
    await selectAdresse(treff[0]);
  } else {
    results.append(element("p", "Velg riktig adresse. Vi velger ikke første treff for deg.", "ds-paragraph"));
    for (const adresse of treff) {
      const button = element("button", `${adresse.adressetekst} · kommune ${adresse.kommunenummer} · ${adresse.gardsnummer}/${adresse.bruksnummer}`, "ds-button");
      button.type = "button";
      button.dataset.variant = "secondary";
      button.addEventListener("click", () => void perform("Velger eiendom …", () => selectAdresse(adresse)));
      results.append(button);
    }
  }
}

async function selectAdresse(adresse: GarasjeAdresse): Promise<void> {
  clearConfirmation();
  valgtAdresse = adresse;
  plassering = { ...adresse.punkt };
  placementChosen = false;
  krevEl("address-results").replaceChildren();
  const facts = krevEl("property-facts");
  facts.replaceChildren();
  facts.append(element("h3", adresse.adressetekst, "ds-heading"));
  facts.append(element("p", formatEiendomsdetaljer(adresse), "ds-paragraph"));
  facts.append(element("p", "Identifisert i det offentlige adresseregisteret. Eierskapet i sandkassen er syntetisk og sier ikke hvem som eier eiendommen i virkeligheten.", "ds-paragraph muted"));
  facts.hidden = false;
  bounds = fitKartutsnitt([], adresse.punkt);
  krevEl("confirm-property").hidden = false;
  krevEl("confirm-property").textContent = "Bekreft eiendom";
  krevEl("confirm-note").textContent = `Er ${adresse.adressetekst} (${formatEiendomsdetaljer(adresse)}) riktig eiendom? Etter bekreftelsen henter vi kart og øvrige opplysninger.`;
}

function formatEiendomsdetaljer(adresse: GarasjeAdresse): string {
  const navn = adresse.kommunenavn?.toLocaleLowerCase("nb-NO")
    .replace(/(^|[\s(-])\p{L}/gu, bokstav => bokstav.toLocaleUpperCase("nb-NO"));
  const kommune = navn ? `${navn} (${adresse.kommunenummer})` : adresse.kommunenummer;
  return `gnr. ${adresse.gardsnummer}, bnr. ${adresse.bruksnummer}` +
    (adresse.festenummer ? `, festenr. ${adresse.festenummer}` : "") + `, Kommune: ${kommune}`;
}

async function confirmProperty(): Promise<void> {
  if (!valgtAdresse) throw new Error("Velg en eiendom før du bekrefter.");
  propertyConfirmed = true;
  krevEl("confirm-property").hidden = true;
  renderPropertySteps();
  krevEl("confirm-note").textContent = `Bekreftet: ${valgtAdresse.adressetekst} (${formatEiendomsdetaljer(valgtAdresse)}).`;
  await refreshGrunnlag();
  krevEl("map-heading").focus();
}

async function confirmPlacement(): Promise<void> {
  if (!propertyConfirmed) throw new Error("Bekreft eiendommen før du velger plassering.");
  if (!tiltakstypeBekreftet) {
    tiltaksvalg?.focus();
    throw new Error("Bekreft tiltakstypen før du fortsetter med plasseringen.");
  }
  if (!placementChosen) throw new Error("Plasser tiltaket i kartet først. Du kan klikke, dra eller bruke piltastene.");
  await refreshGrunnlag();
  if (placementOnProperty() === false) {
    updatePlacementStatus();
    throw new Error("Punktet ligger utenfor den valgte eiendommen. Velg et nytt punkt på din tomt før du fortsetter.");
  }
  placementConfirmed = true;
  renderPropertySteps();
  krevEl("garage-heading").focus();
}

function editPlacement(): void {
  if (busy || pendingSave) return;
  utfylling?.cancel();
  placementConfirmed = false;
  invalidateResult();
  renderPropertySteps();
  krevEl("map-heading").focus();
}

async function refreshGrunnlag(): Promise<void> {
  if (!propertyConfirmed || !valgtAdresse) throw new Error("Bekreft eiendommen før kart og opplysninger hentes.");
  const version = propertyVersion;
  invalidateResult();
  placementConfirmed = false;
  grunnlag = null;
  krevEl("property-workspace").hidden = !placementChosen;
  renderPropertySteps();
  krevEl("plan-facts").replaceChildren();
  krevEl("measure-plan-notices").replaceChildren();
  krevEl("sources").replaceChildren();
  let data: GarasjeGrunnlag;
  try {
    data = await api<GarasjeGrunnlag>(`/api/garasje/grunnlag?${selectedQuery()}`);
  } catch (error) {
    if (propertyConfirmed && version === propertyVersion) {
      if (placementChosen) {
        krevEl("placement-note").textContent = "Kunne ikke hente planer. Plasseringen er ikke bekreftet. Prøv «Bekreft plassering og fortsett» igjen.";
      } else {
        krevEl("confirm-property").textContent = "Prøv å hente kart og opplysninger igjen";
        krevEl("confirm-property").hidden = false;
      }
    }
    throw error;
  }
  if (!propertyConfirmed || version !== propertyVersion) {
    throw new Error("Eiendomsvalget er endret. Bekreft riktig eiendom før du fortsetter.");
  }
  grunnlag = data;
  renderGrunnlag(data);
  renderMap(data);
  updateMarker();
  krevEl("property-workspace").hidden = false;
  renderPropertySteps();
  krevEl("confirm-property").hidden = true;
  krevEl("placement-note").textContent = placementChosen
    ? "Plangrunnlaget gjelder den valgte plasseringen. Markøren viser ett punkt, ikke hele tiltaket."
    : "Markøren viser foreløpig adressepunktet. Velg aktivt hvor tiltaket skal stå ved å klikke, dra eller bruke piltastene.";
  updatePlacementStatus();
}

function renderGrunnlag(data: GarasjeGrunnlag): void {
  const facts = krevEl("plan-facts");
  facts.replaceChildren();
  const notices = krevEl("measure-plan-notices");
  notices.replaceChildren();
  for (const warning of data.tiltaksvarsler ?? []) {
    const notice = element("div", undefined, "ds-alert");
    notice.dataset.color = warning.status === "brudd" ? "warning" : "info";
    notice.append(element("p", `${warning.navn}: ${warning.forklaring}`, "ds-paragraph"));
    addLink(notice, "Se planbestemmelsen", warning.kilde);
    notices.append(notice);
  }
  const teigkilde = data.kilder.find(kilde => kilde.id === "eiendomsgrenser");
  if (teigkilde?.status === "ok") {
    facts.append(element("p", teigkilde.fil
      ? `Tomtegrenser: Data hentet fra lokal fil (${teigkilde.fil}).`
      : `Tomtegrenser: Data hentet fra API (${teigkilde.navn}).`, "ds-paragraph"));
  }
  for (const formaal of data.arealformaal) {
    facts.append(element("p", `${formaal.sonenavn || formaal.beskrivelse} · arealformål ${formaal.kode}` +
      (formaal.arealstatus === undefined ? "" : ` / status ${formaal.arealstatus}`) + ` · plan ${formaal.planId}`, "ds-paragraph"));
  }
  if (data.bebyggelse) {
    facts.append(element("h3", "Eksisterende bebyggelse", "ds-heading"));
    facts.append(element("p", data.bebyggelse.forklaring, "ds-paragraph"));
    for (const bygning of data.bebyggelse.bygninger) {
      facts.append(element("p", [
        bygning.bygningsnummer ? `Bygg ${bygning.bygningsnummer}` : `Kartflate ${bygning.id}`,
        bygning.bygningstypeNavn || bygning.objekttype,
        bygning.bygningsstatusNavn,
        bygning.bruksareal === undefined ? null : `Registrert BRA: ${bygning.bruksareal} m² (ikke BYA)`
      ].filter(Boolean).join(" · "), "ds-paragraph"));
    }
  }
  if (data.arealberegning) {
    const areal = data.arealberegning;
    const format = (n: number | null) => n === null ? "Uavklart" : n.toLocaleString("nb-NO", { maximumFractionDigits: 1 });
    facts.append(element("h3", "Areal fra kartet", "ds-heading"));
    facts.append(element("p", `Tomt: ${format(areal.tomtearealM2)} m². Kartlagt bygningsfotavtrykk på tomten: ${format(areal.kartlagtBebygdArealM2)} m². Kartlagt arealandel: ${format(areal.kartlagtAndelProsent)} %.`, "ds-paragraph"));
    facts.append(element("p", "Dette er en kartberegning, ikke juridisk utnyttelsesgrad. Tillatt utnyttelse må avklares i planbestemmelsene for den konkrete sonen og eiendommen.", "ds-paragraph"));
    const details = element("details", undefined, "ds-details");
    details.append(element("summary", "Slik er arealet beregnet"), element("p", areal.metode, "ds-paragraph"));
    for (const text of areal.forbehold) details.append(element("p", text, "ds-paragraph"));
    facts.append(details);
  }
  if (!data.arealformaal.length) facts.append(element("p", "Arealformål er ikke avklart. Se kildestatusen.", "ds-paragraph"));
  for (const polygon of data.eiendomsgrenser) {
    if (polygon.teig) {
      const teig = polygon.teig;
      const id = polygon.kildeObjektId === undefined ? `Teig ${teig.teigId ?? polygon.id}` : `Objekt ${polygon.kildeObjektId} i lokalt teiguttrekk`;
      facts.append(element("p", `${id} · ${teig.gnr}/${teig.bnr}. ` +
        `Kvalitetsklasse fra kilden: ${polygon.kvalitetsklasse ?? teig.kvalitet ?? "ikke oppgitt"}. ` +
        `Tvist: ${teig.tvist ?? "ikke oppgitt i denne kilden"}.` +
        (polygon.registrertArealM2 === undefined ? "" : ` Oppgitt teigareal: ${polygon.registrertArealM2.toLocaleString("nb-NO")} m².`) +
        (polygon.oppdatert ? ` Geometrien sist oppdatert: ${polygon.oppdatert.replace("T", " ")}.` : ""), "ds-paragraph"));
    }
  }
  if (data.arealformaal.some(f => f.kode >= 5000 && f.kode < 6000)) {
    facts.append(element("p", "LNF/LNFR er funnet automatisk. Det er ikke alene et svar på søknadsplikten: bestemmelser for eksisterende bebyggelse og det konkrete tiltaket må undersøkes.", "ds-paragraph"));
  }
  for (const plan of data.reguleringsplaner) {
    const p = element("p", undefined, "ds-paragraph");
    addLink(p, `${plan.navn} (plan ${plan.planId})`, plan.url);
    facts.append(p);
  }
  if (data.reguleringsplaner.some(p => p.planId === "6170063")) {
    facts.append(element("p", "I denne demonstrasjonscasen skal bestemmelsene om bygg og gjerde undersøkes i plandokumentene. Karttreffet alene bekrefter ikke innholdet.", "ds-paragraph"));
  }
  if (!data.eiendomsgrenser.length) {
    facts.append(element("p", "Tomtegrensen kunne ikke vises. Kartet er da bare et utsnitt rundt adressen, ikke en avgrensning av eiendommen.", "ds-paragraph"));
  }
  const list = element("ul", undefined, "source-list");
  const status = { ok: "Hentet", ingen_treff: "Ingen treff", feil: "Henting feilet", ikke_sjekket: "Ikke kontrollert" };
  for (const kilde of data.kilder) {
    const item = element("li");
    addLink(item, kilde.navn, kilde.url);
    item.append(element("p", `${status[kilde.status]} · ${new Date(kilde.hentet).toLocaleString("nb-NO")}`, "ds-paragraph"));
    if (kilde.status === "ok") {
      item.append(element("p", kilde.fil ? `Data hentet fra lokal fil: ${kilde.fil}` : "Data hentet fra API", "ds-paragraph"));
    }
    if (kilde.koordinatsystem) item.append(element("p", `Koordinatsystem: ${kilde.koordinatsystem}`, "ds-paragraph"));
    if (kilde.merknad) item.append(element("p", kilde.merknad, "ds-paragraph"));
    list.append(item);
  }
  krevEl("sources").replaceChildren(list);
}

function xy(punkt: GarasjePunkt): [number, number] {
  return projectGarasjePunkt(punkt, bounds);
}

/**
 * `className` kan være en funksjon når lagets flater ikke deler klasse.
 *
 * Alternativet var å tegne alt med én klasse og så overskrive hver path etter
 * indeks fra kalleren, som bandt kalleren til at drawPolygons legger igjen
 * nøyaktig ett barn per flate i samme rekkefølge.
 */
function drawPolygons(
  id: string, polygons: { ringer: [number, number][][] }[], className: string | ((index: number) => string)
): void {
  const group = svg.querySelector(`#${id}`)!;
  group.replaceChildren();
  for (const [index, polygon] of polygons.entries()) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", typeof className === "string" ? className : className(index));
    path.setAttribute("fill-rule", "evenodd");
    path.setAttribute("d", polygon.ringer.map(ring => ring.map(([lon, lat], index) => {
      const [x, y] = xy({ lon, lat });
      return `${index === 0 ? "M" : "L"}${x},${y}`;
    }).join(" ") + " Z").join(" "));
    group.append(path);
  }
}

function renderBuildings(data: GarasjeGrunnlag): void {
  // Bygningsflatene dekker hele oppslagskonvolutten, ikke bare valgt teig. Bare
  // flatene i bebyggelsen er sammenholdt med teigen, så bare de kan tegnes som
  // egne bygg. Er bebyggelsen uavklart, vet kartet ingenting om tilknytningen,
  // og da skal det ikke påstå at alt er nabobygg.
  const kilde = data.kilder.find(kilde => kilde.id === "bygninger");
  const kobletTilTeig = data.bebyggelse !== undefined && data.bebyggelse.bygninger.length > 0;
  const egne = new Set(data.bebyggelse?.bygninger.map(bygning => bygning.id) ?? []);
  const eier = kobletTilTeig ? data.bygninger.filter(flate => egne.has(flate.id)) : data.bygninger;
  const naboer = kobletTilTeig ? data.bygninger.filter(flate => !egne.has(flate.id)) : [];
  drawPolygons("map-buildings", eier, "building");
  drawPolygons("map-buildings-neighbour", naboer, "building-neighbour");
  const status = krevEl("building-status");
  if (!kilde || kilde.status === "ikke_sjekket") {
    status.textContent = "Bygningsdata er ikke hentet for dette kartutsnittet.";
    return;
  }
  if (kilde.status === "feil") {
    status.textContent = `Bygningskartet kunne ikke hentes. ${kilde.merknad ?? ""}`.trim();
    return;
  }
  if (kilde.status === "ingen_treff" || !data.bygninger.length) {
    status.textContent = "Ingen bygningsflater ble funnet i dette kartutsnittet. Kartet er ikke et bevis på at området er ubebygd.";
    return;
  }
  status.textContent = kobletTilTeig
    ? `${eier.length} bygningsflater på din tomt og ${naboer.length} på nabotomter i kartutsnittet.`
    : `${data.bygninger.length} bygningsflater i kartutsnittet. Hvilke av dem som ligger på din tomt er ikke avklart, så de er ikke skilt fra hverandre i kartet.`;
}

function renderNeighbours(data: GarasjeGrunnlag): void {
  const neighbours = data.nabotomter;
  const parcels = neighbours?.tomter ?? [];
  drawPolygons("map-neighbours", parcels, "neighbour");
  const labels = svg.querySelector("#map-neighbour-labels")!;
  labels.replaceChildren();
  const details = krevEl("neighbour-details");
  details.replaceChildren();
  const status = krevEl("neighbour-status");
  if (!neighbours) {
    status.textContent = "Nabodata er ikke hentet for denne vurderingen.";
    return;
  }
  const kilde = neighbours.kilde;
  const statuses = { ok: `${parcels.length} naboflater i kartutsnittet.`, ingen_treff: "Ingen nabotomter funnet i dette utsnittet.", feil: "Nabodata kunne ikke hentes.", ikke_sjekket: "Nabodata er ikke tilgjengelig for dette utsnittet." };
  status.textContent = `${statuses[kilde.status]} ${kilde.status === "ok" ? kilde.fil ? "Data hentet fra lokal fil." : "Data hentet fra API." : ""}`;
  addLink(details, kilde.navn, kilde.url);
  if (kilde.merknad) details.append(element("p", kilde.merknad, "ds-paragraph"));
  details.append(element("p", "Nabotomtene er kun kartinformasjon. Eieropplysninger er ikke hentet, og naboflatene inngår ikke i arealet eller vurderingen av din tomt.", "ds-paragraph"));
  const occupied: KartLabel[] = [];
  for (const polygon of parcels) {
    const teig = polygon.teig;
    const reference = teig ? `${teig.gnr}/${teig.bnr}${teig.fnr ? `/${teig.fnr}` : ""}` : polygon.matrikkelnummer || polygon.id;
    const position = findNabotomtLabel(polygon, data.eiendomsgrenser, bounds, reference.length * 8 + 8, occupied);
    if (!position) continue;
    occupied.push(position);
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("class", "neighbour-label");
    text.setAttribute("x", String(position.x));
    text.setAttribute("y", String(position.y));
    text.setAttribute("text-anchor", "middle");
    text.textContent = reference;
    labels.append(text);
  }
}

const ZONE_CLASS: Record<Hensynssonetype, string> = {
  stoy: "zone-stoy", fare: "zone-fare", angitthensyn: "zone-angitthensyn",
};

// Ingen reservefarge: unionen på GarasjePlanflate gjør at hensynstypen alltid er
// der for en hensynssone. Reserven som sto her kunne ikke inntreffe, og ville
// uansett tegnet en faresone grønn.
function zoneClass(flate: GarasjePlanflate): string {
  return `zone ${flate.kategori === "arealformaal" ? "zone-arealformaal" : ZONE_CLASS[flate.hensynstype]}`;
}

function zoneName(flate: GarasjePlanflate): string {
  return flate.kategori === "hensynssone" ? hensynssonenavn(flate) : flate.navn;
}

function renderZones(data: GarasjeGrunnlag): void {
  // Arealformålene først, så en hensynssone aldri blir liggende under et formål
  // som dekker hele tomten.
  planflater = [...data.planflater ?? []].sort((a, b) =>
    Number(a.kategori === "hensynssone") - Number(b.kategori === "hensynssone"));
  // Kilden lagres ved siden av flatene, ikke leses fra `grunnlag`: moveMarker
  // nuller grunnlaget, så en feilet plankilde ble stille til «ingen soner» fra
  // andre markørflytting og utover.
  plankilde = data.kilder.find(kilde => kilde.id === "planflater");
  const filter = krevEl<HTMLSelectElement>("zone-filter");
  const previous = filter.value;
  filter.replaceChildren();
  for (const [value, label] of [["all", "Alle soner og arealformål"], ["none", "Skjul soner"],
    ["hensynssone", "Alle hensynssoner"], ["arealformaal", "Arealformål"],
    ...planflater.map((flate, index) => [`zone-${index}`, zoneName(flate)])]) {
    const option = element("option", label);
    option.value = value;
    filter.append(option);
  }
  filter.value = Array.from(filter.options).some(option => option.value === previous) ? previous : "all";
  drawSelectedZones();
  updateZoneStatus();
}

function drawSelectedZones(): void {
  const filter = krevEl<HTMLSelectElement>("zone-filter").value;
  const visible = planflater.filter((flate, index) => filter === "all" || filter === flate.kategori || filter === `zone-${index}`);
  drawPolygons("map-zones", visible, index => zoneClass(visible[index]!));
}

function updateZoneStatus(): void {
  const status = krevEl("zone-status");
  if (!plankilde || (plankilde.status !== "ok" && plankilde.status !== "ingen_treff")) {
    status.textContent = `Hensynssoner og arealformål er ikke avklart. ${plankilde?.merknad ?? ""}`.trim();
    return;
  }
  const soner = planflater.filter(flate => flate.kategori === "hensynssone");
  if (!planflater.length) {
    status.textContent = "Ingen hensynssoner eller arealformål fra kommuneplanen berører den kartlagte eiendommen.";
    return;
  }
  const iPunktet = plassering
    ? planflater.filter(flate => ringerInneholder(plassering!.lon, plassering!.lat, flate.ringer))
    : [];
  const berorer = soner.length
    ? `Eiendommen berører ${soner.map(zoneName).join(", ")}.`
    : "Ingen hensynssone berører eiendommen.";
  // «Foreløpig» er ikke et forbehold for syns skyld: dette er regnet ut i
  // nettleseren mens markøren flyttes, og det er serveren som fastslår det.
  status.textContent = `${berorer} Markøren står foreløpig ${iPunktet.length
    ? `i ${iPunktet.map(zoneName).join(", ")}` : "utenfor alle flatene"}. `
    + "Kommuneplanens bestemmelser avgjør hva som gjelder; sonen alene sier det ikke.";
}

function renderMap(data: GarasjeGrunnlag): void {
  kartgrunnlag = data;
  bounds = fitKartutsnitt(data.eiendomsgrenser, data.adresse.punkt);
  const query = new URLSearchParams({
    bbox: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    bboxSR: "4258", imageSR: "4258", size: "640,480", format: "png32", f: "image"
  });
  const source = data.kilder.find(kilde => kilde.id === "kpa" && kilde.status === "ok");
  const background = source && /\/MapServer\/\d+$/.test(new URL(source.url).pathname)
    ? source.url.replace(/\/\d+$/, "/export") : null;
  if (background) svg.querySelector("#map-image")!.setAttribute("href", `${background}?${query}`);
  else svg.querySelector("#map-image")!.removeAttribute("href");
  drawPolygons("map-parcels", data.eiendomsgrenser, "parcel");
  renderZones(data);
  renderBuildings(data);
  renderNeighbours(data);
  updatePlacementStatus();
}

function placementOnProperty(): boolean | null {
  if (!plassering || !kartgrunnlag?.eiendomsgrenser.length
    || kartgrunnlag.kilder.find(kilde => kilde.id === "eiendomsgrenser")?.status !== "ok") return null;
  return kartgrunnlag.eiendomsgrenser.some(flate => ringerInneholder(plassering!.lon, plassering!.lat, flate.ringer));
}

function updatePlacementStatus(): void {
  const onProperty = placementOnProperty();
  const status = krevEl("placement-validity");
  status.textContent = onProperty === false
    ? "Punktet ligger utenfor din tomt, eventuelt på en nabotomt. Velg et nytt punkt før du fortsetter."
    : onProperty === null
      ? "Tomtegrensen er ikke avklart. Plasseringen kan ikke bekreftes som innenfor eiendommen; få grensen kontrollert før du bygger."
      : "Punktet ligger på den kartlagte tomten. Kontroller at hele tiltaket og nødvendige avstander får plass.";
  status.setAttribute("data-color", onProperty === false ? "danger" : "info");
  const layer = svg.querySelector("#map-nearest-boundary")!;
  layer.replaceChildren();
  const nearest = plassering && onProperty !== null
    ? nearestPolygonBoundary(plassering, kartgrunnlag!.eiendomsgrenser) : null;
  krevEl("boundary-distance").textContent = nearest
    ? `Korteste kartavstand fra markøren til tomtegrensen: ${nearest.avstandMeter.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} m. Linjen viser nærmeste grensepunkt. Dette er ikke avstanden fra hele bygget og erstatter ikke oppmåling.`
    : "Avstanden til tomtegrensen kan ikke beregnes fra tilgjengelige kartdata.";
  if (nearest && plassering) {
    const [x1, y1] = xy(plassering);
    const [x2, y2] = xy(nearest.punkt);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    for (const [key, value] of Object.entries({ x1, y1, x2, y2 })) line.setAttribute(key, String(value));
    line.setAttribute("stroke", "var(--ds-color-danger-border-strong)");
    line.setAttribute("stroke-width", "3");
    line.setAttribute("stroke-dasharray", "4 3");
    const point = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    point.setAttribute("cx", String(x2));
    point.setAttribute("cy", String(y2));
    point.setAttribute("r", "5");
    point.setAttribute("fill", "var(--ds-color-danger-border-strong)");
    layer.append(line, point);
  }
}

function updateMarker(): void {
  if (!plassering) return;
  const [x, y] = xy(plassering);
  const marker = svg.querySelector("#map-marker")!;
  marker.setAttribute("x", String(x - 9));
  marker.setAttribute("y", String(y - 9));
}

function moveMarker(punkt: GarasjePunkt): void {
  if (busy || pendingSave || !propertyConfirmed || placementConfirmed || !valgtAdresse) return;
  if (punkt.lat < bounds.south || punkt.lat > bounds.north || punkt.lon < bounds.west || punkt.lon > bounds.east) {
    krevEl("placement-note").textContent = "Markøren er ved kanten av kartutsnittet. Velg en plassering innenfor utsnittet.";
    return;
  }
  plassering = punkt;
  placementChosen = true;
  invalidateResult();
  updateMarker();
  updateZoneStatus();
  updatePlacementStatus();
  krevEl("placement-note").textContent = "Plasseringen er endret. Velg «Bekreft plassering og fortsett» for å hente planer for punktet og beskrive tiltaket.";
  krevEl("plan-facts").replaceChildren(element("p", "Tidligere planopplysninger er skjult fordi plasseringen er endret.", "ds-paragraph"));
  krevEl("measure-plan-notices").replaceChildren();
  krevEl("sources").replaceChildren();
  grunnlag = null;
}

type Tiltaksfelt = ReturnType<typeof getByggetiltakFelter>[number];
const numericFields: Tiltaksfelt[] = [];
const booleanFields: Tiltaksfelt[] = [];

function renderFields(): void {
  const container = krevEl("garage-fields");
  container.replaceChildren();
  for (const field of numericFields) {
    const wrapper = element("div", undefined, "ds-field");
    const label = element("label", field.label, "ds-label");
    label.htmlFor = field.id;
    const input = element("input", undefined, "ds-input");
    input.id = field.id;
    input.name = field.id;
    input.type = "number";
    if (field.min !== undefined) input.min = String(field.min);
    if (field.max !== undefined) input.max = String(field.max);
    input.step = field.heltall ? "1" : "any";
    input.required = !field.ukjentTillatt;
    input.setAttribute("aria-describedby", `${field.id}-hint`);
    const hint = element("p", field.hint, "ds-paragraph muted");
    hint.id = `${field.id}-hint`;
    hint.dataset.size = "sm";
    wrapper.append(label, input, hint);
    container.append(wrapper);
  }
  for (const field of booleanFields) {
    const wrapper = element("div", undefined, "ds-field");
    const label = element("label", field.label, "ds-label");
    label.htmlFor = field.id;
    const select = element("select", undefined, "ds-input");
    select.id = field.id;
    select.name = field.id;
    for (const [value, text] of [["", "Vet ikke"], ["true", "Ja"], ["false", "Nei"]]) {
      const option = element("option", text);
      option.value = value;
      select.append(option);
    }
    wrapper.append(label, select);
    container.append(wrapper);
  }
}

function readTiltak(): Record<string, string | number | boolean | null> {
  const data = new FormData(form);
  const tiltak: Record<string, string | number | boolean | null> = {
    tiltakstype, tiltaksbeskrivelse, tiltakstypeBekreftet
  };
  for (const field of numericFields) {
    const value = String(data.get(field.id) ?? "");
    tiltak[field.id] = value === "" ? null : Number(value);
  }
  for (const field of booleanFields) {
    const value = data.get(field.id);
    tiltak[field.id] = value === "" ? null : value === "true";
  }
  return tiltak;
}

function renderVurdering(data: GarasjeSvar): void {
  vurdering = data;
  grunnlag = data.grunnlag;
  renderGrunnlag(data.grunnlag);
  renderMap(data.grunnlag);
  updateMarker();
  const colors = { ikke_soknadspliktig: "success", meldeplikt: "success", soknadspliktig: "warning", maa_avklares: "info" };
  // Svaret først, og reglenes egne neste steg etterpå. Tidligere sto utfallets
  // kodenavn som overskrift og én generisk setning under, mens `nesteSteg` - som
  // navngir bestemmelsene innbyggeren skal spørre om - ble kastet her.
  const svaret = beskrivGarasjeUtfall(data.vurdering);
  krevEl("result-heading").textContent = svaret.tittel;
  const summary = krevEl("result-summary");
  summary.dataset.color = colors[data.vurdering.utfall];
  summary.replaceChildren(...[svaret.svar, svaret.begrunnelse, data.vurdering.forklaring]
    .filter(Boolean).map(tekst => element("p", tekst, "ds-paragraph")));
  const nesteSteg = data.vurdering.nesteSteg ?? [];
  if (nesteSteg.length) {
    const heading = element("h3", "Dette er neste steg", "ds-heading");
    heading.dataset.size = "xs";
    const punkter = element("ul", undefined, "ds-list");
    for (const steg of nesteSteg) punkter.append(element("li", steg));
    summary.append(heading, punkter);
  }
  const teigkilde = data.grunnlag.kilder.find(k => k.id === "eiendomsgrenser");
  if (teigkilde?.status === "ok") {
    summary.append(element("p", teigkilde.fil
      ? `Tomtegrenser: Data hentet fra lokal fil (${teigkilde.fil}).`
      : `Tomtegrenser: Data hentet fra API (${teigkilde.navn}).`, "ds-paragraph"));
  }
  const national = { oppfylt: "De kontrollerte nasjonale unntaksvilkårene er oppfylt.", brudd: "Minst ett nasjonalt unntaksvilkår er ikke oppfylt.", uavklart: "Nasjonale unntaksvilkår er ikke ferdig avklart." };
  krevEl("result-basis").textContent = `${national[data.vurdering.nasjonaltUnntak]} ${data.grunnlag.adresse.adressetekst} · Sporings-ID: ${data.sporingsId}. Vurderingen gjelder innsendte mål og det valgte punktet, ikke et godkjent byggeprosjekt.`;
  const list = krevEl("checks");
  list.replaceChildren();
  const status = { oppfylt: "Oppfylt", brudd: "Ikke oppfylt", uavklart: "Må avklares" };
  for (const sjekk of data.vurdering.sjekker) {
    const li = element("li");
    const heading = element("h3", `${status[sjekk.status]}: ${sjekk.navn}`, "ds-heading");
    heading.dataset.size = "xs";
    li.append(heading, element("p", sjekk.forklaring, "ds-paragraph"));
    addLink(li, "Se kilde", sjekk.kilde);
    list.append(li);
  }
  for (const forhold of data.vurdering.uavklarteForhold) {
    const li = element("li");
    li.append(element("strong", "Må avklares: "), document.createTextNode(forhold));
    list.append(li);
  }
  krevEl("assessment").hidden = false;
  krevEl("assessment").focus();
  void renderTiltaksraad(krevEl("assessment"), () => fetchTiltaksraad(data), () => vurdering === data);
}

async function fetchTiltaksraad(data: GarasjeSvar): Promise<Tiltaksraad> {
  const projected = projectGarasjeDialogGrunnlag(data.grunnlag);
  const response = await fetch(`${agentBase}/agent/garasje/raad`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(120000),
    body: JSON.stringify({
      sporingsId: data.sporingsId,
      kontekst: {
        prosjekt: { tiltakstype },
        resultater: {
          ...projected,
          "garasje-vurdering": { vurdering: data.vurdering, grunnlag: projected.garasje }
        }
      }
    })
  });
  const reply: Tiltaksraad & {
    feil?: string;
    kunnskapsadvarsel?: string;
    dokumentkunnskap?: { title?: string; documentId?: string; page?: number; canonicalUrl?: string; qualityWarnings?: string[] }[];
  } = await response.json();
  if (!response.ok) throw new Error(reply.feil || `Rådstjenesten svarte med HTTP ${response.status}.`);
  if (reply.dokumentkunnskap !== undefined && !Array.isArray(reply.dokumentkunnskap)) {
    throw new Error("Rådstjenesten svarte med ugyldige kildehenvisninger.");
  }
  const result: Tiltaksraad = {
    ...reply,
    advarsel: [reply.advarsel, reply.kunnskapsadvarsel].filter(Boolean).join(" ") || undefined,
    kilder: reply.dokumentkunnskap?.map(source => ({
      tittel: source.title || source.documentId || "PDF-dokument",
      side: source.page,
      url: source.canonicalUrl,
      merknad: source.qualityWarnings?.join(" ")
    })) ?? reply.kilder
  };
  if (vurdering === data) data.raad = result;
  return result;
}

async function loadPerson(): Promise<void> {
  const personer = await api<Innbygger[]>("/api/personer");
  const meg = personer.find(person => person.syntetiskFodselsnummer === loggedInPid());
  if (!meg) throw new Error("Fant ikke den innloggede testpersonen.");
  const person = await api<Innbygger>(`/api/personer/${encodeURIComponent(meg.personId)}`);
  if (embeddedOekt && embeddedOekt.personId !== meg.personId) {
    throw new Error("Prosessøkten tilhører ikke den innloggede brukeren.");
  }
  krevEl("logged-in").textContent = `Innlogget som ${meg.visningsnavn}`;
  krevEl("logout").hidden = false;
  krevEl("login-panel").hidden = true;
  krevEl("workspace").hidden = false;
  adressevalg = [];
  const bosted = person.bostedsadresse;
  const bostedsadresse = !person.skjermet && bosted?.adressenavn && bosted.husnummer !== undefined
    ? `${bosted.adressenavn} ${bosted.husnummer}${bosted.husbokstav || ""}` : null;
  const note = krevEl("address-note");
  note.textContent = person.skjermet
    ? "Adressen er skjermet og blir ikke forhåndsutfylt. Du kan bruke en offentlig demonstrasjonsadresse."
    : "Eierskapet kommer fra syntetiske registre. Bostedsadressen foreslås først når den også finnes blant eiendommene dine.";
  if (!person.skjermet) {
    try {
      const mine = await api<{ eiendommer: { adresse: string; kommune: string; kommunenummer?: string; gnr?: number; bnr?: number }[] }>(
        `/api/matrikkel/mine-eiendommer?${new URLSearchParams({ personId: meg.personId })}`);
      for (const eiendom of mine.eiendommer) {
        if (!adressevalg.some(a => a.tekst === eiendom.adresse && a.kommune === eiendom.kommunenummer
          && a.gnr === eiendom.gnr && a.bnr === eiendom.bnr)) {
          adressevalg.push({
            tekst: eiendom.adresse, kommune: eiendom.kommunenummer,
            gnr: eiendom.gnr, bnr: eiendom.bnr,
            kilde: eiendom.adresse === bostedsadresse && eiendom.kommunenummer === bosted?.kommunenummer
              ? "Bosted og registrert eiendom (foreslått)" : "Registrert eiendom (syntetisk)"
          });
        }
      }
      const isBosted = (a: Adressevalg) => a.tekst === bostedsadresse && a.kommune === bosted?.kommunenummer;
      adressevalg.sort((a, b) => Number(isBosted(b)) - Number(isBosted(a)));
    } catch (error) {
      if (!tokenValid()) throw error;
      note.textContent += ` Egne eiendommer kunne ikke hentes: ${feilmelding(error)} Du kan fortsatt søke på adresse.`;
    }
  }
  myAddress.replaceChildren(element("option", "Velg adresse"));
  myAddress.options[0].value = "";
  adressevalg.forEach((adresse, index) => {
    const option = element("option", `${adresse.tekst} · kommune ${adresse.kommune || "ukjent"} · ${adresse.kilde}`);
    option.value = String(index);
    myAddress.append(option);
  });
  if (adressevalg.length) {
    myAddress.value = "0";
    const first = adressevalg[0];
    searchInput.value = first.tekst;
    await searchAdresse(first.tekst, first.kommune);
  } else if (!person.skjermet) {
    note.textContent += " Ingen eide eiendommer funnet for testpersonen. Du kan bruke adressesøket i den frittstående tiltakssjekken.";
    if (bostedsadresse) searchInput.value = bostedsadresse;
  }
}

function configureFields(type: Byggetiltakstype): void {
  utfylling?.destroy();
  helpHistory.length = 0;
  helpFieldId = null;
  const fields = getByggetiltakFelter(type);
  numericFields.splice(0, numericFields.length, ...fields.filter(field => field.type === "tall"));
  booleanFields.splice(0, booleanFields.length, ...fields.filter(field => field.type === "valg"));
  renderFields();
  const draft = measureDrafts.get(type);
  if (draft) for (const field of fields) krevEl<HTMLInputElement | HTMLSelectElement>(field.id).value = draft[field.id] ?? "";
  utfylling = createGarasjeUtfylling({
  fields,
  locked: () => busy || pendingSave || !placementConfirmed,
  changed: invalidateResult,
  ask: async (feltId, tekst, signal) => {
    if (helpFieldId !== feltId) helpHistory.length = 0;
    helpFieldId = feltId;
    const response = await fetch(`${agentBase}/agent/garasje/dialog`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
      body: JSON.stringify({
        feltId, tekst, sporingsId: embeddedOekt?.sporingsId,
        kontekst: {
          prosjekt: { tiltakstype },
          resultater: projectGarasjeDialogGrunnlag(grunnlag),
          samtale: helpHistory.slice(-4).map(turn => ({ rolle: turn.rolle, tekst: turn.tekst.slice(0, 1000) }))
        }
      })
    });
    const data: GarasjeDialogReply & { feil?: string } = await response.json();
    if (!response.ok) throw new Error(data.feil || "AI-agenten kunne ikke svare. Prøv igjen eller velg stegvis utfylling.");
    if (!["svar", "sporsmaal", "ugyldig"].includes(data.type) || typeof data.tekst !== "string") {
      throw new Error("AI-agenten svarte i et ukjent format. Svarene dine er ikke endret.");
    }
    helpHistory.splice(0, helpHistory.length, { rolle: "innbygger", tekst }, { rolle: "assistent", tekst: data.tekst });
    return data;
  }
});
}
configureFields(tiltakstype);
tiltaksvalg = createTiltaksvalg({
  container: krevEl("workspace"),
  choices: BYGGETILTAK_KATALOG.map(type => ({ id: type.id, label: type.navn })),
  unknownType: "ukjent",
  suggest: description => {
    const proposal = classifyByggetiltak(description);
    return proposal.tiltakstype === "ukjent" ? null : proposal.tiltakstype;
  },
  locked: () => busy || pendingSave,
  changed: () => {
    tiltakstypeBekreftet = false;
    utfylling?.cancel();
    invalidateResult();
    renderPropertySteps();
  },
  confirmed: (type, description) => {
    measureDrafts.set(tiltakstype, Object.fromEntries([...numericFields, ...booleanFields]
      .map(field => [field.id, krevEl<HTMLInputElement | HTMLSelectElement>(field.id).value])));
    tiltakstype = type;
    tiltaksbeskrivelse = description;
    tiltakstypeBekreftet = true;
    configureFields(type);
    invalidateResult();
    renderPropertySteps();
    if (propertyConfirmed) void perform("Henter planvilkår for tiltakstypen …", refreshGrunnlag);
  }
});
for (const id of ["mode-agent", "mode-stepwise"]) {
  krevEl(id).addEventListener("click", () => { helpHistory.length = 0; });
}
krevEl("login").addEventListener("click", () => void perform("Åpner ID-porten …", async () => {
  if (await requireLogin({ idportenBaseUrl: idportenBase })) await loadPerson();
}));
krevEl("logout").addEventListener("click", () => { logOut(); location.reload(); });
krevEl("search-form").addEventListener("submit", event => {
  event.preventDefault();
  void perform("Søker etter adressen …", () => searchAdresse(searchInput.value.trim()));
});
myAddress.addEventListener("change", () => {
  clearConfirmation();
  if (myAddress.value === "") {
    valgtAdresse = null;
    krevEl("property-workspace").hidden = true;
    krevEl("property-facts").hidden = true;
    return;
  }
  const adresse = adressevalg[Number(myAddress.value)];
  void perform("Henter den valgte adressen …", () => searchAdresse(adresse.tekst, adresse.kommune));
});
searchInput.addEventListener("input", () => {
  clearConfirmation();
  krevEl("confirm-note").textContent = "Adressesøket er endret. Finn og bekreft eiendommen på nytt.";
});
krevEl("confirm-property").addEventListener("click", () => void perform("Henter kart og opplysninger om eiendommen …", confirmProperty));
krevEl("edit-property").addEventListener("click", () => void perform("Åpner eiendomsvalget …", async () => {
  if (!valgtAdresse) throw new Error("Velg en eiendom først.");
  await selectAdresse(valgtAdresse);
  krevEl("property-heading").focus();
}));
krevEl("edit-placement").addEventListener("click", editPlacement);
function placeFromPointer(event: PointerEvent): void {
  const rect = svg.getBoundingClientRect();
  moveMarker(unprojectGarasjePunkt(
    (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height, bounds
  ));
}
svg.addEventListener("pointerdown", event => {
  if (busy || !valgtAdresse || event.button !== 0) return;
  svg.setPointerCapture(event.pointerId);
  placeFromPointer(event);
});
svg.addEventListener("pointermove", event => {
  if (svg.hasPointerCapture(event.pointerId)) placeFromPointer(event);
});
svg.addEventListener("pointerup", event => {
  if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
});
svg.addEventListener("keydown", event => {
  const direction: Record<string, [number, number]> = { ArrowUp: [0, 2], ArrowDown: [0, -2], ArrowLeft: [-2, 0], ArrowRight: [2, 0] };
  const offset = direction[event.key];
  if (!offset || !plassering) return;
  event.preventDefault();
  moveMarker({
    lat: plassering.lat + offset[1] / 111320,
    lon: plassering.lon + offset[0] / (111320 * Math.cos(plassering.lat * Math.PI / 180))
  });
});
krevEl("zone-filter").addEventListener("change", drawSelectedZones);
krevEl("reset-placement").addEventListener("click", () => {
  if (valgtAdresse) {
    moveMarker({ ...valgtAdresse.punkt });
    placementChosen = false;
    krevEl("placement-note").textContent = "Markøren er tilbake ved adressepunktet. Velg tiltakets plassering før du kjører sjekken.";
  }
});
krevEl("refresh-placement").addEventListener("click", () => void perform("Henter planer for plasseringen …", confirmPlacement));
svg.querySelector("#map-image")!.addEventListener("error", () => {
  krevEl("placement-note").textContent = "Bakgrunnskartet kunne ikke lastes. Eventuelle eiendomsflater vises fortsatt. Dette gir ingen bekreftelse på fravær av begrensninger.";
});
form.addEventListener("input", event => {
  const target = event.target;
  if ((target instanceof HTMLInputElement || target instanceof HTMLSelectElement)
    && [...numericFields, ...booleanFields].some(field => field.id === target.id)) {
    invalidateResult();
    target.removeAttribute("aria-invalid");
  }
});
form.addEventListener("change", event => {
  const target = event.target;
  if ((target instanceof HTMLInputElement || target instanceof HTMLSelectElement)
    && [...numericFields, ...booleanFields].some(field => field.id === target.id)) invalidateResult();
});
form.addEventListener("invalid", event => {
  if (event.target instanceof HTMLInputElement) event.target.setAttribute("aria-invalid", "true");
}, true);
form.addEventListener("submit", event => {
  event.preventDefault();
  if (!tiltakstypeBekreftet) {
    krevEl("error").textContent = "Bekreft tiltakstypen før du kjører sjekken.";
    krevEl("error").hidden = false;
    tiltaksvalg?.focus();
    return;
  }
  if (!propertyConfirmed) {
    krevEl("error").textContent = "Bekreft eiendommen før du kjører sjekken.";
    krevEl("error").hidden = false;
    return;
  }
  if (!placementConfirmed) {
    krevEl("error").textContent = "Bekreft plasseringen i kartet før du kjører sjekken.";
    krevEl("error").hidden = false;
    return;
  }
  if (!utfylling?.validateComplete()) return;
  // Capture before perform disables controls; disabled inputs are omitted by FormData.
  const tiltak = readTiltak();
  if (embedded) {
    if (!valgtAdresse || !plassering || !embeddedOektId || !embeddedStegId || pendingSave) return;
    const svar: Record<string, unknown> = {
      ...tiltak, adresse: valgtAdresse.adressetekst,
      kommunenummer: valgtAdresse.kommunenummer,
      gnr: valgtAdresse.gardsnummer, bnr: valgtAdresse.bruksnummer,
      lat: plassering.lat, lon: plassering.lon,
      eiendomBekreftet: true, plasseringBekreftet: true
    };
    delete svar.bebygdEiendom;
    pendingSave = true;
    for (const control of document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("#workspace input, #workspace select, #workspace button")) {
      control.disabled = true;
    }
    krevEl("progress").textContent = "Lagrer opplysningene i prosessøkten …";
    window.parent.postMessage({
      type: "garasje-svar", oektsId: embeddedOektId, stegId: embeddedStegId, svar
    }, location.origin);
    return;
  }
  void perform("Kontrollerer opplysninger og henter ferskt plangrunnlag …", async () => {
    invalidateResult();
    const query = selectedQuery();
    query.set("tiltak", JSON.stringify(tiltak));
    const data = await api<GarasjeSvar>(`/api/garasje/sjekk?${query}`);
    renderVurdering(data);
  });
});
krevEl("download").addEventListener("click", () => {
  if (!vurdering) return;
  const lagredeSvar = embeddedOekt?.svar?.["garasje-prosjekt"];
  const opplysninger = pageParams.get("integrert") === "resultat"
    ? { svar: lagredeSvar }
    : { tiltak: readTiltak() };
  const blob = new Blob([JSON.stringify({ ...vurdering, ...opplysninger }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = element("a");
  link.href = url;
  link.download = "tiltakssjekk.json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
krevEl("print").addEventListener("click", () => window.print());
if (embedded) {
  document.documentElement.classList.add("embedded");
  window.addEventListener("message", event => {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    if (event.data?.type === "garasje-feil") {
      pendingSave = false;
      for (const control of document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("#workspace input, #workspace select, #workspace button")) control.disabled = false;
      krevEl("error").textContent = typeof event.data.melding === "string" ? event.data.melding : "Svaret ble ikke lagret. Prøv igjen.";
      krevEl("error").hidden = false;
      krevEl("progress").textContent = "";
      utfylling?.refresh();
    }
    if (event.data?.type === "garasje-lagret") {
      krevEl("progress").textContent = "Opplysningene er lagret. Fortsett i prosessflyten utenfor kartet.";
    }
  });
  new ResizeObserver(() => {
    window.parent.postMessage({ type: "garasje-hoyde", hoyde: document.body.scrollHeight + 16 }, location.origin);
  }).observe(document.body);
}
void perform("Klargjør tiltakssjekken …", async () => {
  backendBase = sandkasseKonfigurasjon.backendBaseUrl;
  idportenBase = sandkasseKonfigurasjon.idportenBaseUrl;
  agentBase = sandkasseKonfigurasjon.agentBaseUrl;
  if (embedded) {
    if (window.parent === window || !embeddedOektId || !embeddedStegId) throw new Error("Åpne dette steget fra Chat, AI-agent eller Stegvis.");
    embeddedOekt = await api<Prosessoekt>(`/api/prosessoekter/${encodeURIComponent(embeddedOektId)}`);
    if (embeddedOekt.prosessId !== "garasjesjekk") throw new Error("Prosessøkten er ikke en tiltakssjekk.");
    if (pageParams.get("integrert") === "resultat") {
      const data = embeddedOekt.resultater?.["garasje-vurdering"];
      if (!data || typeof data !== "object" || !("grunnlag" in data) || !("vurdering" in data)) throw new Error("Ingen lagret tiltaksvurdering i økten.");
      const result = data as GarasjeSvar;
      tiltaksvalg?.hide();
      const saved = embeddedOekt.svar?.["garasje-prosjekt"];
      if (saved && typeof saved === "object" && "tiltakstype" in saved) {
        tiltakstype = BYGGETILTAK_TYPER.find(type => type === saved.tiltakstype) ?? "ukjent";
      }
      valgtAdresse = result.grunnlag.adresse;
      plassering = result.grunnlag.punkt;
      krevEl("workspace").hidden = false;
      krevEl("property-controls").hidden = true;
      krevEl("property-workspace").hidden = true;
      renderVurdering(result);
      return;
    }
    if (embeddedOekt.status !== "AKTIV" || embeddedOekt.aktivtSteg?.id !== embeddedStegId || embeddedOekt.aktivtSteg.visning !== "garasje") {
      throw new Error("Dette spørsmålssteget er ikke aktivt lenger. Oppdater prosessøkten.");
    }
    krevEl("assess").textContent = "Bruk opplysningene og gå videre";
    await loadPerson();
    const saved = embeddedOekt.svar?.[embeddedStegId];
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      const values = saved as Record<string, unknown>;
      const savedType = values.tiltakstype === undefined ? "frittliggende"
        : BYGGETILTAK_TYPER.find(type => type === values.tiltakstype) ?? "ukjent";
      tiltaksvalg?.restore(savedType, typeof values.tiltaksbeskrivelse === "string" ? values.tiltaksbeskrivelse : "");
      if (typeof values.adresse === "string" && values.adresse !== valgtAdresse?.adressetekst) await searchAdresse(values.adresse);
      for (const field of numericFields) {
        const value = values[field.id];
        if (typeof value === "number" || (typeof value === "string" && value !== "vet-ikke")) krevEl<HTMLInputElement>(field.id).value = String(value);
      }
      for (const field of booleanFields) {
        const value = values[field.id];
        krevEl<HTMLSelectElement>(field.id).value = value === true || value === "ja" ? "true" : value === false || value === "nei" ? "false" : "";
      }
      utfylling?.refresh();
      krevEl("confirm-note").textContent += " Tidligere mål er fylt inn. Bekreft eiendommen og velg plasseringen på nytt.";
    }
  } else if (tokenValid()) {
    await loadPerson();
  }
});
