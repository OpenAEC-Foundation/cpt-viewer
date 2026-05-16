//! Project save / open commands using the `.ifcgis` JSON container.

use std::path::PathBuf;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use tauri::State;

use cpt_core::{Cpt, ifcgis};

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

/// Save the current AppState (project meta + loaded CPTs) to `path` as `.ifcgis`.
/// Project metadata comes from the frontend (Zustand store) — the Rust side only
/// owns the CPTs, not the project meta.
#[tauri::command]
pub fn save_project_ifcgis(
    project: ProjectMetaInput,
    path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let cpts: Vec<Cpt> = state.cpts.lock().unwrap().values().cloned().collect();
    let info = ifcgis::ProjectInfo {
        kind: "OpenGeoProject".into(),
        title: project.title,
        client: project.client,
        location: project.location,
        project_number: project.project_number,
        author: project.author,
        date: parse_date(&project.date),
    };
    let text = ifcgis::save(info, cpts).map_err(|e| e.to_string())?;
    std::fs::write(PathBuf::from(path), text).map_err(|e| e.to_string())
}

/// Open a `.ifcgis` file: parse, MERGE the file's CPTs into AppState's CPT
/// cache (additive — does NOT clear), and return both the project metadata
/// and the CPTs so the frontend can update its store in one round-trip.
///
/// Rust state is a flat cache of every CPT ever loaded across all open
/// document tabs (project tabs + standalone cpt tabs). Document boundaries
/// live on the frontend; the Rust side only needs to look up CPTs by id
/// when generating reports / exports.
#[tauri::command]
pub fn open_project_ifcgis(
    path: String,
    state: State<'_, AppState>,
) -> Result<ProjectOpenResult, String> {
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let file = ifcgis::load(&text).map_err(|e| e.to_string())?;

    // Merge state's CPT map (additive).
    let mut cpts_map = state.cpts.lock().unwrap();
    for cpt in &file.cpts {
        cpts_map.insert(cpt.id.clone(), cpt.clone());
    }

    Ok(ProjectOpenResult {
        project: ProjectMetaInput {
            title: file.project.title,
            client: file.project.client,
            location: file.project.location,
            project_number: file.project.project_number,
            author: file.project.author,
            date: file.project.date.to_string(),
        },
        cpts: file.cpts,
    })
}
