---
name: ksd-designsystem
description: Bruk KS Digital sitt designsystem når du skriver frontend, HTML, CSS eller GUI i dette repoet - enten du utvider demo-gui/process-builder eller lager en ny frontend. Dekker oppsett, kaskaderegler og hvor komponentene er dokumentert. Bruk også når noen spør om styling, komponenter, ds-klasser, tokens, temaer, lys/mørk-modus eller universell utforming.
---

# KS Digital designsystem

Komponenter, API og tilgjengelighet er dokumentert hos Digdir:
**<https://designsystemet.no/no>**. Slå opp der.

**Forventningen er at frontend bygges i et eget prosjekt utenfor dette repoet**, mot
sandkassens API-er (`docs/bygg-selv.md`). Der installeres designsystemet fra npm
(`@ks-digital/designsystem-themes`), og «Aldri»-punkt 1–3 under gjelder ikke - de er
regler for *dette* repoet. Bygger du likevel her inne, gjelder alt.

`docs/designsystem.md` dekker begge oppsettene, kaskadefella og fallgruvene. Les den før
du skriver mer enn noen få linjer frontend.
Kjørende markup for hver komponent: `apps/demo-gui/src/ds-eksempel.html`, servert på
<http://localhost:3001/ds-eksempel>, serialisert fra DOM-en og derfor aldri utdatert.

## Oppsett

Fire stilark og ett attributt på `<html>`:

```html
<html lang="nb" data-color-scheme="auto">
  <head>
    <link rel="stylesheet" href="https://static.fiks.ks.no/googlefonts/googleapis/css2?family=Inter:wght@400;500;600;700&display=swap" />
    <link rel="stylesheet" href="/assets/ds-base.css" />
    <link rel="stylesheet" href="/assets/ds-ksdigital.css" />
    <link rel="stylesheet" href="/assets/ds-morketema.css" />
  </head>
```

De to første er vendoret uendret fra temapakken. `ds-morketema.css` er vår egen og retter
fargene temaet regner feil i mørk modus.

API-et er klasser og attributter på vanlig HTML:
`<button class="ds-button" data-variant="secondary">`. `data-size` og `data-color` arves
nedover i treet; `data-variant` gjør ikke.

## Fargemodus

- `data-color-scheme` har tre verdier: `light`, `dark` og `auto`. `light` ligger på
  `:root`, så det er standard uten attributtet, og **`auto` er den eneste som følger
  systeminnstillingen**. Bruk `auto` som utgangspunkt.
- Lagres et valg, må det legges på `<html>` av et blokkerende skript i `<head>`, ellers
  tegnes siden i feil tema først. Mønsteret står i `docs/designsystem.md`.
- **`data-color-scheme` nullstiller `data-color`.** Begge hører på samme element, ellers
  faller fargen tilbake til `accent`.
- Primærknappen er blå i mørk modus fordi `ds-morketema.css` retter den. Uten den rettingen
  snur temaet KS-marineblå til grått. Trenger du en annen farge, bruk en familie som
  finnes - `support1`, `info`, `danger` - ikke en egen hex. `brand1`, `brand2` og `brand3`
  finnes hos Digdir, men ikke i KS-temaet.
- Fargene, kontrastkravene og hvorfor `warning` og `support2` ikke skal brukes på knapper
  i mørk modus: `docs/designsystem.md`, seksjonen «Fargemodus».

## Aldri

1. **Aldri last `/assets/felles.css` sammen med ds-CSS.** `felles.css` har ingen `@layer`,
   og ulagede regler slår alle lag. Verifisert effekt: Inter forsvinner og alle
   knappevarianter blir samme blå. Skal du overstyre designsystemet, deklarer
   `@layer side;` (det havner etter `ksd`) og skriv reglene der.
2. **Aldri legg designsystemet inn i `felles.css` eller i eksisterende sider.** Ny
   frontend = ny fil. De eksisterende sidene er referanse for andre team.
3. **Aldri npm-avhengigheter eller byggesteg i dette repoet.** Designsystemet passer
   nettopp fordi temapakken er ren CSS.
4. **Aldri finn opp klassenavn.** Sannheten er
   `grep -o '\.ds-[a-z-]*' apps/shared/ds-base.css | sort -u`.
5. **Aldri egne hex-farger eller px-avstander.** Bruk `--ds-*`-tokens, ellers brekker
   mørk modus. Det ene unntaket er `apps/shared/ds-morketema.css`, og hver verdi der er
   begrunnet med et målt kontrastforhold.
6. **Aldri rediger `apps/shared/ds-base.css` eller `ds-ksdigital.css`.** De er hentet
   uendret fra pakken og overskrives av `pnpm ds:hent`. Skal en farge rettes, hører den i
   `ds-morketema.css`.

## Husk

- Språkregelen i `AGENTS.md` (`## Language`) gjelder fortsatt: engelsk for teknikk,
  norsk for fagspråk, **wire-formatet er frosset**, og prosa skrives på norsk med
  ordentlige tegn. Hvilke felter som er frosne står der, ikke her.
- Sperrer, samtykke og skjerming håndheves i backend. Frontenden viser tilstanden, den
  lager den ikke.
- Bygg DOM med `createElement` + `textContent`, aldri `innerHTML`.
- `<html lang="nb">`, `aria-live` på svar som strømmer inn, `aria-invalid` på felt med
  feil. Designsystemet gir tilgjengelige komponenter, ikke tilgjengelig struktur.
- Kontrast: 4,5:1 for tekst, 3:1 for kanten på en komponent og for fokusringen. Aldri farge
  som eneste bærer av mening - en solknapp som veksler tema er ikke nok.
