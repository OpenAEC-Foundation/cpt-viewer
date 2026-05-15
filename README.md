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
