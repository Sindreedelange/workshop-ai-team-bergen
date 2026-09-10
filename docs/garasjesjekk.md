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

Innloggingen og eieropplysningene er syntetiske. Testpersonen eier **ikke**
dermed en virkelig eiendom. Adresse- og kartoppslag bruker offentlige tjenester,
og bare søketekst og geografiske opplysninger sendes dit, ikke personidentitet,
token eller eierlister. En syntetisk bostedsadresse finnes ikke nødvendigvis i det
virkelige adresseregisteret. Da kan innbyggeren søke selv eller velge en av casene.
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

Adressene er snarveier til vanlige oppslag, ikke nøkler til forhåndsbestemte svar.
Oppslaget ved adressepunktet for Litle Milde viste LNF i KPA2018. Ved
Kråkenestoppen viste det «Øvrig byggesone» og bebyggelsesplan 6170063, Bønes øst,
felt 19A. Disse karttreffene alene dokumenterer ikke hva en bestemt garasje kan
bygges som. Eksisterende garasjer, høyder, utnyttelse og den planlagte plasseringen
kan endre vurderingen.

## Slik brukes resultatet

1. Velg en eid eiendom eller et konkret adressetreff. Bosted foreslås først når
   adressen også finnes blant de eide eiendommene. Kommunenummer og gnr./bnr.
   følger med fra kilden.
2. Kontroller adressen og den røde tomtegrensen, og trykk «Bekreft eiendom».
   Kartet tilpasses eiendomsgeometrien med omtrent ti meter eller mer rundt.
3. Plasser garasjen ved å klikke eller dra markøren, eller bruk retningsknappene.
   Adressepunktet regnes ikke automatisk som en valgt garasjeplassering.
   Oppgi areal, høyder og bruk. Plangrunnlaget hentes for det valgte punktet.
4. Les den regelbaserte vurderingen, begrunnelsene og kildenes dekningsstatus.
5. Last ned vurderingen med grunnlaget, eller skriv den ut.

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
| [`garasje-kunnskap.ts`](../apps/shared/garasje-kunnskap.ts) | Et begrenset, strukturert grunnlag for språkmodellen, uten persondata eller rå kartgeometri. |

En ny kommune legges til med egne kilder og kontrollerte sone-/planopplysninger,
ikke ved å endre den generelle prosessflyten. Et sonenavn gir ikke alene en
utnyttelsesgrense eller byggetillatelse. Slike regler trenger en konkret,
kontrollert bestemmelse med kilde.

`GET /api/garasje/veiledning` viser det tjenestespesifikke kunnskapsgrunnlaget.
De felles KI-verktøyene er fortsatt tjenestenøytrale. Garasjegrunnlaget legges
bare til for en garasjekontekst; de øvrige casene bruker sine eksisterende data
og regler.

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
