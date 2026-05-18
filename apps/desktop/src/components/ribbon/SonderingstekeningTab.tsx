import { useTranslation } from "react-i18next";
import RibbonGroup from "./RibbonGroup";
import RibbonButton from "./RibbonButton";

/**
 * Sonderingstekening ribbon — full toolset.
 *
 * Everything that used to live in the view's right-hand toolbox now lives
 * here: place a sondering, place a raster, drop an RD-coordinate tag,
 * copy / delete / nudge a selected object, and export PDF. The view
 * listens for the global events these buttons dispatch (see the
 * `ogs:tekening-*` handlers) so the ribbon stays purely declarative.
 */

const printIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ` +
  `d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4H7v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>`;

const placeIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ` +
  `d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.244-4.243a8 8 0 1111.314 0zM15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`;

const overlayIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ` +
  `d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>`;

const rasterIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<g stroke-linecap="round" stroke-linejoin="round" stroke-width="2">` +
  `<rect x="3" y="3" width="18" height="18" rx="1"/>` +
  `<path d="M9 3v18M15 3v18M3 9h18M3 15h18"/></g></svg>`;

const tagIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ` +
  `d="M7 7h.01M7 3h5a2 2 0 011.414.586l8 8a2 2 0 010 2.828l-8 8a2 2 0 01-2.828 0l-8-8A2 2 0 013 12V7a4 4 0 014-4z"/></svg>`;

// ── Bewerken-icons (select / move / copy / delete) ────────────────
// Heroicons-style strokes that match the rest of the ribbon. The Bewerken
// group is back — Open PDF Studio / Open 2D Studio convention is to have
// these four edit acties (selecteren, verplaatsen, kopiëren, verwijderen)
// always one klik away regardless of which sub-tool the user picked.
const moveIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ` +
  `d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/></svg>`;

// Roteer-icon — een ronde pijl die 270° om een centrum buigt (open
// aan de bovenkant). Heroicons "arrow-path" stijl.
const rotateIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ` +
  `d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>`;

const copyIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ` +
  `d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-2M8 5a2 2 0 002 2h6a2 2 0 002-2M8 5a2 2 0 012-2h6a2 2 0 012 2m0 0h2a2 2 0 012 2v3a2 2 0 01-2 2h-2"/></svg>`;

const deleteIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ` +
  `d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V3a2 2 0 012-2h2a2 2 0 012 2v4"/></svg>`;

// Select / cursor — arrow icon for the default pick tool.
const selectIcon =
  `<svg fill="currentColor" viewBox="0 0 24 24">` +
  `<path d="M3 2 L3 18 L8 14 L11 21 L13.5 20 L10.5 13 L17 13 Z" />` +
  `</svg>`;

// Vrije lijn — simpel slash van linksonder naar rechtsboven.
const lineIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<path stroke-linecap="round" stroke-width="2" d="M4 20L20 4"/></svg>`;

// Maatlijn — horizontale lijn met uiteinde-tikken (┤───┤).
const dimensionIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<path stroke-linecap="round" stroke-width="2" d="M3 12h18M5 8v8M19 8v8"/></svg>`;

// Freeze viewport heeft geen ribbon-knop meer — alleen het vinkje in
// TekeningProperties (rechter eigenschappen-paneel) bedient hem nu.

const dispatch = (name: string, detail?: unknown) =>
  window.dispatchEvent(new CustomEvent(name, { detail }));

export default function SonderingstekeningTab() {
  const { t } = useTranslation("ribbon");

  return (
    <div className="ribbon-content">
      <div className="ribbon-groups">
        <RibbonGroup label={t("tekening.selectGroup", "Selecteer")}>
          <RibbonButton
            icon={selectIcon}
            label={t("tekening.selectMode", "Selecteren")}
            size="large"
            onClick={() => dispatch("ogs:tekening-select-mode")}
          />
        </RibbonGroup>

        <RibbonGroup label={t("tekening.editGroup", "Bewerken")}>
          <RibbonButton
            icon={moveIcon}
            label={t("tekening.moveSelection", "Verplaatsen")}
            size="small"
            title={t(
              "tekening.moveHint",
              "Pijltjestoetsen verplaatsen 1 m (Shift = 5 m)",
            )}
            onClick={() =>
              dispatch("ogs:tekening-move", { dx: 1, dy: 0 })
            }
          />
          <RibbonButton
            icon={copyIcon}
            label={t("tekening.copySelection", "Kopiëren")}
            size="small"
            title={t("tekening.copyHint", "Dupliceer naast het geselecteerde object (Ctrl+D)")}
            onClick={() => dispatch("ogs:tekening-copy")}
          />
          <RibbonButton
            icon={rotateIcon}
            label={t("tekening.rotateCcw", "Roteer -90°")}
            size="small"
            title={t("tekening.rotateCcwHint", "Draai geselecteerd object 90° tegen de klok in")}
            onClick={() => dispatch("ogs:tekening-rotate", { deg: -90 })}
          />
          <RibbonButton
            icon={rotateIcon}
            label={t("tekening.rotateCw", "Roteer +90°")}
            size="small"
            title={t("tekening.rotateCwHint", "Draai geselecteerd object 90° met de klok mee")}
            onClick={() => dispatch("ogs:tekening-rotate", { deg: 90 })}
          />
          <RibbonButton
            icon={deleteIcon}
            label={t("tekening.deleteSelection", "Verwijderen")}
            size="small"
            title={t("tekening.deleteHint", "Verwijder het geselecteerde object (Delete)")}
            onClick={() => dispatch("ogs:tekening-delete")}
          />
        </RibbonGroup>

        <RibbonGroup label={t("tekening.placeGroup", "Plaatsen")}>
          <RibbonButton
            icon={placeIcon}
            label={t("tekening.placeMode", "Sondering")}
            size="large"
            onClick={() => dispatch("ogs:tekening-toggle-place")}
          />
          <RibbonButton
            icon={placeIcon}
            label={t("tekening.placeBore", "Boring")}
            size="large"
            onClick={() => dispatch("ogs:tekening-toggle-place-bore")}
          />
          <RibbonButton
            icon={rasterIcon}
            label={t("tekening.placeRaster", "Sonderingsraster")}
            size="large"
            onClick={() => dispatch("ogs:tekening-place-raster")}
          />
          <RibbonButton
            icon={lineIcon}
            label={t("tekening.drawLine", "Lijn")}
            size="large"
            onClick={() => dispatch("ogs:tekening-draw-line")}
          />
          <RibbonButton
            icon={dimensionIcon}
            label={t("tekening.drawDim", "Maatlijn")}
            size="large"
            onClick={() => dispatch("ogs:tekening-draw-dimension")}
          />
          <RibbonButton
            icon={tagIcon}
            label={t("tekening.coordTag", "RD-coördinaat")}
            size="large"
            onClick={() => dispatch("ogs:tekening-coord-tag")}
          />
        </RibbonGroup>

        <RibbonGroup label={t("tekening.overlayGroup", "Overlay")}>
          <RibbonButton
            icon={overlayIcon}
            label={t("tekening.addOverlay", "Image/PDF import")}
            size="large"
            onClick={() => dispatch("ogs:tekening-add-overlay")}
          />
          <RibbonButton
            icon={overlayIcon}
            label={t("tekening.loadFrame", "Kader (SVG)")}
            size="large"
            onClick={() => dispatch("ogs:tekening-load-frame")}
          />
          <RibbonButton
            icon={deleteIcon}
            label={t("tekening.clearAll", "Wis alles")}
            size="small"
            onClick={() => dispatch("ogs:tekening-clear-all")}
          />
        </RibbonGroup>

        <RibbonGroup label={t("tekening.exportGroup", "Export")}>
          <RibbonButton
            icon={printIcon}
            label={t("tekening.exportPdf", "PDF")}
            size="large"
            onClick={() => dispatch("ogs:tekening-print")}
          />
        </RibbonGroup>
      </div>
    </div>
  );
}
