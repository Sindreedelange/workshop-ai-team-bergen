type TiltakshjelpenOekt = {
  oektsId: string;
  prosessId: string;
  status?: string;
  aktivtSteg?: { id: string; type: string; visning?: string } | null;
  resultater?: Record<string, unknown>;
};

type MountOptions = {
  oekt: TiltakshjelpenOekt;
  container: HTMLElement;
  save: (svar: Record<string, unknown>, stegId: string) => Promise<void>;
};

export function mountTiltakshjelpenProsess({ oekt, container, save }: MountOptions): () => void {
  const steg = oekt.aktivtSteg;
  const question = oekt.status === "AKTIV" && steg?.type === "QUESTION" && steg.visning === "garasje";
  const result = oekt.prosessId === "garasjesjekk" && Boolean(oekt.resultater?.["garasje-vurdering"]);
  if (!question && !result) return () => {};
  const frame = document.createElement("iframe");
  frame.title = question ? "Velg eiendom og beskriv tiltaket" : "Tiltaksvurdering og kilder";
  frame.className = "tiltakshjelpen-process-frame";
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox allow-modals");
  frame.src = `/tiltakshjelpen?${new URLSearchParams({
    oektsId: oekt.oektsId, stegId: steg?.id || "", integrert: question ? "sporsmaal" : "resultat"
  })}`;
  const label = document.createElement("p");
  label.textContent = question
    ? "Velg eiendommen og plasseringen i kartet. Du kan spørre om fagord underveis uten å endre svarene."
    : "Vurderingen er lagret på denne prosessøkten. Ingen byggesøknad er sendt.";
  container.append(label, frame);
  let saving = false;
  const receive = async (event: MessageEvent) => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow || !frame.isConnected) return;
    const data: unknown = event.data;
    if (!data || typeof data !== "object" || !("type" in data)) return;
    if (data.type === "garasje-hoyde" && "hoyde" in data && typeof data.hoyde === "number") {
      frame.height = String(Math.max(500, Math.min(12000, Math.ceil(data.hoyde))));
      return;
    }
    if (!question || saving || data.type !== "garasje-svar" || !("oektsId" in data) || data.oektsId !== oekt.oektsId
      || !("stegId" in data) || data.stegId !== steg.id || !("svar" in data)
      || !data.svar || typeof data.svar !== "object" || Array.isArray(data.svar)) return;
    saving = true;
    try {
      await save(data.svar as Record<string, unknown>, steg.id);
      frame.contentWindow?.postMessage({ type: "garasje-lagret" }, location.origin);
    } catch (error) {
      frame.contentWindow?.postMessage({
        type: "garasje-feil", melding: error instanceof Error ? error.message : String(error)
      }, location.origin);
    } finally {
      saving = false;
    }
  };
  window.addEventListener("message", receive);
  return () => {
    window.removeEventListener("message", receive);
    frame.remove();
    label.remove();
  };
}
