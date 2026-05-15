# Open GEO Studio — Design Specification

> Renaming and rebuilding the existing `cpt-viewer` (vanilla JS web app) as **Open GEO Studio**: a Tauri+React desktop application built on the OpenAEC Foundation visual identity, backed by a reusable Rust crate `cpt-core` for CPT domain logic and PDF report generation.

**Date:** 2026-05-15
**Status:** Approved (sections 1–3 by user, sections 4–6 written under "doorwerken" instruction)
**Repos affected:**
- `cpt-viewer` → renamed to `open-geo-studio` (this repo)
- `crates-warehouse` (new crate `cpt-core` added)
- `OpenAEC-style-book` (consumed as reference + tokens package)
- `openaec-reports` (consumed as `openaec-core`/`-engine` Rust dependency, already vendored in `crates-warehouse`)

---

## 1. Goals & Non-Goals

### Goals
- Replace the current vanilla-JS dark-themed CPT viewer with an OpenAEC-branded Tauri desktop app named **Open GEO Studio**.
- Support light theme (default) and dark theme (option), persisted via Tauri settings.
- Keep all existing functionality: open GEF and BRO-XML files, multiple CPTs side-by-side, Robertson SBT classification, PDOK BRO map area loading, CSV/GeoJSON export.
- Add **PDF report generation** in OpenAEC house style: cover page, coordinate table, one standardized CPT plot per page (NEN-EN-ISO 22476-1 layout).
- Extract all CPT domain logic into a reusable Rust crate `cpt-core` published in the existing `crates-warehouse` monorepo.

### Non-Goals
- No advisory-report editor (free-form text sections — out of scope for v1).
- No bearing-capacity calculations, no pile-design output (those would be separate crates following the `nta8800-*` pattern).
- No Python anywhere in the runtime stack.
- No multi-user/multi-tenant — single OpenAEC tenant for v1; tenant configurability deferred.
- No web deployment of the new app — desktop-only via Tauri.

---

## 2. System Architecture

### 2.1 Repos

```
crates-warehouse/                         (existing, OpenAEC org)
  openaec-{core,engine,layout,...}        existing — PDF generation
  cpt-core/                               NEW — CPT domain crate

OpenAEC-style-book/                       (existing — reference only)
  brandbook/DESIGN-SYSTEM.md              tokens, components, layout specs
  brandbook/LAYOUTS.md                    desktop tool layouts
  packages/tokens/                        consumed as @openaec/tokens npm package
  project-templates/Tauri+React/          starting point for the app shell

open-geo-studio/                          NEW — renamed from cpt-viewer
  _archive/vanilla-js/                    old web app, kept for reference porting
  apps/desktop/                           Tauri+React app
    src/                                  React frontend (TypeScript)
    src-tauri/                            Rust backend
```

### 2.2 Responsibility split

| Component | Responsibility | Out of scope |
|---|---|---|
| `cpt-core` (Rust) | GEF/BRO-XML parsing, Robertson classification, layer detection, RD↔WGS84 coords, build `ReportData` for a project | UI, map tiles, file dialogs, network |
| `openaec-engine` (Rust) | Render `ReportData` → PDF bytes (printpdf + resvg under the hood) | CPT-specific logic |
| `src-tauri` (Rust) | Tauri commands wrapping cpt-core + openaec-engine, OS file dialogs, PDOK BRO HTTP client, CSV/GeoJSON export | Domain calculations |
| React frontend (TS) | Ribbon UI, panels, chart canvas, Leaflet map, Zustand state | Parsing, classification, PDF |

### 2.3 Communication

React ↔ Rust via Tauri commands. All domain types in `cpt-core` derive `Serialize + Deserialize` for direct JSON over IPC. A `Cpt` with 5000 measurement points is ~200 KB JSON — well within Tauri IPC limits.

---

## 3. The `cpt-core` Crate

**Location:** `crates-warehouse/cpt-core/` — added as a member of the existing Cargo workspace.

### 3.1 Module structure

```
cpt-core/
  Cargo.toml                    edition 2021, workspace deps
  README.md
  src/
    lib.rs                      public re-exports
    domain.rs                   Cpt, MeasurementPoint, Metadata, Position, Quantity
    error.rs                    CptError (thiserror)
    gef/
      mod.rs                    pub fn parse(text: &str) -> Result<Cpt>
      header.rs                 #ZID, #COMPANYID, #COLUMNINFO, #COLUMNVOID, #XYID, #ZID, ...
      columns.rs                GEF column type table (mirrors GEF_COLUMN_TYPES from JS)
      data.rs                   numeric data rows, void-value detection
    bro/
      mod.rs                    pub fn parse(xml: &str) -> Result<Cpt>
      schema.rs                 BRO IMBRO/A element matchers
    robertson.rs                Zone enum + classify(qc, rf) + zones() lookup
    layers.rs                   detect_layers(&Cpt) -> Vec<Layer> (groups consecutive same-zone points, min 10cm)
    coords.rs                   rd_to_wgs84 / wgs84_to_rd (Bessel 1841 + 7-param Helmert, no HTTP)
    report.rs                   build(cpts, project) -> openaec_core::ReportData
    plot/
      mod.rs                    pub fn render_cpt_svg(cpt: &Cpt) -> String
      axes.rs                   depth axis, qc axis, friction axis scaling
      curves.rs                 path generation for qc/fs/Rf/u2/inclination
      sbt_strip.rs              vertical Robertson colour strip
  tests/
    fixtures/                   symlinks to verification-files/GEF-BRO-XML/
    test_gef.rs                 parse all .GEF samples, assert metadata + point counts
    test_bro.rs                 parse cpt_bro.xml, assert structure
    test_robertson.rs           classify on known qc/Rf values
    test_layers.rs              layer grouping
    test_coords.rs              RD↔WGS84 round-trip
    test_report.rs              build report, validate against openaec schema
    test_plot.rs                render SVG, assert basic structure
```

### 3.2 Public API

```rust
// lib.rs
pub use domain::{Cpt, MeasurementPoint, Metadata, Quantity, Position};
pub use error::CptError;
pub use robertson::{Zone, classify, zones};
pub use layers::{Layer, detect_layers};
pub use coords::{rd_to_wgs84, wgs84_to_rd};
pub use gef::parse as parse_gef;
pub use bro::parse as parse_bro;
pub use report::{build as build_report, ProjectMeta};
pub use plot::render_cpt_svg;

/// Detect format from content prefix and dispatch.
pub fn parse_auto(content: &str) -> Result<Cpt, CptError>;
```

### 3.3 Core types

```rust
pub struct Cpt {
    pub id: String,                   // BRO id, GEF #TESTID, or filename fallback
    pub metadata: Metadata,
    pub position: Option<Position>,
    pub points: Vec<MeasurementPoint>,
}

pub struct Metadata {
    pub project_name: Option<String>,
    pub project_number: Option<String>,
    pub date: Option<chrono::NaiveDate>,
    pub equipment: Option<String>,
    pub ground_level_nap: Option<f64>,    // m NAP
    pub source_file: String,              // filename
}

pub struct Position {
    pub x_rd: f64,                        // Rijksdriehoek X (m)
    pub y_rd: f64,                        // Rijksdriehoek Y (m)
    pub z_nap: Option<f64>,               // m NAP
}

pub struct MeasurementPoint {
    pub depth: f64,                       // m below ground level
    pub depth_nap: Option<f64>,           // m NAP if ground_level_nap known
    pub qc: Option<f64>,                  // MPa
    pub fs: Option<f64>,                  // MPa
    pub rf: Option<f64>,                  // % (computed = 100*fs/qc if missing)
    pub u2: Option<f64>,                  // MPa (CPTu only)
    pub inclination: Option<f64>,         // degrees from vertical
}
```

### 3.4 Design choices

- `f64` for all measurements (no precision loss vs JS Number).
- `Option<f64>` for fields that may be sparse in source data.
- All public types derive `serde::{Serialize, Deserialize}` for direct Tauri IPC use.
- Sync only — pure CPU work, no async needed in the crate itself.
- RD↔WGS84 inline implementation (no HTTP, no external dependency).
- HTTP/PDOK BRO area loader is **not** in the crate — that's app-specific and lives in `src-tauri/src/bro_api.rs`.

### 3.5 Tests

Integration tests use the fixtures at `C:/Users/rickd/Documents/GitHub/verification-files/GEF-BRO-XML/`:
- `cpt_pygef.gef`, `cpt_bro.xml`, `voorbeeld.gef`
- `2600356_01.GEF` through `2600356_06.GEF` (multi-CPT project series)

---

## 4. The Open GEO Studio App

**Base:** `OpenAEC-style-book/project-templates/Tauri+React/` — copied to `open-geo-studio/apps/desktop/`, then customized.

### 4.1 Template-component mapping

| Template component | What it becomes |
|---|---|
| `TitleBar` | OpenAEC logo + "Open GEO Studio" + project name + window controls (unchanged code) |
| `Ribbon` tabs | **Start** \| **Kaart** \| **Rapport** |
| `Backstage` | New project, Open GEF/BRO-XML, Recent files, Export CSV, Export GeoJSON, Generate report → PDF, Settings, Exit |
| `DocumentBar` | Tab per opened CPT — click to make active |
| `StatusBar` | qc/fs/Rf/depth/grondsoort under cursor (port from existing app.js status bar) |
| `SettingsDialog` | General (lang NL/EN), Appearance (theme: light/dark/system), About |
| `IfcViewerPanel`, `ThreeViewer` | Removed — not relevant for Open GEO Studio |

### 4.2 Ribbon content

```
START tab:
  Bestand          Voorbeelden       Weergave         Bewerken
  ┌────────┐       ┌────────────┐    ┌──────────┐     ┌──────────────┐
  │ Open   │       │ GEF Pygef  │    │ Zoom +   │     │ Sluit alle   │
  │        │       │ BRO XML    │    │ Zoom -   │     │              │
  │        │       │ Voorbeeld  │    │ Passend  │     │              │
  └────────┘       └────────────┘    └──────────┘     └──────────────┘

KAART tab:
  BRO Data         Markers           Status
  ┌────────────┐   ┌────────────┐    ┌──────────────────────┐
  │ Laad       │   │ Wis        │    │ <map status text>    │
  │ gebied     │   │ markers    │    │                      │
  └────────────┘   └────────────┘    └──────────────────────┘

RAPPORT tab:                                                    NEW
  Project          Selectie          Output
  ┌──────────────┐ ┌────────────┐    ┌──────────────────┐
  │ Project info │ │ Alle CPTs  │    │ PDF preview      │
  │              │ │ Selecteer  │    │ Genereer PDF     │
  └──────────────┘ └────────────┘    └──────────────────┘
```

### 4.3 Main view layout

| Active view | Left panel (240 px, resizable) | Center | Right panel (240 px, resizable) |
|---|---|---|---|
| `chart` (default) | Sonderingen list, Sonderingsgegevens, Locatie mini-map, Grondopbouw, Meetdata | CPT chart canvas (port of `cpt-chart.js`) | Robertson SBT legend + distribution bar |
| `map` | Sonderingen list | Leaflet map with BRO markers | hidden (full-width) |
| `report` | Project info form | PDF preview iframe | hidden (full-width) |

### 4.4 State management

Single Zustand store `useCptStore`:

```ts
interface CptStore {
  cpts: Map<string, Cpt>;
  activeCptId: string | null;
  hoveredPoint: { depth: number; qc?: number; fs?: number; rf?: number; u2?: number; soil?: string } | null;
  projectMeta: ProjectMeta;

  openCpt: (path: string) => Promise<void>;
  openCpts: (paths: string[]) => Promise<void>;
  closeCpt: (id: string) => void;
  closeAll: () => void;
  setActive: (id: string) => void;
  setHover: (p: HoveredPoint | null) => void;
  setProjectMeta: (m: Partial<ProjectMeta>) => void;
}
```

### 4.5 Tauri command surface

```rust
// src-tauri/src/commands.rs

#[tauri::command] async fn open_cpt(path: String) -> Result<Cpt, String>;
#[tauri::command] async fn open_cpts(paths: Vec<String>) -> Result<Vec<Cpt>, String>;
#[tauri::command] fn classify_robertson(qc: f64, rf: f64) -> Option<Zone>;
#[tauri::command] fn detect_layers(cpt_id: String, state: State<AppState>) -> Result<Vec<Layer>, String>;
#[tauri::command] async fn fetch_bro_area(bbox: BBox) -> Result<Vec<BroFeature>, String>;
#[tauri::command] async fn export_csv(cpt_id: String, path: String) -> Result<(), String>;
#[tauri::command] async fn export_geojson(cpt_ids: Vec<String>, path: String) -> Result<(), String>;
#[tauri::command] async fn generate_report(opts: ReportOpts, path: String) -> Result<(), String>;
#[tauri::command] async fn preview_report(opts: ReportOpts) -> Result<Vec<u8>, String>;
```

`AppState` holds the loaded `HashMap<String, Cpt>` so commands like `detect_layers` and `generate_report` work by id without re-sending data.

### 4.6 Chart rendering

Stays on **HTML5 Canvas in TypeScript** — port of `js/cpt-chart.js` (~590 lines) into a `ChartCanvas.tsx` React component. Reason: interactive (hover, zoom, pan), Rust↔JS round-trip per frame is overkill.

For the PDF report, `cpt-core::plot::render_cpt_svg` produces an independent SVG in Rust — same visual layout, no shared rendering code. This is intentional: print and screen have different needs (interactivity vs vector fidelity).

### 4.7 Internationalization

NL (default) and EN. Namespaces: `common`, `ribbon`, `backstage`, `settings`, `cpt`, `report`.

---

## 5. PDF Report

Generated by `cpt-core::report::build` → `openaec_core::ReportData` → `openaec_engine::generate_pdf`.

### 5.1 Page structure (A4 portrait)

1. **Cover page** — OpenAEC header banner (Deep Forge background + amber gradient strip), title "Grondonderzoek — *project name*", project info block (opdrachtgever, locatie, projectnummer, datum, auteur, status). Footer with KvK/website from tenant config.
2. **Coordinate table page** — table with columns `Sondering | X-RD | Y-RD | Z-NAP | Diepte tot | Datum`, one row per CPT.
3. **Per-CPT page** (one per CPT in the project), standardized NEN-EN-ISO 22476-1 layout:
   - Title block: sondering id, projectnummer, datum, locatie, schaal
   - Wide left chart: qc + fs/Rf curves, depth axis (m NAP), gridlines
   - Narrow right chart: inclination (helling)
   - Maaiveld annotation + u2 curve if CPTu
   - Robertson SBT colour strip alongside the depth axis
   - Footer: project + opdrachtgever + page i of n + amber gradient

### 5.2 Plot rendering

`cpt-core::plot::render_cpt_svg(cpt) -> String` produces an SVG string. The SVG is embedded in the `ReportData` as an image-block; `openaec-engine` already uses `resvg` to rasterize SVG into PDF, so this slots in naturally. SVG → PDF preserves vector quality (scalable, crisp at any zoom).

### 5.3 Branding

Hardcoded OpenAEC tenant in v1: Deep Forge banner, amber gradient strip, Space Grotesk title font, Inter body font. Future: user-uploadable tenant via SettingsDialog → Tenant tab (deferred).

### 5.4 Project metadata

Sourced from `ProjectSettingsDialog` (already in template) — extended with: opdrachtgever, locatie, projectnummer, auteur, datum, status (Concept / Definitief / Revisie).

---

## 6. Style & UI

### 6.1 Tokens

Import `@openaec/tokens` from `OpenAEC-style-book/packages/tokens/` as an npm dependency (file: or git: dep). Provides CSS variables, Tailwind preset, JS exports.

### 6.2 Theme

- **Light (default):** `--blueprint-white` background, `--deep-forge` text, `--concrete` surfaces.
- **Dark:** `--deep-forge` background, `--blueprint-white` text, `#27272A` surfaces.
- Switch via `SettingsDialog → Appearance`. Persisted via Tauri store. Honours system preference if "system" selected.

### 6.3 Domain tokens (CPT chart curves)

```css
:root {
  --domain-cpt-qc:  var(--amber);          /* primary curve */
  --domain-cpt-fs:  var(--signal-orange);  /* secondary curve */
  --domain-cpt-rf:  var(--warm-gold);      /* tertiary curve */
  --domain-cpt-u2:  var(--info);           /* CPTu pore pressure */
}
```

Robertson SBT zones keep their own established palette (cyan → brown → green → yellow → orange → red → purple) — semantically meaningful and globally recognized in geotechnical practice.

### 6.4 Fonts

Space Grotesk 700 (titles), Inter 400/500/600 (body, UI), JetBrains Mono 400 (code, status, measurement values). Loaded via Google Fonts `@import` in `themes.css`, with `system-ui` fallback.

### 6.5 Layout

OpenAEC desktop template chrome, top to bottom:
- TitleBar 32px
- Ribbon ~120px (32px tab bar + 88px content)
- DocumentBar ~32px
- Main content (flex 1) with Left panel + center + Right panel
- StatusBar 24px

Side panels: 240px default, resizable 160–480px, individually collapsible to 28px tab.

---

## 7. Migration Plan

### Stap 0 — Preparation
- Rename GitHub repo `cpt-viewer` → `open-geo-studio` (preserves history)
- Move existing `index.html`, `css/`, `js/`, `sample/` to `_archive/vanilla-js/` for reference

### Stap 1 — `cpt-core` crate
- Scaffold `crates-warehouse/cpt-core/`, add to workspace `Cargo.toml`
- Port GEF parser (220 lines JS → Rust, prefer pure parsing over `nom` for simplicity)
- Port BRO-XML parser (236 lines JS → `quick-xml` crate)
- Port Robertson classification (195 lines JS → straight port of decision tree)
- Implement layer detection (group consecutive same-zone points, min 10cm threshold)
- Implement RD↔WGS84 (Bessel 1841 + 7-param Helmert, ~80 lines)
- Implement `report::build` producing `openaec_core::ReportData`
- Implement `plot::render_cpt_svg`
- Tests against `verification-files/GEF-BRO-XML/` fixtures

### Stap 2 — App scaffold
- Copy Tauri+React template → `apps/desktop/`
- Rename to Open GEO Studio (package.json, Cargo.toml, tauri.conf.json, i18n strings)
- Remove example panels (IFC viewer, 3D viewer)
- Add `cpt-core` and `openaec-core`/`-engine` as `src-tauri` dependencies (path or git)

### Stap 3 — Domain implementation
- Tauri command wrappers for cpt-core
- Zustand store for CPT state
- Left panel: 5 sections (Sonderingen, Sonderingsgegevens, Locatie, Grondopbouw, Meetdata) ported to React + OpenAEC styling
- Right panel: Robertson SBT legend + distribution bar
- Center: chart canvas (port `cpt-chart.js` to TS)

### Stap 4 — Map tab
- Leaflet integration (existing logic)
- PDOK BRO API call via Tauri command (avoids browser CORS)
- Clickable markers → load CPT via Tauri command

### Stap 5 — Report tab
- Extend `ProjectSettingsDialog` with opdrachtgever / locatie / auteur / status
- Report-tab UI: CPT selection list + preview iframe + "Genereer PDF" button
- Bind to `generate_report` and `preview_report` Tauri commands

### Stap 6 — Polish
- Complete NL+EN i18n for all strings
- Welcome screen with sample files (use the bundled `verification-files/GEF-BRO-XML/voorbeeld.gef` etc.)
- About dialog with OpenAEC attribution and version

---

## 8. Risks & Open Questions

| Risk | Mitigation |
|---|---|
| `openaec-core` schema may not yet support custom block types needed for the CPT plot | Verify `block_renderer.rs` extensibility early in Stap 1; fall back to embedding plot as image-block (already supported via `resvg`). |
| GEF parser edge cases (non-standard headers, exotic column orders) | Use the full `2600356_*.GEF` series as fixtures — these are real-world files. |
| RD↔WGS84 inline impl precision | Validate against PDOK's online conversion for a handful of known coordinates (sub-meter agreement target). |
| Chart canvas port from JS to TS may lose rendering subtleties | Keep `_archive/vanilla-js/` runnable as visual reference; A/B against same input data. |
| OpenAEC tokens npm package shape unknown | Read `packages/tokens/README.md` and `package.json` before depending on it; fall back to inlining the CSS starter from `DESIGN-SYSTEM.md` §9. |

---

## 9. Decisions Recorded

- **App name:** Open GEO Studio (three words, GEO in caps).
- **Theme:** light default, dark optional, "system" supported.
- **Stack:** Tauri 2 + React + TypeScript frontend, Rust backend, `cpt-core` Rust crate in `crates-warehouse`.
- **Report scope:** compact — cover + coordinate table + 1 page per CPT (no free-form advisory sections in v1).
- **PDF engine:** `openaec-core` / `openaec-engine` (uses `printpdf` + `resvg`).
- **Repo strategy:** rename `cpt-viewer` → `open-geo-studio`, archive vanilla JS; new `cpt-core` crate added to existing `crates-warehouse` workspace.
