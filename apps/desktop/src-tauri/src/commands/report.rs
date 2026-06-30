//! PDF report generation.
//!
//! `preview_report` returns PDF bytes in-memory (for iframe preview);
//! `generate_report` writes the bytes to disk.

use std::path::PathBuf;
use serde::Deserialize;
use tauri::State;
use chrono::NaiveDate;
use cpt_core::{
    build_with_sections, generate_single_cpt_pdf_bytes_with_sections, ProjectMeta, ReportSections,
};
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
    sections: Option<ReportSections>,
) -> Result<Vec<u8>, String> {
    let meta: ProjectMeta = project.into();
    let sec = sections.unwrap_or_default();
    // Basiskaart (PDOK-luchtfoto) alleen ophalen wanneer de overzichtskaart-
    // sectie aanstaat. Dit is async (netwerk) en gebeurt VÓÓR het blocking
    // render-werk. Faalt het (offline / geen posities), dan is `basemap` None
    // en valt de overzichtskaart terug op het kale RD-raster.
    let basemap = if sec.map {
        fetch_overview_basemap(&cpts).await
    } else {
        None
    };
    tokio::task::spawn_blocking(move || -> Result<Vec<u8>, String> {
        // Eén sondering → het GEBRANDE rapport (voorblad + schermvullende
        // grafiek + achterblad), met de aangevinkte secties (coördinaten-
        // tabel / overzichtskaart / SBT-legenda / metadata) als eigen
        // pagina's ertussen. Zo werken de vinkjes zonder de gebrande lay-out
        // te verliezen. Meerdere sonderingen → de openaec-sectie-engine.
        if cpts.len() == 1 {
            return Ok(generate_single_cpt_pdf_bytes_with_sections(
                &cpts[0],
                &meta,
                sec,
                basemap.as_ref(),
            ));
        }
        let report = build_with_sections(&cpts, &meta, sec, basemap.as_ref());
        generate_pdf_bytes(&report).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("spawn_blocking join failed: {e}"))?
}

pub async fn generate_report_core(
    cpts: Vec<cpt_core::Cpt>,
    project: ProjectMetaInput,
    output_path: String,
    sections: Option<ReportSections>,
) -> Result<(), String> {
    let bytes = preview_report_core(cpts, project, sections).await?;
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        std::fs::write(PathBuf::from(output_path), bytes).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("spawn_blocking join failed: {e}"))?
}

/// Haalt een PDOK-luchtfoto (WMS GetMap, EPSG:28992) op als achtergrond voor
/// de overzichtskaart in het rapport. Berekent een VIERKANTE RD-bbox rond de
/// sondeerlocaties (min. 150 m halve zijde, anders data-extent + 40% marge)
/// zodat er context omheen zichtbaar is. Geeft `None` bij geen posities of een
/// netwerk-/serverfout — het rapport valt dan terug op het kale RD-raster.
async fn fetch_overview_basemap(cpts: &[cpt_core::Cpt]) -> Option<cpt_core::OverviewBasemap> {
    let positions: Vec<(f64, f64)> = cpts
        .iter()
        .filter_map(|c| c.position.as_ref().map(|p| (p.x_rd, p.y_rd)))
        .collect();
    if positions.is_empty() {
        return None;
    }
    let xmin = positions.iter().map(|p| p.0).fold(f64::INFINITY, f64::min);
    let xmax = positions.iter().map(|p| p.0).fold(f64::NEG_INFINITY, f64::max);
    let ymin = positions.iter().map(|p| p.1).fold(f64::INFINITY, f64::min);
    let ymax = positions.iter().map(|p| p.1).fold(f64::NEG_INFINITY, f64::max);
    let cx = (xmin + xmax) / 2.0;
    let cy = (ymin + ymax) / 2.0;
    // Vierkante box: minstens 150 m halve zijde, anders data-extent + 40% marge.
    let half = ((xmax - xmin).max(ymax - ymin) / 2.0 * 1.4).max(150.0);
    let (bxmin, bxmax, bymin, bymax) = (cx - half, cx + half, cy - half, cy + half);

    let url = format!(
        "https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0?service=WMS&version=1.1.1&request=GetMap\
         &layers=Actueel_orthoHR&srs=EPSG:28992&bbox={bxmin:.1},{bymin:.1},{bxmax:.1},{bymax:.1}\
         &width=1200&height=1200&format=image/jpeg&styles="
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("OpenGeoStudio/0.1")
        .build()
        .ok()?;
    // Tot 2 pogingen: een eerste cold-start HTTPS-request (DNS + TLS) faalt
    // soms net. Lukt het ook dan niet, dan valt de overzichtskaart terug op
    // het kale RD-raster — geen harde fout in het rapport.
    for attempt in 1..=2u8 {
        match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(b) = resp.bytes().await {
                    let bytes = b.to_vec();
                    // Echte JPEG begint met FF D8; bij een WMS-fout krijg je
                    // XML/tekst terug — die negeren we.
                    if bytes.len() >= 1000 && bytes.starts_with(&[0xFF, 0xD8]) {
                        return Some(cpt_core::OverviewBasemap {
                            image_bytes: bytes,
                            mime: "image/jpeg".to_string(),
                            x_min: bxmin,
                            x_max: bxmax,
                            y_min: bymin,
                            y_max: bymax,
                        });
                    }
                }
            }
            Ok(resp) => eprintln!("[basemap] poging {attempt}: HTTP {}", resp.status()),
            Err(e) => eprintln!("[basemap] poging {attempt}: {e}"),
        }
    }
    None
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
    sections: Option<ReportSections>,
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
    preview_report_core(cpts, project, sections).await
}

#[tauri::command]
pub async fn generate_report(
    cpt_ids: Vec<String>,
    project: ProjectMetaInput,
    output_path: String,
    sections: Option<ReportSections>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let cpts: Vec<_> = {
        let cpts_map = state.cpts.lock().unwrap();
        cpt_ids
            .iter()
            .filter_map(|id| cpts_map.get(id).cloned())
            .collect()
    };
    generate_report_core(cpts, project, output_path, sections).await
}

/// Schrijf PDF-bytes naar een tijdelijk bestand en open het in de
/// systeem-standaard PDF-viewer. Gebruikt door de "PDF openen"-knop —
/// `window.open(blobUrl)` werkt niet in de Tauri-webview, dus we gaan via
/// een echt bestand + de opener-plugin.
#[tauri::command]
pub async fn open_report_pdf(
    bytes: Vec<u8>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = std::env::temp_dir().join(format!("ogs-rapport-{stamp}.pdf"));
    std::fs::write(&path, &bytes).map_err(|e| format!("PDF schrijven mislukt: {e}"))?;
    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("PDF openen mislukt: {e}"))
}
