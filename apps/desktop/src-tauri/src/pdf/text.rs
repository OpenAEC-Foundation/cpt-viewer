use crate::pdf::fonts::FontEngine;

/// Wrap text to fit within max_width_pt, breaking on word boundaries.
pub fn wrap_text(
    text: &str,
    max_width_pt: f64,
    font_name: &str,
    size: f64,
    font_engine: &FontEngine,
) -> Vec<String> {
    if max_width_pt <= 0.0 {
        return vec![text.to_string()];
    }

    let mut lines = Vec::new();

    for paragraph in text.split('\n') {
        if paragraph.is_empty() {
            lines.push(String::new());
            continue;
        }

        let words: Vec<&str> = paragraph.split_whitespace().collect();
        if words.is_empty() {
            lines.push(String::new());
            continue;
        }

        let mut current_line = String::new();
        let space_width = font_engine.measure_text(" ", font_name, size);

        for word in &words {
            let word_width = font_engine.measure_text(word, font_name, size);

            if current_line.is_empty() {
                // First word on line — always add it even if too wide
                current_line = word.to_string();
            } else {
                let test_width = font_engine.measure_text(&current_line, font_name, size)
                    + space_width
                    + word_width;

                if test_width <= max_width_pt {
                    current_line.push(' ');
                    current_line.push_str(word);
                } else {
                    lines.push(current_line);
                    current_line = word.to_string();
                }
            }
        }

        if !current_line.is_empty() {
            lines.push(current_line);
        }
    }

    if lines.is_empty() {
        lines.push(String::new());
    }

    lines
}
