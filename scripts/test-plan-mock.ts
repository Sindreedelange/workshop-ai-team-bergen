/**
 * plan-mock mot de faktiske KPA2018-filene.
 *
 * De rene funksjonene - klipping, indeksering, kodeverk - testes gjennom HTTP her
 * og ikke hver for seg, fordi det er svaret på tråden garasjesjekken bygger på, og
 * fordi filene er den eneste kilden som kan si om leseren tåler dem. To av
 * påstandene i README-en har en sjekk her hver: at flatene er klippet, og at
 * objektet uten geometri telles i stedet for å bli borte.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { feilmelding } from "../apps/shared/errors.ts";
import type { PlansoneSvar } from "../apps/shared/hensynssoner.ts";
import { DATASETTIDER, PLANSONE_MAX_SIDE_METER } from "../apps/shared/hensynssoner.ts";
import { AREALFORMAALDATASETT, HENSYNSSONEDATASETT } from "../apps/plan-mock/src/datasett.ts";
import { findHensynssone } from "../apps/shared/hensynssoner.ts";
import { isBoundedKartutsnitt } from "../apps/shared/geometri.ts";

const port = Number(process.env.PLAN_TEST_PORT || 18090);
const baseUrl = `http://127.0.0.1:${port}`;

// Litle Milde 65, gnr 105 bnr 209. Ligger i LNF og i gul støysone H220_1.
const litleMilde = { kommunenummer: "4601", vest: "5.2547", sor: "60.2534", ost: "5.2556", nord: "60.2540" };

let bestatt = 0;
const feil: string[] = [];

function check(navn: string, betingelse: unknown, detalj = ""): void {
  if (betingelse) { bestatt += 1; return; }
  feil.push(`${navn}${detalj ? ` - ${detalj}` : ""}`);
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(url: string, forsok = 40): Promise<void> {
  for (let i = 0; i < forsok; i += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Tjenesten er ikke oppe ennå.
    }
    await wait(250);
  }
  throw new Error(`Server svarte ikke på ${url}`);
}

function query(rute: string, params: Record<string, string>): string {
  return `${baseUrl}/mock/plan/${rute}?${new URLSearchParams(params)}`;
}

async function hent(rute: string, params: Record<string, string>): Promise<{ status: number; body: PlansoneSvar }> {
  const svar = await fetch(query(rute, params));
  return { status: svar.status, body: await svar.json() as PlansoneSvar };
}

async function kjor(): Promise<void> {
  // --- helse og datasettregister ------------------------------------------
  const helse = await (await fetch(`${baseUrl}/helse`)).json() as {
    datasett: { id: string; status: string; antallUtenGeometri?: number }[];
  };
  const forventedeIder = [...DATASETTIDER].sort();
  check("helse lister alle datasettene i registeret",
    helse.datasett.map(d => d.id).sort().join(",") === forventedeIder.join(","),
    helse.datasett.map(d => d.id).join(","));
  check("helse laster ingenting av seg selv",
    helse.datasett.every(d => d.status === "ikke_lastet"),
    helse.datasett.map(d => `${d.id}=${d.status}`).join(" "));

  // --- hensynssoner på en eiendom vi vet hva ligger på ---------------------
  const soner = await hent("hensynssoner", litleMilde);
  check("hensynssoner svarer 200", soner.status === 200, String(soner.status));
  check("hensynssoner er tilgjengelig for 4601", soner.body.kildestatus === "tilgjengelig");
  check("hensynssoner oppgir EPSG:4326", soner.body.kilde.koordinatsystem === "EPSG:4326");
  check("hensynssoner er ikke merket syntetisk", soner.body.kilde.syntetisk === false);
  check("hensynssoner sier at svaret er klippet", soner.body.klippetTilUtsnitt === true);
  const navn = soner.body.features.map(f => f.properties.sonenavn);
  check("Litle Milde 65 ligger i gul støysone H220_1", navn.includes("H220_1"), navn.join(","));
  check("støysonen kommer fra støydatasettet",
    soner.body.features.every(f => HENSYNSSONEDATASETT.some(d => d.id === f.properties.datasett)),
    soner.body.features.map(f => f.properties.datasett).join(","));
  check("hensynssoner bærer kildens egen beskrivelse",
    soner.body.features.every(f => f.properties.beskrivelse === null || typeof f.properties.beskrivelse === "string"));
  // At uttrekket bare bruker koder kodeverket kjenner er en egenskap ved dataene,
  // ikke ved én forespørsel. Uten dette står det bare en degradering per oppslag
  // som ingen test når, fordi ingen kode i filene i dag er ukjent.
  const ukjente = new Set<number>();
  for (const datasett of HENSYNSSONEDATASETT) {
    const fc = JSON.parse(await readFile(path.join("data", datasett.fil), "utf8")) as
      { features: { properties: Record<string, unknown> }[] };
    for (const f of fc.features) {
      const kode = f.properties[datasett.kodefelt];
      if (typeof kode !== "number" || !findHensynssone(kode)) ukjente.add(Number(kode));
    }
  }
  check("hver sonekode i uttrekket står i kodeverket", ukjente.size === 0, [...ukjente].join(", "));

  // Klippingen er ikke pynt: uklippet er den største støysonedelen 106 860 punkter.
  // Et tak her fanger at klippingen faller ut, som ville sendt megabyte til nettleseren.
  const punkter = soner.body.features.reduce((n, f) =>
    n + f.geometry.coordinates.reduce((m, ring) => m + ring.length, 0), 0);
  check("de klippede flatene er små", punkter < 500, `${punkter} punkter`);
  check("alle flater er Polygon, ikke MultiPolygon",
    soner.body.features.every(f => f.geometry.type === "Polygon"));
  const utsnitt = { vest: 5.2547, sor: 60.2534, ost: 5.2556, nord: 60.2540 };
  check("ingen koordinat ligger utenfor utsnittet",
    soner.body.features.every(f => f.geometry.coordinates.every(ring => ring.every(([lon, lat]) =>
      lon! >= utsnitt.vest - 1e-9 && lon! <= utsnitt.ost + 1e-9
      && lat! >= utsnitt.sor - 1e-9 && lat! <= utsnitt.nord + 1e-9))));

  // --- arealformål --------------------------------------------------------
  const formaal = await hent("arealformaal", litleMilde);
  check("arealformaal svarer 200", formaal.status === 200, String(formaal.status));
  check("Litle Milde 65 ligger i LNF",
    formaal.body.features.some(f => f.properties.sonekode === 5100 && f.properties.arealstatus === 1),
    formaal.body.features.map(f => `${f.properties.sonekode}/${f.properties.arealstatus}`).join(","));
  check("arealformaal svarer bare med arealformålsdatasettet",
    formaal.body.features.every(f => f.properties.datasett === AREALFORMAALDATASETT.id));
  check("hensynssoneruten svarer ikke med arealformål",
    !soner.body.features.some(f => f.properties.datasett === AREALFORMAALDATASETT.id));

  // Objektet uten geometri i arealformålsfilen skal telles, ikke forsvinne.
  const etter = await (await fetch(`${baseUrl}/helse`)).json() as {
    datasett: { id: string; status: string; antallUtenGeometri?: number; antallDeler?: number }[];
  };
  const arealstatus = etter.datasett.find(d => d.id === AREALFORMAALDATASETT.id)!;
  check("arealformålsfilen er lastet", arealstatus.status === "tilgjengelig", arealstatus.status);
  check("objektet uten geometri telles",
    arealstatus.antallUtenGeometri === 1, String(arealstatus.antallUtenGeometri));
  check("et hensynssonedatasett har ingen objekter uten geometri",
    etter.datasett.filter(d => d.id !== AREALFORMAALDATASETT.id)
      .every(d => d.antallUtenGeometri === 0));

  // --- avgrensning --------------------------------------------------------
  for (const felt of ["kommunenummer", "vest", "sor", "ost", "nord"] as const) {
    const { [felt]: _utelatt, ...mangler } = litleMilde;
    const svar = await fetch(query("hensynssoner", mangler));
    check(`hensynssoner uten ${felt} svarer 400`, svar.status === 400, String(svar.status));
  }
  const ukjentParameter = await fetch(query("hensynssoner", { ...litleMilde, gnr: "105" }));
  check("et ukjent parameter avvises", ukjentParameter.status === 400, String(ukjentParameter.status));

  // Taket på 500 meter er det som hindrer «gi meg hele Bergen» på en åpen flate.
  const forStort = { kommunenummer: "4601", vest: "5.20", sor: "60.20", ost: "5.60", nord: "60.55" };
  check("et utsnitt over taket er avvist av delt logikk",
    !isBoundedKartutsnitt({ vest: 5.2, sor: 60.2, ost: 5.6, nord: 60.55 }, PLANSONE_MAX_SIDE_METER));
  // Garasjekartet strekker teigen til 4:3, og de bredeste teigene i Bergen blir
  // over 800 meter. Med naboteigrutens 500 svarte denne ruten 400 for dem.
  check("taket dekker det bredeste garasjekartet",
    isBoundedKartutsnitt({ vest: 5.2547, sor: 60.2534, ost: 5.2547 + 900 / 55850, nord: 60.2534 + 900 / 111700 },
      PLANSONE_MAX_SIDE_METER));
  check("et for stort utsnitt svarer 400",
    (await fetch(query("hensynssoner", forStort))).status === 400);

  const annenKommune = await hent("hensynssoner", { ...litleMilde, kommunenummer: "0301" });
  check("en annen kommune gir ikke_dekket og tom liste",
    annenKommune.status === 200 && annenKommune.body.kildestatus === "ikke_dekket"
    && annenKommune.body.features.length === 0 && annenKommune.body.kilde.planId === null,
    `${annenKommune.status} ${annenKommune.body.kildestatus}`);
}

/**
 * En fil med CRS-overstyring må gi 502.
 *
 * Egen prosess med PLAN_DATA_DIR, fordi vakten sitter i innlastingen og ikke kan
 * nås uten en fil å laste. Uten den ville et datasett i et annet koordinatsystem
 * blitt merket om til EPSG:4326 i svaret, som er stille feil geometri.
 */
async function kjorCrsVakt(): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "plan-crs-"));
  const crsPort = port + 1;
  try {
    for (const datasett of [...HENSYNSSONEDATASETT, AREALFORMAALDATASETT]) {
      await writeFile(path.join(dir, datasett.fil), JSON.stringify({
        type: "FeatureCollection",
        crs: { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::25833" } },
        features: [],
      }));
    }
    const prosess = spawn("node", ["apps/plan-mock/src/server.ts"], {
      env: { ...process.env, PORT: String(crsPort), PLAN_DATA_DIR: dir },
      stdio: ["ignore", "ignore", "inherit"],
    });
    try {
      await waitForServer(`http://127.0.0.1:${crsPort}/helse`);
      const svar = await fetch(`http://127.0.0.1:${crsPort}/mock/plan/hensynssoner?${new URLSearchParams(litleMilde)}`);
      const kropp = await svar.json() as { feil?: string };
      check("en fil med CRS-overstyring gir 502", svar.status === 502, `${svar.status} ${kropp.feil ?? ""}`);
      check("feilmeldingen røper ikke filstien", !String(kropp.feil).includes(dir), String(kropp.feil));
    } finally {
      prosess.kill("SIGTERM");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const prosess = spawn("node", ["apps/plan-mock/src/server.ts"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "ignore", "inherit"],
});

try {
  await waitForServer(`${baseUrl}/helse`);
  await kjor();
  await kjorCrsVakt();
} catch (error) {
  feil.push(feilmelding(error));
} finally {
  prosess.kill("SIGTERM");
}

if (feil.length > 0) {
  console.error(`test-plan-mock: ${feil.length} av ${bestatt + feil.length} sjekker feilet.`);
  for (const linje of feil) console.error(`  - ${linje}`);
  process.exit(1);
}
console.log(`test-plan-mock ok. ${bestatt} sjekker mot de faktiske KPA2018-filene, uten stack.`);
