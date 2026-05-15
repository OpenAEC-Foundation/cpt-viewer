//! Export commands: CSV per CPT, GeoJSON for multiple CPTs.

use tauri::State;
use crate::state::AppState;

#[tauri::command]
pub fn export_csv(cpt_id: String, path: String, state: State<'_, AppState>) -> Result<(), String> {
    let cpts = state.cpts.lock().unwrap();
    let cpt = cpts.get(&cpt_id).ok_or_else(|| format!("unknown CPT id: {cpt_id}"))?;
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
    std::fs::write(path, s).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_geojson(cpt_ids: Vec<String>, path: String, state: State<'_, AppState>) -> Result<(), String> {
    use serde_json::{json, Value};
    let cpts = state.cpts.lock().unwrap();
    let mut features: Vec<Value> = Vec::new();
    for id in &cpt_ids {
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
    let fc = json!({ "type": "FeatureCollection", "features": features });
    std::fs::write(path, serde_json::to_string_pretty(&fc).unwrap()).map_err(|e| e.to_string())
}
