use crate::pdf::backend::PdfBackend;
use crate::pdf::brand::BrandConfig;
use crate::pdf::colors::{Color, mm};
use crate::pdf::fonts::FontEngine;
use crate::pdf::model::{ContentBlock, ReportData, Section};
use crate::pdf::tenant::TenantManager;
use crate::pdf::text::wrap_text;
use crate::pdf::titleblock;
use crate::pdf::zones::draw_logo_text;

/// Report engine: orchestrates template + data + brand → PDF bytes.
pub struct ReportEngine {
    tenant_manager: TenantManager,
}

impl ReportEngine {
    pub fn new(tenant_manager: TenantManager) -> Self {
        ReportEngine { tenant_manager }
    }

    /// Generate a PDF from report data.
    pub fn generate(&self, report: &ReportData, tenant_id: &str) -> Result<Vec<u8>, String> {
        // Load brand
        let brand = self.tenant_manager.load_brand(tenant_id)?;

        // Initialize font engine
        let mut font_engine = FontEngine::new();
        self.load_fonts(&mut font_engine, &brand, tenant_id)?;

        // Initialize PDF backend
        let mut backend = PdfBackend::new();

        // Register fonts in backend
        for name in font_engine.font_names() {
            if let Some(data) = font_engine.font_data(name) {
                backend.register_font(name, data);
            }
        }

        // Page dimensions
        let w = report.format.width_mm(&report.orientation);
        let h = report.format.height_mm(&report.orientation);

        // Count total pages (1 cover + content pages)
        let total_pages = 1 + self.estimate_content_pages(report, &font_engine, &brand, w, h);

        // --- Page 1: Voorblad ---
        backend.new_page(w, h);
        titleblock::render_voorblad(&mut backend, &font_engine, &brand, report, w, h);

        // --- Content pages ---
        if !report.sections.is_empty() {
            self.render_content_pages(
                &mut backend,
                &font_engine,
                &brand,
                report,
                w,
                h,
                total_pages,
            );
        }

        backend.finish()
    }

    fn load_fonts(
        &self,
        font_engine: &mut FontEngine,
        brand: &BrandConfig,
        tenant_id: &str,
    ) -> Result<(), String> {
        for (font_name, relative_path) in &brand.font_files {
            if let Some(path) = self.tenant_manager.resolve_font_path(tenant_id, relative_path) {
                font_engine.load_font(font_name, &path)?;
            }
        }
        Ok(())
    }

    fn estimate_content_pages(
        &self,
        report: &ReportData,
        font_engine: &FontEngine,
        brand: &BrandConfig,
        page_w_mm: f64,
        page_h_mm: f64,
    ) -> usize {
        if report.sections.is_empty() {
            return 0;
        }

        let content_height = page_h_mm - 7.0 - 46.0 - 22.0; // border - titleblock - header
        let mut y = 0.0;
        let mut pages = 1;
        let body_font = brand.resolve_font("body");
        let content_w_mm = page_w_mm - 14.0 - 40.0; // margins

        for section in &report.sections {
            y += 12.0; // section title height
            for block in &section.blocks {
                let block_h = self.estimate_block_height(block, font_engine, body_font, content_w_mm);
                y += block_h;
                if y > content_height {
                    pages += 1;
                    y = block_h;
                }
            }
        }

        pages
    }

    fn estimate_block_height(
        &self,
        block: &ContentBlock,
        font_engine: &FontEngine,
        body_font: &str,
        content_w_mm: f64,
    ) -> f64 {
        match block {
            ContentBlock::Paragraph { text } => {
                let lines = wrap_text(text, mm(content_w_mm), body_font, 10.0, font_engine);
                lines.len() as f64 * 5.0 + 3.0
            }
            ContentBlock::Heading { .. } => 10.0,
            ContentBlock::Table { rows, .. } => (rows.len() as f64 + 1.0) * 6.0 + 4.0,
            ContentBlock::Calculation { .. } => 15.0,
            ContentBlock::Check { .. } => 12.0,
            ContentBlock::Spacer { height_mm } => *height_mm,
            ContentBlock::PageBreak => 999.0,
        }
    }

    fn render_content_pages(
        &self,
        backend: &mut PdfBackend,
        font_engine: &FontEngine,
        brand: &BrandConfig,
        report: &ReportData,
        page_w_mm: f64,
        page_h_mm: f64,
        total_pages: usize,
    ) {
        let border = 7.0;
        let tb_height = 46.0;
        let content_top = 22.0;
        let content_bottom = page_h_mm - border - tb_height - 5.0;
        let content_height = content_bottom - content_top;
        let margin_left = border + 13.0;
        let content_w = page_w_mm - 2.0 * border - 26.0;

        let heading_font = brand.resolve_font("heading");
        let subheading_font = brand.resolve_font("subheading");
        let body_font = brand.resolve_font("body");
        let body_bold = brand.resolve_font("body_bold");
        let mono_font = brand.resolve_font("mono");

        let primary = Color::from_hex(brand.resolve_color("$primary"));
        let secondary = Color::from_hex(brand.resolve_color("$secondary"));
        let text_muted = Color::from_hex(brand.resolve_color("$text_muted"));
        let success = Color::from_hex(brand.resolve_color("$success"));
        let error = Color::from_hex(brand.resolve_color("$error"));

        let mut y = content_top;
        let mut page_num = 2usize;

        // Start first content page
        backend.new_page(page_w_mm, page_h_mm);
        titleblock::render_detailblad(
            backend, font_engine, brand, report,
            page_w_mm, page_h_mm, page_num, total_pages,
        );

        let mut new_page = |backend: &mut PdfBackend, page_num: usize| {
            backend.new_page(page_w_mm, page_h_mm);
            titleblock::render_detailblad(
                backend, font_engine, brand, report,
                page_w_mm, page_h_mm, page_num, total_pages,
            );
        };

        for section in &report.sections {
            // Section title
            if y + 12.0 > content_bottom {
                page_num += 1;
                new_page(backend, page_num);
                y = content_top;
            }

            // Section heading
            backend.draw_text(&section.title, margin_left, y, heading_font, 14.0, secondary);
            // Underline
            backend.draw_line(
                margin_left, y + 7.0,
                margin_left + content_w, y + 7.0,
                0.5, primary,
            );
            y += 12.0;

            for block in &section.blocks {
                match block {
                    ContentBlock::PageBreak => {
                        page_num += 1;
                        new_page(backend, page_num);
                        y = content_top;
                    }
                    ContentBlock::Spacer { height_mm } => {
                        y += height_mm;
                    }
                    ContentBlock::Heading { text, level } => {
                        let sz = match level.unwrap_or(2) {
                            1 => 14.0,
                            2 => 12.0,
                            _ => 10.0,
                        };
                        if y + 10.0 > content_bottom {
                            page_num += 1;
                            new_page(backend, page_num);
                            y = content_top;
                        }
                        backend.draw_text(text, margin_left, y, subheading_font, sz, secondary);
                        y += sz / 2.0 + 5.0;
                    }
                    ContentBlock::Paragraph { text } => {
                        let lines = wrap_text(text, mm(content_w), body_font, 10.0, font_engine);
                        for line in &lines {
                            if y + 5.0 > content_bottom {
                                page_num += 1;
                                new_page(backend, page_num);
                                y = content_top;
                            }
                            backend.draw_text(line, margin_left, y, body_font, 10.0, secondary);
                            y += 5.0;
                        }
                        y += 3.0;
                    }
                    ContentBlock::Table { headers, rows, col_widths } => {
                        let num_cols = headers.len();
                        let default_col_w = content_w / num_cols as f64;
                        let row_h = 6.0;
                        let table_h = (rows.len() as f64 + 1.0) * row_h + 4.0;

                        if y + table_h > content_bottom {
                            page_num += 1;
                            new_page(backend, page_num);
                            y = content_top;
                        }

                        // Header row background
                        backend.draw_rect(
                            margin_left, y, content_w, row_h,
                            Some(secondary), None, 0.0,
                        );

                        // Header text
                        let mut cx = margin_left;
                        for (i, hdr) in headers.iter().enumerate() {
                            let cw = col_widths.get(i).copied().unwrap_or(default_col_w);
                            backend.draw_text(
                                hdr, cx + 2.0, y + 1.5,
                                mono_font, 7.0,
                                Color::from_hex(brand.resolve_color("$text_light")),
                            );
                            cx += cw;
                        }
                        y += row_h;

                        // Data rows
                        for (ri, row) in rows.iter().enumerate() {
                            if y + row_h > content_bottom {
                                page_num += 1;
                                new_page(backend, page_num);
                                y = content_top;
                            }

                            // Zebra stripe
                            if ri % 2 == 0 {
                                backend.draw_rect(
                                    margin_left, y, content_w, row_h,
                                    Some(Color::from_hex(brand.resolve_color("$background_card"))),
                                    None, 0.0,
                                );
                            }

                            let mut cx = margin_left;
                            for (i, cell) in row.iter().enumerate() {
                                let cw = col_widths.get(i).copied().unwrap_or(default_col_w);
                                backend.draw_text(
                                    cell, cx + 2.0, y + 1.5,
                                    body_font, 8.0, secondary,
                                );
                                cx += cw;
                            }
                            y += row_h;
                        }
                        y += 4.0;
                    }
                    ContentBlock::Calculation { formula, result, unit } => {
                        if y + 15.0 > content_bottom {
                            page_num += 1;
                            new_page(backend, page_num);
                            y = content_top;
                        }

                        // Formula background
                        backend.draw_rect(
                            margin_left, y, content_w, 12.0,
                            Some(Color::from_hex(brand.resolve_color("$background_card"))),
                            None, 0.0,
                        );

                        backend.draw_text(formula, margin_left + 3.0, y + 2.0, mono_font, 9.0, secondary);

                        let result_text = format!("= {} {}", result, unit);
                        let rw = font_engine.measure_text(&result_text, mono_font, 9.0) / crate::pdf::colors::MM_TO_PT;
                        backend.draw_text(
                            &result_text,
                            margin_left + content_w - rw - 3.0, y + 2.0,
                            mono_font, 9.0, primary,
                        );
                        y += 15.0;
                    }
                    ContentBlock::Check { label, calculated, limit, unity } => {
                        if y + 12.0 > content_bottom {
                            page_num += 1;
                            new_page(backend, page_num);
                            y = content_top;
                        }

                        let status_color = if *unity <= 1.0 { success } else { error };
                        let status_text = if *unity <= 1.0 { "VOLDOET" } else { "VOLDOET NIET" };

                        // Status indicator
                        backend.draw_rect(
                            margin_left, y, 3.0, 8.0,
                            Some(status_color), None, 0.0,
                        );

                        backend.draw_text(label, margin_left + 6.0, y + 1.0, body_bold, 9.0, secondary);

                        let check_text = format!(
                            "UC = {:.2}  ({:.1} / {:.1})  {}",
                            unity, calculated, limit, status_text
                        );
                        let cw = font_engine.measure_text(&check_text, mono_font, 8.0) / crate::pdf::colors::MM_TO_PT;
                        backend.draw_text(
                            &check_text,
                            margin_left + content_w - cw - 3.0, y + 1.5,
                            mono_font, 8.0, status_color,
                        );
                        y += 12.0;
                    }
                }
            }
        }
    }
}
