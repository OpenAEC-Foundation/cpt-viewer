use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

/// Font engine: loads TTF fonts, measures text, provides glyph metrics.
pub struct FontEngine {
    fonts: HashMap<String, LoadedFont>,
    fallback_chain: Vec<String>,
}

struct LoadedFont {
    data: Arc<Vec<u8>>,
    units_per_em: f64,
    ascender: f64,
    descender: f64,
    glyph_widths: Vec<u16>,
    cmap: Vec<(u32, u16)>,
}

impl FontEngine {
    pub fn new() -> Self {
        FontEngine {
            fonts: HashMap::new(),
            fallback_chain: Vec::new(),
        }
    }

    /// Load a TTF font from file.
    pub fn load_font(&mut self, name: &str, path: &Path) -> Result<(), String> {
        let data = std::fs::read(path)
            .map_err(|e| format!("Cannot read font {}: {}", name, e))?;

        let face = ttf_parser::Face::parse(&data, 0)
            .map_err(|e| format!("Cannot parse font {}: {}", name, e))?;

        let units_per_em = face.units_per_em() as f64;
        let ascender = face.ascender() as f64;
        let descender = face.descender() as f64;

        // Extract glyph advance widths
        let num_glyphs = face.number_of_glyphs();
        let mut glyph_widths = Vec::with_capacity(num_glyphs as usize);
        for gid in 0..num_glyphs {
            let id = ttf_parser::GlyphId(gid);
            let width = face.glyph_hor_advance(id).unwrap_or(0);
            glyph_widths.push(width);
        }

        // Build a simple Unicode → GlyphId mapping via cmap
        let mut cmap = Vec::new();
        if let Some(subtable) = face.tables().cmap {
            for table in subtable.subtables {
                if table.is_unicode() {
                    table.codepoints(|cp| {
                        if let Some(gid) = table.glyph_index(cp) {
                            cmap.push((cp, gid.0));
                        }
                    });
                    break;
                }
            }
        }

        self.fonts.insert(name.to_string(), LoadedFont {
            data: Arc::new(data),
            units_per_em,
            ascender,
            descender,
            glyph_widths,
            cmap,
        });

        self.fallback_chain.push(name.to_string());
        Ok(())
    }

    /// Get raw font data for PDF embedding.
    pub fn font_data(&self, name: &str) -> Option<Arc<Vec<u8>>> {
        self.fonts.get(name).map(|f| f.data.clone())
    }

    /// Measure text width in points at a given font size.
    pub fn measure_text(&self, text: &str, font_name: &str, size: f64) -> f64 {
        let font = match self.resolve_font(font_name) {
            Some(f) => f,
            None => return text.len() as f64 * size * 0.5, // rough fallback
        };

        let scale = size / font.units_per_em;
        let mut width = 0.0;
        for ch in text.chars() {
            let gid = font_glyph_id(font, ch as u32).unwrap_or(0);
            let advance = if (gid as usize) < font.glyph_widths.len() {
                font.glyph_widths[gid as usize] as f64
            } else {
                font.units_per_em * 0.5
            };
            width += advance * scale;
        }
        width
    }

    /// Font ascent in points at given size.
    pub fn ascent(&self, font_name: &str, size: f64) -> f64 {
        self.resolve_font(font_name)
            .map(|f| f.ascender / f.units_per_em * size)
            .unwrap_or(size * 0.8)
    }

    /// Font descent in points at given size (negative value).
    pub fn descent(&self, font_name: &str, size: f64) -> f64 {
        self.resolve_font(font_name)
            .map(|f| f.descender / f.units_per_em * size)
            .unwrap_or(size * -0.2)
    }

    /// Check if a font is loaded.
    pub fn has_font(&self, name: &str) -> bool {
        self.fonts.contains_key(name)
    }

    /// Get all loaded font names.
    pub fn font_names(&self) -> Vec<&str> {
        self.fonts.keys().map(|s| s.as_str()).collect()
    }

    fn resolve_font(&self, name: &str) -> Option<&LoadedFont> {
        self.fonts.get(name).or_else(|| {
            self.fallback_chain.first().and_then(|fb| self.fonts.get(fb))
        })
    }
}

fn font_glyph_id(font: &LoadedFont, codepoint: u32) -> Option<u16> {
    // Binary search in sorted cmap
    font.cmap.iter()
        .find(|(cp, _)| *cp == codepoint)
        .map(|(_, gid)| *gid)
}
