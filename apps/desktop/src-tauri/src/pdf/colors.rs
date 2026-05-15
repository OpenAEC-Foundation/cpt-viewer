use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// RGB color in 0.0–1.0 range for PDF rendering.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Color {
    pub r: f32,
    pub g: f32,
    pub b: f32,
}

impl Color {
    pub const WHITE: Color = Color { r: 1.0, g: 1.0, b: 1.0 };
    pub const BLACK: Color = Color { r: 0.0, g: 0.0, b: 0.0 };

    pub fn from_hex(hex: &str) -> Self {
        let hex = hex.trim_start_matches('#');
        let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(0);
        let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(0);
        let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(0);
        Color {
            r: r as f32 / 255.0,
            g: g as f32 / 255.0,
            b: b as f32 / 255.0,
        }
    }

    /// Resolve a color string — either a hex value or a `$token` reference.
    pub fn resolve(value: &str, palette: &HashMap<String, String>) -> Self {
        if let Some(token) = value.strip_prefix('$') {
            if let Some(hex) = palette.get(token) {
                return Self::from_hex(hex);
            }
        }
        Self::from_hex(value)
    }
}

/// Millimeters to PDF points (1 mm = 2.83465 pt).
pub const MM_TO_PT: f64 = 2.834_645_669_3;

/// Convert mm to points.
pub fn mm(val: f64) -> f64 {
    val * MM_TO_PT
}
