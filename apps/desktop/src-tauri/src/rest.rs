//! Lokale REST/HTTP-API — `open-geo-studio --serve [--port 8787]`.
//!
//! Biedt de volledige kern van de tool over HTTP zodat externe tools
//! (scripts, CI, andere applicaties) ermee kunnen integreren zonder de
//! GUI of de stdio-MCP-transport: CPT's importeren/parsen, lagen
//! detecteren, rapport-PDF's genereren, CSV/GeoJSON/DWG/DXF exporteren,
//! IFC/IFCX genereren en de BRO bevragen.
//!
//! Dezelfde herbruikbare `*_core`-functies worden aangeroepen als door de
//! Tauri-commands en de MCP-server — één bron van waarheid, geen
//! gedupliceerde logica.
//!
//! VEILIGHEID: bindt standaard op `127.0.0.1` (alleen lokaal bereikbaar).
//! Er is bewust GEEN externe binding/0.0.0.0 — een lokale API zonder auth
//! mag niet zomaar op het netwerk staan.
//!
//! Endpoints (GET /api geeft dezelfde lijst machine-leesbaar terug):
//!   GET    /api                        → deze index (zelfbeschrijvend)
//!   GET    /api/health                 → status + aantallen objecten en CPT's
//!   GET    /api/objects                → alle geotechnische objecten
//!   POST   /api/objects {content,filename} → generiek document importeren
//!   GET    /api/cpts                   → lijst geparste CPT's (incl. meetdata)
//!   POST   /api/cpts        {content,filename} → parse + opslaan, geeft CPT
//!   GET    /api/cpts/:id               → één CPT (incl. meetdata)
//!   DELETE /api/cpts/:id               → CPT uit de cache verwijderen
//!   GET    /api/cpts/:id/layers        → Robertson-laagdetectie
//!   GET    /api/cpts/:id/csv           → meetdata als CSV (text/csv)
//!   POST   /api/export/geojson {cpt_ids} → GeoJSON FeatureCollection
//!   POST   /api/export/dwg  {format?,entities,…} → DXF/DWG-bytes
//!   POST   /api/report      {cpt_ids,project,sections?} → PDF
//!   POST   /api/ifc         {cpt_ids,project,format?} → IFC4x3/IFCX
//!   POST   /api/project/ifcx {payload}  → IFCX-preview van tekening-state
//!   POST   /api/bro/area    {bbox}      → BRO-sonderingen in bbox
//!   POST   /api/bro/bores   {bbox}      → BRO-boringen in bbox
//!   GET    /api/bro/cpt/:bro_id         → BRO CPT-XML
//!   GET    /api/bro/bore/:bro_id        → BRO boring-XML
//!   GET    /api/bro/meta/:kind/:bro_id  → BRO object-metadata (kind: cpt|bore)

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::commands::{
    bro_api as bro_cmd, cpt as cpt_cmd, document as document_cmd, dwg_export as dwg_cmd,
    export as export_cmd, ifc as ifc_cmd, project as project_cmd, report as report_cmd,
};
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

fn router(app: Arc<AppState>) -> Router {
    let state = ApiState { app };
    Router::new()
        .route("/api", get(index))
        .route("/api/health", get(health))
        .route("/api/objects", get(list_objects).post(open_object))
        .route("/api/cpts", get(list_cpts).post(open_cpt))
        .route("/api/cpts/:id", get(get_cpt).delete(close_cpt))
        .route("/api/cpts/:id/layers", get(detect_layers))
        .route("/api/cpts/:id/csv", get(cpt_csv))
        .route("/api/export/geojson", post(export_geojson))
        .route("/api/export/dwg", post(export_dwg))
        .route("/api/report", post(report))
        .route("/api/ifc", post(generate_ifc))
        .route("/api/project/ifcx", post(project_ifcx))
        .route("/api/bro/area", post(bro_area))
        .route("/api/bro/bores", post(bro_bores))
        .route("/api/bro/cpt/:bro_id", get(bro_cpt))
        .route("/api/bro/bore/:bro_id", get(bro_bore))
        .route("/api/bro/meta/:kind/:bro_id", get(bro_meta))
        // Axum's default body-limiet is 2 MB — te klein voor realistische
        // GEF/BRO-XML-uploads en DWG-payloads met base64-afbeeldingen.
        // 64 MB dekt elk redelijk sondeerbestand.
        .layer(axum::extract::DefaultBodyLimit::max(64 * 1024 * 1024))
        .with_state(state)
}

async fn serve(app: Arc<AppState>, port: u16) -> std::io::Result<()> {
    let router = router(app);
    let addr = format!("127.0.0.1:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    eprintln!("[rest] Open Geotechniek Studio REST API → http://{addr}");
    eprintln!("[rest] GET /api toont alle endpoints · zie ook docs/API.md");
    axum::serve(listener, router).await
}

// ─── Handlers ────────────────────────────────────────────────────────

/// Zelfbeschrijvende index — machine-leesbare endpoint-catalogus zodat een
/// client (of mens met curl) zonder documentatie op weg kan.
async fn index() -> Json<Value> {
    Json(json!({
        "service": "Open Geotechniek Studio REST API",
        "version": env!("CARGO_PKG_VERSION"),
        "docs": "docs/API.md in de repository",
        "endpoints": [
            { "method": "GET",    "path": "/api",                      "description": "Deze index" },
            { "method": "GET",    "path": "/api/health",               "description": "Status + aantallen geladen objecten en CPT's" },
            { "method": "GET",    "path": "/api/objects",              "description": "Lijst van alle geotechnische objecten" },
            { "method": "POST",   "path": "/api/objects",              "description": "Geotechnisch document parsen en cachen", "body": { "content": "string (bestandsinhoud)", "filename": "string" } },
            { "method": "GET",    "path": "/api/cpts",                 "description": "Lijst geparste CPT's (incl. meetdata)" },
            { "method": "POST",   "path": "/api/cpts",                 "description": "GEF- of BRO-XML parsen en cachen", "body": { "content": "string (bestandsinhoud)", "filename": "string" } },
            { "method": "GET",    "path": "/api/cpts/:id",             "description": "Eén CPT (incl. meetdata)" },
            { "method": "DELETE", "path": "/api/cpts/:id",             "description": "CPT uit de cache verwijderen" },
            { "method": "GET",    "path": "/api/cpts/:id/layers",      "description": "Robertson-laagdetectie" },
            { "method": "GET",    "path": "/api/cpts/:id/csv",         "description": "Meetdata als CSV (text/csv)" },
            { "method": "POST",   "path": "/api/export/geojson",       "description": "GeoJSON FeatureCollection van CPT-locaties", "body": { "cpt_ids": ["string"] } },
            { "method": "POST",   "path": "/api/export/dwg",           "description": "Situatietekening-geometrie naar DXF (default) of DWG; response = CAD-bytes", "body": { "format": "dxf|dwg (optioneel)", "entities": [{ "layer": "string", "type": "line|polyline|point|text|hatch", "points": [[0.0, 0.0]], "text": "string?", "closed": "bool?", "height": "f64?", "rotation": "f64?" }], "layer_colors": { "LAAG": 5 }, "images": "optioneel, zie docs" } },
            { "method": "POST",   "path": "/api/report",               "description": "Multi-CPT PDF-rapport (application/pdf)", "body": { "cpt_ids": ["string"], "project": { "title": "string", "client": "string", "location": "string", "project_number": "string", "author": "string", "date": "YYYY-MM-DD" }, "sections": "optioneel: { cover, coordTable, map, perCpt, sbtLegend, metadata }" } },
            { "method": "POST",   "path": "/api/ifc",                  "description": "IFC4x3 of IFCX genereren uit geladen CPT's", "body": { "cpt_ids": ["string"], "project": { "title": "string" }, "format": "ifc4x3|ifcx (default ifc4x3)" } },
            { "method": "POST",   "path": "/api/project/ifcx",         "description": "IFCX-preview van een volledige tekening-state (payload = ifcgis-JSON)" },
            { "method": "POST",   "path": "/api/bro/area",             "description": "BRO-sonderingen binnen bbox", "body": { "bbox": { "min_lat": 0.0, "min_lon": 0.0, "max_lat": 0.0, "max_lon": 0.0 } } },
            { "method": "POST",   "path": "/api/bro/bores",            "description": "BRO-boringen binnen bbox (zelfde body als /api/bro/area)" },
            { "method": "GET",    "path": "/api/bro/cpt/:bro_id",      "description": "BRO CPT-XML (importeer via POST /api/cpts)" },
            { "method": "GET",    "path": "/api/bro/bore/:bro_id",     "description": "BRO boring-XML" },
            { "method": "GET",    "path": "/api/bro/meta/:kind/:bro_id", "description": "BRO object-metadata; kind = cpt | bore" },
        ],
    }))
}

async fn health(State(s): State<ApiState>) -> Json<Value> {
    let (objects_loaded, cpts_loaded) = s
        .app
        .with_project(|project| (project.objects().count(), project.cpts().count()))
        .unwrap_or((0, 0));
    Json(json!({
        "status": "running",
        "service": "Open Geotechniek Studio REST API",
        "version": env!("CARGO_PKG_VERSION"),
        "objects_loaded": objects_loaded,
        "cpts_loaded": cpts_loaded,
    }))
}

async fn list_cpts(State(s): State<ApiState>) -> Result<Json<Value>, ApiError> {
    let cpts: Vec<Cpt> = cpt_cmd::list_cpts_core(&s.app);
    Ok(Json(serde_json::to_value(cpts).map_err(|e| e.to_string())?))
}

async fn list_objects(State(s): State<ApiState>) -> Result<Json<Value>, ApiError> {
    let objects = s.app.with_project(|project| {
        project
            .objects()
            .cloned()
            .map(|object| document_cmd::object_to_dto(object, ""))
            .collect::<Vec<_>>()
    })?;
    Ok(Json(
        serde_json::to_value(objects).map_err(|error| error.to_string())?,
    ))
}

#[derive(Deserialize)]
struct OpenCptBody {
    /// Ruwe inhoud van het GEF- of BRO-XML-bestand.
    content: String,
    /// Bestandsnaam (de extensie stuurt formaat-detectie).
    filename: String,
}

async fn open_object(
    State(s): State<ApiState>,
    Json(b): Json<OpenCptBody>,
) -> Result<Json<Value>, ApiError> {
    let object = document_cmd::open_geotechnical_document_core(
        &b.content,
        &b.filename,
        document_cmd::ExpectedDocumentKind::Any,
        &s.app,
    )?;
    Ok(Json(
        serde_json::to_value(object).map_err(|error| error.to_string())?,
    ))
}

async fn open_cpt(
    State(s): State<ApiState>,
    Json(b): Json<OpenCptBody>,
) -> Result<Json<Value>, ApiError> {
    let cpt = cpt_cmd::open_cpt_core(&b.content, &b.filename, &s.app)?;
    Ok(Json(serde_json::to_value(cpt).map_err(|e| e.to_string())?))
}

async fn get_cpt(
    State(s): State<ApiState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let cpt = s
        .app
        .with_project(|project| project.cpts().find(|cpt| cpt.id == id).cloned())?
        .ok_or_else(|| format!("onbekende CPT id: {id}"))?;
    Ok(Json(serde_json::to_value(&cpt).map_err(|e| e.to_string())?))
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
    Ok(Json(
        serde_json::to_value(layers).map_err(|e| e.to_string())?,
    ))
}

async fn cpt_csv(State(s): State<ApiState>, Path(id): Path<String>) -> Result<Response, ApiError> {
    let csv = export_cmd::csv_string_core(&id, &s.app)?;
    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "text/csv; charset=utf-8")],
        csv,
    )
        .into_response())
}

#[derive(Deserialize)]
struct GeoJsonBody {
    cpt_ids: Vec<String>,
}

async fn export_geojson(
    State(s): State<ApiState>,
    Json(b): Json<GeoJsonBody>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(export_cmd::geojson_value_core(&b.cpt_ids, &s.app)?))
}

#[derive(Deserialize)]
struct DwgBody {
    /// "dxf" (default — meest robuuste round-trip) of "dwg".
    #[serde(default)]
    format: Option<String>,
    #[serde(flatten)]
    payload: dwg_cmd::DwgPayload,
}

async fn export_dwg(Json(b): Json<DwgBody>) -> Result<Response, ApiError> {
    let format = b.format.unwrap_or_else(|| "dxf".into());
    // CPU-gebonden en schrijft een temp-bestand — buiten de async-pool.
    let bytes = tokio::task::spawn_blocking(move || dwg_cmd::export_dwg_bytes(&b.payload, &format))
        .await
        .map_err(|e| format!("dwg task: {e}"))??;
    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/octet-stream")],
        bytes,
    )
        .into_response())
}

#[derive(Deserialize)]
struct ReportBody {
    cpt_ids: Vec<String>,
    project: report_cmd::ProjectMetaInput,
    /// Optionele sectie-selectie (cover, coordTable, map, perCpt, sbtLegend,
    /// metadata). Weggelaten → standaard-secties.
    #[serde(default)]
    sections: Option<cpt_core::ReportSections>,
}

/// Snapshot de gevraagde CPT's uit de cache. Onbekende ids zijn een HARDE
/// fout: stilletjes overslaan gaf een HTTP 200 met een half resultaat —
/// voor een script/CI-consument ondetecteerbaar.
fn snapshot_cpts(ids: &[String], s: &ApiState) -> Result<Vec<Cpt>, ApiError> {
    let (found, missing): (Vec<Cpt>, Vec<String>) = s.app.with_project(|project| {
        let mut found = Vec::new();
        let mut missing = Vec::new();
        for id in ids {
            match project.cpts().find(|cpt| cpt.id == *id) {
                Some(cpt) => found.push(cpt.clone()),
                None => missing.push(id.clone()),
            }
        }
        (found, missing)
    })?;
    if !missing.is_empty() {
        return Err(ApiError(format!(
            "onbekende cpt_ids: {} (importeer ze eerst via POST /api/cpts)",
            missing.join(", "),
        )));
    }
    if found.is_empty() {
        return Err(ApiError("geen cpt_ids opgegeven".into()));
    }
    Ok(found)
}

async fn report(
    State(s): State<ApiState>,
    Json(b): Json<ReportBody>,
) -> Result<Response, ApiError> {
    let cpts = snapshot_cpts(&b.cpt_ids, &s)?;
    let bytes = report_cmd::preview_report_core(cpts, b.project, b.sections).await?;
    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/pdf")],
        bytes,
    )
        .into_response())
}

#[derive(Deserialize)]
struct IfcBody {
    cpt_ids: Vec<String>,
    project: ifc_cmd::ProjectMetaInput,
    /// "ifc4x3" (default) of "ifcx".
    #[serde(default)]
    format: Option<String>,
}

async fn generate_ifc(
    State(s): State<ApiState>,
    Json(b): Json<IfcBody>,
) -> Result<Json<Value>, ApiError> {
    let cpts = snapshot_cpts(&b.cpt_ids, &s)?;
    let format = b.format.unwrap_or_else(|| "ifc4x3".into());
    let result = ifc_cmd::generate_ifc_core(b.project, cpts, format).await?;
    Ok(Json(
        serde_json::to_value(result).map_err(|e| e.to_string())?,
    ))
}

async fn project_ifcx(Json(payload): Json<Value>) -> Result<Response, ApiError> {
    let text = project_cmd::preview_project_ifcx_core(payload)?;
    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json; charset=utf-8")],
        text,
    )
        .into_response())
}

#[derive(Deserialize)]
struct AreaBody {
    bbox: bro_cmd::BBox,
}

async fn bro_area(Json(b): Json<AreaBody>) -> Result<Json<Value>, ApiError> {
    let features = bro_cmd::fetch_bro_area_core(b.bbox).await?;
    Ok(Json(
        serde_json::to_value(features).map_err(|e| e.to_string())?,
    ))
}

async fn bro_bores(Json(b): Json<AreaBody>) -> Result<Json<Value>, ApiError> {
    let features = bro_cmd::fetch_bro_bores_core(b.bbox).await?;
    Ok(Json(
        serde_json::to_value(features).map_err(|e| e.to_string())?,
    ))
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

async fn bro_bore(Path(bro_id): Path<String>) -> Result<Response, ApiError> {
    let xml = bro_cmd::fetch_bro_bore_core(&bro_id).await?;
    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/xml")],
        xml,
    )
        .into_response())
}

async fn bro_meta(Path((kind, bro_id)): Path<(String, String)>) -> Result<Json<Value>, ApiError> {
    let meta = bro_cmd::fetch_bro_object_metadata_core(&bro_id, &kind).await?;
    Ok(Json(serde_json::to_value(meta).map_err(|e| e.to_string())?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    fn json_request(uri: &str, body: Value) -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    }

    fn get_request(uri: &str) -> Request<Body> {
        Request::builder().uri(uri).body(Body::empty()).unwrap()
    }

    async fn response_json(response: Response) -> Value {
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn generic_object_route_imports_borehole() {
        let app = router(Arc::new(AppState::default()));
        let response = app
            .oneshot(json_request(
                "/api/objects",
                json!({
                    "content": include_str!("../tests/fixtures/bhr-gt-minimal.xml"),
                    "filename": "bore.xml"
                }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response_json(response).await;
        assert_eq!(body["kind"], "bore");
        assert_eq!(body["data"]["id"], "BHR000000000001");
        assert_eq!(body["data"]["metadata"]["source_file"], "bore.xml");
    }

    #[tokio::test]
    async fn generic_object_list_and_health_count_all_objects() {
        let state = Arc::new(AppState::default());
        document_cmd::open_geotechnical_document_core(
            include_str!("../tests/fixtures/bhr-gt-minimal.xml"),
            "bore.xml",
            document_cmd::ExpectedDocumentKind::Any,
            &state,
        )
        .unwrap();
        let objects = response_json(
            router(state.clone())
                .oneshot(get_request("/api/objects"))
                .await
                .unwrap(),
        )
        .await;
        assert_eq!(objects[0]["kind"], "bore");
        assert_eq!(objects[0]["data"]["id"], "BHR000000000001");
        assert_eq!(objects[0]["data"]["metadata"]["source_file"], "bore.xml");

        let health = response_json(
            router(state)
                .oneshot(get_request("/api/health"))
                .await
                .unwrap(),
        )
        .await;
        assert_eq!(health["objects_loaded"], 1);
        assert_eq!(health["cpts_loaded"], 0);
    }
}
