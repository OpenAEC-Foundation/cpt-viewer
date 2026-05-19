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
// PROBLEEM: Leaflet's bundled `_onDown` (in L.Draggable.prototype)
// roept een LOCAL CLOSURE `getSizedParentNode` aan — niet de
// versie op `L.DomUtil`. Die local closure crasht op `null.offsetWidth`
// wanneer de parent-chain van het element ergens een null bevat.
// Een patch op `L.DomUtil.getSizedParentNode` alleen heeft GEEN effect
// op die interne call → drag-init throwt halverwege → `_parentScale`
// wordt nooit gezet → `_onMove` faalt onmiddellijk op
// `_parentScale.x` is undefined → pannen werkt niet meer.
//
// OPLOSSING: vervang `L.Draggable.prototype._onDown` met een eigen
// implementatie die exact hetzelfde doet als Leaflet's origineel maar
// met een veilige `getSizedParentNode` die nooit crasht (fallback
// naar document.body bij een gebroken parent-chain). De rest van de
// Leaflet helpers (preventOutline, disableImageDrag, etc.) zijn wél
// op `L.DomUtil` gepubliceerd dus die hergebruiken we.
import * as L from "leaflet";

const safeGetSizedParentNode = (start: HTMLElement | null): HTMLElement => {
  let element: HTMLElement | Node | null = start;
  for (let safety = 0; safety < 50; safety++) {
    const next: Node | null = element?.parentNode ?? null;
    if (!next) return document.body;
    element = next;
    const el = element as HTMLElement;
    if (el.offsetWidth && el.offsetHeight) return el;
    if (el === document.body) return el;
  }
  return document.body;
};

interface DraggableProto {
  _enabled: boolean;
  _moved: boolean;
  _moving: boolean;
  _element: HTMLElement;
  _preventOutline?: boolean;
  _startPoint?: L.Point;
  _startPos?: L.Point;
  _parentScale?: { x: number; y: number };
  _onMove: (e: Event) => void;
  _onUp: (e: Event) => void;
  fire: (event: string) => void;
  finishDrag?: () => void;
}

const LDraggable = (L as unknown as { Draggable: { prototype: DraggableProto; _dragging: unknown } }).Draggable;
const LDomUtilExt = L.DomUtil as unknown as {
  hasClass: (el: HTMLElement, name: string) => boolean;
  preventOutline?: (el: HTMLElement) => void;
  getPosition: (el: HTMLElement) => L.Point;
  getScale?: (el: HTMLElement) => { x: number; y: number; boundingClientRect: DOMRect };
  disableImageDrag?: () => void;
  disableTextSelection?: () => void;
};

if (LDraggable?.prototype && typeof L.DomEvent?.on === "function") {
  LDraggable.prototype._onDown = function (this: DraggableProto, e: MouseEvent | TouchEvent) {
    if (!this._enabled) return;
    this._moved = false;
    if (LDomUtilExt.hasClass(this._element, "leaflet-zoom-anim")) return;
    const touchEv = e as TouchEvent;
    if (touchEv.touches && touchEv.touches.length !== 1) {
      if (LDraggable._dragging === this) this.finishDrag?.();
      return;
    }
    const mouseEv = e as MouseEvent;
    if (LDraggable._dragging === this || (mouseEv.shiftKey && e.type !== "touchstart")) return;
    LDraggable._dragging = this;
    if (this._preventOutline && LDomUtilExt.preventOutline) {
      LDomUtilExt.preventOutline(this._element);
    }
    LDomUtilExt.disableImageDrag?.();
    LDomUtilExt.disableTextSelection?.();
    if (this._moving) return;
    this.fire("down");
    const first = touchEv.touches ? touchEv.touches[0] : mouseEv;
    const sizedParent = safeGetSizedParentNode(this._element);
    this._startPoint = L.point(first.clientX, first.clientY);
    this._startPos = LDomUtilExt.getPosition(this._element) ?? L.point(0, 0);
    const sc = LDomUtilExt.getScale?.(sizedParent);
    this._parentScale = sc ? { x: sc.x || 1, y: sc.y || 1 } : { x: 1, y: 1 };
    const isMouse = e.type === "mousedown";
    L.DomEvent.on(
      document,
      isMouse ? "mousemove" : "touchmove",
      this._onMove,
      this,
    );
    L.DomEvent.on(
      document,
      isMouse ? "mouseup" : "touchend touchcancel",
      this._onUp,
      this,
    );
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
