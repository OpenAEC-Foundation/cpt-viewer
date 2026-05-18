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

const copyIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ` +
  `d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>`;

const deleteIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ` +
  `d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V3a2 2 0 012-2h2a2 2 0 012 2v4"/></svg>`;

const moveIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ` +
  `d="M4 12h16m-8-8v16m-4-4l-4-4 4-4m8 8l4-4-4-4"/></svg>`;

const dispatch = (name: string, detail?: unknown) =>
  window.dispatchEvent(new CustomEvent(name, { detail }));

export default function SonderingstekeningTab() {
  const { t } = useTranslation("ribbon");

  return (
    <div className="ribbon-content">
      <div className="ribbon-groups">
        <RibbonGroup label={t("tekening.placeGroup", "Plaatsen")}>
          <RibbonButton
            icon={placeIcon}
            label={t("tekening.placeMode", "Sondering")}
            size="large"
            onClick={() => dispatch("ogs:tekening-toggle-place")}
          />
          <RibbonButton
            icon={rasterIcon}
            label={t("tekening.placeRaster", "Raster")}
            size="large"
            onClick={() => dispatch("ogs:tekening-place-raster")}
          />
          <RibbonButton
            icon={tagIcon}
            label={t("tekening.coordTag", "RD-tag")}
            size="large"
            onClick={() => dispatch("ogs:tekening-coord-tag")}
          />
        </RibbonGroup>

        <RibbonGroup label={t("tekening.editGroup", "Bewerken")}>
          <RibbonButton
            icon={copyIcon}
            label={t("tekening.copy", "Kopiëren")}
            size="large"
            onClick={() => dispatch("ogs:tekening-copy")}
          />
          <RibbonButton
            icon={moveIcon}
            label={t("tekening.moveLeft", "← 10m")}
            size="small"
            onClick={() => dispatch("ogs:tekening-move", { dx: -10, dy: 0 })}
          />
          <RibbonButton
            icon={moveIcon}
            label={t("tekening.moveRight", "10m →")}
            size="small"
            onClick={() => dispatch("ogs:tekening-move", { dx: 10, dy: 0 })}
          />
          <RibbonButton
            icon={moveIcon}
            label={t("tekening.moveUp", "↑ 10m")}
            size="small"
            onClick={() => dispatch("ogs:tekening-move", { dx: 0, dy: 10 })}
          />
          <RibbonButton
            icon={moveIcon}
            label={t("tekening.moveDown", "10m ↓")}
            size="small"
            onClick={() => dispatch("ogs:tekening-move", { dx: 0, dy: -10 })}
          />
          <RibbonButton
            icon={deleteIcon}
            label={t("tekening.delete", "Verwijder")}
            size="large"
            onClick={() => dispatch("ogs:tekening-delete")}
          />
        </RibbonGroup>

        <RibbonGroup label={t("tekening.overlayGroup", "Overlay")}>
          <RibbonButton
            icon={overlayIcon}
            label={t("tekening.addOverlay", "Toevoegen")}
            size="large"
            onClick={() => dispatch("ogs:tekening-add-overlay")}
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
