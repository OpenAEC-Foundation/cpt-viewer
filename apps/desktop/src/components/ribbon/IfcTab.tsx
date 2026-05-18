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
  // Subscribe to primitives separately — a single selector returning a
  // fresh object literal breaks Zustand v5's strict equality check and
  // produces "Maximum update depth exceeded" the moment the ribbon
  // shows this tab.
  const activeDocId = useCptStore((s) => s.activeDocId);
  const documents = useCptStore((s) => s.documents);
  const ifcCache = useCptStore((s) => s.ifcCache);
  const doc = activeDocId ? documents.find((d) => d.id === activeDocId) : undefined;
  const cached = doc ? ifcCache.get(doc.id) : undefined;
  const ifc4x3Ready = Boolean(cached?.ifc4x3);
  const ifcxReady = Boolean(cached?.ifcx);
  const cptCount = !doc
    ? 0
    : doc.kind === "cpt"
      ? 1
      : doc.kind === "project"
        ? doc.cpts.size
        : 0; // bore docs: IFC export not yet wired
  const hasContent = cptCount > 0;

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
