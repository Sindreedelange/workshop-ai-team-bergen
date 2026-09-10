# plan-mock

Offline kopi av Bergen kommunes kommuneplan, arealdelen 2018 - KPA2018, PlanID
65270000. Kjører fra det delte `node:24-alpine`-imaget som alle de andre tjenestene.

**Dette er ekte, åpne data, ikke en oppdiktet integrasjon.** Det er verdt å si først,
fordi `pasientjournal-mock` og `politiattest-mock` åpner med det motsatte: de mocker
integrasjoner som ikke finnes. Kommuneplanen finnes, den ligger åpent på
`kart.bergen.kommune.no`, og `sandbox-backend` slår faktisk opp mot den live for
arealformål og reguleringsplaner. Kopien finnes av to grunner, og ingen av dem er at
kilden mangler:

- **Konferansenett.** Et hackathon uten nett skal ikke miste kartsteget i
  [tiltakssjekken «Kan du bygge uten å søke?»](../../docs/garasjesjekk.md).
- **Flate mot punkt.** Live-oppslaget spør om ett punkt og får ingen geometri
  tilbake. Det kan ikke svare på om sonegrensen går tvers gjennom tomten, som er
  spørsmålet innbyggeren faktisk stiller. Uttrekket har flatene, så det kan.

Uttrekket er frosset i 2018. Det er ikke gjeldende plan, og det er ikke
planbestemmelsene. En hensynssone er hjemlet i plan- og bygningsloven § 11-8 og sier
at et hensyn gjelder for området; om et tiltak er tillatt, står i bestemmelsene, og
dem leser ikke denne tjenesten.

## Datasett

Sju filer under `data/`, til sammen omtrent 62 MB og 7 760 objekter. Registeret over
hvilken fil som hører til hvilket datasett, og hvilken kolonne sonekoden står i,
er `src/datasett.ts` - kolonnenavnet varierer fra fil til fil fordi kommunen
eksporterer ett lag per hensynstype. Kodeverket og formen på tråden er felles og
står i `apps/shared/hensynssoner.ts`.

| Datasett | Fil | Sonekoder |
|---|---|---|
| `stoy` | `KpStøySone_gul_2018.geojson` | H220 |
| `fare` | `KpFareSone_2018.geojson` | H310, H320, H350, H390 |
| `friluftsliv` | `KpAngitthensyn_friluftsliv_2018.geojson` | H530 |
| `landskap` | `KpAngitthensyn_landskap_2018.geojson` | H550 |
| `naturmiljoe` | `KpAngitthensyn_naturmiljø_2018.geojson` | H560 |
| `kulturmiljoe` | `KpAngitthensyn_kulturmiljø_2018.geojson` | H570 |
| `arealformaal` | `KpArealformålOmråde_2018.geojson` | 30 kombinasjoner av KPAREALFORMAL og AREALST |

`data/KpOmråde_2018.geojson` er planomrisset og leses ikke. Filene lastes hver for seg
og først når noen spør etter dem, så et hensynssoneoppslag rører ikke den 30 MB store
arealformålsfilen.

Bare `plan-mock` leser disse filene. `sandbox-backend` kaller den over HTTP via
`PLAN_BASE_URL`, på samme måte som den kaller `matrikkel-mock` for teiggrensene. To
lesere av den samme geometrien betyr to kopier av den samme etterbehandlingen, som må
holdes i takt for hånd.

## Ruter

Se [OpenAPI-kontrakten](../../openapi/plan-mock.yaml) for parametere og svarformat.

```bash
curl -s "http://localhost:8090/mock/plan/hensynssoner?kommunenummer=4601&vest=5.2547&sor=60.2534&ost=5.2556&nord=60.2540"
curl -s "http://localhost:8090/mock/plan/arealformaal?kommunenummer=4601&vest=5.2547&sor=60.2534&ost=5.2556&nord=60.2540"
curl -s http://localhost:8090/helse
```

Utsnittet over er eiendommen Litle Milde 65 (gnr 105, bnr 209), som ligger i LNF og i
gul støysone H220_1.

### Ingen token, og det er et valg

Kommuneplanen er et åpent datasett uten personopplysninger, og oppslaget svarer på et
kartutsnitt og ikke på en person - det er ingenting her å knytte til noen.
`matrikkel-mock` står åpen av samme grunn. Det betyr ikke at flaten er uten sperrer:
alle fem parameterne kreves på begge rutene, og utsnittet må være høyst 3000 meter
langs hver side, så tjenesten kan ikke svare på «gi meg hele Bergen». Taket er
høyere enn naboteigrutens 500 fordi tiltakskartet strekker teigen til 4:3, og 492
av Bergens 21 258 teiger blir da bredere enn 500 meter - med det taket svarte
denne ruten 400 nettopp for de eiendommene som oftest ligger i en sone.

## Tre ting som ikke er tilfeldige

**Flatene er klippet til utsnittet.** Den største enkeltdelen i støysonefilen har
106 860 punkter og LNF-flaten 86 027. Uklippet ville ett kartoppslag lastet ned flere
megabyte og tegnet en flate som dekker halve Bergen inn i et utsnitt på 240 × 180
meter. Klippingen gir ringene kanter langs utsnittet som ikke er sonegrenser: ingen
avstand skal måles mot dem. `klippetTilUtsnitt: true` i svaret sier det, og
`sandbox-backend` avviser et svar som ikke gjør det.

**Indeksen ligger på polygondelen, ikke på objektet.**
`KpAngitthensyn_landskap_2018.geojson` har to MultiPolygon-objekter hvis omsluttende
rektangler til sammen dekker hver eneste teig i Bergen. En bbox per objekt ville sagt
«kandidat» for alle oppslag, og indeksen ville vært verdiløs. Derfor er en
MultiPolygon delt i sine deler, og svaret er alltid Polygon.

**`geometry: null` hoppes over, den feiler ikke.** Ett objekt i arealformålsfilen har
null-geometri. Det er gyldig GeoJSON, og et objekt uten flate kan ikke berøre en teig.
Det telles som `antallUtenGeometri` i `/helse` i stedet for å bli borte i stillhet.

## Filene har ikke eget CRS

Ingen av dem har et `crs`-medlem, så GeoJSON-standardens EPSG:4326 gjelder:
koordinatene er lengdegrad og breddegrad, ikke projiserte meter. En fil som kommer med
en CRS-overstyring avvises med 502 i stedet for å bli merket om.

Merk at `SHAPE.STArea()` og `SHAPE.STLength()` i kildens egenskaper er regnet i
projiserte meter av ArcGIS og ikke stemmer med gradkoordinatene ved siden av. De leses
ikke her.

## Kildens egne ord står som de står

`BESKRIVELSE` er kommunens egen tekst - «Eikås motorsport - gul sone», «Brannsmitte»,
«Naturmiljø - ålegraseng» - og den sier hva hensynet konkret gjelder. Den går ordrett
videre til innbyggeren. Kilden har skrivefeil, blant annet «Naturomåde»; de rettes
ikke, fordi teksten er kommunens og ikke vår.

## Frittstående

```bash
PORT=8090 node apps/plan-mock/src/server.ts
```

`PLAN_DATA_DIR` overstyrer mappen filene leses fra; standard er `data/`.
