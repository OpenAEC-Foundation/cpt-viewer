# Open Geotechniek Studio

Open-source desktop-applicatie voor geotechnische werkzaamheden in Nederland — sonderingen, boringen, projecten, en situatietekeningen op één CAD-papier.

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-lightgrey)
![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB)

---

## Downloads

Pre-built installers via de [Releases-pagina](https://github.com/OpenAEC-Foundation/open-geotechniek-studio/releases):

| Platform | Bestand |
|---|---|
| **Windows 10/11** | `Open Geotechniek Studio_x.y.z_x64-setup.exe` (NSIS, per-machine) |
| **Linux (Debian/Ubuntu)** | `open-geotechniek-studio_x.y.z_amd64.deb` |
| **Linux (overige distro's)** | `open-geotechniek-studio_x.y.z_amd64.AppImage` (portable) |

Builds worden automatisch gepubliceerd via [GitHub Actions](.github/workflows/release.yml) bij elke `v*`-tag.

---

## Wat kun je ermee

### Sonderingen inlezen & visualiseren
- **GEF 1.x** (`.gef`) en **BRO XML** (`CPT_O`/`CPT_O_DP`, dispatchService v1.1) parsers
- Live grafiek met **conusweerstand (qc)**, **plaatselijke wrijving (fs, cap 0.05 MPa)**, **wrijvingsgetal (Rf)** en **waterspanning (u2)** door qc heen
- **Robertson 1990 SBT-classificatie** met automatische laagdetectie + kleurstrook
- Y-as in NAP (m) met schone veelvouden (0 / -5 / -10 / -15 / …)
- Sonderingen in tabs naast elkaar; klikken op een laag in de explorer scrolt mee
- **Boringen (BHR-GT XML)** als aparte tabs

### Kaart-tab
- PDOK-basislagen (BRT, luchtfoto actueel + jaarlagen 2016-2025), BAG-gebouwen, Kadastrale grenzen, Adressen + straten, Bestemmingsplan, BGT-topografie, BRO-sonderingen/-boringen
- Standaard centreert op je projectlocatie, anders Lange Geldersekade 2 (Dordrecht)
- **Live meet-tool**: na de eerste klik volgt een gestreepte preview met meters tot je de tweede klik plaatst
- BRO-sondering klikken → meteen openen of toevoegen aan actief project

### Situatietekening (CAD-paper)
- Vast A2- of A3-papier (default **A3, 1:500**) met 10mm zwarte CAD-rand
- **Auto-fit**: bij navigeren naar een project met sonderingen springt schaal + center automatisch naar de kleinste preset (500 / 1000 / 2000 / 5000) waar alle sonderingen passen
- Iteratieve schaal-convergence — 1:500 betekent **echt** 1:500 (binnen 0.001%)
- **Sonderingen/boringen plaatsen** met optioneel kleefmeting-symbool (horizontale streep onder de driehoek)
- **Sonderingsraster** met sleepbare hoek-handles voor variabele rij × kolom × spacing
- **Lijnen + maatlijnen** met automatische afstand-label (m/cm), **lijn-kleur-picker** per geselecteerde lijn
- **RD-coördinaat-tags** met leader-lijn naar het exacte punt
- **Image/PDF-overlay** als achtergrond: selecteerbaar, schaalbaar (hoek-handles), draaibaar, naar voor/achtergrond
- **Trim / Extend / Mirror / Offset** CAD-edit-tools op lijnen
- **Snap-systeem**: vertex/edge-snap op BAG-gebouwen, kadastrale grenzen, geplaatste sonderingen, project-CPTs, lijn-endpoints, en coord-tags (12px threshold)
- **Ortho-mode** (Shift bij 2e klik) — lijn-hoek snapt naar 45°-veelvouden
- **Move-shortcuts** (Revit-style **M** / Blender-style **G**): selectie volgt cursor, klik commit, Esc cancelt
- **Freeze-modus** + paper-zoom: bevries de map-zoom, scroll-wheel zoomt het hele papier (incl. kader)
- Schaalbalk in stappen van 5 meter (0 / 5 / 10 / 15 / …) en grote noordpijl
- Titleblock met projectinfo (klikbaar in-place edit), bewerkbare schaal-cel, logo-upload

### Rapport (PDF-export)
- Voorblad + coördinatentabel + overzichtskaart + 1 pagina per sondering
- Robertson SBT-legenda + metadata-overzicht (optioneel)
- Schaalbare assen: qc 0-30, fs 0-0.05 MPa (gecapped), Rf 0-10% (gecapped + overflow-note bij pieken)
- u2 (waterspanning) als cyaan stippellijn door qc heen
- Verticale scheidslijn tussen Qc/Fs-band en Rf-band over volle hoogte
- Maaiveld-pijl + hatching, NAP-grid op 5m intervallen

### Export & integratie
- **CSV** per sondering, **GeoJSON** voor alle locaties tegelijk
- **Tauri file-associations** voor `.gef`, `.xml`, `.ifcgeo` — dubbelklik bestand opent direct in de app
- **`.ifcgeo`** is dé extensie voor zowel losse sonderingen als hele projecten (IFC5-alpha JSON). Bevat — bij een project — de hele staat: sonderingen, tekening, title-block, layer-config; round-trips compleet. Loader sniffed de schema-header om project vs single-CPT te onderscheiden. `.ifcgis` en `.ifcx` blijven leesbaar voor legacy-bestanden.
- **GEF-export** volledig BRO IMBRO-A conform (passt GEFPlotTool 5.1 validator)
- **Offertes opvragen**: dialog die de 3 dichtstbijzijnde sondeerbedrijven toont + automatische mailto-offerte-aanvraag
- **Feedback-knop** opent direct een GitHub issue

---

## Architectuur

```
cpt-viewer/                                ← deze repo
├── apps/desktop/                          ← Tauri 2 + React 19 + Vite 7 + TS 5.9
│   ├── src/                               ← frontend (panels, ribbons, store, chart-renderer)
│   └── src-tauri/                         ← Rust IPC commands + bundle config
└── .github/workflows/release.yml          ← cross-platform CI (Win + Linux installers)

crates-warehouse/                          ← sibling repo, path-dependency
├── cpt-core/                              ← GEF + BRO parsers, Robertson, layers,
│                                            RD↔WGS84, SVG plot, PDF report
├── openaec-core/  +  openaec-engine/      ← PDF/font rendering (gedeeld met andere OpenAEC apps)
└── openaec-layout/                        ← document-template (cover, page, table primitives)
```

Design-tokens komen uit het [OpenAEC Stijlbook](https://github.com/OpenAEC-Foundation/OpenAEC_stijlbook).

---

## Bouw zelf

### Vereisten
- [Node.js 22 LTS](https://nodejs.org/) + npm
- [Rust stable](https://www.rust-lang.org/tools/install)
- [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) voor je platform (op Linux: `libwebkit2gtk-4.1-dev`, `librsvg2-dev`, `patchelf`, etc.)
- De `crates-warehouse` repo gecloned als **sibling-folder** naast deze repo (`../crates-warehouse`)

```bash
git clone https://github.com/OpenAEC-Foundation/crates-warehouse.git
git clone https://github.com/OpenAEC-Foundation/open-geotechniek-studio.git
cd open-geotechniek-studio/apps/desktop
npm install
```

### Development
```bash
npm run tauri dev    # HMR, opent app-venster, ~45s eerste start
```

### Production installer (lokaal)
```bash
npm run tauri build  # output in src-tauri/target/release/bundle/
```
Op Windows produceert dit een NSIS-installer (`.exe`). Op Linux krijg je `.deb` + `.AppImage`. Cross-platform builds doe je via de [GitHub Actions workflow](.github/workflows/release.yml).

### Release
1. Bump versie in `apps/desktop/package.json` + `apps/desktop/src-tauri/tauri.conf.json`
2. `git tag v0.3.0 && git push origin v0.3.0`
3. GitHub Actions bouwt Windows + Linux installers + maakt automatisch een GitHub Release met de installers als download

Of: handmatige run via Actions → "Release — Tauri cross-platform installers" → Run workflow.

---

## Bijdragen

Issues + PR's welkom. Voor grotere features: open eerst een issue zodat we de scope kunnen afstemmen. Stijlboek-conventies volgen we strikt — design-changes moeten matchen met het [OpenAEC Stijlbook](https://github.com/OpenAEC-Foundation/OpenAEC_stijlbook).

De feedback-knop in de app (rechtsboven) opent direct een GitHub issue met auto-context.

---

## License

[MIT](LICENSE) — vrij te gebruiken voor commerciële en niet-commerciële projecten.

---

## Credits

Onderdeel van het [OpenAEC Foundation](https://github.com/OpenAEC-Foundation)-ecosysteem.

Sondering- en boringdata via [PDOK](https://www.pdok.nl/) ([BRT](https://www.pdok.nl/-/brt-achtergrondkaart), [Luchtfoto](https://www.pdok.nl/-/luchtfotos-pdok), [BAG](https://www.pdok.nl/-/bag), [Kadaster](https://www.pdok.nl/-/kadastrale-kaart-v5), [Ruimtelijkeplannen](https://www.pdok.nl/-/ruimtelijke-plannen)) en [BRO](https://basisregistratieondergrond.nl/) (Basisregistratie Ondergrond / TNO Geologische Dienst).
