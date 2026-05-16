//! CPT file open + parse commands.

use tauri::State;
use cpt_core::{detect_layers as core_detect_layers, parse_auto, write, Cpt, Layer};
use crate::state::AppState;

#[tauri::command]
pub fn open_cpt(content: String, filename: String, state: State<'_, AppState>) -> Result<Cpt, String> {
    let lower = filename.to_lowercase();
    let mut cpt = if lower.ends_with(".ifcgeo") {
        // Per-CPT JSON snapshot — internal format, not a parser-discovery candidate.
        write::read_ifcgeo(&content).map_err(|e| e.to_string())?
    } else {
        parse_auto(&content).map_err(|e| e.to_string())?
    };
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

#[tauri::command]
pub fn detect_layers(id: String, state: State<'_, AppState>) -> Result<Vec<Layer>, String> {
    let cpts = state.cpts.lock().unwrap();
    let cpt = cpts.get(&id).ok_or_else(|| format!("unknown CPT id: {id}"))?;
    Ok(core_detect_layers(cpt))
}

/// Export the CPT identified by `cpt_id` to disk in `format` ("gef" |
/// "bro" | "ifcgeo"). Path is the absolute target path — the caller
/// (TS code via @tauri-apps/plugin-dialog) is responsible for picking it.
#[tauri::command]
pub fn save_cpt_as(
    cpt_id: String,
    format: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let cpts = state.cpts.lock().unwrap();
    let cpt = cpts
        .get(&cpt_id)
        .ok_or_else(|| format!("unknown CPT id: {cpt_id}"))?;
    let text = match format.as_str() {
        "gef" => write::write_gef(cpt),
        "bro" | "xml" => write::write_bro_xml(cpt),
        "ifcgeo" => write::write_ifcgeo(cpt).map_err(|e| e.to_string())?,
        other => return Err(format!("unsupported format: {other}")),
    };
    std::fs::write(&path, text).map_err(|e| format!("write {path}: {e}"))
}
