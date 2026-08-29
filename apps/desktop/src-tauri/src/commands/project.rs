//! Project save / open commands using the `.ifcgis` JSON container.
//!
//! Elke functie bestaat in twee varianten (`*_core` voor Rust-aanroepers
//! incl. MCP, en `#[tauri::command]` als wrapper voor de frontend) zodat
//! GUI en MCP-server dezelfde implementatie delen.

use std::path::PathBuf;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use tauri::State;

use cpt_core::{Cpt, ifcgis};
use open_geotechniek_kernel::{
    DuplicatePolicy, GeotechnicalProject, ProjectMetadata,
};

use crate::state::AppState;

#[derive(Debug, Deserialize, Serialize)]
pub struct ProjectMetaInput {
    pub title: String,
    pub client: String,
    pub location: String,
    pub project_number: String,
    pub author: String,
    pub date: String, // ISO 8601
}

#[derive(Debug, Serialize)]
pub struct ProjectOpenResult {
    pub project: ProjectMetaInput,
    pub cpts: Vec<Cpt>,
}

fn parse_date(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .unwrap_or_else(|_| chrono::Local::now().date_naive())
}

// ─── Core implementations ──────────────────────────────────────────

pub fn save_project_ifcgis_core(
    project: ProjectMetaInput,
    path: &str,
    state: &AppState,
) -> Result<(), String> {
    let metadata = ProjectMetadata {
        title: project.title,
        client: project.client,
        location: project.location,
        project_number: project.project_number,
        author: project.author,
        date: Some(parse_date(&project.date)),
    };
    let text = state.with_project(|current| {
        let mut snapshot = current.clone();
        snapshot.set_metadata(metadata);
        snapshot.to_project_text()
    })?
    .map_err(|error| error.to_string())?;
    std::fs::write(PathBuf::from(path), text).map_err(|e| e.to_string())
}

pub fn open_project_ifcgis_core(path: &str, state: &AppState) -> Result<ProjectOpenResult, String> {
    let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let incoming = GeotechnicalProject::load_project_text(&text).map_err(|e| e.to_string())?;
    let metadata = incoming.metadata().clone();
    let cpts = incoming.cpts().cloned().collect();
    state.with_project_mut(|project| project.merge_from(incoming, DuplicatePolicy::Replace))?;

    Ok(ProjectOpenResult {
        project: ProjectMetaInput {
            title: metadata.title,
            client: metadata.client,
            location: metadata.location,
            project_number: metadata.project_number,
            author: metadata.author,
            date: metadata.date.map(|date| date.to_string()).unwrap_or_default(),
        },
        cpts,
    })
}

pub fn save_project_ifcgis_full_core(payload: serde_json::Value, path: &str) -> Result<(), String> {
    let file: ifcgis::ProjectFile = serde_json::from_value(payload)
        .map_err(|e| format!("invalid ifcgis payload: {e}"))?;
    let project = GeotechnicalProject::load_project_file(file).map_err(|e| e.to_string())?;
    let text = project.to_project_text().map_err(|e| e.to_string())?;
    std::fs::write(PathBuf::from(path), text).map_err(|e| e.to_string())
}

pub fn preview_project_ifcx_core(payload: serde_json::Value) -> Result<String, String> {
    let file: ifcgis::ProjectFile = serde_json::from_value(payload)
        .map_err(|e| format!("invalid ifcgis payload: {e}"))?;
    let project = GeotechnicalProject::load_project_file(file).map_err(|e| e.to_string())?;
    project.to_project_text().map_err(|e| e.to_string())
}

pub fn open_project_ifcgis_full_core(
    path: &str,
    state: &AppState,
) -> Result<serde_json::Value, String> {
    let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let incoming = GeotechnicalProject::load_project_text(&text).map_err(|e| e.to_string())?;
    let file = incoming.to_project_file().map_err(|e| e.to_string())?;
    state.with_project_mut(|project| project.merge_from(incoming, DuplicatePolicy::Replace))?;
    serde_json::to_value(&file).map_err(|e| format!("serialize for return: {e}"))
}

// ─── Tauri command wrappers ────────────────────────────────────────

/// Save the current AppState (project meta + loaded CPTs) to `path` as `.ifcgis`.
#[tauri::command]
pub fn save_project_ifcgis(
    project: ProjectMetaInput,
    path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    save_project_ifcgis_core(project, &path, state.inner())
}

/// Open a `.ifcgis` file: parse, MERGE the file's CPTs into AppState's CPT
/// cache (additive — does NOT clear), and return both the project metadata
/// and the CPTs so the frontend can update its store in one round-trip.
#[tauri::command]
pub fn open_project_ifcgis(
    path: String,
    state: State<'_, AppState>,
) -> Result<ProjectOpenResult, String> {
    open_project_ifcgis_core(&path, state.inner())
}

/// Full-fidelity save — frontend bouwt het complete ifcgis JSON payload
/// (inclusief bores, tekening-layout, title-block, crs, gis, deliverable).
#[tauri::command]
pub fn save_project_ifcgis_full(
    payload: serde_json::Value,
    path: String,
) -> Result<(), String> {
    save_project_ifcgis_full_core(payload, &path)
}

/// IFCX-preview: convert dezelfde payload als save naar de strict
/// IFCX-JSON representatie (IFC5 alpha) zonder naar schijf te schrijven.
#[tauri::command]
pub fn preview_project_ifcx(payload: serde_json::Value) -> Result<String, String> {
    preview_project_ifcx_core(payload)
}

/// Full-fidelity open — leest een `.ifcgis` van schijf, valideert tegen
/// het schema, mergeed de CPTs in de Rust-cache, en geeft het complete
/// JSON document terug aan de frontend.
#[tauri::command]
pub fn open_project_ifcgis_full(
    path: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    open_project_ifcgis_full_core(&path, state.inner())
}
