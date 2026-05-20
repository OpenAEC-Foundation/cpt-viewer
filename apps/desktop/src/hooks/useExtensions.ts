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

export type ExtensionId = "rapport" | "tekening" | "offertes";

const SETTING_KEYS: Record<ExtensionId, string> = {
  rapport: "ext.rapport.enabled",
  tekening: "ext.tekening.enabled",
  offertes: "ext.offertes.enabled",
};

/** Default state: alles UIT (gebruiker-verzoek). */
const DEFAULTS: Record<ExtensionId, boolean> = {
  rapport: false,
  tekening: false,
  offertes: false,
};

const EVENT_NAME = "ogs:extensions-changed";

interface ChangePayload {
  id: ExtensionId;
  enabled: boolean;
}

/** Reactive hook — geeft live de aan/uit-staat van één extensie. */
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

  return enabled;
}

/** Reactive hook — geeft de aan/uit-staat van ÁLLE extensies in één
 *  Record, handig voor de Settings-dialog om alle toggles tegelijk
 *  te tonen. */
export function useAllExtensions(): Record<ExtensionId, boolean> {
  const [all, setAll] = useState<Record<ExtensionId, boolean>>(DEFAULTS);

  useEffect(() => {
    let cancelled = false;
    const ids: ExtensionId[] = ["rapport", "tekening", "offertes"];
    Promise.all(
      ids.map(async (id) => [id, await getSetting(SETTING_KEYS[id], DEFAULTS[id])] as const),
    ).then((entries) => {
      if (cancelled) return;
      const next = { ...DEFAULTS };
      for (const [id, v] of entries) next[id] = Boolean(v);
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

/** Schrijf nieuwe waarde naar preferences + broadcast aan luisteraars. */
export async function setExtension(id: ExtensionId, enabled: boolean): Promise<void> {
  await setSetting(SETTING_KEYS[id], enabled);
  window.dispatchEvent(
    new CustomEvent<ChangePayload>(EVENT_NAME, { detail: { id, enabled } }),
  );
}
