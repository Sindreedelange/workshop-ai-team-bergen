---
name: norsk-klarspraak
description: Bruk denne når norsk prosa i dette repoet skal skrives eller vaskes - dokumentasjon, README, innlevering, kodekommentarer eller tekst innbyggeren leser. Dekker husstilen, plikten til klart språk i en kommunal tjeneste, og de tre fellene en vanlig språkvask går i her. Bruk også når noen ber om korrektur, «les gjennom», eller spør om en tekst er forståelig nok.
---

# Norsk klarspråk i dette repoet

## Regelen bor i AGENTS.md. Les den først.

Husstilen er `AGENTS.md` § **Language**, punkt 1 til 9. Den eier reglene, og denne
skillen gjentar dem ikke: to kopier av samme regel er nøyaktig det `AGENTS.md` advarer
mot, og er grunnen til at feltnavnlistene ble flyttet ut av prosaen og over til
`openapi/*.yaml`.

Kort om hva som står der, så du vet hva du går glipp av hvis du ikke leser den: skillet
prosa mot identifikator, forbudet mot å røre en streng som sammenlignes med brukerinput,
engelsk for rørleggingen og norsk for domenet, at identifikatorer transliterer og prosa
aldri gjør det, `-en` framfor `-a`, ingen em-dash, guillemets framfor krøllede
anførselstegn, tabellen over tungt språk, og hvilken fil som skrives på hvilket språk.

**Denne skillen legger til to ting `AGENTS.md` ikke har:** hvorfor klart språk er et krav
og ikke en smakssak her, og hva en generisk språkvask ødelegger hvis den slippes løs på
dette repoet.

## Klart språk er hjemlet, ikke en ambisjon

**Språklova § 9:** «Offentlege organ skal bruke eit klart og korrekt språk som er
tilpassa målgruppa.» Plikten gjelder uttrykkelig kommunale organ, og den gjelder
publikumsrettet informasjon, informasjon til enkeltpersoner og digitale
selvbetjeningsløsninger. En tjeneste i dette repoet er en øvelse på nettopp det.

Det betyr at «forståelig nok» ikke er en vurdering forfatteren gjør alene. Språkrådets
kriterium er tredelt, og det er brukbart som faktisk sjekkliste: leseren skal **finne**
det hun trenger, **forstå** det hun finner, og kunne **bruke** det til å gjøre det hun
skal. En tekst som er korrekt og komplett, men som leseren ikke finner fram i, har ikke
oppfylt noe av de tre.

De seks skriverådene fra Språkrådet, i rekkefølge:

1. Se leseren for deg. Hvem er det, og hva kan hun fra før?
2. Fjern overflødig tekst. Hva er budskapet, og hva er utenomsnakk?
3. Bygg opp logisk. Det viktigste først.
4. Bruk aktive og korte setninger.
5. Velg ord leseren forstår, eller forklar dem der de først dukker opp.
6. La noen andre lese over.

Punkt 5 er det som oftest mangler her. Et domeneord som `hensynssone`, `teig`,
`meldeplikt`, `SAK10`, `KPA2018`, `LNF` eller `BYA` er gjennomsiktig for den som har
jobbet med byggesak og ugjennomtrengelig for alle andre. `docs/ordliste.md` er stedet
det slås opp, men et dokument skal kunne leses alene: en halv setning ved første
forekomst koster lite og sparer leseren for et oppslag.

## Tre feller en generisk språkvask går i her

Dette er grunnen til at en vanlig korrekturskill ikke kan brukes ukritisk på dette
repoet. Hver av de tre er en endring som ser riktig ut, ikke gjør noe rødt, og ødelegger
noe.

**1. Et mønster ser ut som en stavefeil.** `apps/ai-gateway/src/sporsmaalsperrer.ts` og
de andre normalisererne inneholder med vilje strenger uten norske bokstaver - `kjor pa`,
`avsla`, `ma jeg`, `nar` - fordi det er det folk faktisk skriver inn. De står på høyre
side av `includes`, `startsWith`, `match` eller i et `Set` som søkes. Retter du dem, blir
ingenting rødt, ingen logglinje dukker opp, og sperren slutter bare å slå til.
`AGENTS.md` punkt 2 har den mekaniske testen. Er du usikker på om en streng er prosa,
behandle den som en identifikator.

**2. Et sitat er ikke vårt å stave om.** `apps/shared/hjemmel.ts` eier korttitlene til
lovene dette repoet siterer, og de er ikke konsistente med hverandre: `opplæringslova` er
nynorsk fordi loven fra 2023 ble vedtatt slik, `barnehageloven` er bokmål fordi loven fra
2005 ble det. Et avsnitt som siterer begge er riktig, ikke inkonsekvent. Det samme
gjelder TT-kort-casen, som er modellert på Vestland fylkeskommune og gjengir deres
nynorske ordlyd i `formaal` og i `vilkaar.ts`. En språkvask som gjør målformen konsistent
retter et sitat, og det har skjedd før: `Opplæringslova` ble til `opplæringsloven` i en
stavesveip uten at noe ble rødt. `pnpm test` fanger det nå.

**3. Husstilen velger, der rettskrivningen tillater begge.** Bokmål tillater både
`filen` og `fila`; repoet velger `-en` gjennomgående, slik at dokumentasjonen leses i ett
register. Et generelt råd om å «beholde den formen forfatteren allerede bruker» gir
derfor feil svar her. Valget er et husvalg og ingen påstand om hva som er korrekt norsk -
men det er tatt, og det gjelder.

## Virkeområdet

Teamets egen prosa, som skal vaskes:

- `INNLEVERING.md`
- `README.md`, linje 1 til om lag 246 - resten er base-repoets
- `docs/tiltakshjelpen.md`
- `docs/flytkart-tiltakssjekk.md`
- `docs/dokumentchat.md`

Base-repoets prosa - de øvrige filene i `docs/`, `README.md` fra § Innhold og ned, og
`apps/*/README.md` - skrives ikke om for stilens skyld. Et tillegg er greit: en rad i en
oppslagstabell, en setning som peker videre. En omskriving er det ikke.

## Slik leverer du

Rett teksten, og si så kort hva som ble endret og hvorfor. Er en setning tvetydig, foreslå
et alternativ framfor å gjette på hva den skulle bety - og les koden når meningen står og
faller på hva den faktisk gjør. Legg ikke til en påstand som ikke fantes i originalen:
i dette repoet er en påstand uten en navngitt sjekk noe som senere må tas ned igjen.
