use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
use std::sync::{Arc, Mutex};

use super::tools;
use crate::commands::{cpt as cpt_cmd, export as export_cmd, project as project_cmd};
use crate::pdf::model::{ReportData, TenantInfo};
use crate::pdf::tenant::TenantManager;
use crate::state::AppState;

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
                let cpts_count = self.app_state.cpts.lock().map_err(|e| e.to_string())?.len();
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

            _ => Err(format!("Unknown tool: {}", name)),
        }
    }
}
