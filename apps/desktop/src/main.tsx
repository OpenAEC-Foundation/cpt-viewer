import React from "react";
import ReactDOM from "react-dom/client";

// DEBUG: catch all runtime errors and render them on the page so the white-screen issue is diagnosable.
function showError(label: string, err: unknown) {
  const root = document.getElementById("root");
  if (!root) return;
  const detail = err instanceof Error ? `${err.name}: ${err.message}\n\n${err.stack ?? ""}` : String(err);
  root.innerHTML = `<pre style="padding:20px;font:12px/1.4 'JetBrains Mono',monospace;color:#DC2626;background:#FAFAF9;white-space:pre-wrap;word-break:break-word">[${label}]\n${detail.replace(/[<>&]/g, c => ({"<":"&lt;",">":"&gt;","&":"&amp;"} as Record<string,string>)[c])}</pre>`;
}
window.addEventListener("error", (e) => showError("window.error", e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => showError("unhandledrejection", e.reason));

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
