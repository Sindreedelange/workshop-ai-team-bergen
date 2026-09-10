/*
 * Hvilke oppgaver som er verdt en reasoning-modell, og hvilke modeller som kan.
 *
 * Reasoning er en egenskap ved oppgaven, ikke en innstilling for tjenesten. Det er
 * målt og ikke antatt: på den tunge garasjevurderingen var reasoning-svaret det ene
 * som rekkefølget tiltakene og fanget servitutter, mens `oppsummering` ble
 * dårligere - modellen skrev om teksten den skulle gjengi - og `tolk-svar` fikk
 * samme treff til opptil 12 ganger latensen. En global innstilling ville derfor
 * gjort de fleste kallene dårligere for å hjelpe ett.
 *
 * Modulen ligger her og ikke i `server.ts` av samme grunn som `sporsmaalsperrer.ts`
 * og `garasje-raad.ts` gjør: `server.ts` kaller `server.listen` på toppnivå og kan
 * ikke importeres av en test. Den har ingen avhengigheter, så `pnpm test:reasoning`
 * kjører uten modell og uten tjenester.
 *
 * Å legge til en tung oppgave er én linje i `REASONING_OPPGAVER`. Å la den stå
 * utenfor begge tabellene er også et valg, men et som ingen har tatt: da er den
 * ukjent, og `pnpm test:reasoning` sier hvilken det gjelder.
 */

/** Oppgaver som ber om reasoning, med målingen som er grunnen. */
export const REASONING_OPPGAVER: Record<string, string> = {
  "garasje-raad":
    "Måler hele grunnlaget mot plangrunnlaget og gir et råd. Reasoning-svaret var det ene som rekkefølget tiltakene og fanget forhold som ikke sto i grunnlaget."
};

/**
 * Oppgaver som med vilje ikke ber om reasoning, med målingen som er grunnen.
 *
 * Tabellen finnes for at et «av» skal være et valg noen har tatt og begrunnet,
 * ikke en oppgave noen glemte. En oppgave som mangler i begge er en oppgave
 * ingen har vurdert.
 */
export const IKKE_REASONING_OPPGAVER: Record<string, string> = {
  oppsummering:
    "Skal gjengi tall og utfall uendret. Med reasoning skrev Nemotron «innvilgt» der utfallet var «innvilget», og GLM la på overskrifter.",
  "tolk-svar":
    "Samme treffsikkerhet med og uten, men opptil 12 ganger latensen. Oppgaven står midt i en dialog der noen venter.",
  "velg-prosess": "Kort valg fra en hviteliste. Heuristikken tar de fleste, og modellen trenger ikke tenke på resten.",
  "velg-verktoy": "Samme som velg-prosess: et valg fra en hviteliste, ikke en syntese.",
  sporsmaal:
    "Innbyggeren venter på svar mens flyten står stille, og svaret skal komme fra grunnlaget i stedet for fra en utledning.",
  dommer:
    "Utviklerverktøy for evalene. Reasoning ga samme score på de fire prøvesakene, og en dommer som er tre ganger tregere gjør et helt datasett tregere.",
  dialogforslag: "Kort formulering, ingen syntese.",
  "forklar-databruk": "Kort formulering av noe som allerede står i katalogen.",
  klarsprak: "Skriver om en tekst som allerede finnes.",
  risikosjekk: "Kort formulering, og ingen avgjørelse ligger hos modellen."
};

/** Om oppgaven ber om reasoning. En ukjent oppgave gjør det ikke. */
export function reasoningForOppgave(task?: string | null): boolean {
  return Boolean(task) && Object.hasOwn(REASONING_OPPGAVER, String(task));
}

/** Oppgaver ingen har vurdert. `pnpm test:reasoning` bruker denne. */
export function uvurderteOppgaver(alleOppgaver: readonly string[]): string[] {
  return alleOppgaver.filter(oppgave =>
    !Object.hasOwn(REASONING_OPPGAVER, oppgave) && !Object.hasOwn(IKKE_REASONING_OPPGAVER, oppgave));
}

/**
 * Hvilke providere som faktisk kan tenke.
 *
 * `false` her betyr ikke at modellen bak provideren ikke kan tenke - det betyr at
 * *denne* gatewayen ikke har en målt måte å be om det på. En reasoning-oppgave kjører
 * da uten tenking, og svaret sier `tenkte: false` i stedet for å late som. Å påstå
 * støtte vi ikke har prøvd er verre enn å mangle den: da ser en oppgave ut som den
 * tenker uten å gjøre det.
 */
export const REASONING_PROVIDERE: Record<string, { stotter: boolean; grunn: string }> = {
  mock: { stotter: false, grunn: "Maltekst, ingen modell." },
  ollama: {
    stotter: false,
    grunn: "Ollama har et `think`-felt, men standardmodellen qwen2.5:7b har ingen tenkemodus, og feltet er ikke prøvd her."
  },
  openrouter: {
    stotter: false,
    grunn: "OpenRouter har et `reasoning`-felt. Det er ikke prøvd mot denne sandkassen, så støtten er ikke målt."
  },
  "telenor-ai-factory": {
    stotter: true,
    grunn: "Målt: `chat_template_kwargs.enable_thinking` styrer tenkingen, og tenkedelen kommer tilbake i `reasoning_content`."
  },
  bedrock: {
    stotter: false,
    grunn: "Claude har extended thinking, men kallet her setter ingen `thinking`-blokk, og støtten er ikke målt mot en konto."
  }
};

export function providerKanReasoning(provider: string): boolean {
  return REASONING_PROVIDERE[provider]?.stotter === true;
}

/**
 * `reasoning` er om modellen kan tenke. `reasoningAnbefalt` er om den er den målt
 * beste til det, og de to er ikke det samme: GLM-5.2 kan tenke og er likevel gal
 * som standard, fordi den ble kuttet av taket på en full garasjevurdering i tre av
 * tre forsøk. «Den første som kan» er derfor feil regel - rekkefølgen i listen
 * styres av hvilken modell som er standard ellers.
 */
export type Reasoningmodell = { id: string; reasoning?: boolean; reasoningAnbefalt?: boolean };

/**
 * Modellen en reasoning-oppgave skal kjøre på.
 *
 * Den er skilt fra modellvalget ellers fordi hvilken modell som rekker gjennom en
 * tung oppgave er målt: GLM-5.2 med reasoning ble kuttet av taket i tre av tre
 * forsøk på en full garasjevurdering, mens Nemotron svarte på 8,4 sekunder. En
 * ønsket modell uten tenkemodus - Qwen3-Coder-Next har ingen - kan ikke stå her, og
 * blir byttet ut med en advarsel i stedet for å svare uten å tenke.
 */
export function velgReasoningModell(
  modeller: readonly Reasoningmodell[],
  oensket?: string | null
): { modell: string | null; advarsel?: string } {
  const kandidater = modeller.filter(modell => modell.reasoning === true);
  if (kandidater.length === 0) {
    return { modell: null, advarsel: "Ingen av de tilgjengelige modellene har en tenkemodus." };
  }
  const standard = kandidater.find(modell => modell.reasoningAnbefalt === true) ?? kandidater[0];
  if (!oensket) {
    return { modell: standard.id };
  }
  // Et uttrykt ønske om en modell som kan tenke respekteres, også når en annen er
  // anbefalt: den som setter variabelen vet noe om oppgaven vi ikke vet.
  if (kandidater.some(modell => modell.id === oensket)) {
    return { modell: oensket };
  }
  const kjent = modeller.some(modell => modell.id === oensket);
  return {
    modell: standard.id,
    advarsel: kjent
      ? `${oensket} har ingen tenkemodus. Reasoning-oppgaver bruker ${standard.id} i stedet.`
      : `${oensket} er ikke en kjent modell. Reasoning-oppgaver bruker ${standard.id} i stedet.`
  };
}
