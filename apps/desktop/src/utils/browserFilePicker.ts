/**
 * Browser-fallback voor `@tauri-apps/plugin-dialog` open() — gebruikt
 * een verborgen `<input type="file">` zodat de webversie van de app
 * (b.v. `npm run dev` open in browser i.p.v. Tauri-window) óók
 * bestanden kan openen.
 *
 * API spiegelt grotendeels de Tauri-open():
 *   pickFiles({ multiple, accept }) → Array<{ name, text }>
 *
 * Verschillen:
 * - retourneert `text` (al gelezen) i.p.v. een pad, omdat de browser
 *   géén bestandsystem-paden mag teruggeven.
 * - `accept` is de HTML accept-string (".gef,.xml,.ifcgeo") i.p.v.
 *   Tauri's extensions-array.
 */

export interface BrowserPickedFile {
  /** Originele bestandsnaam zoals de gebruiker 'm geselecteerd heeft. */
  name: string;
  /** Volledige inhoud als UTF-8 string. */
  text: string;
}

export interface BrowserPickOptions {
  /** Mag de gebruiker meerdere bestanden selecteren? Default true. */
  multiple?: boolean;
  /** HTML accept-string, b.v. ".gef,.xml,.ifcgeo,.ifcgis,.ifcx". */
  accept?: string;
}

/**
 * Open de browser-file-picker en wacht tot de gebruiker iets kiest.
 * Resolves met een (lege) array bij annulering.
 */
export function pickFiles(opts: BrowserPickOptions = {}): Promise<BrowserPickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = opts.multiple ?? true;
    if (opts.accept) input.accept = opts.accept;
    // Verberg het element — sommige browsers tonen anders een
    // standaard-controle als de input in de DOM zit.
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.opacity = "0";
    input.style.pointerEvents = "none";

    // Cancel-detectie: in moderne browsers vuurt `cancel` als de
    // gebruiker de dialog sluit zonder selectie. Fallback: focus-event
    // op window — als er na 500ms nog geen change is, gaan we ervan
    // uit dat-ie geannuleerd is.
    let resolved = false;
    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      input.removeEventListener("change", onChange);
      input.removeEventListener("cancel", onCancel);
      window.removeEventListener("focus", onFocus);
      if (input.parentNode) input.parentNode.removeChild(input);
    };

    const onChange = async () => {
      const files = Array.from(input.files ?? []);
      if (files.length === 0) {
        cleanup();
        resolve([]);
        return;
      }
      try {
        const picked = await Promise.all(
          files.map(async (f) => ({ name: f.name, text: await f.text() })),
        );
        cleanup();
        resolve(picked);
      } catch (err) {
        console.error("pickFiles: read error", err);
        cleanup();
        resolve([]);
      }
    };

    const onCancel = () => {
      cleanup();
      resolve([]);
    };

    // Focus-trick voor browsers die `cancel` niet ondersteunen — bij
    // focus terug op window check of er een selectie was. Met 500ms
    // delay zodat een nakomende `change` voorrang krijgt.
    const onFocus = () => {
      setTimeout(() => {
        if (!resolved && (input.files?.length ?? 0) === 0) {
          cleanup();
          resolve([]);
        }
      }, 500);
    };

    input.addEventListener("change", onChange);
    input.addEventListener("cancel", onCancel);
    window.addEventListener("focus", onFocus, { once: true });

    document.body.appendChild(input);
    input.click();
  });
}
