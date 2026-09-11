/*
 * Standalone document search chat, deliberately outside /tiltakshjelpen.
 *
 * It reads the same vector index pdf_search_chunks already exposes - it adds no
 * new backend endpoint, and it shares no files with the tiltakshjelpen case.
 * Kontekst.tjeneste is picked to not match isTiltakshjelpenKontekst, so this stays
 * on the plain grounded-answer path in ai-gateway rather than the garasje one.
 */

type PdfTreff = {
  documentId?: string;
  title?: string;
  page?: number;
  text?: string;
  checkRecommended?: boolean;
};

type SporsmaalSvar = {
  tekst?: string;
  grunnlag?: Grunnlag;
  advarsel?: string;
  sperre?: string;
};

initChat(krevEl("chat"));
void checkModell(sandkasseKonfigurasjon.aiBaseUrl);

const input = krevEl<HTMLTextAreaElement>("input");
const sendKnapp = krevEl<HTMLButtonElement>("send");
const sporingsId = `dokumentchat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

addMsg("assistant", "Spør om noe fra dokumentene lastet opp til PDF-extractor. Jeg svarer bare ut fra det søket faktisk finner.");

async function soekChunks(query: string): Promise<PdfTreff[]> {
  const res = await fetch(`${sandkasseKonfigurasjon.toolsBaseUrl}/verktoy/pdf_search_chunks/invoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ arguments: { query, limit: 5 } })
  });
  if (!res.ok) throw new Error(`Dokumentsøket svarte ${res.status}.`);
  const body = await res.json();
  const treff = body?.result?.treff;
  return Array.isArray(treff) ? treff : [];
}

async function sporApiEttSporsmaal(tekst: string, dokumentkunnskap: PdfTreff[]): Promise<SporsmaalSvar> {
  const res = await fetch(`${sandkasseKonfigurasjon.aiBaseUrl}/ai/sporsmaal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tekst,
      sporingsId,
      // "Dokumentarkiv" er valgt for å ikke treffe isTiltakshjelpenKontekst.
      kontekst: { tjeneste: "Dokumentarkiv", dokumentkunnskap }
    })
  });
  if (!res.ok) throw new Error(`Spørsmålstjenesten svarte ${res.status}.`);
  return res.json();
}

async function sendSporsmaal(): Promise<void> {
  const tekst = input.value.trim();
  if (!tekst) return;
  input.value = "";
  sendKnapp.disabled = true;
  addMsg("user", tekst);
  addTyping();
  try {
    const treff = await soekChunks(tekst);
    if (!treff.length) {
      removeTyping();
      addMsg("assistant", "Søket fant ingen relevante utdrag i de indekserte dokumentene.");
      return;
    }
    const svar = await sporApiEttSporsmaal(tekst, treff);
    removeTyping();
    addMsg("assistant", svar.tekst || "Jeg fikk ikke et svar fra modellen.");
    addGrunnlagsfot(svar.grunnlag);
    warnAboutFallback(svar);
  } catch (feil) {
    removeTyping();
    addMsg("assistant", `Noe gikk galt: ${feilmelding(feil)}`);
  } finally {
    sendKnapp.disabled = false;
    input.focus();
  }
}

sendKnapp.addEventListener("click", () => void sendSporsmaal());
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void sendSporsmaal();
  }
});
