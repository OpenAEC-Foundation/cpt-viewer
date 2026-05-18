; NSIS installer hooks — Open Geotechniek Studio
;
; Tauri 2.x's `fileAssociations` block doesn't expose a per-extension
; `icon` field, so the default NSIS template uses the main app icon
; for every registered extension. We override that here by writing
; `HKCR\<ProgID>\DefaultIcon` to our per-type .ico files (bundled via
; `bundle.resources` and installed alongside the .exe under
; `$INSTDIR\resources\icons\file-associations\`).
;
; Macros to add custom install / uninstall actions:
;   - NSIS_HOOK_POSTINSTALL  → runs at the very end of install
;   - NSIS_HOOK_PREUNINSTALL → runs at the start of uninstall
;
; Both ProgIDs are the `name` we used in tauri.conf.json's
; `fileAssociations[].name`.

!macro NSIS_HOOK_POSTINSTALL
  ; ── GEF sondering files ────────────────────────────────────────
  WriteRegStr SHCTX "Software\Classes\GEFSondering\DefaultIcon" "" \
    "$INSTDIR\resources\icons\file-associations\gef.ico,0"

  ; ── .ifcgis Open Geotechniek Studio projects ───────────────────
  WriteRegStr SHCTX "Software\Classes\OpenGeoStudioProject\DefaultIcon" "" \
    "$INSTDIR\resources\icons\file-associations\ifcgis.ico,0"

  ; ── .ifcgeo single-CPT IFCX exchange files ─────────────────────
  WriteRegStr SHCTX "Software\Classes\GeotechniekObject\DefaultIcon" "" \
    "$INSTDIR\resources\icons\file-associations\ifcgeo.ico,0"

  ; Refresh the Explorer icon cache so the new icons appear without
  ; a logout/login cycle.
  System::Call 'shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Clean up our custom DefaultIcon entries on uninstall — Tauri's
  ; own uninstaller already drops the ProgID itself.
  DeleteRegKey SHCTX "Software\Classes\GEFSondering\DefaultIcon"
  DeleteRegKey SHCTX "Software\Classes\OpenGeoStudioProject\DefaultIcon"
  DeleteRegKey SHCTX "Software\Classes\GeotechniekObject\DefaultIcon"
!macroend
