/**
 * Formen på et Esri-svar, delt av testene som later som de er Bergens ArcGIS.
 *
 * Bare de rene, formavhengige bitene: utsnittet forespørselen ba om, og en ytre
 * ring rundt det. Modulen importerer ingenting fra `apps/`, slik at en testfil
 * kan hente den før den setter miljøvariablene sine og laster tjenesten.
 *
 * Grunnen til at den finnes: fire steder i to filer leste `geometry`-parameteren,
 * delte den på komma og bygde det samme rektangelet med klokken. To av dem sto ni
 * linjer fra hverandre. Rekkefølgen på hjørnene er ikke fri - Esri leser en ring
 * med klokken som ytre og mot klokken som hull - så en kopi som snudde ville gitt
 * et hull der testen mente en flate.
 */

/** Utsnittet spørringen ba om: [vest, sør, øst, nord]. */
export function konvolutt(url: URL): [number, number, number, number] {
  return (url.searchParams.get("geometry") || "").split(",").map(Number) as [number, number, number, number];
}

/**
 * Én ytre ring rundt utsnittet, med klokken.
 *
 * `kanter` finnes for testene som deler utsnittet i to flater ved siden av
 * hverandre; uten dem er det kantene spørringen ba om.
 */
export function konvoluttring(url: URL, kanter: { vest?: number; ost?: number } = {}): [number, number][] {
  const [v, sor, o, nord] = konvolutt(url);
  const vest = kanter.vest ?? v, ost = kanter.ost ?? o;
  return [[vest, sor], [vest, nord], [ost, nord], [ost, sor], [vest, sor]];
}
