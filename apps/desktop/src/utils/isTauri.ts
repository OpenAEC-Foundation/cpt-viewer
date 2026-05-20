/**
 * Runtime-check: draait deze app binnen de Tauri-webview of in een
 * gewone browser (b.v. `npm run dev` + browser).
 *
 * In Tauri 2 zet de runtime `globalThis.isTauri = true` voordat any
 * user code geladen wordt. Dat is de canonieke detectie — exact wat
 * `@tauri-apps/api/core`'s eigen `isTauri()` ook doet. We
 * implementeren 'm zelf zodat de utils die deze check doen geen
 * import-zware Tauri-module nodig hebben (handig voor browser-bundle
 * size + SSR).
 *
 * Fallback-checks (`__TAURI_INTERNALS__`, `__TAURI__`) zijn voor
 * compat met Tauri 1-style detectie of een geconfigureerde
 * `withGlobalTauri: true` — beide vlaggen zijn ook gezet in Tauri 2.
 */
export function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  const g = globalThis as unknown as { isTauri?: boolean };
  if (g.isTauri === true) return true;
  return (
    "__TAURI_INTERNALS__" in window ||
    "__TAURI__" in window ||
    "__TAURI_METADATA__" in window
  );
}
