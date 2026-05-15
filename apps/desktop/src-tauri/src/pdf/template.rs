use serde::{Deserialize, Serialize};
use std::path::Path;

/// Template configuration loaded from a YAML file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateConfig {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_format")]
    pub format: String,
    #[serde(default = "default_orientation")]
    pub orientation: String,
    #[serde(default)]
    pub page: PageConfig,
    #[serde(default)]
    pub page_types: std::collections::HashMap<String, PageTypeConfig>,
}

fn default_format() -> String { "A3".to_string() }
fn default_orientation() -> String { "landscape".to_string() }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageConfig {
    #[serde(default = "default_width")]
    pub width_mm: f64,
    #[serde(default = "default_height")]
    pub height_mm: f64,
}

impl Default for PageConfig {
    fn default() -> Self {
        PageConfig { width_mm: 420.0, height_mm: 297.0 }
    }
}

fn default_width() -> f64 { 420.0 }
fn default_height() -> f64 { 297.0 }

/// A page type definition from the template.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageTypeConfig {
    #[serde(default)]
    pub border: Option<BorderConfig>,
    #[serde(default)]
    pub zones: Vec<ZoneConfig>,
    #[serde(default)]
    pub header: Option<HeaderConfig>,
    #[serde(default)]
    pub titleblock: Option<TitleBlockConfig>,
    #[serde(default)]
    pub bottom_bar: Option<BottomBarConfig>,
    #[serde(default)]
    pub disclaimer: Option<DisclaimerConfig>,
    /// Inherits layout from another page type
    #[serde(default)]
    pub inherits: Option<String>,
    /// Enable flow layout for content pagination
    #[serde(default)]
    pub flow_layout: bool,
    #[serde(default = "default_content_start")]
    pub content_start_y_mm: f64,
    #[serde(default = "default_footer_y")]
    pub footer_y_mm: f64,
    #[serde(default = "default_column_margin")]
    pub column_margin_mm: f64,
}

fn default_content_start() -> f64 { 25.0 }
fn default_footer_y() -> f64 { 252.0 }
fn default_column_margin() -> f64 { 20.0 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BorderConfig {
    #[serde(default = "default_border_margin")]
    pub margin_mm: f64,
    #[serde(default = "default_stroke_width")]
    pub stroke_width_pt: f64,
    #[serde(default = "default_border_color")]
    pub color: String,
}

fn default_border_margin() -> f64 { 7.0 }
fn default_stroke_width() -> f64 { 0.75 }
fn default_border_color() -> String { "$secondary".to_string() }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZoneConfig {
    #[serde(rename = "type")]
    pub zone_type: String,
    #[serde(default)]
    pub x_mm: f64,
    #[serde(default)]
    pub y_mm: f64,
    #[serde(default)]
    pub w_mm: f64,
    #[serde(default)]
    pub h_mm: f64,
    #[serde(default)]
    pub bind: Option<String>,
    #[serde(rename = "static")]
    #[serde(default)]
    pub static_text: Option<String>,
    #[serde(default)]
    pub font: Option<String>,
    #[serde(default)]
    pub size: Option<f64>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub fill: Option<String>,
    #[serde(default)]
    pub stroke: Option<String>,
    #[serde(default)]
    pub stroke_width_pt: Option<f64>,
    #[serde(default)]
    pub max_width_mm: Option<f64>,
    #[serde(default)]
    pub align: Option<String>,
    #[serde(default)]
    pub clip: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeaderConfig {
    #[serde(default)]
    pub logo: Option<LogoConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogoConfig {
    #[serde(default)]
    pub x_mm: f64,
    #[serde(default)]
    pub y_mm: f64,
    #[serde(default)]
    pub font: Option<String>,
    #[serde(default)]
    pub size: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TitleBlockConfig {
    #[serde(default = "default_tb_y")]
    pub y_mm: f64,
    #[serde(default = "default_tb_height")]
    pub height_mm: f64,
    #[serde(default)]
    pub gradient_strip: bool,
    #[serde(default = "default_gradient_height")]
    pub gradient_height_mm: f64,
    #[serde(default)]
    pub project_bar: Option<ProjectBarConfig>,
    #[serde(default)]
    pub logo_cell: Option<LogoCellConfig>,
    #[serde(default)]
    pub data_rows: Option<DataRowsConfig>,
    #[serde(default)]
    pub format_cell: Option<FormatCellConfig>,
}

fn default_tb_y() -> f64 { 251.0 }
fn default_tb_height() -> f64 { 46.0 }
fn default_gradient_height() -> f64 { 1.0 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectBarConfig {
    #[serde(default = "default_bar_height")]
    pub height_mm: f64,
    #[serde(default)]
    pub background: String,
    #[serde(default)]
    pub fields: Vec<FieldConfig>,
}

fn default_bar_height() -> f64 { 13.0 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldConfig {
    #[serde(default)]
    pub bind: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub font: Option<String>,
    #[serde(default)]
    pub size: Option<f64>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub align: Option<String>,
    #[serde(default)]
    pub x_mm: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogoCellConfig {
    #[serde(default = "default_logo_width")]
    pub width_mm: f64,
    #[serde(default)]
    pub background: String,
    #[serde(default)]
    pub font: Option<String>,
    #[serde(default)]
    pub size: Option<f64>,
}

fn default_logo_width() -> f64 { 64.0 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataRowsConfig {
    #[serde(default)]
    pub row1: Vec<DataFieldConfig>,
    #[serde(default)]
    pub row2: Vec<DataFieldConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataFieldConfig {
    pub bind: String,
    pub label: String,
    #[serde(default)]
    pub font: Option<String>,
    #[serde(default)]
    pub size: Option<f64>,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormatCellConfig {
    #[serde(default = "default_logo_width")]
    pub width_mm: f64,
    #[serde(default)]
    pub background: String,
    #[serde(default)]
    pub bind: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub font: Option<String>,
    #[serde(default)]
    pub size: Option<f64>,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BottomBarConfig {
    pub y_mm: f64,
    pub height_mm: f64,
    #[serde(default)]
    pub background: String,
    #[serde(default)]
    pub gradient_strip: bool,
    #[serde(default = "default_gradient_height")]
    pub gradient_height_mm: f64,
    #[serde(default)]
    pub logo: Option<LogoConfig>,
    #[serde(default)]
    pub fields: Vec<FieldConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisclaimerConfig {
    pub text: String,
    #[serde(default)]
    pub x_mm: Option<f64>,
    #[serde(default)]
    pub y_mm: Option<f64>,
    #[serde(default)]
    pub font: Option<String>,
    #[serde(default)]
    pub size: Option<f64>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub align: Option<String>,
}

impl TemplateConfig {
    /// Load a template from a YAML file.
    pub fn load(path: &Path) -> Result<Self, String> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| format!("Failed to read template: {}", e))?;
        serde_yaml::from_str(&content)
            .map_err(|e| format!("Failed to parse template: {}", e))
    }
}
