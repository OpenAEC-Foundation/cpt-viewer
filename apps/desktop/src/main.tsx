import React from "react";
import ReactDOM from "react-dom/client";

// DEBUG: catch all runtime errors and render them on the page so
// het white-screen-probleem diagnosticeerbaar is. ALLEEN het hele
// scherm overnemen wanneer React nog niets gerendered heeft (root
// is leeg) — anders zou een ongevaarlijke runtime-error (b.v. de
// Leaflet getSizedParentNode race-condition) de werkende app
// stukmaken. Voor latere runtime-errors blijven we loggen +
// negeren we bekende-onschuldige library-races.
function showError(label: string, err: unknown) {
  const detail = err instanceof Error ? `${err.name}: ${err.message}\n\n${err.stack ?? ""}` : String(err);
  // Ignore: Leaflet's getSizedParentNode null-crash bij map-unmount
  // mid-mouseevent. Komt door interne Leaflet-cleanup-race; de app
  // blijft functioneel.
  if (/getSizedParentNode|_onDown.*leaflet|reading 'offsetWidth'/i.test(detail)) {
    console.warn(`[${label} ignored — Leaflet lifecycle race]`, err);
    return;
  }
  const root = document.getElementById("root");
  if (!root) return;
  // Als React al iets heeft gerendered, log alleen — overneem het
  // scherm NIET. White-screen-detectie: root is leeg of bevat alleen
  // de StrictMode-comment-placeholders.
  if (root.children.length > 0) {
    console.error(`[${label}]`, err);
    return;
  }
  root.innerHTML = `<pre style="padding:20px;font:12px/1.4 'JetBrains Mono',monospace;color:#DC2626;background:#FAFAF9;white-space:pre-wrap;word-break:break-word">[${label}]\n${detail.replace(/[<>&]/g, c => ({"<":"&lt;",">":"&gt;","&":"&amp;"} as Record<string,string>)[c])}</pre>`;
}
window.addEventListener("error", (e) => showError("window.error", e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => showError("unhandledrejection", e.reason));

// ── Leaflet null-parent defensive patch ────────────────────────
// Leaflet's L.DomUtil.getSizedParentNode walkt parent.parentNode
// totdat het een element met clientHeight > 0 vindt. Tijdens een
// snelle map-unmount mid-mouseevent kan parent halverwege null
// worden — dan crasht het op `parent.offsetWidth`. Wrap de functie
// met een try/catch zodat dat oude-DOM-event-residue geen
// app-wide crash veroorzaakt.
import * as L from "leaflet";
const _domUtil = L.DomUtil as unknown as {
  getSizedParentNode?: (el: HTMLElement) => HTMLElement | null;
};
if (_domUtil.getSizedParentNode) {
  const orig = _domUtil.getSizedParentNode;
  _domUtil.getSizedParentNode = function (el: HTMLElement): HTMLElement | null {
    try {
      return orig.call(this, el);
    } catch {
      // Origineel crasht alleen wanneer parent === null in de loop.
      // We geven null terug; Leaflet kan dat aan (drag-start wordt
      // dan een no-op, geen verdere fallout).
      return null;
    }
  };
}

import "./i18n/config";
import App from "./App";

// Production: disable context menu and browser dev shortcuts
if (import.meta.env.PROD) {
  document.addEventListener("contextmenu", (e) => e.preventDefault());

  document.addEventListener("keydown", (e) => {
    // F12 — dev tools
    if (e.key === "F12") { e.preventDefault(); return; }
    // Ctrl+Shift+I — dev tools
    if (e.ctrlKey && e.shiftKey && e.key === "I") { e.preventDefault(); return; }
    // Ctrl+Shift+J — console
    if (e.ctrlKey && e.shiftKey && e.key === "J") { e.preventDefault(); return; }
    // Ctrl+Shift+C — inspect element
    if (e.ctrlKey && e.shiftKey && e.key === "C") { e.preventDefault(); return; }
    // Ctrl+Shift+R — hard reload
    if (e.ctrlKey && e.shiftKey && e.key === "R") { e.preventDefault(); return; }
    // Ctrl+U — view source
    if (e.ctrlKey && e.key === "u") { e.preventDefault(); return; }
    // Ctrl+R / F5 — reload
    if ((e.ctrlKey && e.key === "r") || e.key === "F5") { e.preventDefault(); return; }
  });
}

try {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
} catch (err) {
  showError("render", err);
}
