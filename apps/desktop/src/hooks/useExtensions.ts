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
import { CALC_REGISTRY } from "../calc/framework/registry";

/** Calc-extensie-ids waarvan de module daadwerkelijk in het register zit.
 *  In de publieke webbuild filtert registry.ts de niet-productie-gerede
 *  modules eruit (status !== "available"), waardoor hun extensie hier
 *  automatisch niet-selecteerbaar wordt — óók als een browser nog een
 *  opgeslagen `…enabled=true`-voorkeur heeft. Zo verschijnt de
 *  Berekeningen-tab niet op de live site voor niet-vrijgegeven modules. */
const REGISTERED_CALC_IDS: ReadonlySet<string> = new Set(
  CALC_REGISTRY.map((m) => `calc.${m.id}`),
);

export type ExtensionId =
  | "tekening"
  | "offertes"
  | "calc.pile-bearing-capacity"
  | "calc.kalendering"
  | "calc.spread-foundation-drained"
  | "calc.spread-foundation-undrained"
  | "calc.laterally-loaded-pile"
  | "calc.sheet-pile-wall"
  | "calc.ground-anchor";

const SETTING_KEYS: Record<ExtensionId, string> = {
  tekening: "ext.tekening.enabled",
  offertes: "ext.offertes.enabled",
  "calc.pile-bearing-capacity": "ext.calc.pile-bearing-capacity.enabled",
  "calc.kalendering": "ext.calc.kalendering.enabled",
  "calc.spread-foundation-drained": "ext.calc.spread-foundation-drained.enabled",
  "calc.spread-foundation-undrained": "ext.calc.spread-foundation-undrained.enabled",
  "calc.laterally-loaded-pile": "ext.calc.laterally-loaded-pile.enabled",
  "calc.sheet-pile-wall": "ext.calc.sheet-pile-wall.enabled",
  "calc.ground-anchor": "ext.calc.ground-anchor.enabled",
};

/** Default state: alles UIT, behalve `calc.pile-bearing-capacity` die
 *  in actieve ontwikkeling is en daarom standaard AAN staat (zodat de
 *  Berekeningen-tab direct verschijnt voor verdere uitwerking). De
 *  prominente tussenstand-banner + ALPHA-badge blijven zichtbaar als
 *  herinnering dat de getallen nog NIET productie-geverifieerd zijn. */
const DEFAULTS: Record<ExtensionId, boolean> = {
  // Situatietekening is een kernfunctie geworden — standaard AAN zodat de
  // tab direct zichtbaar is, óók op de live webversie. Uitzetten kan nog
  // steeds via Instellingen → Extensies.
  tekening: true,
  offertes: false,
  "calc.pile-bearing-capacity": true,
  // `calc.kalendering` staat default AAN — module is in actieve ontwikkeling
  // en moet direct zichtbaar zijn naast de Funderingspaal-module zodat de
  // engineer beide rekenbladen in dezelfde sessie kan gebruiken. Status
  // 'experimental' op de module zelf zorgt voor de prominente tussenstand-
  // banner.
  "calc.kalendering": true,
  "calc.spread-foundation-drained": false,
  "calc.spread-foundation-undrained": false,
  "calc.laterally-loaded-pile": false,
  "calc.sheet-pile-wall": false,
  "calc.ground-anchor": false,
};

/** Extensies die nog NIET productie-gereed zijn EN ook niet via de UI
 *  aanzetbaar mogen zijn voor eindgebruikers. Deze blijven altijd uit —
 *  toggle is gedeactiveerd in de ExtensionManagerPanel, en zelfs als de
 *  preference per ongeluk op `true` staat, retourneert `useExtension()`
 *  `false`.
 *
 *  `calc.pile-bearing-capacity` zit hier BEWUST NIET in: die module is
 *  in actieve ontwikkeling en moet voor de developer aanzetbaar zijn.
 *  Status 'experimental' op de module zelf zorgt voor de prominente
 *  tussenstand-banner in CalculationsView en de ALPHA-badge in de
 *  NewCalculationDialog.
 *
 *  Voor dev-/test-doeleinden van de OVERIGE calc-modules: zet in de
 *  browser-DevTools console
 *    `localStorage.setItem("ogs.dev.unlockExperimentalExtensions", "true")`
 *  en herlaad de app. Dan worden alle toggles weer aanzetbaar. */
export const NOT_PRODUCTION_READY: ReadonlySet<ExtensionId> = new Set<ExtensionId>([
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
  // Calc-extensie zonder geregistreerde module → nooit selecteerbaar.
  // Dit is de poort die de publieke webbuild dichthoudt: registry.ts
  // laat daar alleen status="available"-modules toe, dus experimentele
  // calc-extensies vallen hier af, ongeacht een opgeslagen voorkeur.
  if (id.startsWith("calc.") && !REGISTERED_CALC_IDS.has(id)) return false;
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
      "calc.kalendering",
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
