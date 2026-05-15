//! PDOK BRO API proxy commands.
//!
//! BRO (Basisregistratie Ondergrond) exposes CPT data via a public API at
//! https://publiek.broservices.nl. We hit it from Rust to avoid browser CORS,
//! then return JSON-friendly results to React.

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[allow(dead_code)] // fields used once the real BRO search is wired in (v2)
pub struct BBox {
    pub min_lat: f64,
    pub min_lon: f64,
    pub max_lat: f64,
    pub max_lon: f64,
}

#[derive(Debug, Serialize)]
pub struct BroFeature {
    pub id: String,
    pub lat: f64,
    pub lon: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub depth: Option<f64>,
}

#[tauri::command]
pub async fn fetch_bro_area(_bbox: BBox) -> Result<Vec<BroFeature>, String> {
    // BRO characteristics-searches POST endpoint returns GeoJSON-like results.
    // Real implementation requires constructing the BRO XML/JSON request body
    // for the characteristics search service:
    //   POST https://publiek.broservices.nl/sr/cpt/v1/characteristics/searches
    //   with body: { "criteria": { "registrationPeriod": {...}, "area": { "boundingBox": {...} } } }
    //
    // Returning an empty list for v1. The map UI still works (markers can be
    // cleared, status shows "0 sonderingen geladen"). Full implementation is
    // deferred until the request format is finalized with the BRO team.
    Ok(Vec::new())
}

#[tauri::command]
pub async fn fetch_bro_cpt(bro_id: String) -> Result<String, String> {
    let url = format!("https://publiek.broservices.nl/sr/cpt/v1/objects/{}", bro_id);
    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("BRO API HTTP {}", resp.status()));
    }
    resp.text().await.map_err(|e| e.to_string())
}
