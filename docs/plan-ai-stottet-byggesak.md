# Handover: AI-støttet arbeidsflate for byggesøknader

> Dette er et beslutningskomplett plan- og kontekstdokument for neste agent. Det er
> ikke en implementasjon. Les `AGENTS.md` før arbeidet starter, og verifiser alltid
> gjeldende arbeidskopi før filer endres.

## 1. Oppdrag og produktløfte

Bygg en ny innbyggerrettet brukssituasjon i `workshop-ai`: en vedvarende
prosjektarbeidsflate som hjelper en innbygger fra en uformell byggeidé til et
strukturert, kontrollert og innsendingsklart søknadsgrunnlag.

Opplevelsen skal ligge mellom et tradisjonelt skjema og en fri chatbot:

- Skjemaet gir struktur, etterprøvbarhet og fullstendighet, men forventer at
  innbyggeren allerede forstår byggesak.
- Chatboten er enkel å starte med, men skjuler ofte status, kilder, avhengigheter og
  hva som faktisk er bekreftet.
- Løsningen her skal kombinere et kart, adaptive faktakort, synlig dokumentasjon,
  deterministiske regler og en valgfri KI-assistent.

Første versjon skal ende i en reell søknad i sandkassen via et adapter, ikke bare i
generelle råd eller en eksportert sjekkliste. Adaptergrensen skal gjøre en senere
integrasjon mot Fellestjenester plan og bygg mulig uten å bytte domenemodell eller
bygge brukerreisen på nytt.

## 2. Beslutninger som allerede er tatt

Disse valgene skal ikke åpnes igjen uten at faktiske forhold i kodebasen gjør planen
umulig:

- **Bred inngang:** Støtt vanlige tiltak som nybygg, tilbygg, garasje, mikrohus,
  bruksendring, fasadeendring, riving og deling, i tillegg til kombinasjoner og
  «annet». Dette betyr ikke at systemet automatisk skal avgjøre enhver tenkelig
  byggesak; ukjente og kompliserte tilfeller skal få en trygg vei til fagperson eller
  manuell vurdering uten å miste innsamlet arbeid.
- **Søknadsklar arbeidsflyt:** Målet er et komplett søknadsgrunnlag og innsending i
  sandkassen, ikke bare å svare på «må jeg søke?».
- **Kart og smarte kort:** Tiltaket beskrives og plasseres gjennom kart og adaptive
  kort. Ren samtale er et supplement.
- **Valgfri KI-assistent:** Assistenten forklarer, foreslår struktur og skriver
  utkast. Den styrer ikke flyten og endrer aldri bekreftet tilstand uten eksplisitt
  godkjenning.
- **Samme arbeidsflate for fagperson:** Når ansvarlige foretak eller annen faglig
  vurdering kreves, inviteres fagpersonen inn i prosjektet med avgrensede rettigheter.
  Innbyggeren skal ikke måtte starte på nytt eller sende en løs håndoverpakke.
- **Syntetisk først:** Matrikkel-, plan-, fare-, infrastruktur-, nabo- og
  innsendingstjenester skal være syntetiske adaptere i første versjon.
- **Balansert effektmål:** Kvalitet er sperren. Deretter måles færre
  veiledningshenvendelser og kortere aktiv gjennomføringstid.
- **Vedlegg uten automatisk bevisvurdering:** Vedlegg kan lastes opp og knyttes til
  krav, men første versjon skal ikke la en modell avgjøre samsvar ut fra tegninger,
  bilder eller PDF-er.

## 3. Brukssituasjonen

En innbygger starter gjerne med en setning som «jeg vil bygge en garasje på omtrent
45 m² ved østsiden av huset». Personen vet ofte ikke:

- om tiltaket er søknadspliktig;
- hvilke nasjonale og lokale bestemmelser som gjelder;
- hvor mye av tomten som allerede er utnyttet;
- hvilke avstander, faresoner eller infrastrukturlinjer som er relevante;
- hvilke tegninger, erklæringer og nabovarsler som trengs;
- om personen kan søke selv eller må bruke ansvarlige foretak.

Løsningen lar innbyggeren velge eiendommen, beskrive tiltaket med egne ord og
plassere det i et kart. Systemet henter syntetiske eiendoms-, plan- og områdedata,
beregner geometri og viser bare relevante krav. Hvert faktum får en tydelig status,
kilde og forklaring. Regler avgjør hvilken søknadsvei som gjelder. KI gjør språket og
interaksjonen lettere, men avgjør aldri jus eller fullstendighet.

Sluttproduktet er et versjonert prosjektdossier med dokumentert grunnlag,
samarbeidshistorikk, nabovarsel, vedlegg, kontrollresultat og innsendingstilstand.

## 4. Hva undersøkelsen av DiBK viste

### Dagens borgerreise

DiBK beskriver reisen som å finne planer, beregne utnyttelse, kartlegge hensyn,
tegne og plassere tiltaket, varsle naboer, fylle ut og sende søknaden, motta vedtak
og senere søke ferdigattest. Se [åtte steg fra idé til ferdig
søknad](https://www.dibk.no/verktoy-og-veivisere/atte-steg-fra-ide-til-ferdig-soknad/stegene-fra-ide-til-ferdig-soknad/steg-0-for-du-starter).

Tiltakshjelpen er representativ for problemet. Den ber innbyggeren finne og
tolke situasjonskart, reguleringsplan, kommuneplan og lokale vedtekter, og svare om
blant annet LNF, ledninger, nabo-, vei-, jernbane- og kystavstander, faresoner,
BYA/BRA og høyder. Veiviseren er dynamisk og husker fremdrift, men brukeren må
fortsatt kjenne mange av svarene som tjenesten burde hjelpe med å finne.

[SAK10 § 5-4](https://www.dibk.no/regelverk/sak/2/5/5-4) understøtter at løsningen
bare skal innhente opplysninger som er relevante og nødvendige. Derfor skal
kravbildet bygges dynamisk fra tiltak, eiendom og funn; brukeren skal ikke møte hele
byggesøknadsskjemaet på én gang.

### Eksisterende løsninger og differensiering

[eByggesøk](https://www.ebyggesok.no/artikkel/soknadsprosessen) tilbyr allerede
adaptive spørsmål, eiendomsanalyse, kartplassering, nabovarsel, vedlegg, innsending
og ferdigattest. En ny «veiviser pluss chat» er derfor ikke et tilstrekkelig nytt
produkt. Differensieringen skal være en kildeforankret prosjektarbeidsflate der
brukeren kan se og korrigere det systemet vet, forstå hvorfor noe kreves, og
samarbeide uten å starte på nytt.

DiBK og KS sitt konseptarbeid «Ingen sak med byggesak» identifiserte særlig behovet
for å svare på «må jeg søke?». Konseptene var Byggorakelet for innbyggere og
Innbyggerhjelpen for førstelinjen, med anbefaling om å starte innbyggerrettet. Se
[Digdirs oppsummering](https://www.digdir.no/stimulab/direktoratet-byggkvalitet-dibk-ingen-sak-med-byggesak-effektiv-og-brukerrettet-veiledning-i-alle/4995).
Denne løsningen skal inkludere den avklaringen, men fortsette gjennom dokumentasjon,
samarbeid og innsending.

[Drømmeplan](https://www.dibk.no/om-direktoratet-for-byggkvalitet/drommeplan) viser
verdien av adressebasert visualisering av planregler. [Planslurpen](https://www.dibk.no/om-direktoratet-for-byggkvalitet/planslurpen)
viser hvordan KI kan strukturere eldre plan-PDF-er, men også hvorfor resultatet må
kvalitetssikres av mennesker før det blir autoritativt. Denne kilde- og
godkjenningsmodellen skal gjenspeiles i produktet.

[Fellestjenester plan og bygg](https://www.dibk.no/saksbehandling-tilsyn-og-kontroll/digitalisering-av-byggesak/fellestjenester-plan-og-bygg--enklere-og-smartere-planforslag-og-byggesoknader)
gir retningen for senere produksjonsintegrasjon: felles format, maskinelle kontroller
og strukturert dialog. Første versjon skal bare implementere adaptergrensen og en
sandkasseadapter.

Nyttige demonstrasjoner for produktteamet:

- [Hva må til for å sende inn en byggesøknad?](https://youtu.be/s6oTf12Q-rY)
- [Fellestjenester plan og bygg](https://youtu.be/Rtwxh00X9N0)
- [Ingen sak med byggesak](https://youtu.be/gPcC5njTFck)

## 5. Nåværende kodebase og hva som skal gjenbrukes

Dette er en kommunal dialogsandkasse med eksplisitt samtykke, policykontroll,
revisjon og syntetiske data. Tjenestene kommuniserer over HTTP; de skal ikke kobles
sammen gjennom delte tjenesteinterne moduler.

Relevant eksisterende grunnmur:

- `sandbox-backend` på `8080`: prosess-/sesjonsmotor, ressurser, regler, søknader,
  samtykke og revisjon.
- `fiks-simulator` på `8081`: mock av Fiks, oppgaver og registerlignende integrasjoner.
- `ai-gateway` på `8082`: modellabstraksjon, leverandørbytte, sikkerhet og KI-spor.
- `tools-api` på `8083`: verktøykatalog over backend, KI, Matrikkel og nå PDF-tjenesten.
- `process-agent` på `8084`: agent-API med både dynamisk verktøyvalg og hardkodede
  snarveier for eksisterende sak.
- `matrikkel-mock` på `8085`: eiendom, adresse, eiere og koordinater.
- `digdir-mock` på `8086`: ID-porten og Maskinporten.
- `pdf-extractor` på `8089`: kildeforankret PDF-uttrekk og søk, inkludert profilen
  `arealplan`. Opplasting starter uttrekk og vektorindeksering automatisk;
  kvalitetsflagg følger alle treff uten å blokkere bruk.
- `demo-gui` på `3001` og `process-builder` på `3000`.

Viktig status ved overleveringen: arbeidskopien er allerede skitten med et pågående,
ikke-innsjekket `pdf-extractor`-arbeid og relaterte endringer i blant annet Compose,
AI-gateway, tools-api, OpenAPI, oppstartsskript og dokumentasjon. Bevar alt dette.
Ikke reverser, overskriv eller omformater brukerens endringer. Verifiser `git status`
før implementasjon.

### Kapabiliteter som finnes

- Matrikkel-fixturene inneholder gate/adresse, gårds- og bruksnummer, koordinater,
  boligtype og eierforhold.
- PDF-tjenesten kan trekke kildeblokker, planmetadata og RAG-klare utdrag fra
  planfaglige PDF-er. Uttrekket blir søkbart automatisk og markerer usikkerhet,
  OCR og komplekse sider med kvalitetsflagg.
- Sandkassen har sentral samtykkekontroll, tidsriktig gating av resultater,
  revisjonslogg, AI-spor, deterministiske vilkår og søknads-/SvarUt-flyt.
- KS Digital-stilene finnes lokalt i `apps/shared`. De kan brukes uten å introdusere
  et nytt frontendrammeverk.

### Kapabilitetsgap

Matrikkel-dataene har ikke tilstrekkelig informasjon om:

- eiendomsgrenser og foreslått fotavtrykk som geometri;
- lokale planbestemmelser knyttet til eiendommen;
- eksisterende og tillatt BYA/BRA;
- fareområder, vern, vei, jernbane, kyst og ledningsnett;
- målbare byggegrenser og andre kartlag.

PDF-uttrekk kan gi kildeforankret plantekst, men er ikke alene en autoritativ
geodatakilde. Det trengs derfor en egen syntetisk arealdatatjeneste for geometri og
eiendomsspesifikke, kvalitetssikrede planfakta. Siden `8089` nå er opptatt, skal den
nye tjenesten bruke `8090`, etter at porten er verifisert ledig.

## 6. Produktdesign

### Start

1. Brukeren autentiseres gjennom eksisterende syntetiske ID-porten-mønster.
2. Brukeren søker etter eller velger en eid eiendom.
3. Brukeren beskriver ideen i vanlig språk og kan velge en grov tiltakstype.
4. KI foreslår strukturert tiltak, bruk, mål og usikkerheter.
5. Forslaget vises som redigerbare kort og blir ikke bekreftet før brukeren aktivt
   godkjenner det.

Ved tvetydighet skal grensesnittet vise alternativer eller be om ett konkret svar.
Det skal aldri skjule et modellvalg som en fastslått sannhet.

### Arbeidsflaten

Hovedflaten skal inneholde:

- en «neste beste handling» som peker på den viktigste åpne oppgaven;
- et kart over eiendommen og relevante lag;
- kort for tiltak, eiendom, planer, begrensninger, mål/beregninger, dokumentasjon,
  naboer, samarbeid og innsending;
- en beredskapsoversikt som skiller mellom ferdig, må bekreftes, mangler,
  usikkert og blokkert;
- en valgfri assistentskuff med kontekst fra aktivt kort.

Brukeren kan bevege seg fritt. Ikke modeller arbeidsflaten som en lineær rekke med
sju eksisterende prosessteg, og ikke vis en fremdriftsprosent som antyder sikkerhet
når vesentlige fakta er ukjente.

Hvert synlig faktum skal ha:

- opphav: autoritativ syntetisk kilde, bruker, fagperson eller KI-forslag;
- status og eventuell konfidens/usikkerhet;
- kildereferanse og versjon/hentetid;
- en kort «hvorfor dette betyr noe»-forklaring;
- mulighet for korreksjon eller utfordring.

### Kart

- Vis eiendomsgrense, eksisterende bygg og syntetiske lag for plan, byggegrenser,
  fare, vern, vei, bane, kyst og infrastruktur.
- La brukeren tegne eller velge tiltakets fotavtrykk og angi høyde og bruk.
- Beregn areal, utnyttelse og relevante avstander deterministisk.
- Marker hvilke funn som gjelder den foreslåtte geometrien.
- Ha en fullverdig tastatur- og tallbasert reserveflyt. Kartet kan ikke være eneste
  måte å oppgi eller forstå informasjon på.

### Krav og dokumentasjon

- Generer et kravbrett fra tiltak, eiendom, planfakta, regelutfall og ansvarstype.
- Vis bare relevante krav, men la brukeren se hvorfor hvert krav er inkludert.
- Vedlegg knyttes til ett eller flere krav og får brukeroppgitt dokumenttype.
- Ikke bruk KI til å erklære tegninger eller dokumenter lovlige eller komplette i
  første versjon.
- Bruk `pdf-extractor` til kildeforankret plan- og regelkontekst der det er relevant,
  ikke til automatisk godkjenning av søkerens bevis.

### Samarbeid og naboer

- Hvis reglene krever fagperson, tilby invitasjon av et syntetisk foretak hentet fra
  eksisterende Brønnøysund-data.
- Fagpersonen arbeider i samme prosjekt med rollebasert tilgang og kan bekrefte
  avgrensede faglige opplysninger.
- Invitasjon, aksept, rolleendring og tilbakekalling skal være reviderbare hendelser.
- Nabovarsel, svar og 14-dagersperioden modelleres som prosjektstatus. Bruk eksisterende
  Fiks-mønstre der de passer, men hold adaptergrensen tydelig.

### Gjennomgang og innsending

Sluttkontrollen skal tydelig skille mellom:

- data fra autoritative/syntetiske tjenester;
- brukerens egne erklæringer;
- fagpersonens bekreftelser;
- KI-genererte utkast som brukeren har eller ikke har godkjent;
- uløste og manuelt vurderte forhold.

Kjør en deterministisk beredskapskontroll før innsending. Krev eksplisitt
bekreftelse. Innsendingen skal være idempotent og opprette søknad gjennom eksisterende
sandkasse-/SvarUt-flyt. Etterpå vises kvittering, status, eventuelle strukturerte
mangler/oppgaver, vedtak og senere påminnelse om ferdigattest.

## 7. Regler og tillatte utfall

Implementer vurderingen som en ren, synkron og versjonert domenemodul. Modellen skal
aldri være beslutningstaker. Et vurderingsresultat må kunne reproduseres fra et
literalprosjekt og et konkret regel-/kildegrunnlag uten kjørende tjenester.

Støtt disse semantiske utfallene; endelig stavemåte og wire-format dokumenteres i
OpenAPI før kode tas i bruk:

- ikke søknadspliktig;
- melding/dokumentasjon etter ferdigstillelse;
- søknad som innbyggeren kan sende uten ansvarsrett;
- søknad med ansvarlige foretak;
- dispensasjon eller annen manuell vurdering;
- kan ikke avgjøres fordi nødvendig grunnlag mangler eller er motstridende.

Regelprinsipper:

- Eiendomsspesifikke planbestemmelser går foran den generelle nasjonale
  utgangsregelen der de faktisk regulerer forholdet.
- Kombinerte tiltak får alle relevante krav og den strengeste nødvendige
  søknadsveien; behold delbegrunnelsene slik at resultatet kan forklares.
- Manglende autoritative fakta skal gi «kan ikke avgjøres», aldri et oppdiktet grønt
  resultat.
- Regelfunn skal peke på kilde, berørte prosjektfakta/geometri og nødvendig neste
  handling.
- Juridisk skjønn, dispensasjon og egnethetsvurdering løftes til menneske.
- Nye regler skal ligge ett sted. Tester og valideringsskript importerer regelen og
  skal ikke implementere en parallell kopi.

## 8. Teknisk arkitektur

### Ny frontend

Opprett `apps/byggesak-gui` på port `3002`:

- vanlig TypeScript som resten av frontenden, uten ny byggkjede;
- egen `client/tsconfig.json` etter eksisterende browsermønster;
- lokale KS Digital-stiler fra `apps/shared`;
- ikke kombiner KS Digital-stilene med `felles.css` på samme side;
- tilgjengelig SVG-basert kart er tilstrekkelig for syntetisk førsteversjon;
- responsivt oppsett med kart, kortflate og valgfri assistentskuff.

### Ny arealdatatjeneste

Opprett `apps/arealdata-mock` på port `8090`:

- separat HTTP-tjeneste med OpenAPI;
- søk/oppslag via eksisterende Matrikkel-identifikator;
- returnerer kvalitetssikrede syntetiske planfakta og GeoJSON-lag;
- hvert datasett oppgir kilde, versjon og gyldighet/revisjon;
- seed-data ligger under `data/`; ordinær runtime-tilstand ligger under `state/`;
- beskyttes med eksisterende Maskinporten-mønster;
- må ikke lese tjenesteinterne moduler fra Matrikkel eller backend.

Plan-PDF-er og strukturert plantekst håndteres av eksisterende `pdf-extractor`.
Arealdatatjenesten eier derimot geometri og det kvalitetssikrede,
eiendomsspesifikke faktagrunnlaget. Ikke slå disse tjenestene sammen.

### Backend

Utvid `sandbox-backend` med et eget, ikke-lineært byggeprosjektaggregat:

- Ikke press funksjonen inn i eksisterende `INFO` → `SUBMIT`-motor.
- Prosjektet er den varige arbeidsflaten og har versjon, deltagere/roller, eiendom,
  strukturert tiltak, kartplassering, kildefakta, funn, krav, vedlegg, naboaktivitet,
  samarbeid og innsendingstilstand.
- Alle endringer i delte state-filer bruker `updateJson`.
- Bruk optimistisk versjonssjekk slik at en eldre klient får konflikt i stedet for å
  gjeninnføre gammel tilstand.
- En endring i tiltak, geometri eller sentralt kildegrunnlag invaliderer avhengige
  beregninger, bekreftelser, utkast og beredskap.
- Sentraliser autorisasjon, kildegating, regler, revisjon og innsending. UI og agent
  skal ikke kunne omgå disse.

Definer en OpenAPI-beskrevet ressursfamilie under `/api/byggeprosjekter` for:

- opprette, liste, lese og arkivere prosjekt;
- foreslå, bekrefte og korrigere prosjektfakta;
- lagre og kontrollere kartplassering;
- kjøre vurdering på nytt;
- håndtere vedlegg og kobling til krav;
- invitere og administrere samarbeidspartnere;
- registrere nabovarsel og svar;
- lese/kjøre beredskapskontroll;
- sende idempotent og lese videre status;
- lese prosjektrelevant revisjon.

Ikke la dette dokumentet bli en sekundær liste over wire-felter. Den komplette
kontrakten og alle kodeverk skal eies av den nye OpenAPI-spesifikasjonen.

### KI

Utvid kun `ai-gateway` med avgrensede, skjemastyrte oppgaver:

- trekk ut et forslag til tiltak fra brukerens beskrivelse, med eksplisitte
  usikkerheter;
- forklar et konkret regelfunn med bare de kildeforankrede treffene som følger forespørselen;
- skriv utkast til tiltakstekst, nabovarsel, søknadsbegrunnelse eller
  dispensasjonsbegrunnelse;
- oppsummer åpne spørsmål for en fagperson eller kommunal saksbehandler.

Alle modellkall spores. Kildegrunnlaget skal være eksplisitt og begrenset.
Modellsvaret er forslag eller tekst, ikke et regelutfall. Leverandørfeil må la
brukeren fortsette i den strukturerte, manuelle kortflyten.

Ikke bruk `process-agent` som arbeidsflytmotor. Assistenten kan eventuelt bruke
verktøy for lesing/forklaring, men alle tilstandsendringer må gå via backendens
prosjekt-API og brukerens eksplisitte bekreftelse. Fjern eller endre ikke eksisterende
hardkodede agentstier for andre saker som en del av dette arbeidet.

### Innsendingsadapter

Lag en intern adaptergrense med operasjoner tilsvarende validering og idempotent
innsending av det kanoniske dossieret:

- Første adapter oversetter prosjektet til eksisterende sandkassesøknad og SvarUt.
- En fremtidig FtPB-adapter skal kunne implementeres uten endring i UI eller
  byggeprosjektets domenemodell.
- Adapteren returnerer strukturert kvittering, mangler og status; den skal ikke lekke
  tjenestespesifikke detaljer inn i kjernemodellen.

### Registrering og repo-konvensjoner

Registrer nye tjenester i Compose, `start.sh`, `start.bat`, tjenestekatalogen,
arkitekturdokumentasjon, API-oversikten, OpenAPI-kontrollene, import-DAG-en,
startup-testene og relevante pakkeskript.

Følg disse ufravikelige reglene fra `AGENTS.md`:

- Hele eksisterende applikasjonslaget er TypeScript uten byggesteg. Ikke legg til
  JavaScript importert fra TypeScript.
- Teknisk plumbing bruker engelske identifikatorer; norske domenebegreper bruker
  eksisterende translittereringsstil.
- Norsk prosa bruker `æ`, `ø` og `å`.
- Eksisterende wire-format er frosset. Ikke «rydde opp» i ruter, JSON-nøkler,
  kodeverk eller feilstavinger som fungerer som identifikatorer eller søkemønstre.
- Delte regler bor under `apps/shared` bare når flere tjenester faktisk trenger
  dem; `apps/shared` kan ikke importere fra tjenester.
- Tjenestepilene skal forbli en DAG.
- Beskyttede lesinger går gjennom sentral ressurs-/samtykkekontroll, og revisjon er
  et førsteklasses resultat.
- Alle fetcher i prosess-/prosjektdomenet bruker den sentrale upstream-håndteringen.

## 9. Sikkerhet, personvern og tillit

- Prosjekteier og invitert fagperson skal bare kunne lese prosjekter de deltar i.
- Profesjonelle rettigheter avgrenses til nødvendige deler og kan trekkes tilbake.
- Beskyttede data må vurderes på lesetid, ikke bare da de ble hentet.
- Revisjonsloggen skal dekke kildeoppslag, bekreftelser, korrigeringer,
  regelvurderinger, invitasjoner, rolleendringer og innsending.
- KI-sporet skal vise oppgave, godkjent kontekst og resultat, men minimere persondata
  og ikke kopiere unødvendige vedlegg.
- Vedlegg og PDF-tekst behandles som ubetrodd data. Instruksjoner i dokumentene er
  ikke systeminstruksjoner.
- Brukeren skal alltid kunne se hva som er KI-generert, hva som er bekreftet, og hvem
  som bekreftet det.

## 10. Testplan

### Domeneregler og datagrunnlag

- Tabelltester for alle støttede tiltakstyper og alle utfall.
- Grenseverdier for areal, høyde, utnyttelse og avstander.
- Lokale planbestemmelser som overstyrer den generelle utgangsregelen.
- Kombinerte tiltak og strengeste nødvendige søknadsvei.
- Manglende, foreldet eller motstridende plan-/fareinformasjon.
- Runtime-validering av alle kodeverk i alle datafiler regelen leser.
- Reproduserbar vurdering fra en literal prosjekttilstand.

### Geometri

- Tiltak innenfor og utenfor eiendomsgrensen.
- Kryssing av byggegrense, farelag og andre soner.
- Avstand til eksisterende bygg, nabo, vei, bane, kyst og ledninger.
- Ugyldig eller selvkryssende geometri.
- Arealberegning, enheter og eksplisitt avrunding.
- Tastatur-/tallflyten skal gi samme resultat som kartflyten.

### Prosjekt og samarbeid

- Oppretting, gjenåpning, arkivering og tilgangskontroll.
- Optimistisk konflikt ved samtidige endringer; ingen tapte oppdateringer.
- Endret tiltak/geometri fjerner eller markerer senere bevis som foreldet.
- Invitasjon, aksept, avgrenset faglig bekreftelse og tilbakekalling.
- Ingen lesing på tvers av prosjekter.
- Nabovarsel, svar og 14-dagersperioden.
- Idempotent innsending og trygg retry uten duplikatsøknad.

### KI

- Tvetydig fritekst gir alternativer eller behov for bekreftelse.
- Ingen modellrespons kan skrive bekreftet prosjektstate direkte.
- Forklaringer bruker bare oppgitte kilder og peker på riktig funn.
- Prompt injection i vedlegg behandles som innhold.
- KI-feil, timeout eller deaktivert leverandør etterlater en fullverdig manuell flyt.
- KI kan ikke endre regelutfall eller erklære søknaden komplett.

### Ende-til-ende-fixturer

Lag representative syntetiske prosjekter for:

- tiltak som ikke er søknadspliktig, men krever melding etterpå;
- enkel søknad som innbyggeren kan sende selv;
- tiltak som krever ansvarlig foretak;
- prosjekt med dispensasjon/manuell vurdering;
- ukjent tilfelle som mangler nødvendig plangrunnlag;
- kombinasjon av tiltak;
- endring etter nabovarsel eller før innsending;
- strukturert mangel og oppfølging etter innsending.

### Tilgjengelighet og repo-gates

- Full tastaturbruk, synlig fokus, logisk rekkefølge og feiloppsummering.
- Status skal aldri formidles bare med farge.
- `aria-live` brukes for korte oppdateringer, ikke til å lese opp hele kartet.
- Mobil og smal skjerm skal beholde tilgang til kartalternativ, kort og assistent.
- Kjør standard lint og full test, samt import-, OpenAPI-, startup-, concurrency-,
  revisjons-, samtykke- og upstream-testene og nye fokuserte tester.

## 11. Effektmåling og akseptansekriterier

Instrumenter uten å lagre unødvendig fritekst eller persondata:

- aktiv tid fra idé til riktig søknadsvei og til innsendingsklart dossier;
- antall spørsmål og manuelt oppgitte fakta;
- hvilke kort og kilder som skaper usikkerhet;
- korrigeringer av KI-forslag;
- behov for fagperson eller kommunal hjelp;
- mangler ved beredskapskontroll og etter innsending;
- fullføring, avbrudd og gjenopptakelse.

Første versjon er akseptert når:

1. Alle fullt kjente ende-til-ende-fixturer får forventet søknadsvei og passerer den
   relevante sjekklisten uten simulerte mangler.
2. Manglende eller motstridende fakta gir et synlig usikkert/manuelt utfall, aldri en
   falsk definitiv konklusjon.
3. En innbygger kan fullføre rutinefixturer uten å bruke chat eller kontakte et
   menneske.
4. KI reduserer arbeid for dem som bruker den, men er aldri nødvendig for å fullføre.
5. Fagperson kan overta avgrensede oppgaver i samme prosjekt uten duplisering.
6. Innsending kan forsøkes på nytt uten å opprette duplikat.
7. Eksisterende brukssituasjoner og alle repository-gates fortsetter å passere.

Kvalitet er en hard sperre: redusert tid eller færre henvendelser teller ikke som
gevinst dersom andelen falske definitive utfall øker.

## 12. Anbefalt implementasjonsrekkefølge

1. **Verifiser grunnlaget:** Les `AGENTS.md`, relevant dokumentasjon, gjeldende
   OpenAPI og den uinnsjekkede PDF-implementasjonen. Kartlegg eier av state og dagens
   søknads-/SvarUt-kontrakt. Ikke endre kode i dette steget.
2. **Kontrakter og fixturer:** Definer byggeprosjektets OpenAPI, arealdatatjenestens
   OpenAPI, kodeverk og representative syntetiske eiendommer/prosjekter. Skriv først
   forventede regelutfall som uavhengige test-orakler.
3. **Arealdata og ren regelkjerne:** Implementer arealdata-mock, geometri og den rene
   vurderingsmodulen med kildeversjoner og usikre utfall.
4. **Prosjektaggregat:** Implementer lagring, optimistisk concurrency, invalidering,
   tilgang, revisjon, samarbeid, naboer og beredskapskontroll i backend.
5. **Arbeidsflate uten KI:** Bygg hele kart- og kortreisen slik at alle fixturer kan
   fullføres manuelt.
6. **KI som forbedring:** Legg til strukturuttrekk, forklaringer og tekstutkast med
   eksplisitt bekreftelse og full fallback.
7. **Innsending og livsløp:** Koble sandkasseadapteren, kvittering, mangler, vedtak og
   ferdigattestoppfølging.
8. **Hardening:** Kjør hele testmatrisen, tilgjengelighetskontroll, audit review og
   demonstrer alle definerte utfall.

## 13. Avgrensninger for første versjon

- Ingen direkte produksjonsintegrasjon mot kommune, FtPB, e-post, betaling eller
  eksternt fagsystem.
- Ingen påstand om juridisk bindende vedtak eller full dekning av alle kommunale
  planer og tiltak.
- Ingen modellbasert avgjørelse av søknadsplikt, lovlighet, dispensasjon eller
  fullstendighet.
- Ingen automatisk kontroll av innholdet i brukerens tegninger eller bilder.
- Ingen generell agent som kan utføre skjulte handlinger på vegne av brukeren.
- Ingen ombygging av den eksisterende lineære prosessmotoren for å få denne
  arbeidsflaten til å passe.
- Ingen opprydding eller navneendring av eksisterende kontrakter som del av saken.

## 14. Kort instruks til implementerende agent

Gjenbruk sandkassens tillitsgrunnmur—samtykke, deterministiske regler, kildegating,
revisjon, AI-spor og tjenestegrenser—men ikke kopier formen på en eksisterende
søknadsflyt. Bygg en ikke-lineær prosjektarbeidsflate der brukeren alltid kan se hva
som er kjent, hvor det kom fra, hva som er usikkert, og hvem som må gjøre neste
handling. Gjør hele reisen brukbar uten KI før KI brukes til å gjøre den raskere og
lettere å forstå.
