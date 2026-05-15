use crate::pdf::backend::PdfBackend;
use crate::pdf::brand::BrandConfig;
use crate::pdf::colors::Color;
use crate::pdf::fonts::FontEngine;
use crate::pdf::model::ReportData;
use crate::pdf::zones::{draw_gradient_strip, draw_labeled_field, draw_logo_text};

/// Render the voorblad (cover page) title block.
pub fn render_voorblad(
    backend: &mut PdfBackend,
    font_engine: &FontEngine,
    brand: &BrandConfig,
    report: &ReportData,
    page_w_mm: f64,
    page_h_mm: f64,
) {
    let primary = Color::from_hex(brand.resolve_color("$primary"));
    let secondary = Color::from_hex(brand.resolve_color("$secondary"));
    let text_light = Color::from_hex(brand.resolve_color("$text_light"));
    let text_muted = Color::from_hex(brand.resolve_color("$text_muted"));
    let scaffold = Color::from_hex(brand.resolve_color("$scaffold_gray"));

    // --- Geometric element top-left (amber rectangle as approximation of triangle) ---
    backend.draw_rect(0.0, 0.0, 110.0, 110.0, Some(primary), None, 0.0);

    // --- Geometric element bottom-right ---
    backend.draw_rect(page_w_mm - 70.0, page_h_mm - 70.0, 70.0, 70.0, Some(primary), None, 0.0);

    // --- Drawing border ---
    backend.draw_rect(
        7.0, 7.0,
        page_w_mm - 14.0, page_h_mm - 14.0,
        None,
        Some(secondary),
        1.0,
    );

    // --- Document type title ---
    let heading = brand.resolve_font("heading");
    backend.draw_text(
        &report.drawing_type,
        25.0, 80.0,
        heading, 32.0,
        secondary,
    );

    // --- Drawing area outline ---
    backend.draw_rect(
        25.0, 65.0, 210.0, 130.0,
        None,
        Some(Color::from_hex("#D4D4D4")),
        1.0,
    );

    // --- Right info panel ---
    let info_x = 270.0;
    let mono = brand.resolve_font("mono");
    let body_medium = brand.resolve_font("body_medium");

    // Architect
    draw_labeled_field(backend, font_engine, brand,
        "ARCHITECT / ONTWERPER", &report.architect,
        info_x, 68.0, 6.0, 11.0, "body_medium", "$secondary");

    // Client
    draw_labeled_field(backend, font_engine, brand,
        "OPDRACHTGEVER", &report.client,
        info_x, 92.0, 6.0, 11.0, "body_medium", "$secondary");

    // Date
    draw_labeled_field(backend, font_engine, brand,
        "DATUM", &report.date,
        info_x, 122.0, 6.0, 10.0, "mono", "$text_muted");

    // Kenmerk
    draw_labeled_field(backend, font_engine, brand,
        "KENMERK", &report.drawing_number,
        info_x, 142.0, 6.0, 10.0, "mono", "$primary");

    // Fase
    draw_labeled_field(backend, font_engine, brand,
        "FASE", &report.phase,
        info_x, 162.0, 6.0, 10.0, "body", "$text_muted");

    // --- Project name block ---
    let subheading = brand.resolve_font("subheading");
    let body = brand.resolve_font("body");
    backend.draw_text(&report.project, 25.0, 210.0, subheading, 16.0, secondary);
    backend.draw_text(&report.address, 25.0, 220.0, body, 11.0, text_muted);

    // --- Bottom bar (dark) ---
    let bar_y = page_h_mm - 48.0;
    let bar_h = 48.0 - 7.0; // minus border margin
    backend.draw_rect(7.0, bar_y, page_w_mm - 14.0, bar_h, Some(secondary), None, 0.0);

    // Gradient accent strip on top
    draw_gradient_strip(backend, brand, 7.0, bar_y, page_w_mm - 14.0, 1.0);

    // Logo in bar
    draw_logo_text(backend, font_engine, brand, 20.0, bar_y + 16.0, 18.0, true);

    // Foundation sub-label
    backend.draw_text("FOUNDATION", 20.0, bar_y + 26.0, mono, 7.0, scaffold);

    // Metadata fields in bar
    let field_y = bar_y + 12.0;
    let fields = [
        ("PROJECTNR", &report.project_number, 130.0, false),
        ("SCHAAL", &report.scale, 195.0, false),
        ("FORMAAT", &report.format.label().to_string(), 245.0, false),
        ("STATUS", &report.status, 290.0, true),
        ("BLAD", &"Voorblad".to_string(), 370.0, false),
    ];

    for (label, value, x, is_amber) in &fields {
        backend.draw_text(label, *x, field_y, mono, 7.0, scaffold);
        let val_color = if *is_amber { primary } else { text_light };
        backend.draw_text(value, *x, field_y + 10.0, mono, 10.0, val_color);
    }

    // Disclaimer
    backend.draw_text(
        "Tekening ongeschikt voor uitvoeringsfase",
        page_w_mm - 20.0, bar_y - 4.0,
        mono, 5.0, text_muted,
    );
}

/// Render the detailblad (working page) title block at the bottom.
pub fn render_detailblad(
    backend: &mut PdfBackend,
    font_engine: &FontEngine,
    brand: &BrandConfig,
    report: &ReportData,
    page_w_mm: f64,
    page_h_mm: f64,
    sheet_number: usize,
    total_sheets: usize,
) {
    let primary = Color::from_hex(brand.resolve_color("$primary"));
    let secondary = Color::from_hex(brand.resolve_color("$secondary"));
    let text_light = Color::from_hex(brand.resolve_color("$text_light"));
    let scaffold = Color::from_hex(brand.resolve_color("$scaffold_gray"));
    let text_muted = Color::from_hex(brand.resolve_color("$text_muted"));

    let border_margin = 7.0;
    let tb_height = 46.0;
    let tb_y = page_h_mm - border_margin - tb_height;
    let tb_w = page_w_mm - 2.0 * border_margin;

    let mono = brand.resolve_font("mono");
    let heading = brand.resolve_font("heading");
    let body = brand.resolve_font("body");
    let body_medium = brand.resolve_font("body_medium");
    let subheading = brand.resolve_font("subheading");

    // --- Drawing border ---
    backend.draw_rect(
        border_margin, border_margin,
        tb_w, page_h_mm - 2.0 * border_margin,
        None, Some(secondary), 0.75,
    );

    // --- Small logo top-left ---
    draw_logo_text(backend, font_engine, brand, 12.0, 12.0, 11.0, false);

    // --- Gradient accent strip ---
    draw_gradient_strip(backend, brand, border_margin, tb_y, tb_w, 1.0);

    // --- Title block outer rect ---
    backend.draw_rect(border_margin, tb_y, tb_w, tb_height, None, Some(secondary), 0.75);

    // --- Project bar (full width, dark, 13mm high) ---
    let bar_h = 13.0;
    backend.draw_rect(border_margin, tb_y + 1.0, tb_w, bar_h, Some(secondary), None, 0.0);

    // Project bar text
    backend.draw_text(&report.project, border_margin + 10.0, tb_y + 5.0, heading, 12.0, text_light);

    let addr_x = border_margin + 10.0 + font_engine.measure_text(&report.project, heading, 12.0) / crate::pdf::colors::MM_TO_PT + 5.0;
    backend.draw_text(&report.address, addr_x, tb_y + 6.5, body, 9.0, scaffold);

    // Drawing type (right-aligned in bar)
    let dt_w = font_engine.measure_text(&report.drawing_type, subheading, 10.0) / crate::pdf::colors::MM_TO_PT;
    backend.draw_text(&report.drawing_type, page_w_mm - border_margin - dt_w - 10.0, tb_y + 5.5, subheading, 10.0, primary);

    // --- Logo cell (left, dark, spans 2 data rows) ---
    let logo_w = 64.0;
    let data_y = tb_y + 1.0 + bar_h;
    let data_h = tb_height - 1.0 - bar_h;
    backend.draw_rect(border_margin, data_y, logo_w, data_h, Some(secondary), None, 0.0);

    // Logo in cell
    let logo_center_x = border_margin + logo_w / 2.0 - 15.0;
    draw_logo_text(backend, font_engine, brand, logo_center_x, data_y + 10.0, 14.0, true);
    backend.draw_text("FOUNDATION", logo_center_x + 2.0, data_y + 20.0, mono, 7.0, scaffold);

    // --- Format cell (right, dark) ---
    let fmt_w = 64.0;
    let fmt_x = page_w_mm - border_margin - fmt_w;
    backend.draw_rect(fmt_x, data_y, fmt_w, data_h, Some(secondary), None, 0.0);

    // Format label + value
    backend.draw_text("FORMAAT", fmt_x + 18.0, data_y + 6.0, mono, 7.0, scaffold);
    backend.draw_text(report.format.label(), fmt_x + 18.0, data_y + 14.0, heading, 18.0, primary);

    // --- Data fields grid ---
    let data_x = border_margin + logo_w;
    let data_w = page_w_mm - 2.0 * border_margin - logo_w - fmt_w;
    let col_w = data_w / 4.0;
    let row_h = data_h / 2.0;

    // Horizontal divider between rows
    backend.draw_line(data_x, data_y + row_h, data_x + data_w, data_y + row_h, 0.5, Color::from_hex("#D4D4D4"));

    // Vertical dividers
    for i in 1..4 {
        let x = data_x + col_w * i as f64;
        backend.draw_line(x, data_y, x, data_y + data_h, 0.5, Color::from_hex("#D4D4D4"));
    }

    // Row 1 fields
    let r1_fields = [
        ("1E DATUM", &report.date, "$secondary"),
        ("WIJZ.", &report.revision, "$secondary"),
        ("SCHAAL", &report.scale, "$secondary"),
        ("FORMAAT", &report.format.label().to_string(), "$secondary"),
    ];

    for (i, (label, value, color)) in r1_fields.iter().enumerate() {
        let fx = data_x + col_w * i as f64 + 4.0;
        backend.draw_text(label, fx, data_y + 3.0, mono, 6.0, scaffold);
        let vc = Color::from_hex(brand.resolve_color(color));
        backend.draw_text(value, fx, data_y + 9.0, mono, 9.0, vc);
    }

    // Row 2 fields
    let sheet_str = format!("{} / {}", sheet_number, total_sheets);
    let r2_fields = [
        ("PROJECTNR", &report.project_number, "$primary"),
        ("AUTEUR", &report.author, "$secondary"),
        ("KENMERK", &report.drawing_number, "$primary"),
        ("BLAD", &sheet_str, "$secondary"),
    ];

    for (i, (label, value, color)) in r2_fields.iter().enumerate() {
        let fx = data_x + col_w * i as f64 + 4.0;
        let ry = data_y + row_h;
        backend.draw_text(label, fx, ry + 3.0, mono, 6.0, scaffold);
        let vc = Color::from_hex(brand.resolve_color(color));
        backend.draw_text(value, fx, ry + 9.0, mono, 9.0, vc);
    }

    // Disclaimer above titleblock
    backend.draw_text(
        "Tekening ongeschikt voor uitvoeringsfase",
        page_w_mm - border_margin - 5.0, tb_y - 4.0,
        mono, 5.0, scaffold,
    );
}
