use serde_json::{json, Value};

/// Return MCP tool definitions for the tools/list endpoint.
pub fn tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "list_tenants",
            "description": "List all available tenants/organizations with their brand configurations",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }),
        json!({
            "name": "list_templates",
            "description": "List available report templates for a specific tenant",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tenant": {
                        "type": "string",
                        "description": "Tenant ID (e.g. 'openaec_foundation')"
                    }
                },
                "required": ["tenant"]
            }
        }),
        json!({
            "name": "get_brand",
            "description": "Get the brand configuration (colors, fonts, logos) for a tenant",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tenant": {
                        "type": "string",
                        "description": "Tenant ID"
                    }
                },
                "required": ["tenant"]
            }
        }),
        json!({
            "name": "generate_report",
            "description": "Generate a PDF report with the given data and save it to disk",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tenant": {
                        "type": "string",
                        "description": "Tenant ID for branding"
                    },
                    "report": {
                        "type": "object",
                        "description": "Report data including template, project info, and sections"
                    },
                    "output_path": {
                        "type": "string",
                        "description": "Full path where the PDF should be saved"
                    }
                },
                "required": ["tenant", "report", "output_path"]
            }
        }),
        json!({
            "name": "get_app_state",
            "description": "Get the current application state (version, available tenants, status)",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }),
    ]
}
