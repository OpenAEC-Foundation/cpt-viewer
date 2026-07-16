use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
use std::sync::{Arc, Mutex, OnceLock};
use tokio::runtime::Runtime;

use super::tools;
use crate::commands::{
    bro_api as bro_cmd,
    cpt as cpt_cmd,
    export as export_cmd,
    extensions as ext_cmd,
    ifc as ifc_cmd,
    project as project_cmd,
    report as report_cmd,
};
use std::collections::HashMap as StdHashMap;
use crate::pdf::model::{ReportData, TenantInfo};
use crate::pdf::tenant::TenantManager;
use crate::state::AppState;
use cpt_core::Cpt;

/// Lazy, process-global tokio multi-thread runtime — gebruikt door MCP-mode
/// om async commands (BRO API, IFC-generatie, PDF-rapport) sync te kunnen
/// aanroepen via `block_on`. In GUI-mode wordt deze runtime niet aangemaakt
/// (Tauri brengt z'n eigen runtime mee).
fn tokio_rt() -> &'static Runtime {
    static RT: OnceLock<Runtime> = OnceLock::new();
    RT.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("create tokio runtime for MCP server")
    })
}

/// JSON-RPC request (MCP protocol)
#[derive(Deserialize, Debug)]
struct JsonRpcRequest {
    #[allow(dead_code)]
    jsonrpc: String,
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Value,
}

/// JSON-RPC response
#[derive(Serialize)]
struct JsonRpcResponse {
    jsonrpc: String,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

#[derive(Serialize)]
struct JsonRpcError {
    code: i32,
    message: String,
}

/// MCP Server state.
///
/// Beide subsystemen worden Arc-gedeeld zodat deze server in principe
/// vanuit een Tauri-app naast de GUI-modus kan worden opgestart (toekomstig
/// scenario). De `tenant_manager` zit in een Mutex omdat tenant-config
/// kan worden bijgewerkt; de `app_state` heeft interne Mutexes per veld
/// (zie `state.rs`).
pub struct McpServer {
    tenant_manager: Arc<Mutex<TenantManager>>,
    app_state: Arc<AppState>,
}

impl McpServer {
    pub fn new(tenant_manager: Arc<Mutex<TenantManager>>, app_state: Arc<AppState>) -> Self {
        Self { tenant_manager, app_state }
    }

    /// Run the MCP server on stdio (blocking).
    pub fn run_stdio(&self) {
        let stdin = io::stdin();
        let stdout = io::stdout();

        for line in stdin.lock().lines() {
            let line = match line {
                Ok(l) => l,
                Err(_) => break,
            };

            if line.trim().is_empty() {
                continue;
            }

            let request: JsonRpcRequest = match serde_json::from_str(&line) {
                Ok(r) => r,
                Err(e) => {
                    let err_resp = json!({
                        "jsonrpc": "2.0",
                        "id": null,
                        "error": { "code": -32700, "message": format!("Parse error: {}", e) }
                    });
                    let mut out = stdout.lock();
                    let _ = writeln!(out, "{}", err_resp);
                    let _ = out.flush();
                    continue;
                }
            };

            let response = self.handle_request(&request);
            let mut out = stdout.lock();
            let _ = writeln!(out, "{}", serde_json::to_string(&response).unwrap_or_default());
            let _ = out.flush();
        }
    }

    fn handle_request(&self, req: &JsonRpcRequest) -> JsonRpcResponse {
        let id = req.id.clone().unwrap_or(Value::Null);

        match req.method.as_str() {
            "initialize" => JsonRpcResponse {
                jsonrpc: "2.0".into(),
                id,
                result: Some(json!({
                    "protocolVersion": "2024-11-05",
                    "capabilities": {
                        "tools": { "listChanged": false }
                    },
                    "serverInfo": {
                        "name": "openaec-desktop",
                        "version": env!("CARGO_PKG_VERSION")
                    }
                })),
                error: None,
            },

            "notifications/initialized" => JsonRpcResponse {
                jsonrpc: "2.0".into(),
                id,
                result: Some(json!({})),
                error: None,
            },

            "tools/list" => JsonRpcResponse {
                jsonrpc: "2.0".into(),
                id,
                result: Some(json!({ "tools": tools::tool_definitions() })),
                error: None,
            },

            "tools/call" => {
                let tool_name = req.params.get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let arguments = req.params.get("arguments")
                    .cloned()
                    .unwrap_or(json!({}));

                match self.call_tool(tool_name, &arguments) {
                    Ok(result) => JsonRpcResponse {
                        jsonrpc: "2.0".into(),
                        id,
                        result: Some(json!({
                            "content": [{ "type": "text", "text": result }]
                        })),
                        error: None,
                    },
                    Err(e) => JsonRpcResponse {
                        jsonrpc: "2.0".into(),
                        id,
                        result: Some(json!({
                            "content": [{ "type": "text", "text": e }],
                            "isError": true
                        })),
                        error: None,
                    },
                }
            }

            _ => JsonRpcResponse {
                jsonrpc: "2.0".into(),
                id,
                result: None,
                error: Some(JsonRpcError {
                    code: -32601,
                    message: format!("Method not found: {}", req.method),
                }),
            },
        }
    }

    fn call_tool(&self, name: &str, args: &Value) -> Result<String, String> {
        // Korte helpers om de boilerplate van JSON-arg extractie te beperken.
        let arg_str = |key: &str| -> Result<String, String> {
            args.get(key)
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| format!("Missing '{}' argument", key))
        };
        let arg_value = |key: &str| -> Result<Value, String> {
            args.get(key)
                .cloned()
                .ok_or_else(|| format!("Missing '{}' argument", key))
        };

        match name {
            // ─── Tenant / brand / report-via-tenant ────────────────────
            "list_tenants" => {
                let tm = self.tenant_manager.lock().map_err(|e| e.to_string())?;
                let tenants: Vec<TenantInfo> = tm.list_tenants()?;
                serde_json::to_string_pretty(&tenants).map_err(|e| e.to_string())
            }
            "list_templates" => {
                let tenant = arg_str("tenant")?;
                let tm = self.tenant_manager.lock().map_err(|e| e.to_string())?;
                let templates = tm.list_templates(&tenant)?;
                serde_json::to_string_pretty(&templates).map_err(|e| e.to_string())
            }
            "get_brand" => {
                let tenant = arg_str("tenant")?;
                let tm = self.tenant_manager.lock().map_err(|e| e.to_string())?;
                let brand = tm.load_brand(&tenant)?;
                serde_json::to_string_pretty(&brand).map_err(|e| e.to_string())
            }
            "generate_report" => {
                let tenant = arg_str("tenant")?;
                let report_data = arg_value("report")?;
                let output_path = arg_str("output_path")?;
                let report: ReportData = serde_json::from_value(report_data)
                    .map_err(|e| format!("Invalid report data: {}", e))?;
                let tm = self.tenant_manager.lock().map_err(|e| e.to_string())?;
                let engine = crate::pdf::engine::ReportEngine::new(
                    TenantManager::new(tm.tenant_dir(&tenant).parent().unwrap().to_path_buf())
                );
                let bytes = engine.generate(&report, &tenant)?;
                std::fs::write(&output_path, &bytes)
                    .map_err(|e| format!("Failed to write PDF: {}", e))?;
                Ok(format!("PDF generated: {} ({} bytes)", output_path, bytes.len()))
            }
            "get_app_state" => {
                let tm = self.tenant_manager.lock().map_err(|e| e.to_string())?;
                let tenants_count = tm.list_tenants().unwrap_or_default().len();
                let cpts_count = self.app_state.with_project(|project| project.cpts().count())?;
                Ok(json!({
                    "status": "running",
                    "version": env!("CARGO_PKG_VERSION"),
                    "tenants_available": tenants_count,
                    "cpts_loaded": cpts_count,
                }).to_string())
            }

            // ─── CPT ───────────────────────────────────────────────────
            "cpt_open" => {
                let content = arg_str("content")?;
                let filename = arg_str("filename")?;
                let cpt = cpt_cmd::open_cpt_core(&content, &filename, &self.app_state)?;
                serde_json::to_string_pretty(&cpt).map_err(|e| e.to_string())
            }
            "cpt_close" => {
                let id = arg_str("id")?;
                cpt_cmd::close_cpt_core(&id, &self.app_state)?;
                Ok(format!("CPT closed: {}", id))
            }
            "cpt_list" => {
                let cpts = cpt_cmd::list_cpts_core(&self.app_state);
                serde_json::to_string_pretty(&cpts).map_err(|e| e.to_string())
            }
            "cpt_detect_layers" => {
                let id = arg_str("id")?;
                let layers = cpt_cmd::detect_layers_core(&id, &self.app_state)?;
                serde_json::to_string_pretty(&layers).map_err(|e| e.to_string())
            }
            "cpt_save_as" => {
                let cpt_id = arg_str("cpt_id")?;
                let format = arg_str("format")?;
                let path = arg_str("path")?;
                cpt_cmd::save_cpt_as_core(&cpt_id, &format, &path, &self.app_state)?;
                Ok(format!("CPT '{}' saved as {} to {}", cpt_id, format, path))
            }

            // ─── Project ───────────────────────────────────────────────
            "project_save_ifcgis" => {
                let project_value = arg_value("project")?;
                let path = arg_str("path")?;
                let project: project_cmd::ProjectMetaInput = serde_json::from_value(project_value)
                    .map_err(|e| format!("Invalid project meta: {}", e))?;
                project_cmd::save_project_ifcgis_core(project, &path, &self.app_state)?;
                Ok(format!("Project saved to {}", path))
            }
            "project_open_ifcgis" => {
                let path = arg_str("path")?;
                let result = project_cmd::open_project_ifcgis_core(&path, &self.app_state)?;
                serde_json::to_string_pretty(&result).map_err(|e| e.to_string())
            }
            "project_save_ifcgis_full" => {
                let payload = arg_value("payload")?;
                let path = arg_str("path")?;
                project_cmd::save_project_ifcgis_full_core(payload, &path)?;
                Ok(format!("Project (full) saved to {}", path))
            }
            "project_open_ifcgis_full" => {
                let path = arg_str("path")?;
                let value = project_cmd::open_project_ifcgis_full_core(&path, &self.app_state)?;
                serde_json::to_string_pretty(&value).map_err(|e| e.to_string())
            }
            "project_preview_ifcx" => {
                let payload = arg_value("payload")?;
                project_cmd::preview_project_ifcx_core(payload)
            }

            // ─── Export ────────────────────────────────────────────────
            "export_csv" => {
                let cpt_id = arg_str("cpt_id")?;
                let path = arg_str("path")?;
                export_cmd::export_csv_core(&cpt_id, &path, &self.app_state)?;
                Ok(format!("CSV exported to {}", path))
            }
            "export_geojson" => {
                let cpt_ids_val = arg_value("cpt_ids")?;
                let cpt_ids: Vec<String> = serde_json::from_value(cpt_ids_val)
                    .map_err(|e| format!("Invalid cpt_ids: {}", e))?;
                let path = arg_str("path")?;
                export_cmd::export_geojson_core(&cpt_ids, &path, &self.app_state)?;
                Ok(format!("GeoJSON exported to {}", path))
            }

            // ─── BRO (async, block_on via tokio runtime) ───────────────
            "bro_fetch_area" => {
                let bbox_val = arg_value("bbox")?;
                let bbox: bro_cmd::BBox = serde_json::from_value(bbox_val)
                    .map_err(|e| format!("Invalid bbox: {}", e))?;
                let features = tokio_rt().block_on(bro_cmd::fetch_bro_area_core(bbox))?;
                serde_json::to_string_pretty(&features).map_err(|e| e.to_string())
            }
            "bro_fetch_bores" => {
                let bbox_val = arg_value("bbox")?;
                let bbox: bro_cmd::BBox = serde_json::from_value(bbox_val)
                    .map_err(|e| format!("Invalid bbox: {}", e))?;
                let features = tokio_rt().block_on(bro_cmd::fetch_bro_bores_core(bbox))?;
                serde_json::to_string_pretty(&features).map_err(|e| e.to_string())
            }
            "bro_fetch_cpt" => {
                let bro_id = arg_str("bro_id")?;
                let xml = tokio_rt().block_on(bro_cmd::fetch_bro_cpt_core(&bro_id))?;
                Ok(xml)
            }
            "bro_fetch_bore" => {
                let bro_id = arg_str("bro_id")?;
                let xml = tokio_rt().block_on(bro_cmd::fetch_bro_bore_core(&bro_id))?;
                Ok(xml)
            }
            "bro_fetch_object_metadata" => {
                let id = arg_str("id")?;
                let kind = arg_str("kind")?;
                let meta = tokio_rt()
                    .block_on(bro_cmd::fetch_bro_object_metadata_core(&id, &kind))?;
                serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())
            }

            // ─── IFC (async) ───────────────────────────────────────────
            "ifc_generate" => {
                let project_val = arg_value("project")?;
                let project: ifc_cmd::ProjectMetaInput = serde_json::from_value(project_val)
                    .map_err(|e| format!("Invalid project meta: {}", e))?;
                let cpt_ids_val = arg_value("cpt_ids")?;
                let cpt_ids: Vec<String> = serde_json::from_value(cpt_ids_val)
                    .map_err(|e| format!("Invalid cpt_ids: {}", e))?;
                let format = arg_str("format")?;
                // Snapshot CPTs zodat de async-werker zonder lock kan draaien.
                let cpts: Vec<Cpt> = self.app_state.with_project(|kernel_project| {
                    cpt_ids
                        .iter()
                        .filter_map(|id| kernel_project.cpts().find(|cpt| cpt.id == *id).cloned())
                        .collect()
                })?;
                let result = tokio_rt()
                    .block_on(ifc_cmd::generate_ifc_core(project, cpts, format))?;
                serde_json::to_string_pretty(&result).map_err(|e| e.to_string())
            }
            "ifc_list_generated" => {
                let project_id = args
                    .get("project_id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let entries = tokio_rt()
                    .block_on(ifc_cmd::list_generated_ifc_core(project_id))?;
                serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())
            }
            "ifc_read_generated" => {
                let full_path = arg_str("full_path")?;
                let content = tokio_rt()
                    .block_on(ifc_cmd::read_generated_ifc_core(&full_path))?;
                Ok(content)
            }

            // ─── Report (async) ────────────────────────────────────────
            "report_preview" => {
                let cpt_ids_val = arg_value("cpt_ids")?;
                let cpt_ids: Vec<String> = serde_json::from_value(cpt_ids_val)
                    .map_err(|e| format!("Invalid cpt_ids: {}", e))?;
                let project_val = arg_value("project")?;
                let project: report_cmd::ProjectMetaInput = serde_json::from_value(project_val)
                    .map_err(|e| format!("Invalid project meta: {}", e))?;
                let cpts: Vec<Cpt> = self.app_state.with_project(|kernel_project| {
                    cpt_ids
                        .iter()
                        .filter_map(|id| kernel_project.cpts().find(|cpt| cpt.id == *id).cloned())
                        .collect()
                })?;
                // Optionele sectie-selectie — zelfde vorm als de GUI/REST
                // (cover, coordTable, map, perCpt, sbtLegend, metadata).
                let sections: Option<cpt_core::ReportSections> = args
                    .get("sections")
                    .cloned()
                    .and_then(|v| serde_json::from_value(v).ok());
                let bytes = tokio_rt()
                    .block_on(report_cmd::preview_report_core(cpts, project, sections))?;
                // PDF-bytes als base64 in JSON-respons — voor stdio-MCP is
                // dat een veilige manier zonder binary corruption.
                use base64::Engine;
                let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                Ok(json!({
                    "format": "pdf-base64",
                    "byte_count": bytes.len(),
                    "data": b64,
                }).to_string())
            }
            "report_generate" => {
                let cpt_ids_val = arg_value("cpt_ids")?;
                let cpt_ids: Vec<String> = serde_json::from_value(cpt_ids_val)
                    .map_err(|e| format!("Invalid cpt_ids: {}", e))?;
                let project_val = arg_value("project")?;
                let project: report_cmd::ProjectMetaInput = serde_json::from_value(project_val)
                    .map_err(|e| format!("Invalid project meta: {}", e))?;
                let output_path = arg_str("output_path")?;
                let cpts: Vec<Cpt> = self.app_state.with_project(|kernel_project| {
                    cpt_ids
                        .iter()
                        .filter_map(|id| kernel_project.cpts().find(|cpt| cpt.id == *id).cloned())
                        .collect()
                })?;
                tokio_rt().block_on(
                    report_cmd::generate_report_core(cpts, project, output_path.clone(), None),
                )?;
                Ok(format!("PDF report saved to {}", output_path))
            }

            // ─── Extensions (sync) ─────────────────────────────────────
            "extensions_list" => {
                let entries = ext_cmd::extensions_list_core(&self.app_state);
                serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())
            }
            "extension_set" => {
                let id = arg_str("id")?;
                let enabled = args
                    .get("enabled")
                    .and_then(|v| v.as_bool())
                    .ok_or_else(|| "Missing or non-boolean 'enabled' argument".to_string())?;
                ext_cmd::extension_set_core(&id, enabled, &self.app_state)?;
                Ok(format!("Extension '{}' set to {}", id, enabled))
            }
            "extensions_set_bulk" => {
                let payload_val = arg_value("payload")?;
                let payload: StdHashMap<String, bool> = serde_json::from_value(payload_val)
                    .map_err(|e| format!("Invalid payload: {}", e))?;
                let count = payload.len();
                ext_cmd::extensions_set_bulk_core(payload, &self.app_state);
                Ok(format!("Updated {} extension state(s)", count))
            }
            "extensions_reset_defaults" => {
                ext_cmd::extensions_reset_defaults_core(&self.app_state);
                Ok("All extensions reset to default (all disabled)".to_string())
            }

            _ => Err(format!("Unknown tool: {}", name)),
        }
    }
}
