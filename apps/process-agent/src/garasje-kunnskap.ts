import { buildGarasjeKunnskapsgrunnlag, projectGarasjeDokumentkunnskap } from "../../shared/garasje-kunnskap.ts";
import { feilmelding } from "../../shared/errors.ts";

type ToolCall = (name: string, args: Record<string, unknown>) => Promise<unknown>;
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Retrieval never changes the assessment or declares a plan checked. */
export async function retrieveGarasjeKunnskap(context: unknown, query: string, invoke: ToolCall) {
  const facts = buildGarasjeKunnskapsgrunnlag(context);
  const withPlanWarning = (warning: string) => [warning, facts.planflatedekning.advarsel].filter(Boolean).join(" ");
  const empty = (warning: string) => ({ dokumentkunnskap: [], kunnskapsadvarsel: withPlanWarning(warning) });
  if (!facts.kommunenummer) return empty("Kommunen er ukjent. Dokumentgrunnlaget må avklares med byggesaksveilederen.");
  try {
    const listing = record(await invoke("pdf_list_documents", {}));
    if (!Array.isArray(listing.dokumenter)) throw new Error("Dokumentlisten har feil format.");
    const kommune = facts.kommunaleOppsett.find(item => item.kommunenummer === facts.kommunenummer);
    const planIds = new Set([kommune?.planId, ...facts.reguleringsplaner.map(plan => plan.planId), ...facts.soner.map(sone => sone.planId),
      ...facts.planflater.map(flate => flate.planId)]
      .filter((id): id is string => typeof id === "string"));
    const expectedFilename = facts.kildeTilPlanbestemmelser
      ? new URL(facts.kildeTilPlanbestemmelser).pathname.split("/").at(-1) : undefined;
    const relevantDocuments = listing.dokumenter.slice(0, 500).map(record).flatMap(doc => {
      if (doc.status !== "extracted" || typeof doc.documentId !== "string") return [];
      const source = record(doc.source);
      // A name match narrows retrieval, but does not verify origin or applicability.
      const name = String(source.filename ?? "");
      const url = String(source.canonicalUrl ?? "");
      const kpa = !!facts.kildeTilPlanbestemmelser && source.canonicalUrl === facts.kildeTilPlanbestemmelser
        || !!expectedFilename && name.toLowerCase() === expectedFilename.toLowerCase();
      const sameKommune = url.includes(facts.kommunenummer!)
        || !!kommune && `${name} ${url}`.toLowerCase().includes(kommune.navn.toLowerCase());
      const matches = [...planIds].filter(id =>
        (kpa && id === kommune?.planId) || ((sameKommune || !url) && (
          /^\d+$/.test(id) ? new RegExp(`(^|\\D)${id}(\\D|$)`).test(`${name} ${url}`) : `${name} ${url}`.includes(id)
        )));
      return kpa || matches.length ? [{ doc, planIds: matches }] : [];
    });
    const selected: typeof relevantDocuments = [];
    // Cover distinct applicable plans before spending the budget on another
    // document for the same plan, regardless of inventory ordering.
    for (const id of planIds) {
      if (selected.some(candidate => candidate.planIds.includes(id))) continue;
      const candidate = relevantDocuments.find(candidate => candidate.planIds.includes(id));
      if (candidate && selected.length < 3) selected.push(candidate);
    }
    for (const candidate of relevantDocuments) {
      if (selected.length < 3 && !selected.includes(candidate)) selected.push(candidate);
    }
    const candidates = selected.map(candidate => candidate.doc);
    if (!candidates.length) return empty("Fant ikke et ferdig PDF-dokument knyttet til kommunen og planen. Ingen planbestemmelser er bekreftet; spør kommunens byggesaksveileder.");
    const byDocument: unknown[][] = [];
    const warnings = new Set<string>();
    const coverageWarnings: string[] = [];
    if (relevantDocuments.length > candidates.length) coverageWarnings.push(
      `${relevantDocuments.length - candidates.length} relevante dokumenter ble utelatt av dokumentbudsjettet.`);
    if (listing.dokumenter.length > 500) coverageWarnings.push("Bare de første 500 dokumentene i listen ble undersøkt.");
    const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : undefined;
    for (const doc of candidates) {
      const collected: unknown[] = [];
      byDocument.push(collected);
      const source = record(doc.source);
      const result = record(await invoke("pdf_search_chunks", {
        documentId: doc.documentId, query: `${facts.kommunenummer} ${[...planIds].join(" ")} ${query.slice(0, 500)}`, limit: 3
      }));
      if (!Array.isArray(result.treff)) throw new Error("Dokumentsøket har feil format.");
      const searchWarnings = Array.isArray(result.warnings)
        ? result.warnings.filter((value): value is string => typeof value === "string").slice(0, 3).map(value => value.slice(0, 150)) : [];
      for (const warning of searchWarnings) warnings.add(warning);
      for (const item of result.treff) {
        const hit = record(item);
        if (hit.documentId !== doc.documentId) continue;
        const inventoryHash = hash(source.sha256);
        const chunkHash = hash(hit.sourceSha256);
        if (inventoryHash && chunkHash && inventoryHash !== chunkHash) {
          warnings.add("Et utdrag ble utelatt fordi kildehashen ikke stemmer med dokumentlisten. Indeksen må oppdateres.");
          continue;
        }
        const qualityWarnings = [...(Array.isArray(hit.qualityWarnings) ? hit.qualityWarnings : []), ...searchWarnings];
        if (!inventoryHash || !chunkHash) qualityWarnings.push("Kildehash mangler; koblingen mellom utdrag og dokumentversjon er ikke bekreftet.");
        collected.push({ ...hit, canonicalUrl: source.canonicalUrl, sourceSha256: chunkHash, qualityWarnings,
          scopeVerified: false, checkRecommended: true });
      }
    }
    // Round-robin reserves one citation per document before taking second hits.
    const diverse: unknown[] = [];
    const maxHits = Math.max(0, ...byDocument.map(hits => hits.length));
    for (let rank = 0; rank < maxHits && diverse.length < 3; rank++) {
      for (const hits of byDocument) {
        if (rank < hits.length && diverse.length < 3) diverse.push(hits[rank]);
      }
    }
    const dokumentkunnskap = projectGarasjeDokumentkunnskap(diverse);
    const retrievedCount = byDocument.reduce((total, hits) => total + hits.length, 0);
    if (retrievedCount > dokumentkunnskap.length) coverageWarnings.push(
      `Viser ${dokumentkunnskap.length} av ${retrievedCount} hentede utdrag, fordelt på dokumentene. Øvrige utdrag er utelatt.`);
    const missingPlans = [...planIds].filter(id => !selected.some((candidate, index) =>
      candidate.planIds.includes(id) && byDocument[index].length > 0));
    if (missingPlans.length) coverageWarnings.push(`Plan ${missingPlans.join(", ")} mangler brukbare utdrag i svaret.`);
    return { dokumentkunnskap,
      kunnskapsadvarsel: withPlanWarning([(dokumentkunnskap.length
        ? "PDF-utdragene er søketreff, ikke en kontroll av hele planen. Kildens gyldighet og anvendelse på tiltaket må bekreftes av kommunens byggesaksveileder."
        : "Ingen relevante PDF-utdrag ble funnet. Planbestemmelsene er fortsatt uavklarte."),
        ...coverageWarnings, ...[...warnings].slice(0, 3)].join(" ")) };
  } catch (error) {
    console.warn(`Dokumentgrunnlag for garasjesjekken: ${feilmelding(error)}`);
    return empty("PDF-kunnskapsbasen er utilgjengelig eller svarte ugyldig. Rådet må brukes uten dokumentgrunnlag; avklar planen med kommunens byggesaksveileder.");
  }
}
