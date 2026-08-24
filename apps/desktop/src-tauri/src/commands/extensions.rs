//! Extension toggle-state commands.
//!
//! Bedient via MCP de aan/uit-state van optionele app-modules
//! (Tekening, Offertes, calc-modules etc.). De canonieke lijst van
//! known IDs spiegelt `apps/desktop/src/hooks/useExtensions.ts`.
//!
//! BELANGRIJK — DEZE STATE IS MCP-LOKAAL: hij wordt niet (nog) gesynced
//! met de tauri-plugin-store preferences.json die de GUI gebruikt.
//! Cross-mode sync vereist OF een file-watcher op preferences.json, OF
//! een gedeeld store-backend. Voor nu is dit een MCP-only mirror.

use std::collections::HashMap;
use crate::state::AppState;

/// Canonieke lijst van bekende extension-IDs (mirror van het frontend-
/// type `ExtensionId` in useExtensions.ts). `extensions_list` gebruikt
/// dit om ALTIJD alle bekende IDs terug te geven, ook als ze nog niet
/// expliciet zijn gezet — anders zou een fresh MCP-sessie een lege lijst
/// teruggeven en zou de gebruiker niet weten welke IDs er beschikbaar zijn.
pub const KNOWN_EXTENSION_IDS: &[&str] = &[
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

#[derive(serde::Serialize)]
pub struct ExtensionStateEntry {
    pub id: String,
    pub enabled: bool,
    /// True als de ID één van de hard-coded known-IDs is. False voor
    /// onbekende IDs die alleen via expliciete `extension_set`
    /// aanwezig zijn (bv. plugins, custom toggles).
    pub known: bool,
}

pub fn extensions_list_core(state: &AppState) -> Vec<ExtensionStateEntry> {
    let stored = state.extensions.lock().unwrap();
    let mut out: Vec<ExtensionStateEntry> = KNOWN_EXTENSION_IDS
        .iter()
        .map(|id| ExtensionStateEntry {
            id: (*id).to_string(),
            enabled: *stored.get(*id).unwrap_or(&false),
            known: true,
        })
        .collect();
    // Plus eventuele onbekende custom-ids die via extension_set zijn ingesteld.
    for (id, enabled) in stored.iter() {
        if !KNOWN_EXTENSION_IDS.contains(&id.as_str()) {
            out.push(ExtensionStateEntry {
                id: id.clone(),
                enabled: *enabled,
                known: false,
            });
        }
    }
    out
}

pub fn extension_set_core(id: &str, enabled: bool, state: &AppState) -> Result<(), String> {
    if id.is_empty() {
        return Err("extension id mag niet leeg zijn".into());
    }
    state.extensions.lock().unwrap().insert(id.to_string(), enabled);
    Ok(())
}

pub fn extensions_reset_defaults_core(state: &AppState) {
    // Default = alles uit (zelfde gedrag als de frontend bij first-run).
    let mut stored = state.extensions.lock().unwrap();
    stored.clear();
    for id in KNOWN_EXTENSION_IDS {
        stored.insert((*id).to_string(), false);
    }
}

/// Bulk-import vanuit een payload van `{ id: bool }` zoals de frontend-
/// store ze houdt. Handig om bv. de GUI-state te kopiëren naar de MCP-state
/// via één enkele call.
pub fn extensions_set_bulk_core(payload: HashMap<String, bool>, state: &AppState) {
    let mut stored = state.extensions.lock().unwrap();
    for (id, enabled) in payload {
        stored.insert(id, enabled);
    }
}
