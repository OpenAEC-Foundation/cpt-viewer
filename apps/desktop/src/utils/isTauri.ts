/**
 * Runtime-check: draait deze app binnen de Tauri-webview of in een
 * gewone browser (b.v. `npm run dev` + browser).
 *
 * In Tauri 2 zet de runtime `__TAURI_INTERNALS__` op het window-object
 * voordat any user code geladen wordt. Geen import nodig — werkt
 * óók in SSR / first-paint context.
 *
 * Gebruikt door utils die een Tauri-API zouden aanroepen, om in
 * browser-modus terug te vallen op een HTML/Web-API alternatief
 * (file-picker, dialog, fs).
 */
export function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "__TAURI_INTERNALS__" in window ||
    "__TAURI__" in window ||
    "__TAURI_METADATA__" in window
  );
}
