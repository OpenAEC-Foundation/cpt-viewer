import { useTranslation } from "react-i18next";
import { useCptStore } from "../store/useCptStore";
import "./StatusBar.css";

/**
 * Status bar — shows hovered CPT values on the right, opened-CPT count on the left.
 *
 * The chart canvas (`ChartCanvas`) calls `useCptStore().setHover(...)` on mouse
 * move; this component subscribes to that slice and re-renders.
 */
export default function StatusBar() {
  const { t } = useTranslation();
  const hovered = useCptStore((s) => s.hoveredPoint);
  const cptCount = useCptStore((s) => s.cpts.size);

  return (
    <div className="status-bar">
      <div className="status-bar-left">
        <div className="status-item">
          <span className="status-item-label">{t("sonderingen", "Sonderingen")}:</span>
          <span className="status-item-value">{cptCount}</span>
        </div>
      </div>

      <div className="status-bar-center" />

      <div className="status-bar-right">
        {hovered ? (
          <>
            <Field label="Diepte" value={hovered.depth.toFixed(2)} unit="m" />
            {hovered.depthNap != null && (
              <>
                <Sep />
                <Field label="NAP" value={hovered.depthNap.toFixed(2)} unit="m" />
              </>
            )}
            <Sep />
            <Field label="qc" value={hovered.qc?.toFixed(2)} unit="MPa" color="var(--domain-cpt-qc, #D97706)" />
            <Sep />
            <Field label="fs" value={hovered.fs?.toFixed(3)} unit="MPa" color="var(--domain-cpt-fs, #EA580C)" />
            <Sep />
            <Field label="Rf" value={hovered.rf?.toFixed(2)} unit="%" color="var(--domain-cpt-rf, #F59E0B)" />
            {hovered.u2 != null && (
              <>
                <Sep />
                <Field label="u2" value={hovered.u2.toFixed(3)} unit="MPa" color="var(--domain-cpt-u2, #2563EB)" />
              </>
            )}
            {hovered.soil && (
              <>
                <Sep />
                <span className="status-item-soil">{hovered.soil}</span>
              </>
            )}
          </>
        ) : (
          <span className="status-item-label" style={{ opacity: 0.5 }}>
            {t("hoverHint", "Houd muis op chart voor waarden")}
          </span>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, unit, color }: { label: string; value: string | undefined; unit: string; color?: string }) {
  return (
    <div className="status-item">
      <span className="status-item-label" style={color ? { color } : undefined}>{label}:</span>
      <span className="status-item-value">{value ?? "—"}</span>
      <span className="status-item-unit">{unit}</span>
    </div>
  );
}

function Sep() {
  return <span className="status-separator" />;
}
