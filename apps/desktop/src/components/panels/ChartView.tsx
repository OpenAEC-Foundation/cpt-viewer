import { useTranslation } from "react-i18next";
import { useCptStore } from "../../store/useCptStore";
import ChartCanvas from "../chart/ChartCanvas";
import BoreView from "./BoreView";

/**
 * Main chart panel. Routes between three states:
 *   - empty placeholder when nothing is open
 *   - BoreView when the active document is a borehole (BHR-GT)
 *   - ChartCanvas when the active document is a CPT or project
 *
 * Borings don't have qc/fs/Rf curves, only a strip log of soil layers,
 * so they need their own viewer instead of an empty chart canvas.
 */
export default function ChartView() {
  const { t } = useTranslation("cpt");
  const cpts = useCptStore((s) => s.cpts);
  const activeDocId = useCptStore((s) => s.activeDocId);
  const documents = useCptStore((s) => s.documents);
  const activeDoc = activeDocId ? documents.find((d) => d.id === activeDocId) : undefined;

  if (activeDoc?.kind === "bore") {
    return <BoreView bore={activeDoc.bore} />;
  }
  if (cpts.size === 0) {
    return (
      <div className="placeholder">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
        </svg>
        <h2>{t("noCptOpenTitle", "Geen sondering geopend")}</h2>
        <p>{t("noCptOpenHint", "Open een GEF of BRO-XML bestand om te beginnen.")}</p>
      </div>
    );
  }
  return <ChartCanvas />;
}
