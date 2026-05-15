//! Shared application state for Tauri commands.

use std::collections::HashMap;
use std::sync::Mutex;
use cpt_core::Cpt;

#[derive(Default)]
pub struct AppState {
    pub cpts: Mutex<HashMap<String, Cpt>>,
}
