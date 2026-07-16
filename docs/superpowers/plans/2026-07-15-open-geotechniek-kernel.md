# Open Geotechniek Studio Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a native Rust `bro-xml` parser for CPT, BHR-GT, and BHR-G plus an `open-geotechniek-kernel` façade, then migrate the desktop, REST, and MCP adapters to that shared kernel without changing existing client payloads.

**Architecture:** `bro-xml` owns transport-free BRO detection, parsing, typed models, and reference codes. `open-geotechniek-kernel` owns project state, invariants, conversion to `cpt-core`, and in-memory serialization. Tauri, REST, MCP, filesystem, and HTTP remain outer adapters in `cpt-viewer`.

**Tech Stack:** Rust 2021, `quick-xml`, `serde`, `thiserror`, existing `cpt-core`, Tauri 2, Axum 0.7, TypeScript 5, Vitest.

## Global Constraints

- The implementation is fully native Rust; no Node or TypeScript runtime is used by either new crate.
- `bro-xml` supports CPT `dscpt/1.1`, BHR-GT `dsbhr-gt/2.1`, and BHR-G `dsbhrg/3.1` in the first release.
- `bro-xml` and `open-geotechniek-kernel` contain no Tauri, Axum, MCP transport, filesystem, or default-build network dependency.
- Existing frontend payloads and project files remain compatible during migration.
- Do not publish either crate; `cargo package` is verification only.
- Preserve the existing uncommitted `crates-warehouse/Cargo.toml` `openaec-pdf-v1` exclusion and the untracked `crates-warehouse/openaec-pdf-v1/` directory. Add workspace members without reverting or staging unrelated changes.
- Repository content must not name external calculation products or contain assistant conversation history.
- The `bro-xml` README must name Bedrock and link `https://github.com/bedrock-engineer/bro-xml-parser-ts`, while describing this crate as an independent Rust implementation.

---

## Planned File Structure

### `crates-warehouse/bro-xml`

- `Cargo.toml`: publishable crate metadata and parser dependencies.
- `README.md`: usage, supported schemas, compatibility policy, Bedrock attribution.
- `src/lib.rs`: public API and re-exports only.
- `src/document.rs`: document enums, schema version, common metadata, parse options.
- `src/error.rs`: `BroError` and field-path helpers.
- `src/xml.rs`: namespace-independent streaming XML helpers and scalar conversion.
- `src/cpt.rs`: CPT model and `dscpt/1.1` parser.
- `src/bhr_gt.rs`: BHR-GT model and `dsbhr-gt/2.1` parser.
- `src/bhr_g.rs`: BHR-G model and `dsbhrg/3.1` parser.
- `src/reference_codes.rs`: checked-in code-to-description lookups.
- `tests/fixtures/*.xml`: self-contained synthetic schema fixtures with no network dependency.
- `tests/detection.rs`: document and schema detection contracts.
- `tests/cpt.rs`: CPT parsing and null-value contracts.
- `tests/boreholes.rs`: BHR-GT and BHR-G parsing contracts.
- `tests/errors.rs`: malformed input and typed-error contracts.

### `crates-warehouse/open-geotechniek-kernel`

- `Cargo.toml`: publishable façade metadata and path/version dependencies.
- `README.md`: kernel boundary and examples.
- `src/lib.rs`: public re-exports.
- `src/error.rs`: `KernelError`.
- `src/object.rs`: `ObjectKind`, `GeotechnicalObject`, and identity accessors.
- `src/project.rs`: `GeotechnicalProject`, metadata, invariants, and CRUD.
- `src/import.rs`: BRO/GEF/IfcGeo import use-cases.
- `src/cpt.rs`: loss-aware conversion from `bro_xml::CptDocument` to `cpt_core::Cpt`.
- `src/project_file.rs`: in-memory existing-project load/save bridge.
- `tests/import.rs`: three-type import and CPT conversion tests.
- `tests/project.rs`: duplicate, CRUD, and ordering tests.
- `tests/project_file.rs`: compatibility and round-trip tests.

### `cpt-viewer/apps/desktop`

- `src-tauri/Cargo.toml`: add the kernel path dependency.
- `src-tauri/src/state.rs`: replace the public CPT map with a mutex-protected kernel project; retain extension state.
- `src-tauri/src/commands/document.rs`: generic native import command and compatibility DTOs.
- `src-tauri/src/commands/cpt.rs`: preserve existing command names while delegating to the kernel.
- `src-tauri/src/commands/project.rs`: keep filesystem I/O in the adapter and delegate text parsing/serialization.
- `src-tauri/src/commands/export.rs`, `report.rs`, `ifc.rs`: read CPTs through kernel accessors.
- `src-tauri/src/rest.rs`: use the kernel-backed command functions and add generic object import/list routes.
- `src-tauri/src/mcp/server.rs`, `mcp/tools.rs`: use the same functions and expose generic BRO import.
- `src-tauri/src/lib.rs`: register the generic Tauri command and kernel state.
- `src/types/bore.ts`: retain presentation helpers and types, remove XML parsing and sniffing.
- `src/types/broCptParser.ts`: remove after desktop routing no longer imports it; keep web fallback only if the web build contract requires it.
- `src/utils/platform.ts`: add native generic document parsing and keep explicit web-only fallbacks.
- `src/store/useCptStore.ts`: consume the Rust DTO for CPT and bore imports.
- `src/store/useCptStore.test.ts`: verify CPT/BHR-GT/BHR-G routing and unchanged store shapes.
- `docs/API.md`: document generic REST and MCP object import.

---

### Task 1: Register `bro-xml` and implement typed detection

**Files:**
- Modify: `C:/Users/rickd/Documents/GitHub/crates-warehouse/Cargo.toml`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/bro-xml/Cargo.toml`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/bro-xml/src/lib.rs`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/bro-xml/src/document.rs`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/bro-xml/src/error.rs`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/bro-xml/tests/detection.rs`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/bro-xml/tests/fixtures/cpt-minimal.xml`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/bro-xml/tests/fixtures/bhr-gt-minimal.xml`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/bro-xml/tests/fixtures/bhr-g-minimal.xml`

**Interfaces:**
- Consumes: UTF-8 BRO XML as `&str`.
- Produces: `detect(&str) -> Result<DetectedDocument, BroError>`, `BroDocumentType`, `SchemaVersion`, `ParseOptions`, and the stable `BroError` enum.

- [ ] **Step 1: Add failing detection tests and minimal fixtures**

Create three fixtures whose document elements are respectively `CPT_O`, `BHR_GT_O`, and `BHR_G_O`, with namespace URIs ending in `dscpt/1.1`, `dsbhr-gt/2.1`, and `dsbhrg/3.1`. Add this test:

```rust
use bro_xml::{detect, BroDocumentType, SchemaVersion};

#[test]
fn detects_all_supported_documents() {
    let cases = [
        (include_str!("fixtures/cpt-minimal.xml"), BroDocumentType::Cpt, SchemaVersion::new(1, 1)),
        (include_str!("fixtures/bhr-gt-minimal.xml"), BroDocumentType::BhrGt, SchemaVersion::new(2, 1)),
        (include_str!("fixtures/bhr-g-minimal.xml"), BroDocumentType::BhrG, SchemaVersion::new(3, 1)),
    ];
    for (xml, expected_type, expected_version) in cases {
        let detected = detect(xml).expect("fixture must be detected");
        assert_eq!(detected.document_type, expected_type);
        assert_eq!(detected.schema_version, expected_version);
    }
}

#[test]
fn rejects_non_bro_xml() {
    let error = detect("<project><name>x</name></project>").unwrap_err();
    assert!(matches!(error, bro_xml::BroError::UnsupportedDocument { .. }));
}
```

- [ ] **Step 2: Run the detection test and verify the expected failure**

Run: `cargo test -p bro-xml --test detection`

Expected: Cargo reports that package `bro-xml` or its imported API does not exist.

- [ ] **Step 3: Add the workspace member and publishable manifest**

Add `"bro-xml"` to the existing `members` list without altering the current `exclude` block. Use:

```toml
[package]
name = "bro-xml"
description = "Typed parser for Dutch BRO XML geotechnical and geological documents"
version.workspace = true
edition.workspace = true
license.workspace = true
repository = "https://github.com/OpenAEC-Foundation/crates-warehouse"
readme = "README.md"
keywords = ["bro", "xml", "geotechnical", "geology"]
categories = ["parser-implementations", "science"]

[dependencies]
quick-xml = "0.36"
serde = { workspace = true }
thiserror = { workspace = true }
chrono = { version = "0.4", features = ["serde"] }
```

- [ ] **Step 4: Implement the minimal stable detection types**

Define `BroDocumentType::{Cpt, BhrGt, BhrG}`, `SchemaVersion { major, minor }`, `DetectedDocument`, and `ParseOptions { retain_source: bool }`. Implement `detect` with `quick_xml::Reader`, comparing element local names and extracting the numeric suffix from the namespace URI. Return `UnsupportedDocument` when no supported document element is found and `UnsupportedSchema` when its detected version differs from the supported version for that type.

The public error variants must be:

```rust
#[derive(Debug, thiserror::Error)]
pub enum BroError {
    #[error("invalid XML at {position:?}: {message}")]
    InvalidXml { position: Option<u64>, message: String },
    #[error("unsupported BRO document root: {root}")]
    UnsupportedDocument { root: String },
    #[error("unsupported {document:?} schema version {version}")]
    UnsupportedSchema { document: BroDocumentType, version: String },
    #[error("missing required field {path}")]
    MissingField { path: String },
    #[error("invalid value at {path}: {value}")]
    InvalidValue { path: String, value: String },
}
```

- [ ] **Step 5: Run detection tests and crate linting**

Run: `cargo test -p bro-xml --test detection`

Expected: 2 tests pass.

Run: `cargo clippy -p bro-xml --all-targets -- -D warnings`

Expected: exit code 0 with no warnings.

- [ ] **Step 6: Commit only Task 1 warehouse files**

```powershell
git add bro-xml Cargo.toml Cargo.lock
git commit -m "feat(bro-xml): detect supported BRO documents"
```

Before committing, use `git diff --cached -- Cargo.toml` and confirm the pre-existing `exclude = ["openaec-pdf-v1"]` change is not accidentally included unless it was already committed by its owner.

---

### Task 2: Build common XML extraction and metadata models

**Files:**
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/bro-xml/src/xml.rs`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/bro-xml/src/cpt.rs`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/bro-xml/src/bhr_gt.rs`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/bro-xml/src/bhr_g.rs`
- Modify: `C:/Users/rickd/Documents/GitHub/crates-warehouse/bro-xml/src/document.rs`
- Modify: `C:/Users/rickd/Documents/GitHub/crates-warehouse/bro-xml/src/lib.rs`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/bro-xml/tests/errors.rs`

**Interfaces:**
- Consumes: `quick_xml` start, text, empty, and end events.
- Produces: `CommonMetadata`, `Position`, `VerticalPosition`, local-name helpers, required/optional scalar parsers, and consistent field-path errors used by all three parsers.

- [ ] **Step 1: Write failing common-metadata and error tests**

```rust
use bro_xml::{parse, parse_with_options, BroDocument, BroError, ParseOptions};

#[test]
fn preserves_common_metadata_and_optional_source() {
    let xml = include_str!("fixtures/cpt-minimal.xml");
    let document = parse_with_options(xml, ParseOptions { retain_source: true }).unwrap();
    let BroDocument::Cpt(cpt) = document else { panic!("expected CPT") };
    assert_eq!(cpt.common.bro_id, "CPT000000000001");
    assert_eq!(cpt.common.position.as_ref().unwrap().crs, "EPSG:28992");
    assert_eq!(cpt.source_xml.as_deref(), Some(xml));
}

#[test]
fn malformed_xml_has_a_position() {
    let error = parse("<CPT_O><broken></CPT_O>").unwrap_err();
    assert!(matches!(error, BroError::InvalidXml { position: Some(_), .. }));
}
```

- [ ] **Step 2: Run the tests and confirm missing API failures**

Run: `cargo test -p bro-xml --test errors`

Expected: compilation fails because `parse`, `BroDocument`, and common model fields are not defined.

- [ ] **Step 3: Implement focused common types**

Use these public shapes:

```rust
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Position {
    pub x: f64,
    pub y: f64,
    pub crs: String,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct VerticalPosition {
    pub offset: f64,
    pub datum: Option<String>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CommonMetadata {
    pub bro_id: String,
    pub schema_version: SchemaVersion,
    pub quality_regime: Option<String>,
    pub accountable_party: Option<String>,
    pub registration_time: Option<chrono::NaiveDate>,
    pub research_start_date: Option<chrono::NaiveDate>,
    pub research_end_date: Option<chrono::NaiveDate>,
    pub position: Option<Position>,
    pub vertical_position: Option<VerticalPosition>,
    pub extensions: std::collections::BTreeMap<String, String>,
}
```

Keep `src/xml.rs` private. It must expose crate-private `local_name`, `parse_f64`, `parse_date`, `required`, and an event collector that stores leaf text by a slash-separated local-name path. Limit `extensions` to primitive leaf values shorter than 200 characters and exclude geometry/data-array nodes.

- [ ] **Step 4: Add `BroDocument` and parse dispatch**

Define:

```rust
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum BroDocument {
    Cpt(crate::CptDocument),
    BhrGt(crate::BhrGtDocument),
    BhrG(crate::BhrGDocument),
}

pub fn parse(xml: &str) -> Result<BroDocument, BroError> {
    parse_with_options(xml, ParseOptions::default())
}

pub fn parse_with_options(xml: &str, options: ParseOptions) -> Result<BroDocument, BroError> {
    match detect(xml)?.document_type {
        BroDocumentType::Cpt => crate::cpt::parse(xml, options).map(BroDocument::Cpt),
        BroDocumentType::BhrGt => crate::bhr_gt::parse(xml, options).map(BroDocument::BhrGt),
        BroDocumentType::BhrG => crate::bhr_g::parse(xml, options).map(BroDocument::BhrG),
    }
}
```

Create a minimal CPT parser body that extracts `CommonMetadata`, retains source according to `ParseOptions`, and returns an empty measurement vector. Create BHR-GT and BHR-G parser bodies that compile and return `MissingField` for their first required document field. Task 3 extends the CPT body with result parsing; Task 4 replaces both borehole bodies.

- [ ] **Step 5: Run all `bro-xml` tests**

Run: `cargo test -p bro-xml`

Expected: detection and error tests pass; parser-specific suites are not present yet.

- [ ] **Step 6: Commit Task 2**

```powershell
git add bro-xml/src bro-xml/tests/errors.rs bro-xml/tests/fixtures
git commit -m "feat(bro-xml): add common metadata extraction"
```

---

### Task 3: Implement the CPT parser and null-value semantics

**Files:**
- Modify: `C:/Users/rickd/Documents/GitHub/crates-warehouse/bro-xml/src/cpt.rs`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/bro-xml/tests/cpt.rs`
- Modify: `C:/Users/rickd/Documents/GitHub/crates-warehouse/bro-xml/tests/fixtures/cpt-minimal.xml`
- Modify: `C:/Users/rickd/Documents/GitHub/crates-warehouse/bro-xml/src/lib.rs`

**Interfaces:**
- Consumes: CPT `dscpt/1.1` XML, including the fixed 25-column SWE data block.
- Produces: `parse_cpt(&str) -> Result<CptDocument, BroError>`, `parse_cpt_with_options(&str, ParseOptions)`, `CptDocument`, `CptMeasurement`, sorted measurements, and no leaked BRO null sentinel.

- [ ] **Step 1: Write failing CPT behavior tests**

```rust
use bro_xml::parse_cpt;

#[test]
fn parses_and_sorts_cpt_measurements() {
    let cpt = parse_cpt(include_str!("fixtures/cpt-minimal.xml")).unwrap();
    assert_eq!(cpt.common.bro_id, "CPT000000000001");
    assert_eq!(cpt.measurements.len(), 2);
    assert!(cpt.measurements[0].depth <= cpt.measurements[1].depth);
    assert_eq!(cpt.measurements[0].cone_resistance, Some(4.2));
}

#[test]
fn converts_bro_void_values_to_none() {
    let cpt = parse_cpt(include_str!("fixtures/cpt-minimal.xml")).unwrap();
    assert!(cpt.measurements.iter().any(|point| point.pore_pressure_u2.is_none()));
    assert!(cpt.measurements.iter().flat_map(|p| [p.cone_resistance, p.sleeve_friction, p.friction_ratio, p.pore_pressure_u2]).flatten().all(|v| v > -100_000.0));
}
```

- [ ] **Step 2: Run CPT tests and confirm failure**

Run: `cargo test -p bro-xml --test cpt`

Expected: compilation fails because `parse_cpt` and CPT measurement fields are missing.

- [ ] **Step 3: Implement CPT types**

```rust
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CptDocument {
    pub common: CommonMetadata,
    pub final_depth: Option<f64>,
    pub cone_type: Option<String>,
    pub measurements: Vec<CptMeasurement>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_xml: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CptMeasurement {
    pub depth: f64,
    pub cone_resistance: Option<f64>,
    pub sleeve_friction: Option<f64>,
    pub friction_ratio: Option<f64>,
    pub pore_pressure_u2: Option<f64>,
    pub inclination: Option<f64>,
}

pub fn parse_cpt(xml: &str) -> Result<CptDocument, BroError> {
    parse_cpt_with_options(xml, ParseOptions::default())
}

pub fn parse_cpt_with_options(
    xml: &str,
    options: ParseOptions,
) -> Result<CptDocument, BroError> {
    crate::cpt::parse(xml, options)
}
```

- [ ] **Step 4: Implement streaming CPT parsing**

Use the existing 25-column order in `cpt-core/src/bro/columns.rs` as the repository-local behavioral reference, but implement the parser in `bro-xml` without depending on `cpt-core`. Treat `-999999`, empty cells, and non-finite numeric values as `None`. Require `broId` and a non-empty result data block. Sort measurements by `depth` using `f64::total_cmp`.

- [ ] **Step 5: Run CPT and full parser tests**

Run: `cargo test -p bro-xml --test cpt`

Expected: 2 tests pass.

Run: `cargo test -p bro-xml`

Expected: all current `bro-xml` tests pass.

- [ ] **Step 6: Commit Task 3**

```powershell
git add bro-xml/src/cpt.rs bro-xml/src/lib.rs bro-xml/tests/cpt.rs bro-xml/tests/fixtures/cpt-minimal.xml
git commit -m "feat(bro-xml): parse CPT documents"
```

---

### Task 4: Implement BHR-GT and BHR-G parsers

**Files:**
- Modify: `C:/Users/rickd/Documents/GitHub/crates-warehouse/bro-xml/src/bhr_gt.rs`
- Modify: `C:/Users/rickd/Documents/GitHub/crates-warehouse/bro-xml/src/bhr_g.rs`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/bro-xml/tests/boreholes.rs`
- Modify: `C:/Users/rickd/Documents/GitHub/crates-warehouse/bro-xml/tests/fixtures/bhr-gt-minimal.xml`
- Modify: `C:/Users/rickd/Documents/GitHub/crates-warehouse/bro-xml/tests/fixtures/bhr-g-minimal.xml`
- Modify: `C:/Users/rickd/Documents/GitHub/crates-warehouse/bro-xml/src/lib.rs`

**Interfaces:**
- Consumes: BHR-GT `dsbhr-gt/2.1` and BHR-G `dsbhrg/3.1` XML.
- Produces: default and `*_with_options` forms of `parse_bhr_gt` and `parse_bhr_g`, `BhrGtDocument`, `BhrGDocument`, typed intervals, and `SecondaryAttribute`.

- [ ] **Step 1: Write failing borehole tests**

```rust
use bro_xml::{parse_bhr_g, parse_bhr_gt};

#[test]
fn parses_geotechnical_intervals() {
    let bore = parse_bhr_gt(include_str!("fixtures/bhr-gt-minimal.xml")).unwrap();
    assert_eq!(bore.common.bro_id, "BHR000000000001");
    assert_eq!(bore.intervals.len(), 2);
    assert_eq!(bore.intervals[0].soil_name.as_deref(), Some("sterkSiltigeKlei"));
    assert!(bore.intervals[0].upper_boundary < bore.intervals[0].lower_boundary);
}

#[test]
fn parses_geological_intervals_without_wrapper_duplicates() {
    let bore = parse_bhr_g(include_str!("fixtures/bhr-g-minimal.xml")).unwrap();
    assert_eq!(bore.common.bro_id, "BHR000000000002");
    assert_eq!(bore.intervals.len(), 2);
    assert_eq!(bore.intervals[0].lithology.as_deref(), Some("zand"));
}
```

- [ ] **Step 2: Run the borehole tests and verify failure**

Run: `cargo test -p bro-xml --test boreholes`

Expected: compilation fails because borehole APIs are missing.

- [ ] **Step 3: Implement BHR-GT models and parser**

```rust
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct BhrGtDocument {
    pub common: CommonMetadata,
    pub final_depth: Option<f64>,
    pub boring_procedure: Option<String>,
    pub description_procedure: Option<String>,
    pub intervals: Vec<GeotechnicalInterval>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_xml: Option<String>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct GeotechnicalInterval {
    pub upper_boundary: f64,
    pub lower_boundary: f64,
    pub soil_name: Option<String>,
    pub colour: Option<String>,
    pub description: Option<String>,
    pub secondary: Vec<SecondaryAttribute>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SecondaryAttribute {
    pub code: String,
    pub value: String,
}

pub fn parse_bhr_gt(xml: &str) -> Result<BhrGtDocument, BroError> {
    parse_bhr_gt_with_options(xml, ParseOptions::default())
}

pub fn parse_bhr_gt_with_options(
    xml: &str,
    options: ParseOptions,
) -> Result<BhrGtDocument, BroError> {
    crate::bhr_gt::parse(xml, options)
}
```

Collect anomalous layers, chunks, peat fractions, pedological soil names, organic matter, carbonate, ripening, structure, and horizon values into `SecondaryAttribute { code: String, value: String }`. Reject intervals with non-finite boundaries or `lower_boundary <= upper_boundary`, and sort valid intervals by upper boundary.

- [ ] **Step 4: Implement BHR-G models and parser**

```rust
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct BhrGDocument {
    pub common: CommonMetadata,
    pub final_depth: Option<f64>,
    pub intervals: Vec<GeologicalInterval>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_xml: Option<String>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct GeologicalInterval {
    pub upper_boundary: f64,
    pub lower_boundary: f64,
    pub lithology: Option<String>,
    pub colour: Option<String>,
    pub description: Option<String>,
    pub extensions: std::collections::BTreeMap<String, String>,
}

pub fn parse_bhr_g(xml: &str) -> Result<BhrGDocument, BroError> {
    parse_bhr_g_with_options(xml, ParseOptions::default())
}

pub fn parse_bhr_g_with_options(
    xml: &str,
    options: ParseOptions,
) -> Result<BhrGDocument, BroError> {
    crate::bhr_g::parse(xml, options)
}
```

Deduplicate wrapper and inner `layer` elements by `(upper_boundary, lower_boundary, lithology)`. Sort by upper boundary and preserve primitive unmodeled interval fields in `extensions`.

- [ ] **Step 5: Run all parser tests and clippy**

Run: `cargo test -p bro-xml`

Expected: all detection, common, CPT, and borehole tests pass.

Run: `cargo clippy -p bro-xml --all-targets -- -D warnings`

Expected: exit code 0.

- [ ] **Step 6: Commit Task 4**

```powershell
git add bro-xml/src bro-xml/tests/boreholes.rs bro-xml/tests/fixtures/bhr-gt-minimal.xml bro-xml/tests/fixtures/bhr-g-minimal.xml
git commit -m "feat(bro-xml): parse geotechnical and geological boreholes"
```

---

### Task 5: Add reference codes, README attribution, and packaging checks

**Files:**
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/bro-xml/src/reference_codes.rs`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/bro-xml/README.md`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/bro-xml/tests/reference_codes.rs`
- Modify: `C:/Users/rickd/Documents/GitHub/crates-warehouse/bro-xml/src/lib.rs`
- Modify: `C:/Users/rickd/Documents/GitHub/crates-warehouse/Cargo.toml`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/tools/bro-reference-codegen/Cargo.toml`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/tools/bro-reference-codegen/src/main.rs`

**Interfaces:**
- Consumes: stored BRO code strings; code generator consumes the official reference-code endpoint only when run manually.
- Produces: `describe(ReferenceCodeSet, &str) -> Option<&'static str>` and reproducible checked-in lookup tables. Default workspace builds remain network-free.

- [ ] **Step 1: Write a failing lookup test**

```rust
use bro_xml::{describe_reference_code, ReferenceCodeSet};

#[test]
fn describes_known_soil_code_and_preserves_unknown_codes() {
    assert!(describe_reference_code(ReferenceCodeSet::GeotechnicalSoilName, "sterkSiltigeKlei").is_some());
    assert_eq!(describe_reference_code(ReferenceCodeSet::GeotechnicalSoilName, "futureCode"), None);
}
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `cargo test -p bro-xml --test reference_codes`

Expected: unresolved imports for the lookup API.

- [ ] **Step 3: Implement checked-in lookup tables**

Define `ReferenceCodeSet` for geotechnical soil name, lithology, colour, and quality regime. Use sorted static slices and binary search; always keep the original code in parsed documents. Include only codes used by committed fixtures plus the documented common codes in the initial table.

- [ ] **Step 4: Add isolated Rust code-generation tooling**

Create a standalone tool crate under `tools/bro-reference-codegen`, set `publish = false` in its `[package]` table, and add it to workspace `members`. Its output format must be deterministic: sort by code, escape Rust strings, and write the complete `reference_codes.rs` module to a caller-supplied path. The tool may use blocking `reqwest`; `bro-xml` itself must not depend on `reqwest`. Do not modify the workspace `exclude` list.

- [ ] **Step 5: Write the README with Bedrock attribution**

Include this exact attribution paragraph:

```markdown
## Inspiratie en referenties

De API-ergonomie en objectdekking zijn mede geïnspireerd door [Bedrock's TypeScript BRO-XML parser](https://github.com/bedrock-engineer/bro-xml-parser-ts), in het bijzonder automatische typedetectie, ondersteuning voor CPT/BHR-GT/BHR-G en referentiecode-lookups. `bro-xml` is een onafhankelijke Rust-implementatie; het is geen port, binding of officiële samenwerking.
```

Also document all five public parsing functions with compilable Rust examples. Add rustdoc to every public module, enum, struct, field whose unit or meaning is not self-evident, error variant, and function.

- [ ] **Step 6: Verify tests and package contents**

Run: `cargo test -p bro-xml`

Expected: all tests pass.

Run: `cargo test -p bro-xml --doc`

Expected: all public API examples compile and pass.

Run: `cargo package -p bro-xml --allow-dirty`

Expected: package verification succeeds; output contains the README, source, and test fixtures and contains no Node package or network runtime dependency.

- [ ] **Step 7: Commit Task 5**

```powershell
git add bro-xml tools/bro-reference-codegen Cargo.toml Cargo.lock
git commit -m "docs(bro-xml): add reference codes and attribution"
```

---

### Task 6: Create the kernel, project invariants, and CPT conversion

**Files:**
- Modify: `C:/Users/rickd/Documents/GitHub/crates-warehouse/Cargo.toml`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/open-geotechniek-kernel/Cargo.toml`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/open-geotechniek-kernel/README.md`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/open-geotechniek-kernel/src/lib.rs`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/open-geotechniek-kernel/src/error.rs`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/open-geotechniek-kernel/src/object.rs`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/open-geotechniek-kernel/src/project.rs`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/open-geotechniek-kernel/src/import.rs`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/open-geotechniek-kernel/src/cpt.rs`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/open-geotechniek-kernel/tests/project.rs`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/open-geotechniek-kernel/tests/import.rs`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/open-geotechniek-kernel/tests/fixtures/cpt-minimal.xml`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/open-geotechniek-kernel/tests/fixtures/bhr-gt-minimal.xml`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/open-geotechniek-kernel/tests/fixtures/bhr-g-minimal.xml`

**Interfaces:**
- Consumes: `bro_xml::BroDocument`, GEF/IfcGeo content accepted by `cpt-core`, and project metadata.
- Produces: `GeotechnicalProject`, `GeotechnicalObject`, `ObjectKind`, `KernelError`, `import_bro`, `import_cpt`, object CRUD, `cpts()`, and `detect_cpt_layers()`.

- [ ] **Step 1: Write failing project invariant tests**

```rust
use open_geotechniek_kernel::{GeotechnicalProject, KernelError, ProjectMetadata};

#[test]
fn rejects_duplicate_bro_ids() {
    let mut project = GeotechnicalProject::new(ProjectMetadata::default());
    let xml = include_str!("fixtures/bhr-gt-minimal.xml");
    project.import_bro(xml, "first.xml").unwrap();
    let error = project.import_bro(xml, "second.xml").unwrap_err();
    assert!(matches!(error, KernelError::DuplicateObject { ref id } if id == "BHR000000000001"));
}

#[test]
fn object_order_is_deterministic() {
    let mut project = GeotechnicalProject::new(ProjectMetadata::default());
    project.import_bro(include_str!("fixtures/bhr-g-minimal.xml"), "g.xml").unwrap();
    project.import_bro(include_str!("fixtures/bhr-gt-minimal.xml"), "gt.xml").unwrap();
    let ids: Vec<_> = project.objects().map(|object| object.id()).collect();
    assert_eq!(ids, vec!["BHR000000000001", "BHR000000000002"]);
}
```

- [ ] **Step 2: Run tests and verify missing-package failure**

Run: `cargo test -p open-geotechniek-kernel --test project`

Expected: package does not exist.

- [ ] **Step 3: Add manifest and stable error/object types**

Add `"open-geotechniek-kernel"` to workspace members. Manifest dependencies:

```toml
[dependencies]
bro-xml = { version = "0.1.1", path = "../bro-xml" }
cpt-core = { version = "0.1.1", path = "../cpt-core" }
serde = { workspace = true }
serde_json = { workspace = true }
thiserror = { workspace = true }
chrono = { version = "0.4", features = ["serde"] }
```

Define:

```rust
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ProjectMetadata {
    pub title: String,
    pub client: String,
    pub location: String,
    pub project_number: String,
    pub author: String,
    pub date: Option<chrono::NaiveDate>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum GeotechnicalObject {
    Cpt(cpt_core::Cpt),
    BhrGt(bro_xml::BhrGtDocument),
    BhrG(bro_xml::BhrGDocument),
}
```

`GeotechnicalObject::id()` returns the CPT ID or common BRO ID. Store objects in `BTreeMap<String, GeotechnicalObject>`.

Use an explicit merge policy so normal imports reject duplicates while opening an existing project preserves current replacement behavior:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DuplicatePolicy { Reject, Replace }
```

Define the complete kernel error boundary:

```rust
#[derive(Debug, thiserror::Error)]
pub enum KernelError {
    #[error(transparent)]
    Bro(#[from] bro_xml::BroError),
    #[error(transparent)]
    Cpt(#[from] cpt_core::CptError),
    #[error("duplicate geotechnical object {id}")]
    DuplicateObject { id: String },
    #[error("geotechnical object not found: {id}")]
    ObjectNotFound { id: String },
    #[error("invalid project: {message}")]
    InvalidProject { message: String },
    #[error("conversion failed: {message}")]
    Conversion { message: String },
    #[error("export failed: {message}")]
    Export { message: String },
}
```

- [ ] **Step 4: Write failing CPT conversion/import tests**

```rust
use open_geotechniek_kernel::{GeotechnicalObject, GeotechnicalProject, ProjectMetadata};

#[test]
fn imports_bro_cpt_into_existing_cpt_domain() {
    let mut project = GeotechnicalProject::new(ProjectMetadata::default());
    let object = project.import_bro(include_str!("fixtures/cpt-minimal.xml"), "cpt.xml").unwrap();
    let GeotechnicalObject::Cpt(cpt) = object else { panic!("expected CPT") };
    assert_eq!(cpt.id, "CPT000000000001");
    assert_eq!(cpt.metadata.source_file, "cpt.xml");
    assert_eq!(cpt.points.len(), 2);
    assert_eq!(cpt.points[0].qc, Some(13.3));
}
```

- [ ] **Step 5: Implement loss-aware CPT conversion and imports**

Map `cone_resistance -> qc`, `sleeve_friction -> fs`, `friction_ratio -> rf`, `pore_pressure_u2 -> u2`, and vertical inclination directly. Calculate `depth_nap` only when a vertical offset exists. Copy unmodeled common values into `cpt_core::Metadata.extra`. Implement:

```rust
pub fn import_bro(&mut self, xml: &str, source_file: &str) -> Result<GeotechnicalObject, KernelError>;
pub fn import_cpt(&mut self, content: &str, source_file: &str) -> Result<cpt_core::Cpt, KernelError>;
pub fn remove(&mut self, id: &str) -> Result<GeotechnicalObject, KernelError>;
pub fn get(&self, id: &str) -> Result<&GeotechnicalObject, KernelError>;
pub fn objects(&self) -> impl Iterator<Item = &GeotechnicalObject>;
pub fn cpts(&self) -> impl Iterator<Item = &cpt_core::Cpt>;
pub fn metadata(&self) -> &ProjectMetadata;
pub fn set_metadata(&mut self, metadata: ProjectMetadata);
pub fn merge_from(&mut self, other: GeotechnicalProject, policy: DuplicatePolicy) -> Result<(), KernelError>;
pub fn detect_cpt_layers(&self, id: &str) -> Result<Vec<cpt_core::Layer>, KernelError>;
```

`import_cpt` uses `cpt_core::write::read_ifcgeo` for `.ifcgeo` source names and `cpt_core::parse_auto` otherwise.

Copy the three synthetic fixtures from `bro-xml/tests/fixtures` into the kernel crate's own `tests/fixtures` directory so packaged tests never reference files outside the crate.

- [ ] **Step 6: Run kernel tests and clippy**

Run: `cargo test -p open-geotechniek-kernel`

Expected: project and import tests pass.

Run: `cargo clippy -p open-geotechniek-kernel --all-targets -- -D warnings`

Expected: exit code 0.

- [ ] **Step 7: Write the kernel README and verify rustdoc**

Document the dependency boundary, `GeotechnicalProject` CRUD, BRO import, CPT layer detection, and the guarantee that callers provide/receive content rather than filesystem paths. Every public enum, struct, variant with non-obvious semantics, and method must have rustdoc.

Run: `cargo test -p open-geotechniek-kernel --doc`

Expected: all README-equivalent rustdoc examples compile and pass.

- [ ] **Step 8: Commit Task 6**

```powershell
git add open-geotechniek-kernel Cargo.toml Cargo.lock
git commit -m "feat(kernel): add geotechnical project facade"
```

---

### Task 7: Add project-file compatibility and package verification

**Files:**
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/open-geotechniek-kernel/src/project_file.rs`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/open-geotechniek-kernel/tests/project_file.rs`
- Create: `C:/Users/rickd/Documents/GitHub/crates-warehouse/open-geotechniek-kernel/tests/fixtures/legacy-project.ifcgis`
- Modify: `C:/Users/rickd/Documents/GitHub/crates-warehouse/open-geotechniek-kernel/src/lib.rs`
- Modify: `C:/Users/rickd/Documents/GitHub/crates-warehouse/open-geotechniek-kernel/README.md`

**Interfaces:**
- Consumes: existing `.ifcgis`/IFCX JSON text and `cpt_core::ifcgis::ProjectFile`.
- Produces: `load_project_text`, `load_project_file`, `to_project_file`, and `to_project_text`; performs no filesystem I/O.

- [ ] **Step 1: Add a failing legacy round-trip test**

```rust
use open_geotechniek_kernel::GeotechnicalProject;

#[test]
fn loads_and_round_trips_existing_project_shape() {
    let source = include_str!("fixtures/legacy-project.ifcgis");
    let project = GeotechnicalProject::load_project_text(source).unwrap();
    assert_eq!(project.cpts().count(), 1);
    let serialized = project.to_project_text().unwrap();
    let reopened = GeotechnicalProject::load_project_text(&serialized).unwrap();
    assert_eq!(reopened.cpts().count(), 1);
    assert_eq!(reopened.metadata().title, project.metadata().title);
}
```

- [ ] **Step 2: Run the test and verify missing-method failure**

Run: `cargo test -p open-geotechniek-kernel --test project_file`

Expected: compilation fails because project-file methods are missing.

- [ ] **Step 3: Implement in-memory compatibility**

Use `cpt_core::ifcgis::load` and `to_ifcx_json`. Map CPT entries into `GeotechnicalObject::Cpt`. Convert legacy `bores: Vec<serde_json::Value>` entries into typed BHR objects when they contain retained source XML; preserve unconvertible legacy bore JSON unchanged in a private compatibility collection. When serializing typed BHR objects, emit the existing bore shape (`id`, `position`, `final_depth`, `layers`, `metadata`) so current project consumers remain compatible. Preserve all other full-fidelity sections by retaining the loaded `ProjectFile` as a private project template and replacing only project metadata/CPT/object sections on serialization. Do not read paths or call `std::fs` in this crate.

Expose:

```rust
pub fn load_project_text(text: &str) -> Result<Self, KernelError>;
pub fn load_project_file(file: cpt_core::ifcgis::ProjectFile) -> Result<Self, KernelError>;
pub fn to_project_file(&self) -> Result<cpt_core::ifcgis::ProjectFile, KernelError>;
pub fn to_project_text(&self) -> Result<String, KernelError>;
```

- [ ] **Step 4: Run kernel and workspace tests**

Run: `cargo test -p open-geotechniek-kernel`

Expected: all kernel tests pass.

Run: `cargo test --workspace`

Expected: all workspace tests pass. If existing absolute-path `cpt-core` fixtures are unavailable, record that pre-existing failure separately and still require both new crate suites to pass.

- [ ] **Step 5: Verify package metadata**

Run: `cargo package -p open-geotechniek-kernel --allow-dirty`

Expected: package verification succeeds and includes README and tests.

- [ ] **Step 6: Commit Task 7**

```powershell
git add open-geotechniek-kernel
git commit -m "feat(kernel): preserve project file compatibility"
```

---

### Task 8: Migrate desktop state and existing CPT/project commands

**Files:**
- Modify: `C:/Users/rickd/Documents/GitHub/cpt-viewer/apps/desktop/src-tauri/Cargo.toml`
- Modify: `C:/Users/rickd/Documents/GitHub/cpt-viewer/apps/desktop/src-tauri/src/state.rs`
- Modify: `C:/Users/rickd/Documents/GitHub/cpt-viewer/apps/desktop/src-tauri/src/commands/cpt.rs`
- Modify: `C:/Users/rickd/Documents/GitHub/cpt-viewer/apps/desktop/src-tauri/src/commands/project.rs`
- Modify: `C:/Users/rickd/Documents/GitHub/cpt-viewer/apps/desktop/src-tauri/src/commands/export.rs`
- Modify: `C:/Users/rickd/Documents/GitHub/cpt-viewer/apps/desktop/src-tauri/src/commands/report.rs`
- Modify: `C:/Users/rickd/Documents/GitHub/cpt-viewer/apps/desktop/src-tauri/src/commands/ifc.rs`
- Create: `C:/Users/rickd/Documents/GitHub/cpt-viewer/apps/desktop/src-tauri/tests/kernel_adapters.rs`

**Interfaces:**
- Consumes: `open_geotechniek_kernel::GeotechnicalProject` behind `Mutex`.
- Produces: unchanged Tauri-facing CPT and project command signatures; export/report/IFC readers use `AppState::with_project` instead of public maps.

- [ ] **Step 1: Add failing adapter contract tests**

```rust
use open_geo_studio_lib::commands::cpt::{close_cpt_core, list_cpts_core, open_cpt_core};
use open_geo_studio_lib::state::AppState;

#[test]
fn legacy_cpt_commands_share_kernel_state() {
    let state = AppState::default();
    let gef = include_str!("../../public/example.gef");
    let opened = open_cpt_core(gef, "example.gef", &state).unwrap();
    assert_eq!(list_cpts_core(&state).len(), 1);
    close_cpt_core(&opened.id, &state).unwrap();
    assert!(list_cpts_core(&state).is_empty());
}
```

Make `commands` and `state` public to integration tests only through normal public modules; do not duplicate command logic in tests.

- [ ] **Step 2: Run the adapter test and verify failure**

Run from `apps/desktop/src-tauri`: `cargo test --test kernel_adapters`

Expected: compilation fails because state still exposes the CPT map or modules are private.

- [ ] **Step 3: Add the path dependency and kernel state wrapper**

```toml
open-geotechniek-kernel = { path = "../../../../crates-warehouse/open-geotechniek-kernel" }
```

Use:

```rust
pub struct AppState {
    project: std::sync::Mutex<open_geotechniek_kernel::GeotechnicalProject>,
    pub extensions: std::sync::Mutex<std::collections::HashMap<String, bool>>,
}

impl AppState {
    pub fn with_project<T>(&self, f: impl FnOnce(&open_geotechniek_kernel::GeotechnicalProject) -> T) -> Result<T, String>;
    pub fn with_project_mut<T>(&self, f: impl FnOnce(&mut open_geotechniek_kernel::GeotechnicalProject) -> Result<T, open_geotechniek_kernel::KernelError>) -> Result<T, String>;
}
```

Map poisoned locks to stable error strings. `Default` creates an empty project.

- [ ] **Step 4: Delegate legacy CPT commands**

Keep every existing function signature in `commands/cpt.rs`. `open_cpt_core`, `close_cpt_core`, `list_cpts_core`, and `detect_layers_core` call kernel methods. `save_cpt_as_core` obtains a cloned CPT from the kernel, drops the lock, serializes, and performs filesystem I/O in the command adapter.

- [ ] **Step 5: Delegate project commands and state readers**

`open_project_ifcgis_core` and `open_project_ifcgis_full_core` read text in the adapter, load a separate kernel project, then merge it into application state with `DuplicatePolicy::Replace`; this preserves the current additive behavior while replacing same-ID entries. Save/preview functions obtain a kernel-generated in-memory string before writing. Replace direct `.cpts.lock()` access in export, report, and IFC commands with `with_project` and cloned CPT vectors.

- [ ] **Step 6: Run Rust adapter and compile checks**

Run from `apps/desktop/src-tauri`: `cargo test --test kernel_adapters`

Expected: adapter contract passes.

Run: `cargo check`

Expected: desktop Rust backend compiles with no direct access to `AppState.cpts`.

- [ ] **Step 7: Commit Task 8 in `cpt-viewer`**

```powershell
git add apps/desktop/src-tauri
git commit -m "refactor(kernel): route desktop state through shared project"
```

---

### Task 9: Add generic Rust document import and migrate frontend boring flows

**Files:**
- Create: `C:/Users/rickd/Documents/GitHub/cpt-viewer/apps/desktop/src-tauri/src/commands/document.rs`
- Modify: `C:/Users/rickd/Documents/GitHub/cpt-viewer/apps/desktop/src-tauri/src/commands/mod.rs`
- Modify: `C:/Users/rickd/Documents/GitHub/cpt-viewer/apps/desktop/src-tauri/src/lib.rs`
- Modify: `C:/Users/rickd/Documents/GitHub/cpt-viewer/apps/desktop/src/types/bore.ts`
- Modify: `C:/Users/rickd/Documents/GitHub/cpt-viewer/apps/desktop/src/utils/platform.ts`
- Modify: `C:/Users/rickd/Documents/GitHub/cpt-viewer/apps/desktop/src/store/useCptStore.ts`
- Create: `C:/Users/rickd/Documents/GitHub/cpt-viewer/apps/desktop/src/store/useCptStore.test.ts`
- Delete: `C:/Users/rickd/Documents/GitHub/cpt-viewer/apps/desktop/src/types/broCptParser.ts`

**Interfaces:**
- Consumes: XML string and source filename.
- Produces: Tauri command `open_geotechnical_document` returning `{ kind: "cpt", data: Cpt }` or `{ kind: "bore", data: Bore }`; TypeScript store shapes remain unchanged.

- [ ] **Step 1: Add failing TypeScript store routing tests**

Mock `@tauri-apps/api/core.invoke` and assert:

```ts
it("opens a native BHR-GT result as an unchanged Bore document", async () => {
  invokeMock.mockResolvedValue({
    kind: "bore",
    data: {
      id: "BHR000000000001",
      position: { x_rd: 155000, y_rd: 463000, z_nap: 1.2 },
      final_depth: 4,
      layers: [{ top_depth: 0, base_depth: 2, soil_name: "sterkSiltigeKlei" }],
      metadata: { source_file: "bore.xml" },
    },
  });
  await loadBoreFromContent("<xml />", "bore.xml");
  expect(invokeMock).toHaveBeenCalledWith("open_geotechnical_document", { content: "<xml />", filename: "bore.xml" });
  expect(useCptStore.getState().documents.at(-1)?.kind).toBe("bore");
});
```

Add equivalent tests for BHR-G returning the same `Bore` presentation shape and CPT returning the current `Cpt` shape.

- [ ] **Step 2: Run the frontend test and verify failure**

Run from `apps/desktop`: `npm test -- --run src/store/useCptStore.test.ts`

Expected: failure because the generic command is not called.

- [ ] **Step 3: Implement adapter DTOs without leaking UI shapes into the kernel**

Define in `commands/document.rs`:

```rust
#[derive(serde::Serialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum ImportedDocumentDto {
    Cpt(cpt_core::Cpt),
    Bore(BoreDto),
}
```

`BoreDto` must serialize exactly the current `Bore` interface fields: `id`, optional `position { x_rd, y_rd, z_nap }`, `final_depth`, `layers { top_depth, base_depth, soil_name, colour, description, secondary[] }`, and `metadata` including `source_file` and `extra`. Map both kernel BHR variants to `BoreDto`; use lithology as `soil_name` for BHR-G.

- [ ] **Step 4: Register the command and implement platform routing**

Add:

```rust
#[tauri::command]
pub fn open_geotechnical_document(
    content: String,
    filename: String,
    state: tauri::State<'_, AppState>,
) -> Result<ImportedDocumentDto, String>;
```

In TypeScript add:

```ts
export type ImportedGeotechnicalDocument =
  | { kind: "cpt"; data: Cpt }
  | { kind: "bore"; data: Bore };
```

Desktop uses the Tauri command. The browser build retains the existing GEF fallback only. BRO XML in a browser-only session returns a clear error stating that native parsing requires the desktop app; it must not dynamically load a TypeScript BRO parser.

- [ ] **Step 5: Remove client-side boring parsing from desktop store flows**

Change `loadBoreFromContent` and `addBoreToActiveProject` to call the platform generic parser and require `kind === "bore"`. Route file-open sniffing through the generic native parser rather than `looksLikeBoringXml`. Keep soil colour, mixture, pattern, and presentation helpers in `bore.ts`.

Delete `broCptParser.ts` and remove `parseBhrgtXml` plus `looksLikeBoringXml` from `bore.ts` after all callers use the native command.

- [ ] **Step 6: Run frontend and Rust tests**

Run from `apps/desktop`: `npm test -- --run src/store/useCptStore.test.ts`

Expected: CPT, BHR-GT, and BHR-G routing tests pass.

Run: `npm run build`

Expected: TypeScript and Vite build succeeds with no TypeScript BRO XML parser in the production source tree.

Run from `src-tauri`: `cargo test`

Expected: all Rust backend tests pass.

- [ ] **Step 7: Commit Task 9**

```powershell
git add apps/desktop/src apps/desktop/src-tauri
git commit -m "feat(kernel): import BRO documents natively"
```

---

### Task 10: Route REST and MCP through the kernel and verify the release boundary

**Files:**
- Modify: `C:/Users/rickd/Documents/GitHub/cpt-viewer/apps/desktop/src-tauri/src/rest.rs`
- Modify: `C:/Users/rickd/Documents/GitHub/cpt-viewer/apps/desktop/src-tauri/src/mcp/server.rs`
- Modify: `C:/Users/rickd/Documents/GitHub/cpt-viewer/apps/desktop/src-tauri/src/mcp/tools.rs`
- Modify: `C:/Users/rickd/Documents/GitHub/cpt-viewer/apps/desktop/src-tauri/Cargo.toml`
- Modify: `C:/Users/rickd/Documents/GitHub/cpt-viewer/docs/API.md`
- Modify: `C:/Users/rickd/Documents/GitHub/cpt-viewer/apps/desktop/src/types/bore.ts`
- Create: `C:/Users/rickd/Documents/GitHub/cpt-viewer/apps/desktop/src-tauri/tests/fixtures/bhr-gt-minimal.xml`

**Interfaces:**
- Consumes: the generic adapter function from Task 9 and kernel-backed state from Task 8.
- Produces: `POST /api/objects`, `GET /api/objects`, MCP `open_geotechnical_document`, kernel-backed health counts, and no adapter access to internal maps.

- [ ] **Step 1: Add failing REST handler tests**

Add a test-only router constructor and use `tower::ServiceExt` to post the BHR-GT fixture:

```rust
#[tokio::test]
async fn generic_object_route_imports_borehole() {
    let app = test_router();
    let response = app.oneshot(json_request(
        "/api/objects",
        serde_json::json!({ "content": include_str!("../tests/fixtures/bhr-gt-minimal.xml"), "filename": "bore.xml" }),
    )).await.unwrap();
    assert_eq!(response.status(), axum::http::StatusCode::OK);
    let body = response_json(response).await;
    assert_eq!(body["kind"], "bore");
    assert_eq!(body["data"]["id"], "BHR000000000001");
}
```

- [ ] **Step 2: Run the REST test and verify route failure**

Run from `apps/desktop/src-tauri`: `cargo test generic_object_route_imports_borehole`

Expected: test fails with 404 or missing test router helpers.

- [ ] **Step 3: Add generic REST routes using the shared adapter**

Copy the synthetic BHR-GT fixture into `src-tauri/tests/fixtures`. Add `tower = { version = "0.5", features = ["util"] }` and `http-body-util = "0.1"` under `[dev-dependencies]` for router testing. Add `POST /api/objects` and `GET /api/objects`. POST calls the same `open_geotechnical_document_core` used by Tauri. GET serializes kernel objects via adapter DTOs. Keep `/api/cpts` behavior and response unchanged. Health reports `objects_loaded` plus the existing `cpts_loaded` field.

- [ ] **Step 4: Add the MCP tool using the shared adapter**

Register `open_geotechnical_document` with required string arguments `content` and `filename`. Its handler calls `open_geotechnical_document_core`, serializes the same DTO as Tauri/REST, and does not parse XML itself. Update `get_app_state` to count objects through kernel accessors.

- [ ] **Step 5: Remove the obsolete TypeScript XML parser exports**

Run:

```powershell
rg -n "parseBhrgtXml|looksLikeBoringXml|parseBroCptXml|looksLikeBroCptXml" apps/desktop/src
```

Expected: no matches. The parser-only functions in `bore.ts` and the complete `broCptParser.ts` file were removed in Task 9.

- [ ] **Step 6: Update API documentation**

Document request/response examples for generic CPT, BHR-GT, and BHR-G import; state that `/api/cpts` remains compatible. Document the MCP tool with the same JSON result union. Do not describe implementation history.

- [ ] **Step 7: Run complete verification in both repositories**

From `crates-warehouse`:

```powershell
cargo fmt --all -- --check
cargo clippy -p bro-xml -p open-geotechniek-kernel --all-targets -- -D warnings
cargo test -p bro-xml
cargo test -p open-geotechniek-kernel
cargo package -p bro-xml --allow-dirty
cargo package -p open-geotechniek-kernel --allow-dirty
cargo test -p bro-xml --doc
cargo test -p open-geotechniek-kernel --doc
```

Expected: every command exits 0.

From `cpt-viewer/apps/desktop`:

```powershell
npm test
npm run build
```

From `cpt-viewer/apps/desktop/src-tauri`:

```powershell
cargo fmt -- --check
cargo test
cargo check
```

Expected: every command exits 0. This work does not create a release installer, so the Windows bundling directive is not triggered by this plan.

- [ ] **Step 8: Verify repository-content constraints**

Review every staged path and commit message against the repository-level `AGENTS.md` prohibited-content policy. Use `git diff --cached --name-only` followed by `git diff --cached` in each repository.

Expected: no external calculation-product names, assistant-conversation records, or unrelated user changes are staged.

- [ ] **Step 9: Commit final adapter and documentation changes**

```powershell
git add apps/desktop/src-tauri/src/rest.rs apps/desktop/src-tauri/src/mcp apps/desktop/src/types/bore.ts docs/API.md
git commit -m "refactor(api): share kernel across transport adapters"
```

---

## Final Review Checklist

- `bro-xml` owns all native parsing for CPT, BHR-GT, and BHR-G.
- `open-geotechniek-kernel` owns object state and project invariants.
- No new crate performs filesystem I/O or default-build network I/O.
- Existing CPT Tauri and REST payloads remain unchanged.
- BHR-GT and BHR-G reach the existing `Bore` UI shape through adapter DTOs.
- Tauri, REST, and MCP invoke shared kernel-backed functions.
- Existing project files load and round-trip.
- Bedrock attribution is present exactly once in the `bro-xml` README.
- Both crates pass tests, clippy, rustdoc examples, and `cargo package` verification.
- No actual crate publication or release installer build occurs.
