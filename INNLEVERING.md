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
