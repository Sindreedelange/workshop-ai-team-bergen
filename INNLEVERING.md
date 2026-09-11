# Team Bergen

**Medlemmer:** `Sindreedelange`, `KarolisDolg`

<!-- TODO: legg til de øvrige GitHub-brukernavnene i teamet før fristen. -->

## Hva vi lagde

**Tiltakshjelpen**, som svarer innbyggeren på om et byggetiltak er søknadspliktig før
spaden går i jorden. Innbyggeren beskriver tiltaket sitt, og tjenesten slår opp
eiendommen, kartutsnittet, arealformålet, reguleringsplanen og hensynssonene, og avgjør
mot faste regler etter SAK10 § 4-1. Modellen forklarer resultatet, den avgjør det ikke.

Reglene er ikke våre. De kommer fra et flytkart tegnet av en domeneekspert i Plan- og
bygningsetaten i Bergen kommune. Kartet ligger i
[`presentasjon/flytkart_hackathon.jpg`](presentasjon/flytkart_hackathon.jpg) og er
skrevet ut node for node i
[`docs/flytkart-tiltakssjekk.md`](docs/flytkart-tiltakssjekk.md). De tre stedene koden
med hensikt svarer noe annet enn kartet, er pinnet som avvik i `scripts/test-flytkart.ts`
i stedet for å bli stille borte.

Bakgrunnen er at det i 2025 ble meldt inn 700 tilsynssaker på boligtiltak manuelt, hver
med to tilsynsbetjenter. De nasjonale veilederne stopper der spørsmålet blir konkret, og
henviser til de lokale planene som innbyggeren selv må finne fram i. Vårt overslag, med
forutsetningene i [`README.md`](README.md#hva-de-700-sakene-koster), er at en avklaring på
forhånd kan spare 0,7 til 4 kommunale årsverk i året, og 1 400 til 11 200 timer hos
innbyggerne.

Nytt i forhold til sandkassen slik den kom, er tre ting: selve Tiltakshjelpen,
`pdf-extractor` med kildeforankret uttrekk og vektorsøk i lover, forskrifter og
arealplaner, og en dokumentchat som svarer fra de samme kildene med side og dokument
oppgitt under hvert svar.

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
| <http://localhost:3001> | Oversikten, med helsestatus for alle tjenestene |

De to demo-eiendommene er valgt fordi de svarer forskjellig: LNF er ikke automatisk et
nei, og arealformålet i kommuneplanen er ikke nok alene. Bakgrunnen står i
[`docs/tiltakshjelpen.md`](docs/tiltakshjelpen.md).

## Andre repoer og lenker

Ingen eksterne repoer. Alt ligger i forken, presentasjonen inkludert:
[`presentasjon/presentasjon_hackathon_team_bergen.pdf`](presentasjon/presentasjon_hackathon_team_bergen.pdf).

## Slik brukte vi KI

**I løsningen.** Modellene kjører på Telenor AI Factory, og vi bruker tre av dem:
`NVIDIA-Nemotron-3-Super-120B-A12B-FP8` til de tunge oppgavene der tenking er målt å
lønne seg, `GLM-5.2-FP8` og `Qwen3-Coder-Next-FP8` ellers. Tenking slås på per oppgave og
er pinnet av `pnpm test:reasoning`, så en ny oppgave ingen har vurdert gjør testen rød i
stedet for å arve «tenker ikke» i stillhet.

**Det modellen ikke får gjøre.** Den avgjør ingenting. Vilkårene vurderes deterministisk
i `apps/sandbox-backend/src/vilkaar.ts` og `tiltakshjelpen.ts`, utenfor modellen, slik at
et utfall kan reproduseres og etterprøves. Rådet modellen skriver, går gjennom en klemme i
`tiltakshjelpen-raad.ts` som leser modellens egne setninger og forkaster prosa som gjør
utfallet mildere enn reglene. Dokumentchatten svarer bare fra de utdragene søket faktisk
fant, og `/ai/sporsmaal` har ingen egen datatilgang, så den kan strukturelt ikke nå data
bak samtykkeporten. Hvert modellkall ligger i KI-sporet med prompt, svar og tenking.

**I utviklingen.** Claude Code, brukt til kode, tester og dokumentasjon. Vi har lest og
svart for alt som er sjekket inn.

## Slik kan du etterprøve det

Hver påstand under har et sted å se etter. Kjør kommandoen, eller åpne filen.

### Det tekniske grunnlaget

Reglene er rene funksjoner uten I/O. `apps/sandbox-backend/src/vilkaar.ts` og
`tiltakshjelpen.ts` tar tilstanden inn som en parameter, så et utfall kan pinnes med et
literal og uten en eneste kjørende tjeneste. Det er dette som gjør at en vurdering kan
etterprøves i stedet for å måtte stoles på.

Flytkartet fra Plan- og bygningsetaten er skrevet ut node for node, og de tre stedene
koden med hensikt svarer noe annet enn kartet, er pinnet som avvik framfor å bli stille
borte. `pnpm test:flytkart` kjører 57 tilfeller fra kartet mot regelen som faktisk kjører.

En påstand uten en navngitt sjekk er et ønske, så påstandene har sjekker:
`pnpm test:imports` (importgrafen mellom tjenestene er en DAG), `pnpm test:openapi`
(hver rute dokumentert, begge veier), `pnpm test:kodeverk` (et kodeverk ingen leser er en
påstand koden ikke innfrir) og `pnpm test:docs`, som fanget to reelle feil i README-en
mens den ble skrevet. Ingen av dem trenger modell eller kjørende stack.

`pdf-extractor` beholder side, koordinater og metode gjennom hele kjeden fra PDF til
vektortreff, så et svar kan spores tilbake til siden det står på. Alt dette uten
byggesteg og med én avhengighet i kjøretid.

### Sperrene rundt modellen

Det interessante er ikke at vi kaller en modell. Det er hva vi hindrer den i å gjøre.

**Modellen kan ikke gjøre utfallet mildere enn reglene.** Klemmen i
`apps/ai-gateway/src/tiltakshjelpen-raad.ts` leser modellens egne setninger, ikke bare
utfallsfeltet, og forkaster tillatende prosa som motsier vurderingen. Den skiller
modellens egne ord fra det som er sitert fra regelen, fordi den første versjonen traff
reglenes egne forbehold og byttet ut rådet i fem av sju grener.
`pnpm test:tiltakshjelpen-raad` pinner begge retninger.

**Tenking er en målt beslutning per oppgave, ikke en global bryter.** Policyen er
`OPPGAVE_REASONING`, hver oppgave står der med målingen som er grunnen, og
`pnpm test:reasoning` gjør en ny oppgave rød i stedet for at den arver «tenker ikke» i
stillhet. Selve tenkingen havner i `/trace` som en egen blokk: en reasoning-modell uten
tenkingen i sporet er mindre etterprøvbar enn en modell uten tenking, ikke mer.

**Sperrene ligger i kode, ikke i prompten.** `apps/ai-gateway/src/sporsmaalsperrer.ts` er
en modul uten avhengigheter nettopp så den kan testes: `pnpm test:sperrer`. Og
`/ai/sporsmaal` har ingen egen datatilgang, så den kan strukturelt ikke nå data bak
samtykkeporten, uansett hva noen skriver inn i feltet.

**Gjenfinningen er forankret, ikke fri.** Dokumentchatten svarer bare fra utdragene søket
faktisk fant, med dokument og side under hvert svar, og et treff i en PDF gjør aldri et
vilkår kontrollert på egen hånd.

### Det innbyggeren møter

**Tjenesten begynner ikke med et skjema.** Den begynner med at innbyggeren beskriver
tiltaket sitt med egne ord, og så henter tjenesten det den trenger selv: eiendom,
kartutsnitt, arealformål, reguleringsplan, hensynssoner og bebyggelse. Innbyggeren blir
ikke bedt om å slå opp noe hun ikke har forutsetning for å finne.

**Svaret kommer før du bygger, ikke etter.** Det er hele poenget: de 700 tilsynssakene er
samtaler som skjer for sent.

**«Må avklares» er et ekte svar, ikke en feil.** Der tjenesten ikke kan avgjøre, sier den
det, og gir kontaktinformasjonen til kommunens veiledere i stedet for å gjette.
`pnpm test:tiltakshjelpen` pinner det.

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

- **Dokumentchatten er ikke lenket fra oversikten** på `:3001`, og står ikke i
  `docs/deltakerstart.md` §2. URL-en må skrives direkte.
- **Dokumentkildene indekseres ikke ved oppstart.** Verken `start.sh` eller
  `docker-compose.yml` laster dem inn, så steget over må kjøres for hånd.
- **Ingen av PDF-ene er kontrollert av en fagperson.** Et treff gjør derfor aldri et
  vilkår kontrollert på egen hånd, og planbestemmelsene leses ikke automatisk.
- **Hensynssoner og arealformål navngis, de avgjør ikke.** Uttrekket er frosset i 2018, og
  hva som er tillatt står i planbestemmelsene piloten ikke leser. Ett unntak går andre
  veien: en faresone holder tilbake meldeplikt-fritaket.
- **`meldeplikt` kan i dag bare oppstå i LNF**, fordi KPA2018 § 31.3 er den eneste
  planbestemmelsen vi faktisk kontrollerer.
- **Tallene i kostnadsoverslaget er et overslag**, ikke et regnskap. Timeforbruket per sak
  og den andelen som kan unngås, er våre antakelser; bare gebyrsatsene er hentet fra
  Bergen kommunes egen gebyrforskrift.
