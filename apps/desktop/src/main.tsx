import React from "react";
import ReactDOM from "react-dom/client";
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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
