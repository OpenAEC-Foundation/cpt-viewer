import { useTranslation } from "react-i18next";
import RibbonGroup from "./RibbonGroup";
import { useCptStore } from "../../store/useCptStore";

/**
 * IFC ribbon tab — informational only.
 *
 * IFC4x3 + IFCX are now generated automatically in the background
 * whenever a project opens or its CPT list changes (see
 * `scheduleIfcGenerate` in useCptStore). The user never needs to push
 * "Genereer" — the IfcView always shows the latest live output. This
 * ribbon tab therefore has no actionable buttons; it just confirms
 * the auto-generation status for the active doc.
 */
export default function IfcTab() {
  const { t } = useTranslation("ribbon");
  const { ifc4x3Ready, ifcxReady, hasContent } = useCptStore((s) => {
    const doc = s.documents.find((d) => d.id === s.activeDocId);
    if (!doc) return { ifc4x3Ready: false, ifcxReady: false, hasContent: false };
    const cached = s.ifcCache.get(doc.id);
    const cptCount = doc.kind === "cpt" ? 1 : doc.cpts.size;
    return {
      ifc4x3Ready: Boolean(cached?.ifc4x3),
      ifcxReady: Boolean(cached?.ifcx),
      hasContent: cptCount > 0,
    };
  });

  let statusLabel: string;
  if (!hasContent) {
    statusLabel = t("ifc.autoNoCpt", "Geen sonderingen — voeg eerst toe");
  } else if (ifc4x3Ready && ifcxReady) {
    statusLabel = t("ifc.autoReady", "Live — IFC4x3 + IFCX");
  } else {
    statusLabel = t("ifc.autoGenerating", "Bezig met genereren...");
  }

  return (
    <div className="ribbon-content">
      <div className="ribbon-groups">
        <RibbonGroup label={t("ifc.autoGroup", "Automatisch gegenereerd")}>
          <div className="ribbon-info-block">
            <div className="ribbon-info-title">{statusLabel}</div>
            <div className="ribbon-info-sub">
              {t(
                "ifc.autoHint",
                "IFC4x3 en IFCX worden live bijgewerkt zodra sonderingen veranderen.",
              )}
            </div>
          </div>
        </RibbonGroup>
      </div>
    </div>
  );
}
