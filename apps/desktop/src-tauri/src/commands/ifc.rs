//! IFC export commands.
//!
//! Two formats are supported:
//! - `ifc4x3` — a STEP-format IFC4x3 *placeholder* skeleton with one
//!   `IfcBuildingElementProxy` per CPT and the measurement points
//!   exposed as IfcPropertyListValue entries.
//! - `ifcx` — an IFCX-flavoured JSON document (schema `ifcx-cpt-0.1`).
//!
//! Both writers live in `cpt_core::ifc`; this module only deals with
//! routing the request through the Tauri bridge, persisting the result
//! to a per-session cache directory (so a future "load latest" / "open
//! in Bonsai" hand-off is one click away), and listing what's in the
//! cache for the IfcView panel.

use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::State;

use cpt_core::{ifc as core_ifc, Cpt, ProjectMeta};

use crate::state::AppState;

// ───────────────────────────────────────────────────────────────────
// Public types
// ───────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ProjectMetaInput {
    #[serde(default)]
    pub id: Option<String>,
    pub title: String,
    #[serde(default)]
    pub client: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub project_number: String,
    #[serde(default)]
    pub author: String,
    /// ISO 8601 (`YYYY-MM-DD`).
    pub date: String,
}

impl ProjectMetaInput {
    fn into_meta(self) -> ProjectMeta {
        let date = NaiveDate::parse_from_str(&self.date, "%Y-%m-%d")
            .unwrap_or_else(|_| chrono::Local::now().date_naive());
        ProjectMeta {
            title: self.title,
            client: self.client,
            location: self.location,
            project_number: self.project_number,
            author: self.author,
            date,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct GeneratedIfcResult {
    pub filename: String,
    pub format: String,
    pub generated_at: String,
    pub byte_count: usize,
    pub full_path: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct GeneratedIfcEntry {
    pub filename: String,
    pub format: String,
    pub generated_at: String,
    pub byte_count: usize,
    pub full_path: String,
}

// ───────────────────────────────────────────────────────────────────
// Tauri commands
// ───────────────────────────────────────────────────────────────────

/// Generate an IFC document for the given project + CPTs and write it to
/// the per-session cache directory. Returns the generated text alongside
/// metadata so the renderer can show it immediately without a follow-up
/// `read_text_file` round-trip.
///
/// `format` must be `"ifc4x3"` or `"ifcx"`. Unknown formats are rejected.
#[tauri::command]
pub async fn generate_ifc(
    project: ProjectMetaInput,
    cpt_ids: Vec<String>,
    format: String,
    state: State<'_, AppState>,
) -> Result<GeneratedIfcResult, String> {
    let project_id = project.id.clone().unwrap_or_else(|| "default".into());
    let project_id_safe = sanitise_id(&project_id);

    // Snapshot the requested CPTs out of state quickly so we can release the
    // lock before doing any IFC work (the writers iterate over potentially
    // thousands of measurement points and we don't want to block other
    // commands while that happens).
    let cpts: Vec<Cpt> = {
        let cache = state.cpts.lock().map_err(|e| e.to_string())?;
        cpt_ids
            .iter()
            .filter_map(|id| cache.get(id).cloned())
            .collect()
    };

    let meta = project.into_meta();

    // The writers themselves are CPU-bound; spin them off the async pool so
    // the UI stays responsive even on large projects. They never block on IO.
    let format_norm = format.to_lowercase();
    let (extension, content) = match format_norm.as_str() {
        "ifc4x3" | "ifc" => {
            let cpts_clone = cpts.clone();
            let meta_clone = meta.clone();
            let text = tauri::async_runtime::spawn_blocking(move || {
                core_ifc::write_ifc4x3(&cpts_clone, &meta_clone)
            })
            .await
            .map_err(|e| format!("ifc4x3 task: {e}"))?;
            ("ifc", text)
        }
        "ifcx" | "json" => {
            let cpts_clone = cpts.clone();
            let meta_clone = meta.clone();
            let text = tauri::async_runtime::spawn_blocking(move || {
                core_ifc::write_ifcx(&cpts_clone, &meta_clone)
            })
            .await
            .map_err(|e| format!("ifcx task: {e}"))?;
            ("ifcx.json", text)
        }
        other => return Err(format!("unsupported IFC format: {other}")),
    };

    let now = Utc::now();
    let timestamp = now.format("%Y%m%dT%H%M%S").to_string();
    let filename = format!("{}_{}.{}", timestamp, format_norm, extension);

    let dir = ifc_cache_dir(&project_id_safe)?;
    fs::create_dir_all(&dir).map_err(|e| format!("create cache dir: {e}"))?;
    let full_path = dir.join(&filename);
    fs::write(&full_path, &content).map_err(|e| format!("write IFC: {e}"))?;

    Ok(GeneratedIfcResult {
        filename,
        format: format_norm,
        generated_at: now.to_rfc3339(),
        byte_count: content.len(),
        full_path: full_path.to_string_lossy().to_string(),
        content,
    })
}

/// Enumerate IFC files previously generated for `project_id` (or the
/// default bucket, when no project is active). Sorted newest-first.
#[tauri::command]
pub async fn list_generated_ifc(project_id: Option<String>) -> Result<Vec<GeneratedIfcEntry>, String> {
    let id_safe = sanitise_id(project_id.as_deref().unwrap_or("default"));
    let dir = ifc_cache_dir(&id_safe)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut entries: Vec<GeneratedIfcEntry> = Vec::new();
    let read = fs::read_dir(&dir).map_err(|e| format!("read cache dir: {e}"))?;
    for entry in read.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let filename = match path.file_name().and_then(|s| s.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        let format = guess_format_from_filename(&filename).unwrap_or_else(|| "ifc4x3".into());
        let metadata = match fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let byte_count = metadata.len() as usize;
        let generated_at = metadata
            .modified()
            .ok()
            .and_then(|m| chrono::DateTime::<chrono::Utc>::from(m).to_rfc3339().into())
            .unwrap_or_else(|| Utc::now().to_rfc3339());
        entries.push(GeneratedIfcEntry {
            filename,
            format,
            generated_at,
            byte_count,
            full_path: path.to_string_lossy().to_string(),
        });
    }
    // Newest first.
    entries.sort_by(|a, b| b.generated_at.cmp(&a.generated_at));
    Ok(entries)
}

/// Read back a previously-generated IFC file. Used by the IfcView panel
/// when the user clicks an entry in the file list (we don't preload all
/// contents — they could be megabytes each).
#[tauri::command]
pub async fn read_generated_ifc(full_path: String) -> Result<String, String> {
    fs::read_to_string(&full_path).map_err(|e| format!("read IFC {full_path}: {e}"))
}

// ───────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────

fn ifc_cache_dir(project_id_safe: &str) -> Result<PathBuf, String> {
    let mut dir = std::env::temp_dir();
    dir.push("open-geotechniek-studio");
    dir.push("ifc");
    dir.push(project_id_safe);
    Ok(dir)
}

fn sanitise_id(id: &str) -> String {
    let mut out: String = id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    if out.is_empty() {
        out.push_str("default");
    }
    out
}

fn guess_format_from_filename(filename: &str) -> Option<String> {
    let lower = filename.to_lowercase();
    if lower.ends_with(".ifcx.json") || lower.ends_with(".ifcx") {
        Some("ifcx".into())
    } else if lower.ends_with(".ifc") {
        Some("ifc4x3".into())
    } else if lower.contains("_ifcx_") || lower.contains("_ifcx.") {
        Some("ifcx".into())
    } else if lower.contains("_ifc4x3_") || lower.contains("_ifc4x3.") {
        Some("ifc4x3".into())
    } else {
        None
    }
}

