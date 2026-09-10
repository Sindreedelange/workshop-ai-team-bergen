type MeasureOption<T extends string> = { id: T; label: string };
type Options<T extends string> = {
  choices: readonly MeasureOption<T>[];
  unknownType: T;
  suggest: (description: string) => T | null;
  locked: () => boolean;
  changed: () => void;
  confirmed: (type: T, description: string) => void;
};

export function createTiltaksvalg<T extends string>(options: Options<T>) {
  const panel = document.createElement("section");
  panel.className = "panel stack";
  panel.id = "measure-step";
  panel.setAttribute("aria-labelledby", "measure-heading");
  const heading = document.createElement("h2");
  heading.id = "measure-heading";
  heading.className = "ds-heading";
  heading.dataset.size = "md";
  heading.textContent = "Hva vil du gjøre på eiendommen?";
  const field = document.createElement("div");
  field.className = "ds-field";
  const label = document.createElement("label");
  label.className = "ds-label";
  label.htmlFor = "measure-description";
  label.textContent = "Beskriv tiltaket";
  const description = document.createElement("textarea");
  description.className = "ds-input";
  description.id = "measure-description";
  description.rows = 3;
  description.required = true;
  description.maxLength = 500;
  description.setAttribute("aria-describedby", "measure-status");
  description.placeholder = "For eksempel: Jeg vil sette opp et stakittgjerde mot veien.";
  field.append(label, description);
  const propose = document.createElement("button");
  propose.className = "ds-button";
  propose.type = "button";
  propose.textContent = "Finn type tiltak";
  const choices = document.createElement("div");
  choices.className = "ds-field";
  const choiceLabel = document.createElement("label");
  choiceLabel.className = "ds-label";
  choiceLabel.htmlFor = "measure-type";
  choiceLabel.textContent = "Kontroller tiltakstypen";
  const select = document.createElement("select");
  select.className = "ds-input";
  select.id = "measure-type";
  for (const choice of options.choices) {
    const option = document.createElement("option");
    option.value = choice.id;
    option.textContent = choice.label;
    select.append(option);
  }
  choices.append(choiceLabel, select);
  const status = document.createElement("p");
  status.className = "ds-paragraph";
  status.id = "measure-status";
  status.setAttribute("role", "status");
  status.textContent = "Beskriv tiltaket kort. Du kan få et forslag til type eller velge typen selv. Forslaget er ikke en vurdering av søknadsplikt.";
  const confirm = document.createElement("button");
  confirm.className = "ds-button";
  confirm.type = "button";
  confirm.textContent = "Bekreft tiltakstype";
  panel.append(heading, field, propose, choices, status, confirm);
  const before = document.getElementById("login-panel");
  if (!before?.parentElement) throw new Error("Tiltaksvalget mangler et sted på siden.");
  before.parentElement.insertBefore(panel, before);
  function validDescription(focus = true): boolean {
    const text = description.value.trim();
    const valid = text.length > 0 && text.length <= 500;
    description.setAttribute("aria-invalid", String(!valid));
    if (!valid) {
      status.textContent = text.length === 0
        ? "Skriv en kort beskrivelse av tiltaket før du bekrefter typen."
        : "Beskrivelsen kan ha maksimalt 500 tegn.";
      if (focus) description.focus();
    }
    return valid;
  }
  const invalidate = () => {
    if (options.locked()) return;
    options.changed();
    confirm.textContent = "Bekreft tiltakstype";
    status.textContent = "Tiltaket er endret. Bekreft typen før du fortsetter.";
  };
  description.addEventListener("input", invalidate);
  select.addEventListener("change", invalidate);
  propose.addEventListener("click", () => {
    if (options.locked()) return;
    options.changed();
    if (!validDescription()) return;
    const text = description.value.trim();
    const suggested = options.suggest(text);
    select.value = suggested ?? options.unknownType;
    status.textContent = suggested
      ? `Forslag: ${options.choices.find(choice => choice.id === suggested)!.label}. Kontroller typen og bekreft.`
      : "Beskrivelsen er uklar eller inneholder flere tiltak. Velg én type som passer, eller «Annet eller usikkert» for veiledning.";
  });
  confirm.addEventListener("click", () => {
    if (options.locked()) return;
    const selected = options.choices.find(choice => choice.id === select.value);
    if (!validDescription()) return;
    if (!selected) {
      status.textContent = "Velg en kjent tiltakstype før du bekrefter.";
      return;
    }
    options.confirmed(selected.id, description.value.trim());
    confirm.textContent = "Tiltakstype bekreftet";
    status.textContent = selected.id === options.unknownType
      ? "Tiltakstypen er uavklart. Vi viser eiendommens planforhold og hva du bør ta opp med kommunens byggesaksveiledning, ikke en automatisk tillatelse."
      : `${selected.label} er valgt. Vi bruker spørsmål og nasjonale regler for denne typen, og kontrollerer lokale planforhold for eiendommen.`;
  });
  return {
    restore(type: T, text: string): void {
      select.value = type;
      description.value = text;
      if (!validDescription(false)) {
        options.changed();
        confirm.textContent = "Bekreft tiltakstype";
        return;
      }
      options.confirmed(type, text.trim());
      status.textContent = "Tidligere tiltakstype og beskrivelse er hentet fra prosessøkten.";
    },
    focus(): void { select.focus(); },
    hide(): void { panel.hidden = true; },
    refresh(): void {
      for (const control of [description, propose, select, confirm]) control.disabled = options.locked();
    }
  };
}
