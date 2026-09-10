# KS Digital designsystem i denne sandkassen

> [!NOTE]
> **For deg som bygger frontend.** Trenger du ikke det, kan du hoppe over hele filen.

**Vi forventer at du bygger frontenden din i ditt eget prosjekt, utenfor dette repoet.**
Sandkassen er API-ene du kaller - den er ikke ment som app-rammeverket ditt. Alle
tjenestene svarer med `Access-Control-Allow-Origin: *`, så en app på din egen port snakker
rett med dem. Oppskriften står i [`docs/bygg-selv.md`](bygg-selv.md).

Ingen hindrer deg i å utvide `demo-gui` i stedet, og noen ganger er det raskeste vei til en
demo. Da gjelder ekstra regler - de står under.

Komponentene, API-et deres og tilgjengelighetskravene er dokumentert hos Digdir. Denne
filen dekker bare oppsettet og det som er særegent her.

KS Digital sitt designsystem bygger på [Designsystemet fra Digdir](https://designsystemet.no/no).
Prefikset forteller hvem som eier hva: `ds-` er Digdir sine komponenter (nesten alt), `ksd-`
er KS Digital sine egne tillegg.

To ressurser virker uten at du kjører noe som helst - begge viser komponentene med
KS Digital-temaet ferdig på:
[Storybook](https://design.ksdigital.no) i nettleseren, og
[Figma-biblioteket](https://www.figma.com/design/SjSyWDPc4uAHufxmzdH8Fz/Designsystemet-%7C-KS-Digital-Core-UI-Kit)
for design og skisser.

---

## Innhold

- [Oppsett i ditt eget prosjekt](#oppsett-i-ditt-eget-prosjekt)
- [Oppsett inne i sandkassen](#oppsett-inne-i-sandkassen)
- [Fargemodus: lys, mørk og auto](#fargemodus-lys-mørk-og-auto)
- [Hvor du slår opp](#hvor-du-slår-opp)
- [Fallgruver](#fallgruver)
- [Regler](#regler)
- [Kommunevåpen](#kommunevåpen)
- [Neste steg](#neste-steg)

## Oppsett i ditt eget prosjekt

Dette er den forventede veien. Pakkene ligger på npm:

```bash
pnpm add @ks-digital/designsystem-themes
```

```js
import '@ks-digital/designsystem-themes/base.css'
import '@ks-digital/designsystem-themes/ksdigital.css'
```

Har du React, finnes komponentene også ferdig innpakket
(`@ks-digital/designsystem-react`). Angular-pakken finnes, men er uttalt WIP.

Pin versjonen. Pakkene er `0.0.1-alpha.*`, altså før 1.0, og klassenavn kan fortsatt flytte
seg - en flytende versjon betyr at en oppdatering hos KS Digital kan brekke frontenden din
midt i hackathonet.

Attributt-API-et er det samme uansett variant: `data-size`, `data-color` og `data-variant`
sendes rett gjennom i React også. Alt på <https://designsystemet.no/no> gjelder derfor for
deg.

Setter du opp Tailwind ved siden av, må lagrekkefølgen deklareres først:

```css
@layer theme, base, utilities, ds, ksd;
```

---

## Oppsett inne i sandkassen

Utvider du `demo-gui` eller prosessbyggeren, er CSS-en allerede vendoret i
`apps/shared/` og servert på `/assets/`. Fire stilark og ett attributt på `<html>` -
ingen npm, ingen bundler, ingen byggesteg:

```html
<html lang="nb" data-color-scheme="auto">
  <head>
    <link rel="stylesheet" href="https://static.fiks.ks.no/googlefonts/googleapis/css2?family=Inter:wght@400;500;600;700&display=swap" />
    <link rel="stylesheet" href="/assets/ds-base.css" />
    <link rel="stylesheet" href="/assets/ds-ksdigital.css" />
    <link rel="stylesheet" href="/assets/ds-morketema.css" />
  </head>
```

`ds-base.css` og `ds-ksdigital.css` er hentet uendret fra temapakken. `ds-morketema.css`
er vår egen, og retter fargene temaet regner feil i mørk modus - hvorfor står under.

Oppdatere de to vendorede filene: `pnpm ds:hent`. Versjon og tema er pinnet i
`scripts/hent-designsystem.ts`.

### Én hard regel her inne

**Last aldri `/assets/felles.css` og designsystemets CSS på samme side.**

`felles.css` er sandkassens eget stilark og har ingen `@layer`. Ulagede CSS-regler slår
*alle* lag i kaskaden - også `@layer ds` og `@layer ksd`. Effekten er verifisert: Inter
forsvinner, bakgrunnen blir sandkassens blågrå, og primær-, sekundær-, tertiær- og
danger-knapper blir alle den samme blå. Det ser ut som CSS-en ikke lastet. Den lastet - den
ble overstyrt.

Bygger du en ny side her inne: velg én av dem. Vil du overstyre designsystemet med vilje,
deklarer et lag etter `ksd`:

```css
@layer side;             /* ds og ksd er alt deklarert, side havner etter */
@layer side {
  .min-boks { padding: var(--ds-size-6); }
}
```

Da trenger du verken `!important` eller spesifisitetstriks.

---

## Fargemodus: lys, mørk og auto

`data-color-scheme` styrer alt, og har tre verdier:

| Verdi | Hva den gjør |
| --- | --- |
| `light` | Lyst tema. Ligger på `:root` i temaet, så dette er det du får uten attributtet. |
| `dark` | Mørkt tema. Må settes eksplisitt. |
| `auto` | Følger systeminnstillingen til brukeren. **Den eneste verdien som gjør det.** |

Temaet leser `prefers-color-scheme` bare inne i `auto`. Har du ikke satt attributtet, blir
siden lys uansett hva maskinen til brukeren står på.

Sett det på `<html>`. Digdir tillater det på et undertre også - deres eget eksempel er en
mørk bunn på en lys side - men et lagret valg må ligge på rot-elementet før første
opptegning, og det er lettere å holde ett sted.

### Mønsteret: auto som standard, med et valg som huskes

Tre deler. Attributtet står på `auto` i markupen, et lite skript i `<head>` legger på et
lagret valg *før* siden tegnes, og kontrollen skriver valget ned. Uten skriptet i `<head>`
tegnes siden i `auto` først og males om et øyeblikk etter - blinket alle ser.

```html
<html lang="nb" data-color-scheme="auto">
  <head>
    <!-- Blokkerende med vilje: dette må skje før første opptegning. -->
    <script>
      try {
        var valgt = localStorage.getItem("ksd-fargemodus");
        if (valgt === "light" || valgt === "dark" || valgt === "auto") {
          document.documentElement.setAttribute("data-color-scheme", valgt);
        }
      } catch (e) {
        /* Privat vindu: da står `auto` fra markupen. */
      }
    </script>
```

```ts
const velger = document.getElementById("mode") as HTMLSelectElement;

// Hold kontrollen i takt med det <head>-skriptet alt har bestemt.
velger.value = document.documentElement.getAttribute("data-color-scheme") ?? "auto";

velger.onchange = () => {
  document.documentElement.setAttribute("data-color-scheme", velger.value);
  try {
    localStorage.setItem("ksd-fargemodus", velger.value);
  } catch {
    // Valget gjelder for denne siden, det blir bare ikke husket.
  }
};
```

Bruk en synlig, navngitt kontroll med tre valg, ikke et ikon som veksler. Et ikon som bare
er en sol eller en måne bærer meningen i form og farge alene, og «auto» har ingen tredje
tilstand å vise. Kjørende utgave: <http://localhost:3001/ds-eksempel>.

Native `color-scheme` settes av temaet selv i hver modus, så nedtrekk, avkrysningsbokser og
rullefelt i nettleseren følger med uten at du gjør noe.

### Tokens, i to lag

Farger finnes i to nivåer, og du trenger å kjenne begge for å skjønne hvorfor en knapp ser
ut som den gjør:

1. **Per familie** - `--ds-color-accent-base-default`, `--ds-color-danger-surface-hover`
   og så videre. Åtte familier i KS-temaet: `accent`, `neutral`, `support1`, `support2`,
   `success`, `danger`, `warning`, `info`. Merk at temaet **ikke** har `brand1`, `brand2`
   eller `brand3`; kopierer du et Digdir-eksempel med `data-color="brand1"`, skjer det
   ingenting.
2. **Aliaser uten familienavn** - `--ds-color-base-default`, `--ds-color-surface-hover`,
   `--ds-color-text-subtle`. Det er disse komponentene faktisk leser, og `data-color`
   bytter hvilken familie de peker på.

Rollenavnene er de samme i hver familie: `background-*`, `surface-*`, `border-*`, `text-*`,
`icon-*`, `base-*` og `base-contrast-*`. Det siste heter `base-contrast-default` og
`base-contrast-subtle` - `contrast-default` alene finnes ikke. Hele listen:

```bash
grep -o '\-\-ds-color-[a-z0-9-]*' apps/shared/ds-ksdigital.css | sort -u
```

En knapp leser bare aliasene. `.ds-button` uten `data-variant` er primærknappen og tar
`--ds-color-base-default` som bakgrunn og `--ds-color-base-contrast-default` som tekst;
`secondary` og `tertiary` er gjennomsiktige og tar `--ds-color-text-subtle` og
`--ds-color-surface-hover`.

### Hva mørk modus gjør galt, og hva vi har rettet

Temaet regner ut mørke farger ved å snu lysheten. Det er riktig for flater og feil for de
solide `base-*`-rampene, så tre familier kom ut på et sted de ikke kan brukes. Målt mot den
mørke sidebakgrunnen `#14181c`:

| Familie | Temaet gir | Problemet | `ds-morketema.css` gir |
| --- | --- | --- | --- |
| `accent` | `#a9aab8` | KS-marineblå snur til grått, og lander 1,00:1 fra `neutral` (`#a8abae`) - samme knapp to ganger | `#6f9dff` (7,94:1 mot teksten, 6,75:1 mot bakgrunnen) |
| `warning` | `#60400b` | 1,90:1 mot bakgrunnen. WCAG 1.4.11 krever 3:1 for kanten på en komponent | `#e0a52a` (9,58:1 og 8,14:1) |
| `support2` | `#000000` | 1,18:1. En svart knapp på en nesten svart side | `#d8d8d8` (14,73:1 og 12,52:1) |

Rettingen ligger i `apps/shared/ds-morketema.css`, i `@layer side`, og overstyrer
familie-tokenene og ikke komponent-tokenene - da følger alt som leser familien med, ikke
bare knappen. `neutral` er med vilje latt være grå: primærknappen er nå blå mot en grå
nøytral, og da leses rangeringen mellom dem igjen.

Tekstkontrasten i mørk modus var aldri problemet - den ligger mellom 4,86:1 og 9,39:1 på
alle knappevarianter. Det som manglet var farge og kant.

To ting temaet gjør riktig, og som du ikke skal røre:

- **Fokusringen er tofarget** (`--ds-color-focus-inner` og `--ds-color-focus-outer`, 15,11:1
  fra hverandre). Derfor er den synlig både på den mørke siden og på en lys knapp -
  `focus-outer` alene mot den grå primærknappen er 1,95:1. Overstyrer du én halvdel,
  ryker den.
- **Bakgrunnen er `#14181c` og teksten `#ececed`**, ikke svart og hvitt. Det er praksisen
  for mørke tema, ikke en unøyaktighet.

Skal du løfte noe fra bakgrunnen i mørk modus, gå fra `surface-default` til
`surface-tinted` til `surface-hover`. Ikke legg på en skygge: en skygge mot en nesten svart
flate er usynlig.

### Fellen som tar alle

**`data-color-scheme` nullstiller `data-color`.** Digdir dokumenterer det: aliasene bindes
av en regel som blant annet treffer `[data-color-scheme]`, så et element med det attributtet
setter alle aliasene tilbake til `accent` - og vasker bort en `data-color` det arvet.

```html
<!-- Feil: knappen blir accent, ikke danger. -->
<div data-color="danger">
  <section data-color-scheme="dark">
    <button class="ds-button">Trekk samtykke</button>
  </section>
</div>

<!-- Riktig: begge attributtene på samme element. -->
<section data-color-scheme="dark" data-color="danger">
  <button class="ds-button">Trekk samtykke</button>
</section>
```

### Sjekk tallene selv

Et påstått kontrastforhold er lett å regne ut, og da slipper du å diskutere det:

```bash
node -e '
const L=h=>{const c=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(v=>v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2]};
const R=(a,b)=>((Math.max(L(a),L(b))+.05)/(Math.min(L(a),L(b))+.05)).toFixed(2);
console.log(R("#6f9dff","#14181c"));
'
```

Kravene: 4,5:1 for vanlig tekst (WCAG 1.4.3), 3:1 for stor tekst og for kanten på en
komponent eller en fokusring (1.4.11). Offentlig sektor er bundet til WCAG 2.1 på nivå A og
AA gjennom forskrift om universell utforming av IKT.

Digdir har ikke publisert egen veiledning for design i mørk modus - bare mekanismen. Vil du
lese om avveiningene, har NAV en god gjennomgang:
<https://aksel.nav.no/god-praksis/artikler/design-i-dark-mode-og-light-mode>. Merk at Aksel
bruker `.dark` og `.light` som klasser, altså et annet API enn dette.

---

## Hvor du slår opp

| Hva | Hvor |
| --- | --- |
| Komponenter, API og tilgjengelighet - **primærkilden** | <https://designsystemet.no/no> |
| Kjørende markup for hver komponent, lest ut av DOM-en | <http://localhost:3001/ds-eksempel> |
| Storybook og Figma - begge virker uten å kjøre noe | lenkene øverst i denne filen |
| Kildekode | <https://github.com/ks-no/designsystem> |
| Spørsmål | `fiks@ksdigital.no`, eller Slack `#designsystem` |

Kodeeksemplene på `/ds-eksempel` serialiseres fra den levende DOM-en, så de kan ikke bli
utdaterte. Kopier derfra - markupen er den samme i ditt eget prosjekt.

---

## Fallgruver

Disse gjelder uansett hvor du bygger.

- **`data-size` arves.** `data-size="lg"` på en wrapper gjør *hele undertreet* større, ikke
  én knapp. Skal én komponent skille seg ut, sett attributtet på komponenten.
- **Egne hex-farger brekker mørk modus.** Temaet bytter tokens når `data-color-scheme`
  endres; en hardkodet `#1459c7` gjør det ikke. Bruk `--ds-*`-tokens.
- **`auto` er ikke standard.** Uten attributtet er siden lys, uansett hva maskinen til
  brukeren står på. Se [Fargemodus](#fargemodus-lys-mørk-og-auto).
- **`data-color-scheme` nullstiller `data-color`.** Begge må stå på samme element, ellers
  faller fargen tilbake til `accent`.
- **`ds-spinner` er en SVG med to sirkler**, ikke et tomt element. Et
  `<span class="ds-spinner">` viser ingenting.
- **Noen komponenter leser innholdet sitt fra et attributt, ikke fra tekstnoden.** CSS-en
  setter `content: attr(...)` på et `::before`. Skriver du verdien som tekst, får du en tom
  boble *og* teksten ved siden av: `ds-badge` vil ha `data-count`, `ds-avatar`
  `data-initials`, og `ds-skeleton` med `data-variant="text"` vil ha `data-text`.
- **`data-color="accent"` gjør ingenting.** `accent` er standardfargen i temaet, så
  attributtet ser ødelagt ut. Bruk `support1`, `neutral` eller en av de semantiske hvis du
  vil se en forskjell. `brand1`, `brand2` og `brand3` gjør heller ingenting - de finnes hos
  Digdir, men ikke i KS-temaet.

---

## Regler

Gjelder uansett hvor frontenden din bor:

- **Ikke finn opp klassenavn.** Sannheten er
  `grep -o '\.ds-[a-z-]*' apps/shared/ds-base.css | sort -u`.
- **Ingen egne farge-, avstands- eller radiusverdier.** Bruk `--ds-*`-tokens. Det ene
  unntaket i repoet er `apps/shared/ds-morketema.css`, som retter tre token-verdier temaet
  regner feil i mørk modus, og som begrunner hver av dem med et målt kontrastforhold.
- **Wire-formatet er frosset.** JSON-nøklene beholder navnene sine uansett hvor pen
  frontenden blir. Feltnavnene står i `openapi/*.yaml`.
- **Sperrer, samtykke og skjerming håndheves i backend.** Frontenden viser tilstanden, den
  lager den ikke. Ikke omgå samtykkeporten i UI-et.
- **Universell utforming er ikke gratis.** Designsystemet gir tilgjengelige *komponenter*;
  strukturen er ditt ansvar: `<html lang="nb">`, riktig overskriftsnivå, `aria-live` på svar
  som strømmer inn, `aria-invalid` på felt med feil, `alt` på bilder, og aldri farge som
  eneste bærer av mening (WCAG 1.4.1). Kontrastkravene er 4,5:1 for tekst (1.4.3) og 3:1
  for kanten på en komponent og for fokusringen (1.4.11). Nivået offentlig sektor er bundet
  til er WCAG 2.1 A og AA.

Gjelder bare hvis du likevel bygger inne i dette repoet:

- **Ingen npm-avhengigheter her og ingen byggesteg.** Repoet legger ikke til avhengigheter, og
  skal beholde det - derfor er den vendorede CSS-en eneste vei her inne.
- **Ny frontend = ny fil.** `demo-gui` og `process-builder` er referanseimplementasjoner
  andre team leser; de skal fortsatt virke.
- **Aldri rediger `apps/shared/ds-base.css` eller `ds-ksdigital.css`.** De er hentet
  uendret fra temapakken, og `pnpm ds:hent` overskriver endringene dine. Skal en farge
  rettes, hører den i `ds-morketema.css`, som er vår egen og som `pnpm ds:hent` ikke rører.
- **Språkregelen i [`AGENTS.md`](../AGENTS.md) (`## Language`) gjelder her også.** Den
  er ikke gjengitt her; klassenavn er teknikk og dermed engelske, og resten står der.
- **Bygg DOM med `createElement` og `textContent`, ikke `innerHTML`.** Det er konvensjonen
  i resten av sandkassen, og innholdet kommer fra API-svar.

---

## Kommunevåpen

```html
<img src="https://static.fiks.ks.no/img/kommunevaapen/4601.png" alt="Bergen kommunes våpen" />
```

Filnavnet er kommunenummeret.

---

## Neste steg

**Skal du koble frontenden på API-ene?** [`docs/bygg-selv.md`](bygg-selv.md) har token,
CORS og hva som er frosset.

**Tilbake til kartet:** [`docs/README.md`](README.md).
