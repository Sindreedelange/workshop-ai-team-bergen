import type {
  GarasjeAdresse, GarasjeGrunnlag, GarasjePolygon, GarasjePunkt, GarasjeTiltak, GarasjeVurdering
} from "../../../shared/garasje.ts";
import { fitKartutsnitt, projectGarasjePunkt, unprojectGarasjePunkt } from "./garasje-kart.ts";

type GarasjeSvar = { grunnlag: GarasjeGrunnlag; vurdering: GarasjeVurdering; sporingsId: string };
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
let aiBase = "";
const pageParams = new URLSearchParams(location.search);
const embedded = pageParams.has("integrert");
const embeddedOektId = pageParams.get("oektsId");
const embeddedStegId = pageParams.get("stegId");
let embeddedOekt: Prosessoekt | null = null;
let pendingSave = false;
let helpField: string | undefined;
const helpHistory: { rolle: string; tekst: string }[] = [];
let busy = false;
let propertyConfirmed = false;
let placementChosen = false;
let valgtAdresse: GarasjeAdresse | null = null;
let plassering: GarasjePunkt | null = null;
let grunnlag: GarasjeGrunnlag | null = null;
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

async function api<T>(path: string): Promise<T> {
  if (!tokenValid()) throw new Error("Innloggingen er utløpt. Logg ut og inn igjen for å fortsette.");
  const response = await fetch(`${backendBase}${path}`, {
    headers: withToken(), signal: AbortSignal.timeout(60000), cache: "no-store"
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) {
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
    throw new Error(data.feil || `Oppslaget feilet (HTTP ${response.status}).`);
  }
  return data as T;
}

function invalidateResult(): void {
  vurdering = null;
  krevEl("assessment").hidden = true;
}

function clearConfirmation(): void {
  propertyConfirmed = false;
  form.hidden = true;
  krevEl("confirm-reminder").hidden = false;
  krevEl("confirm-property").hidden = true;
  krevEl("confirm-note").textContent = "";
  invalidateResult();
}

async function perform(label: string, action: () => Promise<void>): Promise<void> {
  if (busy || pendingSave) return;
  busy = true;
  krevEl("error").hidden = true;
  krevEl("progress").textContent = label;
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
    controls.forEach(control => { control.disabled = pendingSave; });
    busy = false;
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
  return new URLSearchParams({
    adresse: valgtAdresse.adressetekst,
    kommunenummer: valgtAdresse.kommunenummer,
    gnr: String(valgtAdresse.gardsnummer), bnr: String(valgtAdresse.bruksnummer),
    lat: String(plassering.lat), lon: String(plassering.lon)
  });
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
      button.addEventListener("click", () => void perform("Henter eiendom og plangrunnlag …", () => selectAdresse(adresse)));
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
  facts.append(element("p", `Kommune ${adresse.kommunenummer} · Gnr. ${adresse.gardsnummer}, bnr. ${adresse.bruksnummer}` +
    (adresse.festenummer ? `, festenr. ${adresse.festenummer}` : ""), "ds-paragraph"));
  facts.append(element("p", "Identifisert i det offentlige adresseregisteret. Eierskapet i sandkassen er syntetisk og sier ikke hvem som eier eiendommen i virkeligheten.", "ds-paragraph muted"));
  facts.hidden = false;
  bounds = fitKartutsnitt([], adresse.punkt);
  await refreshGrunnlag();
  krevEl("confirm-property").hidden = false;
  krevEl("confirm-note").textContent = `Kontroller at ${adresse.adressetekst}, gnr. ${adresse.gardsnummer}/bnr. ${adresse.bruksnummer}, er eiendommen du vil sjekke. Kartet under viser tomten.`;
}

async function refreshGrunnlag(): Promise<void> {
  invalidateResult();
  grunnlag = null;
  krevEl("plan-facts").replaceChildren();
  krevEl("sources").replaceChildren();
  const data = await api<GarasjeGrunnlag>(`/api/garasje/grunnlag?${selectedQuery()}`);
  grunnlag = data;
  krevEl("property-workspace").hidden = false;
  renderGrunnlag(data);
  renderMap(data);
  updateMarker();
  krevEl("placement-note").textContent = placementChosen
    ? "Plangrunnlaget gjelder den valgte garasjeplasseringen. Markøren viser ett punkt, ikke hele bygget."
    : "Markøren viser foreløpig adressepunktet. Velg aktivt hvor garasjen skal stå ved å klikke, dra eller bruke retningsknappene.";
}

function renderGrunnlag(data: GarasjeGrunnlag): void {
  const facts = krevEl("plan-facts");
  facts.replaceChildren();
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
      facts.append(element("p", `Teig ${teig.teigId ?? polygon.id} · ${teig.gnr}/${teig.bnr}. ` +
        `Kvalitetsklasse fra Kartverket: ${polygon.kvalitetsklasse ?? teig.kvalitet ?? "ikke oppgitt"}. ` +
        `Tvist: ${teig.tvist ?? "ikke oppgitt i denne kilden"}.` +
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
    facts.append(element("p", "I denne demonstrasjonscasen skal bestemmelsene om garasje og gjerde undersøkes i plandokumentene. Karttreffet alene bekrefter ikke innholdet.", "ds-paragraph"));
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
    if (kilde.merknad) item.append(element("p", kilde.merknad, "ds-paragraph"));
    list.append(item);
  }
  krevEl("sources").replaceChildren(list);
}

function xy(punkt: GarasjePunkt): [number, number] {
  return projectGarasjePunkt(punkt, bounds);
}

function drawPolygons(id: string, polygons: GarasjePolygon[], className: string): void {
  const group = svg.querySelector(`#${id}`)!;
  group.replaceChildren();
  for (const polygon of polygons) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", className);
    path.setAttribute("fill-rule", "evenodd");
    path.setAttribute("d", polygon.ringer.map(ring => ring.map(([lon, lat], index) => {
      const [x, y] = xy({ lon, lat });
      return `${index === 0 ? "M" : "L"}${x},${y}`;
    }).join(" ") + " Z").join(" "));
    group.append(path);
  }
}

function renderMap(data: GarasjeGrunnlag): void {
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
  drawPolygons("map-buildings", data.bygninger, "building");
}

function updateMarker(): void {
  if (!plassering) return;
  const [x, y] = xy(plassering);
  const marker = svg.querySelector("#map-marker")!;
  marker.setAttribute("cx", String(x));
  marker.setAttribute("cy", String(y));
}

function moveMarker(punkt: GarasjePunkt): void {
  if (busy || !valgtAdresse) return;
  if (punkt.lat < bounds.south || punkt.lat > bounds.north || punkt.lon < bounds.west || punkt.lon > bounds.east) {
    krevEl("placement-note").textContent = "Markøren er ved kanten av kartutsnittet. Velg en plassering innenfor utsnittet.";
    return;
  }
  plassering = punkt;
  placementChosen = true;
  invalidateResult();
  updateMarker();
  krevEl("placement-note").textContent = "Plasseringen er endret. Hent planer for denne plasseringen før du leser kartgrunnlaget. Søknadssjekken henter alltid oppdaterte data.";
  krevEl("plan-facts").replaceChildren(element("p", "Tidligere planopplysninger er skjult fordi plasseringen er endret.", "ds-paragraph"));
  krevEl("sources").replaceChildren();
  grunnlag = null;
}

const numericFields: { id: keyof GarasjeTiltak; label: string; hint: string; max: number; optional?: boolean; integer?: boolean }[] = [
  { id: "bya", label: "Bebygd areal (BYA), m²", hint: "Byggets fotavtrykk, inkludert areal som skal medregnes.", max: 10000 },
  { id: "bra", label: "Bruksareal (BRA), m²", hint: "Bruksarealet innenfor omsluttende vegger.", max: 10000 },
  { id: "gesimshoyde", label: "Høyde der vegg og tak møtes (gesimshøyde), meter", hint: "Måles fra gjennomsnittet av bakken rundt bygget etter terrengarbeidene. Spør KI om takformen eller målepunktet er uklart.", max: 100 },
  { id: "monehoyde", label: "Høyde til mønet på taket (mønehøyde), meter", hint: "Måles fra samme gjennomsnittsnivå som gesimshøyden. Et flatt tak har ikke et vanlig møne; avklar målepunktet.", max: 100 },
  { id: "etasjer", label: "Antall etasjer", hint: "Alle etasjer i det planlagte bygget.", max: 100, integer: true },
  { id: "avstandNabogrense", label: "Avstand til nabogrense, meter", hint: "Korteste avstand fra bygget. La stå tomt hvis ukjent.", max: 10000, optional: true },
  { id: "avstandBygning", label: "Avstand til annen bygning på eiendommen, meter", hint: "Korteste avstand. La stå tomt hvis ukjent.", max: 10000, optional: true }
];
const booleanFields: { id: keyof GarasjeTiltak; label: string }[] = [
  { id: "frittliggende", label: "Er garasjen frittliggende?" },
  { id: "beboelse", label: "Skal bygget brukes til beboelse eller overnatting?" },
  { id: "kjeller", label: "Skal bygget ha kjeller?" },
  { id: "overVannAvlop", label: "Skal garasjen stå over vann- eller avløpsledninger?" }
];

function renderFields(): void {
  const container = krevEl("garage-fields");
  for (const field of numericFields) {
    const wrapper = element("div", undefined, "ds-field");
    const label = element("label", field.label, "ds-label");
    label.htmlFor = field.id;
    const input = element("input", undefined, "ds-input");
    input.id = field.id;
    input.name = field.id;
    input.type = "number";
    input.min = field.id === "etasjer" ? "1" : field.optional ? "0" : "0.01";
    input.max = String(field.max);
    input.step = field.integer ? "1" : "any";
    input.required = !field.optional;
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

function readTiltak(): Record<string, number | boolean | null> {
  const data = new FormData(form);
  const tiltak: Record<string, number | boolean | null> = { bebygdEiendom: null };
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
  const labels = { ikke_soknadspliktig: "Ikke søknadspliktig", soknadspliktig: "Garasjen faller utenfor unntaket", maa_avklares: "Dette må avklares før du bygger" };
  const colors = { ikke_soknadspliktig: "success", soknadspliktig: "warning", maa_avklares: "info" };
  krevEl("result-heading").textContent = labels[data.vurdering.utfall];
  const summary = krevEl("result-summary");
  summary.dataset.color = colors[data.vurdering.utfall];
  summary.replaceChildren(element("p", data.vurdering.forklaring, "ds-paragraph"));
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
    note.textContent += " Ingen eide eiendommer funnet for testpersonen. Bruk adressesøket eller en demonstrasjonsadresse.";
    if (bostedsadresse) searchInput.value = bostedsadresse;
  }
}

renderFields();
krevEl("login").addEventListener("click", () => void perform("Åpner ID-porten …", async () => {
  if (await requireLogin({ idportenBaseUrl: idportenBase })) await loadPerson();
}));
krevEl("logout").addEventListener("click", () => { logOut(); location.reload(); });
krevEl<HTMLSelectElement>("theme").addEventListener("change", event => {
  document.documentElement.dataset.colorScheme = (event.target as HTMLSelectElement).value;
});
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
krevEl("confirm-property").addEventListener("click", () => {
  if (!valgtAdresse || busy) return;
  propertyConfirmed = true;
  krevEl("confirm-property").hidden = true;
  krevEl("confirm-reminder").hidden = true;
  krevEl("confirm-note").textContent = `Bekreftet: ${valgtAdresse.adressetekst}, kommune ${valgtAdresse.kommunenummer}, gnr. ${valgtAdresse.gardsnummer}/bnr. ${valgtAdresse.bruksnummer}.`;
  form.hidden = false;
});
for (const [id, adresse] of [["case-milde", "Litle Milde 65"], ["case-krakenes", "Kråkenestoppen 60"]]) {
  krevEl(id).addEventListener("click", () => void perform("Henter demonstrasjonsadressen …", () => searchAdresse(adresse, "4601")));
}
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
for (const [id, dx, dy] of [
  ["move-north", 0, 2], ["move-south", 0, -2], ["move-west", -2, 0], ["move-east", 2, 0]
] as const) {
  krevEl(id).addEventListener("click", () => {
    if (!plassering) return;
    moveMarker({
      lat: plassering.lat + dy / 111320,
      lon: plassering.lon + dx / (111320 * Math.cos(plassering.lat * Math.PI / 180))
    });
  });
}
krevEl("reset-placement").addEventListener("click", () => {
  if (valgtAdresse) {
    moveMarker({ ...valgtAdresse.punkt });
    placementChosen = false;
    krevEl("placement-note").textContent = "Markøren er tilbake ved adressepunktet. Velg garasjeplassering før du kjører sjekken.";
  }
});
krevEl("refresh-placement").addEventListener("click", () => void perform("Henter planer for plasseringen …", refreshGrunnlag));
svg.querySelector("#map-image")!.addEventListener("error", () => {
  krevEl("placement-note").textContent = "Bakgrunnskartet kunne ikke lastes. Eventuelle eiendomsflater vises fortsatt. Dette gir ingen bekreftelse på fravær av begrensninger.";
});
form.addEventListener("input", event => {
  invalidateResult();
  if (event.target instanceof HTMLInputElement) event.target.removeAttribute("aria-invalid");
});
form.addEventListener("focusin", event => {
  const target = event.target;
  if (target instanceof HTMLInputElement && numericFields.some(field => field.id === target.id)) {
    helpField = target.id;
  }
});
form.addEventListener("change", invalidateResult);
form.addEventListener("invalid", event => {
  if (event.target instanceof HTMLInputElement) event.target.setAttribute("aria-invalid", "true");
}, true);
form.addEventListener("submit", event => {
  event.preventDefault();
  if (!propertyConfirmed) {
    krevEl("error").textContent = "Bekreft eiendommen før du kjører garasjesjekken.";
    krevEl("error").hidden = false;
    return;
  }
  if (!placementChosen) {
    krevEl("error").textContent = "Plasser garasjen i kartet først. Du kan klikke, dra eller bruke retningsknappene.";
    krevEl("error").hidden = false;
    return;
  }
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
  link.download = "garasjesjekk.json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
krevEl("print").addEventListener("click", () => window.print());
async function askGarasjeQuestion(text: string): Promise<void> {
  const button = krevEl<HTMLButtonElement>("help-send");
  if (button.disabled) return;
  button.disabled = true;
  const answer = krevEl("help-answer");
  answer.textContent = "KI forklarer …";
  try {
    const response = await fetch(`${aiBase}/ai/sporsmaal`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(180000),
      body: JSON.stringify({
        tekst: text, sprak: "nb", sporingsId: embeddedOekt?.sporingsId,
        kontekst: {
          tjeneste: "Garasjesjekken", prosessId: "garasjesjekk",
          steg: { id: "garasje-prosjekt", type: "QUESTION", tittel: "Forklar begreper og hvordan man måler garasjen" },
          flyt: { status: embeddedOekt?.status || "AKTIV", soknadSendt: false },
          resultater: grunnlag ? { garasje: grunnlag } : {},
          aktivtFelt: helpField ? { id: helpField } : undefined,
          samtale: helpHistory.slice(-4)
        }
      })
    });
    const data: { tekst?: string; feil?: string; advarsel?: string } = await response.json();
    if (!response.ok || !data.tekst) throw new Error(data.feil || "KI-tjenesten svarte uten en forklaring.");
    answer.textContent = data.tekst + (data.advarsel ? ` (${data.advarsel})` : "");
    helpHistory.push({ rolle: "innbygger", tekst: text }, { rolle: "assistent", tekst: data.tekst });
  } catch (error) {
    answer.textContent = `Kunne ikke forklare nå: ${feilmelding(error)}. Prøv igjen. Opplysningene dine er ikke endret.`;
  } finally {
    button.disabled = false;
  }
}
krevEl("help-form").addEventListener("submit", event => {
  event.preventDefault();
  void askGarasjeQuestion(krevEl<HTMLTextAreaElement>("help-question").value.trim());
});
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-help]")) {
  button.addEventListener("click", () => {
    helpField = button.dataset.helpField;
    void askGarasjeQuestion(button.dataset.help!);
  });
}

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
    }
    if (event.data?.type === "garasje-lagret") {
      krevEl("progress").textContent = "Opplysningene er lagret. Fortsett i prosessflyten utenfor kartet.";
    }
  });
  new ResizeObserver(() => {
    window.parent.postMessage({ type: "garasje-hoyde", hoyde: document.body.scrollHeight + 16 }, location.origin);
  }).observe(document.body);
}
void perform("Klargjør Garasjesjekken …", async () => {
  backendBase = sandkasseKonfigurasjon.backendBaseUrl;
  idportenBase = sandkasseKonfigurasjon.idportenBaseUrl;
  aiBase = sandkasseKonfigurasjon.aiBaseUrl;
  if (embedded) {
    if (window.parent === window || !embeddedOektId || !embeddedStegId) throw new Error("Åpne dette steget fra Chat, AI-agent eller Stegvis.");
    embeddedOekt = await api<Prosessoekt>(`/api/prosessoekter/${encodeURIComponent(embeddedOektId)}`);
    if (embeddedOekt.prosessId !== "garasjesjekk") throw new Error("Prosessøkten er ikke en garasjesjekk.");
    if (pageParams.get("integrert") === "resultat") {
      const data = embeddedOekt.resultater?.["garasje-vurdering"];
      if (!data || typeof data !== "object" || !("grunnlag" in data) || !("vurdering" in data)) throw new Error("Ingen lagret garasjevurdering i økten.");
      const result = data as GarasjeSvar;
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
      if (typeof values.adresse === "string" && values.adresse !== valgtAdresse?.adressetekst) await searchAdresse(values.adresse);
      for (const field of numericFields) {
        const value = values[field.id];
        if (typeof value === "number" || (typeof value === "string" && value !== "vet-ikke")) krevEl<HTMLInputElement>(field.id).value = String(value);
      }
      for (const field of booleanFields) {
        const value = values[field.id];
        krevEl<HTMLSelectElement>(field.id).value = value === true || value === "ja" ? "true" : value === false || value === "nei" ? "false" : "";
      }
      krevEl("confirm-note").textContent += " Tidligere mål er fylt inn. Bekreft eiendommen og velg plasseringen på nytt.";
    }
  } else if (tokenValid()) {
    await loadPerson();
  }
});
