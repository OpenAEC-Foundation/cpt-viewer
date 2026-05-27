//! Shared application state for Tauri commands.

use std::collections::HashMap;
use std::sync::Mutex;
use cpt_core::Cpt;

#[derive(Default)]
pub struct AppState {
    pub cpts: Mutex<HashMap<String, Cpt>>,
    /// Extension toggle-state, key = ExtensionId-string (zelfde IDs als
    /// in apps/desktop/src/hooks/useExtensions.ts). Default leeg; bij
    /// `extensions_list` worden onbekende ids als "false" gerapporteerd
    /// (matcht het frontend-default-uit gedrag). Wordt op dit moment
    /// NIET gesynced met de tauri-plugin-store preferences.json die de
    /// GUI gebruikt — sync is een vervolg-feature.
    pub extensions: Mutex<HashMap<String, bool>>,
}
