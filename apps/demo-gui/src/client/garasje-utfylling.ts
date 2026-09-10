export type GarasjeInputField = {
  id: string;
  label: string;
  hint?: string;
  type: "tall" | "valg";
  ukjentTillatt: boolean;
};

export type GarasjeDialogReply = {
  type: "svar" | "sporsmaal" | "ugyldig";
  tekst: string;
  svar?: number | boolean | null;
  modell?: string;
  advarsel?: string;
};

type Options = {
  fields: readonly GarasjeInputField[];
  locked: () => boolean;
  changed: () => void;
  ask: (fieldId: string, tekst: string, signal: AbortSignal) => Promise<GarasjeDialogReply>;
};

export function createGarasjeUtfylling(options: Options) {
  const { fields } = options;
  const el = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const node = document.getElementById(id);
    if (!node) throw new Error(`Mangler utfyllingsfeltet ${id}.`);
    return node as T;
  };
  const input = (field: GarasjeInputField) => el<HTMLInputElement | HTMLSelectElement>(field.id);
  const fieldWrappers = fields.map(field => input(field).parentElement!);
  const accepted = new Set<string>();
  let mode: "agent" | "stepwise" = "agent";
  let index = 0;
  let proposal: { fieldId: string; value: number | boolean | null; text: string } | null = null;
  let editing: { fieldId: string; message: string } | null = null;
  let request: AbortController | null = null;
  const error = el("interview-error");
  const log = el("dialog-log");

  function showError(text: string): void {
    error.textContent = text;
    error.hidden = false;
  }

  function read(field: GarasjeInputField): number | boolean | null {
    const value = input(field).value.trim();
    return value === "" ? null : field.type === "tall" ? Number(value) : value === "true";
  }

  function label(field: GarasjeInputField): string {
    const value = read(field);
    if (value === null) return "Vet ikke";
    if (typeof value === "boolean") return value ? "Ja" : "Nei";
    return value.toLocaleString("nb-NO");
  }

  function valid(field: GarasjeInputField, report = true): boolean {
    const node = input(field);
    const ok = node.checkValidity() && (node.value !== "" || field.ukjentTillatt);
    node.setAttribute("aria-invalid", String(!ok));
    if (!ok && report) showError(`Kontroller «${field.label}». ${node.validationMessage || "Fyll inn en gyldig verdi."}`);
    return ok;
  }

  function cancelRequest(): void {
    request?.abort();
    request = null;
    proposal = null;
    el("dialog-pending").textContent = "";
  }

  function addMessage(role: "Du" | "AI-agent", text: string): void {
    const p = document.createElement("p");
    p.className = "ds-paragraph dialog-message";
    p.textContent = `${role}: ${text}`;
    log.append(p);
    p.scrollIntoView({ block: "nearest" });
  }

  function focusAnswer(dialog = mode === "agent"): void {
    const target = dialog ? el("dialog-input") : input(fields[index]);
    target.focus();
    target.scrollIntoView({ block: "center" });
  }

  function render(): void {
    const reviewing = index >= fields.length;
    const editingCurrent = !reviewing && editing?.fieldId === fields[index].id;
    const locked = options.locked();
    el("mode-agent").setAttribute("aria-pressed", String(mode === "agent"));
    el("mode-stepwise").setAttribute("aria-pressed", String(mode === "stepwise"));
    el("stepwise-interview").hidden = reviewing || mode !== "stepwise";
    el("agent-interview").hidden = false;
    el("interview-review").hidden = !reviewing;
    el("assess").hidden = !reviewing;
    el("dialog-proposal").hidden = proposal === null;
    el("interview-editing").hidden = !editingCurrent;
    el("interview-editing").textContent = editingCurrent ? editing!.message : "";
    el("interview-progress").textContent = reviewing
      ? `${fields.length} spørsmål gjennomgått. Kontroller svarene før du fortsetter.`
      : `Spørsmål ${index + 1} av ${fields.length}`;
    fieldWrappers.forEach((wrapper, i) => { wrapper.hidden = reviewing || mode !== "stepwise" || i !== index; });
    el<HTMLButtonElement>("field-previous").disabled = locked || index === 0;
    el<HTMLButtonElement>("dialog-previous").disabled = locked || index === 0 || request !== null;
    el("dialog-previous").hidden = reviewing || mode !== "agent";
    el<HTMLButtonElement>("dialog-send").disabled = locked || request !== null;
    el<HTMLTextAreaElement>("dialog-input").disabled = locked || request !== null;
    el<HTMLButtonElement>("dialog-accept").disabled = locked;
    el<HTMLButtonElement>("dialog-reject").disabled = locked;
    el("dialog-input-label").textContent = reviewing ? "Still et spørsmål om svarene dine"
      : editingCurrent ? `Endre svaret for «${fields[index].label}»` : "Svar eller still et spørsmål";
    el("dialog-send").textContent = reviewing ? "Spør AI-agenten" : "Send til AI-agenten";
    el("dialog-question").hidden = !reviewing && mode === "stepwise";
    if (!reviewing) {
      const field = fields[index];
      el("dialog-question").textContent = `${field.label}${field.hint ? `. ${field.hint}` : ""}` +
        (accepted.has(field.id) ? ` Nåværende svar: ${label(field)}.` : "");
      el("field-next").textContent = index === fields.length - 1 ? "Se over svarene" : "Neste spørsmål";
    } else {
      el("dialog-question").textContent = "Du kan fortsatt stille spørsmål. Velg «Endre» i oppsummeringen hvis du vil rette et svar.";
      const summary = el("answer-summary");
      summary.replaceChildren();
      fields.forEach((field, i) => {
        const row = document.createElement("div");
        row.className = "actions";
        const text = document.createElement("p");
        text.className = "ds-paragraph";
        text.textContent = `${field.label}: ${label(field)}`;
        const button = document.createElement("button");
        button.className = "ds-button";
        button.dataset.variant = "tertiary";
        button.type = "button";
        button.textContent = "Endre";
        button.setAttribute("aria-label", `Endre ${field.label}`);
        button.disabled = locked;
        button.addEventListener("click", () => {
          if (options.locked()) return;
          cancelRequest();
          index = i;
          editing = { fieldId: field.id, message: `Du endrer «${field.label}». Nåværende svar er ${label(field)}. Bekreft det nye svaret før du fortsetter.` };
          el<HTMLTextAreaElement>("dialog-input").value = label(field);
          error.hidden = true;
          options.changed();
          render();
          focusAnswer();
        });
        row.append(text, button);
        summary.append(row);
      });
    }
  }

  function next(): void {
    if (options.locked() || index >= fields.length) return;
    const field = fields[index];
    if (!valid(field)) return;
    cancelRequest();
    accepted.add(field.id);
    editing = null;
    index++;
    error.hidden = true;
    render();
  }

  for (const [id, value] of [["mode-agent", "agent"], ["mode-stepwise", "stepwise"]] as const) {
    el(id).addEventListener("click", () => {
      if (options.locked()) return;
      cancelRequest();
      mode = value;
      error.hidden = true;
      render();
    });
  }
  for (const id of ["field-previous", "dialog-previous"]) {
    el(id).addEventListener("click", () => {
      if (options.locked() || index === 0) return;
      cancelRequest();
      index--;
      editing = null;
      error.hidden = true;
      render();
    });
  }
  el("field-next").addEventListener("click", next);
  for (const field of fields) {
    input(field).addEventListener("input", () => {
      cancelRequest();
      accepted.delete(field.id);
      options.changed();
      render();
    });
    input(field).addEventListener("keydown", event => {
      if (event instanceof KeyboardEvent && event.key === "Enter" && mode === "stepwise") {
        event.preventDefault();
        next();
      }
    });
  }

  async function send(): Promise<void> {
    if (options.locked() || request) return;
    const textInput = el<HTMLTextAreaElement>("dialog-input");
    const text = textInput.value.trim();
    if (!text) {
      showError("Skriv et svar eller et spørsmål til AI-agenten.");
      return;
    }
    if (text.length > 500) {
      showError("Meldingen kan ha maksimalt 500 tegn.");
      return;
    }
    const reviewing = index >= fields.length;
    const field = fields[Math.min(index, fields.length - 1)];
    const controller = new AbortController();
    request = controller;
    proposal = null;
    error.hidden = true;
    addMessage("Du", text);
    el("dialog-pending").textContent = "AI-agenten svarer …";
    render();
    try {
      const reply = await options.ask(field.id, text, controller.signal);
      if (controller.signal.aborted || request !== controller) return;
      addMessage("AI-agent", reply.tekst + (reply.advarsel ? `\n${reply.advarsel}` : ""));
      textInput.value = "";
      if (reply.type === "svar") {
        if (reviewing) {
          addMessage("AI-agent", "Velg «Endre» ved riktig felt i oppsummeringen for å rette et svar.");
          return;
        }
        const value = reply.svar;
        if (value === undefined || (value === null && !field.ukjentTillatt)
          || (value !== null && (field.type === "tall" ? typeof value !== "number" || !Number.isFinite(value) : typeof value !== "boolean"))) {
          throw new Error("Agenten returnerte en ugyldig verdi. Svar på nytt eller bruk stegvis utfylling.");
        }
        proposal = { fieldId: field.id, value, text };
        el("dialog-proposal-text").textContent = `Jeg forstår svaret som ${value === null ? "«Vet ikke»" : value === true ? "«Ja»" : value === false ? "«Nei»" : value.toLocaleString("nb-NO")} for «${field.label}». Stemmer det?`;
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      if (request === controller) {
        request = null;
        el("dialog-pending").textContent = "";
        render();
      }
    }
  }
  el("dialog-send").addEventListener("click", () => void send());
  el("dialog-input").addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  });
  el("dialog-accept").addEventListener("click", () => {
    if (!proposal || options.locked()) return;
    const field = fields[index];
    if (field.id !== proposal.fieldId) return;
    const node = input(field), previous = node.value;
    node.value = proposal.value === null ? "" : String(proposal.value);
    if (!valid(field)) {
      node.value = previous;
      proposal = null;
      render();
      return;
    }
    proposal = null;
    options.changed();
    next();
  });
  el("dialog-reject").addEventListener("click", () => {
    if (!proposal || options.locked()) return;
    const field = fields[index];
    editing = { fieldId: field.id, message: `Du endrer «${field.label}». Forslaget er ikke lagret. Rett teksten i tekstboksen og send på nytt.` };
    el<HTMLTextAreaElement>("dialog-input").value = proposal.text;
    cancelRequest();
    render();
    focusAnswer(true);
  });
  render();
  return {
    refresh: render,
    cancel: cancelRequest,
    validateComplete(): boolean {
      if (request) {
        showError("Vent på agentsvaret eller bytt til stegvis utfylling.");
        return false;
      }
      const invalid = fields.findIndex(field => !accepted.has(field.id) || !valid(field, false));
      if (invalid >= 0) {
        index = invalid;
        mode = "stepwise";
        render();
        showError("Gå gjennom spørsmålet og bekreft svaret før du kjører sjekken.");
        return false;
      }
      const gesims = Number(input(fields.find(f => f.id === "gesimshoyde")!).value);
      const mone = Number(input(fields.find(f => f.id === "monehoyde")!).value);
      if (gesims > mone) {
        index = fields.findIndex(f => f.id === "gesimshoyde");
        mode = "stepwise";
        render();
        showError("Gesimshøyden kan ikke være høyere enn mønehøyden. Kontroller målene.");
        return false;
      }
      return true;
    }
  };
}
