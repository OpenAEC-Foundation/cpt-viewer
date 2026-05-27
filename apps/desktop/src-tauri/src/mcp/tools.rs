use serde_json::{json, Value};

/// Return MCP tool definitions for the tools/list endpoint.
///
/// Tools zijn gegroepeerd per domein:
///   - tenant (5): list_tenants, list_templates, get_brand, generate_report, get_app_state
///   - cpt (5): cpt_open, cpt_close, cpt_list, cpt_detect_layers, cpt_save_as
///   - project (5): project_save_ifcgis, project_open_ifcgis,
///     project_save_ifcgis_full, project_open_ifcgis_full, project_preview_ifcx
///   - export (2): export_csv, export_geojson
///
/// Totaal: 17 tools. Async tools (bro_*, ifc_*, report_*) volgen in een
/// vervolg-uitbreiding (vereisen tokio runtime in MCP-mode).
pub fn tool_definitions() -> Vec<Value> {
    let mut tools = Vec::new();
    tools.extend(tenant_tools());
    tools.extend(cpt_tools());
    tools.extend(project_tools());
    tools.extend(export_tools());
    tools
}

fn tenant_tools() -> Vec<Value> {
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
                    "tenant": { "type": "string", "description": "Tenant ID (e.g. 'openaec_foundation')" }
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
                    "tenant": { "type": "string", "description": "Tenant ID" }
                },
                "required": ["tenant"]
            }
        }),
        json!({
            "name": "generate_report",
            "description": "Generate a PDF report (via tenant brand engine) with the given data and save it to disk",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tenant": { "type": "string", "description": "Tenant ID for branding" },
                    "report": { "type": "object", "description": "Report data including template, project info, and sections" },
                    "output_path": { "type": "string", "description": "Full path where the PDF should be saved" }
                },
                "required": ["tenant", "report", "output_path"]
            }
        }),
        json!({
            "name": "get_app_state",
            "description": "Get the current application state (version, available tenants, loaded CPT count, status)",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }),
    ]
}

fn cpt_tools() -> Vec<Value> {
    vec![
        json!({
            "name": "cpt_open",
            "description": "Parse a CPT-bestand (GEF / BRO-XML / .ifcgeo JSON-snapshot) en cache het in de app. Returnt het volledige Cpt-object inclusief metadata, positie en alle meetpunten.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "content": { "type": "string", "description": "Volledige tekstinhoud van het CPT-bestand" },
                    "filename": { "type": "string", "description": "Bestandsnaam — extensie bepaalt parser (.gef, .xml, .ifcgeo)" }
                },
                "required": ["content", "filename"]
            }
        }),
        json!({
            "name": "cpt_close",
            "description": "Verwijder een eerder geopende CPT uit de app-cache (irreversible voor MCP-mode — niet opnieuw oproepbaar zonder cpt_open).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "CPT id zoals teruggegeven door cpt_open" }
                },
                "required": ["id"]
            }
        }),
        json!({
            "name": "cpt_list",
            "description": "Geeft alle CPTs uit de app-cache terug (volledig object per CPT, inclusief meetpunten).",
            "inputSchema": { "type": "object", "properties": {}, "required": [] }
        }),
        json!({
            "name": "cpt_detect_layers",
            "description": "Detecteer grondlagen voor een CPT via Robertson-classificatie. Returnt een lijst van Layer-objecten met depth_top/depth_bottom en zone_naam/kleur.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "CPT id" }
                },
                "required": ["id"]
            }
        }),
        json!({
            "name": "cpt_save_as",
            "description": "Exporteer een CPT in een specifiek formaat naar schijf. Format: 'gef' | 'bro' | 'xml' | 'ifcgeo'.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "cpt_id": { "type": "string", "description": "CPT id" },
                    "format": { "type": "string", "enum": ["gef", "bro", "xml", "ifcgeo"] },
                    "path": { "type": "string", "description": "Absoluut pad waar het bestand wordt geschreven" }
                },
                "required": ["cpt_id", "format", "path"]
            }
        }),
    ]
}

fn project_tools() -> Vec<Value> {
    vec![
        json!({
            "name": "project_save_ifcgis",
            "description": "Sla het huidige project (project-metadata + alle geladen CPTs uit de cache) op als minimalistisch .ifcgis-bestand.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": {
                        "type": "object",
                        "description": "Projectmetadata",
                        "properties": {
                            "title": { "type": "string" },
                            "client": { "type": "string" },
                            "location": { "type": "string" },
                            "project_number": { "type": "string" },
                            "author": { "type": "string" },
                            "date": { "type": "string", "description": "ISO 8601 YYYY-MM-DD" }
                        },
                        "required": ["title", "client", "location", "project_number", "author", "date"]
                    },
                    "path": { "type": "string", "description": "Doelpad voor .ifcgis" }
                },
                "required": ["project", "path"]
            }
        }),
        json!({
            "name": "project_open_ifcgis",
            "description": "Open een .ifcgis-bestand (minimalistisch formaat), merge de CPTs in de app-cache en geef project-meta + CPTs terug.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string" }
                },
                "required": ["path"]
            }
        }),
        json!({
            "name": "project_save_ifcgis_full",
            "description": "Sla een volledige ProjectFile-payload op als strict IFCX-JSON (.ifcgis). Includes bores, tekening-layout, title-block, CRS, GIS, deliverable.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "payload": { "type": "object", "description": "Volledige ifcgis ProjectFile JSON-structuur" },
                    "path": { "type": "string" }
                },
                "required": ["payload", "path"]
            }
        }),
        json!({
            "name": "project_open_ifcgis_full",
            "description": "Open een volledig .ifcgis-bestand, merge CPTs in de cache, geef de complete JSON-structuur terug (project + bores + tekening + ...).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string" }
                },
                "required": ["path"]
            }
        }),
        json!({
            "name": "project_preview_ifcx",
            "description": "Converteer een ProjectFile-payload naar strict IFCX-JSON zonder naar schijf te schrijven (voor preview-doeleinden).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "payload": { "type": "object" }
                },
                "required": ["payload"]
            }
        }),
    ]
}

fn export_tools() -> Vec<Value> {
    vec![
        json!({
            "name": "export_csv",
            "description": "Exporteer één CPT naar CSV (kolommen: depth, depth_nap, qc, fs, rf, u2, inclination).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "cpt_id": { "type": "string" },
                    "path": { "type": "string", "description": "Doelpad voor .csv" }
                },
                "required": ["cpt_id", "path"]
            }
        }),
        json!({
            "name": "export_geojson",
            "description": "Exporteer meerdere CPTs naar GeoJSON FeatureCollection (Point-features in WGS84, inclusief metadata properties).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "cpt_ids": { "type": "array", "items": { "type": "string" } },
                    "path": { "type": "string", "description": "Doelpad voor .geojson" }
                },
                "required": ["cpt_ids", "path"]
            }
        }),
    ]
}
