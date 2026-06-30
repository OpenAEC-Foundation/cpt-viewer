//! Lokale REST/HTTP-API — `open-geo-studio --serve [--port 8787]`.
//!
//! Biedt dezelfde kern-operaties als de MCP-server (CPT importeren/parsen,
//! lagen detecteren, rapport genereren, BRO ophalen), maar over HTTP zodat
//! externe tools (scripts, CI, andere applicaties) ermee kunnen integreren
//! zonder de GUI of de stdio-MCP-transport.
//!
//! Dezelfde herbruikbare `*_core`-functies worden aangeroepen als door de
//! Tauri-commands en de MCP-server — één bron van waarheid, geen
//! gedupliceerde logica.
//!
//! VEILIGHEID: bindt standaard op `127.0.0.1` (alleen lokaal bereikbaar).
//! Er is bewust GEEN externe binding/0.0.0.0 — een lokale API zonder auth
//! mag niet zomaar op het netwerk staan.
//!
//! Endpoints:
//!   GET    /api/health                 → status + aantal geladen CPT's
//!   GET    /api/cpts                    → lijst geparste CPT's
//!   POST   /api/cpts        {content,filename} → parse + opslaan, geeft CPT
//!   DELETE /api/cpts/:id               → CPT uit de cache verwijderen
//!   GET    /api/cpts/:id/layers        → Robertson-laagdetectie
//!   POST   /api/report     {cpt_ids,project} → PDF-rapport (application/pdf)
//!   POST   /api/bro/area   {bbox}      → BRO-objecten in bbox (GeoJSON-achtig)
//!   GET    /api/bro/cpt/:bro_id        → BRO CPT-XML

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::commands::{bro_api as bro_cmd, cpt as cpt_cmd, report as report_cmd};
use crate::state::AppState;
use cpt_core::Cpt;

/// Gedeelde server-state — de CPT-cache + project-state.
#[derive(Clone)]
struct ApiState {
    app: Arc<AppState>,
}

/// Foutwrapper → HTTP 400 met platte-tekst-melding (de core-functies geven
/// `Err(String)` met een leesbare boodschap terug).
struct ApiError(String);
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (StatusCode::BAD_REQUEST, self.0).into_response()
    }
}
impl From<String> for ApiError {
    fn from(s: String) -> Self {
        ApiError(s)
    }
}

/// Entry-point vanuit `lib.rs` voor `--serve`. Maakt een eigen tokio-runtime
/// (in serve-mode is er geen Tauri-runtime) en draait de server tot het
/// proces stopt.
pub fn run(port: u16) {
    let app_state = Arc::new(AppState::default());
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("kon tokio-runtime voor REST-server niet aanmaken");
    rt.block_on(async move {
        if let Err(e) = serve(app_state, port).await {
            eprintln!("[rest] server-fout: {e}");
        }
    });
}

async fn serve(app: Arc<AppState>, port: u16) -> std::io::Result<()> {
    let state = ApiState { app };
    let router = Router::new()
        .route("/api/health", get(health))
        .route("/api/cpts", get(list_cpts).post(open_cpt))
        .route("/api/cpts/:id", delete(close_cpt))
        .route("/api/cpts/:id/layers", get(detect_layers))
        .route("/api/report", post(report))
        .route("/api/bro/area", post(bro_area))
        .route("/api/bro/cpt/:bro_id", get(bro_cpt))
        .with_state(state);

    let addr = format!("127.0.0.1:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    eprintln!("[rest] Open Geotechniek Studio REST API → http://{addr}");
    eprintln!("[rest] GET /api/health · POST /api/cpts · GET /api/cpts/:id/layers · POST /api/report");
    axum::serve(listener, router).await
}

// ─── Handlers ────────────────────────────────────────────────────────

async fn health(State(s): State<ApiState>) -> Json<Value> {
    let cpts_loaded = s.app.cpts.lock().map(|m| m.len()).unwrap_or(0);
    Json(json!({
        "status": "running",
        "service": "Open Geotechniek Studio REST API",
        "version": env!("CARGO_PKG_VERSION"),
        "cpts_loaded": cpts_loaded,
    }))
}

async fn list_cpts(State(s): State<ApiState>) -> Result<Json<Value>, ApiError> {
    let cpts: Vec<Cpt> = cpt_cmd::list_cpts_core(&s.app);
    Ok(Json(serde_json::to_value(cpts).map_err(|e| e.to_string())?))
}

#[derive(Deserialize)]
struct OpenCptBody {
    /// Ruwe inhoud van het GEF- of BRO-XML-bestand.
    content: String,
    /// Bestandsnaam (de extensie stuurt formaat-detectie).
    filename: String,
}

async fn open_cpt(
    State(s): State<ApiState>,
    Json(b): Json<OpenCptBody>,
) -> Result<Json<Value>, ApiError> {
    let cpt = cpt_cmd::open_cpt_core(&b.content, &b.filename, &s.app)?;
    Ok(Json(serde_json::to_value(cpt).map_err(|e| e.to_string())?))
}

async fn close_cpt(
    State(s): State<ApiState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    cpt_cmd::close_cpt_core(&id, &s.app)?;
    Ok(Json(json!({ "closed": id })))
}

async fn detect_layers(
    State(s): State<ApiState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let layers = cpt_cmd::detect_layers_core(&id, &s.app)?;
    Ok(Json(serde_json::to_value(layers).map_err(|e| e.to_string())?))
}

#[derive(Deserialize)]
struct ReportBody {
    cpt_ids: Vec<String>,
    project: report_cmd::ProjectMetaInput,
}

async fn report(
    State(s): State<ApiState>,
    Json(b): Json<ReportBody>,
) -> Result<Response, ApiError> {
    // Snapshot de gevraagde CPT's uit de cache (zelfde patroon als de
    // Tauri-command + MCP-tool) zodat de async render zonder lock draait.
    let cpts: Vec<Cpt> = {
        let cache = s.app.cpts.lock().map_err(|e| e.to_string())?;
        b.cpt_ids
            .iter()
            .filter_map(|id| cache.get(id).cloned())
            .collect()
    };
    if cpts.is_empty() {
        return Err(ApiError(
            "geen CPT's gevonden voor de opgegeven cpt_ids (importeer ze eerst via POST /api/cpts)".into(),
        ));
    }
    let bytes = report_cmd::preview_report_core(cpts, b.project).await?;
    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/pdf")],
        bytes,
    )
        .into_response())
}

#[derive(Deserialize)]
struct AreaBody {
    bbox: bro_cmd::BBox,
}

async fn bro_area(Json(b): Json<AreaBody>) -> Result<Json<Value>, ApiError> {
    let features = bro_cmd::fetch_bro_area_core(b.bbox).await?;
    Ok(Json(serde_json::to_value(features).map_err(|e| e.to_string())?))
}

async fn bro_cpt(Path(bro_id): Path<String>) -> Result<Response, ApiError> {
    let xml = bro_cmd::fetch_bro_cpt_core(&bro_id).await?;
    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/xml")],
        xml,
    )
        .into_response())
}
