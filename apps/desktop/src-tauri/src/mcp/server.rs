use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
use std::sync::{Arc, Mutex};

use super::tools;
use crate::pdf::model::{ReportData, TemplateInfo, TenantInfo};
use crate::pdf::tenant::TenantManager;

/// JSON-RPC request (MCP protocol)
#[derive(Deserialize, Debug)]
struct JsonRpcRequest {
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

/// MCP Server state
pub struct McpServer {
    tenant_manager: Arc<Mutex<TenantManager>>,
}

impl McpServer {
    pub fn new(tenant_manager: Arc<Mutex<TenantManager>>) -> Self {
        Self { tenant_manager }
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
        let tm = self.tenant_manager.lock().map_err(|e| e.to_string())?;

        match name {
            "list_tenants" => {
                let tenants = tm.list_tenants()?;
                serde_json::to_string_pretty(&tenants).map_err(|e| e.to_string())
            }

            "list_templates" => {
                let tenant = args.get("tenant")
                    .and_then(|v| v.as_str())
                    .ok_or("Missing 'tenant' argument")?;
                let templates = tm.list_templates(tenant)?;
                serde_json::to_string_pretty(&templates).map_err(|e| e.to_string())
            }

            "get_brand" => {
                let tenant = args.get("tenant")
                    .and_then(|v| v.as_str())
                    .ok_or("Missing 'tenant' argument")?;
                let brand = tm.load_brand(tenant)?;
                serde_json::to_string_pretty(&brand).map_err(|e| e.to_string())
            }

            "generate_report" => {
                let tenant = args.get("tenant")
                    .and_then(|v| v.as_str())
                    .ok_or("Missing 'tenant' argument")?;
                let report_data = args.get("report")
                    .ok_or("Missing 'report' argument")?;
                let report: ReportData = serde_json::from_value(report_data.clone())
                    .map_err(|e| format!("Invalid report data: {}", e))?;
                let output_path = args.get("output_path")
                    .and_then(|v| v.as_str())
                    .ok_or("Missing 'output_path' argument")?;

                let engine = crate::pdf::engine::ReportEngine::new(
                    TenantManager::new(tm.tenant_dir(tenant).parent().unwrap().to_path_buf())
                );
                let bytes = engine.generate(&report, tenant)?;
                std::fs::write(output_path, &bytes)
                    .map_err(|e| format!("Failed to write PDF: {}", e))?;

                Ok(format!("PDF generated: {} ({} bytes)", output_path, bytes.len()))
            }

            "get_app_state" => {
                Ok(json!({
                    "status": "running",
                    "version": env!("CARGO_PKG_VERSION"),
                    "tenants_available": tm.list_tenants().unwrap_or_default().len()
                }).to_string())
            }

            _ => Err(format!("Unknown tool: {}", name)),
        }
    }
}
