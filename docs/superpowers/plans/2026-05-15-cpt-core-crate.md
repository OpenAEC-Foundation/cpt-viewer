# `cpt-core` Crate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `cpt-core` Rust crate — pure CPT domain library: GEF + BRO-XML parsers, Robertson SBT classification, layer detection, RD↔WGS84 coordinate transformation, SVG plot rendering, and report-builder producing `openaec_core::ReportData`. Lives in `crates-warehouse/` as a member of the existing Cargo workspace.

**Architecture:** Pure synchronous library, no I/O, no async, no HTTP. All public types derive `serde::{Serialize, Deserialize}` so they can cross the Tauri IPC boundary directly. Two parsers (GEF, BRO-XML) produce a uniform `Cpt` struct; downstream modules (`robertson`, `layers`, `coords`, `plot`, `report`) operate on that struct. The report builder produces `openaec_core::ReportData` which is rendered to PDF by `openaec-engine`.

**Tech Stack:** Rust 2021, `serde`, `quick-xml` (BRO parser), `chrono` (dates), `thiserror` (errors), `svg` crate (plot SVG generation), workspace deps from `crates-warehouse/Cargo.toml`. Test fixtures from `C:/Users/rickd/Documents/GitHub/verification-files/GEF-BRO-XML/`.

---

## Working Directory

All work happens in `C:\Users\rickd\Documents\GitHub\crates-warehouse\`. Tasks reference paths relative to that root unless otherwise stated.

## File Structure

```
crates-warehouse/
  Cargo.toml                            MODIFY — add "cpt-core" to workspace.members + workspace deps
  cpt-core/                             CREATE
    Cargo.toml
    README.md
    src/
      lib.rs                            public re-exports + parse_auto
      domain.rs                         Cpt, MeasurementPoint, Metadata, Position
      error.rs                          CptError (thiserror)
      robertson.rs                      Zone, classify, zones
      layers.rs                         Layer, detect_layers
      coords.rs                         rd_to_wgs84, wgs84_to_rd
      gef/
        mod.rs                          parse(text) -> Result<Cpt>
        columns.rs                      GEF column type table
        header.rs                       header line parsing
        data.rs                         numeric data row parsing
      bro/
        mod.rs                          parse(xml) -> Result<Cpt>
        columns.rs                      fixed 25-column BRO order
      plot/
        mod.rs                          render_cpt_svg(cpt) -> String
        axes.rs                         scaling helpers
        curves.rs                       qc/fs/Rf/u2 path generation
        sbt_strip.rs                    Robertson colour strip
      report.rs                         build(cpts, project) -> ReportData
    tests/
      common.rs                         fixture loader helper
      test_robertson.rs
      test_layers.rs
      test_coords.rs
      test_gef.rs
      test_bro.rs
      test_parse_auto.rs
      test_plot.rs
      test_report.rs
```

## Fixture Setup

Tests load files from `C:/Users/rickd/Documents/GitHub/verification-files/GEF-BRO-XML/`. The `tests/common.rs` helper resolves the absolute path so we don't depend on `cargo test` working dir.

---

## Task 1: Scaffold the crate and add to workspace

**Files:**
- Create: `cpt-core/Cargo.toml`
- Create: `cpt-core/README.md`
- Create: `cpt-core/src/lib.rs`
- Modify: `Cargo.toml` (workspace root)

- [ ] **Step 1: Create `cpt-core/Cargo.toml`**

```toml
[package]
name = "cpt-core"
description = "CPT (Cone Penetration Test) domain library: GEF + BRO-XML parsers, Robertson classification, RD coordinates, report building"
version.workspace = true
edition.workspace = true
license.workspace = true

[dependencies]
serde = { workspace = true }
serde_json = { workspace = true }
thiserror = { workspace = true }
chrono = { version = "0.4", features = ["serde"] }
quick-xml = "0.36"
svg = "0.17"
openaec-core = { path = "../openaec-core" }

[dev-dependencies]
```

- [ ] **Step 2: Create `cpt-core/README.md`**

```markdown
# cpt-core

CPT (Cone Penetration Test) domain library for the OpenAEC ecosystem.

## Features
- GEF 1.x parser (Dutch Geotechnical Exchange Format)
- BRO-XML parser (Dutch Basisregistratie Ondergrond CPT_O / CPT_O_DP)
- Robertson 1990 SBT classification
- Layer detection (consecutive same-zone grouping)
- RD ↔ WGS84 coordinate transformation (Bessel 1841 + 7-param Helmert)
- SVG plot rendering (NEN-EN-ISO 22476-1 layout)
- Report builder producing `openaec_core::ReportData`

## License
MIT
```

- [ ] **Step 3: Create `cpt-core/src/lib.rs`**

```rust
//! CPT (Cone Penetration Test) domain library.
//!
//! Parses GEF and BRO-XML CPT files, classifies measurement points using
//! Robertson 1990 SBT, detects soil layers, and builds standardized reports.

pub mod domain;
pub mod error;

pub use domain::{Cpt, MeasurementPoint, Metadata, Position};
pub use error::CptError;
```

- [ ] **Step 4: Add to workspace and check build**

Modify `crates-warehouse/Cargo.toml`: add `"cpt-core"` to `workspace.members`. Alphabetically, place it at the top of the list — before `"isso51-api"`.

Run: `cargo check -p cpt-core`
Expected: `cpt-core` lib compiles (will fail until Task 2 creates `domain.rs` and `error.rs`). For now expect: `error: file not found for module 'domain'` etc.

- [ ] **Step 5: Stub the modules so the workspace still builds**

Create `cpt-core/src/domain.rs` with:
```rust
//! Core domain types — see Task 2.
```

Create `cpt-core/src/error.rs` with:
```rust
//! Error type — see Task 3.
```

Run: `cargo check -p cpt-core`
Expected: PASS — `cpt-core v0.1.1 (...)` finished.

- [ ] **Step 6: Commit**

```bash
git add cpt-core/ Cargo.toml
git commit -m "feat(cpt-core): scaffold crate and add to workspace"
```

---

## Task 2: Domain types

**Files:**
- Modify: `cpt-core/src/domain.rs`
- Modify: `cpt-core/src/lib.rs`
- Create: `cpt-core/tests/test_domain.rs`

- [ ] **Step 1: Write the failing test**

Create `cpt-core/tests/test_domain.rs`:
```rust
use cpt_core::{Cpt, MeasurementPoint, Metadata, Position};

#[test]
fn cpt_serializes_to_json() {
    let cpt = Cpt {
        id: "S01".to_string(),
        metadata: Metadata {
            project_name: Some("Test Project".to_string()),
            project_number: Some("2026-001".to_string()),
            date: chrono::NaiveDate::from_ymd_opt(2026, 5, 15),
            equipment: None,
            ground_level_nap: Some(2.5),
            source_file: "test.gef".to_string(),
        },
        position: Some(Position {
            x_rd: 100_000.0,
            y_rd: 400_000.0,
            z_nap: Some(2.5),
        }),
        points: vec![MeasurementPoint {
            depth: 0.5,
            depth_nap: Some(2.0),
            qc: Some(1.2),
            fs: Some(0.012),
            rf: Some(1.0),
            u2: None,
            inclination: Some(0.5),
        }],
    };
    let json = serde_json::to_string(&cpt).unwrap();
    let back: Cpt = serde_json::from_str(&json).unwrap();
    assert_eq!(back.id, "S01");
    assert_eq!(back.points.len(), 1);
    assert_eq!(back.points[0].qc, Some(1.2));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p cpt-core --test test_domain`
Expected: FAIL — `Cpt`, `MeasurementPoint`, etc. not defined.

- [ ] **Step 3: Implement domain types**

Replace `cpt-core/src/domain.rs` contents:
```rust
//! Core domain types — `Cpt` and friends.
//!
//! All types derive `Serialize + Deserialize` so they cross the Tauri IPC
//! boundary directly. Numeric fields use `f64` to match GEF/BRO source precision.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cpt {
    pub id: String,
    pub metadata: Metadata,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<Position>,
    pub points: Vec<MeasurementPoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Metadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<NaiveDate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub equipment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ground_level_nap: Option<f64>,
    pub source_file: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Position {
    pub x_rd: f64,
    pub y_rd: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub z_nap: Option<f64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct MeasurementPoint {
    pub depth: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub depth_nap: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub qc: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fs: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rf: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub u2: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inclination: Option<f64>,
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p cpt-core --test test_domain`
Expected: PASS — `test cpt_serializes_to_json ... ok`.

- [ ] **Step 5: Commit**

```bash
git add cpt-core/src/domain.rs cpt-core/tests/test_domain.rs
git commit -m "feat(cpt-core): add domain types (Cpt, MeasurementPoint, Metadata, Position)"
```

---

## Task 3: Error type

**Files:**
- Modify: `cpt-core/src/error.rs`
- Modify: `cpt-core/src/lib.rs`

- [ ] **Step 1: Write the failing test (inline in error.rs)**

Replace `cpt-core/src/error.rs`:
```rust
//! Error type for the CPT library.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum CptError {
    #[error("invalid GEF file: {0}")]
    InvalidGef(String),

    #[error("invalid BRO XML file: {0}")]
    InvalidBro(String),

    #[error("unknown CPT format (expected GEF header '#GEF' or XML root)")]
    UnknownFormat,

    #[error("XML parse error: {0}")]
    Xml(#[from] quick_xml::Error),

    #[error("number parse error: {0}")]
    ParseFloat(#[from] std::num::ParseFloatError),

    #[error("integer parse error: {0}")]
    ParseInt(#[from] std::num::ParseIntError),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_displays_message() {
        let e = CptError::InvalidGef("missing #EOH".to_string());
        assert_eq!(format!("{}", e), "invalid GEF file: missing #EOH");
    }

    #[test]
    fn error_unknown_format_message() {
        let e = CptError::UnknownFormat;
        assert!(format!("{}", e).contains("unknown CPT format"));
    }
}
```

- [ ] **Step 2: Run test to verify it passes (this task is implementation + test in one)**

Run: `cargo test -p cpt-core --lib`
Expected: PASS — both unit tests in `error::tests` pass.

- [ ] **Step 3: Commit**

```bash
git add cpt-core/src/error.rs
git commit -m "feat(cpt-core): add CptError type with variants for parser errors"
```

---

## Task 4: Robertson SBT classification

**Files:**
- Create: `cpt-core/src/robertson.rs`
- Modify: `cpt-core/src/lib.rs`
- Create: `cpt-core/tests/test_robertson.rs`

- [ ] **Step 1: Write the failing test**

Create `cpt-core/tests/test_robertson.rs`:
```rust
use cpt_core::robertson::{classify, zones, Zone};

#[test]
fn classify_returns_none_for_invalid_input() {
    assert!(classify(0.0, 1.0).is_none());
    assert!(classify(-1.0, 1.0).is_none());
    assert!(classify(1.0, -0.1).is_none());
}

#[test]
fn classify_high_qc_low_rf_is_grof_zand() {
    // qc > 25, Rf < 1 -> Zone 7 (Grof zand / grind)
    let z = classify(30.0, 0.5).unwrap();
    assert_eq!(z.number, 7);
}

#[test]
fn classify_medium_qc_medium_rf_is_zand() {
    // qc = 8, Rf = 0.7 -> Zone 6 (Zand)
    let z = classify(8.0, 0.7).unwrap();
    assert_eq!(z.number, 6);
}

#[test]
fn classify_low_qc_high_rf_is_klei_or_organic() {
    // qc = 1.5, Rf = 6 -> Zone 3 (Klei) or Zone 2 (Organisch)
    let z = classify(1.5, 6.0).unwrap();
    assert!(z.number == 2 || z.number == 3, "got zone {}", z.number);
}

#[test]
fn zones_returns_nine_entries() {
    assert_eq!(zones().len(), 9);
}

#[test]
fn zones_have_unique_numbers() {
    let nums: std::collections::HashSet<u8> = zones().iter().map(|z| z.number).collect();
    assert_eq!(nums.len(), 9);
}

#[test]
fn zone_serializes_to_json() {
    let z = Zone { number: 3, name: "Klei", color: "#4CAF50" };
    let json = serde_json::to_string(&z).unwrap();
    assert!(json.contains("\"number\":3"));
    assert!(json.contains("\"name\":\"Klei\""));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p cpt-core --test test_robertson`
Expected: FAIL — `robertson` module not found.

- [ ] **Step 3: Implement Robertson classification**

Create `cpt-core/src/robertson.rs`:
```rust
//! Robertson 1990 SBT classification (simplified, qc + Rf only).
//!
//! Direct port of the Dutch geotechnical practice approximation
//! used in the previous JS implementation. Returns one of 9 zones.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct Zone {
    pub number: u8,
    pub name: &'static str,
    pub color: &'static str,
}

const ZONES: [Zone; 9] = [
    Zone { number: 1, name: "Gevoelig fijnkorrelig",  color: "#00BCD4" },
    Zone { number: 2, name: "Organisch / veen",        color: "#795548" },
    Zone { number: 3, name: "Klei",                    color: "#4CAF50" },
    Zone { number: 4, name: "Silt mengsels",           color: "#8BC34A" },
    Zone { number: 5, name: "Zand mengsels",           color: "#FFC107" },
    Zone { number: 6, name: "Zand",                    color: "#FF9800" },
    Zone { number: 7, name: "Grof zand / grind",       color: "#FF5722" },
    Zone { number: 8, name: "Zeer vast zand/klei",     color: "#F44336" },
    Zone { number: 9, name: "Zeer vast fijnkorrelig",  color: "#9C27B0" },
];

pub fn zones() -> &'static [Zone] {
    &ZONES
}

/// Classify a measurement point by cone resistance and friction ratio.
/// Returns `None` for invalid inputs (qc <= 0 or rf < 0).
pub fn classify(qc: f64, rf: f64) -> Option<Zone> {
    if qc <= 0.0 || rf < 0.0 {
        return None;
    }
    if qc > 25.0 {
        if rf < 1.0 { return Some(ZONES[6]); }   // Zone 7
        return Some(ZONES[7]);                    // Zone 8
    }
    if qc > 10.0 {
        if rf < 0.5 { return Some(ZONES[6]); }   // Zone 7
        if rf < 1.5 { return Some(ZONES[5]); }   // Zone 6
        if rf < 3.0 { return Some(ZONES[4]); }   // Zone 5
        return Some(ZONES[7]);                    // Zone 8
    }
    if qc > 5.0 {
        if rf < 1.0 { return Some(ZONES[5]); }   // Zone 6
        if rf < 2.0 { return Some(ZONES[4]); }   // Zone 5
        if rf < 4.0 { return Some(ZONES[3]); }   // Zone 4
        if rf < 6.0 { return Some(ZONES[2]); }   // Zone 3
        return Some(ZONES[8]);                    // Zone 9
    }
    if qc > 2.0 {
        if rf < 1.0 { return Some(ZONES[4]); }   // Zone 5
        if rf < 2.5 { return Some(ZONES[3]); }   // Zone 4
        if rf < 5.0 { return Some(ZONES[2]); }   // Zone 3
        return Some(ZONES[1]);                    // Zone 2
    }
    if qc > 0.5 {
        if rf < 1.0 { return Some(ZONES[3]); }   // Zone 4
        if rf < 3.0 { return Some(ZONES[2]); }   // Zone 3
        return Some(ZONES[1]);                    // Zone 2
    }
    // qc 0..0.5
    if rf < 2.0 { return Some(ZONES[2]); }       // Zone 3
    if rf < 5.0 { return Some(ZONES[1]); }       // Zone 2
    Some(ZONES[0])                                // Zone 1
}
```

Add `pub mod robertson;` to `cpt-core/src/lib.rs`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p cpt-core --test test_robertson`
Expected: PASS — all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add cpt-core/src/robertson.rs cpt-core/src/lib.rs cpt-core/tests/test_robertson.rs
git commit -m "feat(cpt-core): add Robertson 1990 SBT classification"
```

---

## Task 5: Layer detection

**Files:**
- Create: `cpt-core/src/layers.rs`
- Modify: `cpt-core/src/lib.rs`
- Create: `cpt-core/tests/test_layers.rs`

- [ ] **Step 1: Write the failing test**

Create `cpt-core/tests/test_layers.rs`:
```rust
use cpt_core::{detect_layers, Cpt, MeasurementPoint, Metadata};

fn make_cpt(points: Vec<(f64, f64, f64)>) -> Cpt {
    Cpt {
        id: "T".to_string(),
        metadata: Metadata { source_file: "test.gef".to_string(), ..Default::default() },
        position: None,
        points: points.into_iter().map(|(d, qc, rf)| MeasurementPoint {
            depth: d,
            depth_nap: None,
            qc: Some(qc),
            fs: None,
            rf: Some(rf),
            u2: None,
            inclination: None,
        }).collect(),
    }
}

#[test]
fn empty_cpt_has_no_layers() {
    let cpt = make_cpt(vec![]);
    assert_eq!(detect_layers(&cpt).len(), 0);
}

#[test]
fn uniform_zone_collapses_to_one_layer() {
    // All points classify to the same zone
    let pts = (0..50).map(|i| (i as f64 * 0.02, 8.0, 0.7)).collect();
    let cpt = make_cpt(pts);
    let layers = detect_layers(&cpt);
    assert_eq!(layers.len(), 1);
    assert_eq!(layers[0].zone_number, 6); // Zand
    assert!((layers[0].depth_top - 0.0).abs() < 1e-9);
    assert!((layers[0].depth_bottom - 0.98).abs() < 1e-9);
}

#[test]
fn distinct_zones_become_separate_layers() {
    // First half: Zand (zone 6), second half: Klei (zone 3)
    let mut pts = vec![];
    for i in 0..20 { pts.push((i as f64 * 0.1, 8.0, 0.7)); }    // 0..1.9 m, zone 6
    for i in 20..40 { pts.push((i as f64 * 0.1, 1.5, 6.0)); }   // 2..3.9 m, zone 2 or 3
    let cpt = make_cpt(pts);
    let layers = detect_layers(&cpt);
    assert_eq!(layers.len(), 2);
    assert_eq!(layers[0].zone_number, 6);
}

#[test]
fn thin_layer_below_threshold_is_merged() {
    // 50cm of zand, 5cm of klei (below 10cm threshold), 50cm of zand
    let mut pts = vec![];
    for i in 0..25 { pts.push((i as f64 * 0.02, 8.0, 0.7)); }       // 0.5m zand
    for i in 25..28 { pts.push((i as f64 * 0.02, 1.5, 6.0)); }      // 6cm klei (skipped)
    for i in 28..53 { pts.push((i as f64 * 0.02, 8.0, 0.7)); }      // 0.5m zand
    let cpt = make_cpt(pts);
    let layers = detect_layers(&cpt);
    assert_eq!(layers.len(), 1, "thin klei layer should merge into surrounding zand");
    assert_eq!(layers[0].zone_number, 6);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p cpt-core --test test_layers`
Expected: FAIL — `detect_layers` not defined.

- [ ] **Step 3: Implement layer detection**

Create `cpt-core/src/layers.rs`:
```rust
//! Layer detection: groups consecutive measurement points with the same
//! Robertson zone into layers. Layers thinner than `MIN_LAYER_THICKNESS`
//! are merged into their surroundings.

use serde::{Deserialize, Serialize};

use crate::domain::Cpt;
use crate::robertson::{classify, Zone};

const MIN_LAYER_THICKNESS: f64 = 0.10; // 10 cm

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Layer {
    pub depth_top: f64,
    pub depth_bottom: f64,
    pub zone_number: u8,
    pub zone_name: &'static str,
    pub zone_color: &'static str,
}

impl Layer {
    pub fn thickness(&self) -> f64 { self.depth_bottom - self.depth_top }
    fn from_zone(top: f64, bottom: f64, z: Zone) -> Self {
        Self { depth_top: top, depth_bottom: bottom, zone_number: z.number,
               zone_name: z.name, zone_color: z.color }
    }
}

pub fn detect_layers(cpt: &Cpt) -> Vec<Layer> {
    if cpt.points.is_empty() { return Vec::new(); }

    // 1. Classify every point; skip ones we can't classify.
    let classified: Vec<(f64, Zone)> = cpt.points.iter()
        .filter_map(|p| {
            let qc = p.qc?; let rf = p.rf?;
            classify(qc, rf).map(|z| (p.depth, z))
        })
        .collect();
    if classified.is_empty() { return Vec::new(); }

    // 2. Group consecutive same-zone points into raw layers.
    let mut raw: Vec<Layer> = Vec::new();
    let mut start = classified[0].0;
    let mut current_zone = classified[0].1;
    for window in classified.windows(2) {
        let (depth, zone) = window[1];
        if zone.number != current_zone.number {
            raw.push(Layer::from_zone(start, window[0].0, current_zone));
            start = depth;
            current_zone = zone;
        }
    }
    let last_depth = classified.last().unwrap().0;
    raw.push(Layer::from_zone(start, last_depth, current_zone));

    // 3. Merge layers thinner than threshold into the previous one.
    let mut merged: Vec<Layer> = Vec::new();
    for layer in raw {
        if let Some(last) = merged.last_mut() {
            if layer.thickness() < MIN_LAYER_THICKNESS {
                last.depth_bottom = layer.depth_bottom;
                continue;
            }
        }
        merged.push(layer);
    }
    merged
}
```

Add `pub mod layers;` and `pub use layers::{detect_layers, Layer};` to `cpt-core/src/lib.rs`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p cpt-core --test test_layers`
Expected: PASS — all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add cpt-core/src/layers.rs cpt-core/src/lib.rs cpt-core/tests/test_layers.rs
git commit -m "feat(cpt-core): add layer detection (consecutive same-zone grouping with min-thickness merge)"
```

---

## Task 6: RD ↔ WGS84 coordinate transformation

**Files:**
- Create: `cpt-core/src/coords.rs`
- Modify: `cpt-core/src/lib.rs`
- Create: `cpt-core/tests/test_coords.rs`

- [ ] **Step 1: Write the failing test**

Create `cpt-core/tests/test_coords.rs`:
```rust
use cpt_core::coords::{rd_to_wgs84, wgs84_to_rd};

#[test]
fn rd_to_wgs84_amersfoort_origin() {
    // Amersfoort RD origin: (155000, 463000) -> (52.155, 5.387) approx
    let (lat, lon) = rd_to_wgs84(155_000.0, 463_000.0);
    assert!((lat - 52.1551744).abs() < 1e-4, "lat {} off", lat);
    assert!((lon - 5.3872036).abs() < 1e-4, "lon {} off", lon);
}

#[test]
fn rd_to_wgs84_dordrecht() {
    // ~Dordrecht: (106800, 425250) -> ~(51.815, 4.690)
    let (lat, lon) = rd_to_wgs84(106_800.0, 425_250.0);
    assert!((lat - 51.815).abs() < 0.01, "lat {} off", lat);
    assert!((lon - 4.690).abs() < 0.01, "lon {} off", lon);
}

#[test]
fn wgs84_to_rd_round_trip() {
    let original = (155_000.0_f64, 463_000.0_f64);
    let (lat, lon) = rd_to_wgs84(original.0, original.1);
    let (x, y) = wgs84_to_rd(lat, lon);
    assert!((x - original.0).abs() < 0.5, "x roundtrip {} off", x);
    assert!((y - original.1).abs() < 0.5, "y roundtrip {} off", y);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p cpt-core --test test_coords`
Expected: FAIL — `coords` module not found.

- [ ] **Step 3: Implement RD ↔ WGS84**

Create `cpt-core/src/coords.rs`:
```rust
//! RD (Rijksdriehoek New / Amersfoort) ↔ WGS84 conversion.
//!
//! Uses the standardized polynomial approximation published by Kadaster
//! (sub-meter accuracy across the Netherlands). No external dependency,
//! no HTTP calls. Sources:
//! - https://www.kadaster.nl/zakelijk/diensten/handleiding-rdnaptrans
//! - Schreutelkamp & Strang van Hees, "Benaderingsformules voor de
//!   transformatie tussen RD en WGS84-coördinaten" (2001).

const X0: f64 = 155_000.0;
const Y0: f64 = 463_000.0;
const PHI0: f64 = 52.156_160_556;   // Amersfoort lat (deg)
const LAM0: f64 = 5.387_638_889;    // Amersfoort lon (deg)

/// Convert RD (x, y) in meters to WGS84 (latitude, longitude) in degrees.
pub fn rd_to_wgs84(x: f64, y: f64) -> (f64, f64) {
    let dx = (x - X0) * 1.0e-5;
    let dy = (y - Y0) * 1.0e-5;

    // Coefficients K_pq for latitude (p in dx-power, q in dy-power)
    let kp = [
        (0, 1,  3235.65389),
        (2, 0,  -32.58297),
        (0, 2,  -0.24750),
        (2, 1,  -0.84978),
        (0, 3,  -0.06550),
        (2, 2,  -0.01709),
        (1, 0,  -0.00738),
        (4, 0,   0.00530),
        (2, 3,  -0.00039),
        (4, 1,   0.00033),
        (1, 1,  -0.00012),
    ];
    let lp = [
        (1, 0,  5260.52916),
        (1, 1,  105.94684),
        (1, 2,   2.45656),
        (3, 0,  -0.81885),
        (1, 3,   0.05594),
        (3, 1,  -0.05607),
        (0, 1,   0.01199),
        (3, 2,  -0.00256),
        (1, 4,   0.00128),
        (0, 2,   0.00022),
        (2, 0,  -0.00022),
        (5, 0,   0.00026),
    ];

    let mut dphi = 0.0;
    for &(p, q, k) in &kp {
        dphi += k * dx.powi(p) * dy.powi(q);
    }
    let mut dlam = 0.0;
    for &(p, q, l) in &lp {
        dlam += l * dx.powi(p) * dy.powi(q);
    }
    let phi = PHI0 + dphi / 3600.0;
    let lam = LAM0 + dlam / 3600.0;
    (phi, lam)
}

/// Convert WGS84 (latitude, longitude) in degrees to RD (x, y) in meters.
pub fn wgs84_to_rd(lat: f64, lon: f64) -> (f64, f64) {
    let dphi = 0.36 * (lat - PHI0);
    let dlam = 0.36 * (lon - LAM0);

    let rp = [
        (0, 1,  190_094.945),
        (1, 1,  -11_832.228),
        (2, 1,    -114.221),
        (0, 3,     -32.391),
        (1, 0,      -0.705),
        (3, 1,      -2.340),
        (1, 3,      -0.608),
        (0, 2,      -0.008),
        (2, 3,       0.148),
    ];
    let sp = [
        (1, 0,  309_056.544),
        (0, 2,    3_638.893),
        (2, 0,      73.077),
        (1, 2,    -157.984),
        (3, 0,      59.788),
        (0, 1,       0.433),
        (2, 2,      -6.439),
        (1, 1,      -0.032),
        (0, 4,       0.092),
        (1, 4,      -0.054),
    ];

    let mut x = X0;
    for &(p, q, r) in &rp {
        x += r * dphi.powi(p) * dlam.powi(q);
    }
    let mut y = Y0;
    for &(p, q, s) in &sp {
        y += s * dphi.powi(p) * dlam.powi(q);
    }
    (x, y)
}
```

Add `pub mod coords;` to `cpt-core/src/lib.rs`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p cpt-core --test test_coords`
Expected: PASS — all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add cpt-core/src/coords.rs cpt-core/src/lib.rs cpt-core/tests/test_coords.rs
git commit -m "feat(cpt-core): add RD <-> WGS84 polynomial coordinate transformation"
```

---

## Task 7: GEF parser — column table & header parsing

**Files:**
- Create: `cpt-core/src/gef/mod.rs`
- Create: `cpt-core/src/gef/columns.rs`
- Create: `cpt-core/src/gef/header.rs`
- Modify: `cpt-core/src/lib.rs`

- [ ] **Step 1: Write the failing test (inline in `header.rs`)**

Create `cpt-core/src/gef/columns.rs`:
```rust
//! GEF column quantity numbers (per CUR/NEN convention) → field names.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GefField {
    Length, Qc, Fs, Rf, U1, U2, U3,
    Inclination, InclNs, InclEw,
    Depth, Time, CorrectedQc, NetQc, PoreRatio,
    Speed, Temp, ElectricCond, FrictionTotal,
    Unknown(u32),
}

pub fn from_quantity(q: u32) -> GefField {
    match q {
        1 => GefField::Length,
        2 => GefField::Qc,
        3 => GefField::Fs,
        4 => GefField::Rf,
        5 => GefField::U1,
        6 => GefField::U2,
        7 => GefField::U3,
        8 => GefField::Inclination,
        9 => GefField::InclNs,
        10 => GefField::InclEw,
        11 => GefField::Depth,
        12 => GefField::Time,
        13 => GefField::CorrectedQc,
        14 => GefField::NetQc,
        15 => GefField::PoreRatio,
        20 => GefField::Speed,
        21 => GefField::Temp,
        23 => GefField::ElectricCond,
        39 => GefField::FrictionTotal,
        n => GefField::Unknown(n),
    }
}
```

Create `cpt-core/src/gef/header.rs`:
```rust
//! GEF header line parsing (`#KEY= value`).
//!
//! GEF is a line-oriented ASCII format. Header keywords start with `#`,
//! followed by `=` and a comma-or-whitespace separated value list.
//! `#EOH=` (end of header) marks the start of the data block.

use crate::error::CptError;
use super::columns::{from_quantity, GefField};

#[derive(Debug, Clone, Default)]
pub struct GefHeader {
    pub test_id: Option<String>,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub company_id: Option<String>,
    pub date: Option<chrono::NaiveDate>,
    pub x_rd: Option<f64>,
    pub y_rd: Option<f64>,
    pub z_nap: Option<f64>,
    pub columns: Vec<ColumnSpec>,
    pub column_void: Vec<(usize, f64)>, // (1-based column index, void value)
}

#[derive(Debug, Clone)]
pub struct ColumnSpec {
    pub index: usize,        // 1-based GEF column index
    pub field: GefField,
}

pub fn parse_header(lines: &[&str]) -> Result<(GefHeader, usize), CptError> {
    let mut header = GefHeader::default();
    for (i, raw) in lines.iter().enumerate() {
        let line = raw.trim();
        if line == "#EOH=" || line == "#EOH" {
            return Ok((header, i + 1));
        }
        let Some(rest) = line.strip_prefix('#') else { continue };
        let Some((key, value)) = rest.split_once('=') else { continue };
        let key = key.trim().to_uppercase();
        let value = value.trim();
        match key.as_str() {
            "TESTID" => header.test_id = Some(value.to_string()),
            "PROJECTID" => header.project_id = Some(value.to_string()),
            "PROJECTNAME" => header.project_name = Some(value.to_string()),
            "COMPANYID" => header.company_id = Some(value.split(',').next().unwrap_or(value).trim().to_string()),
            "FILEDATE" => header.date = parse_filedate(value),
            "XYID" => parse_xyid(value, &mut header),
            "ZID" => parse_zid(value, &mut header),
            "COLUMNINFO" => parse_columninfo(value, &mut header),
            "COLUMNVOID" => parse_columnvoid(value, &mut header),
            _ => {} // ignore other keys for now
        }
    }
    Err(CptError::InvalidGef("missing #EOH terminator".into()))
}

fn parse_filedate(value: &str) -> Option<chrono::NaiveDate> {
    // FILEDATE format: "YYYY, MM, DD"
    let parts: Vec<i32> = value.split(',').filter_map(|s| s.trim().parse().ok()).collect();
    if parts.len() < 3 { return None; }
    chrono::NaiveDate::from_ymd_opt(parts[0], parts[1] as u32, parts[2] as u32)
}

fn parse_xyid(value: &str, h: &mut GefHeader) {
    // XYID format: "1, x, y, ..." — first field is coord-system id (1=RD), then x, y
    let parts: Vec<&str> = value.split(',').map(|s| s.trim()).collect();
    if parts.len() < 3 { return; }
    if let (Ok(x), Ok(y)) = (parts[1].parse::<f64>(), parts[2].parse::<f64>()) {
        h.x_rd = Some(x); h.y_rd = Some(y);
    }
}

fn parse_zid(value: &str, h: &mut GefHeader) {
    // ZID format: "31000, z, ..." — second field is z value (relative to NAP if id=31000)
    let parts: Vec<&str> = value.split(',').map(|s| s.trim()).collect();
    if parts.len() < 2 { return; }
    if let Ok(z) = parts[1].parse::<f64>() { h.z_nap = Some(z); }
}

fn parse_columninfo(value: &str, h: &mut GefHeader) {
    // COLUMNINFO format: "<col>, <unit>, <name>, <quantity>"
    let parts: Vec<&str> = value.split(',').map(|s| s.trim()).collect();
    if parts.len() < 4 { return; }
    let col: usize = match parts[0].parse() { Ok(n) => n, Err(_) => return };
    let q: u32 = match parts[3].parse() { Ok(n) => n, Err(_) => return };
    h.columns.push(ColumnSpec { index: col, field: from_quantity(q) });
}

fn parse_columnvoid(value: &str, h: &mut GefHeader) {
    let parts: Vec<&str> = value.split(',').map(|s| s.trim()).collect();
    if parts.len() < 2 { return; }
    if let (Ok(c), Ok(v)) = (parts[0].parse::<usize>(), parts[1].parse::<f64>()) {
        h.column_void.push((c, v));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_minimal_header() {
        let lines = vec![
            "#GEFID= 1, 0, 0",
            "#TESTID= S01",
            "#PROJECTID= TEST-2026",
            "#XYID= 1, 100000.0, 400000.0",
            "#ZID= 31000, 2.5",
            "#COLUMN= 3",
            "#COLUMNINFO= 1, m, Sondeerlengte, 1",
            "#COLUMNINFO= 2, MPa, Conusweerstand, 2",
            "#COLUMNINFO= 3, MPa, Wrijving, 3",
            "#COLUMNVOID= 2, -9999",
            "#EOH=",
            "0.02 1.5 0.015",
        ];
        let (h, data_start) = parse_header(&lines).unwrap();
        assert_eq!(data_start, 11);
        assert_eq!(h.test_id.as_deref(), Some("S01"));
        assert_eq!(h.project_id.as_deref(), Some("TEST-2026"));
        assert_eq!(h.x_rd, Some(100_000.0));
        assert_eq!(h.y_rd, Some(400_000.0));
        assert_eq!(h.z_nap, Some(2.5));
        assert_eq!(h.columns.len(), 3);
        assert_eq!(h.columns[1].field, GefField::Qc);
        assert_eq!(h.column_void, vec![(2, -9999.0)]);
    }

    #[test]
    fn errors_on_missing_eoh() {
        let lines = vec!["#TESTID= S01", "0.02 1.5"];
        assert!(parse_header(&lines).is_err());
    }
}
```

Create `cpt-core/src/gef/mod.rs` (just module declarations for now):
```rust
//! GEF parser. Public entry point: `parse(text) -> Result<Cpt>` (see Task 8).

pub mod columns;
pub mod header;
pub mod data;

pub use self::data::parse;
```

Create `cpt-core/src/gef/data.rs` placeholder:
```rust
//! GEF data section parser — implemented in Task 8.

use crate::error::CptError;
use crate::domain::Cpt;

pub fn parse(_text: &str) -> Result<Cpt, CptError> {
    Err(CptError::InvalidGef("not yet implemented".into()))
}
```

Add `pub mod gef;` to `cpt-core/src/lib.rs`.

- [ ] **Step 2: Run unit tests**

Run: `cargo test -p cpt-core --lib gef::header::tests`
Expected: PASS — both header tests pass.

- [ ] **Step 3: Commit**

```bash
git add cpt-core/src/gef/ cpt-core/src/lib.rs
git commit -m "feat(cpt-core): GEF header parser (#TESTID, #XYID, #ZID, #COLUMNINFO, #COLUMNVOID)"
```

---

## Task 8: GEF parser — data block and end-to-end

**Files:**
- Modify: `cpt-core/src/gef/data.rs`
- Create: `cpt-core/tests/common.rs`
- Create: `cpt-core/tests/test_gef.rs`

- [ ] **Step 1: Write the failing test**

Create `cpt-core/tests/common.rs`:
```rust
//! Shared test fixtures helper.
use std::path::PathBuf;

pub fn fixture(name: &str) -> PathBuf {
    PathBuf::from(r"C:\Users\rickd\Documents\GitHub\verification-files\GEF-BRO-XML")
        .join(name)
}

pub fn read_fixture(name: &str) -> String {
    std::fs::read_to_string(fixture(name))
        .unwrap_or_else(|e| panic!("missing fixture {}: {}", name, e))
}
```

Create `cpt-core/tests/test_gef.rs`:
```rust
mod common;

use cpt_core::gef::parse;
use common::read_fixture;

#[test]
fn parses_voorbeeld_gef() {
    let text = read_fixture("voorbeeld.gef");
    let cpt = parse(&text).expect("voorbeeld.gef should parse");
    assert!(!cpt.points.is_empty(), "expected measurement points");
    // First point should have qc and depth set
    let first = &cpt.points[0];
    assert!(first.qc.is_some(), "first point qc should be set");
    assert!(first.depth >= 0.0);
}

#[test]
fn parses_cpt_pygef_gef() {
    let text = read_fixture("cpt_pygef.gef");
    let cpt = parse(&text).expect("cpt_pygef.gef should parse");
    assert!(!cpt.points.is_empty());
}

#[test]
fn parses_2600356_series() {
    for n in 1..=6 {
        let name = format!("2600356_0{}.GEF", n);
        let text = read_fixture(&name);
        let cpt = parse(&text).expect(&format!("{} should parse", name));
        assert!(!cpt.points.is_empty(), "{} should have points", name);
        // Real-world series should have position
        assert!(cpt.position.is_some(), "{} should have RD position", name);
    }
}

#[test]
fn computes_rf_when_missing() {
    // If only qc+fs are present, parser should derive rf = 100 * fs / qc
    let gef = r#"#GEFID= 1, 0, 0
#TESTID= TEST
#XYID= 1, 100000.0, 400000.0
#ZID= 31000, 0.0
#COLUMN= 3
#COLUMNINFO= 1, m, Sondeerlengte, 1
#COLUMNINFO= 2, MPa, Conusweerstand, 2
#COLUMNINFO= 3, MPa, Wrijving, 3
#COLUMNSEPARATOR= ;
#RECORDSEPARATOR= !
#EOH=
0.02 ; 5.0 ; 0.05 !
0.04 ; 6.0 ; 0.06 !
"#;
    let cpt = parse(gef).unwrap();
    assert_eq!(cpt.points.len(), 2);
    let p = cpt.points[0];
    assert!((p.rf.unwrap() - 1.0).abs() < 1e-6, "rf should be 1.0%, got {:?}", p.rf);
}

#[test]
fn applies_void_value() {
    let gef = r#"#GEFID= 1, 0, 0
#COLUMN= 2
#COLUMNINFO= 1, m, Length, 1
#COLUMNINFO= 2, MPa, Qc, 2
#COLUMNVOID= 2, -9999
#EOH=
0.02 -9999
0.04 5.5
"#;
    let cpt = parse(gef).unwrap();
    assert_eq!(cpt.points.len(), 2);
    assert_eq!(cpt.points[0].qc, None);
    assert_eq!(cpt.points[1].qc, Some(5.5));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p cpt-core --test test_gef`
Expected: FAIL — placeholder `parse` returns "not yet implemented".

- [ ] **Step 3: Implement GEF data parser**

Replace `cpt-core/src/gef/data.rs`:
```rust
//! GEF data section parsing.
//!
//! After `#EOH=`, lines contain numeric values one row per measurement.
//! Default separator: whitespace. Custom separator via `#COLUMNSEPARATOR= X`.
//! Default record separator: newline. Custom via `#RECORDSEPARATOR= Y`.

use crate::domain::{Cpt, MeasurementPoint, Metadata, Position};
use crate::error::CptError;
use super::columns::GefField;
use super::header::{parse_header, GefHeader};

pub fn parse(text: &str) -> Result<Cpt, CptError> {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = normalized.lines().collect();
    let (header, data_start) = parse_header(&lines)?;

    let (col_sep, rec_sep) = extract_separators(&lines);
    let body: String = lines[data_start..].join("\n");

    // Tokenize into records
    let records: Vec<&str> = if let Some(rs) = rec_sep {
        body.split(rs).collect()
    } else {
        body.lines().collect()
    };

    let mut points = Vec::new();
    for rec in records {
        let trimmed = rec.trim();
        if trimmed.is_empty() { continue; }
        let nums: Vec<f64> = if let Some(cs) = col_sep {
            trimmed.split(cs).filter_map(parse_num).collect()
        } else {
            trimmed.split_whitespace().filter_map(parse_num).collect()
        };
        if nums.is_empty() { continue; }
        if let Some(pt) = build_point(&nums, &header) {
            points.push(pt);
        }
    }

    let position = match (header.x_rd, header.y_rd) {
        (Some(x), Some(y)) => Some(Position { x_rd: x, y_rd: y, z_nap: header.z_nap }),
        _ => None,
    };

    Ok(Cpt {
        id: header.test_id.clone().unwrap_or_else(|| "Unknown".into()),
        metadata: Metadata {
            project_name: header.project_name.clone(),
            project_number: header.project_id.clone(),
            date: header.date,
            equipment: header.company_id.clone(),
            ground_level_nap: header.z_nap,
            source_file: String::new(),
        },
        position,
        points,
    })
}

fn parse_num(s: &str) -> Option<f64> {
    let s = s.trim();
    if s.is_empty() { return None; }
    s.parse::<f64>().ok()
}

fn extract_separators(lines: &[&str]) -> (Option<char>, Option<char>) {
    let mut col = None;
    let mut rec = None;
    for raw in lines {
        let line = raw.trim();
        if let Some(v) = line.strip_prefix("#COLUMNSEPARATOR=").map(str::trim) {
            col = v.chars().next();
        } else if let Some(v) = line.strip_prefix("#RECORDSEPARATOR=").map(str::trim) {
            rec = v.chars().next();
        }
    }
    (col, rec)
}

fn build_point(nums: &[f64], header: &GefHeader) -> Option<MeasurementPoint> {
    let mut p = MeasurementPoint {
        depth: 0.0,
        depth_nap: None,
        qc: None, fs: None, rf: None, u2: None, inclination: None,
    };
    let mut have_depth = false;

    for spec in &header.columns {
        let raw = nums.get(spec.index - 1).copied()?;
        // Apply void filter
        let voided = header.column_void.iter().any(|(c, v)| *c == spec.index && (raw - v).abs() < 1e-6);
        let value = if voided { None } else { Some(raw) };

        match spec.field {
            GefField::Length | GefField::Depth => {
                if let Some(v) = value { p.depth = v; have_depth = true; }
            }
            GefField::Qc => p.qc = value,
            GefField::Fs => p.fs = value,
            GefField::Rf => p.rf = value,
            GefField::U2 => p.u2 = value,
            GefField::Inclination => p.inclination = value,
            _ => {}
        }
    }

    if !have_depth { return None; }

    // Derive Rf from qc + fs if missing
    if p.rf.is_none() {
        if let (Some(qc), Some(fs)) = (p.qc, p.fs) {
            if qc > 0.0 { p.rf = Some(100.0 * fs / qc); }
        }
    }

    if let Some(z) = header.z_nap {
        p.depth_nap = Some(z - p.depth);
    }

    Some(p)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p cpt-core --test test_gef`
Expected: PASS — all 5 tests pass. If a real-world `2600356_*.GEF` file fails, debug by reading the file's header and adjusting parsing — log which keyword tripped it.

- [ ] **Step 5: Commit**

```bash
git add cpt-core/src/gef/data.rs cpt-core/tests/common.rs cpt-core/tests/test_gef.rs
git commit -m "feat(cpt-core): GEF data section parser with custom separators, void values, derived Rf"
```

---

## Task 9: BRO-XML parser

**Files:**
- Create: `cpt-core/src/bro/mod.rs`
- Create: `cpt-core/src/bro/columns.rs`
- Modify: `cpt-core/src/lib.rs`
- Create: `cpt-core/tests/test_bro.rs`

- [ ] **Step 1: Write the failing test**

Create `cpt-core/tests/test_bro.rs`:
```rust
mod common;

use cpt_core::bro::parse;
use common::read_fixture;

#[test]
fn parses_cpt_bro_xml() {
    let xml = read_fixture("cpt_bro.xml");
    let cpt = parse(&xml).expect("cpt_bro.xml should parse");
    assert!(!cpt.id.is_empty());
    assert!(!cpt.points.is_empty(), "expected at least one measurement point");
    let first = &cpt.points[0];
    assert!(first.depth >= 0.0);
    assert!(first.qc.is_some());
}

#[test]
fn applies_bro_void_value() {
    // BRO uses -999999 as the void marker; values that match should become None
    let xml = read_fixture("cpt_bro.xml");
    let cpt = parse(&xml).unwrap();
    // We don't know which fields are voided in this specific file, but the parser
    // must not return -999999 in any numeric field.
    for p in &cpt.points {
        for v in [p.qc, p.fs, p.rf, p.u2, p.inclination].iter().flatten() {
            assert!(*v > -100_000.0, "void value leaked through: {}", v);
        }
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p cpt-core --test test_bro`
Expected: FAIL — `bro` module not found.

- [ ] **Step 3: Implement BRO-XML parser**

Create `cpt-core/src/bro/columns.rs`:
```rust
//! Fixed 25-column order used by BRO CPT data arrays.
//!
//! Reference: BRO IMBRO/A CPT_O / CPT_O_DP standard.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BroField {
    Length, Depth, ElapsedTime, Qc, CorrectedQc, NetQc,
    MagX, MagY, MagZ, MagTotal, ElectricCond,
    InclEw, InclNs, InclX, InclY, Inclination,
    MagInclination, MagDeclination,
    Fs, PoreRatio, Temp, U1, U2, U3, Rf,
}

pub const ORDER: [BroField; 25] = [
    BroField::Length, BroField::Depth, BroField::ElapsedTime,
    BroField::Qc, BroField::CorrectedQc, BroField::NetQc,
    BroField::MagX, BroField::MagY, BroField::MagZ, BroField::MagTotal,
    BroField::ElectricCond,
    BroField::InclEw, BroField::InclNs, BroField::InclX, BroField::InclY, BroField::Inclination,
    BroField::MagInclination, BroField::MagDeclination,
    BroField::Fs, BroField::PoreRatio, BroField::Temp,
    BroField::U1, BroField::U2, BroField::U3, BroField::Rf,
];

pub const VOID_VALUE: f64 = -999_999.0;
```

Create `cpt-core/src/bro/mod.rs`:
```rust
//! BRO (Basisregistratie Ondergrond) XML parser for CPT_O / CPT_O_DP documents.
//!
//! Uses `quick-xml` for streaming parse. Extracts:
//! - broId (test id)
//! - location/X-Y (RD coordinates)
//! - vertical reference (Z-NAP)
//! - cpt date
//! - 25-column SWE data array

pub mod columns;

use chrono::NaiveDate;
use quick_xml::events::Event;
use quick_xml::reader::Reader;

use crate::domain::{Cpt, MeasurementPoint, Metadata, Position};
use crate::error::CptError;
use self::columns::{BroField, ORDER, VOID_VALUE};

pub fn parse(xml: &str) -> Result<Cpt, CptError> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();
    let mut path: Vec<String> = Vec::new();

    let mut id: Option<String> = None;
    let mut x: Option<f64> = None;
    let mut y: Option<f64> = None;
    let mut z: Option<f64> = None;
    let mut date: Option<NaiveDate> = None;
    let mut data_block: Option<String> = None;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let local = local_name(e.name().as_ref());
                path.push(local);
            }
            Ok(Event::End(_)) => { path.pop(); }
            Ok(Event::Text(t)) => {
                let txt = t.unescape().map_err(|e| CptError::InvalidBro(e.to_string()))?.into_owned();
                handle_text(&path, &txt, &mut id, &mut x, &mut y, &mut z, &mut date, &mut data_block);
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(CptError::InvalidBro(format!("xml at pos {}: {}", reader.buffer_position(), e))),
            _ => {}
        }
        buf.clear();
    }

    let id = id.ok_or_else(|| CptError::InvalidBro("missing broId".into()))?;
    let block = data_block.ok_or_else(|| CptError::InvalidBro("missing values data block".into()))?;
    let points = parse_data_block(&block, z);

    let position = match (x, y) {
        (Some(x), Some(y)) => Some(Position { x_rd: x, y_rd: y, z_nap: z }),
        _ => None,
    };

    Ok(Cpt {
        id,
        metadata: Metadata {
            project_name: None, project_number: None, date,
            equipment: None, ground_level_nap: z, source_file: String::new(),
        },
        position,
        points,
    })
}

fn local_name(qname: &[u8]) -> String {
    let s = std::str::from_utf8(qname).unwrap_or("");
    match s.rsplit_once(':') {
        Some((_, local)) => local.to_string(),
        None => s.to_string(),
    }
}

fn handle_text(
    path: &[String], txt: &str,
    id: &mut Option<String>, x: &mut Option<f64>, y: &mut Option<f64>,
    z: &mut Option<f64>, date: &mut Option<NaiveDate>, data_block: &mut Option<String>,
) {
    let last = match path.last() { Some(s) => s.as_str(), None => return };
    match last {
        "broId" if id.is_none() => *id = Some(txt.to_string()),
        "pos" => {
            // Two whitespace-separated coordinates
            let nums: Vec<f64> = txt.split_whitespace().filter_map(|s| s.parse().ok()).collect();
            if nums.len() >= 2 {
                *x = Some(nums[0]);
                *y = Some(nums[1]);
            }
        }
        "offset" => {
            if let Ok(v) = txt.parse::<f64>() { *z = Some(v); }
        }
        "researchReportDate" | "objectIdAccountableParty" | "cptStandard" => {
            // researchReportDate may be "YYYY" only — try anyway
            if last == "researchReportDate" && date.is_none() {
                if let Ok(d) = NaiveDate::parse_from_str(txt, "%Y-%m-%d") {
                    *date = Some(d);
                } else if let Ok(year) = txt.parse::<i32>() {
                    *date = NaiveDate::from_ymd_opt(year, 1, 1);
                }
            }
        }
        "values" => *data_block = Some(txt.to_string()),
        _ => {}
    }
}

fn parse_data_block(block: &str, z_nap: Option<f64>) -> Vec<MeasurementPoint> {
    // Records separated by ';', columns by ','
    block.split(';')
        .filter_map(|rec| {
            let trimmed = rec.trim();
            if trimmed.is_empty() { return None; }
            let nums: Vec<Option<f64>> = trimmed.split(',').map(|s| {
                let v = s.trim().parse::<f64>().ok()?;
                if (v - VOID_VALUE).abs() < 0.5 { None } else { Some(v) }
            }).collect();
            if nums.len() < ORDER.len() { return None; }
            build_point(&nums, z_nap)
        })
        .collect()
}

fn build_point(nums: &[Option<f64>], z_nap: Option<f64>) -> Option<MeasurementPoint> {
    let mut p = MeasurementPoint {
        depth: 0.0, depth_nap: None,
        qc: None, fs: None, rf: None, u2: None, inclination: None,
    };
    let mut have_depth = false;

    for (i, field) in ORDER.iter().enumerate() {
        let v = nums[i];
        match field {
            BroField::Depth => if let Some(d) = v { p.depth = d; have_depth = true; },
            BroField::Length => if !have_depth { if let Some(d) = v { p.depth = d; have_depth = true; } },
            BroField::Qc => p.qc = v,
            BroField::Fs => p.fs = v,
            BroField::Rf => p.rf = v,
            BroField::U2 => p.u2 = v,
            BroField::Inclination => p.inclination = v,
            _ => {}
        }
    }
    if !have_depth { return None; }

    if p.rf.is_none() {
        if let (Some(qc), Some(fs)) = (p.qc, p.fs) {
            if qc > 0.0 { p.rf = Some(100.0 * fs / qc); }
        }
    }

    if let Some(z) = z_nap { p.depth_nap = Some(z - p.depth); }

    Some(p)
}
```

Add `pub mod bro;` to `cpt-core/src/lib.rs`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p cpt-core --test test_bro`
Expected: PASS — both tests pass.

- [ ] **Step 5: Commit**

```bash
git add cpt-core/src/bro/ cpt-core/src/lib.rs cpt-core/tests/test_bro.rs
git commit -m "feat(cpt-core): BRO-XML parser using quick-xml (CPT_O / CPT_O_DP)"
```

---

## Task 10: `parse_auto` dispatcher

**Files:**
- Modify: `cpt-core/src/lib.rs`
- Create: `cpt-core/tests/test_parse_auto.rs`

- [ ] **Step 1: Write the failing test**

Create `cpt-core/tests/test_parse_auto.rs`:
```rust
mod common;

use cpt_core::parse_auto;
use common::read_fixture;

#[test]
fn dispatches_gef_by_prefix() {
    let text = read_fixture("voorbeeld.gef");
    let cpt = parse_auto(&text).unwrap();
    assert!(!cpt.points.is_empty());
}

#[test]
fn dispatches_xml_by_prefix() {
    let text = read_fixture("cpt_bro.xml");
    let cpt = parse_auto(&text).unwrap();
    assert!(!cpt.points.is_empty());
}

#[test]
fn rejects_unknown_format() {
    let result = parse_auto("hello world\nthis is not a CPT file");
    assert!(matches!(result, Err(cpt_core::CptError::UnknownFormat)));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p cpt-core --test test_parse_auto`
Expected: FAIL — `parse_auto` not defined.

- [ ] **Step 3: Implement dispatcher in `lib.rs`**

Add to `cpt-core/src/lib.rs`:
```rust
pub use gef::parse as parse_gef;
pub use bro::parse as parse_bro;

/// Detect format from the first non-whitespace bytes and dispatch.
/// - GEF files start with `#GEF` (or sometimes `#GEFID`)
/// - BRO XML starts with `<?xml` or `<` (ignoring leading whitespace)
pub fn parse_auto(content: &str) -> Result<Cpt, CptError> {
    let trimmed = content.trim_start();
    if trimmed.starts_with("#GEF") || trimmed.starts_with("#GEFID") {
        return parse_gef(content);
    }
    if trimmed.starts_with("<?xml") || trimmed.starts_with('<') {
        return parse_bro(content);
    }
    Err(CptError::UnknownFormat)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p cpt-core --test test_parse_auto`
Expected: PASS — all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add cpt-core/src/lib.rs cpt-core/tests/test_parse_auto.rs
git commit -m "feat(cpt-core): parse_auto dispatcher (detect GEF vs XML by prefix)"
```

---

## Task 11: SVG plot rendering

**Files:**
- Create: `cpt-core/src/plot/mod.rs`
- Create: `cpt-core/src/plot/axes.rs`
- Create: `cpt-core/src/plot/curves.rs`
- Create: `cpt-core/src/plot/sbt_strip.rs`
- Modify: `cpt-core/src/lib.rs`
- Create: `cpt-core/tests/test_plot.rs`

- [ ] **Step 1: Write the failing test**

Create `cpt-core/tests/test_plot.rs`:
```rust
mod common;

use cpt_core::{parse_auto, render_cpt_svg};
use common::read_fixture;

#[test]
fn renders_voorbeeld_to_svg() {
    let cpt = parse_auto(&read_fixture("voorbeeld.gef")).unwrap();
    let svg = render_cpt_svg(&cpt);

    // Sanity: SVG root element present
    assert!(svg.starts_with("<svg") || svg.starts_with("<?xml"));
    assert!(svg.contains("</svg>"));

    // Sanity: must include the qc curve in some form
    assert!(svg.contains("polyline") || svg.contains("path"));

    // Sanity: SBT strip color appears (at least one Robertson colour)
    assert!(
        ["#FF9800", "#4CAF50", "#FFC107", "#FF5722", "#8BC34A", "#795548"]
            .iter().any(|c| svg.contains(c)),
        "expected at least one Robertson colour in the SVG"
    );
}

#[test]
fn handles_empty_cpt() {
    let cpt = cpt_core::Cpt {
        id: "empty".into(),
        metadata: cpt_core::Metadata { source_file: "x".into(), ..Default::default() },
        position: None,
        points: vec![],
    };
    let svg = render_cpt_svg(&cpt);
    // Should still produce a valid empty-state SVG, not panic
    assert!(svg.contains("<svg"));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p cpt-core --test test_plot`
Expected: FAIL — `render_cpt_svg` not defined.

- [ ] **Step 3: Implement plot rendering**

Create `cpt-core/src/plot/axes.rs`:
```rust
//! Axis scaling helpers.

pub struct LinearAxis { pub min: f64, pub max: f64, pub px_start: f64, pub px_end: f64 }

impl LinearAxis {
    pub fn project(&self, value: f64) -> f64 {
        let range = self.max - self.min;
        if range.abs() < f64::EPSILON { return self.px_start; }
        let t = (value - self.min) / range;
        self.px_start + t * (self.px_end - self.px_start)
    }
}

pub fn nice_max(value: f64) -> f64 {
    if value <= 0.0 { return 1.0; }
    let pow = 10f64.powi(value.log10().floor() as i32);
    let n = (value / pow).ceil();
    let r = if n <= 1.0 { 1.0 } else if n <= 2.0 { 2.0 } else if n <= 5.0 { 5.0 } else { 10.0 };
    r * pow
}
```

Create `cpt-core/src/plot/curves.rs`:
```rust
//! Curve path generation for qc, fs, Rf.

use crate::domain::Cpt;
use super::axes::LinearAxis;

pub fn polyline_points<F>(cpt: &Cpt, x_axis: &LinearAxis, y_axis: &LinearAxis, value: F) -> String
where F: Fn(&crate::domain::MeasurementPoint) -> Option<f64>
{
    let mut s = String::new();
    for p in &cpt.points {
        if let Some(v) = value(p) {
            let x = x_axis.project(v);
            let y = y_axis.project(p.depth);
            if !s.is_empty() { s.push(' '); }
            s.push_str(&format!("{:.2},{:.2}", x, y));
        }
    }
    s
}
```

Create `cpt-core/src/plot/sbt_strip.rs`:
```rust
//! Vertical Robertson SBT colour strip.

use crate::layers::detect_layers;
use crate::domain::Cpt;
use super::axes::LinearAxis;

pub fn render(cpt: &Cpt, y_axis: &LinearAxis, x: f64, width: f64) -> String {
    let mut out = String::new();
    for layer in detect_layers(cpt) {
        let y_top = y_axis.project(layer.depth_top);
        let y_bot = y_axis.project(layer.depth_bottom);
        out.push_str(&format!(
            r#"<rect x="{:.2}" y="{:.2}" width="{:.2}" height="{:.2}" fill="{}" />"#,
            x, y_top, width, (y_bot - y_top).max(0.0), layer.zone_color
        ));
    }
    out
}
```

Create `cpt-core/src/plot/mod.rs`:
```rust
//! SVG plot rendering for a single CPT, NEN-EN-ISO 22476-1 layout.
//!
//! Output is a self-contained SVG string that the openaec PDF engine
//! embeds via `resvg` (vector → raster at PDF resolution).

pub mod axes;
pub mod curves;
pub mod sbt_strip;

use crate::domain::Cpt;
use axes::{LinearAxis, nice_max};

const W: f64 = 600.0;
const H: f64 = 800.0;
const M_LEFT: f64 = 60.0;
const M_RIGHT: f64 = 30.0;
const M_TOP: f64 = 40.0;
const M_BOTTOM: f64 = 40.0;
const SBT_W: f64 = 18.0;
const SBT_GAP: f64 = 6.0;

pub fn render_cpt_svg(cpt: &Cpt) -> String {
    if cpt.points.is_empty() {
        return format!(r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}">
<text x="{}" y="{}" text-anchor="middle" font-family="Inter" font-size="14" fill="#888">No data</text>
</svg>"#, W / 2.0, H / 2.0);
    }

    // Depth range (m below ground level)
    let max_depth = cpt.points.iter().map(|p| p.depth).fold(0.0_f64, f64::max);
    let y_axis = LinearAxis { min: 0.0, max: max_depth, px_start: M_TOP, px_end: H - M_BOTTOM };

    // qc range — auto-fit, nice round
    let max_qc = cpt.points.iter().filter_map(|p| p.qc).fold(0.0_f64, f64::max);
    let qc_max = nice_max(max_qc.max(1.0));
    let qc_axis = LinearAxis { min: 0.0, max: qc_max, px_start: M_LEFT, px_end: W - M_RIGHT - SBT_W - SBT_GAP };

    // Rf is plotted on a secondary scale 0..10%
    let rf_axis = LinearAxis { min: 10.0, max: 0.0, px_start: M_LEFT, px_end: W - M_RIGHT - SBT_W - SBT_GAP };

    // Curves
    let qc_points = curves::polyline_points(cpt, &qc_axis, &y_axis, |p| p.qc);
    let rf_points = curves::polyline_points(cpt, &rf_axis, &y_axis, |p| p.rf);

    // SBT strip on the right
    let sbt = sbt_strip::render(cpt, &y_axis, W - M_RIGHT - SBT_W, SBT_W);

    // Depth ticks every 1m
    let mut ticks = String::new();
    let mut d = 0.0;
    while d <= max_depth {
        let y = y_axis.project(d);
        ticks.push_str(&format!(
            r#"<line x1="{}" y1="{:.2}" x2="{}" y2="{:.2}" stroke="#E7E5E4" stroke-width="0.5" />
<text x="{}" y="{:.2}" font-family="JetBrains Mono" font-size="9" fill="#57534E" text-anchor="end" dominant-baseline="central">{:.1}</text>"#,
            M_LEFT, y, W - M_RIGHT - SBT_W - SBT_GAP, y,
            M_LEFT - 4.0, y, d
        ));
        d += 1.0;
    }

    format!(r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" font-family="Inter">
<rect x="0" y="0" width="{W}" height="{H}" fill="#FAFAF9" />
{ticks}
<polyline points="{qc_points}" fill="none" stroke="#D97706" stroke-width="1.2" />
<polyline points="{rf_points}" fill="none" stroke="#F59E0B" stroke-width="1.2" />
{sbt}
<text x="{}" y="20" font-family="Space Grotesk" font-weight="700" font-size="12" fill="#36363E">Sondering {}</text>
</svg>"#, M_LEFT, cpt.id)
}
```

Add `pub mod plot; pub use plot::render_cpt_svg;` to `cpt-core/src/lib.rs`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p cpt-core --test test_plot`
Expected: PASS — both tests pass.

- [ ] **Step 5: Commit**

```bash
git add cpt-core/src/plot/ cpt-core/src/lib.rs cpt-core/tests/test_plot.rs
git commit -m "feat(cpt-core): SVG plot rendering with qc/Rf curves and SBT strip"
```

---

## Task 12: Report builder (cpt → openaec ReportData)

**Files:**
- Create: `cpt-core/src/report.rs`
- Modify: `cpt-core/src/lib.rs`
- Create: `cpt-core/tests/test_report.rs`

- [ ] **Step 1: Write the failing test**

Create `cpt-core/tests/test_report.rs`:
```rust
mod common;

use cpt_core::{parse_auto, build_report, ProjectMeta};
use common::read_fixture;

#[test]
fn builds_report_for_one_cpt() {
    let cpt = parse_auto(&read_fixture("voorbeeld.gef")).unwrap();
    let project = ProjectMeta {
        title: "Voorbeeld project".into(),
        client: "ACME bv".into(),
        location: "Amsterdam".into(),
        project_number: "2026-001".into(),
        author: "Open GEO Studio".into(),
        date: chrono::NaiveDate::from_ymd_opt(2026, 5, 15).unwrap(),
    };
    let report = build_report(&[cpt], &project);
    assert_eq!(report.project, "Voorbeeld project");
    assert!(report.cover.is_some());
    // Sections: at least coordinate table + 1 per CPT page
    assert!(report.sections.len() >= 2, "got {} sections", report.sections.len());
}

#[test]
fn report_serializes_to_json() {
    let cpt = parse_auto(&read_fixture("cpt_bro.xml")).unwrap();
    let project = ProjectMeta {
        title: "T".into(), client: "C".into(), location: "L".into(),
        project_number: "P".into(), author: "A".into(),
        date: chrono::NaiveDate::from_ymd_opt(2026, 5, 15).unwrap(),
    };
    let report = build_report(&[cpt], &project);
    let json = serde_json::to_string(&report).unwrap();
    assert!(json.contains("\"project\":\"T\""));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p cpt-core --test test_report`
Expected: FAIL — `build_report`, `ProjectMeta` not defined.

- [ ] **Step 3: Implement report builder**

Create `cpt-core/src/report.rs`:
```rust
//! Report builder — produces an `openaec_core::ReportData` from CPTs and
//! project metadata. The actual PDF rendering happens in `openaec-engine`.

use chrono::NaiveDate;
use openaec_core::schema::{
    Cover, ContentBlock, ImageBlock, ImageSource, Orientation, PaperFormat,
    ParagraphBlock, ReportData, ReportStatus, Section, TableBlock, TableRow, TableCell,
};

use crate::domain::Cpt;
use crate::plot::render_cpt_svg;

#[derive(Debug, Clone)]
pub struct ProjectMeta {
    pub title: String,
    pub client: String,
    pub location: String,
    pub project_number: String,
    pub author: String,
    pub date: NaiveDate,
}

pub fn build(cpts: &[Cpt], project: &ProjectMeta) -> ReportData {
    let cover = Some(Cover {
        subtitle: Some(format!("Grondonderzoek — {}", project.location)),
        image: None,
        extra_fields: [
            ("Opdrachtgever".into(), project.client.clone()),
            ("Locatie".into(), project.location.clone()),
            ("Projectnummer".into(), project.project_number.clone()),
            ("Auteur".into(), project.author.clone()),
            ("Datum".into(), project.date.to_string()),
        ].into_iter().collect(),
    });

    let mut sections: Vec<Section> = Vec::new();

    // 1. Coordinate table
    sections.push(Section {
        title: "Coördinatentabel".into(),
        level: 1,
        page_break_before: true,
        orientation: None,
        content: vec![ContentBlock::Table(coord_table(cpts))],
    });

    // 2. One page per CPT
    for cpt in cpts {
        let svg = render_cpt_svg(cpt);
        let svg_b64 = base64_encode(svg.as_bytes());
        sections.push(Section {
            title: format!("Sondering {}", cpt.id),
            level: 1,
            page_break_before: true,
            orientation: None,
            content: vec![
                ContentBlock::Paragraph(ParagraphBlock {
                    text: format!("Sondering {} — diepte tot {:.2} m", cpt.id, cpt_max_depth(cpt)),
                    style: "Normal".into(),
                }),
                ContentBlock::Image(ImageBlock {
                    source: ImageSource::DataUri(format!("data:image/svg+xml;base64,{}", svg_b64)),
                    caption: Some(format!("CPT plot — sondering {}", cpt.id)),
                    width_mm: Some(170.0),
                    height_mm: Some(220.0),
                }),
            ],
        });
    }

    ReportData {
        template: "openaec.cpt".into(),
        project: project.title.clone(),
        tenant: Some("openaec".into()),
        format: PaperFormat::A4,
        orientation: Orientation::Portrait,
        project_number: Some(project.project_number.clone()),
        client: Some(project.client.clone()),
        author: project.author.clone(),
        date: Some(project.date.to_string()),
        version: "1".into(),
        status: ReportStatus::Concept,
        cover,
        colofon: None,
        toc: None,
        sections,
        backcover: None,
        metadata: Default::default(),
    }
}

fn coord_table(cpts: &[Cpt]) -> TableBlock {
    let header = TableRow {
        cells: ["Sondering", "X-RD", "Y-RD", "Z-NAP", "Diepte tot", "Datum"]
            .iter().map(|s| TableCell { text: (*s).into() }).collect(),
    };
    let body: Vec<TableRow> = cpts.iter().map(|c| TableRow {
        cells: vec![
            TableCell { text: c.id.clone() },
            TableCell { text: c.position.map(|p| format!("{:.2}", p.x_rd)).unwrap_or_default() },
            TableCell { text: c.position.map(|p| format!("{:.2}", p.y_rd)).unwrap_or_default() },
            TableCell { text: c.position.and_then(|p| p.z_nap).map(|z| format!("{:.2}", z)).unwrap_or_default() },
            TableCell { text: format!("{:.2}", cpt_max_depth(c)) },
            TableCell { text: c.metadata.date.map(|d| d.to_string()).unwrap_or_default() },
        ],
    }).collect();
    let mut rows = vec![header];
    rows.extend(body);
    TableBlock { rows, ..Default::default() }
}

fn cpt_max_depth(cpt: &Cpt) -> f64 {
    cpt.points.iter().map(|p| p.depth).fold(0.0_f64, f64::max)
}

fn base64_encode(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}
```

Add to `cpt-core/Cargo.toml` `[dependencies]`:
```toml
base64 = { workspace = true }
```

Add `pub mod report; pub use report::{build as build_report, ProjectMeta};` to `cpt-core/src/lib.rs`.

> **NOTE:** if `openaec_core::schema` doesn't expose `TableBlock`, `TableRow`, `TableCell`, `ImageBlock`, or `ImageSource::DataUri` with these exact shapes, adapt the field names — the test will fail with a compile error and the precise mismatch is visible. The import line at the top is the single point of adjustment. If `ImageBlock` requires a different field for SVG embedding (e.g. `svg_data: String`), inline the SVG instead of base64 — same outcome.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p cpt-core --test test_report`
Expected: PASS — both tests pass. If the compile fails on `openaec_core::schema` mismatches, read `crates-warehouse/openaec-core/src/schema.rs` and align the imports/struct construction. Do not invent fields; mirror exactly what's defined there.

- [ ] **Step 5: Commit**

```bash
git add cpt-core/src/report.rs cpt-core/src/lib.rs cpt-core/Cargo.toml cpt-core/tests/test_report.rs
git commit -m "feat(cpt-core): report builder producing openaec_core::ReportData"
```

---

## Task 13: Full workspace test + README polish

**Files:**
- Modify: `cpt-core/README.md`

- [ ] **Step 1: Run the full crate test suite**

Run: `cargo test -p cpt-core --all-targets`
Expected: ALL PASS — every test from Tasks 2 through 12.

- [ ] **Step 2: Run workspace check to ensure no regressions**

Run: `cargo check --workspace`
Expected: PASS — no other crate broken by the addition.

- [ ] **Step 3: Run clippy on cpt-core**

Run: `cargo clippy -p cpt-core --all-targets -- -D warnings`
Expected: PASS or fix the warnings inline (no new dependencies, no behaviour changes).

- [ ] **Step 4: Update README with usage example**

Replace `cpt-core/README.md`:
```markdown
# cpt-core

CPT (Cone Penetration Test) domain library for the OpenAEC ecosystem.

## Features
- GEF 1.x parser (Dutch Geotechnical Exchange Format)
- BRO-XML parser (Dutch Basisregistratie Ondergrond CPT_O / CPT_O_DP)
- Robertson 1990 SBT classification (9 zones)
- Layer detection (consecutive same-zone grouping with min-thickness merge)
- RD ↔ WGS84 coordinate transformation (Kadaster polynomial)
- SVG plot rendering (NEN-EN-ISO 22476-1 layout)
- Report builder producing `openaec_core::ReportData`

## Usage

```rust
use cpt_core::{parse_auto, build_report, ProjectMeta, render_cpt_svg};

let text = std::fs::read_to_string("sondering.gef")?;
let cpt = parse_auto(&text)?;

let project = ProjectMeta {
    title: "My project".into(),
    client: "ACME bv".into(),
    location: "Amsterdam".into(),
    project_number: "2026-001".into(),
    author: "Open GEO Studio".into(),
    date: chrono::NaiveDate::from_ymd_opt(2026, 5, 15).unwrap(),
};
let report = build_report(&[cpt.clone()], &project);

// Hand off to openaec-engine for PDF rendering:
let pdf_bytes = openaec_engine::generate_pdf_bytes(&report)?;
std::fs::write("rapport.pdf", pdf_bytes)?;

// Or render the plot directly as SVG:
let svg = render_cpt_svg(&cpt);
std::fs::write("sondering.svg", svg)?;
```

## License
MIT
```

- [ ] **Step 5: Commit**

```bash
git add cpt-core/README.md
git commit -m "docs(cpt-core): expand README with usage example"
```

---

## Self-Review

After all tasks are done, the spec coverage check:

| Spec requirement (§3 of design) | Task |
|---|---|
| `domain.rs` types | Task 2 |
| `error.rs` | Task 3 |
| Robertson classification | Task 4 |
| Layer detection | Task 5 |
| `coords.rs` RD↔WGS84 | Task 6 |
| GEF parser | Tasks 7 + 8 |
| BRO-XML parser | Task 9 |
| `parse_auto` dispatcher | Task 10 |
| `plot::render_cpt_svg` | Task 11 |
| `report::build` | Task 12 |
| Tests against `verification-files/GEF-BRO-XML/` fixtures | Tasks 8, 9, 10, 11, 12 |
| Workspace integration | Task 1 |

All covered.

## Out of scope for this plan

- Tauri app (in next plan: `2026-05-15-open-geo-studio-app.md`)
- Repo rename `cpt-viewer` → `open-geo-studio` (in next plan)
- PDOK BRO area HTTP loader (lives in `src-tauri`, not in `cpt-core`)
- Chart canvas in TS (lives in React app)
