import { load, type Store } from "@tauri-apps/plugin-store";
import { IS_TAURI } from "./utils/platform";

/**
 * App-wide key/value preferences store.
 *
 * - In Tauri: `@tauri-apps/plugin-store` schrijft naar
 *   `preferences.json` in de app-data dir. AutoSave is aan dus
 *   schrijven gebeurt direct.
 * - In browser (webdemo zonder Tauri-runtime): `localStorage` met
 *   prefix `ogs:`. Persistent per browser/profiel.
 *
 * Zonder browser-fallback bleef een setting (b.v. extensie aan/uit,
 * thema-keuze) in de webversie nooit hangen — `plugin-store.load()`
 * gooit dan een error en setSetting silently failed.
 */

let _store: Store | null = null;
const BROWSER_PREFIX = "ogs:";

async function getStore(): Promise<Store> {
  if (!_store) {
    _store = await load("preferences.json", { autoSave: true, defaults: {} });
  }
  return _store;
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  if (IS_TAURI) {
    try {
      const store = await getStore();
      const value = await store.get<T>(key);
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }
  // Browser fallback — localStorage met prefix.
  try {
    const raw = window.localStorage.getItem(BROWSER_PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  if (IS_TAURI) {
    try {
      const store = await getStore();
      await store.set(key, value);
    } catch {
      // silently fail if store unavailable
    }
    return;
  }
  try {
    window.localStorage.setItem(BROWSER_PREFIX + key, JSON.stringify(value));
  } catch {
    // QuotaExceeded of disabled storage — geen blocker, gewoon negeren.
  }
}
