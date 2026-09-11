# Tiltakshjelpen

En felles prosess i Chat, AI-agent og Stegvis, med Bergen som pilot.
Innbyggeren beskriver tiltaket, mens tjenesten henter adresse, eiendomsidentitet og
tilgjengelig plangrunnlag. Dette er veiledning, ikke et kommunalt vedtak eller en
byggesøknad.

## Kan du bygge uten å søke?

**Tiltakshjelpen** svarer på «Kan du bygge uten å søke?», som også er navnet i
prosesskatalogen. Tjenesten gjelder avklaring av søknadsplikt for byggetiltak,
ikke alle typer kommunale søknader. Garasje er ett av tiltakene, ikke navnet
på den felles tjenesten.

| Tiltak | Hva veiledningen dekker |
|---|---|
| Frittliggende bygg | Blant annet garasje og bod. Areal, høyder, bruk, avstander og øvrige vilkår for det nasjonale unntaket |
| Tilbygg | Egne areal- og bruksvilkår. Arver ikke avstandsregelen for frittliggende bygg |
| Gjerde | Høyde, vei, frisikt og utførelse, med varsel om særskilte lokale planbestemmelser |
| Fasade eller tak | Skillet mellom vedlikehold, endret utseende og inngrep i bæring eller brannsikring |
| Annet eller uavklart tiltak | En uttrykkelig avklaring hos kommunens byggesaksveiledning, ikke et automatisk valg av garasjereglene |

Felles for alle er bekreftet tiltakstype og eiendom, kart og dokumentkilder,
spørsmål som passer tiltaket, faste regler og et tydelig neste steg. Et nasjonalt
unntak er ikke en byggetillatelse: lokale planforhold, dokumentenes gyldighet og
andre krav kan fortsatt være uavklart. Ingen byggesøknad sendes inn av denne casen.

## Referanse for andre søknadsprosesser

Casen viser et mønster andre tjenester kan bruke: avklar hva innbyggeren vil,
bekreft typen, hent relevant grunnlag, spør bare om det som trengs, og skill
regler fra KI-forklaringer. Uavklarte forhold og neste steg er egne resultater,
ikke feil som skal skjules eller gjøres om til et ja.

Det er mønsteret som kan gjenbrukes, ikke byggereglene. En ny søknadsprosess
trenger egne faglig avklarte vilkår, kilder, tilgangsregler og tester.
Prosessmotoren er fortsatt lineær; valg av tiltakstype styrer spørsmålene i denne
casen, ikke generell forgrening i motoren. Innsending må legges inn uttrykkelig
i en prosess som faktisk skal sende en søknad. Se [prosessmodellen](prosessmodell.md)
og [arkitekturen](architecture.md).

## Start

Start sandkassen med `./start.sh --mock` og velg **Kan du bygge uten å søke?** under
«Tjenester for innbyggere» på oversikten. Velg Chat, AI-agent eller Stegvis.
Kartet og eiendomsbekreftelsen er innebygd i alle tre inngangene, og vurderingen
lagres i den vanlige prosessøkten. `/tiltakshjelpen` er den frittstående
veiviseren. Gamle lenker til `/garasje` videresendes dit, med økt og visningsmodus bevart.

Dette er fortsatt den samme casen. Moduler, typer, funksjoner og tester for den
felles tjenesten heter nå `tiltakshjelpen`. Kravene og målene som bare gjelder
frittliggende bygninger, er navngitt med `frittliggende`.

API-stier, verktøynavn, OpenAPI-skjemanavn, prosess- og steg-ID-er, meldinger mellom
klientene og lagrede resultatnøkler beholder kontraktsnavnene sine. De er beskrevet
i [API-spesifikasjonene](../openapi/README.md), og et navnebytte skal ikke gjøre
lagrede økter uleselige eller bryte andre lags klienter. Det gamle temavalget
leses fortsatt, mens nye temavalg lagres under navnet `tiltakshjelpen`.

Den synlige tjenesten omfatter
frittliggende bygg, tilbygg, gjerde og fasadeendring, slik
[fagpersonens flytkart](../data/Flytkart%20Hackathon.jpg) beskriver. Kartet er
skrevet ut node for node i [flytkart-tiltakssjekk.md](flytkart-tiltakssjekk.md), med
en kolonne som sier hvor koden gjør det samme og hvor den med hensikt gjør noe annet.
En beskrivelse gir bare et forslag til tiltakstype. Innbyggeren bekrefter eller
retter typen før de relevante spørsmålene åpnes. Uklare eller sammensatte tiltak
skal ikke presses inn i regelen for et frittliggende bygg.

Start med ID-porten-testinnloggingen. Tiltaksbeskrivelsen og eiendomsvalget åpnes
først etter innlogging, også i den frittstående veiviseren. En gyldig innlogging
fra samme fane gjenbrukes. Tjenesten henter opplysningene til den innloggede
testpersonen og foreslår bostedsadressen først når den også er en eid eiendom.
Egne eiendommer vises som alternativer. Bosted og eierskap er forskjellige
opplysninger. Adressebeskyttelse skal ikke omgås for å fylle ut et felt.

KI kan forklare ord som gesimshøyde, mønehøyde, BRA og BYA med vanlig språk.
Et slikt spørsmål lagres aldri som et svar på et prosessteg og flytter ikke flyten
videre. Med `--mock` får du faste, kildebaserte forklaringer. Med en konfigurert
språkmodell kan KI formulere forklaringene. Selve vurderingen bruker alltid faste
regler, ikke modellen.

Arealsvar kan skrives som et tall med enhet eller en entydig setning, for
eksempel «Bruksareal er 25 kvadratmeter» i BRA-feltet. Feltnavnet må stemme med
spørsmålet. Intervaller, flere mål i samme svar og usikre anslag blir ikke
gjettet om til ett tall.

Etter vurderingen henter siden et **råd** via `POST /agent/garasje/raad`, både
frittstående og i prosessøkten. Agenten bruker PDF-verktøyene til å finne
dokumenter for kommunen og planen, og henter avgrensede søketreff før den ber
`POST /ai/garasje-raad` formulere et råd. Modellen får relevante offentlige fakta
og vurderingen, ikke rå kartgeometri eller personidentitet. Dokument, side,
kildelenke og forbehold vises sammen med rådet. Et søketreff er ikke bevis på at
hele planen er gjennomgått eller at bestemmelsen gjelder tiltaket.

Rådet er et tillegg, ikke en erstatning for den deterministiske vurderingen.
Et modelldrevet forslag om et mildere utfall kan ikke bli stående som en
byggetillatelse i teksten. Alle uavklarte forhold fra reglene beholdes, uten å
kutte bort de siste punktene. I mock-modus brukes et regelbasert råd. Feil i
dokumenttjenesten eller modellen vises uttrykkelig; de blir ikke et automatisk ja.
Siden viser alltid et konkret neste steg, også når svaret er å kontakte kommunens
plan- og byggesaksrådgivere. Et ferdig hentet råd og kildehenvisningene følger med
i den lokale nedlastingen.
`pnpm test:tiltakshjelpen-raad` kontrollerer kodegrensene uten en ekstern modell.

Resultatet viser vilkår som ikke er oppfylt og vilkår som må avklares før de
oppfylte vilkårene. Forbehold som usikker grensekvalitet står i en egen del om
begrensninger i sjekken, ikke som flere spørsmål innbyggeren må fylle ut.
De blir ikke borte ved å svare på alle spørsmålene: kommunen kan veilede om
planforhold og om grensen må dokumenteres eller måles opp. Gjentakelser mellom
sjekklisten og forbeholdene vises bare én gang. Reglene, utfallet og grunnlaget
i nedlastingen er uendret.

Kartet lar innbyggeren klikke eller dra markøren, eller bruke piltastene.
Planvarsler står under kartet slik at kartet ikke flytter seg når et varsel
fjernes under dragging. Kartbakgrunnen kan ikke dras som et bilde, og et avbrutt
drag skal ikke hindre neste forsøk. Dette flytter plasseringen, ikke kartutsnittet.

Tiltakssjekken starter i mørkt tema. Valget av lyst eller mørkt tema lagres lokalt
i nettleseren og gjenbrukes ved omlasting og i den innebygde tiltaksvisningen.
Bare temavalget lagres der, ikke opplysninger om eiendommen eller tiltaket.
Den lokale rettelsen i `apps/shared/ds-morketema.css` lastes etter de vendorede
stilarkene, også i den innebygde visningen.

Innloggingen og eieropplysningene er syntetiske. Testpersonen eier **ikke**
dermed en virkelig eiendom. Adresse- og kartoppslag bruker offentlige tjenester,
og bare søketekst og geografiske opplysninger sendes dit, ikke personidentitet,
token eller eierlister. En syntetisk bostedsadresse finnes ikke nødvendigvis i det
virkelige adresseregisteret. Da kan innbyggeren søke selv i den frittstående
tiltakssjekken.
Adresse- og eiendomsoppslag er nasjonale. Bare Bergen har et kommunalt plan- og
bygningsoppsett i workshopen. Andre kommuner får derfor uavklarte kommunale
forhold, aldri Bergen-data som reserve.

## To demonstrasjonscaser

| Adresse | Eiendom i Bergen | Hva casen skal synliggjøre |
|---|---|---|
| Litle Milde 65 | Gnr. 105, bnr. 209 | LNF er ikke i seg selv et automatisk avslag eller bevis på søknadsplikt. Eiendommen ligger dessuten helt inne i gul støysone H220_1. |
| Kråkenestoppen 60 | Gnr. 20, bnr. 1413 | Kommuneplanens formål er ikke nok: lokale planbestemmelser om blant annet bygg og gjerde må undersøkes. Faresone H390_2 berører eiendommen; kartgeometrien avgjør hvor mye. |

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
felt 19A. Disse karttreffene alene dokumenterer ikke om et bestemt tiltak er
tillatt. Eksisterende bebyggelse, høyder, utnyttelse og den planlagte plasseringen
kan endre vurderingen.

## Slik brukes resultatet

1. Beskriv tiltaket og bekreft typen. Velg en eid eiendom eller et konkret adressetreff. Bosted foreslås først når
   adressen også finnes blant de eide eiendommene. Kommunenummer og gnr./bnr.
   følger med fra kilden.
2. Kontroller adressen og gnr./bnr., og trykk «Bekreft eiendom». Før dette vises
   bare eiendomsvalget. Kart, nabotomter, bebyggelse og planopplysninger hentes
   først etter bekreftelsen, slik at feil adresser ikke utløser tunge kartoppslag.
   Kartet tilpasses eiendomsgeometrien med omtrent ti meter eller mer rundt.
3. Plasser tiltaket ved å klikke eller dra markøren. Tastaturbrukere kan fokusere
   kartet og bruke piltastene. Adressepunktet er ikke en bekreftet plassering.
   Et punkt utenfor den kartlagte eiendommen stopper overgangen til neste side.
   Linjen til nærmeste tomtegrense viser kartavstanden fra punktet, ikke et
   dokumentert avstandskrav fra hele bygget. Manglende grensedata vises som ukjent.
   Nedtrekksmenyen lar deg vise eller skjule soner; den endrer ikke regelgrunnlaget.
   Trykk «Bekreft plassering og fortsett». Vi henter planer for punktet før
   spørsmålene om tiltaket vises. Kartet og spørsmålene vises ikke samtidig.
   Du kan gå tilbake med «Endre eiendom» eller «Endre plassering» uten å miste
   svarutkastet, men den nye plasseringen må bekreftes før du kan fortsette.
4. Velg «Chat med AI-agent» eller «Stegvis utfylling». Spørsmålene vises på egne
   sider, med BYA/BRA og gesims/møne samlet. «Bekreft svar» lagrer et forslag;
   «Jeg har flere spørsmål» åpner hjelpen uten å bekrefte det.
   Ja/nei-spørsmål har knapper og mulighet for å be om hjelp. Eksempelteksten
   følger det aktuelle feltet. Begge moduser beholder svarutkastet, men chatloggen
   følger ikke med til neste spørsmål eller til stegvis modus.
   «Forrige» og «Neste» lar deg kontrollere lagrede svar uten å skrive dem på nytt.
5. Les den regelbaserte vurderingen, begrunnelsene og kildenes dekningsstatus.
6. Last ned vurderingen med grunnlaget, eller skriv den ut.

Du får en oppsummering før sjekken kjøres. Fagspørsmål flytter ikke utfyllingen
videre, og et agentsvar blir ikke en lagret verdi uten bekreftelse. Den
felles agenten bruker den samme valideringen av mål og valg som den øvrige
tiltaksdialogen. Ved modellfeil kan du fortsette stegvis uten å miste utkastet.
«Endre svaret» viser hvilket felt du retter, legger teksten tilbake i tekstboksen
og flytter fokus dit. Forslaget lagres ikke før du bekrefter det. Ved «Endre»
i oppsummeringen vises det nåværende svaret og feltet du redigerer.

Svar og fagspørsmål skrives i den samme tekstboksen. Den er også tilgjengelig
under stegvis utfylling og når du ser over svarene, uten et separat hjelpeskjema.
Forklaringen viser dokumentkilder med sidetall og lenker, og varsler om manglende
dekning eller usikkert uttrekk. Disse opplysningene gjelder bare det aktuelle
svaret og fjernes ved nytt spørsmål, navigering eller modusbytte.

Nabotomter i kartutsnittet vises med stiplede grenser, mens valgt eiendom har
heltrukken rød grense. Eiendomsnumre vises på kartet der det er plass.
Kilden er tilgjengelig under «Datakilde for nabogrenser», uten en detaljliste
over nabotomtenes areal og kvalitet. Eieropplysninger hentes ikke. Dette er
tomter i utsnittet, ikke en fullstendig eller juridisk bekreftet naboliste.
Naboflatene inngår ikke i arealberegningen eller reglene for valgt eiendom.

Bygningsflatene i kartutsnittet tegnes på samme måte. Bygg som er sammenholdt
med den valgte teigen har heltrukket fyll; bygg på nabotomter er stiplet og
nedtonet, og de inngår ikke i bebyggelsen eller arealberegningen for eiendommen.
Er tilknytningen til teigen uavklart, skilles flatene ikke, fordi kartet ikke
skal påstå mer enn bebyggelsen faktisk vet. En tegnforklaring under kartet
navngir flatetypene, og en statuslinje sier hvor mange flater som vises eller
hvorfor bygningskartet mangler. Uten den så et mislykket bygningsoppslag ut som
et tomt kart.

Endrer du adressen, skjules kartet og det gamle grunnlaget til den nye
eiendommen er bekreftet. Feiler hentingen, vises en knapp for å prøve igjen.

Nasjonale vilkår vurderes separat fra planforhold og andre begrensninger.
Et bygg som oppfyller størrelsesgrensene er ikke automatisk lovlig plassert.
LNF/LNFR kan ha bestemmelser som åpner for enkelte tiltak, mens en boligregulert
tomt kan ha begrensninger som krever avklaring.

**En mislykket henting, manglende dekning eller uavklart bestemmelse blir aldri
tolket som fravær av begrensninger.** Tjenesten må da si at forholdet må avklares.
Den viser ikke et ubetinget «ikke søknadspliktig» bare fordi nasjonale
størrelsesgrenser er oppfylt. Dispensasjon og byggetillatelse er heller ikke det
samme; en slik avklaring må gjøres mot det konkrete plangrunnlaget.

### Svaret innbyggeren leser

Overskriften i vurderingen svarer på spørsmålet: **«Ja, men du må melde inn»**,
**«Nei, du må søke»** eller **«Kontakt kommunen»**, med det avgjørende vilkåret
navngitt i setningen under. Deretter følger regelens egen forklaring og de konkrete
neste stegene, der bestemmelsene innbyggeren skal spørre om er navngitt.

Det midterste svaret er utfallet `meldeplikt`, som er fagpersonens grønne boks i
flytkartet: tiltaket er unntatt fra søknadsplikt, men skal meldes inn til kommunen
når det er ferdig bygget, i kommunens eget skjema. Det er det ene fritaket tjenesten
gir, og det ligger bak en hviteliste: frittstående bygning, alle nasjonale vilkår
oppfylt, punktet på eiendommen, alle kartkilder besvart, kommuneplanbestemmelsen
kontrollert og oppfylt, ingen reguleringsplan og ingen faresone på eiendommen, og et
meldeskjema for kommunen. Faller ett ledd, er svaret «kontakt kommunen».
Vilkårene og begrunnelsen for hvert ledd står i
[flytkart-tiltakssjekk.md](flytkart-tiltakssjekk.md).

## Kilder og avgrensninger

### Kommuner, soner og regler i kode

| Modul | Ansvar |
|---|---|
| [`byggetiltak.ts`](../apps/shared/byggetiltak.ts) | Tiltakstyper, forslag fra beskrivelsen og spørsmål for valgt type. Selve regelvurderingen gjøres i backend. |
| [`tiltakshjelpen-kommuner.ts`](../apps/shared/tiltakshjelpen-kommuner.ts) | Kobler kommunenummer til kommunens kartlag, planportal, plan-ID, versjon og bestemmelser. Bergen-PDF-en hører bare til `4601`. |
| [`arealsoner.ts`](../apps/shared/arealsoner.ts) | Kontrollerte sonetyper, nøklet på kommune, plan, versjon, arealformål og arealstatus. Ukjente kombinasjoner forblir ukjente. |
| [`hensynssoner.ts`](../apps/shared/hensynssoner.ts) | Sonekodene i KPA2018 med klarspråksnavn, datasett-id-ene og formen på tråden. Hvilken fil og kolonne hvert datasett har er `plan-mock` sin egen sak. |
| [`frittliggende-regelgrunnlag.ts`](../apps/shared/frittliggende-regelgrunnlag.ts) | Nasjonale tallkrav for frittliggende bygg, enheter og kilder. Disse grensene brukes ikke på andre tiltakstyper. |
| [`tiltakshjelpen-begreper.ts`](../apps/shared/tiltakshjelpen-begreper.ts) | Kildebaserte forklaringer av fagord. |
| [`tiltakshjelpen-dialog.ts`](../apps/shared/tiltakshjelpen-dialog.ts) | Felles utfyllingsfelter, enheter og validering for samtale og stegvis utfylling. |
| [`tiltakshjelpen-kunnskap.ts`](../apps/shared/tiltakshjelpen-kunnskap.ts) | Et begrenset, strukturert grunnlag for språkmodellen, uten persondata eller rå kartgeometri. |

En ny kommune legges til med egne kilder og kontrollerte sone-/planopplysninger,
ikke ved å endre den generelle prosessflyten. Et sonenavn gir ikke alene en
utnyttelsesgrense eller byggetillatelse. Slike regler trenger en konkret,
kontrollert bestemmelse med kilde.

`GET /api/garasje/veiledning` viser det tjenestespesifikke kunnskapsgrunnlaget.
De felles KI-verktøyene er fortsatt tjenestenøytrale. Tiltaksgrunnlaget legges
bare til for denne casen; de øvrige casene bruker sine eksisterende data
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

### Hensynssoner og arealformål over hele eiendommen

Kommuneplanoppslaget mot Bergens kart spør om **ett punkt** og får ingen geometri
tilbake. Det kan ikke svare på om en sonegrense går tvers gjennom tomten, som er
spørsmålet innbyggeren stiller når hun plasserer tiltaket i kartet.

Derfor leses KPA2018 også som flater, fra et frosset uttrekk hos
[`plan-mock`](../apps/plan-mock/README.md): de seks hensynssonene - gule støysoner,
faresoner og de fire angitte hensynene - og arealformålene. Flatene sammenlignes med
den kartlagte teigen, ikke med adressepunktet, og resultatet sier om sonen dekker
eiendommen **helt** eller berører den **delvis**, og om skissepunktet ligger inne i
den. Flatene tegnes i kartet under eiendomsgrensen, og markøren melder sonen med én
gang den flyttes; serveren fastslår det ved «Bekreft plassering».

**Sonen avgjør ingenting.** Sjekken `hensynssoner` er alltid `uavklart`, og den står
etter at det nasjonale unntaket er regnet ut, så den kan ikke flytte utfallet. En
hensynssone er hjemlet i plan- og bygningsloven § 11-8 og sier at et hensyn gjelder
for området; om tiltaket er tillatt, står i planbestemmelsene. PDF-søket kan hente
utdrag til forklaringen, men bekrefter ikke at alle vilkår er kontrollert.
Kartuttrekket er dessuten fra 2018 og må kontrolleres mot gjeldende plan.

Navnet på flaten kommer fra et kontrollert register - kodeverket for
hensynssonene, [`arealsoner.ts`](../apps/shared/arealsoner.ts) for formålene - og
ikke fra kildens fritekst; ellers svarte det samme grunnlaget på det samme
spørsmålet to ganger. Kildens egen `BESKRIVELSE` går likevel ordrett videre ved
siden av - «Sjøflyhavn - gul sone», «Akutt forurensning» - fordi den sier hva
hensynet konkret gjelder. Flatene er klippet til
kartutsnittet, så ringene har kanter som ikke er sonegrenser: ingen avstand måles mot
dem.

### Offentlige kilder

- [`matrikkel_bk_25.json`](../data/matrikkel_bk_25.json): lokalt Bergen-uttrekk,
  merket 2025, med teigpolygoner og oppgitt areal. Matrikkelmocken er eneste
  tjeneste som leser filen. Tiltakssjekken slår opp på kommunenummer, gnr./bnr.
  og festenummer gjennom API-et.
- [Kartverkets adresse-API](https://ws.geonorge.no/adresser/v1/): adresse,
  eiendomsidentifikator og adressepunkt. Et adressepunkt er ikke tomten.
- [Geonorge: Matrikkelen - Eiendomskart Teig](https://kartkatalog.geonorge.no/metadata/uuid/74340c24-1c8a-4454-b813-bfe498e80f16):
  eiendomsgeometri via Kartverkets dokumenterte eiendoms-API. GeoJSON-geometrien
  hentes for den konkrete matrikkelidentiteten, ikke fra et generisk eksempel.
- KPA2018-uttrekket under [`data/`](../data): sju GeoJSON-filer med hensynssoner og
  arealformål, omtrent 62 MB. `plan-mock` er eneste tjeneste som leser dem;
  tiltakssjekken slår opp på kartutsnitt gjennom API-et. Frosset i 2018, og ikke
  gjeldende plan.
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
hele tiltakets omriss. Avstander, terrenginngrep, ferdig planert terreng og høyder
må fortsatt dokumenteres. Bygningsflater alene gir ikke en sikker beregning av
tomtens utnyttelse eller bevis på lovlig bruk.

Ledninger, privatrettslige forhold, fare og andre myndigheters krav kan mangle i
kartgrunnlaget. Ingen tilkoblet kilde må fremstilles som mer fullstendig enn den er.
Produksjonsbruk trenger avklarte datavtaler, oppdateringsrutiner, ekte
innlogging/eiertilgang og faglig godkjente regler. Reell ID-porten-innlogging gir
ikke i seg selv rett til å hente opplysninger fra grunnboken.

## Teknisk

Tiltakssjekken er en prosess med veiledning som avslutning, ikke innsending.
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
Standardene er de vanlige sandkasseportene. `TILTAKSHJELPEN_BACKEND_PUBLIC_URL` og
`TILTAKSHJELPEN_IDPORTEN_PUBLIC_URL` kan også brukes. De felles variablene går
foran disse. De tidligere variablene `GARASJE_BACKEND_PUBLIC_URL` og
`GARASJE_IDPORTEN_PUBLIC_URL` støttes som siste alias og gjelder også de andre
klientene, så personregisteret ikke blir delt.
En separat backend må bruke samme utsteder i `DIGDIR_ISSUER` og ha riktig
`DIGDIR_BASE_URL`. Tools-api må bruke samme backend og tokenutsteder.

`pnpm test:tiltakshjelpen` kjører testene for alle tiltakstypene uten eksterne nettjenester.
`pnpm test:tiltakshjelpen-raad` kontrollerer rådene. De gamle kommandoene
`pnpm test:garasje` og `pnpm test:garasje-raad` videresender til de nye.
`pnpm lint` typesjekker både backend og nettleserkoden.

De delte delene kontrolleres også med de eksisterende testene:
`pnpm test:agent:dialog`, `pnpm test:chat`, `pnpm test:replay`,
`pnpm test:concurrency`, `pnpm test:revisjon` og `pnpm test:sperrer`.
Tiltakshjelpens datagrunnlag må ikke endre innsendingsbekreftelser eller reglene for
TT-kort, politiattest, barnehage og andre eksisterende caser.
