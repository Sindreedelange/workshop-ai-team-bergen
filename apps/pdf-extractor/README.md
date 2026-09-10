# PDF-extractor

Python-tjeneste for kildeforankret uttrekk fra generelle PDF-er, lover,
forskrifter, regelverk, arealplaner og områdereguleringer. `generic` bevarer
struktur uten juridiske antakelser, `legal` finner nummererte regler, og
`arealplan` legger til plan- og kartmetadata.

Rå tekstblokker, side, koordinater og metode blir alltid bevart. OCR og
bildeanalyse supplerer kilden; modelltekst får aldri overskrive den.

Leserekkefølgen utledes fra generell sidegeometri: gjentatte topp- og
bunntekster skilles fra innholdet, tekstblokkenes startposisjoner grupperes i
kolonner, og overlappende blokker markeres som strukturelt usikre. Innholdssider
gjenkjennes fra overskrift og tetthet av nummererte oppføringer, ikke fra et
bestemt dokumentnavn, kommunenavn eller sidenummer. Den medfølgende Bergen-PDF-en
er en regresjonsfixture for denne generelle logikken.

## Lagring

- Runtime: `state/pdf-extractor/documents/<documentId>/`. Her ligger original-PDF,
  `document.json`, kontrollrapport, siderenderinger, `knowledge.md` og `chunks.jsonl`.
- Representative test-PDF-er: `data/pdf/fixtures/`

`state/` er alltid lokal runtime og blir ikke lagt i Git. `./start.sh --reset`
sikkerhetskopierer runtime-data til `_backup/`. Normal ekstraksjon skriver aldri
i `data/`.

`document.json` er kontrollgrunnlaget: rå blokker, koordinater, skrifter,
konfidens, metode og modellspor. Det er med vilje detaljert. Agenter bør normalt
bruke `GET /dokumenter/{id}/kunnskap` for hel kontekst eller `POST /sok` for
målrettet semantisk gjenfinning. `POST /sok` bruker en vedvarende SQLite-basert
vektordatabase under `state/pdf-extractor/`; den flerspråklige embeddingmodellen
ligger ferdig i Docker-imaget. Det finnes ingen plan- eller PDF-spesifikk
søkerangering. Begge svarene beholder dokument-ID, side og innholdstype, slik at
et svar kan føres tilbake til kontrollgrunnlaget.

Opplasting til `POST /dokumenter` starter uttrekk og indeksering automatisk og
returnerer både dokument-ID og jobb-ID. Jobben blir ikke
`completed` før `knowledge.md`, `chunks.jsonl` og vektorene er lagret. Ved en
endring i embeddingmodell eller chunkformat bygger tjenesten automatisk opp
manglende eller utdaterte indekser ved oppstart. `POST /sok` gjør aldri skjult
indekseringsarbeid midt i et lesekall.

Alle ferdige uttrekk kan brukes av søk og `process-agent` med en gang. Kildebruken
logges i vektordatabasen og kan kontrolleres på `GET /revisjon`. Spørsmålstekst
og dokumentinnhold lagres ikke i
denne revisjonsloggen. Vektorsøket gjør en enkel, dokumentavgrenset fullskanning;
det er et bevisst valg for sandkassens datamengde, ikke en ANN-løsning for stor
produksjonsskala.

## Kvalitetsflagg

Den visuelle rapporten viser én av to tilstander:

- Gult: kontroll anbefales ved OCR, forsøkt bildeanalyse, advarsler eller lav
  konfidens.
- Grønt: ingen kjente uttrekksproblemer.

Flagget stopper ikke bruk. Treffene inneholder status, kvalitetsadvarsler, side og
kildepeker slik at en agent kan ta forbehold eller kontrollere detaljuttrekket.
PDF-er som inneholder innbyggeropplysninger skal ikke gjøres til denne delte
kunnskapsbasen; det krever en egen prosess med samtykke og formålsavgrensning.

![Arkitektur for PDF-extractor](architecture.svg)

## CLI

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r apps/pdf-extractor/requirements.txt
set PYTHONPATH=apps/pdf-extractor
.venv/Scripts/python -m pdf_extractor extract data/pdf/fixtures/b65270000.pdf --profile arealplan
```

HTTP-flyten er opplasting til `POST /dokumenter`, status på `GET /jobber/{id}` og
resultat eller visuell rapport under dokumentet. `POST
/dokumenter/{id}/uttrekk` finnes bare for eksplisitt reprosessering.
Helseendepunktet viser konfigurert bildeanalysemodell og status for automatisk
indeksreparasjon.

## Modeller

`./start.sh` måler tilgjengelig RAM og, når det finnes, NVIDIA-VRAM. Skriptet
velger og laster ned både en lokal tekstmodell og en Qwen3-VL-modell som passer
maskinen før tjenestene startes. Et eksplisitt `OLLAMA_VISION_MODEL` i miljøet
eller `.env` overstyrer automatisk valg. Modellen kan også klargjøres manuelt:

```bash
ollama pull qwen3-vl:4b
```

Bildeanalyse brukes bare for skannede, diagramtunge eller strukturelt uklare
sider. Tilgjengeligheten sjekkes én gang før uttrekket, slik at en manglende
modell ikke gir ett langt tidsavbrudd per side. Manglende modell stopper ikke
uttrekket; OCR og kildeblokker beholdes, og tilgjengeligheten vises i
JSON-resultatet og kontrollrapporten.
