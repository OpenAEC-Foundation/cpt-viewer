use crate::pdf::brand::BrandConfig;
use crate::pdf::model::{TenantInfo, TemplateInfo};
use std::path::{Path, PathBuf};

/// Multi-tenant configuration manager.
/// Resolves tenant directories and loads brand/template configs.
pub struct TenantManager {
    tenants_root: PathBuf,
}

impl TenantManager {
    pub fn new(tenants_root: PathBuf) -> Self {
        TenantManager { tenants_root }
    }

    /// List all available tenants (directories under tenants_root, excluding _shared).
    pub fn list_tenants(&self) -> Result<Vec<TenantInfo>, String> {
        let mut tenants = Vec::new();
        let entries = std::fs::read_dir(&self.tenants_root)
            .map_err(|e| format!("Cannot read tenants directory: {}", e))?;

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                if name.starts_with('_') {
                    continue;
                }
                // Only include directories that have a brand.yaml
                if path.join("brand.yaml").exists() {
                    let brand = BrandConfig::load(&path.join("brand.yaml")).ok();
                    tenants.push(TenantInfo {
                        id: name.clone(),
                        name: brand
                            .map(|b| b.brand.name.clone())
                            .unwrap_or(name),
                    });
                }
            }
        }
        Ok(tenants)
    }

    /// Get the directory path for a tenant.
    pub fn tenant_dir(&self, tenant_id: &str) -> PathBuf {
        self.tenants_root.join(tenant_id)
    }

    /// Load brand config for a tenant.
    pub fn load_brand(&self, tenant_id: &str) -> Result<BrandConfig, String> {
        let brand_path = self.tenant_dir(tenant_id).join("brand.yaml");
        BrandConfig::load(&brand_path)
    }

    /// List available templates for a tenant.
    pub fn list_templates(&self, tenant_id: &str) -> Result<Vec<TemplateInfo>, String> {
        let templates_dir = self.tenant_dir(tenant_id).join("templates");
        if !templates_dir.exists() {
            return Ok(Vec::new());
        }

        let mut templates = Vec::new();
        let entries = std::fs::read_dir(&templates_dir)
            .map_err(|e| format!("Cannot read templates directory: {}", e))?;

        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "yaml" || e == "yml").unwrap_or(false) {
                if let Ok(content) = std::fs::read_to_string(&path) {
                    if let Ok(val) = serde_yaml::from_str::<serde_yaml::Value>(&content) {
                        let name = val.get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("Unknown")
                            .to_string();
                        let desc = val.get("description")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let format = val.get("format")
                            .and_then(|v| v.as_str())
                            .unwrap_or("A3")
                            .to_string();
                        let orientation = val.get("orientation")
                            .and_then(|v| v.as_str())
                            .unwrap_or("landscape")
                            .to_string();

                        templates.push(TemplateInfo {
                            name,
                            description: desc,
                            format,
                            orientation,
                        });
                    }
                }
            }
        }
        Ok(templates)
    }

    /// Resolve a font file path with fallback chain:
    /// 1. Tenant fonts directory
    /// 2. _shared/fonts directory
    pub fn resolve_font_path(&self, tenant_id: &str, relative_path: &str) -> Option<PathBuf> {
        // Tenant-specific
        let tenant_path = self.tenant_dir(tenant_id).join(relative_path);
        if tenant_path.exists() {
            return Some(tenant_path);
        }

        // Shared fallback
        let shared_path = self.tenants_root.join("_shared").join(
            Path::new(relative_path).file_name().unwrap_or_default(),
        );
        if shared_path.exists() {
            return Some(shared_path);
        }

        None
    }
}
