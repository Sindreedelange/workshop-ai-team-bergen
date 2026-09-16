# Datakilder: hvor tallene kommer fra, og hva som er ekte

Sandkassen blander fire slags data, og forskjellen mellom dem er ikke synlig i et svar.
Dette dokumentet er stedet du slår opp hvilket slag noe er, hvor det kommer fra, og når
det hentes.

Kortversjonen, som gjelder uten unntak:

> **Ingen ekte personopplysninger er i sandkassen.** Alle personer, husstander,
> inntekter, legeerklæringer og politiattester er syntetiske.
> **Alle kart-, eiendoms- og regelverksdata er ekte og åpne**, og hentes fra kilden
> når noen spør.

## De fire slagene

| Slag | Hva det betyr | Eksempel |
|---|---|---|
| **Syntetisk befolkning** | Oppdiktede personer, bygget fra Skatteetatens testdatatjeneste Tenor. Ingen av dem finnes. | `personer.json` |
| **Ekte, åpne data hentet live** | Offentlige data uten personopplysninger, hentet fra kilden ved hvert oppslag. Ingenting ligger på disk. | Adresser, teiger, kommuneplan |
| **Ekte, åpne data på disk** | Samme slag, men kopiert inn. Målet er at denne raden skal være tom. | Regelverks-PDF-ene, se under |
| **Mock av noe som ikke finnes** | Et API vi har funnet på formen til, fordi det ikke finnes i virkeligheten. | Legeerklæring, politiattest |

Den siste er den viktigste å ikke misforstå. En mock av en integrasjon som ikke finnes
ser ut som et ferdig API, og er en påstand om hvordan et slikt API *kunne* sett ut.
Hver av disse tjenestene sier det med sine første ord i sin egen README.

## Tabellen

| Datasett | Opphav | Hentes | Slag |
|---|---|---|---|
| `personer`, `husstander`, `inntekter`, `krr`, `folkeregister.seed` | Tenor, pluss et håndskrevet lag personer på terskelverdiene | Genereres av `scripts/importer-tenor.ts`, ligger i git | Syntetisk befolkning |
| `kuratert.json` | Håndskrevet | Ligger i git. Den ene filen du skal redigere for hånd | Syntetisk befolkning |
| `data/tenor/*.json` | Skatteetatens Tenor, uttrekk lagt inn for hånd | Ligger i git. Tenor krever innlogging, så det finnes ikke noe hentescript | Syntetisk befolkning |
| Adresser og gater | Geonorges åpne adresse-API | **Live ved hvert oppslag** | Ekte, åpne data |
| `matrikkel.seed.json` | Håndskrevet: Storgata, Nordnesveien, Fjøsangerveien og Laksevågvegen i Bergen | Ligger i git. **Ingen av gatene finnes i virkeligheten** - de er demoenes faste holdepunkt | Syntetisk |
| Teiger, altså eiendomsgrensene i kartet | Kartverkets åpne eiendoms-API | **Live ved hvert oppslag** | Ekte, åpne data |
| `eierforhold.json` | Utledet: en husstand eier boligen den bor i | Ligger i git, kobles på ved oppslag | Syntetisk. Hjemmel ligger i grunnboken, som sandkassen ikke har |
| Arealformål, reguleringsplan, bygningsflater | Bergen kommunes åpne karttjenester | **Live ved hvert oppslag** | Ekte, åpne data |
| Hensynssoner: støy, fare, angitte hensyn | Bergen kommunes åpne karttjenester | **Live ved hvert oppslag**, forenklet til om lag to meter | Ekte, åpne data |
| `brreg.seed.json` | Tenor-uttrekk av 200 oppdiktede foretak | Ligger i git | Syntetisk |
| `data/pdf/fixtures/` | Lovdata, DiBK, Statens vegvesen, Bergen kommune og arealplaner.no | Ligger i git, indekseres for hånd | Ekte, offentlig regelverk **på disk** |
| `legeerklaeringer.json` | Ingen. **Integrasjonen finnes ikke** | Ligger i git | Mock av noe som ikke finnes |
| `politiattester.json` | Ingen. **Det finnes ikke noe API for politiattest** | Ligger i git | Mock av noe som ikke finnes |
| `satser.json`, `prosessdefinisjoner.json`, `tjenestetilbud.json`, plassdatasettene | Håndskrevet, modellert på ekte forskrift | Ligger i git | Syntetisk. Kontroller mot gjeldende forskrift før du bruker tallene |
| `forventet-utfall.json`, `deltakercaser.json` | Håndskrevet | Leses bare av `scripts/valider-data.ts` | Fasit for testene, ikke en kilde |
| `geonorge.fixtur.json` | Fanget svar fra Geonorge | Ligger i git. Mater den falske Geonorge i testene, **ingen tjeneste leser den** | Testfikstur |

## Hvorfor noe hentes live og noe ikke

Sandkassen hadde 180 MB data i git, og rundt 150 MB av det var ekte, åpne data som
finnes i et API. Det er nå under halvparten, og målet er at ingen av de åpne kildene
skal ligge på disk i det hele tatt.

Begrunnelsen er ikke plass i repoet. Den er at en kopi svarer på noe annet enn kilden:

- **Kopien er frossen.** Teiguttrekket var fra 2025 og dekket bare Bergen. Kartverkets
  API dekker hele landet og er ferskt.
- **Kopien vet mindre.** Uttrekket kunne ikke svare på grensekvalitet, tvist eller når
  eiendommen sist ble oppdatert, så de feltene sto alltid som ukjent. Kilden svarer på
  dem.
- **En kopi som kommer tilbake ser ut som om den virker.** Derfor finnes
  `pnpm check:matrikkel-source`, som feiler hvis et uttrekk legges tilbake i `data/`.

Prisen er at oppslagene trenger nett. Uten nett feiler de synlig: kilden får status
«feil», sjekken blir «uavklart», og innbyggeren får «kontakt kommunen» framfor et svar
bygget på noe som kanskje ikke stemmer lenger. **Manglende kunnskap er aldri et fritak.**

## Hvordan du ser det selv

Hvert svar fra tiltakssjekken bærer kildene sine. `kilder` i grunnlaget har, per kilde:
navn, URL, når den ble hentet, og status - `ok`, `ingen_treff`, `feil` eller
`ikke_sjekket`. Det samme står i revisjonsloggen, og det samme vises nederst på siden i
`demo-gui`.

**Og du ser det mens det skjer.** Tiltakssjekken henter grunnlaget gjennom
`GET /api/garasje/grunnlag/hendelser`, som melder hver kilde to ganger: når
oppslaget settes i gang, og når det er ferdig. Listen over statuslinjen fylles ut
i den rekkefølgen kildene faktisk svarer - de hentes i parallell - så en kilde som
er treg eller ikke svarer er synlig med en gang, framfor å forsvinne i en generell
ventetekst.

Grunnlaget gjenbrukes i tretti sekunder for samme eiendom, slik at kartsteget og
selve sjekken ikke spør de samme seks kildene to ganger. Tidspunktet i kildelisten
er alltid det kilden faktisk svarte, aldri det gjenbruket skjedde.

Er du usikker på om et felt er syntetisk, er `syntetisk`-flagget svaret der det finnes.
Det utelates aldri: et manglende flagg leses som at ingen har tenkt på spørsmålet, mens
`false` med en navngitt kilde ved siden er en avgjørelse noen har tatt.

## Beslektet

- [`docs/syntetiske-data.md`](syntetiske-data.md) - hvordan befolkningen er bygget, og hvilke
  scenarioer den dekker
- [`docs/tiltakshjelpen.md`](tiltakshjelpen.md) - hvilke kilder tiltakssjekken spør, i rekkefølge
- [`docs/sikkerhet-og-personvern.md`](sikkerhet-og-personvern.md) - samtykke, skjerming og
  hva som logges
