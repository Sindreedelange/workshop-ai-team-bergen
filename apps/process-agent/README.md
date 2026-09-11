# Process Agent

**For deg som vil se en prosess kjørt i naturlig språk, eller bygge en agent som gjør
det samme.** Den veileder en bruker gjennom en prosess ved å kalle verktøy i
`tools-api`: velge prosess, svare på spørsmålssteg, håndtere samtykke og sende inn.
Vil du styre stegene selv, går du rett på `sandbox-backend`.

## Slik finner den verktøy

På et `QUESTION`-steg kaller agenten `suggest_step_tools` i `tools-api`, som spør
`ai-gateway /ai/velg-verktoy` hvilke verktøy steget trenger og hvordan de skal brukes.
Mekanismen og `bruk`-verdiene er forklart i `docs/prosessmodell.md`; den forklaringen
bor der, ikke her.

Den dynamiske oppdagelsen er ekte, men **ikke den eneste veien**. Agenten bærer også
hardkodede snarveier for `fartsdempende-tiltak`, med et stegnøklet intervjuskript i
`guidedInterviewDefinitions`. Snarveiene finnes fordi de var raskeste vei til en
fungerende demo, ikke fordi de er riktige. Hvilke steg og verktøy det gjelder står i
`docs/prosessmodell.md`.

Et forslag er ikke en ferdig kobling. Agenten støtter i dag automatisk oppslag og
validering med `matrikkel_finn_veger` på spørsmål med ett tekstfelt. Andre verktøy,
brukstyper eller feltformer gir en synlig advarsel om at svaret ikke blir kontrollert.
Nye koblinger trenger også støtte i agenten for argumentene og svarformen, eller et
`DATA_FETCH`-steg som motoren kjører. Oppdagelsen kjøres også på flerfeltsspørsmål,
men disse valideres ikke automatisk med et registerverktøy.

## Spørsmål, retting og avslutning

Agenten spør om obligatoriske felt ett om gangen, viser alternativene og lagrer
valgenes verdier. Valgfrie felt samles ikke inn i denne klienten. Et tall i en
behovsbeskrivelse velger ikke et menypunkt; skriv for eksempel «2» eller «den andre»
for å velge fra listen.

[Tiltakssjekken «Kan du bygge uten å søke?»](../../docs/tiltakshjelpen.md) har ett unntak: tiltaksspesifikke felt er valgfrie i den felles
prosessdefinisjonen, men må likevel samles inn for valgt tiltak. Dialogen velger
bare den aktuelle kataloggrenen. Uten tiltakstype beholder den de opprinnelige
garasjespørsmålene, slik at eldre samtaleklienter ikke hopper over mål og avstander.

Et «nei» til oppsummeringen går tilbake til nærmeste tidligere `QUESTION`, også
når det ligger samtykke, oppslag og sjekker mellom spørsmålet og oppsummeringen.
Endrede svar gjør at grunnlaget hentes og vurderes på nytt. Hvis prosessen ikke har
egne svar å rette, blir agenten stående ved oppsummeringen og forklarer at feil i
registeropplysninger må rettes hos kilden. Ingenting sendes inn uten godkjenning.

En prosess kan slutte med informasjon eller et oppslag. Da stopper agenten med
`awaiting: process_end`, uten å gjenta handlingen eller hevde at en søknad er sendt.
Motorøkten forblir åpen: bare `SUBMIT` fullfører en søknad.

Gjenkjente spørsmål om tjenesten og uttrykkelige registeroppslag setter dialogen på pause.
Et vanlig svar som «hjelp med personlig hygiene» er ikke et søk etter en person.
Ved adresseoppslag beholdes postnummer og poststed, for eksempel i «Hvem eier
Storgata 5, 5003 Bergen?». Et tvetydig treff ber om presisering i stedet for å
bli omtalt som en adresse som ikke finnes.
Agenten husker hvilket adresseoppslag som må avklares. Et påfølgende «5003» hører
derfor til oppslaget, ikke til søknaden. Et nytt fullstendig adressespørsmål erstatter
oppslaget; andre gjenkjente sidespørsmål lar avklaringen vente. «Avbryt oppslaget»
går tilbake til det opprinnelige feltet uten å lagre meldingen som et svar.

## Endepunkter

- `GET /helse`
- `POST /agent/garasje/dialog` forklarer ett felt uten å lagre svaret
- `POST /agent/garasje/raad` forklarer en oppgitt regelbasert vurdering uten å endre den
- `POST /agent/sessions` oppretter en ny agentøkt
- `GET /agent/sessions/{sessionId}` henter status for økten
- `POST /agent/sessions/{sessionId}/messages` sender en brukermelding

Tiltaksdialogen og sluttrådet henter PDF-kunnskap gjennom `tools-api`: først
dokumentlisten med kildemetadata, deretter et søk avgrenset til dokumenter som
passer kjent kommune og plan. Svaret har høyst tre utdrag på 1800 tegn med
sidehenvisninger og kvalitetsvarsler. Et søketreff bekrefter ikke at planen
gjelder eiendommen, at hele bestemmelsen er lest eller at tiltaket er tillatt.
Kildeadressen hentes fra dokumentlisten. Et utdrag med en annen kildehash enn
dokumentet utelates; manglende hash og varsler fra søket følger svaret.
Høyst tre dokumenter søkes. Ulike kjente planer prioriteres før flere dokumenter
for samme plan, og hvert dokument med treff får ett utdrag før et dokument får
flere. Manglende planutdrag og dokumenter eller treff som budsjettet utelater,
oppgis som begrenset dekning.
Kartgrunnlaget sender også høyst åtte planflater som metadata: sonekode, navn,
plan, overlapp med eiendommen og om skissepunktet ligger i flaten. Punktkontrollen
bruker samme geometri som backend og kartet, inkludert hull og punkter på kanten.
Ringer, koordinater og adresser sendes ikke videre. Kildestatus og eventuelle
utelatte flater eller forkortede tekster følger grunnlaget og vises som varsler.
En kilde som feiler er ukjent dekning, ikke fravær av hensynssoner.
Manglende dokument, ukjent kommune og oppslagsfeil gir et synlig varsel og et
neste steg hos kommunens byggesaksveileder.

Dialogen støtter også gjerde, tilbygg og fasade. Oppgi `tiltakstype` på toppnivå
eller i `kontekst.prosjekt.tiltakstype`; hvis begge er oppgitt, må de stemme.
Felt, etiketter og grenser kommer da fra
`BYGGETILTAK_KATALOG`. Et gjerdespørsmål skal ikke få garasjens høydegrenser.
For andre tiltak enn frittliggende bygning utelates disse nasjonale tallkravene
fra modellgrunnlaget. Katalogteksten og DIBK-henvisningen beholdes, og manglende
kildebekreftede grenser omtales som ukjente.
Den opprinnelige garasjedialogen beholder sine felt og grenser.

Sluttrådet tar den deterministiske vurderingen fra backend i
`kontekst.resultater["garasje-vurdering"]`, med vurderingen og det offentlige
grunnlaget. Dette er en forklaring av innsendte data, ikke en autentisert
vurderingsreferanse. Klienten må vise alle regelvilkår, kilder og varsler.
Se `openapi/process-agent.yaml` for hele kontrakten.
`pnpm test:tiltakshjelpen-raad` kjører agent, tools-api og gateway isolert med falsk
dokumenttjeneste og modell, og kontrollerer både dialogen og sluttrådet.

## Rask test

`pnpm test:agent:dialog` starter egne tjenester med AI-mock og midlertidig tilstand
under `state/`, og rydder opp etter seg. Testen trenger ikke Docker eller en modell,
kjører i CI og dekker alle demoprosessene helt til innsending, inkludert retting.
Standardportene er 21200 til 21209. De kan overstyres med
`AGENT_DIALOG_<TJENESTE>_PORT`, for eksempel `AGENT_DIALOG_AGENT_PORT`.
`AGENT_DIALOG_TOOL_PROBE_PORT` styrer HTTP-proxyen som prøver adresseargumenter
og feilsvar; de øvrige testkallene går videre til de ekte sandkassetjenestene.

`pnpm test:agent` og `pnpm test:agent:nl` trenger kjørende tjenester. Sett
`AGENT_BASE_URL`, `BACKEND_BASE_URL` og `DIGDIR_BASE_URL` hvis de bruker andre porter
enn Compose. Begge sjekker nå `FULLFORT` og den lagrede søknaden, ikke bare
agentens ventetilstand eller innsendingstekst.

```bash
curl -s -X POST http://localhost:8084/agent/sessions \
  -H "Content-Type: application/json" \
  -d '{"personId":"person-001"}'
```

```bash
curl -s -X POST http://localhost:8084/agent/sessions/<sessionId>/messages \
  -H "Content-Type: application/json" \
  -d '{"message":"søknad om fartsdempende tiltak"}'
```
