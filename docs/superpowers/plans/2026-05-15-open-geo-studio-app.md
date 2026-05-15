# Open GEO Studio (Tauri+React) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the current vanilla-JS `cpt-viewer` web app into **Open GEO Studio**: a Tauri 2 + React 19 + TypeScript desktop app built on the OpenAEC Foundation visual identity, consuming the freshly-built `cpt-core` Rust crate (see `2026-05-15-cpt-core-crate.md`) for parsing, classification, plot rendering, and PDF report generation.

**Architecture:** Single Tauri desktop app under `apps/desktop/`. React frontend uses OpenAEC tokens, ribbon/titlebar/backstage from the OpenAEC Tauri template. Rust backend (`src-tauri/`) wraps `cpt-core` and `openaec-engine` as Tauri commands. State managed by Zustand. PDOK BRO map data fetched via Tauri command (no browser CORS).

**Tech Stack:** Tauri 2, React 19, TypeScript 5.9, Vite 7, Zustand 5, i18next 25, Leaflet 1.9, `cpt-core` (path/git dep), `openaec-engine` (path/git dep), `openaec-core` (path/git dep).

---

## Working Directory

All work happens in `C:\Users\rickd\Documents\GitHub\cpt-viewer\` (current repo, eventually renamed to `open-geo-studio`).

## File Structure (after migration)

```
cpt-viewer/                              (rename to open-geo-studio at end)
  _archive/
    vanilla-js/                          old web app, frozen reference
      index.html
      css/style.css
      js/{app,gef-parser,bro-xml-parser,robertson,cpt-chart,bro-map}.js
      sample/
  apps/
    desktop/                             ✨ NEW Tauri+React app
      package.json
      tsconfig.json
      vite.config.ts
      tailwind.config.ts                 (optional — we lean on CSS vars)
      index.html
      public/
        fonts/                           Space Grotesk, Inter, JetBrains Mono (self-hosted)
      src/
        main.tsx                         entry
        App.tsx                          shell — TitleBar + Ribbon + DocumentBar + StatusBar + main view
        themes.css                       OpenAEC tokens + cpt domain colors
        App.css                          layout-only styles
        i18n/
          config.ts
          locales/{nl,en}/{common,ribbon,backstage,settings,cpt,report}.json
        store/
          useCptStore.ts                 Zustand store
          types.ts                       TS mirrors of Rust types
        components/
          TitleBar.tsx                   (from template, branding swap)
          ribbon/
            Ribbon.tsx
            StartTab.tsx                 ✨ Open / Samples / Zoom / Close all / Export
            KaartTab.tsx                 ✨ BRO area load / Clear markers / status
            RapportTab.tsx               ✨ Project info / Selectie / Genereer PDF
          backstage/
            Backstage.tsx                File menu — New / Open / Recent / Export / Settings / Exit
          panels/
            LeftPanel.tsx                Sonderingen list + metadata + layers + datatable
            RightPanel.tsx               Robertson SBT legend + distribution bar
            ChartView.tsx                Canvas chart (port of cpt-chart.js)
            MapView.tsx                  Leaflet map + BRO markers
            ReportView.tsx               PDF preview iframe
          chart/
            ChartCanvas.tsx              Canvas component + interactivity
            chart-renderer.ts            Pure render function (no DOM)
            chart-types.ts               
          settings/
            SettingsDialog.tsx           (template) — theme + language + about
          project/
            ProjectSettingsDialog.tsx    project metadata form
          welcome/
            WelcomeScreen.tsx
        types/
          cpt.ts                         TS mirror of cpt_core::Cpt
      src-tauri/
        Cargo.toml                       depends on cpt-core, openaec-engine
        tauri.conf.json                  app id, window, plugins
        build.rs
        src/
          main.rs
          lib.rs
          commands/
            mod.rs
            cpt.rs                       open_cpt, open_cpts, parse_auto wrapper
            export.rs                    export_csv, export_geojson
            report.rs                    generate_report, preview_report
            bro_api.rs                   fetch_bro_area (PDOK proxy)
          state.rs                       AppState (HashMap<String, Cpt>)
  README.md                              updated — Open GEO Studio
  CLAUDE.md                              updated
  docs/                                  unchanged
```

## Dependencies

The app depends on the `cpt-core`, `openaec-core`, and `openaec-engine` crates in `C:\Users\rickd\Documents\GitHub\crates-warehouse\`. We use path dependencies until the warehouse is published.

```toml
# apps/desktop/src-tauri/Cargo.toml [dependencies]
cpt-core = { path = "../../../../crates-warehouse/cpt-core" }
openaec-core = { path = "../../../../crates-warehouse/openaec-core" }
openaec-engine = { path = "../../../../crates-warehouse/openaec-engine" }
```

---

## Task 1: Archive vanilla-JS and prepare repo layout

**Files:**
- Move: `index.html`, `css/`, `js/`, `sample/` → `_archive/vanilla-js/`
- Create: `apps/desktop/` (empty directory)
- Modify: `README.md`

- [ ] **Step 1: Verify clean working tree**

Run: `git status --short`
Expected: only `docs/` and the spec files we just added, no other surprises.

- [ ] **Step 2: Move old web app into archive**

```bash
mkdir -p _archive/vanilla-js
git mv index.html _archive/vanilla-js/
git mv css _archive/vanilla-js/css
git mv js _archive/vanilla-js/js
git mv sample _archive/vanilla-js/sample
```

- [ ] **Step 3: Update README.md**

Replace with:
```markdown
# Open GEO Studio

Desktop application for working with Dutch CPT (Cone Penetration Test) data — open GEF and BRO-XML files, visualize, classify (Robertson 1990 SBT), and generate professional PDF reports in OpenAEC house style.

## Status

In active development. The previous vanilla-JS web viewer lives in `_archive/vanilla-js/` as a reference.

## Repos involved

- This repo — Tauri+React desktop app (in `apps/desktop/`)
- [crates-warehouse](https://github.com/OpenAEC-Foundation/crates-warehouse) — `cpt-core` Rust crate (parsers, Robertson, report builder)
- [OpenAEC-Foundation/OpenAEC_stijlbook](https://github.com/OpenAEC-Foundation/OpenAEC_stijlbook) — design tokens and component reference

## Development

```bash
cd apps/desktop
npm install
npm run tauri dev
```

## License

MIT
```

- [ ] **Step 4: Commit the reorganization**

```bash
mkdir -p apps/desktop
git add _archive/ README.md apps/
git commit -m "chore: archive vanilla-js viewer, prepare repo for Tauri rewrite

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Copy OpenAEC Tauri+React template into apps/desktop

**Files:**
- Copy: `OpenAEC-style-book/project-templates/Tauri+React/*` (excluding `node_modules`, `target`, `screenshots`, `package-lock.json`) → `apps/desktop/`

- [ ] **Step 1: Copy the template**

Run (PowerShell, single command — be careful with paths containing spaces):
```powershell
$src = "C:\Users\rickd\Documents\GitHub\OpenAEC-style-book\project-templates\Tauri+React"
$dst = "C:\Users\rickd\Documents\GitHub\cpt-viewer\apps\desktop"
robocopy $src $dst /E /XD node_modules target screenshots .vite dist /XF package-lock.json Cargo.lock
```

Expected: robocopy reports files copied, exits with code 0–3 (anything ≥8 is a real error).

- [ ] **Step 2: Verify the structure**

Run: `ls apps/desktop/`
Expected: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/`, `src-tauri/`, etc.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/
git commit -m "chore: import OpenAEC Tauri+React template into apps/desktop

Starting point for Open GEO Studio. Will be customized: rename, strip 3D/IFC
viewer (out of scope), add cpt-core domain ribbon tabs, wire Tauri commands.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Rename app to Open GEO Studio and strip unused features

**Files:**
- Modify: `apps/desktop/package.json` — name, description
- Modify: `apps/desktop/src-tauri/Cargo.toml` — package name
- Modify: `apps/desktop/src-tauri/tauri.conf.json` — productName, windowTitle, identifier
- Modify: `apps/desktop/src-tauri/src/main.rs` and `lib.rs` — module name
- Modify: `apps/desktop/index.html` — title
- Remove: `apps/desktop/src/components/panels/IfcViewerPanel.tsx`, `ThreeViewer.tsx` and their CSS
- Remove: `@thatopen/components`, `@thatopen/fragments`, `three`, `@types/three` from package.json
- Modify: `apps/desktop/src/App.tsx` — strip IFC and Three references

- [ ] **Step 1: Rename in package.json**

Open `apps/desktop/package.json`. Change:
```json
"name": "open-template" → "name": "open-geo-studio"
```
Add or update:
```json
"description": "Open GEO Studio — desktop CPT viewer and report generator"
```

Remove the four unused dependencies:
- `@thatopen/components`
- `@thatopen/fragments`
- `three`
- `@types/three`

Add: nothing yet — domain deps come in Task 4.

- [ ] **Step 2: Rename in src-tauri/Cargo.toml**

Change:
```toml
name = "open-template"
[lib]
name = "open_template_lib"
```
to:
```toml
name = "open-geo-studio"
[lib]
name = "open_geo_studio_lib"
```

- [ ] **Step 3: Update tauri.conf.json**

In `apps/desktop/src-tauri/tauri.conf.json`:
- `productName`: `"Open GEO Studio"`
- `identifier`: `"foundation.openaec.opengeostudio"`
- `windows[0].title`: `"Open GEO Studio"`
- `version`: `"0.1.0"` (keep as-is)

- [ ] **Step 4: Update main.rs / lib.rs references**

In `apps/desktop/src-tauri/src/main.rs`:
```rust
fn main() {
    open_template_lib::run()    // CHANGE TO:
    open_geo_studio_lib::run()
}
```

Same in any other file that references `open_template_lib` (search and replace).

- [ ] **Step 5: Remove IFC/Three viewer panels**

```bash
rm apps/desktop/src/components/panels/IfcViewerPanel.tsx
rm apps/desktop/src/components/panels/IfcViewerPanel.css 2>/dev/null || true
rm apps/desktop/src/components/panels/ThreeViewer.tsx
rm apps/desktop/src/components/panels/ThreeViewer.css 2>/dev/null || true
```

- [ ] **Step 6: Strip imports in App.tsx**

In `apps/desktop/src/App.tsx`:
- Delete the line `import IfcViewerPanel from "./components/panels/IfcViewerPanel";`
- Delete the line `const ThreeViewer = lazy(...)` (and the `lazy`, `Suspense` imports if unused after this)
- Remove the `"ifc"` and `"viewer"` cases from `renderView()` (in `DetachedApp`) and `renderMainContent()` (in `App`)
- Remove `"ifc"` and `"viewer"` from the `isFullWidthView` test — only `"report"` should remain there for now

Run after this: `npm install` (in `apps/desktop`) — purges the removed deps.

- [ ] **Step 7: Update index.html title**

`apps/desktop/index.html`:
```html
<title>Open GEO Studio</title>
```

- [ ] **Step 8: Verify build**

Run from `apps/desktop/`:
```bash
npm install
npm run build      # tsc + vite build
```

Expected: build succeeds. If TypeScript flags missing imports, clean those up — they're stale references to deleted components.

Then verify the Rust side:
```bash
cd src-tauri
cargo check
```

Expected: compiles (don't run `tauri dev` yet — we haven't wired cpt-core).

- [ ] **Step 9: Commit**

```bash
cd ../../..   # back to repo root
git add apps/desktop/
git commit -m "feat(app): rename to Open GEO Studio, strip 3D/IFC viewer

Drops @thatopen/components, @thatopen/fragments, three, @types/three from deps.
Removes IfcViewerPanel and ThreeViewer components. Crate, package, and Tauri
identifiers renamed to open-geo-studio / open_geo_studio_lib.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Wire cpt-core dependency and create Tauri command skeleton

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Create: `apps/desktop/src-tauri/src/state.rs`
- Create: `apps/desktop/src-tauri/src/commands/mod.rs`
- Create: `apps/desktop/src-tauri/src/commands/cpt.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Add path dependencies to Cargo.toml**

Append to `apps/desktop/src-tauri/Cargo.toml` `[dependencies]`:
```toml
cpt-core = { path = "../../../../crates-warehouse/cpt-core" }
openaec-core = { path = "../../../../crates-warehouse/openaec-core" }
openaec-engine = { path = "../../../../crates-warehouse/openaec-engine" }
```

If the existing template has its own `openaec-core` path that points to a different location (it had `../../../../openaec-reports/rust/crates/openaec-core` originally), **replace** it with the warehouse path above.

- [ ] **Step 2: Create AppState**

Create `apps/desktop/src-tauri/src/state.rs`:
```rust
//! Shared application state for Tauri commands.

use std::collections::HashMap;
use std::sync::Mutex;
use cpt_core::Cpt;

#[derive(Default)]
pub struct AppState {
    pub cpts: Mutex<HashMap<String, Cpt>>,
}
```

- [ ] **Step 3: Create command module skeleton**

Create `apps/desktop/src-tauri/src/commands/mod.rs`:
```rust
//! Tauri commands exposed to the React frontend.

pub mod cpt;
```

Create `apps/desktop/src-tauri/src/commands/cpt.rs`:
```rust
//! CPT file open + parse commands.

use tauri::State;
use cpt_core::{parse_auto, Cpt};
use crate::state::AppState;

#[tauri::command]
pub fn open_cpt(content: String, filename: String, state: State<'_, AppState>) -> Result<Cpt, String> {
    let mut cpt = parse_auto(&content).map_err(|e| e.to_string())?;
    cpt.metadata.source_file = filename;
    state.cpts.lock().unwrap().insert(cpt.id.clone(), cpt.clone());
    Ok(cpt)
}

#[tauri::command]
pub fn close_cpt(id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.cpts.lock().unwrap().remove(&id);
    Ok(())
}

#[tauri::command]
pub fn list_cpts(state: State<'_, AppState>) -> Vec<Cpt> {
    state.cpts.lock().unwrap().values().cloned().collect()
}
```

- [ ] **Step 4: Wire into lib.rs**

Open `apps/desktop/src-tauri/src/lib.rs`. Add at the top:
```rust
mod state;
mod commands;

use state::AppState;
```

In the `run()` function, where `tauri::Builder::default()` is built, add:
```rust
.manage(AppState::default())
.invoke_handler(tauri::generate_handler![
    commands::cpt::open_cpt,
    commands::cpt::close_cpt,
    commands::cpt::list_cpts,
])
```

(If `.invoke_handler` already exists with other commands, add ours to the `generate_handler!` list.)

- [ ] **Step 5: Verify**

Run from `apps/desktop/src-tauri/`:
```bash
cargo build
```

Expected: clean build. If openaec-core / openaec-engine version mismatches surface, align the path so all three deps point to the same workspace (the crates-warehouse).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/
git commit -m "feat(app): wire cpt-core dependency and add open_cpt Tauri commands

Adds path deps on cpt-core, openaec-core, openaec-engine from crates-warehouse.
Three commands: open_cpt, close_cpt, list_cpts — all operate on a shared
HashMap<String, Cpt> in AppState.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: TypeScript types mirror + Zustand store

**Files:**
- Create: `apps/desktop/src/types/cpt.ts`
- Create: `apps/desktop/src/store/useCptStore.ts`

- [ ] **Step 1: Write TS types**

Create `apps/desktop/src/types/cpt.ts`:
```ts
// Mirrors cpt_core::Cpt — keep in sync with crates-warehouse/cpt-core/src/domain.rs.

export interface Cpt {
  id: string;
  metadata: Metadata;
  position?: Position;
  points: MeasurementPoint[];
}

export interface Metadata {
  project_name?: string;
  project_number?: string;
  date?: string; // ISO 8601 date
  equipment?: string;
  ground_level_nap?: number;
  source_file: string;
}

export interface Position {
  x_rd: number;
  y_rd: number;
  z_nap?: number;
}

export interface MeasurementPoint {
  depth: number;
  depth_nap?: number;
  qc?: number;
  fs?: number;
  rf?: number;
  u2?: number;
  inclination?: number;
}

export interface Zone {
  number: number;
  name: string;
  color: string;
}

export interface Layer {
  depth_top: number;
  depth_bottom: number;
  zone_number: number;
  zone_name: string;
  zone_color: string;
}

export interface ProjectMeta {
  title: string;
  client: string;
  location: string;
  project_number: string;
  author: string;
  date: string; // ISO 8601
}
```

- [ ] **Step 2: Write Zustand store**

Create `apps/desktop/src/store/useCptStore.ts`:
```ts
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Cpt, ProjectMeta } from "../types/cpt";

interface HoveredPoint {
  depth: number;
  qc?: number;
  fs?: number;
  rf?: number;
  u2?: number;
  soil?: string;
}

interface CptStore {
  cpts: Map<string, Cpt>;
  activeCptId: string | null;
  hoveredPoint: HoveredPoint | null;
  projectMeta: ProjectMeta;

  openCpt: (path: string) => Promise<void>;
  closeCpt: (id: string) => Promise<void>;
  closeAll: () => Promise<void>;
  setActive: (id: string | null) => void;
  setHover: (p: HoveredPoint | null) => void;
  setProjectMeta: (m: Partial<ProjectMeta>) => void;
}

const today = new Date().toISOString().slice(0, 10);

export const useCptStore = create<CptStore>((set, get) => ({
  cpts: new Map(),
  activeCptId: null,
  hoveredPoint: null,
  projectMeta: {
    title: "Nieuw project",
    client: "",
    location: "",
    project_number: "",
    author: "",
    date: today,
  },

  async openCpt(path: string) {
    // Read file via Tauri's fs plugin or pass content from a file-dialog flow.
    // For now, expect the caller (Backstage/Ribbon) to read and pass content+filename.
    throw new Error("openCpt expects the caller to invoke open_cpt with content");
  },

  async closeCpt(id: string) {
    await invoke("close_cpt", { id });
    set((s) => {
      const next = new Map(s.cpts);
      next.delete(id);
      const newActive = s.activeCptId === id ? (next.keys().next().value ?? null) : s.activeCptId;
      return { cpts: next, activeCptId: newActive };
    });
  },

  async closeAll() {
    const ids = Array.from(get().cpts.keys());
    for (const id of ids) await invoke("close_cpt", { id });
    set({ cpts: new Map(), activeCptId: null });
  },

  setActive(id) { set({ activeCptId: id }); },
  setHover(p) { set({ hoveredPoint: p }); },
  setProjectMeta(m) { set((s) => ({ projectMeta: { ...s.projectMeta, ...m } })); },
}));

// Helper used by the file-open flow: invokes open_cpt with file content,
// then merges the returned Cpt into the store.
export async function loadCptFromContent(content: string, filename: string) {
  const cpt = await invoke<Cpt>("open_cpt", { content, filename });
  useCptStore.setState((s) => {
    const next = new Map(s.cpts);
    next.set(cpt.id, cpt);
    return { cpts: next, activeCptId: cpt.id };
  });
  return cpt;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run from `apps/desktop/`:
```bash
npx tsc --noEmit
```

Expected: no errors. If `Map` serialization etc. flags TS issues, fix locally.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/types/ apps/desktop/src/store/
git commit -m "feat(app): TypeScript types + Zustand store for CPT state

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Replace the example ribbon tabs with Open GEO Studio tabs

**Files:**
- Examine: `apps/desktop/src/components/ribbon/` (HomeTab.tsx is the template demo)
- Create: `apps/desktop/src/components/ribbon/StartTab.tsx`
- Create: `apps/desktop/src/components/ribbon/KaartTab.tsx`
- Create: `apps/desktop/src/components/ribbon/RapportTab.tsx`
- Modify: `apps/desktop/src/components/ribbon/Ribbon.tsx` — register new tabs
- Remove: `apps/desktop/src/components/ribbon/HomeTab.tsx`
- Modify: `apps/desktop/src/i18n/locales/{nl,en}/ribbon.json`

- [ ] **Step 1: Read existing Ribbon.tsx to learn the tab-registration API**

Read `apps/desktop/src/components/ribbon/Ribbon.tsx` — it likely defines a `TABS` array. Note the shape: each tab has `id`, `label`, and a component. Reuse `RibbonGroup`, `RibbonButton`, `RibbonButtonStack` building blocks.

- [ ] **Step 2: Create StartTab.tsx**

```tsx
import { useTranslation } from "react-i18next";
import RibbonGroup from "./RibbonGroup";
import RibbonButton from "./RibbonButton";
import RibbonButtonStack from "./RibbonButtonStack";
import { openFileIcon, uploadIcon, fileIcon, zoomInIcon, zoomOutIcon, zoomFitIcon, closeIcon, exportIcon } from "./icons";
import { useCptStore, loadCptFromContent } from "../../store/useCptStore";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";

export default function StartTab({ onOpenSample }: { onOpenSample: (path: string) => void }) {
  const { t } = useTranslation("ribbon");
  const closeAll = useCptStore((s) => s.closeAll);

  async function handleOpen() {
    const selected = await open({
      multiple: true,
      filters: [
        { name: "CPT", extensions: ["gef", "GEF", "xml", "XML"] },
      ],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    for (const p of paths) {
      const content = await readTextFile(p);
      const filename = p.split(/[\\/]/).pop() ?? p;
      await loadCptFromContent(content, filename);
    }
  }

  return (
    <>
      <RibbonGroup label={t("file")}>
        <RibbonButton icon={uploadIcon} label={t("open")} onClick={handleOpen} />
      </RibbonGroup>
      <div className="ribbon-separator" />
      <RibbonGroup label={t("examples")}>
        <RibbonButtonStack>
          <RibbonButton icon={fileIcon} label="CPT Pygef" onClick={() => onOpenSample("samples/cpt_pygef.gef")} />
          <RibbonButton icon={fileIcon} label="CPT BRO" onClick={() => onOpenSample("samples/cpt_bro.xml")} />
          <RibbonButton icon={fileIcon} label="Voorbeeld" onClick={() => onOpenSample("samples/voorbeeld.gef")} />
        </RibbonButtonStack>
      </RibbonGroup>
      <div className="ribbon-separator" />
      <RibbonGroup label={t("zoom")}>
        <RibbonButton icon={zoomInIcon}  label={t("zoomIn")}  onClick={() => window.dispatchEvent(new CustomEvent("ogs:zoom-in"))} />
        <RibbonButton icon={zoomOutIcon} label={t("zoomOut")} onClick={() => window.dispatchEvent(new CustomEvent("ogs:zoom-out"))} />
        <RibbonButton icon={zoomFitIcon} label={t("zoomFit")} onClick={() => window.dispatchEvent(new CustomEvent("ogs:zoom-fit"))} />
      </RibbonGroup>
      <div className="ribbon-separator" />
      <RibbonGroup label={t("edit")}>
        <RibbonButton icon={closeIcon} label={t("closeAll")} onClick={() => void closeAll()} />
      </RibbonGroup>
    </>
  );
}
```

**Note on icons:** Reuse whatever icon module exists at `components/ribbon/icons.ts`. If specific icons are missing (e.g. `zoomInIcon`), add them as SVG strings following the existing pattern (`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">...</svg>`).

The `ogs:zoom-*` custom events are picked up by ChartCanvas in Task 7.

- [ ] **Step 3: Create KaartTab.tsx**

```tsx
import { useTranslation } from "react-i18next";
import RibbonGroup from "./RibbonGroup";
import RibbonButton from "./RibbonButton";
import { mapPinIcon, trashIcon } from "./icons";

export default function KaartTab() {
  const { t } = useTranslation("ribbon");
  return (
    <>
      <RibbonGroup label="BRO Data">
        <RibbonButton icon={mapPinIcon} label={t("loadArea")} onClick={() => window.dispatchEvent(new CustomEvent("ogs:bro-load-area"))} />
      </RibbonGroup>
      <div className="ribbon-separator" />
      <RibbonGroup label={t("map")}>
        <RibbonButton icon={trashIcon} label={t("clearMarkers")} onClick={() => window.dispatchEvent(new CustomEvent("ogs:bro-clear"))} />
      </RibbonGroup>
    </>
  );
}
```

- [ ] **Step 4: Create RapportTab.tsx**

```tsx
import { useTranslation } from "react-i18next";
import RibbonGroup from "./RibbonGroup";
import RibbonButton from "./RibbonButton";
import { settingsIcon, listIcon, downloadIcon } from "./icons";
import { useCptStore } from "../../store/useCptStore";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

export default function RapportTab({ onOpenProjectSettings }: { onOpenProjectSettings: () => void }) {
  const { t } = useTranslation("ribbon");
  const cpts = useCptStore((s) => Array.from(s.cpts.values()));
  const projectMeta = useCptStore((s) => s.projectMeta);

  async function generatePdf() {
    const dst = await save({
      defaultPath: `${projectMeta.title}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!dst) return;
    await invoke("generate_report", {
      cptIds: cpts.map((c) => c.id),
      project: projectMeta,
      outputPath: dst,
    });
  }

  return (
    <>
      <RibbonGroup label={t("project")}>
        <RibbonButton icon={settingsIcon} label={t("projectInfo")} onClick={onOpenProjectSettings} />
      </RibbonGroup>
      <div className="ribbon-separator" />
      <RibbonGroup label={t("output")}>
        <RibbonButton icon={downloadIcon} label={t("generatePdf")} onClick={() => void generatePdf()} disabled={cpts.length === 0} />
      </RibbonGroup>
    </>
  );
}
```

- [ ] **Step 5: Register the tabs in Ribbon.tsx**

In `apps/desktop/src/components/ribbon/Ribbon.tsx`, replace the existing `HomeTab` registration with:
```tsx
import StartTab from "./StartTab";
import KaartTab from "./KaartTab";
import RapportTab from "./RapportTab";

// ... inside the TABS array (or wherever tabs are registered):
const TABS = [
  { id: "start",   label: "Start",   render: (props) => <StartTab onOpenSample={props.onOpenSample} /> },
  { id: "kaart",   label: "Kaart",   render: () => <KaartTab /> },
  { id: "rapport", label: "Rapport", render: (props) => <RapportTab onOpenProjectSettings={props.onOpenProjectSettings} /> },
];
```

(The exact shape depends on what the template provides — adapt to fit. The goal is: three tabs labelled Start / Kaart / Rapport, each rendering the component above.)

- [ ] **Step 6: Remove HomeTab.tsx**

```bash
rm apps/desktop/src/components/ribbon/HomeTab.tsx
```

Remove any remaining references to `HomeTab` in `Ribbon.tsx` or `App.tsx`.

- [ ] **Step 7: Update i18n strings**

Edit `apps/desktop/src/i18n/locales/nl/ribbon.json`:
```json
{
  "file": "Bestand",
  "open": "Open",
  "examples": "Voorbeelden",
  "zoom": "Weergave",
  "zoomIn": "Zoom +",
  "zoomOut": "Zoom -",
  "zoomFit": "Passend",
  "edit": "Bewerken",
  "closeAll": "Sluit alle",
  "map": "Kaart",
  "loadArea": "Laad gebied",
  "clearMarkers": "Wis markers",
  "project": "Project",
  "projectInfo": "Projectinfo",
  "output": "Output",
  "generatePdf": "Genereer PDF"
}
```

And the English mirror at `en/ribbon.json` with translated values.

- [ ] **Step 8: Add `@tauri-apps/plugin-fs` to package.json**

```bash
cd apps/desktop && npm install @tauri-apps/plugin-fs
```

Also enable it in `src-tauri/Cargo.toml`:
```toml
tauri-plugin-fs = "2"
```

And register in `src-tauri/src/lib.rs` next to other plugins:
```rust
.plugin(tauri_plugin_fs::init())
```

Allow file reads in `src-tauri/capabilities/default.json` (or the relevant capability file — search for `permissions`): add `"fs:default"` or specific scoping for `$DOCUMENT/**`.

- [ ] **Step 9: Build + commit**

```bash
cd apps/desktop && npm run build
cd .. && git add apps/desktop/
git commit -m "feat(app): replace example ribbon tabs with Start / Kaart / Rapport

Adds three domain tabs:
- Start: Open file, samples, zoom controls, close all
- Kaart: Load BRO area, clear markers (handlers wired in Task 9)
- Rapport: Project info dialog, Generate PDF (wired in Task 10)

Open file flow uses tauri-plugin-fs to read selected files and pass content
to the open_cpt command. Zoom controls dispatch DOM events that ChartCanvas
listens to (wired in Task 7).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Port chart canvas from JS to TypeScript

**Files:**
- Read: `_archive/vanilla-js/js/cpt-chart.js` (the 590-line source)
- Create: `apps/desktop/src/components/chart/chart-renderer.ts` (pure render function)
- Create: `apps/desktop/src/components/chart/ChartCanvas.tsx` (React wrapper)
- Create: `apps/desktop/src/components/panels/ChartView.tsx`
- Modify: `apps/desktop/src/App.tsx` — render `ChartView` in the main area when `activeView === "chart"`

- [ ] **Step 1: Study the original**

Open `_archive/vanilla-js/js/cpt-chart.js`. Understand the rendering pipeline:
- Inputs: array of CPTs, layout config (width/height, margins), state (zoom level, pan offset, hovered point)
- Output: side-by-side chart canvases, one per CPT — each showing qc + Rf curves with depth axis, Robertson SBT strip
- Interactivity: hover → emit hovered-point event, zoom via wheel, fit-to-content via "Passend"

- [ ] **Step 2: Write the pure renderer**

Create `apps/desktop/src/components/chart/chart-renderer.ts`. Port the render logic from `cpt-chart.js` into a pure function:
```ts
import type { Cpt } from "../../types/cpt";

export interface ChartRenderOptions {
  width: number;
  height: number;
  zoom: number;          // 1.0 = fit-to-content
  pan: number;           // vertical offset in pixels
}

export interface ChartCurves {
  qc: boolean;
  fs: boolean;
  rf: boolean;
  u2: boolean;
}

export function renderChart(
  ctx: CanvasRenderingContext2D,
  cpts: Cpt[],
  opts: ChartRenderOptions,
  curves: ChartCurves,
) {
  // ... ported drawing code ...
}

export interface HitResult { cptId: string; depth: number; qc?: number; fs?: number; rf?: number; u2?: number; }

export function hitTest(cpts: Cpt[], opts: ChartRenderOptions, x: number, y: number): HitResult | null {
  // Returns the point under (x,y), or null
}
```

Port over from JS: depth-axis tick generation, qc axis auto-scale (nice_max), curve path generation, side-by-side layout. Use color tokens from `themes.css` via `getComputedStyle(document.documentElement).getPropertyValue('--domain-cpt-qc')`.

> **Note:** If the JS code is heavily intertwined with DOM events, focus on the *drawing* part first. Interactivity (event listeners) belongs in the React wrapper.

- [ ] **Step 3: React wrapper**

Create `apps/desktop/src/components/chart/ChartCanvas.tsx`:
```tsx
import { useEffect, useRef, useState } from "react";
import { useCptStore } from "../../store/useCptStore";
import { renderChart, hitTest } from "./chart-renderer";

export default function ChartCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cpts = useCptStore((s) => Array.from(s.cpts.values()));
  const setHover = useCptStore((s) => s.setHover);
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState(0);

  // Render whenever inputs change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    renderChart(ctx, cpts, {
      width: rect.width, height: rect.height, zoom, pan,
    }, { qc: true, fs: false, rf: true, u2: true });
  }, [cpts, zoom, pan]);

  // Wheel zoom
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => Math.max(0.2, Math.min(8, z * (e.deltaY < 0 ? 1.1 : 0.9))));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  // External zoom controls from Ribbon
  useEffect(() => {
    const onIn  = () => setZoom((z) => Math.min(8, z * 1.25));
    const onOut = () => setZoom((z) => Math.max(0.2, z * 0.8));
    const onFit = () => { setZoom(1); setPan(0); };
    window.addEventListener("ogs:zoom-in",  onIn);
    window.addEventListener("ogs:zoom-out", onOut);
    window.addEventListener("ogs:zoom-fit", onFit);
    return () => {
      window.removeEventListener("ogs:zoom-in",  onIn);
      window.removeEventListener("ogs:zoom-out", onOut);
      window.removeEventListener("ogs:zoom-fit", onFit);
    };
  }, []);

  // Hover
  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = hitTest(cpts, { width: rect.width, height: rect.height, zoom, pan }, x, y);
    setHover(hit ? { depth: hit.depth, qc: hit.qc, fs: hit.fs, rf: hit.rf, u2: hit.u2 } : null);
  };
  const onLeave = () => setHover(null);

  return (
    <canvas
      ref={canvasRef}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}
```

- [ ] **Step 4: ChartView wrapper**

Create `apps/desktop/src/components/panels/ChartView.tsx`:
```tsx
import ChartCanvas from "../chart/ChartCanvas";
import { useCptStore } from "../../store/useCptStore";
import { useTranslation } from "react-i18next";

export default function ChartView() {
  const { t } = useTranslation("cpt");
  const cpts = useCptStore((s) => s.cpts);
  if (cpts.size === 0) {
    return (
      <div className="placeholder">
        <p>{t("noCptOpenHint")}</p>
      </div>
    );
  }
  return <ChartCanvas />;
}
```

Add to `apps/desktop/src/i18n/locales/nl/cpt.json`:
```json
{
  "noCptOpenHint": "Open een GEF of BRO-XML bestand om te beginnen."
}
```
(And the English equivalent.)

- [ ] **Step 5: Wire into App.tsx**

In `apps/desktop/src/App.tsx`, replace the placeholder case for `default` / `chart`:
```tsx
import ChartView from "./components/panels/ChartView";
// ...
switch (activeView) {
  case "report": return <ReportView />;
  case "map":    return <MapView />;
  default:       return <ChartView />;
}
```

- [ ] **Step 6: Build + run**

```bash
cd apps/desktop && npm run tauri dev
```

Expected: app launches. Click "Open" → choose `_archive/vanilla-js/sample/cpt_pygef.gef` (or use the absolute path to `verification-files/GEF-BRO-XML/voorbeeld.gef`). The CPT should appear in the chart canvas.

If the rendering looks off (axis offset, missing curves), iterate on `chart-renderer.ts` — that's the porting work. The vanilla-JS reference is right there in `_archive/`.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/components/chart/ apps/desktop/src/components/panels/ChartView.tsx apps/desktop/src/i18n/ apps/desktop/src/App.tsx
git commit -m "feat(app): port chart canvas from vanilla JS to TypeScript

Implements ChartCanvas + renderChart + hitTest as a Canvas-based interactive
view. Listens to ogs:zoom-* events from the ribbon, wheel scroll, and mouse
move for hover. Uses OpenAEC domain tokens (--domain-cpt-qc etc.) for curve
colors via getComputedStyle.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Left + Right side panels

**Files:**
- Create: `apps/desktop/src/components/panels/LeftPanel.tsx`
- Create: `apps/desktop/src/components/panels/RightPanel.tsx`
- Modify: `apps/desktop/src/App.tsx` — replace placeholder panels

- [ ] **Step 1: LeftPanel**

Create `apps/desktop/src/components/panels/LeftPanel.tsx`. Sections:
1. **Sonderingen** — list of opened CPTs, click to set active, X button to close
2. **Sonderingsgegevens** — metadata of active CPT
3. **Locatie** — mini Leaflet map showing active CPT position (lazy-load Leaflet)
4. **Grondopbouw** — table of layers (from `detect_layers` Tauri command, called on demand)
5. **Meetdata** — paginated table of measurement points

Use `<PanelSection>` from the template's App.tsx (already defined). Wire each section's data via `useCptStore` selectors.

```tsx
import { useTranslation } from "react-i18next";
import { useCptStore } from "../../store/useCptStore";

export default function LeftPanel() {
  const { t } = useTranslation("cpt");
  const cpts = useCptStore((s) => Array.from(s.cpts.values()));
  const active = useCptStore((s) => s.cpts.get(s.activeCptId ?? ""));
  const setActive = useCptStore((s) => s.setActive);
  const closeCpt = useCptStore((s) => s.closeCpt);

  return (
    <div className="left-panel-body">
      <PanelSection title={t("sonderingen")} defaultOpen>
        <ul className="cpt-list">
          {cpts.map((c) => (
            <li key={c.id} className={c.id === active?.id ? "active" : ""}>
              <button onClick={() => setActive(c.id)}>{c.id}</button>
              <button onClick={() => void closeCpt(c.id)}>×</button>
            </li>
          ))}
        </ul>
      </PanelSection>
      <PanelSection title={t("sonderingsgegevens")} defaultOpen>
        {active ? (
          <dl>
            <dt>{t("projectNumber")}</dt><dd>{active.metadata.project_number ?? "—"}</dd>
            <dt>{t("date")}</dt><dd>{active.metadata.date ?? "—"}</dd>
            <dt>{t("equipment")}</dt><dd>{active.metadata.equipment ?? "—"}</dd>
            <dt>{t("groundLevel")}</dt><dd>{active.metadata.ground_level_nap?.toFixed(2) ?? "—"} m NAP</dd>
          </dl>
        ) : <p>—</p>}
      </PanelSection>
      <PanelSection title={t("layers")} defaultOpen>
        <LayersTable cptId={active?.id ?? null} />
      </PanelSection>
      <PanelSection title={t("measurements")}>
        <MeasurementsTable cpt={active ?? null} />
      </PanelSection>
    </div>
  );
}

// ... LayersTable (calls detect_layers Tauri command) and MeasurementsTable (paginated) below.
```

Add `LayersTable` and `MeasurementsTable` helper components in the same file, or under `components/panels/`.

- [ ] **Step 2: RightPanel — Robertson SBT legend**

Create `apps/desktop/src/components/panels/RightPanel.tsx`:
```tsx
import { useTranslation } from "react-i18next";
import { useCptStore } from "../../store/useCptStore";

const ROBERTSON_ZONES = [
  { number: 1, name: "Gevoelig fijnkorrelig",  color: "#00BCD4" },
  { number: 2, name: "Organisch / veen",        color: "#795548" },
  { number: 3, name: "Klei",                    color: "#4CAF50" },
  { number: 4, name: "Silt mengsels",           color: "#8BC34A" },
  { number: 5, name: "Zand mengsels",           color: "#FFC107" },
  { number: 6, name: "Zand",                    color: "#FF9800" },
  { number: 7, name: "Grof zand / grind",       color: "#FF5722" },
  { number: 8, name: "Zeer vast zand/klei",     color: "#F44336" },
  { number: 9, name: "Zeer vast fijnkorrelig",  color: "#9C27B0" },
];

export default function RightPanel() {
  const { t } = useTranslation("cpt");
  // Could also fetch distribution from layers, for the colour bar — keep simple for now.
  return (
    <div className="right-panel-body">
      <h3>{t("robertsonSbt")}</h3>
      <ul className="sbt-legend">
        {ROBERTSON_ZONES.map((z) => (
          <li key={z.number}>
            <span className="sbt-swatch" style={{ background: z.color }} />
            <span className="sbt-num">{z.number}</span>
            <span className="sbt-name">{z.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Wire into App.tsx**

In `apps/desktop/src/App.tsx`, replace the placeholder `<PanelSection>` content inside the left panel with `<LeftPanel />`, and same for the right panel with `<RightPanel />`.

- [ ] **Step 4: Add styles (minimal)**

Append to `apps/desktop/src/App.css` (or create panel-specific CSS):
```css
.cpt-list { list-style: none; padding: 0; margin: 0; }
.cpt-list li { display: flex; align-items: center; gap: 8px; padding: 4px 8px; }
.cpt-list li.active { background: var(--amber); color: white; border-radius: var(--radius-sm); }

.sbt-legend { list-style: none; padding: 0; margin: 0; font-size: 0.8rem; }
.sbt-legend li { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
.sbt-swatch { width: 16px; height: 16px; border-radius: var(--radius-sm); }
.sbt-num { font-family: var(--font-code); width: 16px; }
```

- [ ] **Step 5: Build + commit**

```bash
npm run build
git add apps/desktop/src/components/panels/ apps/desktop/src/App.tsx apps/desktop/src/App.css apps/desktop/src/i18n/
git commit -m "feat(app): LeftPanel (CPT list + metadata + layers + measurements) and RightPanel (Robertson SBT legend)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Map view + PDOK BRO area loader

**Files:**
- Create: `apps/desktop/src/components/panels/MapView.tsx`
- Create: `apps/desktop/src-tauri/src/commands/bro_api.rs`
- Modify: `apps/desktop/src-tauri/src/commands/mod.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs` (register command)
- Modify: `apps/desktop/package.json` — add `leaflet` and `@types/leaflet`

- [ ] **Step 1: Install Leaflet**

```bash
cd apps/desktop && npm install leaflet @types/leaflet
```

- [ ] **Step 2: Implement MapView**

Create `apps/desktop/src/components/panels/MapView.tsx`:
```tsx
import { useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { invoke } from "@tauri-apps/api/core";
import { useCptStore, loadCptFromContent } from "../../store/useCptStore";

interface BroFeature {
  id: string;
  lat: number;
  lon: number;
  depth?: number;
}

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const [status, setStatus] = useState("Zoom in en klik 'Laad gebied'");

  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current).setView([52.156, 5.388], 8);
    L.tileLayer(
      "https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png",
      { attribution: "Kaartgegevens © Kadaster | PDOK", maxZoom: 19 },
    ).addTo(map);
    markersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const onLoad = async () => {
      const b = map.getBounds();
      const bbox = { minLat: b.getSouth(), minLon: b.getWest(), maxLat: b.getNorth(), maxLon: b.getEast() };
      setStatus("Bezig...");
      try {
        const features = await invoke<BroFeature[]>("fetch_bro_area", { bbox });
        markersRef.current?.clearLayers();
        features.forEach((f) => {
          const m = L.marker([f.lat, f.lon]).bindPopup(`<strong>${f.id}</strong><br>diepte ${f.depth?.toFixed(1) ?? "—"} m`);
          m.on("click", async () => {
            const xml = await invoke<string>("fetch_bro_cpt", { broId: f.id });
            await loadCptFromContent(xml, `${f.id}.xml`);
          });
          markersRef.current?.addLayer(m);
        });
        setStatus(`${features.length} sonderingen geladen`);
      } catch (e) {
        setStatus(`Fout: ${String(e)}`);
      }
    };
    const onClear = () => { markersRef.current?.clearLayers(); setStatus("Markers gewist"); };
    window.addEventListener("ogs:bro-load-area", onLoad);
    window.addEventListener("ogs:bro-clear", onClear);
    return () => {
      window.removeEventListener("ogs:bro-load-area", onLoad);
      window.removeEventListener("ogs:bro-clear", onClear);
      map.remove();
    };
  }, []);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      <div className="map-status">{status}</div>
    </div>
  );
}
```

Add CSS for `.map-status` (bottom-left badge).

- [ ] **Step 3: PDOK BRO API command**

Create `apps/desktop/src-tauri/src/commands/bro_api.rs`:
```rust
//! PDOK BRO API proxy commands.
//!
//! BRO (Basisregistratie Ondergrond) exposes CPT data via a public SOAP+REST
//! API at https://publiek.broservices.nl. We hit it from the Rust side to
//! avoid browser CORS, then return JSON-friendly results to React.

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct BBox { pub min_lat: f64, pub min_lon: f64, pub max_lat: f64, pub max_lon: f64 }

#[derive(Debug, Serialize)]
pub struct BroFeature {
    pub id: String,
    pub lat: f64,
    pub lon: f64,
    pub depth: Option<f64>,
}

#[tauri::command]
pub async fn fetch_bro_area(bbox: BBox) -> Result<Vec<BroFeature>, String> {
    // Implementation:
    //   1. POST to https://publiek.broservices.nl/sr/cpt/v1/characteristics/searches
    //      with a GeoJSON bbox polygon.
    //   2. Parse the GML response or characteristic-JSON (depending on Accept header).
    //   3. Return Vec<BroFeature>.
    //
    // For v1, return an empty Vec — implement properly when the user wants real BRO browsing.
    Ok(Vec::new())
}

#[tauri::command]
pub async fn fetch_bro_cpt(bro_id: String) -> Result<String, String> {
    // Implementation: GET https://publiek.broservices.nl/sr/cpt/v1/objects/{bro_id}
    // Returns the raw XML; the frontend hands it to loadCptFromContent.
    let url = format!("https://publiek.broservices.nl/sr/cpt/v1/objects/{}", bro_id);
    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("BRO API {}", resp.status()));
    }
    resp.text().await.map_err(|e| e.to_string())
}
```

Add `reqwest = { workspace = true }` to `apps/desktop/src-tauri/Cargo.toml`.

Register the commands in `src-tauri/src/commands/mod.rs`:
```rust
pub mod bro_api;
```

And add to `generate_handler!` in `lib.rs`:
```rust
commands::bro_api::fetch_bro_area,
commands::bro_api::fetch_bro_cpt,
```

- [ ] **Step 4: Wire MapView into App.tsx**

```tsx
case "map": return <MapView />;
```

- [ ] **Step 5: Build + commit**

```bash
npm run tauri dev    # smoke test — kaart tab should open, world map visible
# Ctrl+C to close
git add apps/desktop/ 
git commit -m "feat(app): Map view (Leaflet + PDOK BRT) and BRO API skeleton commands

Implements MapView with PDOK background tiles. Adds two Tauri commands
(fetch_bro_area, fetch_bro_cpt) that proxy the BRO public API to avoid
browser CORS. fetch_bro_area returns an empty list for now — full implementation
deferred until the BRO query format is finalized.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Report view + PDF generation

**Files:**
- Create: `apps/desktop/src/components/panels/ReportView.tsx`
- Create: `apps/desktop/src/components/project/ProjectSettingsDialog.tsx` (extend the template's version)
- Create: `apps/desktop/src-tauri/src/commands/report.rs`
- Modify: `apps/desktop/src-tauri/src/commands/mod.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs` (register commands)

- [ ] **Step 1: Tauri report commands**

Create `apps/desktop/src-tauri/src/commands/report.rs`:
```rust
//! PDF report generation.

use std::path::PathBuf;
use serde::Deserialize;
use tauri::State;
use chrono::NaiveDate;
use cpt_core::{build_report, ProjectMeta};
use openaec_engine::generate_pdf_bytes;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct ProjectMetaInput {
    pub title: String,
    pub client: String,
    pub location: String,
    pub project_number: String,
    pub author: String,
    pub date: String, // ISO 8601
}

impl From<ProjectMetaInput> for ProjectMeta {
    fn from(p: ProjectMetaInput) -> Self {
        let date = NaiveDate::parse_from_str(&p.date, "%Y-%m-%d")
            .unwrap_or_else(|_| chrono::Local::now().date_naive());
        ProjectMeta {
            title: p.title, client: p.client, location: p.location,
            project_number: p.project_number, author: p.author, date,
        }
    }
}

#[tauri::command]
pub fn preview_report(
    cpt_ids: Vec<String>,
    project: ProjectMetaInput,
    state: State<'_, AppState>,
) -> Result<Vec<u8>, String> {
    let cpts_map = state.cpts.lock().unwrap();
    let cpts: Vec<_> = cpt_ids.iter().filter_map(|id| cpts_map.get(id).cloned()).collect();
    let report = build_report(&cpts, &project.into());
    generate_pdf_bytes(&report).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn generate_report(
    cpt_ids: Vec<String>,
    project: ProjectMetaInput,
    output_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let bytes = preview_report(cpt_ids, project, state)?;
    std::fs::write(PathBuf::from(output_path), bytes).map_err(|e| e.to_string())
}
```

Add to `commands/mod.rs`: `pub mod report;`. Register both commands in `lib.rs`'s `generate_handler!`.

- [ ] **Step 2: ReportView component**

Create `apps/desktop/src/components/panels/ReportView.tsx`:
```tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useCptStore } from "../../store/useCptStore";

export default function ReportView() {
  const cpts = useCptStore((s) => Array.from(s.cpts.values()));
  const projectMeta = useCptStore((s) => s.projectMeta);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cpts.length === 0) return;
    setError(null);
    invoke<number[]>("preview_report", { cptIds: cpts.map((c) => c.id), project: projectMeta })
      .then((bytes) => {
        const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        setPdfBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
      })
      .catch((e) => setError(String(e)));
    return () => { if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl); };
  }, [cpts, projectMeta]);

  if (cpts.length === 0) return <div className="placeholder"><p>Geen CPTs geopend.</p></div>;
  if (error) return <div className="placeholder error"><p>{error}</p></div>;
  if (!pdfBlobUrl) return <div className="placeholder"><p>Rapport genereren...</p></div>;

  return <iframe src={pdfBlobUrl} style={{ width: "100%", height: "100%", border: 0 }} title="Rapport preview" />;
}
```

- [ ] **Step 3: Extend ProjectSettingsDialog**

In `apps/desktop/src/components/project/ProjectSettingsDialog.tsx`, replace the placeholder form fields with our project metadata fields:
```tsx
import Modal from "../Modal";
import { useCptStore } from "../../store/useCptStore";

export default function ProjectSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const meta = useCptStore((s) => s.projectMeta);
  const setMeta = useCptStore((s) => s.setProjectMeta);

  return (
    <Modal open={open} onClose={onClose} title="Projectinfo" width={560}>
      <form onSubmit={(e) => { e.preventDefault(); onClose(); }}>
        <Field label="Titel"        value={meta.title}          onChange={(v) => setMeta({ title: v })} />
        <Field label="Opdrachtgever" value={meta.client}         onChange={(v) => setMeta({ client: v })} />
        <Field label="Locatie"      value={meta.location}        onChange={(v) => setMeta({ location: v })} />
        <Field label="Projectnummer" value={meta.project_number} onChange={(v) => setMeta({ project_number: v })} />
        <Field label="Auteur"       value={meta.author}          onChange={(v) => setMeta({ author: v })} />
        <Field label="Datum" type="date" value={meta.date}       onChange={(v) => setMeta({ date: v })} />
        <button type="submit" className="btn-primary">Opslaan</button>
      </form>
    </Modal>
  );
}

function Field({ label, value, onChange, type = "text" }:
  { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={{ display: "block", fontSize: "0.875rem", marginBottom: 4 }}>{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} style={{ width: "100%" }} />
    </label>
  );
}
```

- [ ] **Step 4: Test end-to-end**

```bash
npm run tauri dev
```

Smoke test:
1. Open a sample GEF (e.g. `C:\Users\rickd\Documents\GitHub\verification-files\GEF-BRO-XML\voorbeeld.gef`)
2. Switch to Rapport tab
3. Click "Projectinfo", fill in some values, save
4. Switch to Rapport view (or stay on chart and use the Genereer PDF button in the ribbon)
5. Click "Genereer PDF", save to disk
6. Open the resulting PDF — should have cover + coordinate table + 1 page per CPT

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/
git commit -m "feat(app): PDF report generation via openaec-engine

Adds preview_report and generate_report Tauri commands wrapping cpt-core's
build_report and openaec-engine's generate_pdf_bytes. ReportView renders the
preview in an iframe via a blob URL; the Rapport ribbon tab triggers a save
dialog and writes to disk. ProjectSettingsDialog edits the title/client/
location/projectnumber/author/date metadata used in the PDF cover.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: CSV / GeoJSON export commands

**Files:**
- Create: `apps/desktop/src-tauri/src/commands/export.rs`
- Modify: `apps/desktop/src-tauri/src/commands/mod.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs` (register commands)
- Add two more buttons to StartTab's Export group (or extend Backstage with Export panel)

- [ ] **Step 1: Implement export commands**

Create `apps/desktop/src-tauri/src/commands/export.rs`:
```rust
//! Export commands: CSV per CPT, GeoJSON for multiple CPTs.

use tauri::State;
use crate::state::AppState;
use cpt_core::Cpt;

#[tauri::command]
pub fn export_csv(cpt_id: String, path: String, state: State<'_, AppState>) -> Result<(), String> {
    let cpts = state.cpts.lock().unwrap();
    let cpt = cpts.get(&cpt_id).ok_or("unknown CPT id")?;
    let mut s = String::new();
    s.push_str("depth,depth_nap,qc,fs,rf,u2,inclination\n");
    for p in &cpt.points {
        s.push_str(&format!(
            "{},{},{},{},{},{},{}\n",
            p.depth,
            p.depth_nap.map(|v| v.to_string()).unwrap_or_default(),
            p.qc.map(|v| v.to_string()).unwrap_or_default(),
            p.fs.map(|v| v.to_string()).unwrap_or_default(),
            p.rf.map(|v| v.to_string()).unwrap_or_default(),
            p.u2.map(|v| v.to_string()).unwrap_or_default(),
            p.inclination.map(|v| v.to_string()).unwrap_or_default(),
        ));
    }
    std::fs::write(path, s).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_geojson(cpt_ids: Vec<String>, path: String, state: State<'_, AppState>) -> Result<(), String> {
    use serde_json::{json, Value};
    let cpts = state.cpts.lock().unwrap();
    let mut features: Vec<Value> = Vec::new();
    for id in &cpt_ids {
        let Some(cpt) = cpts.get(id) else { continue };
        if let Some(pos) = cpt.position {
            let (lat, lon) = cpt_core::coords::rd_to_wgs84(pos.x_rd, pos.y_rd);
            features.push(json!({
                "type": "Feature",
                "properties": { "id": cpt.id, "z_nap": pos.z_nap, "max_depth": cpt.points.iter().map(|p| p.depth).fold(0.0_f64, f64::max) },
                "geometry": { "type": "Point", "coordinates": [lon, lat] }
            }));
        }
    }
    let fc = json!({ "type": "FeatureCollection", "features": features });
    std::fs::write(path, serde_json::to_string_pretty(&fc).unwrap()).map_err(|e| e.to_string())
}
```

Register in `mod.rs` + `lib.rs` as before.

- [ ] **Step 2: Hook up to Backstage Export panel**

In `apps/desktop/src/components/backstage/Backstage.tsx`, find the Export panel placeholder and wire the two buttons:
- "Export CSV (active CPT)" → save dialog → `invoke("export_csv", { cptId, path })`
- "Export GeoJSON (all CPTs)" → save dialog → `invoke("export_geojson", { cptIds, path })`

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/
git commit -m "feat(app): CSV and GeoJSON export commands

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Final polish — i18n completeness, README, rename GitHub repo

**Files:**
- Modify: `apps/desktop/src/i18n/locales/{nl,en}/*.json` — fill any remaining placeholders
- Modify: `README.md` (root)
- Optionally: `CLAUDE.md` (root)

- [ ] **Step 1: Audit i18n strings**

Run from `apps/desktop/`:
```bash
# Roughly scan for hardcoded Dutch/English strings in components
npx tsc --noEmit
```

(Better: use a string-extraction tool if installed. Otherwise, eyeball each component and move any literal user-facing string into `i18n/locales/nl/*.json` + the English counterpart.)

- [ ] **Step 2: Update root README**

Replace `README.md` (root):
```markdown
# Open GEO Studio

Open-source desktop application for working with Dutch CPT (Cone Penetration Test) data.

## Features

- Open GEF and BRO-XML CPT files (one or multiple at a time)
- Side-by-side chart visualization (qc, fs, Rf, u2 vs depth)
- Robertson 1990 SBT classification and layer detection
- PDOK BRO map integration (load CPT data by area)
- PDF report generation in OpenAEC house style
- CSV / GeoJSON export

## Architecture

- `apps/desktop/` — Tauri 2 + React 19 + TypeScript desktop app
- Domain logic in [`cpt-core`](https://github.com/OpenAEC-Foundation/crates-warehouse/tree/main/cpt-core) Rust crate
- PDF rendering via [`openaec-engine`](https://github.com/OpenAEC-Foundation/crates-warehouse/tree/main/openaec-engine)
- Design tokens from [OpenAEC Stijlbook](https://github.com/OpenAEC-Foundation/OpenAEC_stijlbook)

## Development

```bash
cd apps/desktop
npm install
npm run tauri dev    # dev mode (HMR)
npm run tauri build  # production build
```

## License

MIT
```

- [ ] **Step 3: Commit**

```bash
git add README.md apps/desktop/src/i18n/
git commit -m "docs: finalize README and i18n strings for Open GEO Studio v1

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Rename GitHub repo (manual step — out of band)**

Note in the commit log that the user should:
1. Rename the GitHub repo: `cpt-viewer` → `open-geo-studio` (Settings → General → Rename)
2. Update the local remote: `git remote set-url origin https://github.com/<owner>/open-geo-studio.git`

The rename preserves git history and most URLs (GitHub provides a redirect for the old name).

---

## Self-Review

After all tasks are done, check:

| Spec requirement | Task |
|---|---|
| App renamed to Open GEO Studio | Task 3 |
| Light default + dark optional theme | Inherited from template (SettingsDialog) |
| Ribbon tabs: Start, Kaart, Rapport | Task 6 |
| Open GEF + BRO-XML (multiple) | Tasks 4 + 6 |
| Chart canvas in TS | Task 7 |
| Robertson SBT classification UI | Tasks 7 + 8 |
| PDOK BRO map | Task 9 |
| PDF report generation (cover + coord table + per-CPT page) | Task 10 |
| CSV / GeoJSON export | Task 11 |
| i18n NL + EN | All tasks + Task 12 |
| Archive vanilla JS | Task 1 |

## Out of scope (deferred to v2)

- Custom user-uploadable tenants (deferred until OpenAEC tenant tooling is stable)
- Full BRO area search (`fetch_bro_area` returns empty list — only `fetch_bro_cpt` by id is wired)
- Bearing-capacity calculations
- Advisory-report editor with free-text sections
- Touch-screen / tablet support
- Linux / macOS builds (Windows-first; Tauri supports cross-build but not tested here)
