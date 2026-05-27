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

// ─── Core implementations ──────────────────────────────────────────

/// Genereer een PDF-rapport voor PRE-SNAPSHOTTED cpts (de caller zorgt zelf
/// voor de AppState-lock + clone). Direct aanroepbaar door zowel de Tauri-
/// command-wrapper als de MCP-server. Heavy rendering loopt via
/// `tokio::task::spawn_blocking` zodat het runtime threadpool gerespecteerd
/// blijft (Tauri-runtime in GUI-mode, eigen tokio runtime in MCP-mode).
pub async fn preview_report_core(
    cpts: Vec<cpt_core::Cpt>,
    project: ProjectMetaInput,
) -> Result<Vec<u8>, String> {
    let meta: ProjectMeta = project.into();
    tokio::task::spawn_blocking(move || -> Result<Vec<u8>, String> {
        if cpts.len() == 1 {
            return Ok(generate_single_cpt_pdf_bytes(&cpts[0], &meta));
        }
        let report = build_report(&cpts, &meta);
        generate_pdf_bytes(&report).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("spawn_blocking join failed: {e}"))?
}

pub async fn generate_report_core(
    cpts: Vec<cpt_core::Cpt>,
    project: ProjectMetaInput,
    output_path: String,
) -> Result<(), String> {
    let bytes = preview_report_core(cpts, project).await?;
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        std::fs::write(PathBuf::from(output_path), bytes).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("spawn_blocking join failed: {e}"))?
}

// ─── Tauri command wrappers ────────────────────────────────────────

/// `preview_report` is `async` and the heavy printpdf work runs on
/// `spawn_blocking` so it never stalls Tauri's async runtime. Opening
/// multiple sonderingen in quick succession now interleaves with UI
/// commands instead of queuing on the single command thread.
#[tauri::command]
pub async fn preview_report(
    cpt_ids: Vec<String>,
    project: ProjectMetaInput,
    state: State<'_, AppState>,
) -> Result<Vec<u8>, String> {
    // Snapshot the CPTs while we still hold the lock — release before
    // we kick off the long-running render so other commands can read
    // the state in the meantime.
    let cpts: Vec<_> = {
        let cpts_map = state.cpts.lock().unwrap();
        cpt_ids
            .iter()
            .filter_map(|id| cpts_map.get(id).cloned())
            .collect()
    };
    preview_report_core(cpts, project).await
}

#[tauri::command]
pub async fn generate_report(
    cpt_ids: Vec<String>,
    project: ProjectMetaInput,
    output_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let cpts: Vec<_> = {
        let cpts_map = state.cpts.lock().unwrap();
        cpt_ids
            .iter()
            .filter_map(|id| cpts_map.get(id).cloned())
            .collect()
    };
    generate_report_core(cpts, project, output_path).await
}
