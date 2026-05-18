# Open Geotechniek Studio v0.2.0

First public release with the full Dutch geotechnical workflow — open
sonderingen and boringen, draw plans, generate reports, all from one
desktop app. MIT-licensed, no telemetry, no subscription.

## Installeren (Windows)

Download het bestand `Open Geotechniek Studio_0.2.0_x64-setup.exe` uit
de bijlagen onder deze release, en dubbelklik om te installeren. De
installer registreert `.gef`, `.ifcgis` en `.ifcgeo` als bestands­types
in Verkenner — dubbelklikken opent het bestand direct in de app, met
huisstijl-iconen per type.

> Onder macOS / Linux is voorlopig geen pre-built binary beschikbaar;
> de bronkern is volledig portable, maar je moet zelf builden met
> `npm run tauri build` in `apps/desktop/`.

---

## Wat is nieuw sinds v0.1.0

### Bestandstypes

- **GEF en BRO-XML** worden out of the box geopend via drag-drop, het
  bestandsmenu of dubbelklikken in Verkenner.
- **BHR-O, BHR-G-O en BHR-GT-O boringen** (Bodemkundig / Geologisch /
  Geotechnisch) krijgen een eigen `BoreView` strip-log met diepteas,
  gekleurde lithologie-bandjes, hoogte t.o.v. NAP, en chips voor
  nevenlagen (bijmenging, brokken, veenresten, humus, kalk, rijping,
  structuur, horizont).
- **`.ifcgis`** project-bestanden (multi-CPT) en **`.ifcgeo`**
  single-CPT IFCX-uitwisseling — eigen iconen, automatisch geopend
  in een nieuw tabblad.

### Chart (Home tab)

- **Robertson SBT-classificatie** met de bekende 9 zones en
  bijbehorende Dutch namen (Klei, Zand mengsels, Zeer vast zand/klei, …).
- **Multi-CPT vergelijking met NAP-uitlijning** — meerdere
  sonderingen naast elkaar op dezelfde maaiveldhoogte.
- **As-labels op laddergrid** — qc bij 5/10/15/20/25 MPa op default
  zoom, 1/2/3/4 wanneer ingezoomd. Geen scheve "0…27" meer.
- **Wrijvingsgetal (Rf) gespiegeld** weergegeven volgens Nederlandse
  conventie: hoog links, laag rechts.
- **SBT-kolom rechts** — depth | qc | fs | Rf | (u2) | SBT.
- **Hover-tooltip** met de naam van de actieve grondlaag, plus
  numerieke waarden bij elke cursor-positie.
- **Maaiveld op startdiepte van de sondering** — geen voorgebakken
  positie meer voor sonderingen die op b.v. 1.5 m beginnen na
  voorboring.
- **Meerdere blauwe referentielijnen**: dubbelklik om er een toe te
  voegen, sleep verticaal, rechtsklik om te verwijderen.

### Kaart

- **PDOK-lagen**: BRT topografie, Luchtfoto actueel + per jaar 2016–2025
  (geverifieerd tegen WMTSCapabilities, zoals `2021_orthoHR` voor
  jaar 2021), AHN hoogtekaart met legenda (blue→red ramp), Topotijdreis
  historische kaarten 1815–2015.
- **BAG gebouwen via WFS** als grijze vlakken (rgb 192/192/192) met
  rode omlijning.
- **Kadastrale grenzen via WFS** met dashed center-line patroon.
- **BGT topografie** als WMTS-tile.
- **Live BRO** — sonderingen (lichtrood, vallen op tegen achtergrond)
  en boringen (rondjes), automatisch geladen bij elke pan/zoom met
  debounce + abort-on-pan.
- **Per-laag toggle + 0–100 % transparantie-slider**.
- **Meet-tool** tussen twee sonderingen of vrije punten.
- **Klik-op-BRO-marker** → "Open in viewer" springt direct naar
  Home tab met de sondering of boring geopend.
- **Topotijdreis-slider** als checkbox (aan/uit) + jaartal-slider met
  ticks, transparantie en de spring-naar-laatste knop.

### Sonderingstekening

- **A2/A3 papier** met gekozen schaal (1:500 – 1:5000), real-scale
  geo-fitted in Leaflet.
- **Dezelfde GisLayerPanel sidebar** als de Kaart — alle base/overlay
  lagen, opacity-sliders en Topotijdreis aanvinken werkt op beide
  views tegelijk.
- **Inherit van Kaart-positie** — switchen naar Sonderingstekening
  centreert direct op de locatie die je net in Kaart bekeek.
- **Sondering-raster als dynamisch object**: onafhankelijke X/Y
  spacing via hoek-handles, edge-midpoints om te verplaatsen, grote
  amber rotation-button om press-and-hold te roteren. Drag-state ref
  voorkomt dat React-rerenders de Leaflet drag-gesture om zeep helpen.
- **RD-coordinaat tag** — klik om een label te plaatsen met x/y RD
  (klik label om te verwijderen).
- **Beeld-overlay (PDF/JPG/SVG/DWG)** drag-droppable; image/SVG
  schalen mee met de map-zoom via `L.imageOverlay` met opgegeven
  real-world width.
- **OpenAEC Detailblad title block** — project-bar, logo-cel, 2×4
  metadata-grid (Datum/Wijz./Schaal/Formaat/Projectnr/Auteur/Kenmerk/
  Blad), format-corner. Op basis van `OpenAEC-style-book/preview-titleblock.html`
  pagina 2.
- **Move + Copy ribbon-knoppen** voor de geselecteerde sondering of
  raster.
- **Delete-toets** verwijdert de selectie (form-input-safe).

### Rapport

- **Voorblad gerestyled** naar de OpenAEC Foundation referentie:
  70 % dark zone met blueprint-hatch + city-skyline silhouette,
  amber wordmark links + tagline, `openaec.org` rechts, twee pill-
  badges (OPEN SOURCE + ENGINEERING), 36 pt project-titel + subtitle
  in de witte strip + compact metadata-blok.
- **Live preview** in de Rapport tab (iframe), met sidebar voor
  section-toggles.
- **Achtergrond-rendering**: `preview_report` is nu `async` en draait
  in `tauri::async_runtime::spawn_blocking` zodat de runtime niet
  blokkeert. JS-zijde heeft per-doc debounce + globale seriële queue
  (latest-wins) — 4 sonderingen tegelijk openen is niet meer
  CPU-saturated.

### IFC

- **IFC4x3 + IFCX automatisch gegenereerd** in de achtergrond,
  zichtbaar in de IFC tab als twee panelen (STEP boven, JSON onder).
- Geen "Genereer" knop meer — gewoon laatst-actuele output.
- IFC ribbon-tab nu helemaal **rechts** (workflow: Home → Kaart →
  Rapport → Sonderingstekening → IFC).
- Infinite-loop bug in `IfcView` + `IfcTab` selectors gefixed (Zustand
  v5 strict-equality check op verse object-literals).

### Open / save

- **Open** in het backstage-menu opent direct de native bestandsdialoog
  (geen tussenstap meer).
- **Recente bestanden** verschijnen als compacte lijst direct onder
  de Open menu-item.
- **Save-as** voor CPT-bestanden ondersteunt GEF, BRO-XML en `.ifcgeo`
  format-conversie.
- **Project save/open** als `.ifcgis` (IFCX-flavored JSON).
- **File associations** registered tijdens installatie via NSIS hook,
  met per-extensie iconen (gef.ico, ifcgis.ico, ifcgeo.ico) en
  Explorer-icon-cache refresh zodat ze direct zichtbaar zijn.

### UI

- **Vierkant logo** (geen hexagon meer) in titlebar, welcome screen,
  app-iconen, wordmark.
- **Home** als naam voor de eerste tab (was: Start).
- **Open-with** support: dubbelklik op `.gef` / `.ifcgis` / `.ifcgeo`
  in Verkenner opent het bestand direct in de app via CLI-arg
  forwarding.

## Bekende beperkingen

- macOS en Linux installer/AppImage zijn niet meegebouwd in deze
  release.
- DWG/DXF import in de sonderingstekening is gestubbed — alleen de
  bestandsnaam wordt herkend, parser komt eraan.
- IFC4x3 (STEP) output is een placeholder; volle IFC4x3 mapping volgt.
- `single-instance` voor double-click-while-running staat nog uit —
  een nieuw bestand opent vooralsnog in een tweede app-window.

## Pad voor v0.3.0

- Single-instance window-forwarding voor "open with" terwijl de app
  draait.
- DWG / DXF parser (gebaseerd op Open 2D Studio).
- Volledige IFC4x3 mapping voor de geotechnische klasse.
- macOS DMG en Linux AppImage in CI.

---

🛠️ MIT-licentie · geen telemetry · geen vendor lock-in
📂 Repo: <https://github.com/OpenAEC-Foundation/cpt-viewer>
