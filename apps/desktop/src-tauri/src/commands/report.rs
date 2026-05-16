//! PDF report generation.
//!
//! `preview_report` returns PDF bytes in-memory (for iframe preview);
//! `generate_report` writes the bytes to disk.

use std::path::PathBuf;
use serde::Deserialize;
use tauri::State;
use chrono::NaiveDate;
use cpt_core::{build_report, generate_single_cpt_pdf_bytes, ProjectMeta};
use openaec_core::generate_pdf_bytes;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct ProjectMetaInput {
    pub title: String,
    pub client: String,
    pub location: String,
    pub project_number: String,
    pub author: String,
    pub date: String, // ISO 8601 YYYY-MM-DD
}

impl From<ProjectMetaInput> for ProjectMeta {
    fn from(p: ProjectMetaInput) -> Self {
        let date = NaiveDate::parse_from_str(&p.date, "%Y-%m-%d")
            .unwrap_or_else(|_| chrono::Local::now().date_naive());
        ProjectMeta {
            title: p.title,
            client: p.client,
            location: p.location,
            project_number: p.project_number,
            author: p.author,
            date,
        }
    }
}

#[tauri::command]
pub fn preview_report(
    cpt_ids: Vec<String>,
    project: ProjectMetaInput,
    state: State<'_, AppState>,
) -> Result<Vec<u8>, String> {
    let cpts: Vec<_> = {
        let cpts_map = state.cpts.lock().unwrap();
        cpt_ids
            .iter()
            .filter_map(|id| cpts_map.get(id).cloned())
            .collect()
    };
    let meta: ProjectMeta = project.into();

    // Single-CPT projects use the direct printpdf path which produces the
    // Dutch-convention full-bleed A4 chart matching the reference plot.
    // Multi-CPT projects go through openaec-engine (cover + coordinate
    // table + per-CPT pages) until the multi-CPT renderer is consolidated.
    if cpts.len() == 1 {
        // `generate_single_cpt_pdf_bytes` returns `Vec<u8>` directly (no Result).
        return Ok(generate_single_cpt_pdf_bytes(&cpts[0], &meta));
    }

    let report = build_report(&cpts, &meta);
    generate_pdf_bytes(&report).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn generate_report(
    cpt_ids: Vec<String>,
    project: ProjectMetaInput,
    output_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let bytes = preview_report(cpt_ids, project, state)?;
    std::fs::write(PathBuf::from(output_path), bytes).map_err(|e| e.to_string())
}
