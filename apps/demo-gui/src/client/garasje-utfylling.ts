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
  kunnskapsadvarsel?: string;
  dokumentkunnskap?: {
    documentId?: string;
    title?: string;
    page?: number;
    canonicalUrl?: string;
    qualityWarnings?: string[];
    checkRecommended?: boolean;
  }[];
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
  for (const id of ["mode-agent", "mode-stepwise"]) el(id).hidden = fields.length === 0;
  if (!fields.length) {
    const render = () => {
      el("stepwise-interview").hidden = true;
      el("agent-interview").hidden = true;
      el("interview-review").hidden = false;
      el("assess").hidden = false;
      el("interview-error").hidden = true;
      el("interview-editing").hidden = true;
      el("answer-summary").replaceChildren();
      el("interview-progress").textContent = "Ingen standardspørsmål for denne tiltakstypen. Sjekken viser hva som må avklares.";
    };
    render();
    return { refresh: render, cancel() {}, destroy() {}, validateComplete: () => true };
  }
  const groups: GarasjeInputField[][] = [];
  for (const field of fields) {
    if (groups.some(group => group.includes(field))) continue;
    const pair = [["bya", "bra"], ["gesimshoyde", "monehoyde"]].find(ids => ids.includes(field.id));
    groups.push(pair ? fields.filter(candidate => pair.includes(candidate.id)) : [field]);
  }
  const fieldWrappers = fields.map(field => input(field).parentElement!);
  const accepted = new Set<string>();
  const unknown = new Set<string>();
  const saved = new Map(fields.map(field => [field.id, input(field).value]));
  const drafts = new Map<string, string>();
  const choices = new Map<string, HTMLButtonElement[]>();
  let mode: "agent" | "stepwise" = "agent";
  let index = 0;
  let fieldId = fields[0].id;
  let proposal: { fieldId: string; value: number | boolean | null; text: string } | null = null;
  let editing: { fieldId: string; message: string } | null = null;
  let helping = false;
  let request: AbortController | null = null;
  const error = el("interview-error");
  const textInput = el<HTMLTextAreaElement>("dialog-input");
  const lifetime = new AbortController();
  const current = () => fields.find(field => field.id === fieldId)!;
  const groupIndex = (field: GarasjeInputField) => groups.findIndex(group => group.includes(field));

  function listen(node: HTMLElement, event: string, action: (event: Event) => void): void {
    node.addEventListener(event, action, { signal: lifetime.signal });
  }

  function placeholder(field: GarasjeInputField): string {
    if (field.id === "bya") return "Skriv BYA i m²";
    if (field.id === "bra") return "Skriv BRA i m²";
    if (field.id === "hoyde") return "For eksempel 0,9 meter";
    if (["gesimshoyde", "monehoyde"].includes(field.id)) return "For eksempel 3,5 meter";
    if (field.id === "etasjer") return "For eksempel 1 etasje";
    if (field.id.startsWith("avstand")) return "For eksempel 4 meter, eller «vet ikke»";
    if (field.type === "valg") return "Svar ja eller nei, eller still et spørsmål";
    return "Skriv svaret ditt";
  }

  function showError(text: string): void {
    error.textContent = text;
    error.hidden = false;
  }

  function label(field: GarasjeInputField): string {
    const value = input(field).value;
    if (!value) return unknown.has(field.id) ? "Vet ikke" : "Ikke besvart";
    if (field.type === "valg") return value === "true" ? "Ja" : "Nei";
    return Number(value).toLocaleString("nb-NO");
  }

  function valid(field: GarasjeInputField, report = true): boolean {
    const node = input(field);
    const ok = node.checkValidity() && (node.value !== "" || (field.ukjentTillatt && unknown.has(field.id)));
    node.setAttribute("aria-invalid", String(!ok));
    if (!ok && report) showError(`Kontroller «${field.label}». ${node.validationMessage || "Oppgi et svar eller velg «Vet ikke»."}`);
    return ok;
  }

  function changed(field: GarasjeInputField): void {
    if (saved.get(field.id) !== input(field).value || (!accepted.has(field.id) && unknown.has(field.id))) {
      // Keep later drafts, but require a new review after changing their basis.
      for (const later of fields.slice(fields.indexOf(field))) accepted.delete(later.id);
      saved.set(field.id, input(field).value);
      options.changed();
    }
  }

  function cancelRequest(): void {
    request?.abort();
    request = null;
    proposal = null;
    el("dialog-pending").textContent = "";
  }

  function clearConversation(): void {
    cancelRequest();
    helping = false;
    el("dialog-log").replaceChildren();
    el("dialog-answer").textContent = "";
    el("dialog-sources").replaceChildren();
    error.hidden = true;
  }

  function rememberDraft(): void {
    if (!helping && index < groups.length && !proposal) drafts.set(fieldId, textInput.value);
  }

  function selectField(field: GarasjeInputField): void {
    rememberDraft();
    clearConversation();
    fieldId = field.id;
    textInput.value = drafts.get(field.id) ?? (input(field).value || unknown.has(field.id) ? label(field) : "");
  }

  function focusAnswer(dialog = mode === "agent"): void {
    const target = dialog ? textInput : current().type === "valg" ? choices.get(fieldId)![0] : input(current());
    target.focus();
    target.scrollIntoView({ block: "center" });
  }

  function button(text: string, action: () => void): HTMLButtonElement {
    const node = document.createElement("button");
    node.className = "ds-button";
    node.dataset.variant = "secondary";
    node.type = "button";
    node.textContent = text;
    listen(node, "click", action);
    return node;
  }

  function choiceButtons(field: GarasjeInputField, advance: boolean): HTMLButtonElement[] {
    const values: (boolean | null)[] = field.type === "valg" ? [true, false] : [];
    if (field.ukjentTillatt) values.push(null);
    return values.map(value => {
      const choice = button(value === null ? "Vet ikke" : value ? "Ja" : "Nei", () => {
        if (options.locked() || request) return;
        cancelRequest();
        input(field).value = value === null ? "" : String(value);
        if (value === null) unknown.add(field.id); else unknown.delete(field.id);
        drafts.delete(field.id);
        changed(field);
        if (advance) confirmField(field); else render();
      });
      choice.setAttribute("aria-label", `${field.label}: ${choice.textContent}`);
      choice.dataset.value = value === null ? "" : String(value);
      return choice;
    });
  }

  for (const field of fields) {
    input(field).setAttribute("placeholder", placeholder(field));
    const buttons = choiceButtons(field, false);
    if (buttons.length) {
      const row = document.createElement("div");
      row.className = "actions";
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", field.label);
      row.append(...buttons);
      input(field).parentElement!.append(row);
      choices.set(field.id, buttons);
    }
    if (field.type === "valg") input(field).hidden = true;
  }

  function render(): void {
    const reviewing = index >= groups.length;
    const field = current();
    const group = groups[index] || [];
    const editingCurrent = !reviewing && editing?.fieldId === field.id;
    const locked = options.locked();
    const blocked = locked || request !== null;
    el("mode-agent").setAttribute("aria-pressed", String(mode === "agent"));
    el("mode-stepwise").setAttribute("aria-pressed", String(mode === "stepwise"));
    el("stepwise-interview").hidden = reviewing || mode !== "stepwise";
    el("agent-interview").hidden = false;
    el("interview-review").hidden = !reviewing;
    el("assess").hidden = !reviewing;
    el("dialog-log").hidden = true;
    el("dialog-answer").hidden = !el("dialog-answer").textContent;
    el("dialog-sources").hidden = el("dialog-sources").children.length === 0;
    el("dialog-proposal").hidden = proposal === null;
    el("dialog-editor").hidden = proposal !== null && !helping;
    el("dialog-input-controls").hidden = proposal !== null && !helping;
    el("interview-editing").hidden = !editingCurrent;
    el("interview-editing").textContent = editingCurrent ? editing!.message : "";
    el("interview-progress").textContent = reviewing
      ? `${groups.length} spørsmål gjennomgått. Kontroller svarene før du fortsetter.`
      : `Spørsmål ${index + 1} av ${groups.length}`;
    fieldWrappers.forEach((wrapper, i) => { wrapper.hidden = reviewing || mode !== "stepwise" || !group.includes(fields[i]); });
    for (const candidate of fields) {
      input(candidate).disabled = locked;
      for (const choice of choices.get(candidate.id) || []) {
        choice.disabled = blocked;
        choice.setAttribute("aria-pressed", String(choice.dataset.value === input(candidate).value
          && (choice.dataset.value !== "" || unknown.has(candidate.id))));
      }
    }
    el<HTMLButtonElement>("field-previous").disabled = locked || index === 0;
    el<HTMLButtonElement>("field-next").disabled = locked;
    el<HTMLButtonElement>("dialog-previous").disabled = locked || index === 0;
    el<HTMLButtonElement>("dialog-next").disabled = locked || !group.length || !group.every(candidate => valid(candidate, false));
    el("dialog-navigation").hidden = reviewing || mode !== "agent";
    el<HTMLButtonElement>("dialog-send").disabled = blocked;
    textInput.disabled = blocked;
    for (const id of ["dialog-accept", "dialog-reject", "dialog-more", "dialog-help", "dialog-resume"]) el<HTMLButtonElement>(id).disabled = blocked;
    el("dialog-help").hidden = helping || reviewing || proposal !== null;
    el("dialog-resume").hidden = !helping;
    el("dialog-input-label").textContent = reviewing || helping ? "Hva lurer du på?"
      : editingCurrent ? `Endre svaret for «${field.label}»` : `Svar på «${field.label}» eller still et spørsmål`;
    textInput.placeholder = reviewing || helping ? "Skriv spørsmålet ditt om tiltaket" : placeholder(field);
    el("dialog-send").textContent = reviewing || helping ? "Still spørsmålet" : "Send til AI-agenten";
    el("dialog-question").hidden = reviewing || mode === "stepwise";
    const separator = /[.!?]$/.test(field.label) ? " " : ". ";
    el("dialog-question").textContent = `${field.label}${field.hint ? separator + field.hint : ""}` +
      (input(field).value || unknown.has(field.id) ? ` Nåværende svar: ${label(field)}.` : "");
    el("field-next").textContent = el("dialog-next").textContent = index === groups.length - 1 ? "Se over svarene" : "Neste spørsmål";
    const groupFields = el("dialog-group");
    groupFields.hidden = reviewing || mode !== "agent" || group.length < 2;
    groupFields.replaceChildren();
    for (const candidate of group) {
      const row = button(`${candidate.label}: ${label(candidate)}`, () => {
        if (options.locked()) return;
        selectField(candidate);
        render();
        focusAnswer(true);
      });
      row.disabled = locked;
      row.setAttribute("aria-pressed", String(candidate.id === fieldId));
      groupFields.append(row);
    }
    const agentChoices = el("dialog-choices");
    agentChoices.replaceChildren();
    agentChoices.hidden = reviewing || mode !== "agent" || proposal !== null || helping;
    if (!reviewing) {
      for (const choice of choiceButtons(field, true)) {
        choice.disabled = blocked;
        agentChoices.append(choice);
      }
    }
    if (reviewing) {
      const summary = el("answer-summary");
      summary.replaceChildren();
      for (const candidate of fields) {
        const row = document.createElement("div");
        row.className = "actions";
        const text = document.createElement("p");
        text.className = "ds-paragraph";
        text.textContent = `${candidate.label}: ${label(candidate)}`;
        const edit = button("Endre", () => {
          if (options.locked()) return;
          selectField(candidate);
          index = groupIndex(candidate);
          editing = { fieldId: candidate.id, message: `Du endrer «${candidate.label}». Nåværende svar er ${label(candidate)}. Senere svar beholdes, men må gjennomgås hvis du endrer dette svaret.` };
          render();
          focusAnswer();
        });
        edit.dataset.variant = "tertiary";
        edit.setAttribute("aria-label", `Endre ${candidate.label}`);
        edit.disabled = locked;
        row.append(text, edit);
        summary.append(row);
      }
    }
  }

  function next(): void {
    if (options.locked() || index >= groups.length) return;
    const group = groups[index];
    if (!group.every(field => valid(field))) return;
    rememberDraft();
    clearConversation();
    for (const field of group) accepted.add(field.id);
    editing = null;
    index++;
    if (index < groups.length) selectField(groups[index][0]);
    else textInput.value = "";
    render();
  }

  function confirmField(field: GarasjeInputField): void {
    if (!valid(field)) return;
    accepted.add(field.id);
    editing = null;
    proposal = null;
    helping = false;
    textInput.value = "";
    drafts.delete(field.id);
    const remaining = groups[index].find(candidate => !accepted.has(candidate.id) || !valid(candidate, false));
    if (remaining) {
      selectField(remaining);
      render();
    } else next();
  }

  for (const [id, value] of [["mode-agent", "agent"], ["mode-stepwise", "stepwise"]] as const) {
    listen(el(id), "click", () => {
      if (options.locked()) return;
      rememberDraft();
      clearConversation();
      mode = value;
      textInput.value = drafts.get(fieldId) ?? "";
      render();
    });
  }
  for (const id of ["field-previous", "dialog-previous"]) {
    listen(el(id), "click", () => {
      if (options.locked() || index === 0) return;
      rememberDraft();
      clearConversation();
      index--;
      selectField(groups[index][0]);
      editing = null;
      render();
    });
  }
  listen(el("field-next"), "click", next);
  listen(el("dialog-next"), "click", next);
  for (const field of fields) {
    listen(input(field), "input", () => {
      cancelRequest();
      unknown.delete(field.id);
      drafts.delete(field.id);
      changed(field);
      render();
    });
    listen(input(field), "focus", () => {
      if (mode === "stepwise" && fieldId !== field.id) {
        selectField(field);
        render();
      }
    });
    listen(input(field), "keydown", event => {
      if ((event as KeyboardEvent).key === "Enter" && mode === "stepwise") {
        event.preventDefault();
        next();
      }
    });
  }

  function help(): void {
    if (options.locked() || request) return;
    rememberDraft();
    helping = true;
    textInput.value = "";
    render();
    focusAnswer(true);
  }
  listen(el("dialog-help"), "click", help);
  listen(el("dialog-more"), "click", help);
  listen(el("dialog-resume"), "click", () => {
    if (options.locked() || request) return;
    helping = false;
    textInput.value = drafts.get(fieldId) ?? "";
    render();
    if (!proposal) focusAnswer(true);
  });

  async function send(): Promise<void> {
    if (options.locked() || request) return;
    const text = textInput.value.trim();
    if (!text || text.length > 500) {
      showError(!text ? "Skriv et svar eller et spørsmål til AI-agenten." : "Meldingen kan ha maksimalt 500 tegn.");
      return;
    }
    const reviewing = index >= groups.length;
    const questionOnly = reviewing || helping;
    const field = current();
    const controller = new AbortController();
    request = controller;
    if (!questionOnly) proposal = null;
    error.hidden = true;
    el("dialog-answer").textContent = "";
    el("dialog-sources").replaceChildren();
    el("dialog-pending").textContent = "AI-agenten svarer …";
    render();
    try {
      const reply = await options.ask(field.id, text, controller.signal);
      if (controller.signal.aborted || request !== controller) return;
      el("dialog-answer").textContent = [reply.tekst, reply.advarsel,
        reply.kunnskapsadvarsel ? `Dokumentgrunnlag: ${reply.kunnskapsadvarsel}` : ""].filter(Boolean).join("\n");
      if (reply.dokumentkunnskap !== undefined && !Array.isArray(reply.dokumentkunnskap)) {
        throw new Error("Forklaringstjenesten svarte med ugyldige kildehenvisninger.");
      }
      for (const source of reply.dokumentkunnskap ?? []) {
        const citation = document.createElement("p");
        citation.className = "ds-paragraph";
        const title = `${source.title || source.documentId || "PDF-dokument"}${source.page === undefined ? "" : `, side ${source.page}`}`;
        const link = document.createElement("a");
        if (source.canonicalUrl && /^https?:\/\//i.test(source.canonicalUrl)) {
          link.className = "ds-link";
          link.setAttribute("href", source.canonicalUrl);
          link.setAttribute("target", "_blank");
          link.setAttribute("rel", "noopener noreferrer");
          link.textContent = title;
          citation.append(link);
        } else {
          citation.textContent = `${title}. Kildelenke mangler eller er ugyldig.`;
        }
        const warnings = source.qualityWarnings ?? [];
        if (source.checkRecommended || warnings.length) {
          const quality = document.createElement("span");
          quality.textContent = ` Kontroll anbefales.${warnings.length ? ` ${warnings.join(" ")}` : ""}`;
          citation.append(quality);
        }
        el("dialog-sources").append(citation);
      }
      textInput.value = "";
      if (reply.type === "svar" && !questionOnly) {
        const value = reply.svar;
        if (value === undefined || (value === null && !field.ukjentTillatt)
          || (value !== null && (field.type === "tall" ? typeof value !== "number" || !Number.isFinite(value) : typeof value !== "boolean"))) {
          throw new Error("Agenten returnerte en ugyldig verdi. Svar på nytt eller bruk stegvis utfylling.");
        }
        proposal = { fieldId: field.id, value, text };
        drafts.set(field.id, text);
        el("dialog-proposal-text").textContent = `Jeg forstår svaret som ${value === null ? "«Vet ikke»" : value === true ? "«Ja»" : value === false ? "«Nei»" : value.toLocaleString("nb-NO")} for «${field.label}». Stemmer det?`;
      } else if (reply.type === "svar") {
        el("dialog-answer").textContent += "\nIngen svar er endret. Bruk «Endre» eller bekreft forslaget når du vil lagre et svar.";
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
  listen(el("dialog-send"), "click", () => void send());
  listen(textInput, "keydown", event => {
    if ((event as KeyboardEvent).key === "Enter" && !(event as KeyboardEvent).shiftKey) {
      event.preventDefault();
      void send();
    }
  });
  listen(el("dialog-accept"), "click", () => {
    if (!proposal || options.locked() || request) return;
    const field = current();
    if (field.id !== proposal.fieldId) return;
    const node = input(field), previous = node.value, wasUnknown = unknown.has(field.id);
    node.value = proposal.value === null ? "" : String(proposal.value);
    if (proposal.value === null) unknown.add(field.id); else unknown.delete(field.id);
    if (!valid(field)) {
      node.value = previous;
      if (wasUnknown) unknown.add(field.id); else unknown.delete(field.id);
      render();
      return;
    }
    changed(field);
    confirmField(field);
  });
  listen(el("dialog-reject"), "click", () => {
    if (!proposal || options.locked() || request) return;
    const field = current();
    editing = { fieldId: field.id, message: `Du endrer «${field.label}». Forslaget er ikke lagret. Rett teksten i tekstboksen og send på nytt.` };
    textInput.value = proposal.text;
    helping = false;
    cancelRequest();
    render();
    focusAnswer(true);
  });
  render();
  return {
    refresh: render,
    destroy(): void {
      cancelRequest();
      lifetime.abort();
    },
    cancel(): void {
      clearConversation();
      render();
    },
    validateComplete(): boolean {
      if (request) {
        showError("Vent på agentsvaret eller bytt til stegvis utfylling.");
        return false;
      }
      const invalid = fields.find(field => !accepted.has(field.id) || !valid(field, false));
      if (invalid) {
        selectField(invalid);
        index = groupIndex(invalid);
        mode = "stepwise";
        render();
        showError("Gå gjennom spørsmålet og bekreft svaret før du kjører sjekken.");
        return false;
      }
      const gesims = fields.find(field => field.id === "gesimshoyde"), mone = fields.find(field => field.id === "monehoyde");
      if (gesims && mone && Number(input(gesims).value) > Number(input(mone).value)) {
        selectField(gesims);
        index = groupIndex(gesims);
        mode = "stepwise";
        render();
        showError("Gesimshøyden kan ikke være høyere enn mønehøyden. Kontroller målene.");
        return false;
      }
      return true;
    }
  };
}
