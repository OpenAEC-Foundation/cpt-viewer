mod mcp;
mod pdf;

use pdf::brand::BrandConfig;
use pdf::engine::ReportEngine;
use pdf::model::{ReportData, TemplateInfo, TenantInfo};
use pdf::tenant::TenantManager;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

struct AppState {
    tenant_manager: TenantManager,
}

/// Resolve the tenants directory (next to the executable or in dev mode).
fn resolve_tenants_dir() -> PathBuf {
    // In dev: src-tauri/tenants/
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tenants");
    if dev_path.exists() {
        return dev_path;
    }
    // In production: next to executable
    if let Ok(exe) = std::env::current_exe() {
        let prod_path = exe.parent().unwrap_or(&exe).join("tenants");
        if prod_path.exists() {
            return prod_path;
        }
    }
    dev_path
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn list_tenants(state: tauri::State<'_, Mutex<AppState>>) -> Result<Vec<TenantInfo>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.tenant_manager.list_tenants()
}

#[tauri::command]
fn list_templates(
    tenant: String,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<Vec<TemplateInfo>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.tenant_manager.list_templates(&tenant)
}

#[tauri::command]
fn get_brand(
    tenant: String,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<BrandConfig, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.tenant_manager.load_brand(&tenant)
}

#[tauri::command]
fn generate_pdf(
    report: ReportData,
    tenant: String,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<Vec<u8>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let engine = ReportEngine::new(TenantManager::new(
        state.tenant_manager.tenant_dir(&tenant).parent().unwrap().to_path_buf(),
    ));
    engine.generate(&report, &tenant)
}

#[tauri::command]
fn save_pdf(
    report: ReportData,
    tenant: String,
    path: String,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let engine = ReportEngine::new(TenantManager::new(
        state.tenant_manager.tenant_dir(&tenant).parent().unwrap().to_path_buf(),
    ));
    let bytes = engine.generate(&report, &tenant)?;
    std::fs::write(&path, &bytes)
        .map_err(|e| format!("Failed to write PDF: {}", e))
}

// ───────────────────────────────────────────────────────────────────
// openaec-core engine integration — the production-grade Rust engine
// from OpenAEC Foundation. Takes a JSON Value so the frontend doesn't
// need to match a strongly-typed Rust schema.
// ───────────────────────────────────────────────────────────────────

/// Generate a PDF using the openaec-core engine.
///
/// Expects a JSON object matching the openaec-core ReportData schema
/// (template, project, sections, etc.). Returns PDF bytes.
#[tauri::command]
fn engine_generate_pdf(report: serde_json::Value) -> Result<Vec<u8>, String> {
    let json = report.to_string();
    let report_data = openaec_core::ReportData::from_json(&json)
        .map_err(|e| format!("Invalid report JSON: {}", e))?;
    openaec_core::generate_pdf_bytes(&report_data)
        .map_err(|e| format!("Engine failed: {}", e))
}

/// Same as `engine_generate_pdf`, but writes to disk at the given path.
#[tauri::command]
fn engine_save_pdf(report: serde_json::Value, path: String) -> Result<(), String> {
    let bytes = engine_generate_pdf(report)?;
    std::fs::write(&path, &bytes)
        .map_err(|e| format!("Failed to write PDF: {}", e))
}

/// Run as MCP server (stdio transport) — no GUI.
pub fn run_mcp() {
    let tenants_dir = resolve_tenants_dir();
    let tm = Arc::new(Mutex::new(TenantManager::new(tenants_dir)));
    let server = mcp::server::McpServer::new(tm);
    server.run_stdio();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Check for --mcp flag to start as MCP server instead of GUI
    if std::env::args().any(|a| a == "--mcp") {
        run_mcp();
        return;
    }

    let tenants_dir = resolve_tenants_dir();
    let app_state = Mutex::new(AppState {
        tenant_manager: TenantManager::new(tenants_dir),
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            greet,
            list_tenants,
            list_templates,
            get_brand,
            generate_pdf,
            save_pdf,
            engine_generate_pdf,
            engine_save_pdf,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
