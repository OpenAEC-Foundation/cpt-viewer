//! CPT file open + parse commands.

use tauri::State;
use cpt_core::{parse_auto, Cpt};
use crate::state::AppState;

#[tauri::command]
pub fn open_cpt(content: String, filename: String, state: State<'_, AppState>) -> Result<Cpt, String> {
    let mut cpt = parse_auto(&content).map_err(|e| e.to_string())?;
    cpt.metadata.source_file = filename;
    state.cpts.lock().unwrap().insert(cpt.id.clone(), cpt.clone());
    Ok(cpt)
}

#[tauri::command]
pub fn close_cpt(id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.cpts.lock().unwrap().remove(&id);
    Ok(())
}

#[tauri::command]
pub fn list_cpts(state: State<'_, AppState>) -> Vec<Cpt> {
    state.cpts.lock().unwrap().values().cloned().collect()
}
