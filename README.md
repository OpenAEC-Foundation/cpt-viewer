# Open GEO Studio

Open-source desktop application for working with Dutch CPT (Cone Penetration Test) data.

## Features

- Open GEF and BRO-XML CPT files (multiple at a time)
- Side-by-side chart visualization (qc, fs, Rf, u2 vs depth)
- Robertson 1990 SBT classification with layer detection
- PDOK BRO map integration (click marker → load CPT)
- PDF report generation in OpenAEC house style (cover + coordinate table + 1 page per CPT)
- CSV (per CPT) and GeoJSON (all locations) export
- Light + dark themes, NL/EN UI

## Architecture

- `apps/desktop/` — Tauri 2 + React 19 + TypeScript desktop app
- Domain logic in [`cpt-core`](https://github.com/OpenAEC-Foundation/crates-warehouse/tree/main/cpt-core) Rust crate (GEF + BRO-XML parsers, Robertson, layers, RD↔WGS84, SVG plot, report builder)
- PDF rendering via [`openaec-core`](https://github.com/OpenAEC-Foundation/crates-warehouse/tree/main/openaec-core) + [`openaec-engine`](https://github.com/OpenAEC-Foundation/crates-warehouse/tree/main/openaec-engine)
- Design tokens from [OpenAEC Stijlbook](https://github.com/OpenAEC-Foundation/OpenAEC_stijlbook)
- The previous vanilla-JS web viewer is preserved in `_archive/vanilla-js/`

## Development

Prerequisites: Rust toolchain, Node.js 20+, npm. The Tauri prerequisites for Windows / macOS / Linux are documented at https://v2.tauri.app/start/prerequisites/.

```bash
cd apps/desktop
npm install
npm run tauri dev    # dev mode (HMR)
npm run tauri build  # production build
```

The Rust path dependencies in `apps/desktop/src-tauri/Cargo.toml` assume the
sibling repos:
- `crates-warehouse/` at the same level as this repo (for `cpt-core`, `openaec-core`, `openaec-engine`)

## License

MIT
