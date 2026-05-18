# Open Geotechniek Studio v0.2.1

Hotfix + kleine UX-toevoegingen op v0.2.0.

## Installeren

Download `Open Geotechniek Studio_0.2.1_x64-setup.exe` uit de bijlagen
en dubbelklik.

> **v0.2.0-gebruikers**: deze release fixt de "WebView2Loader.dll
> wordt niet gevonden"-fout. De installer plaatst de loader nu zelf
> naast de .exe in `$INSTDIR\` — geen handmatige WebView2 runtime
> installatie meer nodig.

## Wijzigingen sinds v0.2.0

### Bug fixes

- **WebView2Loader.dll wordt nu meegebakken** in de installer. Een
  vendored kopie zit onder `src-tauri/vendor/`; NSIS bundlet 'm via
  `bundle.resources` en kopieert 'm in `NSIS_HOOK_POSTINSTALL` van
  `$INSTDIR\resources\vendor\` naar `$INSTDIR\` zodat de .exe 'm vindt
  bij start. Op uninstall wordt 'm netjes opgeruimd.

### Kaart

- **Adres-zoekbalk** linksboven met PDOK Locatieserver suggest + lookup.
  Type minimaal 2 tekens → autocomplete dropdown met straten,
  woonplaatsen, perceel-IDs etc. Enter / klik → `flyTo` naar de centroid
  (zoom 19 voor adressen, zoom 14 voor woonplaatsen). Esc sluit, ✕
  knop wist het veld. Volledig keyboard-navigable (↑/↓ door
  suggesties).
- **BRO refetch op `zoomend`** — los van de `moveend` debounce. Bij
  inzoomen worden de sondering-markers nu direct opnieuw opgehaald
  voor de nieuwe (kleinere) bounding box, geen wachttijd. Ook BAG en
  Kadaster WFS-overlays komen direct mee.
- **Auto-fit bij Kaart openen** als er een project of sondering open
  is — `fittedDocIdRef` triggert een `fitBounds` op MapView mount én
  op project-switch, zodat de markers direct in beeld komen zonder
  handmatig zoeken.

### Chart

- **Soil-laag tooltip naar links uitgelijnd** zodat 'ie niet meer
  achter het rechtse LocationMiniMap-paneel verdwijnt als de muis
  rechts in de chart staat. `transform: translateX(-100%)` om 'm
  volledig links van de cursor te tonen.

---

🛠️ MIT-licentie · geen telemetry · geen vendor lock-in
📂 Repo: <https://github.com/OpenAEC-Foundation/cpt-viewer>
