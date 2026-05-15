use crate::pdf::backend::PdfBackend;
use crate::pdf::brand::BrandConfig;
use crate::pdf::colors::{Color, mm};
use crate::pdf::fonts::FontEngine;
use crate::pdf::text::wrap_text;
use std::collections::HashMap;

/// Resolve a data binding path against report data (JSON-like).
pub fn resolve_bind(data: &serde_json::Value, bind: &str) -> Option<String> {
    let parts: Vec<&str> = bind.split('.').collect();
    let mut current = data;
    for part in parts {
        match current {
            serde_json::Value::Object(map) => {
                current = map.get(part)?;
            }
            _ => return None,
        }
    }
    match current {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        serde_json::Value::Bool(b) => Some(b.to_string()),
        _ => Some(current.to_string()),
    }
}

/// Draw a text zone with optional wrapping.
pub fn draw_text_zone(
    backend: &mut PdfBackend,
    font_engine: &FontEngine,
    brand: &BrandConfig,
    text: &str,
    x_mm: f64,
    y_mm: f64,
    font_role: &str,
    size: f64,
    color_token: &str,
    max_width_mm: Option<f64>,
    _align: Option<&str>,
) {
    let font_name = brand.resolve_font(font_role);
    let color_hex = brand.resolve_color(color_token);
    let color = Color::from_hex(color_hex);
    let line_height = size * 1.3;

    if let Some(max_w) = max_width_mm {
        let lines = wrap_text(text, mm(max_w), font_name, size, font_engine);
        for (i, line) in lines.iter().enumerate() {
            let y_offset = y_mm + (i as f64) * (line_height / crate::pdf::colors::MM_TO_PT);
            backend.draw_text(line, x_mm, y_offset, font_name, size, color);
        }
    } else {
        backend.draw_text(text, x_mm, y_mm, font_name, size, color);
    }
}

/// Draw a labeled field (label above, value below).
pub fn draw_labeled_field(
    backend: &mut PdfBackend,
    font_engine: &FontEngine,
    brand: &BrandConfig,
    label: &str,
    value: &str,
    x_mm: f64,
    y_mm: f64,
    label_size: f64,
    value_size: f64,
    value_font: &str,
    value_color: &str,
) {
    let mono = brand.resolve_font("mono");
    let label_color = Color::from_hex(brand.resolve_color("$scaffold_gray"));
    backend.draw_text(label, x_mm, y_mm, mono, label_size, label_color);

    let font_name = brand.resolve_font(value_font);
    let color = Color::from_hex(brand.resolve_color(value_color));
    backend.draw_text(value, x_mm, y_mm + 3.5, font_name, value_size, color);
}

/// Draw the gradient accent strip.
pub fn draw_gradient_strip(
    backend: &mut PdfBackend,
    brand: &BrandConfig,
    x_mm: f64,
    y_mm: f64,
    width_mm: f64,
    height_mm: f64,
) {
    let colors = &brand.gradient.accent_strip;
    if colors.len() < 2 {
        // Fallback to primary
        let c = Color::from_hex(brand.resolve_color("$primary"));
        backend.draw_rect(x_mm, y_mm, width_mm, height_mm, Some(c), None, 0.0);
        return;
    }

    // Approximate gradient with 3 color bands
    let segment_w = width_mm / colors.len() as f64;
    for (i, hex) in colors.iter().enumerate() {
        let c = Color::from_hex(hex);
        backend.draw_rect(
            x_mm + i as f64 * segment_w,
            y_mm,
            segment_w + 0.5, // slight overlap to prevent gaps
            height_mm,
            Some(c),
            None,
            0.0,
        );
    }
}

/// Draw the OpenAEC logo text (Open + AEC in brand color).
pub fn draw_logo_text(
    backend: &mut PdfBackend,
    font_engine: &FontEngine,
    brand: &BrandConfig,
    x_mm: f64,
    y_mm: f64,
    size: f64,
    on_dark: bool,
) {
    let font_name = brand.resolve_font("heading");
    let open_color = if on_dark {
        Color::from_hex(brand.resolve_color("$text_light"))
    } else {
        Color::from_hex(brand.resolve_color("$secondary"))
    };
    let aec_color = Color::from_hex(brand.resolve_color("$primary"));

    // Draw "Open"
    backend.draw_text("Open", x_mm, y_mm, font_name, size, open_color);
    let open_width = font_engine.measure_text("Open", font_name, size);
    let x_aec = x_mm + open_width / crate::pdf::colors::MM_TO_PT;
    backend.draw_text("AEC", x_aec, y_mm, font_name, size, aec_color);
}
