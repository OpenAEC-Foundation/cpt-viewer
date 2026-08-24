use serde_json::{json, Value};

/// Return MCP tool definitions for the tools/list endpoint.
///
/// Tools zijn gegroepeerd per domein (totaal 31):
///   - tenant (5): list_tenants, list_templates, get_brand, generate_report, get_app_state
///   - cpt (5): cpt_open, cpt_close, cpt_list, cpt_detect_layers, cpt_save_as
///   - project (5): project_save_ifcgis, project_open_ifcgis,
///     project_save_ifcgis_full, project_open_ifcgis_full, project_preview_ifcx
///   - export (2): export_csv, export_geojson
///   - bro (5): bro_fetch_area, bro_fetch_bores, bro_fetch_cpt,
///     bro_fetch_bore, bro_fetch_object_metadata
///   - ifc (3): ifc_generate, ifc_list_generated, ifc_read_generated
///   - report (2): report_preview, report_generate
///   - extensions (4): extensions_list, extension_set,
///     extensions_set_bulk, extensions_reset_defaults
pub fn tool_definitions() -> Vec<Value> {
    let mut tools = Vec::new();
    tools.extend(tenant_tools());
    tools.extend(cpt_tools());
    tools.extend(project_tools());
    tools.extend(export_tools());
    tools.extend(bro_tools());
    tools.extend(ifc_tools());
    tools.extend(report_tools());
    tools.extend(extension_tools());
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

fn bro_tools() -> Vec<Value> {
    let bbox_schema = json!({
        "type": "object",
        "description": "Bounding box in WGS84",
        "properties": {
            "min_lat": { "type": "number" },
            "min_lon": { "type": "number" },
            "max_lat": { "type": "number" },
            "max_lon": { "type": "number" }
        },
        "required": ["min_lat", "min_lon", "max_lat", "max_lon"]
    });
    vec![
        json!({
            "name": "bro_fetch_area",
            "description": "Zoek BRO CPT-sonderingen in een bounding box via de publieke BRO REST API. Returnt een lijst van BroFeature met BRO-id, WGS84 lat/lon, einddiepte, kwaliteitsklasse, etc.",
            "inputSchema": {
                "type": "object",
                "properties": { "bbox": bbox_schema },
                "required": ["bbox"]
            }
        }),
        json!({
            "name": "bro_fetch_bores",
            "description": "Zoek BRO BHR-GT geotechnische boringen in een bounding box. Zelfde shape als bro_fetch_area maar voor boringen.",
            "inputSchema": {
                "type": "object",
                "properties": { "bbox": bbox_schema.clone() },
                "required": ["bbox"]
            }
        }),
        json!({
            "name": "bro_fetch_cpt",
            "description": "Haal de volledige BRO CPT XML op voor een specifieke BRO-id (gebruik daarna cpt_open om hem in de cache te krijgen).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "bro_id": { "type": "string", "description": "BRO-id (bv. CPT000000004317)" }
                },
                "required": ["bro_id"]
            }
        }),
        json!({
            "name": "bro_fetch_bore",
            "description": "Haal de volledige BRO BHR-GT XML op voor een boring-BRO-id.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "bro_id": { "type": "string" }
                },
                "required": ["bro_id"]
            }
        }),
        json!({
            "name": "bro_fetch_object_metadata",
            "description": "Haal flatten BRO-metadata op voor een CPT of boring (key/value map, gefilterd op interessante velden zoals broId, finalDepth, qualityClass).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "kind": { "type": "string", "enum": ["cpt", "bore", "bhrgt"] }
                },
                "required": ["id", "kind"]
            }
        }),
    ]
}

fn ifc_tools() -> Vec<Value> {
    vec![
        json!({
            "name": "ifc_generate",
            "description": "Genereer een IFC-document (IFC4x3 of IFCX-JSON) voor een project + lijst CPT-ids. Slaat het bestand op in een per-sessie cache-directory en returnt content + metadata.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": {
                        "type": "object",
                        "properties": {
                            "id": { "type": "string" },
                            "title": { "type": "string" },
                            "client": { "type": "string" },
                            "location": { "type": "string" },
                            "project_number": { "type": "string" },
                            "author": { "type": "string" },
                            "date": { "type": "string", "description": "ISO 8601 YYYY-MM-DD" }
                        },
                        "required": ["title", "date"]
                    },
                    "cpt_ids": { "type": "array", "items": { "type": "string" } },
                    "format": { "type": "string", "enum": ["ifc4x3", "ifcx"] }
                },
                "required": ["project", "cpt_ids", "format"]
            }
        }),
        json!({
            "name": "ifc_list_generated",
            "description": "Lijst eerder gegenereerde IFC-bestanden (newest first) voor een project_id of de default-bucket.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project_id": { "type": "string" }
                },
                "required": []
            }
        }),
        json!({
            "name": "ifc_read_generated",
            "description": "Lees een eerder gegenereerd IFC-bestand terug uit de cache via volledig pad (uit ifc_list_generated.full_path).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "full_path": { "type": "string" }
                },
                "required": ["full_path"]
            }
        }),
    ]
}

fn extension_tools() -> Vec<Value> {
    vec![
        json!({
            "name": "extensions_list",
            "description": "Lijst alle bekende app-extensies (tekening, offertes, calc-modules) met hun huidige enabled/disabled status. Onbekende custom-IDs die via extension_set zijn ingesteld worden ook gerapporteerd met known=false. NB: deze state is op dit moment MCP-lokaal — sync met de GUI-preferences.json is een vervolg-feature.",
            "inputSchema": { "type": "object", "properties": {}, "required": [] }
        }),
        json!({
            "name": "extension_set",
            "description": "Zet de enabled-state van één extension. Bekende IDs: 'tekening', 'offertes', 'calc.pile-bearing-capacity', 'calc.kalendering', 'calc.spread-foundation-drained', 'calc.spread-foundation-undrained', 'calc.laterally-loaded-pile', 'calc.sheet-pile-wall', 'calc.ground-anchor'. Custom IDs zijn toegestaan.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "ExtensionId (string)" },
                    "enabled": { "type": "boolean" }
                },
                "required": ["id", "enabled"]
            }
        }),
        json!({
            "name": "extensions_set_bulk",
            "description": "Zet meerdere extension-states tegelijk via een map { id: enabled }. Handig om bv. de GUI-state in één call te kopiëren naar de MCP-state.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "payload": {
                        "type": "object",
                        "description": "Map met ExtensionId-strings als keys en booleans als values",
                        "additionalProperties": { "type": "boolean" }
                    }
                },
                "required": ["payload"]
            }
        }),
        json!({
            "name": "extensions_reset_defaults",
            "description": "Reset alle extension-states naar de default (alles UIT — zelfde gedrag als een fresh-install GUI). Onbekende custom-IDs worden verwijderd.",
            "inputSchema": { "type": "object", "properties": {}, "required": [] }
        }),
    ]
}

fn report_tools() -> Vec<Value> {
    let project_meta_schema = json!({
        "type": "object",
        "properties": {
            "title": { "type": "string" },
            "client": { "type": "string" },
            "location": { "type": "string" },
            "project_number": { "type": "string" },
            "author": { "type": "string" },
            "date": { "type": "string", "description": "ISO 8601 YYYY-MM-DD" }
        },
        "required": ["title", "client", "location", "project_number", "author", "date"]
    });
    vec![
        json!({
            "name": "report_preview",
            "description": "Genereer PDF-rapport bytes in-memory (base64-geserialiseerd in JSON-respons) voor een lijst CPT-ids + project-meta. Geschikt voor preview zonder schijf-write.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "cpt_ids": { "type": "array", "items": { "type": "string" } },
                    "project": project_meta_schema.clone(),
                    "sections": {
                        "type": "object",
                        "description": "Optionele sectie-selectie; weggelaten = alle standaard-secties.",
                        "properties": {
                            "cover":      { "type": "boolean" },
                            "coordTable": { "type": "boolean" },
                            "map":        { "type": "boolean" },
                            "perCpt":     { "type": "boolean" },
                            "sbtLegend":  { "type": "boolean" },
                            "metadata":   { "type": "boolean" }
                        }
                    }
                },
                "required": ["cpt_ids", "project"]
            }
        }),
        json!({
            "name": "report_generate",
            "description": "Genereer PDF-rapport voor een lijst CPT-ids + project-meta en schrijf direct naar schijf op output_path.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "cpt_ids": { "type": "array", "items": { "type": "string" } },
                    "project": project_meta_schema,
                    "output_path": { "type": "string", "description": "Doelpad voor .pdf" }
                },
                "required": ["cpt_ids", "project", "output_path"]
            }
        }),
    ]
}
