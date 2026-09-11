export type Tiltaksraad = {
  raad: string;
  begrunnelse?: string;
  maaAvklares?: string[];
  modell?: string;
  advarsel?: string;
  kilder?: { tittel: string; side?: number; url?: string; merknad?: string }[];
};

export async function renderTiltaksraad(
  parent: HTMLElement,
  request: () => Promise<Tiltaksraad>,
  current: () => boolean
): Promise<void> {
  const section = document.createElement("section");
  section.className = "stack";
  section.id = "document-advice";
  section.setAttribute("aria-labelledby", "document-advice-heading");
  const heading = document.createElement("h3");
  heading.className = "ds-heading";
  heading.dataset.size = "sm";
  heading.id = "document-advice-heading";
  heading.textContent = "Råd fra plangrunnlaget";
  const status = document.createElement("p");
  status.className = "ds-paragraph";
  status.setAttribute("role", "status");
  status.textContent = "Henter relevante dokumentutdrag og råd. Den regelbaserte vurderingen ovenfor gjelder fortsatt.";
  section.append(heading, status);
  parent.querySelector("#document-advice")?.remove();
  parent.append(section);
  try {
    const reply = await request();
    if (!current()) return;
    if (typeof reply.raad !== "string" || !reply.raad.trim()) throw new Error("Rådgivningstjenesten svarte uten råd.");
    status.textContent = reply.raad;
    function paragraph(text: string): void {
      const node = document.createElement("p");
      node.className = "ds-paragraph";
      node.textContent = text;
      section.append(node);
    }
    if (reply.begrunnelse) paragraph(reply.begrunnelse);
    if (reply.advarsel) paragraph(`Forbehold: ${reply.advarsel}`);
    if (reply.modell) paragraph(`Formulert med: ${reply.modell}. Rådet erstatter ikke den regelbaserte vurderingen.`);
    if (reply.maaAvklares?.length) {
      const list = document.createElement("ul");
      list.className = "source-list";
      for (const condition of reply.maaAvklares) {
        const item = document.createElement("li");
        item.textContent = condition;
        list.append(item);
      }
      section.append(list);
    }
    for (const source of reply.kilder ?? []) {
      const item = document.createElement("p");
      item.className = "ds-paragraph";
      const title = `${source.tittel}${source.side === undefined ? "" : `, side ${source.side}`}`;
      if (source.url && /^https?:\/\//i.test(source.url)) {
        const link = document.createElement("a");
        link.className = "ds-link";
        link.href = source.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = title;
        item.append(link);
      } else {
        item.textContent = title;
      }
      if (source.merknad) item.append(document.createTextNode(`. ${source.merknad}`));
      section.append(item);
    }
  } catch (error) {
    if (!current()) return;
    status.textContent = `Dokumentrådet kunne ikke hentes: ${error instanceof Error ? error.message : String(error)}. ` +
      "Bruk den regelbaserte vurderingen og ta uavklarte forhold med til kommunens plan- og byggesaksrådgivere.";
    status.setAttribute("role", "alert");
  }
}
