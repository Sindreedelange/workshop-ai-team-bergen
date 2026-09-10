# matrikkel-mock

Mock av Kartverket Matrikkel Geointegrasjon BasisService - SOAP, med REST-hjelpere ved
siden av. Kjører fra det delte `node:24-alpine`-imaget som alle de andre tjenestene;
Dockerfilen her er bare for å kjøre den frittstående, se nederst.

## Datasett

`matrikkel-mock` starter fra `data/matrikkel.json` - 388 gater og 18 349 eiendommer i 97 kommuner - og bygger et syntetisk matrikkelregister ved oppstart. Eierforholdene ligger i `data/eierforhold.json` og slås sammen ved innlasting: eierskap hører i grunnboken, ikke i matrikkelen. `eiere` er bare med i svaret fra `/mock/matrikkel/eiendommer` når `personId` er oppgitt - å spørre hvem som eier én eiendom er et grunnbokoppslag, å hente eierlistene for en hel gate er bulkuttrekk. Den er eneste leser av matrikkeldataene i sandkassen: `sandbox-backend` kaller den over HTTP via `MATRIKKEL_BASE_URL`. Mangler et søk i seed-datasettet, prøver mocken å slå opp adressen direkte mot Geonorge.

Bakgrunn:

- `seeiendom.no` er fin til manuell utforsking, men frontend-en eksponerer ikke en stabil offentlig bulk-liste over alle veier i Bergen som egner seg godt for automatisert mocking.
- Derfor holder vi `matrikkel-mock` lett og lokalt syntetisk, samtidig som vi beholder håndkuraterte demo-gater som `Storgata`, `Nordnesveien`, `Fjøsangerveien` og `Laksevågvegen`.
- Adressegrunnlaget hentes med `node scripts/hent-matrikkel.ts`, som henter de gatene befolkningen faktisk bor i fra Geonorges adresse-API. Nett kreves når skriptet kjøres, ikke når sandkassen kjører.

Seedfilen er stabil og skal være nok for vanlig lokal utvikling. Ved enkelte oppslag kan mocken hente data fra Geonorge dersom et treff mangler i seeden.

### Reelle teiggrenser for Bergen

`GET /mock/matrikkel/teiger?kommunenummer=4601&gnr=105&bnr=209&fnr=0`
leser `data/matrikkel_bk_25.json`, et separat GeoJSON-uttrekk med 21 258 teiger.
Dette er reelle grenser, ikke det syntetiske adresse- og eierregisteret over.
Bare `matrikkel-mock` leser filen; andre tjenester bruker dette endepunktet.
Se responsen og parameterne i [OpenAPI-kontrakten](../../openapi/matrikkel-mock.yaml).

- Uttrekket er uttrykkelig bundet til Bergen (4601). Filen har ikke kommunenummer
  eller eget CRS. Koordinatene tolkes etter GeoJSON-standarden som lengdegrad og
  breddegrad i EPSG:4326, ikke som projiserte meter.
- 2025 er året utledet av filnavnet, ikke en måledato eller et løfte om oppdaterte
  grenser. Kilden har ingen nøyaktighets- eller endringsdato som tjenesten kan
  rapportere. Det lages ingen slike verdier.
- `OBJECTID` beholdes som kildeidentitet, aldri som en global teigidentifikator.
  Alle teiger for samme gårds-, bruks- og festenummer beholdes, med alle seksjoner,
  polygoner og hull i opprinnelig rekkefølge. `fnr` betyr **festenummer** her.
  Ingen seksjonsfiltrering støttes i denne første versjonen.
- Enkelte teiger mangler areal i kilden. Den manglende verdien beholdes; den
  erstattes ikke med et beregnet areal. Eieropplysninger og ukjente felter tas
  aldri med i teigresponsen, heller ikke fra en alternativ testfil.
- Andre kommuner får `ikke_dekket` og tom liste, uten å lese Bergen-filen.
  En eiendom uten treff i Bergen får `tilgjengelig` og tom liste. Klienter som
  bruker en offentlig kilde som reserve, kan dermed skille manglende dekning
  fra kildefeil. Denne ruten gjør ikke selv et eksternt reserveoppslag.
- Manglende fil, ugyldig JSON eller ugyldige felter og koordinater gir **502**.
  En gammel indeks eller en tom treffliste skjuler aldri feilen.

Filen lastes først ved et oppslag for Bergen, og indeksen deles mellom samtidige
kall. Filmetadata kontrolleres ved senere oppslag; endringer utløser ny innlasting.
En feilet innlasting kan prøves igjen etter at filen er rettet. Innlastingen
kontrollerer felttyper, endelige koordinater og lukkede ringer, men gjør ikke en
full topologisk kontroll av hele uttrekket.

`MATRIKKEL_TEIG_DATA_FILE` kan settes av den som starter tjenesten for å bruke en
annen GeoJSON-fil, for eksempel i tester. Det erstatter bare Bergen-kilden, aldri
kommuneavgrensningen, og er ikke en parameter innbyggere kan velge. API-et viser
bare filnavnet, ikke den fulle filstien. Et filnavn uten uttrekksår gir ingen
årsangivelse. Det finnes ikke noe endepunkt for å laste ned hele filen.

`GET /helse` viser sist kjente tilstand og antall fra teigindeksen. Det laster
ikke teigfilen og leser ikke filmetadata. Feil i teigkilden hindrer ikke oppstart,
helsesjekken eller de eksisterende adresse-, gate- og SOAP-oppslagene.

## Kjør lokalt med Node

```bash
node apps/matrikkel-mock/src/server.ts
```

`MATRIKKEL_DATA_FILE` støtter fortsatt:

- vanlig JSON (`data/matrikkel.json`-format)
- `jsonl` / `ndjson`
- `jsonl.gz` / `ndjson.gz`

I `docker compose` leser `matrikkel-mock` standardfilen `data/matrikkel.json`. `data/matrikkel.seed.json` er beholdt som liten fixture for mockens egne tester.

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
`data/matrikkel.json` i arbeidstreet alltid er kilden.

Dockerfilen finnes for å kjøre mocken frittstående, uten resten av sandkassen. Da bakes
matrikkelen inn i imaget, og du må bygge på nytt hver gang `data/matrikkel.json` endrer seg:

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
- `GET /mock/matrikkel/teiger?kommunenummer=4601&gnr=105&bnr=209&fnr=0`

Responsene for eiendom inneholder nå også rikere mock-felter som `husnummer`, `husbokstav`, `adressekode`, `postnummer`, `poststed`, `koordinater`, `festenummer` og `undernummer` når data finnes eller kan utledes.

## Tester

Grunnleggende mocktest:

```bash
node scripts/test-matrikkel-mock.ts
```

Teigtest med isolert mock, små testfiler og kontroll av det ekte uttrekket:

```bash
node scripts/test-matrikkel-teiger.ts
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
