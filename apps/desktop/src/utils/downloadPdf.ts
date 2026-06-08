// Platform-agnostische PDF-download — werkt zowel in Tauri-WebView als
// in een gewone browser (toekomstige webversie, dev-server in Chrome,
// etc.). De PDF-bytes worden al door `generatePileReport()` puur in JS
// (jsPDF) berekend, dus geen WebAssembly nodig — alleen het opslaan
// verschilt per platform:
//
//   - Tauri:   @tauri-apps/plugin-dialog (save-as picker) + plugin-fs
//   - Browser: Blob + invisible <a download> click + revokeObjectURL
//
// Detect-strategy: kijk of `window.__TAURI_INTERNALS__` aanwezig is. In
// Tauri v2 zit dit altijd op de window-object zodra de webview geladen
// is. Fallback naar browser-download bij dynamic import-failure (Tauri-
// plugins zijn dependencies die in een web-only build niet bundlet).

/** Type-narrow voor de Tauri-detection (geen `any`-cast). */
interface TauriGlobal {
  __TAURI_INTERNALS__?: unknown;
  __TAURI__?: unknown;
}

export function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as TauriGlobal;
  return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__);
}

/**
 * Bied de PDF-bytes aan als download. In Tauri: native save-dialog +
 * filesystem write. In browser: blob-URL + auto-click op verborgen anker.
 *
 * @param filename  - default-naam (Tauri: voorinvulling, browser: definitief)
 * @param bytes     - PDF-bytes uit jsPDF (`doc.output("arraybuffer")` etc.)
 * @returns         - true bij succesvol opgeslagen, false bij user-cancel
 *                    (alleen Tauri kan cancel signaleren; browser krijgt altijd true)
 */
export async function downloadPdf(filename: string, bytes: Uint8Array): Promise<boolean> {
  if (isTauriRuntime()) {
    try {
      // Dynamic import zodat web-only builds (zonder @tauri-apps deps in
      // het bundle) deze code-path niet crashen op load-time.
      const dialog = await import("@tauri-apps/plugin-dialog");
      const fs = await import("@tauri-apps/plugin-fs");
      const path = await dialog.save({
        defaultPath: filename,
        filters: [{ name: "PDF document", extensions: ["pdf"] }],
      });
      if (!path) return false; // user clicked cancel
      await fs.writeFile(path, bytes);
      return true;
    } catch (err) {
      // Tauri-detection was true maar plugin niet geladen — val terug
      // op browser-download zodat het in elk geval iets oplevert.
      // eslint-disable-next-line no-console
      console.warn("[downloadPdf] Tauri-save mislukte, val terug op browser-download:", err);
    }
  }

  // Browser-pad — blob + anchor + click.
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Geef de browser even tijd om de download op te starten voordat we
  // de blob-URL revoken (anders cancelt sommige browsers de download).
  setTimeout(() => URL.revokeObjectURL(url), 200);
  return true;
}
