# Garasjesjekken

En felles prosess i Chat, AI-agent og Stegvis, med Bergen som pilot.
Innbyggeren beskriver garasjen, mens tjenesten henter adresse, eiendomsidentitet og
tilgjengelig plangrunnlag. Dette er veiledning, ikke et kommunalt vedtak eller en
byggesøknad.

## Start

Start sandkassen med `./start.sh --mock` og velg **Garasjesjekken** under
«Tjenester for innbyggere» på oversikten. Velg Chat, AI-agent eller Stegvis.
Kartet og eiendomsbekreftelsen er innebygd i alle tre inngangene, og vurderingen
lagres i den vanlige prosessøkten. `/garasje` er fortsatt tilgjengelig som frittstående
veiviser.

Bruk ID-porten-testinnloggingen. Bostedsadressen foreslås først, og egne
eiendommer vises som alternativer. Bosted og eierskap er forskjellige opplysninger.
Adressebeskyttelse skal ikke omgås for å fylle ut et felt.

KI kan forklare ord som gesimshøyde, mønehøyde, BRA og BYA med vanlig språk.
Et slikt spørsmål lagres aldri som et svar på et prosessteg og flytter ikke flyten
videre. Med `--mock` får du faste, kildebaserte forklaringer. Med en konfigurert
språkmodell kan KI formulere forklaringene. Selve vurderingen bruker alltid faste
regler, ikke modellen.

Garasjesjekken starter i mørkt tema. Valget av lyst eller mørkt tema lagres lokalt
i nettleseren og gjenbrukes ved omlasting og i den innebygde garasjevisningen.
Bare temavalget lagres der, ikke opplysninger om eiendommen eller garasjen.

Innloggingen og eieropplysningene er syntetiske. Testpersonen eier **ikke**
dermed en virkelig eiendom. Adresse- og kartoppslag bruker offentlige tjenester,
og bare søketekst og geografiske opplysninger sendes dit, ikke personidentitet,
token eller eierlister. En syntetisk bostedsadresse finnes ikke nødvendigvis i det
virkelige adresseregisteret. Da kan innbyggeren søke selv i den frittstående
Garasjesjekken.
Adresse- og eiendomsoppslag er nasjonale. Bare Bergen har et kommunalt plan- og
bygningsoppsett i workshopen. Andre kommuner får derfor uavklarte kommunale
forhold, aldri Bergen-data som reserve.

## To demonstrasjonscaser

| Adresse | Eiendom i Bergen | Hva casen skal synliggjøre |
|---|---|---|
| Litle Milde 65 | Gnr. 105, bnr. 209 | LNF er ikke i seg selv et automatisk avslag eller bevis på søknadsplikt. |
| Kråkenestoppen 60 | Gnr. 20, bnr. 1413 | Kommuneplanens formål er ikke nok: lokale planbestemmelser om blant annet garasje og gjerde må undersøkes. |

Logg inn som **Milda Garasjetest** (`person-395`) for Litle Milde, eller
**Kåre Garasjetest** (`person-396`) for Kråkenestoppen. Bosted, husstand og eierskap
genereres fra `data/kuratert.json` med den vanlige importeren. Adresseidentitetene
ligger i matrikkelmockens seed, så oppslaget av egne eiendommer ikke er avhengig av
et eksternt fallback-kall.

Testpersonene ligger i det felles personregisteret og kan også brukes i TT-kort,
politiattest og andre prosesser. Det betyr ikke at de har legeerklæring,
politiattest eller oppfyller vilkårene for disse tjenestene.

Adressene bruker vanlige oppslag, ikke forhåndsbestemte svar eller egne
«Prøv en case»-knapper.
Oppslaget ved adressepunktet for Litle Milde viste LNF i KPA2018. Ved
Kråkenestoppen viste det «Øvrig byggesone» og bebyggelsesplan 6170063, Bønes øst,
felt 19A. Disse karttreffene alene dokumenterer ikke hva en bestemt garasje kan
bygges som. Eksisterende garasjer, høyder, utnyttelse og den planlagte plasseringen
kan endre vurderingen.

## Slik brukes resultatet

1. Velg en eid eiendom eller et konkret adressetreff. Bosted foreslås først når
   adressen også finnes blant de eide eiendommene. Kommunenummer og gnr./bnr.
   følger med fra kilden.
2. Kontroller adressen og gnr./bnr., og trykk «Bekreft eiendom». Før dette vises
   bare eiendomsvalget. Kart, nabotomter, bebyggelse og planopplysninger hentes
   først etter bekreftelsen, slik at feil adresser ikke utløser tunge kartoppslag.
   Kartet tilpasses eiendomsgeometrien med omtrent ti meter eller mer rundt.
3. Plasser garasjen ved å klikke eller dra markøren, eller bruk retningsknappene.
   Adressepunktet regnes ikke automatisk som en valgt garasjeplassering.
   Trykk «Bekreft plassering og fortsett». Vi henter planer for punktet før
   spørsmålene om garasjen vises. Kartet og spørsmålene vises ikke samtidig.
   Du kan gå tilbake med «Endre eiendom» eller «Endre plassering» uten å miste
   svarutkastet, men den nye plasseringen må bekreftes før du kan fortsette.
4. Velg «Chat med AI-agent» eller «Stegvis utfylling». Agenten ber om
   ett svar om gangen, forklarer spørsmål underveis og foreslår en tolket verdi
   som du bekrefter med «Bruk svaret». Stegvis vises ett felt om gangen.
   Begge bruker samme svarutkast, så du kan bytte uten å miste svar.
5. Les den regelbaserte vurderingen, begrunnelsene og kildenes dekningsstatus.
6. Last ned vurderingen med grunnlaget, eller skriv den ut.

Du får en oppsummering før sjekken kjøres. Fagspørsmål flytter ikke utfyllingen
videre, og et agentsvar blir ikke en lagret verdi uten bekreftelse. Den
felles agenten bruker den samme valideringen av mål og valg som den øvrige
garasjedialogen. Ved modellfeil kan du fortsette stegvis uten å miste utkastet.
«Endre svaret» viser hvilket felt du retter, legger teksten tilbake i tekstboksen
og flytter fokus dit. Forslaget lagres ikke før du bekrefter det. Ved «Endre»
i oppsummeringen vises det nåværende svaret og feltet du redigerer.

Svar og fagspørsmål skrives i den samme tekstboksen. Den er også tilgjengelig
under stegvis utfylling og når du ser over svarene, uten et separat hjelpeskjema.

Nabotomter i kartutsnittet vises med stiplede grenser, mens valgt eiendom har
heltrukken rød grense. Eiendomsnumre vises på kartet der det er plass.
Kilden er tilgjengelig under «Datakilde for nabogrenser», uten en detaljliste
over nabotomtenes areal og kvalitet. Eieropplysninger hentes ikke. Dette er
tomter i utsnittet, ikke en fullstendig eller juridisk bekreftet naboliste.
Naboflatene inngår ikke i arealberegningen eller reglene for valgt eiendom.

Endrer du adressen, skjules kartet og det gamle grunnlaget til den nye
eiendommen er bekreftet. Feiler hentingen, vises en knapp for å prøve igjen.

Nasjonale vilkår vurderes separat fra planforhold og andre begrensninger.
En garasje som oppfyller størrelsesgrensene er ikke automatisk lovlig plassert.
LNF/LNFR kan ha bestemmelser som åpner for enkelte tiltak, mens en boligregulert
tomt kan ha begrensninger som krever avklaring.

**En mislykket henting, manglende dekning eller uavklart bestemmelse blir aldri
tolket som fravær av begrensninger.** Tjenesten må da si at forholdet må avklares.
Den viser ikke et ubetinget «ikke søknadspliktig» bare fordi nasjonale
størrelsesgrenser er oppfylt. Dispensasjon og byggetillatelse er heller ikke det
samme; en slik avklaring må gjøres mot det konkrete plangrunnlaget.

## Kilder og avgrensninger

### Kommuner, soner og regler i kode

| Modul | Ansvar |
|---|---|
| [`garasje-kommuner.ts`](../apps/shared/garasje-kommuner.ts) | Kobler kommunenummer til kommunens kartlag, planportal, plan-ID, versjon og bestemmelser. Bergen-PDF-en hører bare til `4601`. |
| [`arealsoner.ts`](../apps/shared/arealsoner.ts) | Kontrollerte sonetyper, nøklet på kommune, plan, versjon, arealformål og arealstatus. Ukjente kombinasjoner forblir ukjente. |
| [`garasje-regelgrunnlag.ts`](../apps/shared/garasje-regelgrunnlag.ts) | Nasjonale tallkrav, enheter og kilder. Den samme definisjonen brukes av reglene og KI-grunnlaget. |
| [`garasje-begreper.ts`](../apps/shared/garasje-begreper.ts) | Kildebaserte forklaringer av fagord. |
| [`garasje-dialog.ts`](../apps/shared/garasje-dialog.ts) | Felles utfyllingsfelter, enheter og validering for samtale og stegvis utfylling. |
| [`garasje-kunnskap.ts`](../apps/shared/garasje-kunnskap.ts) | Et begrenset, strukturert grunnlag for språkmodellen, uten persondata eller rå kartgeometri. |

En ny kommune legges til med egne kilder og kontrollerte sone-/planopplysninger,
ikke ved å endre den generelle prosessflyten. Et sonenavn gir ikke alene en
utnyttelsesgrense eller byggetillatelse. Slike regler trenger en konkret,
kontrollert bestemmelse med kilde.

`GET /api/garasje/veiledning` viser det tjenestespesifikke kunnskapsgrunnlaget.
De felles KI-verktøyene er fortsatt tjenestenøytrale. Garasjegrunnlaget legges
bare til for en garasjekontekst; de øvrige casene bruker sine eksisterende data
og regler.

`POST /agent/garasje/dialog` gir et svarforslag eller en forklaring for det
aktive utfyllingsfeltet. Det oppretter ingen prosessøkt, lagrer ingen skjemasvar
og sender ingen søknad. KI-kall spores som ellers i sandkassen. Svarene sendes
til den vanlige prosessflyten først når alle svarene er
gjennomgått og innbyggeren bekrefter at de skal brukes.

### Eksisterende bebyggelse og areal

Innbyggeren blir ikke spurt om bebyggelse som allerede kan hentes fra kartet.
Bygningsflater kobles geometrisk til valgt teig, og tilgjengelig bygningsnummer,
type, status og registrert BRA vises med kilden. Dette er ikke en garanti for
fullstendig bygningsregister eller lovlig bruk.

Arealberegningen viser tomteareal, unionen av kartlagte bygningsflater innenfor
tomten og denne andelen i prosent. Overlapp telles bare én gang, og hull og
tomtegrensen tas med. Ved kildefeil beholdes tilgjengelig tomteareal, mens
bygningsareal og andel blir ukjent. Metode og forbehold vises i grensesnittet.

**Kartandelen er ikke juridisk utnyttelsesgrad.** Parkering, overbygg og
planbestemte måleregler kan påvirke BYA/BRA. Tillatt utnyttelse for hver sone er
ikke lagt inn som antatte prosentgrenser; det må komme fra de relevante
planbestemmelsene.

### Offentlige kilder

- [`matrikkel_bk_25.json`](../data/matrikkel_bk_25.json): lokalt Bergen-uttrekk,
  merket 2025, med teigpolygoner og oppgitt areal. Matrikkelmocken er eneste
  tjeneste som leser filen. Garasjesjekken slår opp på kommunenummer, gnr./bnr.
  og festenummer gjennom API-et.
- [Kartverkets adresse-API](https://ws.geonorge.no/adresser/v1/): adresse,
  eiendomsidentifikator og adressepunkt. Et adressepunkt er ikke tomten.
- [Geonorge: Matrikkelen - Eiendomskart Teig](https://kartkatalog.geonorge.no/metadata/uuid/74340c24-1c8a-4454-b813-bfe498e80f16):
  eiendomsgeometri via Kartverkets dokumenterte eiendoms-API. GeoJSON-geometrien
  hentes for den konkrete matrikkelidentiteten, ikke fra et generisk eksempel.
- [Bergens karttjenester](https://kart.bergen.kommune.no/arcgis/rest/services):
  tilgjengelige arealformål, reguleringsplanområder og bygninger.
  Tilgjengelig geometri er ikke en garanti for nøyaktige grenser.
- [KPA2018 og vedlegg](https://www.bergen.kommune.no/hvaskjer/tema/kommuneplanens-arealdel-kpa/gjeldende-plan-kpa-2018/kpa2018-ble-vedtatt-i-bystyret-juni-2019):
  planbestemmelser må leses sammen med plankartet.
- [KPA2018: bestemmelser og retningslinjer, b65270000.pdf](https://api.arealplaner.no/api/kunder/bergen4601/dokumenter/1487/download/b65270000.pdf):
  nødvendig dokumentgrunnlag, registrert som «ikke kontrollert». Lenken er kjent,
  men piloten har ingen automatisk innlesing eller godkjenning av dokumentets
  bestemmelser. Når dokumentet gjøres tilgjengelig for løsningen, må relevant
  dokumentversjon og regelgrunnlag kvalitetssikres før dette kan gi et avklart
  resultat. PDF-en skal ikke gi et grønt svar bare fordi den finnes.
- [Bebyggelsesplan 6170063](https://www.arealplaner.no/bergen4601/gi?funksjon=VisPlan&planidentifikasjon=6170063&kommunenummer=4601):
  dokumentgrunnlag for Kråkenestoppen-casen.
- [DiBKs veiviser](https://www.dibk.no/verktoy-og-veivisere/bygg-uten-a-soke-garasje)
  og [SAK10 § 4-1](https://www.dibk.no/regelverk/sak/2/4/4-1): nasjonale
  forutsetninger for unntak fra søknad.

**Tomtegrunnlaget bruker lokal fil først.** Når eiendommen mangler, eller kommunen
ikke er dekket av et lokalt uttrekk, brukes Kartverkets eiendoms-API. Grensesnittet
viser «Data hentet fra lokal fil» eller «Data hentet fra API». Filnavn,
uttrekksår, kilde og tidspunkt for oppslaget følger den lagrede vurderingen og
nedlastingen. En ødelagt eller utilgjengelig lokal fil gir en synlig kildefeil,
ikke et stille bytte til andre data.

Uttrekket har ikke opplysninger om bygninger eller planbestemmelser. Disse
oppslagene beholder sine kommunale API-er. Filen oppgir heller ikke grensekvalitet,
tvist eller oppdateringsdato. Det blir stående som ukjent. `OBJECTID` identifiserer
en rad i filen og behandles ikke som en Matrikkel-teig-ID.

Lokal GeoJSON uten CRS følger standarden WGS84 (EPSG:4326); det nasjonale
eiendomsoppslaget ber om EPSG:4258. Koordinatene beholdes som geografisk
kartgrunnlag med kildeangivelse. Arealer er fortsatt kartanslag, ikke
oppmålingsbevis eller juridisk utnyttelsesgrad.

Kartet er en plasseringsskisse, ikke en situasjonsplan. Ett punkt kan ikke kontrollere
hele garasjens omriss. Avstander, terrenginngrep, ferdig planert terreng og høyder
må fortsatt dokumenteres. Bygningsflater alene gir ikke en sikker beregning av
tomtens utnyttelse eller bevis på lovlig bruk.

Ledninger, privatrettslige forhold, fare og andre myndigheters krav kan mangle i
kartgrunnlaget. Ingen tilkoblet kilde må fremstilles som mer fullstendig enn den er.
Produksjonsbruk trenger avklarte datavtaler, oppdateringsrutiner, ekte
innlogging/eiertilgang og faglig godkjente regler. Reell ID-porten-innlogging gir
ikke i seg selv rett til å hente opplysninger fra grunnboken.

## Teknisk

Garasjesjekken er en prosess med veiledning som avslutning, ikke innsending.
Prosessdefinisjonen er felles for alle klientene. Den henter egne eiendommer,
samler eiendomsbekreftelse, plassering og prosjektopplysninger, og kjører
den deterministiske vurderingen. En fullført sjekk oppretter ingen søknad,
Fiks-oppgave eller SvarUt-forsendelse.

Kartsteget bruker den samme KS Digital-siden i en separat ramme, slik at
referanseklientenes stilark ikke overstyrer designsystemet. Svaret sendes tilbake
til klienten og lagres gjennom det vanlige svar-API-et, også via AI-agentens
verktøybane. Backend kontrollerer eierskap, opplysninger og aktivt steg.
Et endret svar etter tilbake-navigering ugyldiggjør senere resultater.
API-kontrakten står i [backendspesifikasjonen](../openapi/sandbox-backend.yaml).
Vurderingen henter grunnlaget på nytt på serveren; en klient kan ikke sende inn
sin egen LNF-status eller et ferdig godkjent plangrunnlag.

Alle klientene bruker felles konfigurasjon fra demo-serveren. For en separat
lokal kjøring kan porten settes med `PORT` og adressene med `BACKEND_PUBLIC_URL`,
`IDPORTEN_PUBLIC_URL`, `AI_PUBLIC_URL`, `AGENT_PUBLIC_URL` og `TOOLS_PUBLIC_URL`.
For tjenestelisten og API-utforskeren kan også `FIKS_PUBLIC_URL`,
`MATRIKKEL_PUBLIC_URL`, `PASIENTJOURNAL_PUBLIC_URL` og `POLITIATTEST_PUBLIC_URL`
peke til de samme mockene som backend bruker.
Standardene er de vanlige sandkasseportene. De tidligere variablene
`GARASJE_BACKEND_PUBLIC_URL` og `GARASJE_IDPORTEN_PUBLIC_URL` støttes som aliaser
og gjelder nå også de andre klientene, så personregisteret ikke blir delt.
En separat backend må bruke samme utsteder i `DIGDIR_ISSUER` og ha riktig
`DIGDIR_BASE_URL`. Tools-api må bruke samme backend og tokenutsteder.

`pnpm test:garasje` kjører garasjetestene uten eksterne nettjenester.
`pnpm lint` typesjekker både backend og nettleserkoden.

De delte delene kontrolleres også med de eksisterende testene:
`pnpm test:agent:dialog`, `pnpm test:chat`, `pnpm test:replay`,
`pnpm test:concurrency`, `pnpm test:revisjon` og `pnpm test:sperrer`.
Garasjegrunnlaget må ikke endre innsendingsbekreftelser eller reglene for
TT-kort, politiattest, barnehage og andre eksisterende caser.
