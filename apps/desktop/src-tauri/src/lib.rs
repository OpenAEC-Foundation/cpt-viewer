mod commands;
mod mcp;
mod pdf;
mod state;

use pdf::brand::BrandConfig;
use pdf::engine::ReportEngine;
use pdf::model::{ReportData, TemplateInfo, TenantInfo};
use pdf::tenant::TenantManager;
use state::AppState as CptAppState;
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

    // Collect any file paths passed on the command line — Windows
    // Explorer launches the registered .exe with the file path as
    // argv[1] when the user double-clicks a .gef / .ifcgis / .ifcgeo
    // file. We stash them here, then emit `ogs:open-file` events to
    // the frontend after the main window has loaded.
    let cli_files: Vec<String> = std::env::args()
        .skip(1)
        .filter(|a| !a.starts_with("--"))
        .filter(|a| {
            let lower = a.to_lowercase();
            lower.ends_with(".gef")
                || lower.ends_with(".ifcgis")
                || lower.ends_with(".ifcgeo")
                || lower.ends_with(".xml")
        })
        .collect();

    tauri::Builder::default()
        // Single-instance plugin: a second `open-geo-studio.exe path/to/file.gef`
        // invocation (e.g. double-clicking a .gef while the app is running)
        // forwards its CLI args to the already-running instance and exits.
        // Inside the callback we surface the window and emit the same
        // `ogs:open-file` event the startup flow uses, so the file lands
        // in a fresh tab on the existing instance.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            use tauri::{Emitter, Manager};
            // Surface any existing window — bring it to front for the user.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            for arg in argv.iter().skip(1) {
                if arg.starts_with("--") { continue; }
                let lower = arg.to_lowercase();
                if lower.ends_with(".gef")
                    || lower.ends_with(".ifcgis")
                    || lower.ends_with(".ifcgeo")
                    || lower.ends_with(".xml")
                {
                    let _ = app.emit("ogs:open-file", arg.clone());
                }
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(app_state)
        .manage(CptAppState::default())
        .setup(move |app| {
            if !cli_files.is_empty() {
                use tauri::Emitter;
                let handle = app.handle().clone();
                let files = cli_files.clone();
                // Defer the emit so the frontend's `listen("ogs:open-file")`
                // call (registered in App.tsx's mount effect) is wired up
                // before we fire — without the delay the events arrive at
                // an empty listener set and silently get dropped.
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(800));
                    for path in files {
                        let _ = handle.emit("ogs:open-file", path);
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            list_tenants,
            list_templates,
            get_brand,
            generate_pdf,
            save_pdf,
            engine_generate_pdf,
            engine_save_pdf,
            commands::cpt::open_cpt,
            commands::cpt::close_cpt,
            commands::cpt::list_cpts,
            commands::cpt::detect_layers,
            commands::cpt::save_cpt_as,
            commands::bro_api::fetch_bro_area,
            commands::bro_api::fetch_bro_cpt,
            commands::bro_api::fetch_bro_bore,
            commands::bro_api::fetch_bro_bores,
            commands::bro_api::fetch_bro_object_metadata,
            commands::report::preview_report,
            commands::report::generate_report,
            commands::export::export_csv,
            commands::export::export_geojson,
            commands::project::save_project_ifcgis,
            commands::project::open_project_ifcgis,
            commands::project::save_project_ifcgis_full,
            commands::project::open_project_ifcgis_full,
            commands::ifc::generate_ifc,
            commands::ifc::list_generated_ifc,
            commands::ifc::read_generated_ifc,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
