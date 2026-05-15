use crate::pdf::colors::{Color, mm};
use pdf_writer::{Content, Finish, Name, Pdf, Rect, Ref, Str, TextStr};
use std::collections::HashMap;
use std::sync::Arc;

/// Draw operations accumulated during rendering.
#[derive(Debug, Clone)]
pub enum DrawOp {
    Text {
        text: String,
        x_pt: f64,
        y_pt: f64,
        font_name: String,
        size: f64,
        color: Color,
    },
    Line {
        x0_pt: f64,
        y0_pt: f64,
        x1_pt: f64,
        y1_pt: f64,
        width_pt: f64,
        color: Color,
    },
    Rect {
        x_pt: f64,
        y_pt: f64,
        w_pt: f64,
        h_pt: f64,
        fill: Option<Color>,
        stroke: Option<Color>,
        stroke_width_pt: f64,
    },
}

struct PageData {
    width_pt: f64,
    height_pt: f64,
    ops: Vec<DrawOp>,
}

struct RegisteredFont {
    name: String,
    data: Arc<Vec<u8>>,
}

/// PDF backend using pdf-writer for direct PDF generation.
pub struct PdfBackend {
    pages: Vec<PageData>,
    fonts: Vec<RegisteredFont>,
    font_name_to_idx: HashMap<String, usize>,
}

impl PdfBackend {
    pub fn new() -> Self {
        PdfBackend {
            pages: Vec::new(),
            fonts: Vec::new(),
            font_name_to_idx: HashMap::new(),
        }
    }

    /// Register a font for embedding.
    pub fn register_font(&mut self, name: &str, data: Arc<Vec<u8>>) {
        let idx = self.fonts.len();
        self.fonts.push(RegisteredFont {
            name: name.to_string(),
            data,
        });
        self.font_name_to_idx.insert(name.to_string(), idx);
    }

    /// Start a new page.
    pub fn new_page(&mut self, width_mm: f64, height_mm: f64) {
        self.pages.push(PageData {
            width_pt: mm(width_mm),
            height_pt: mm(height_mm),
            ops: Vec::new(),
        });
    }

    /// Add a draw operation to the current page.
    pub fn draw(&mut self, op: DrawOp) {
        if let Some(page) = self.pages.last_mut() {
            page.ops.push(op);
        }
    }

    /// Draw text at position (mm coordinates, top-left origin).
    pub fn draw_text(
        &mut self,
        text: &str,
        x_mm: f64,
        y_mm: f64,
        font_name: &str,
        size: f64,
        color: Color,
    ) {
        if let Some(page) = self.pages.last() {
            let page_height = page.height_pt;
            self.draw(DrawOp::Text {
                text: text.to_string(),
                x_pt: mm(x_mm),
                y_pt: page_height - mm(y_mm) - size, // PDF y-axis is bottom-up
                font_name: font_name.to_string(),
                size,
                color,
            });
        }
    }

    /// Draw a line (mm coordinates).
    pub fn draw_line(
        &mut self,
        x0_mm: f64,
        y0_mm: f64,
        x1_mm: f64,
        y1_mm: f64,
        width_pt: f64,
        color: Color,
    ) {
        if let Some(page) = self.pages.last() {
            let h = page.height_pt;
            self.draw(DrawOp::Line {
                x0_pt: mm(x0_mm),
                y0_pt: h - mm(y0_mm),
                x1_pt: mm(x1_mm),
                y1_pt: h - mm(y1_mm),
                width_pt,
                color,
            });
        }
    }

    /// Draw a filled/stroked rectangle (mm coordinates).
    pub fn draw_rect(
        &mut self,
        x_mm: f64,
        y_mm: f64,
        w_mm: f64,
        h_mm: f64,
        fill: Option<Color>,
        stroke: Option<Color>,
        stroke_width_pt: f64,
    ) {
        if let Some(page) = self.pages.last() {
            let page_h = page.height_pt;
            self.draw(DrawOp::Rect {
                x_pt: mm(x_mm),
                y_pt: page_h - mm(y_mm) - mm(h_mm),
                w_pt: mm(w_mm),
                h_pt: mm(h_mm),
                fill,
                stroke,
                stroke_width_pt,
            });
        }
    }

    /// Current page count.
    pub fn page_count(&self) -> usize {
        self.pages.len()
    }

    /// Serialize all pages to a PDF byte buffer.
    pub fn finish(self) -> Result<Vec<u8>, String> {
        let mut pdf = Pdf::new();
        let mut ref_alloc = Ref::new(1);

        let catalog_ref = ref_alloc;
        ref_alloc = Ref::new(ref_alloc.get() + 1);
        let page_tree_ref = ref_alloc;
        ref_alloc = Ref::new(ref_alloc.get() + 1);

        // Allocate refs for fonts
        let mut font_refs: Vec<Ref> = Vec::new();
        for _ in &self.fonts {
            font_refs.push(ref_alloc);
            ref_alloc = Ref::new(ref_alloc.get() + 1);
            // Font descriptor ref
            ref_alloc = Ref::new(ref_alloc.get() + 1);
            // Font file stream ref
            ref_alloc = Ref::new(ref_alloc.get() + 1);
        }

        // Allocate refs for pages
        let mut page_refs: Vec<Ref> = Vec::new();
        let mut content_refs: Vec<Ref> = Vec::new();
        for _ in &self.pages {
            page_refs.push(ref_alloc);
            ref_alloc = Ref::new(ref_alloc.get() + 1);
            content_refs.push(ref_alloc);
            ref_alloc = Ref::new(ref_alloc.get() + 1);
        }

        // Write fonts as TrueType with WinAnsi encoding
        for (i, font) in self.fonts.iter().enumerate() {
            let font_ref = font_refs[i];
            let descriptor_ref = Ref::new(font_ref.get() + 1);
            let stream_ref = Ref::new(font_ref.get() + 2);

            // Font stream (raw TTF data)
            pdf.stream(stream_ref, &font.data);

            // Font descriptor
            let mut descriptor = pdf.font_descriptor(descriptor_ref);
            descriptor.name(Name(font.name.as_bytes()));
            descriptor.flags(pdf_writer::types::FontFlags::empty());
            descriptor.font_file2(stream_ref);
            descriptor.finish();

            // TrueType font dictionary with WinAnsi encoding
            let mut font_dict = pdf.type1_font(font_ref);
            font_dict.base_font(Name(font.name.as_bytes()));
            font_dict.encoding_predefined(Name(b"WinAnsiEncoding"));
            font_dict.font_descriptor(descriptor_ref);
            font_dict.finish();
        }

        // Write page tree
        let mut page_tree = pdf.pages(page_tree_ref);
        for &pr in &page_refs {
            page_tree.kids([pr]);
        }
        let page_count = self.pages.len() as i32;
        page_tree.count(page_count);
        page_tree.finish();

        // Write pages + content streams
        for (i, page_data) in self.pages.iter().enumerate() {
            // Build content stream
            let mut content = Content::new();

            for op in &page_data.ops {
                match op {
                    DrawOp::Rect { x_pt, y_pt, w_pt, h_pt, fill, stroke, stroke_width_pt } => {
                        content.save_state();
                        if let Some(c) = fill {
                            content.set_fill_rgb(c.r, c.g, c.b);
                            content.rect(*x_pt as f32, *y_pt as f32, *w_pt as f32, *h_pt as f32);
                            content.fill_nonzero();
                        }
                        if let Some(c) = stroke {
                            content.set_stroke_rgb(c.r, c.g, c.b);
                            content.set_line_width(*stroke_width_pt as f32);
                            content.rect(*x_pt as f32, *y_pt as f32, *w_pt as f32, *h_pt as f32);
                            content.stroke();
                        }
                        content.restore_state();
                    }
                    DrawOp::Line { x0_pt, y0_pt, x1_pt, y1_pt, width_pt, color } => {
                        content.save_state();
                        content.set_stroke_rgb(color.r, color.g, color.b);
                        content.set_line_width(*width_pt as f32);
                        content.move_to(*x0_pt as f32, *y0_pt as f32);
                        content.line_to(*x1_pt as f32, *y1_pt as f32);
                        content.stroke();
                        content.restore_state();
                    }
                    DrawOp::Text { text, x_pt, y_pt, font_name, size, color } => {
                        let font_idx = self.font_name_to_idx.get(font_name).copied().unwrap_or(0);
                        let font_tag = format!("F{}", font_idx);
                        content.save_state();
                        content.begin_text();
                        content.set_fill_rgb(color.r, color.g, color.b);
                        content.set_font(Name(font_tag.as_bytes()), *size as f32);
                        content.next_line(*x_pt as f32, *y_pt as f32);
                        content.show(Str(text.as_bytes()));
                        content.end_text();
                        content.restore_state();
                    }
                }
            }

            let content_bytes = content.finish();
            pdf.stream(content_refs[i], &content_bytes);

            // Page dictionary
            let mut page = pdf.page(page_refs[i]);
            page.parent(page_tree_ref);
            page.media_box(Rect::new(
                0.0,
                0.0,
                page_data.width_pt as f32,
                page_data.height_pt as f32,
            ));
            page.contents(content_refs[i]);

            // Font resources
            let mut resources = page.resources();
            let mut font_map = resources.fonts();
            for (idx, _) in self.fonts.iter().enumerate() {
                let tag = format!("F{}", idx);
                font_map.pair(Name(tag.as_bytes()), font_refs[idx]);
            }
            font_map.finish();
            resources.finish();
            page.finish();
        }

        // Catalog
        pdf.catalog(catalog_ref).pages(page_tree_ref);

        Ok(pdf.finish())
    }
}
