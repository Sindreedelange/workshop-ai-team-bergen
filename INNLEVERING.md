# Team Bergen

**Medlemmer:** Jon Leirvik, Karolis Dolgovas (`KarolisDolg`), Oskar Jahr (`oejahr`),
Remy Instefjord Uthaug (`RemyInstefjordUthaug`), Sindre Eik de Lange (`Sindreedelange`),
Tommy Sirnes, Øyvind Berle

## Hva vi lagde

**Tiltakshjelpen**, som svarer innbyggeren på om et byggetiltak er søknadspliktig før
spaden går i jorden. Innbyggeren beskriver tiltaket sitt, og tjenesten slår opp
eiendommen, kartutsnittet, arealformålet, reguleringsplanen og hensynssonene - områder
der planen sier at et særskilt hensyn gjelder - og avgjør mot faste regler etter
byggesaksforskriften (SAK10) § 4-1. Modellen forklarer resultatet, den avgjør det ikke.

Reglene er ikke våre. De kommer fra et flytkart tegnet av en domeneekspert i Plan- og
bygningsetaten i Bergen kommune. Kartet ligger i
[`presentasjon/flytkart_hackathon.jpg`](presentasjon/flytkart_hackathon.jpg) og er
skrevet ut node for node i
[`docs/flytkart-tiltakssjekk.md`](docs/flytkart-tiltakssjekk.md), med en kolonne som sier
hvor koden er enig med kartet og hvor den med vilje ikke er det.

Regelverket tjenesten avgjør etter er nasjonalt, og verdien av å avklare før spaden går i
jorden er derfor nasjonal. Skalert til hele landet er potensialet **12 til 75 kommunale
årsverk i året** og **27 000 til 214 000 timer spart hos innbyggerne** - om lag 13 400
tilsynssaker som ikke trenger å oppstå. Målt mot Bergens egne satser for medgått tid er
det 40 til 307 millioner kroner i året. Det er en størrelsesorden og ikke et budsjett, og
de fire forbeholdene står i [`README.md`](README.md#bergen-er-én-av-357).

**Tallene er regnet ut fra Bergen, som har vært caset vårt.** I 2025 ble det meldt inn 700
tilsynssaker på boligtiltak manuelt, hver med to tilsynsbetjenter. Det er arbeid som
oppstår etter at noe alt er bygget, og det oppstår fordi de nasjonale veilederne stopper
der spørsmålet blir konkret og henviser til de lokale planene innbyggeren selv må finne
fram i. Med forutsetningene i [`README.md`](README.md#hva-de-700-sakene-koster) kan en
avklaring på forhånd spare 0,7 til 4 kommunale årsverk i året i Bergen alene, og 1 400 til
11 200 timer hos innbyggerne. Bergen har 5,2 prosent av landets befolkning, og det er den
andelen tallene over er skalert med.

**Bergen er piloten, ikke grensen.** SAK10 § 4-1, TEK17 og plan- og bygningsloven er de
samme i hele landet, og adresse- og eiendomsoppslagene går mot Kartverket og Geonorge, som
også dekker hele landet. Det som er lokalt, er pekerne til kommunens kart og kommunens
meldeskjema, så kommune nummer to er en oppføring i
`apps/shared/tiltakshjelpen-kommuner.ts` framfor ny kode. Arbeidet er å finne fram til tre
kartlag, ikke å skrive regelverket på nytt.

Nytt i forhold til sandkassen slik den kom, er tre ting: selve Tiltakshjelpen,
`pdf-extractor` med kildeforankret uttrekk og vektorsøk i lover, forskrifter og
arealplaner, og en [dokumentchat](docs/dokumentchat.md) som svarer fra de samme kildene
med side og dokument oppgitt under hvert svar.

## Slik kjører du det

```bash
git clone <url til forken>
cd workshop-ai-team-bergen
cp .env.example .env
```

Sett `AI_PROVIDER=telenor-ai-factory` og `TELENOR_AI_FACTORY_API_KEY=<din nøkkel>` i
`.env`. Uten nøkkel virker alt annet, men KI-forklaringene faller tilbake til malstekst.

```bash
./start.sh
```

Første oppstart tar noen minutter. Last deretter inn dokumentkildene, som ikke indekseres
automatisk:

```bash
node -e "
const m = JSON.parse(require('node:fs').readFileSync('data/pdf/fixtures/manifest.json','utf8'));
for (const d of m.documents) console.log(d.filename, d.profile);
" | while read -r fil profil; do
  curl -s -F "fil=@data/pdf/fixtures/$fil" -F "profil=$profil" \
    http://localhost:8089/dokumenter
  echo
done
```

Så:

| URL | Hva du gjør der |
|---|---|
| <http://localhost:3001/tiltakshjelpen> | Tiltakshjelpen. Logg inn som `person-395` **Milda Garasjetest** (Litle Milde 65) eller `person-396` **Kåre Garasjetest** (Kråkenestoppen 60), beskriv en garasje, og kjør vurderingen |
| <http://localhost:3001/dokumentchat> | Dokumentchat. Spør for eksempel «Hva sier TEK17 om garasje med bruttoareal over 50 kvadratmeter?» |
| <http://localhost:8082/trace> | KI-sporet: hva modellen faktisk fikk og svarte, tenkingen inkludert |
| <http://localhost:3001> | Oversikten, med helsestatus for alle tjenestene og lenker til de to |

De to demo-eiendommene er valgt fordi de svarer forskjellig: LNF - landbruks-, natur- og
friluftsformål - er ikke automatisk et nei, og arealformålet i kommuneplanen er ikke nok
alene. Bakgrunnen står i [`docs/tiltakshjelpen.md`](docs/tiltakshjelpen.md).

## Andre repoer og lenker

Ingen eksterne repoer. Alt ligger i forken, presentasjonen inkludert:
[`presentasjon/presentasjon_hackathon_team_bergen.pdf`](presentasjon/presentasjon_hackathon_team_bergen.pdf).

## Slik brukte vi KI

**I løsningen.** All KI innbyggeren møter går gjennom Telenor AI Factory, og ingen annen
leverandør er i bildet. Vi bruker tre modeller der:
`NVIDIA-Nemotron-3-Super-120B-A12B-FP8` til de tunge oppgavene der tenking er målt å lønne
seg, `GLM-5.2-FP8` og `Qwen3-Coder-Next-FP8` ellers. Tenking er en avgjørelse per oppgave,
ikke en global bryter, og hver oppgave står med målingen som er grunnen. Ett unntak finnes,
og det ligger utenfor innbyggerveien: skal en dokumentside leses som bilde, går kallet til
en lokal Ollama-modell (`qwen3-vl:4b`), fordi ingen av de tre modellene på AI Factory tar
imot bilder.

**Det modellen ikke får gjøre.** Den avgjør ingenting. Vilkårene vurderes deterministisk
utenfor modellen, så et utfall kan reproduseres. Modellen formulerer: den forklarer et
utfall den ikke har regnet ut, og den kan ikke gjøre det mildere enn reglene. Svarene i
dokumentchatten er bundet til de utdragene søket faktisk fant.

**I utviklingen.** Claude Code til kode, tester og dokumentasjon, GitHub Copilot ved siden
av, og OpenCode med Telenor AI Factory som modelleverandør - altså samme leverandør
tjenesten selv kjører på. Det er også der vi målte modellene mens vi valgte dem, og de
målingene er grunnen til at reasoning-policyen ser ut som den gjør. Vi har lest og svart
for alt som er sjekket inn.

Hvordan vi vet at dette stemmer, står i seksjonen under. Der er hver påstand over knyttet
til en fil du kan åpne eller en kommando du kan kjøre.

## Slik kan du etterprøve det

### Det tekniske grunnlaget

Reglene er rene funksjoner uten I/O. `apps/sandbox-backend/src/vilkaar.ts` og
`tiltakshjelpen.ts` tar tilstanden inn som en parameter, så et utfall kan pinnes med et
literal og uten en eneste kjørende tjeneste. Det er dette som gjør at en vurdering kan
etterprøves, ikke bare stoles på.

`pnpm test:flytkart` kjører 57 tilfeller fra fagpersonens flytkart mot regelen som
faktisk kjører. De tre stedene koden med vilje svarer noe annet enn kartet, er pinnet som
avvik i `scripts/test-flytkart.ts` framfor å bli stille borte: et avvik som er skrevet ned
kan diskuteres med den som tegnet kartet, et avvik som forsvant i en opprydding kan ikke.

De øvrige påstandene har også en navngitt sjekk. `pnpm test:imports` (importgrafen mellom
tjenestene er en rettet asyklisk graf), `pnpm test:openapi` (hver rute dokumentert, begge
veier), `pnpm test:kodeverk` (et kodeverk ingen leser er en påstand koden ikke innfrir) og
`pnpm test:docs`, som fanget to reelle feil i README-en mens den ble skrevet. Ingen av dem
trenger modell eller kjørende stack.

`pdf-extractor` beholder side, koordinater og metode gjennom hele kjeden fra PDF til
vektortreff, så et svar kan spores tilbake til siden det står på. Kjeden er skrevet ut i
[`docs/dokumentchat.md`](docs/dokumentchat.md). Alt dette uten byggesteg og med én
avhengighet i kjøretid.

### Sperrene rundt modellen

Sperrene er kode, ikke formuleringer i prompten. Fire av dem er verdt å åpne.

**Modellen kan ikke gjøre utfallet mildere enn reglene.** Rådet modellen skriver, går
gjennom en klemme i `apps/ai-gateway/src/tiltakshjelpen-raad.ts` - en sperre som leser
prosaen og forkaster et råd som motsier vurderingen. Den leser modellens egne setninger
og ikke bare utfallsfeltet, og skiller modellens egne ord fra det som er sitert fra
regelen: den første versjonen traff reglenes egne forbehold og byttet ut rådet i fem av
sju grener. `pnpm test:tiltakshjelpen-raad` pinner begge retninger.

**Tenking er en målt beslutning per oppgave.** Policyen er `OPPGAVE_REASONING` i
`apps/ai-gateway/src/reasoning.ts`, hver oppgave står der med målingen som er grunnen, og
`pnpm test:reasoning` gjør en ny oppgave rød i stedet for at den arver «tenker ikke» i
stillhet. Selve tenkingen havner i `/trace` som en egen blokk: en reasoning-modell uten
tenkingen i sporet er mindre etterprøvbar enn en modell uten tenking, ikke mer.

**Fritekstspørsmål har sperrene sine i en egen modul.**
`apps/ai-gateway/src/sporsmaalsperrer.ts` er uten avhengigheter nettopp så den kan
testes: `pnpm test:sperrer`. Og `/ai/sporsmaal` har ingen egen datatilgang, så den kan
strukturelt ikke nå data bak samtykkeporten, uansett hva noen skriver inn i feltet.

**Gjenfinningen stopper av seg selv.** Finner søket ingen utdrag, svarer dokumentchatten
med fast tekst, og modellen kalles ikke i det hele tatt. Finner det mange, beholdes tre,
hver kuttet til 1800 tegn - et bredere søk gir ikke et bredere svar. Hvert treff vises med
dokument og side under svaret, og `checkRecommended` settes uansett hva treffet selv sa,
så et treff i en PDF kontrollerer aldri et vilkår alene.

### Det innbyggeren møter

**Tjenesten begynner ikke med et skjema.** Den begynner med at innbyggeren beskriver
tiltaket sitt med egne ord, og så henter tjenesten det den trenger selv: eiendom,
kartutsnitt, arealformål, reguleringsplan, hensynssoner og bebyggelse. Ingen blir bedt om
å slå opp noe de ikke har forutsetning for å finne.

**Svaret kommer før du bygger, ikke etter.** Det er hele poenget: de 700 tilsynssakene er
samtaler som skjer for sent.

**«Må avklares» er et ekte svar, ikke en feil.** Der tjenesten ikke kan avgjøre, sier den
det, og gir kontaktinformasjonen til kommunens veiledere i stedet for å gjette.
`pnpm test:tiltakshjelpen` pinner det.

**Klart språk er en plikt her, ikke en ambisjon.** Språklova § 9 binder kommunale organ
til «eit klart og korrekt språk som er tilpassa målgruppa». Derfor oversettes kodeverket
til det innbyggeren skal lese, i `apps/shared/hensynssoner.ts`. Og derfor får en sonekode
kodeverket ikke kjenner *ikke* et klarspråksnavn påklistret: da viser tjenesten kodens
egen verdi framfor å gjette, fordi en pen formulering som er feil er verre enn en kode som
er stygg.

**Tilgjengelighet er sjekket, ikke antatt.** `scripts/test-tiltakshjelpen-ux.ts`
kontrollerer at modusknappene har `aria-pressed`, at fokus flyttes til feltet innbyggeren
skal skrive i og til overskriften for resultatet, og at kartet er nåbart med tastatur, med
`tabindex` og en beskrivelse knyttet til seg. Statusfeltene er `aria-live`, så en
skjermleser får med seg at noe endret seg. Og `apps/shared/ds-morketema.css` er vår egen
rettelse av mørkt tema, der hver overstyring står med kontrastforholdet den retter:
designsystemets `warning` gav 1,90:1 mot den mørke bakgrunnen, under de 3:1 WCAG 1.4.11
vil ha for kanten på en komponent, og `accent` landet 1,00:1 fra nøytralfargen - samme
knapp to ganger.

**Siden sier hva som skjer når en kilde er treg.** Bergens bygningskart svarer av og til
ikke, og da byttes statuslinjen ut etter 2,5, 6 og 13 sekunder med tekst som navngir
kommunen, at oppslaget prøves på nytt, og hva som skjer hvis kilden forblir taus. Uten
det sto én etikett stille i opptil tolv sekunder og siden leste som hengt.

**Hvert ledd har kilde og forbehold.** Innbyggeren ser hva svaret hviler på, og hvor det
er usikkert, framfor et grønt eller rødt lys uten begrunnelse.

**Ingen søknad sendes inn.** Casen gir veiledning, og sier uttrykkelig at et nasjonalt
unntak ikke er en byggetillatelse.

Det vi ikke har: dette er ikke testet på ekte innbyggere. Vurderingene over er om hva
løsningen gjør, ikke målinger av hva folk faktisk får til.

## Det som ikke ble ferdig

- **Vi mangler ledningsdata fra Vann- og Avløpsetaten.** «Ikke over vann- eller
  avløpsledninger» er et av vilkårene i det nasjonale unntaket, og tjenesten må spørre
  innbyggeren om det - `overVannAvlop`, med «vet ikke» som gyldig svar - framfor å slå det
  opp. Ledningskartet er ikke åpent tilgjengelig slik de øvrige kartlagene er, fordi vann-
  og avløpsnettet er kritisk infrastruktur og skjermet etter beredskapslovverket. Med
  tilgang til de dataene kunne leddet blitt slått opp for innbyggeren, slik eiendom,
  arealformål og bebyggelse blir i dag.
- **Bare Bergen har en oppføring.** De øvrige 356 kommunene får en tom kildeliste og
  «må avklares», med vilje: en kommune uten oppsett skal aldri arve Bergens kart eller
  regler. Hvor mye arbeid de andre oppføringene er, har vi ikke undersøkt - ikke alle
  kommuner publiserer plandata over et åpent kart-API i samme form.
- **De store datafilene ligger i forken, mot anbefalingen.**
  [`docs/innlevering.md`](docs/innlevering.md) ber om at datasett på flere megabyte ikke
  commites. Vi har dem likevel med: Bergens teiguttrekk (`data/matrikkel_bk_25.json`,
  21 258 teiger) og de seks KPA2018-lagene som GeoJSON, til sammen rundt 150 MB i
  arbeidstreet, pluss de seks referanse-PDF-ene på om lag 22 MB. Grunnen er at det er
  disse som gjør at teigoppslaget, kartsteget og dokumentsøket virker uten nett, og et
  hackathon uten nett skal ikke miste dem. Alt kan hentes på nytt - teigene fra Geonorge,
  planlagene fra Bergen kommunes karttjenester, og PDF-ene fra utstederne med sha256 i
  `data/pdf/fixtures/manifest.json` - så skal de ut av historikken, er det mulig, men det
  er en egen jobb vi ikke har gjort.
- **Dokumentkildene indekseres ikke ved oppstart.** Verken `start.sh` eller
  `docker-compose.yml` laster dem inn, så steget over må kjøres for hånd.
- **Dokumentchatten har ingen tester.** Verken klienten eller siden er dekket.
  Vektorlaget under er testet i `apps/pdf-extractor/tests/test_extractor.py`, men
  `pnpm test:pdf` står ikke i CI og må kjøres for hånd.
- **Ingen automatisert tilgjengelighetskontroll.** Kontrastforholdene over er regnet ut
  for hånd og skrevet ned, ikke målt av en gate i CI.
- **Ingen av PDF-ene er kontrollert av en fagperson.** Et treff kontrollerer derfor aldri
  et vilkår alene, og planbestemmelsene leses ikke automatisk.
- **Hensynssoner og arealformål navngis, de avgjør ikke.** Uttrekket er frosset i 2018, og
  hva som er tillatt står i planbestemmelsene piloten ikke leser. Ett unntak går andre
  veien: en faresone holder tilbake meldeplikt-fritaket.
- **`meldeplikt` kan i dag bare oppstå i LNF**, fordi § 31.3 i Bergens kommuneplan,
  arealdelen 2018 (KPA2018) er den eneste planbestemmelsen vi faktisk kontrollerer.
  `meldeplikt` er det ene fritaket piloten gir: du trenger ikke å søke, men må melde inn
  når du er ferdig å bygge.
- **Tallene er overslag, ikke regnskap.** Timeforbruket per sak og den andelen som kan
  unngås, er våre antakelser; bare gebyrsatsene er hentet fra Bergen kommunes egen
  gebyrforskrift. Det nasjonale tallet er i tillegg skalert fra det lokale med
  befolkningsandel, som er den groveste nøkkelen som finnes, og usikkerheten blir ikke
  mindre av å ganges med 19.
