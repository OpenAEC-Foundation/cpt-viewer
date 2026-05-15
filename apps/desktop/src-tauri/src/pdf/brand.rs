use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Brand configuration loaded from brand.yaml.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrandConfig {
    pub brand: BrandIdentity,
    pub colors: HashMap<String, String>,
    pub fonts: HashMap<String, String>,
    pub font_files: HashMap<String, String>,
    #[serde(default)]
    pub margins: Margins,
    #[serde(default)]
    pub gradient: GradientConfig,

    /// Runtime: resolved base directory for this tenant
    #[serde(skip)]
    pub base_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrandIdentity {
    pub name: String,
    #[serde(default)]
    pub short_name: String,
    #[serde(default)]
    pub tagline: String,
    #[serde(default)]
    pub secondary_tagline: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Margins {
    #[serde(default = "default_margin")]
    pub top_mm: f64,
    #[serde(default = "default_margin")]
    pub bottom_mm: f64,
    #[serde(default = "default_margin")]
    pub left_mm: f64,
    #[serde(default = "default_margin")]
    pub right_mm: f64,
}

impl Default for Margins {
    fn default() -> Self {
        Margins {
            top_mm: 20.0,
            bottom_mm: 20.0,
            left_mm: 20.0,
            right_mm: 20.0,
        }
    }
}

fn default_margin() -> f64 {
    20.0
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GradientConfig {
    #[serde(default)]
    pub accent_strip: Vec<String>,
}

impl BrandConfig {
    /// Load brand config from a YAML file.
    pub fn load(path: &Path) -> Result<Self, String> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| format!("Failed to read brand.yaml: {}", e))?;
        let mut config: BrandConfig = serde_yaml::from_str(&content)
            .map_err(|e| format!("Failed to parse brand.yaml: {}", e))?;
        config.base_dir = path.parent().unwrap_or(Path::new(".")).to_path_buf();
        Ok(config)
    }

    /// Resolve a font role (e.g. "heading") to the actual font name.
    pub fn resolve_font(&self, role: &str) -> &str {
        self.fonts.get(role).map(|s| s.as_str()).unwrap_or("Inter-Regular")
    }

    /// Resolve a color token (e.g. "$primary") to hex string.
    pub fn resolve_color<'a>(&'a self, token: &'a str) -> &'a str {
        if let Some(key) = token.strip_prefix('$') {
            self.colors.get(key).map(|s| s.as_str()).unwrap_or("#000000")
        } else {
            token
        }
    }

    /// Get the path to a font file.
    pub fn font_path(&self, font_name: &str) -> Option<PathBuf> {
        self.font_files.get(font_name).map(|rel| self.base_dir.join(rel))
    }
}
