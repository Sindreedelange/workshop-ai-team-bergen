import { spawn } from "node:child_process";
import { feilmelding } from "../apps/shared/errors.ts";
import { lagGeonorgeFikstur } from "./geonorge-fikstur.ts";

const port = Number(process.env.MATRIKKEL_TEST_PORT || 18085);
const baseUrl = `http://127.0.0.1:${port}`;
const livePort = port + 1;
const liveBaseUrl = `http://127.0.0.1:${livePort}`;
const geonorgePort = port + 2;
const utenNettPort = port + 3;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url: string, forsok = 30): Promise<void> {
  for (let i = 0; i < forsok; i += 1) {
    try {
      const svar = await fetch(url);
      if (svar.ok) return;
    } catch {
      // Server is not up yet.
    }
    await wait(250);
  }
  throw new Error(`Server svarte ikke på ${url}`);
}

function assert(ok: unknown, melding: string): void {
  if (!ok) throw new Error(melding);
}

async function kjor() {
  const prosess = spawn("node", ["apps/matrikkel-mock/src/server.ts"], {
    env: { ...process.env, PORT: String(port) },
    stdio: "inherit"
  });

  try {
    await waitForServer(`${baseUrl}/helse`);

    const alleGaterSvar = await fetch(`${baseUrl}/mock/matrikkel/gater`);
    assert(alleGaterSvar.ok, "Kunne ikke hente gateoversikt");
    // Svarene er any med vilje - se scripts/test-agent-natural-language.ts for begrunnelsen.
    const alleGater = (await alleGaterSvar.json()) as any;
    assert(Array.isArray(alleGater) && alleGater.length >= 5, `Forventet seed-basert gateoversikt, fikk ${alleGater.length} gater`);
    assert(alleGater.some((g: any) => g.adressenavn === "Bønesheien"), "Forventet Bønesheien i seed-basert gateoversikt");

    const gateSvar = await fetch(`${baseUrl}/mock/matrikkel/gater?gate=Storgata`);
    assert(gateSvar.ok, "Gate-oppslag feilet");
    const gateJson = (await gateSvar.json()) as any;
    const gateTreff = Array.isArray(gateJson) ? gateJson : gateJson.items;
    assert(Array.isArray(gateTreff) && gateTreff.some((g) => g.adressenavn === "Storgata"), "Feil gate returnert");

    const fjosSvar = await fetch(`${baseUrl}/mock/matrikkel/gater?gate=Fjøsanger`);
    assert(fjosSvar.ok, "Fjøsanger-oppslag feilet");
    const fjosJson = (await fjosSvar.json()) as any;
    const fjosTreff = Array.isArray(fjosJson) ? fjosJson : fjosJson.items;
    assert(Array.isArray(fjosTreff) && fjosTreff.some((g) => g.adressenavn.includes("Fj")), "Forventet Fjøsangerveien i oppslag");

    const adresseSvar = await fetch(`${baseUrl}/mock/matrikkel/eiendom-oppslag?adresse=${encodeURIComponent("Storgata 5")}`);
    assert(adresseSvar.ok, "Eksakt adresseoppslag feilet");
    const adresseJson = (await adresseSvar.json()) as any;
    assert(adresseJson.adresse === "Storgata 5", "Feil adresse returnert fra eiendom-oppslag");
    assert(typeof adresseJson.husnummer === "number", "Mangler husnummer i rik eiendomsrespons");
    assert(adresseJson.postnummer, "Mangler postnummer i rik eiendomsrespons");
    assert(adresseJson.koordinater && typeof adresseJson.koordinater.lat === "number", "Mangler koordinater i rik eiendomsrespons");

    const soapPayload = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:mat="http://rep.geointegrasjon.no/Matrikkel/Basis/xml.wsdl/2012.01.31">
  <soapenv:Body>
    <mat:HentMatrikkelenhet>
      <matrikkelId>matr-storg-003</matrikkelId>
    </mat:HentMatrikkelenhet>
  </soapenv:Body>
</soapenv:Envelope>`;

    const soapSvar = await fetch(`${baseUrl}/geointegrasjon/matrikkel/wsapi/v1/BasisService`, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8" },
      body: soapPayload
    });

    assert(soapSvar.ok, "SOAP-kall feilet");
    const soapTekst = await soapSvar.text();
    assert(soapTekst.includes("matr-storg-003"), "SOAP-respons mangler forventet matrikkelId");

    await testLiveVei();

    console.log("test:matrikkel-mock OK");
  } finally {
    prosess.kill("SIGTERM");
  }
}

/**
 * Det live-oppslaget må klare når seedfilen ikke har adressen.
 *
 * To ting prøves her, og begge er stille feil hvis de ryker: at eierskapet
 * fortsatt kobler når eiendommen bygges av et Geonorge-svar i stedet for å leses
 * fra fil, og at en Geonorge som ikke svarer gir 404 og ikke 500. Det andre er
 * ikke pedanteri - en treg kilde gjorde en gang et «fant ikke» om til en 502.
 */
async function testLiveVei(): Promise<void> {
  const geonorge = lagGeonorgeFikstur();
  await new Promise<void>((resolve) => { geonorge.listen(geonorgePort, () => resolve()); });
  const live = spawn("node", ["apps/matrikkel-mock/src/server.ts"], {
    env: {
      ...process.env,
      PORT: String(livePort),
      MATRIKKEL_DATA_FILE: "data/matrikkel.seed.json",
      GEONORGE_ADRESSE_API_BASE_URL: `http://127.0.0.1:${geonorgePort}`
    },
    stdio: "inherit"
  });
  // Ingen nett i det hele tatt: en port som ikke lytter. Det er den eneste måten
  // å få et ekte oppslagsforsok til å feile uten å ta ned maskinens nett.
  const utenNett = spawn("node", ["apps/matrikkel-mock/src/server.ts"], {
    env: {
      ...process.env,
      PORT: String(utenNettPort),
      MATRIKKEL_DATA_FILE: "data/matrikkel.seed.json",
      GEONORGE_ADRESSE_API_BASE_URL: "http://127.0.0.1:1"
    },
    stdio: "inherit"
  });

  try {
    await waitForServer(`${liveBaseUrl}/helse`);
    await waitForServer(`http://127.0.0.1:${utenNettPort}/helse`);

    // Å spørre hvem som eier én eiendom er et grunnboksoppslag - offentlig, og det
    // matrikkel_hent_eiere finnes for. Å be om eierlistene for en hel gate er
    // bulkuttrekk, og /mock/matrikkel/eiendommer avviser det allerede. Gateruten er
    // åpen uten token, så den kan ikke være veien utenom. Spørringen står før
    // oppslaget under med vilje: et live-treff legger gaten inn i registeret, og da
    // svarer ruten fra seedveien i stedet for den live veien vi vil kontrollere.
    const gateSvar = await fetch(`${liveBaseUrl}/mock/matrikkel/gater?gate=${encodeURIComponent("Kirkeveien")}&includeEiendommer=true`);
    assert(gateSvar.ok, `Gateoppslaget feilet med ${gateSvar.status}`);
    // Svarene er any med vilje - se scripts/test-agent-natural-language.ts for begrunnelsen.
    const gateEiendommer = ((await gateSvar.json()) as any[]).flatMap((gate) => gate?.eiendommer ?? []);
    assert(gateEiendommer.length > 0, "Gateoppslaget ga ingen eiendommer å kontrollere");
    assert(gateEiendommer.every((e: any) => e.eiere === undefined && e.eierforhold === undefined),
      "Gateruten delte ut eierlister for en hel gate");

    const svar = await fetch(`${liveBaseUrl}/mock/matrikkel/eiendom-oppslag?adresse=${encodeURIComponent("Kirkeveien 32")}&kommunenummer=0301`);
    assert(svar.ok, `Live-oppslaget feilet med ${svar.status}`);
    // Svarene er any med vilje - se scripts/test-agent-natural-language.ts for begrunnelsen.
    const eiendom = (await svar.json()) as any;
    assert(eiendom?.matrikkelId === "matr-geo-0301-13729-32",
      `Live-veien bygget en annen matrikkel-id enn importen: ${eiendom?.matrikkelId}`);
    assert(Array.isArray(eiendom?.eiere) && eiendom.eiere.includes("person-006"),
      `Eierskapet koblet ikke på live-veien: ${JSON.stringify(eiendom?.eiere)}`);
    assert(Array.isArray(eiendom?.eierforhold) && eiendom.eierforhold[0]?.eierform === "SELVEIER",
      "Hjemmelen fra grunnboken fulgte ikke med på live-veien");

    const borte = await fetch(`http://127.0.0.1:${utenNettPort}/mock/matrikkel/eiendom-oppslag?adresse=${encodeURIComponent("Kirkeveien 32")}`);
    assert(borte.status === 404,
      `Uten nett skal et bom gi 404, ikke ${borte.status} - en 5xx leses som at mocken er nede.`);
  } finally {
    live.kill("SIGTERM");
    utenNett.kill("SIGTERM");
    geonorge.close();
  }
}

kjor().catch((error) => {
  console.error(feilmelding(error));
  process.exitCode = 1;
});
