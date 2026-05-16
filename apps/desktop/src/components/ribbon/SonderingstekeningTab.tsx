import { useTranslation } from "react-i18next";
import RibbonGroup from "./RibbonGroup";
import RibbonButton from "./RibbonButton";

/**
 * Sonderingstekening ribbon — the actual paper/scale/tools controls
 * live in the view's own topbar (so the user sees them in context),
 * but the ribbon still surfaces the most-used commands for muscle
 * memory: Print, Add overlay, and a quick toggle for placement mode.
 *
 * The view listens for the global events dispatched by these buttons
 * so we don't have to prop-drill the active drawing state up.
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

export default function SonderingstekeningTab() {
  const { t } = useTranslation("ribbon");

  return (
    <div className="ribbon-content">
      <div className="ribbon-groups">
        <RibbonGroup label={t("tekening.info", "Tekening")}>
          <div className="ribbon-info-block">
            <div className="ribbon-info-title">
              {t("tekening.titleHint", "Sonderingstekening")}
            </div>
            <div className="ribbon-info-sub">
              {t(
                "tekening.subHint",
                "Configureer papier en schaal in de werkbalk hieronder. Sleep PDF/JPG/SVG op het papier voor een overlay.",
              )}
            </div>
          </div>
        </RibbonGroup>
        <RibbonGroup label={t("tekening.placeGroup", "Plaatsen")}>
          <RibbonButton
            icon={placeIcon}
            label={t("tekening.placeMode", "Sondering")}
            size="large"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("ogs:tekening-toggle-place"))
            }
          />
        </RibbonGroup>
        <RibbonGroup label={t("tekening.overlayGroup", "Overlay")}>
          <RibbonButton
            icon={overlayIcon}
            label={t("tekening.addOverlay", "Toevoegen")}
            size="large"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("ogs:tekening-add-overlay"))
            }
          />
        </RibbonGroup>
        <RibbonGroup label={t("tekening.exportGroup", "Export")}>
          <RibbonButton
            icon={printIcon}
            label={t("tekening.exportPdf", "PDF")}
            size="large"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("ogs:tekening-print"))
            }
          />
        </RibbonGroup>
      </div>
    </div>
  );
}
