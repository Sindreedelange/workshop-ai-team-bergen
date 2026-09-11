# Flytkartet for tiltakssjekken

Flytkartet for **«Kan du bygge uten å søke?»** ligger som et bilde i
[presentasjon/flytkart_hackathon.jpg](../presentasjon/flytkart_hackathon.jpg). Det er
**tegnet av en domeneekspert på byggesak**, ikke av oss og ikke av en modell, og det er
derfor kartet og ikke koden som er utgangspunktet her. Dette er samme kart skrevet ned: én node per punkt, med hjemmelen og kilden i samme punkt, og med en
kolonne som sier hva koden faktisk gjør. Hensikten er at både en deltaker og en
språkmodell skal kunne følge kartet uten å åpne og zoome i et bilde.

Kartet gjelder byggetiltak generelt. En garasje er ett eksempel på et tiltak, ikke
navnet på casen. Se [tiltakssjekken](tiltakshjelpen.md) for selve tjenesten.

Kartet er fagpersonens beskrivelse av hva som bør skje, ikke en spesifikasjon koden
har fulgt slavisk. Der de to er uenige, står uenigheten under
[Avvik fra kartet](#avvik-fra-kartet), og hvert avvik har et tilfelle i
`scripts/test-flytkart.ts`.

## Stammen

1. **Start.**
2. **Logg inn med BankID (Min kommune).** I sandkassen er dette ID-porten-testinnlogging
   gjennom `digdir-mock`. Tokenets `pid` må slå opp til den personen forespørselen
   gjelder, ellers svarer tjenesten 403.
3. **Velg eiendom det skal bygges på (får opp sin egen).** Steget `hent-eiendommer`
   leser `/api/matrikkel/mine-eiendommer`. Eierskapet leses om igjen i
   vurderingssteget, så en adresse som ikke er registrert på søkeren stoppes der også.
4. **Innhenter lokale planer.** Kart- og plangrunnlaget hentes etter at eiendommen og
   plasseringen er bekreftet: arealformål og reguleringsplaner fra Bergens kart,
   teiggeometri fra matrikkelmocken, hensynssoner fra planmockens KPA2018-uttrekk.
   Bare Bergen har et kommunalt oppsett; andre kommuner får uavklart plangrunnlag og
   får aldri Bergen-data som reserve.
5. **Velg hvilke tiltak som skal bygges (garasje, tilbygg osv).** Innbyggeren beskriver
   tiltaket, får et forslag til tiltakstype fra et nøkkelordsøk, og må bekrefte typen
   før spørsmålene åpnes. Bekreftelsen er et krav koden har og kartet ikke har.

Derfra deler kartet seg i fire grener, og koden har en femte for et uavklart tiltak.

## Gren 1: frittstående bygning

1. **Regler for frittstående, SAK10 § 4-1 første ledd bokstav a.**
   Kilde: <https://www.dibk.no/regelverk/sak/2/4/4-1>.
2. **Still relevante spørsmål om byggehøyde, avstand og så videre.**
3. **Vilkårene**, ordrett fra kartet. Hvert av dem har en egen sjekk i
   `evaluateFrittliggende`, og hvert av dem har et tilfelle i `scripts/test-flytkart.ts`
   som bryter nettopp det vilkåret:
   - bygningen er frittliggende;
   - bygningen plasseres på bebygd eiendom;
   - verken bruksareal eller bebygd areal er over 50 m2;
   - bygningen ikke skal brukes til beboelse;
   - mønehøyden ikke overstiger 4,0 meter;
   - gesimshøyden ikke overstiger 3,0 meter;
   - bygningen oppføres i en etasje og uten kjeller;
   - bygningen ikke plasseres nærmere enn 1,0 meter fra nabogrensen;
   - bygningen ikke plasseres nærmere enn 1,0 meter fra annen bygning på egen eiendom;
   - bygningen ikke plasseres over vann- eller avløpsledninger.
4. **Sjekk mot KPA18: bestemmelse § 31.3.** Kartets tekst er klippet av i tegningen og
   slutter midt i setningen: «31.3 Små tiltak på fradelt og bebygd boligeiendom, som
   ikke påvirker LNF-verdiene negativt, kan normalt …». Koden bruker bestemmelsen som
   et vilkår om mer enn 1 meter til nabogrensen, og bare for et frittliggende bygg.
   Merk at grensen er streng: akkurat 1 meter er nok for det nasjonale vilkåret, men
   ikke for § 31.3-vilkåret.
5. **Utfall:** «Du trenger ikke å søke, men må melde inn etter du er ferdig å bygge.
   Benytt dette skjema:
   <https://www.bergen.kommune.no/innbyggerhjelpen/planer-bygg-og-eiendom/bygging/byggesak/bygge-uten-byggesoknad#3>»
   Dette utfallet finnes nå i koden som `meldeplikt`. Vilkårene for å gi det står under
   [Fritaket med meldeplikt](#fritaket-med-meldeplikt).

## Gren 2: tilbygg

1. **Regler for tilbygg, SAK10 § 4-1 første ledd bokstav b.** Her stopper kartet: ingen
   spørsmål, ingen sjekk og ingen utfallsboks.
2. Koden går videre på egen hånd, og gir tilbygget sju sjekker: bruksareal og bebygd
   areal høyst 15 m², understøttet tilbygg, høyst to etasjer eller plan, ingen endring
   av godkjent bruk, ingen ny selvstendig boenhet, og eksisterende bebyggelse.
3. To forhold er alltid uavklarte for et tilbygg, og de er det med hensikt:
   - avstanden til nabogrensen, etter plan- og bygningsloven § 29-4 andre og tredje
     ledd. Utgangspunktet er minst halve bygningens høyde og minst 4 meter, med mindre
     planen bestemmer annet. **Garasjens 1-metersregel gjelder ikke her.**
   - ledninger og byggegrunn, etter plan- og bygningsloven § 28-1.
4. Følgen er at et tilbygg aldri kan nå «alle nasjonale vilkår oppfylt», og derfor
   heller ikke fritaket med meldeplikt. Det er riktig så lenge avstandsregelen ikke er
   lest maskinelt.

## Gren 3: gjerde

1. **Regler om inngjerding av eiendom.** Kartets lenke er klippet av i tegningen og
   peker på <https://www.dibk.no/regelverk/sak/2/4/4-1>.
2. **Kunnskapsboksen**, ordrett fra kartet: «innhegning mot veg med inntil 1,5 m høyde.
   Unntaket er knyttet til pbl. § 20-2 som fastslår søknadsplikt for innhegning mot vei.
   Innhegning som ikke er mot vei er i utgangspunktet ikke søknadspliktig etter § 20-2.
   Unntaket gjelder ikke dersom innhegningen hindrer sikten i frisiktsone mot vei. Med
   mindre innhegning menes åpne, enkle og lette konstruksjoner som flettverksgjerde og
   andre gjerder som ikke er tette. Tette, tyngre gjerder, f.eks. skjermvegg eller der
   innhegning også er støyskjerm, vil være konstruksjoner som krever tillatelse. Vær
   oppmerksom på at planbestemmelser kan ha regler om innhegning som går foran reglene
   i byggesaksforskriften § 4-1.»
3. Koden dekker dette med fire sjekker under SAK10 § 4-1 første ledd bokstav f nr. 3:
   åpen og lett innhegning, innhegning mot vei, høyde mot vei på høyst 1,5 meter, og
   fri sikt. Et tett gjerde gir uavklart og ikke avslag: «et nei er ikke et vedtak om
   avslag». Koden viser ikke til pbl. § 20-2 noe sted, og bestemmelsen finnes ikke i
   repoet.
4. **Sjekk opp reguleringsplanen: bestemmelse som sier at gjerde må søkes om.**
   Et dokumentert treff i Bergen-planen 6170063 gir et varsel om **§ 7 bokstav d**:
   «Gjerders utførelse, høyde og farge skal godkjennes av bygningsrådet. Gjerdehøyde må
   ikke overstige 0,9 m inklusive sokkel.» En oppgitt høyde over 0,9 meter navngis i
   et eget varsel. Lenken til planen er
   <https://www.arealplaner.no/bergen4601/gi>.
5. **Kartets utfall:** «Søknadspliktig tiltak grunnet reguleringsplanens bestemmelse.
   Det er ikke mulig å søke dispensasjon fra denne bestemmelsen.» Koden svarer «må
   avklares» i stedet, se [Avvik fra kartet](#avvik-fra-kartet).

## Gren 4: fasadeendring

1. **Informasjon fra DIBK om fasadeendring.**
2. **Kartets tre alternativer**, og hva koden gjør med dem:
   - *Alternativ 1:* bytte ut med lik takstein, takpapp eller takplater. Krever ikke
     søknad og regnes som vedlikehold; TEK17 gjelder ikke. Kommunale planer og
     bygningens vernestatus kan likevel begrense hva som er tillatt. Koden lar sjekken
     `fasade-karakter` bli oppfylt her, men legger til at vern og lokale
     planbestemmelser ikke er avklart.
   - *Alternativ 2:* bytte til annen takstein, takpapp eller takplater. Kan kreve
     søknad og regnes som fasadeendring etter pbl. § 20-5 første ledd bokstav f.
     Kommunen avgjør om bygningens karakter endres. Koden svarer uavklart, og sier
     uttrykkelig at et nøkkelord ikke kan avgjøre dette.
   - *Alternativ 3:* erstatte, forsterke eller endre takkonstruksjon. Krever søknad og
     regnes som vesentlig endring eller vesentlig reparasjon. Koden behandler inngrep i
     bæring eller brannsikring som brudd etter pbl. § 20-1 første ledd bokstav b, og
     utfallet blir søknadspliktig.
   - Alternativ 2 og 3 må oppfylle relevante krav i byggteknisk forskrift. TEK17 er
     ikke nevnt noe sted i koden.
3. **Utfall:** «Ut i fra informasjon fra dibk så må de vurdere selv, eller snakke med en
   rådgiver hos Plan- og bygg.» Koden svarer «må avklares», og legger et fasadespesifikt
   neste steg i `nesteSteg`: legg ved bilder og beskrivelse, og be kommunen og en
   kvalifisert fagperson avklare karakterendring, vern, bæring og brannsikring.

## Uklassifisert tiltak

Kartet har ingen slik gren. Koden har den, fordi en beskrivelse ofte ikke gir én
entydig tiltakstype: et forbehold i teksten, to typer på én gang, eller ord som
levegg, støyskjerm og mur gir tiltakstypen `ukjent`. Da svares det med én uavklart
sjekk under pbl. §§ 20-1 og 20-5 og en henvisning til kommunens byggesaksveiledning.
Ingen av garasjereglene brukes, og det er hele poenget med grenen.

## Fritaket med meldeplikt

Kartets grønne boks i gren 1 er det eneste stedet tjenesten sier at et tiltak ikke
krever søknad. Vilkårene er derfor en **hviteliste** og ikke «ingen sjekk er
uavklart»: sjekkene for kommuneplan, reguleringsplan og hensynssoner er uavklarte ved
design, fordi de navngir et forhold i stedet for å avgjøre det.

Alle leddene må holde:

- tiltakstypen er frittliggende bygning (leddet kan ikke felle et tiltak alene, siden
  kommuneplanvilkåret nedenfor bare gjelder den grenen, men hvitelisten sier det selv
  framfor å arve det);
- alle de nasjonale vilkårene er besvart og oppfylt;
- skissepunktet ligger på den kartlagte eiendommen;
- alle kartkildene svarte;
- kommuneplanbestemmelsen er kontrollert og oppfylt, altså LNF med mer enn 1 meter til
  nabogrensen etter KPA2018 § 31.3;
- ingen reguleringsplan berører eiendommen;
- ingen faresone berører eiendommen;
- kommunen har et meldeskjema.

To ting er verdt å merke seg. Fritaket kan i dag bare oppstå i LNF, fordi det er den
eneste planbestemmelsen tjenesten faktisk kontrollerer. I en byggesone står
bestemmelsene om utnyttelse og byggegrense ulest, og da er «må avklares» det sanne
svaret selv om sonen i seg selv er mindre streng. Og utfallet kan variere mellom to
ellers like kall: svarer ikke kommunens bygningskart, blir eksisterende bebyggelse
uavklart, og manglende kunnskap er aldri et fritak.

## Samsvar mellom kartet og koden

| Kartnode | I koden | Samsvar |
|---|---|---|
| Logg inn med BankID | ID-porten-token fra `digdir-mock`, `pid` må slå opp til personen | ja |
| Velg egen eiendom | `hent-eiendommer`, og eierskapet leses om igjen i vurderingssteget | ja, strengere enn kartet |
| Innhent lokale planer | seks kilder, bare Bergen har et kommunalt oppsett | ja |
| Velg tiltak | beskrivelse, forslag fra et nøkkelordsøk, og en uttrykkelig bekreftelse | ja, med et bekreftelseskrav kartet ikke har |
| Frittstående: SAK10 § 4-1 bokstav a og vilkårene | `evaluateFrittliggende`, én sjekk per vilkår | ja, vilkår for vilkår |
| Sjekk mot KPA18 § 31.3 | `kommuneplan`-sjekken og vilkåret om mer enn 1 meter | ja |
| Utfall «trenger ikke å søke, men må melde inn» | utfallet `meldeplikt` med skjemalenken | ja, bak hvitelisten over |
| Tilbygg: SAK10 § 4-1 bokstav b | sju sjekker, et avstandsforhold og et ledningsforhold | ja, og mer enn kartet, som stopper ved hjemmelen |
| Gjerde: DIBK-reglene om innhegning | fire sjekker under bokstav f nr. 3 | ja, men pbl. § 20-2 nevnes ikke i koden |
| Gjerde: plan 6170063 § 7 bokstav d, 0,9 m | et planvarsel og et eget høydevarsel | ja som varsel |
| Gjerde: «søknadspliktig, dispensasjon ikke mulig» | «må avklares», med krav om å avklare godkjennings- eller dispensasjonsløpet | nei, se avvik |
| Fasade: DIBK-alternativ 1, 2 og 3 | `fasade-karakter` og `fasade-konstruksjon` under pbl. §§ 20-5 og 20-1 | ja, men TEK17 nevnes ikke i koden |
| Fasade: «må vurdere selv, eller snakke med en rådgiver» | «må avklares» med et fasadespesifikt neste steg | ja |

## Avvik fra kartet

**Gjerdet blir «må avklares», ikke «søknadspliktig».** Kartet konkluderer med at et
treff i plan 6170063 gjør tiltaket søknadspliktig, og at det ikke er mulig å søke
dispensasjon fra bestemmelsen. Koden svarer at forholdet må avklares, og ber
innbyggeren få kommunen til å bekrefte gjeldende plan, bestemmelsens anvendelse og
riktig godkjennings- eller dispensasjonsløp. Grunnen er at et krav om kommunal
godkjenning av utførelse, høyde og farge ikke i seg selv er et avslag, og at
planbestemmelsen ikke er lest maskinelt: tjenesten vet at planen treffer, ikke hva
den sier om dette gjerdet. Valget er tatt bevisst og er pinnet i
`scripts/test-flytkart.ts`.

**pbl. § 20-2 og TEK17 er ikke i koden.** Kartet viser til begge. Sjekkene bruker
SAK10 § 4-1 og de paragrafene i plan- og bygningsloven som gjelder det enkelte
forholdet. Dette er en mangel i henvisningene, ikke i vurderingen.

**En hensynssone avgjør ikke, men den kan holde tilbake fritaket.** Regelen ellers er
at en hensynssone navngis og ikke avgjør: sonen sier at et hensyn gjelder for området,
mens om tiltaket er tillatt står i planbestemmelsene, som tjenesten ikke leser. Den
regelen står. Tilføyelsen er at en **faresone** hindrer fritaket med meldeplikt, fordi
et fritak er en påstand om at alt som gjelder er kontrollert. En støysone eller et
angitt hensyn stopper ikke fritaket; de navngis i stedet i svaret.

## Hva kjøringen viste

Alle fem tiltakstypene er kjørt mot den kjørende sandkassen for **Litle Milde 65**
(gnr. 105, bnr. 209, LNF og gul støysone H220_1) og **Kråkenestoppen 60** (gnr. 20,
bnr. 1413, byggesone, faresone H390_2 og reguleringsplan 6170063), både gjennom
`GET /api/garasje/sjekk` og gjennom en hel prosessøkt.

| Tilfelle | Utfall | Svaret innbyggeren leser |
|---|---|---|
| Litle Milde, garasje innenfor alle vilkår | `meldeplikt` | «Ja, men du må melde inn» |
| Litle Milde, samme garasje med bebygd areal over grensen | `soknadspliktig` | «Nei, du må søke» |
| Litle Milde, garasje 1 meter fra nabogrensen | `maa_avklares` | «Kontakt kommunen» |
| Litle Milde, tilbygg på 14 m² | `maa_avklares` | «Kontakt kommunen» |
| Litle Milde, lik taktekking | `maa_avklares` | «Kontakt kommunen» |
| Litle Milde, endret takkonstruksjon | `soknadspliktig` | «Nei, du må søke» |
| Litle Milde, uavklart tiltak | `maa_avklares` | «Kontakt kommunen» |
| Kråkenestoppen, stakittgjerde på 1,2 meter mot vei | `maa_avklares` | «Kontakt kommunen» |
| Kråkenestoppen, samme gjerde på 1,8 meter | `soknadspliktig` | «Nei, du må søke» |
| Kråkenestoppen, garasje innenfor alle vilkår | `maa_avklares` | «Kontakt kommunen» |

Den siste raden er hvitelisten i arbeid: den samme garasjen som gir fritak i LNF på
Litle Milde, gir «må avklares» på Kråkenestoppen, fordi reguleringsplanen 6170063
treffer eiendommen og bestemmelsene i den ikke er lest.

### Når kommunens kartlag er tregt

Bergens bygningskart svarte ikke på hvert kall under kjøringen. Målt fra en container
svarer laget nesten alltid på rundt 120 millisekunder, men det har en tung hale:
enkelte kall bruker 2,6 til 4,7 sekunder, og noen få kommer ikke fram i tide i det
hele tatt. Halen er kildens, ikke vår - metadataoppslaget mot det samme laget stanset
aldri, og et avbrutt kall er et tidsavbrudd, ikke et avslag.

Det merkes, fordi SAK10 § 4-1 bokstav a krever at eiendommen *er* bebygd, og den
opplysningen kommer fra de kartlagte bygningsflatene. Svarer ikke laget, blir
«Bebygd eiendom» uavklart, og den samme garasjen får «Kontakt kommunen» i stedet for
fritaket. Det er riktig: manglende kunnskap er aldri et oppfylt vilkår.

Tre ting gjør ventingen til å leve med:

- **Et kartoppslag prøves to ganger.** Første forsøk kuttes etter fire sekunder,
  fordi et svar som ikke er kommet da nesten alltid er halen; det andre får åtte.
  Bare tidsavbrudd gjentas - en 4xx, en 5xx eller et svar som ikke er JSON er
  kildens svar og betyr det samme som før.
- **Statuslinjen sier hva som skjer.** Etter noen sekunder står det at kart og planer
  fortsatt hentes fra kommunen, deretter at kartlaget er tregt og at det prøves en
  gang til, og til slutt at vurderingen gjøres ferdig med de kildene som svarte. Uten
  de setningene sto den første etiketten stille i opptil tolv sekunder, og det ser ut
  som en hengt side.
- **Meldingen etterpå er til å gjøre noe med.** Feilet oppslaget på tid, sier
  kildestatusen at kilden var treg og ikke utilgjengelig, og ber deg kjøre sjekken på
  nytt eller få kommunen til å bekrefte forholdet.

## Svarer den lokale modellen tydelig?

Rådet på slutten av sjekken hentes fra `POST /agent/garasje/raad`, som lar en modell
formulere et råd oppå den regelbaserte vurderingen. Kjørt med Ollama og
`mistral-small3.2:24b` svarte modellen gyldig JSON i alle sju grenene, på mellom 16 og
55 sekunder. Reasoning var slått av, fordi gatewayen ikke setter Ollamas tenkefelt -
oppgaven ber om det, men provideren kan det ikke her.

Modellen traff reglenes utfall i fem av sju grener, og modellens egne setninger ble
stående i de fem. I de to grenene der reglene sa søknadspliktig, svarte modellen «må
avklares» i stedet, altså mildere enn regelen, og klemmen erstattet rådet med fast
regelbasert tekst. Det er klemmen som gjør jobben sin: innbyggeren får det strengeste
av de to svarene, og ingen modell kan snakke et brudd på et nasjonalt vilkår ned til et
avklaringsbehov.

Modellens begrunnelser var konkrete og forankret i grunnlaget. For gjerdet på
Kråkenestoppen skrev den at planbestemmelsene i reguleringsplan 6170063 § 7 bokstav d
krever godkjenning av gjerdets utførelse, høyde og farge, og at den oppgitte høyden
overstiger plangrensen på 0,9 meter inkludert sokkel.

Kjøringen fant også en feil, og den er rettet. Klemmen som hindrer modellen fra å
gjøre utfallet mildere enn reglene leste hele svaret etter tillatende formuleringer,
og traff da reglenes egne forbehold: sjekken for hensynssoner sier ordrett at sonen
«sier at et hensyn gjelder for området, ikke om tiltaket er tillatt», og modellen
gjentok den setningen fordi prompten ber om det. Fem av sju grener fikk derfor
modellens råd byttet ut med en fast tekst. Advarselen «før du kan bygge» slo ut på
samme måte. Klemmen leser nå bare modellens egne setninger, og avviser et treff der
ordene rett foran nekter eller gjør setningen betinget. Grensen mot et mildere utfall
er uendret, og `pnpm test:tiltakshjelpen-raad` pinner begge retninger.

## Kommentarene fra gjennomgangen

Punktene er fra gjennomgangen av løsningen 10. september 2026, etterprøvd mot koden.

| # | Kommentar | Status |
|---|---|---|
| 0 | Start i chat, resonner ut tiltakstypen, umiddelbar sjekk | delvis: beskrivelse, forslag og bekreftelse finnes, men gjerdet konkluderes som «må avklares», ikke «du må søke» |
| 1 | Ikke kall den garasjesjekken | løst: «Kan du bygge uten å søke?» i tittel, dashbord og prosesskatalog |
| 2 | Slutt å nevne garasje spesifikt | løst i brukervendt tekst: de gjenstående strengene som påsto garasje for et gjerde eller en fasade er rettet |
| 3 | Bygninger, nabotomter og hensynssoner i kartet | løst, med nedtrekksmeny og tegnforklaring |
| 4 | Nærmeste punkt til nabotomter, sperre og varsel | delvis: nærmeste grense til egen teig måles og tegnes, og et punkt utenfor egen tomt sperrer. Nabopolygonene testes ikke, så «på nabotomten» er en antakelse, og manglende grensedata slipper brukeren videre |
| 5 | Fjern nord, sør, øst, vest | løst: bare en statisk nordpil igjen |
| 6 | Én side per spørsmål, ingen chatlogg videre, klyngede spørsmål, lagrede svar | løst |
| 7 | Modellen må omtale hensynssoner og LNF | løst: LNF med mer enn 1 meter til nabogrensen oppfyller § 31.3-vilkåret |
| 8 | Bekreft svar og flere spørsmål erstatter dialogboksen | løst, men byttet skjer etter agentens svar, ikke idet brukeren skriver |
| 9 | Standardteksten ikke alltid «f.eks 35 kvadratmeter» | løst: egen ledetekst per felt |
| 10 | Ja/nei-knapper eller «Jeg lurer på noe» | løst |
| 11 | Vi må gi et tydelig svar | løst: overskriften svarer «Ja, men du må melde inn», «Nei, du må søke» eller «Kontakt kommunen», med det avgjørende vilkåret navngitt, og reglenes egne neste steg vises |

## Slik etterprøver du det

Uten tjenester og uten modell:

```bash
pnpm test:flytkart        # kartet, gren for gren, og avvikene
pnpm test:tiltakshjelpen-raad    # klemmen mot et mildere utfall
pnpm test:tiltakshjelpen         # tiltakssjekken, adresser og plangrunnlag
```

Mot en kjørende sandkasse, som innbygger `person-395`:

```bash
export TOKEN=$(node scripts/token.ts --innbygger person-395)
curl -s -G http://localhost:8080/api/garasje/sjekk \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "adresse=Litle Milde 65" --data-urlencode "kommunenummer=4601" \
  --data-urlencode "gnr=105" --data-urlencode "bnr=209" \
  --data-urlencode "lat=60.2537577976675" --data-urlencode "lon=5.255241147052527" \
  --data-urlencode "tiltakstype=frittliggende" \
  --data-urlencode 'tiltak={"tiltakstype":"frittliggende","tiltaksbeskrivelse":"En dobbelgarasje","tiltakstypeBekreftet":true,"bra":49.5,"bya":45,"gesimshoyde":2.8,"monehoyde":3.9,"etasjer":1,"frittliggende":true,"beboelse":false,"kjeller":false,"avstandNabogrense":2,"avstandBygning":2,"overVannAvlop":false}'
```
