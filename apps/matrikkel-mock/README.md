# matrikkel-mock

Mock av Kartverket Matrikkel Geointegrasjon BasisService - SOAP, med REST-hjelpere ved
siden av. Kjører fra det delte `node:24-alpine`-imaget som alle de andre tjenestene;
Dockerfilen her er bare for å kjøre den frittstående, se nederst.

## Datasett

`matrikkel-mock` starter fra `data/matrikkel.seed.json`: fire håndskrevne bergensgater - Storgata, Nordnesveien, Fjøsangerveien og Laksevågvegen. Ingen av dem finnes i virkeligheten. De er forfattet for at demoene skal ha en fast eiendom å peke på, og den syntetiske befolkningen er forankret i dem.

**Alle andre adresser hentes fra Geonorges åpne adresse-API ved oppslag.** Det er normalveien, ikke et unntak: et søk som bommer i seeden er det vanlige tilfellet. Uten nett degraderer oppslaget til `404` («Fant ikke …»), aldri til en serverfeil.

Eierforholdene ligger i `data/eierforhold.json` og kobles på begge veier - både for seedens eiendommer og for dem som bygges av et Geonorge-svar. Eierskap hører i grunnboken, ikke i matrikkelen. `eiere` er bare med i svaret fra `/mock/matrikkel/eiendommer` når `personId` er oppgitt: å spørre hvem som eier én eiendom er et grunnbokoppslag, å hente eierlistene for en hel gate er bulkuttrekk.

Koblingen hviler på at id-en er den samme begge veier. `byggMatrikkelId` i `apps/shared/adresse.ts` bygger den, og `pnpm test:matrikkel-id` holder importen og live-oppslaget i takt. Går de fra hverandre, svarer oppslaget «ingen eiere» uten å feile.

Den er eneste leser av matrikkeldataene i sandkassen: `sandbox-backend` kaller den over HTTP via `MATRIKKEL_BASE_URL`.

Bakgrunn:

- `seeiendom.no` er fin til manuell utforsking, men frontend-en eksponerer ikke en stabil offentlig bulk-liste over alle veier i Bergen som egner seg godt for automatisert mocking.
- Derfor holder vi `matrikkel-mock` lett og lokalt syntetisk, samtidig som vi beholder håndkuraterte demo-gater som `Storgata`, `Nordnesveien`, `Fjøsangerveien` og `Laksevågvegen`.
- Adressegrunnlaget kommer fra Geonorge ved oppslag. Nett kreves for alt utenfor de fire gatene.

### Teiggrensene ligger ikke her

`matrikkel-mock` svarte en gang på `/mock/matrikkel/teiger` fra et 96,6 MB GeoJSON-uttrekk
over Bergen. Ruten er borte, og filen med den.

Teiggeometrien hentes nå fra Kartverkets åpne eiendoms-API, som `sandbox-backend` kaller
direkte. Tre ting ble bedre av det, og de er grunnen til at uttrekket ikke skal legges
tilbake: kilden dekker hele landet framfor én kommune, den er fersk framfor frosset i
2025, og den svarer på grensekvalitet, tvist og oppdateringsdato - felter uttrekket aldri
hadde, og som derfor alltid sto som ukjent.

`pnpm check:matrikkel-source` feiler hvis uttrekket kommer tilbake i `data/`.

## Kjør lokalt med Node

```bash
node apps/matrikkel-mock/src/server.ts
```

`MATRIKKEL_DATA_FILE` peker på en JSON-fil i `data/matrikkel.seed.json`-formatet.
JSONL- og gzip-formatene er borte sammen med uttrekket de fantes for: et format
uten en skriver er en påstand ingen kan prøve.

I `docker compose` leser `matrikkel-mock` standardfilen `data/matrikkel.seed.json`.

Ved store datamengder kan du bruke `limit` og `offset` på `GET /mock/matrikkel/gater` og `GET /mock/matrikkel/eiendommer`.
Et fullstendig `adresse`-søk på eiendomslisten beholder alle eksakte kandidater,
også fra Geonorge når seeden ikke har treff. Postnummer og poststed avgrenser søket;
adressetillegg som `Aardal` i `Aardal, Haugsbygda 98` er ikke en del av gatenavnet.
Live-fallback leser alle resultatsidene før listen pagineres.

Sjekk aktiv datakilde i en kjørende mock:

```bash
pnpm check:matrikkel-source
```

Mot en annen URL:

```bash
pnpm check:matrikkel-source -- --url=http://localhost:18085/helse
```

## Bygg og kjør eget Docker-image

Sandkassens `docker-compose.yml` bruker **ikke** denne Dockerfilen. Der kjører mocken fra
`node:24-alpine` med `./:/workspace` montert inn, som alle de andre tjenestene, slik at
`data/matrikkel.seed.json` i arbeidstreet alltid er kilden.

Dockerfilen finnes for å kjøre mocken frittstående, uten resten av sandkassen. Da bakes
seedfilen inn i imaget, og du må bygge på nytt hver gang `data/matrikkel.seed.json` endrer seg:

```bash
docker build -t workshop-ai/matrikkel-mock:local -f apps/matrikkel-mock/Dockerfile .
docker run --rm -p 8085:8085 workshop-ai/matrikkel-mock:local
```

## Endepunkt

- `GET /helse`
- `GET /docs`
- `GET /geointegrasjon/matrikkel/wsapi/v1/BasisService?wsdl`
- `POST /geointegrasjon/matrikkel/wsapi/v1/BasisService` (SOAP)
- `GET /mock/matrikkel/gater?gate=Storgata`
- `GET /mock/matrikkel/eiendommer?gate=Storgata`
- `GET /mock/matrikkel/eiendom-oppslag?adresse=Storgata%205`
- `GET /mock/matrikkel/eiendom/matr-storg-003`

Responsene for eiendom inneholder nå også rikere mock-felter som `husnummer`, `husbokstav`, `adressekode`, `postnummer`, `poststed`, `koordinater`, `festenummer` og `undernummer` når data finnes eller kan utledes.

## Tester

Grunnleggende mocktest:

```bash
node scripts/test-matrikkel-mock.ts
```

Bergen bulk-smoke test:

```bash
node scripts/test-bergen-matrikkel-bulk.ts
```

Integrasjonstest for matrikkel-oppslag:

```bash
pnpm test:tools-matrikkel
```

## Støttede SOAP-operasjoner

- `FinnVeger`
- `FinnMatrikkelenheter`
- `HentMatrikkelenhet`
- `HentEiere`

Andre operasjoner fra Geointegrasjon Basis-WSDL svarer med SOAP fault `Client.UnsupportedOperation`.

## Eksempel SOAP-kall

```bash
curl -s -X POST http://localhost:8085/geointegrasjon/matrikkel/wsapi/v1/BasisService \
  -H "Content-Type: text/xml; charset=utf-8" \
  -d '<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:mat="http://rep.geointegrasjon.no/Matrikkel/Basis/xml.wsdl/2012.01.31">
  <soapenv:Body>
    <mat:HentMatrikkelenhet>
      <matrikkelId>matr-storg-003</matrikkelId>
    </mat:HentMatrikkelenhet>
  </soapenv:Body>
</soapenv:Envelope>'
```
