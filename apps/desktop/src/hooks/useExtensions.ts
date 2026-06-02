/**
 * Extensies-systeem — optionele app-modules die de gebruiker
 * expliciet aanzet via Instellingen → Extensies. Default UIT zodat
 * een verse installatie alleen het kern-werkflow toont (Home + Kaart
 * + IFC); rapport-generatie, situatietekening en offertes-aanvraag
 * zijn taken die niet elke gebruiker nodig heeft, en de extra
 * tabs/knoppen vervuilen anders de ribbon voor wie ze niet gebruikt.
 *
 * Persistentie via `@tauri-apps/plugin-store` (preferences.json).
 * Tussen componenten gesynchroniseerd via een window-event zodat een
 * toggle in Settings direct doorwerkt in de Ribbon zonder reload.
 */

import { useEffect, useState } from "react";
import { getSetting, setSetting } from "../store";

export type ExtensionId =
  | "tekening"
  | "offertes"
  | "calc.pile-bearing-capacity"
  | "calc.spread-foundation-drained"
  | "calc.spread-foundation-undrained"
  | "calc.laterally-loaded-pile"
  | "calc.sheet-pile-wall"
  | "calc.ground-anchor";

const SETTING_KEYS: Record<ExtensionId, string> = {
  tekening: "ext.tekening.enabled",
  offertes: "ext.offertes.enabled",
  "calc.pile-bearing-capacity": "ext.calc.pile-bearing-capacity.enabled",
  "calc.spread-foundation-drained": "ext.calc.spread-foundation-drained.enabled",
  "calc.spread-foundation-undrained": "ext.calc.spread-foundation-undrained.enabled",
  "calc.laterally-loaded-pile": "ext.calc.laterally-loaded-pile.enabled",
  "calc.sheet-pile-wall": "ext.calc.sheet-pile-wall.enabled",
  "calc.ground-anchor": "ext.calc.ground-anchor.enabled",
};

/** Default state: alles UIT (gebruiker-verzoek). Rapport is GEEN
 *  extensie — die tab is altijd zichtbaar omdat PDF-generatie tot
 *  de kern-workflow van de app behoort. */
const DEFAULTS: Record<ExtensionId, boolean> = {
  tekening: false,
  offertes: false,
  "calc.pile-bearing-capacity": false,
  "calc.spread-foundation-drained": false,
  "calc.spread-foundation-undrained": false,
  "calc.laterally-loaded-pile": false,
  "calc.sheet-pile-wall": false,
  "calc.ground-anchor": false,
};

/** Extensies die nog NIET productie-gereed zijn. Deze blijven altijd
 *  uit voor de eindgebruiker — toggle is gedeactiveerd in de
 *  ExtensionManagerPanel, en zelfs als de preference per ongeluk op
 *  `true` staat, retourneert `useExtension()` `false`.
 *
 *  Voor dev-/test-doeleinden: zet in de browser-DevTools console
 *    `localStorage.setItem("ogs.dev.unlockExperimentalExtensions", "true")`
 *  en herlaad de app. Dan worden de toggles weer aanzetbaar. */
export const NOT_PRODUCTION_READY: ReadonlySet<ExtensionId> = new Set<ExtensionId>([
  "calc.pile-bearing-capacity",
  "calc.spread-foundation-drained",
  "calc.spread-foundation-undrained",
  "calc.laterally-loaded-pile",
  "calc.sheet-pile-wall",
  "calc.ground-anchor",
]);

function devUnlockActive(): boolean {
  try {
    return localStorage.getItem("ogs.dev.unlockExperimentalExtensions") === "true";
  } catch {
    return false;
  }
}

/** True als de extension nu daadwerkelijk aanzetbaar is (= production-
 *  ready, of dev-unlock actief). */
export function isExtensionSelectable(id: ExtensionId): boolean {
  if (!NOT_PRODUCTION_READY.has(id)) return true;
  return devUnlockActive();
}

const EVENT_NAME = "ogs:extensions-changed";

interface ChangePayload {
  id: ExtensionId;
  enabled: boolean;
}

/** Reactive hook — geeft live de aan/uit-staat van één extensie.
 *  Voor not-production-ready extensies returnt deze altijd `false`
 *  (tenzij de dev-unlock localStorage-flag aan staat). */
export function useExtension(id: ExtensionId): boolean {
  const [enabled, setEnabled] = useState<boolean>(DEFAULTS[id]);

  useEffect(() => {
    let cancelled = false;
    getSetting(SETTING_KEYS[id], DEFAULTS[id]).then((v) => {
      if (!cancelled) setEnabled(Boolean(v));
    });
    const onChange = (e: Event) => {
      const ce = e as CustomEvent<ChangePayload>;
      if (ce.detail?.id === id) setEnabled(Boolean(ce.detail.enabled));
    };
    window.addEventListener(EVENT_NAME, onChange as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener(EVENT_NAME, onChange as EventListener);
    };
  }, [id]);

  // Hard-disable not-production-ready extensies. De stored preference
  // wordt genegeerd zodat een per-ongeluk geactiveerde toggle (bv. uit
  // een geïmporteerde preferences.json) geen onbedoelde UI-tab activeert.
  if (!isExtensionSelectable(id)) return false;
  return enabled;
}

/** Reactive hook — geeft de aan/uit-staat van ÁLLE extensies in één
 *  Record, handig voor de Settings-dialog om alle toggles tegelijk
 *  te tonen. */
export function useAllExtensions(): Record<ExtensionId, boolean> {
  const [all, setAll] = useState<Record<ExtensionId, boolean>>(DEFAULTS);

  useEffect(() => {
    let cancelled = false;
    const ids: ExtensionId[] = [
      "tekening",
      "offertes",
      "calc.pile-bearing-capacity",
      "calc.spread-foundation-drained",
      "calc.spread-foundation-undrained",
      "calc.laterally-loaded-pile",
      "calc.sheet-pile-wall",
      "calc.ground-anchor",
    ];
    Promise.all(
      ids.map(async (id) => [id, await getSetting(SETTING_KEYS[id], DEFAULTS[id])] as const),
    ).then((entries) => {
      if (cancelled) return;
      const next = { ...DEFAULTS };
      for (const [id, v] of entries) {
        // Hard-disable not-production-ready extensies (zie isExtensionSelectable).
        next[id] = isExtensionSelectable(id) ? Boolean(v) : false;
      }
      setAll(next);
    });
    const onChange = (e: Event) => {
      const ce = e as CustomEvent<ChangePayload>;
      if (!ce.detail) return;
      setAll((prev) => ({ ...prev, [ce.detail.id]: Boolean(ce.detail.enabled) }));
    };
    window.addEventListener(EVENT_NAME, onChange as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener(EVENT_NAME, onChange as EventListener);
    };
  }, []);

  return all;
}

/** Schrijf nieuwe waarde naar preferences + broadcast aan luisteraars.
 *  Voor not-production-ready extensies wordt het verzoek genegeerd
 *  (tenzij dev-unlock actief is) — wij willen niet dat ze onbedoeld
 *  via een config-tool aangezet kunnen worden. */
export async function setExtension(id: ExtensionId, enabled: boolean): Promise<void> {
  if (enabled && !isExtensionSelectable(id)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[useExtensions] poging om '${id}' aan te zetten genegeerd — extensie is nog niet productie-gereed.`,
    );
    return;
  }
  await setSetting(SETTING_KEYS[id], enabled);
  window.dispatchEvent(
    new CustomEvent<ChangePayload>(EVENT_NAME, { detail: { id, enabled } }),
  );
}
