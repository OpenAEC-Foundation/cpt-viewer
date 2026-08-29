//! CPT file open + parse commands.
//!
//! Elke functie bestaat in twee varianten:
//!   - `*_core(...&AppState)` — pure-Rust functie die zowel vanuit een
//!     Tauri-command-wrapper als vanuit de MCP-server kan worden aangeroepen
//!   - `#[tauri::command] *_cmd(...State<'_, AppState>)` — dunne wrapper
//!     die `state.inner()` doorgeeft aan `*_core`
//!
//! Dit pattern voorkomt duplicatie tussen GUI- en MCP-modes: één
//! implementatie, twee aanroep-vormen.

use tauri::State;
use cpt_core::{write, Cpt, Layer};
use open_geotechniek_kernel::{DuplicatePolicy, GeotechnicalProject, ProjectMetadata};
use crate::state::AppState;

// ─── Core implementations (state als &AppState) ────────────────────

pub fn open_cpt_core(content: &str, filename: &str, state: &AppState) -> Result<Cpt, String> {
    let mut incoming = GeotechnicalProject::new(ProjectMetadata::default());
    let cpt = incoming
        .import_cpt(content, filename)
        .map_err(|error| error.to_string())?;
    state.with_project_mut(|project| {
        project.merge_from(incoming, DuplicatePolicy::Replace)?;
        Ok(())
    })?;
    Ok(cpt)
}

pub fn close_cpt_core(id: &str, state: &AppState) -> Result<(), String> {
    state.with_project_mut(|project| match project.remove(id) {
        Ok(_) | Err(open_geotechniek_kernel::KernelError::ObjectNotFound { .. }) => Ok(()),
        Err(error) => Err(error),
    })
}

pub fn list_cpts_core(state: &AppState) -> Vec<Cpt> {
    state
        .with_project(|project| project.cpts().cloned().collect())
        .unwrap_or_default()
}

pub fn detect_layers_core(id: &str, state: &AppState) -> Result<Vec<Layer>, String> {
    state
        .with_project(|project| project.detect_cpt_layers(id))?
        .map_err(|error| error.to_string())
}

/// Export the CPT identified by `cpt_id` to disk in `format` ("gef" |
/// "bro" | "ifcgeo"). Path is the absolute target path.
pub fn save_cpt_as_core(
    cpt_id: &str,
    format: &str,
    path: &str,
    state: &AppState,
) -> Result<(), String> {
    let cpt = state
        .with_project(|project| project.cpts().find(|cpt| cpt.id == cpt_id).cloned())?
        .ok_or_else(|| format!("unknown CPT id: {cpt_id}"))?;
    let text = match format {
        "gef" => write::write_gef(&cpt),
        "bro" | "xml" => write::write_bro_xml(&cpt),
        "ifcgeo" => write::write_ifcgeo(&cpt).map_err(|e| e.to_string())?,
        other => return Err(format!("unsupported format: {other}")),
    };
    std::fs::write(path, text).map_err(|e| format!("write {path}: {e}"))
}

// ─── Tauri command wrappers ────────────────────────────────────────

#[tauri::command]
pub fn open_cpt(content: String, filename: String, state: State<'_, AppState>) -> Result<Cpt, String> {
    open_cpt_core(&content, &filename, state.inner())
}

#[tauri::command]
pub fn close_cpt(id: String, state: State<'_, AppState>) -> Result<(), String> {
    close_cpt_core(&id, state.inner())
}

#[tauri::command]
pub fn list_cpts(state: State<'_, AppState>) -> Vec<Cpt> {
    list_cpts_core(state.inner())
}

#[tauri::command]
pub fn detect_layers(id: String, state: State<'_, AppState>) -> Result<Vec<Layer>, String> {
    detect_layers_core(&id, state.inner())
}

/// Tauri-wrapper. De caller (TS code via @tauri-apps/plugin-dialog) is
/// verantwoordelijk voor het kiezen van het target-pad.
#[tauri::command]
pub fn save_cpt_as(
    cpt_id: String,
    format: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    save_cpt_as_core(&cpt_id, &format, &path, state.inner())
}
