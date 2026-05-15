use serde::{Deserialize, Serialize};

/// Root report data — passed from frontend via Tauri invoke.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportData {
    /// Template name (e.g. "constructie_rapport")
    pub template: String,
    /// Page format
    #[serde(default = "default_format")]
    pub format: PageFormat,
    /// Page orientation
    #[serde(default = "default_orientation")]
    pub orientation: Orientation,

    // Project metadata
    pub project: String,
    #[serde(default)]
    pub project_number: String,
    #[serde(default)]
    pub address: String,
    #[serde(default)]
    pub client: String,
    #[serde(default)]
    pub architect: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub date: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub phase: String,
    #[serde(default)]
    pub drawing_type: String,
    #[serde(default)]
    pub drawing_number: String,
    #[serde(default)]
    pub scale: String,
    #[serde(default)]
    pub revision: String,

    /// Report sections with content blocks
    #[serde(default)]
    pub sections: Vec<Section>,
}

fn default_format() -> PageFormat {
    PageFormat::A3
}
fn default_orientation() -> Orientation {
    Orientation::Landscape
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PageFormat {
    A4,
    A3,
}

impl PageFormat {
    /// Page width in mm.
    pub fn width_mm(&self, orientation: &Orientation) -> f64 {
        match (self, orientation) {
            (PageFormat::A4, Orientation::Portrait) => 210.0,
            (PageFormat::A4, Orientation::Landscape) => 297.0,
            (PageFormat::A3, Orientation::Portrait) => 297.0,
            (PageFormat::A3, Orientation::Landscape) => 420.0,
        }
    }

    /// Page height in mm.
    pub fn height_mm(&self, orientation: &Orientation) -> f64 {
        match (self, orientation) {
            (PageFormat::A4, Orientation::Portrait) => 297.0,
            (PageFormat::A4, Orientation::Landscape) => 210.0,
            (PageFormat::A3, Orientation::Portrait) => 420.0,
            (PageFormat::A3, Orientation::Landscape) => 297.0,
        }
    }

    pub fn label(&self) -> &str {
        match self {
            PageFormat::A4 => "A4",
            PageFormat::A3 => "A3",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Orientation {
    Portrait,
    Landscape,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Section {
    pub title: String,
    #[serde(default)]
    pub level: u8,
    #[serde(default)]
    pub blocks: Vec<ContentBlock>,
    #[serde(default)]
    pub page_break_before: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ContentBlock {
    #[serde(rename = "paragraph")]
    Paragraph { text: String },
    #[serde(rename = "heading")]
    Heading { text: String, level: Option<u8> },
    #[serde(rename = "table")]
    Table {
        headers: Vec<String>,
        rows: Vec<Vec<String>>,
        #[serde(default)]
        col_widths: Vec<f64>,
    },
    #[serde(rename = "calculation")]
    Calculation {
        formula: String,
        result: String,
        unit: String,
    },
    #[serde(rename = "check")]
    Check {
        label: String,
        calculated: f64,
        limit: f64,
        unity: f64,
    },
    #[serde(rename = "spacer")]
    Spacer { height_mm: f64 },
    #[serde(rename = "page_break")]
    PageBreak,
}

/// Info about an available template.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateInfo {
    pub name: String,
    pub description: String,
    pub format: String,
    pub orientation: String,
}

/// Info about an available tenant.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TenantInfo {
    pub id: String,
    pub name: String,
}
