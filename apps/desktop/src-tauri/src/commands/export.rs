//! Export commands: CSV per CPT, GeoJSON for multiple CPTs.
//!
//! Beide functies hebben een `*_core` variant voor gedeeld gebruik door
//! GUI (via `tauri::command`) en MCP-server (via `&AppState`).

use tauri::State;
use crate::state::AppState;

// ─── Core implementations ──────────────────────────────────────────

/// CSV-inhoud voor één CPT als string — gedeeld door de bestand-export
/// (Tauri) en de REST-API (inline response).
pub fn csv_string_core(cpt_id: &str, state: &AppState) -> Result<String, String> {
    let cpts = state.cpts.lock().unwrap();
    let cpt = cpts.get(cpt_id).ok_or_else(|| format!("unknown CPT id: {cpt_id}"))?;
    let mut s = String::new();
    s.push_str("depth,depth_nap,qc,fs,rf,u2,inclination\n");
    for p in &cpt.points {
        s.push_str(&format!(
            "{},{},{},{},{},{},{}\n",
            p.depth,
            p.depth_nap.map(|v| v.to_string()).unwrap_or_default(),
            p.qc.map(|v| v.to_string()).unwrap_or_default(),
            p.fs.map(|v| v.to_string()).unwrap_or_default(),
            p.rf.map(|v| v.to_string()).unwrap_or_default(),
            p.u2.map(|v| v.to_string()).unwrap_or_default(),
            p.inclination.map(|v| v.to_string()).unwrap_or_default(),
        ));
    }
    Ok(s)
}

pub fn export_csv_core(cpt_id: &str, path: &str, state: &AppState) -> Result<(), String> {
    let s = csv_string_core(cpt_id, state)?;
    std::fs::write(path, s).map_err(|e| e.to_string())
}

/// GeoJSON FeatureCollection voor de opgegeven CPT's — gedeeld door de
/// bestand-export (Tauri) en de REST-API (inline response).
pub fn geojson_value_core(
    cpt_ids: &[String],
    state: &AppState,
) -> Result<serde_json::Value, String> {
    use serde_json::{json, Value};
    let cpts = state.cpts.lock().unwrap();
    let mut features: Vec<Value> = Vec::new();
    for id in cpt_ids {
        let Some(cpt) = cpts.get(id) else { continue };
        if let Some(pos) = cpt.position {
            let (lat, lon) = cpt_core::coords::rd_to_wgs84(pos.x_rd, pos.y_rd);
            let max_depth = cpt.points.iter().map(|p| p.depth).fold(0.0_f64, f64::max);
            features.push(json!({
                "type": "Feature",
                "properties": {
                    "id": cpt.id,
                    "z_nap": pos.z_nap,
                    "max_depth": max_depth,
                    "date": cpt.metadata.date,
                    "source_file": cpt.metadata.source_file,
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [lon, lat]
                }
            }));
        }
    }
    Ok(json!({ "type": "FeatureCollection", "features": features }))
}

pub fn export_geojson_core(
    cpt_ids: &[String],
    path: &str,
    state: &AppState,
) -> Result<(), String> {
    let fc = geojson_value_core(cpt_ids, state)?;
    std::fs::write(path, serde_json::to_string_pretty(&fc).unwrap()).map_err(|e| e.to_string())
}

// ─── Tauri command wrappers ────────────────────────────────────────

#[tauri::command]
pub fn export_csv(cpt_id: String, path: String, state: State<'_, AppState>) -> Result<(), String> {
    export_csv_core(&cpt_id, &path, state.inner())
}

#[tauri::command]
pub fn export_geojson(
    cpt_ids: Vec<String>,
    path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    export_geojson_core(&cpt_ids, &path, state.inner())
}
