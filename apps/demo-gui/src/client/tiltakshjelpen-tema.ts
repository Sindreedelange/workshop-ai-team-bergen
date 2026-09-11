(() => {
  const key = "tiltakshjelpen-color-scheme";
  const legacyKey = "garasjesjekk-color-scheme";
  const isTheme = (value: string | null): value is "light" | "dark" => value === "light" || value === "dark";
  const storageError = (error: unknown) => {
    if (!(error instanceof DOMException) || !["SecurityError", "QuotaExceededError"].includes(error.name)) throw error;
    console.warn("Nettleseren tillater ikke lagring av temavalget. Valget gjelder bare denne siden.");
    const note = document.getElementById("theme-note");
    if (note) note.textContent = "Temavalget kan ikke lagres i denne nettleseren.";
  };
  const apply = (value: "light" | "dark") => {
    document.documentElement.dataset.colorScheme = value;
    const select = document.getElementById("theme");
    if (select instanceof HTMLSelectElement) select.value = value;
  };
  let initial: "light" | "dark" = "dark";
  try {
    const stored = localStorage.getItem(key) ?? localStorage.getItem(legacyKey);
    if (isTheme(stored)) initial = stored;
    else if (stored !== null) console.warn("Ukjent temavalg. Bruker mørkt tema.");
  } catch (error) {
    storageError(error);
  }
  apply(initial);
  const connect = () => {
    apply(document.documentElement.dataset.colorScheme === "light" ? "light" : "dark");
    document.getElementById("theme")?.addEventListener("change", event => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement) || !isTheme(target.value)) return;
      apply(target.value);
      try {
        localStorage.setItem(key, target.value);
      } catch (error) {
        storageError(error);
      }
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", connect, { once: true });
  else connect();
  window.addEventListener("storage", event => {
    if (event.key === key || event.key === null) apply(isTheme(event.newValue) ? event.newValue : "dark");
  });
})();
