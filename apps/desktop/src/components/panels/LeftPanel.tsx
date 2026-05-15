import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useCptStore } from "../../store/useCptStore";
import type { Cpt, Layer } from "../../types/cpt";

export default function LeftPanel() {
  const { t } = useTranslation("cpt");
  const cpts = useCptStore((s) => Array.from(s.cpts.values()));
  const activeId = useCptStore((s) => s.activeCptId);
  const active = useCptStore((s) => (s.activeCptId ? s.cpts.get(s.activeCptId) : undefined));
  const setActive = useCptStore((s) => s.setActive);
  const closeCpt = useCptStore((s) => s.closeCpt);

  return (
    <div className="left-panel-body">
      <PanelSection title={t("sonderingen")} defaultOpen>
        {cpts.length === 0 ? (
          <p className="panel-empty">{t("noCpts")}</p>
        ) : (
          <ul className="cpt-list">
            {cpts.map((c) => (
              <li key={c.id} className={c.id === activeId ? "active" : ""}>
                <button className="cpt-list-name" onClick={() => setActive(c.id)} title={c.metadata.source_file}>
                  {c.id}
                </button>
                <button className="cpt-list-close" onClick={() => void closeCpt(c.id)} aria-label={t("close")}>×</button>
              </li>
            ))}
          </ul>
        )}
      </PanelSection>

      <PanelSection title={t("sonderingsgegevens")} defaultOpen>
        {active ? <MetadataList cpt={active} /> : <p className="panel-empty">—</p>}
      </PanelSection>

      <PanelSection title={t("layers")} defaultOpen>
        <LayersTable cptId={active?.id ?? null} />
      </PanelSection>

      <PanelSection title={t("measurements")}>
        <MeasurementsTable cpt={active ?? null} />
      </PanelSection>
    </div>
  );
}

function PanelSection({ title, defaultOpen = false, children }:
  { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="panel-section">
      <button className="panel-section-header" onClick={() => setOpen(!open)}>
        <span className={`panel-section-chevron${open ? " open" : ""}`}>▾</span>
        <span className="panel-section-title">{title}</span>
      </button>
      {open && <div className="panel-section-body">{children}</div>}
    </div>
  );
}

function MetadataList({ cpt }: { cpt: Cpt }) {
  const { t } = useTranslation("cpt");
  return (
    <dl className="metadata-list">
      <dt>{t("projectName")}</dt><dd>{cpt.metadata.project_name ?? "—"}</dd>
      <dt>{t("projectNumber")}</dt><dd>{cpt.metadata.project_number ?? "—"}</dd>
      <dt>{t("date")}</dt><dd>{cpt.metadata.date ?? "—"}</dd>
      <dt>{t("equipment")}</dt><dd>{cpt.metadata.equipment ?? "—"}</dd>
      <dt>{t("groundLevel")}</dt><dd>{cpt.metadata.ground_level_nap?.toFixed(2) ?? "—"} m NAP</dd>
      <dt>{t("position")}</dt>
      <dd>{cpt.position ? `${cpt.position.x_rd.toFixed(1)}, ${cpt.position.y_rd.toFixed(1)}` : "—"}</dd>
    </dl>
  );
}

function LayersTable({ cptId }: { cptId: string | null }) {
  const { t } = useTranslation("cpt");
  const [layers, setLayers] = useState<Layer[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cptId) { setLayers([]); return; }
    setError(null);
    invoke<Layer[]>("detect_layers", { id: cptId })
      .then(setLayers)
      .catch((e) => setError(String(e)));
  }, [cptId]);

  if (!cptId) return <p className="panel-empty">—</p>;
  if (error) return <p className="panel-error">{error}</p>;
  if (layers.length === 0) return <p className="panel-empty">{t("noLayers")}</p>;
  return (
    <table className="layers-table">
      <thead>
        <tr><th>{t("top")}</th><th>{t("bottom")}</th><th>{t("zone")}</th></tr>
      </thead>
      <tbody>
        {layers.map((l, i) => (
          <tr key={i}>
            <td>{l.depth_top.toFixed(2)}</td>
            <td>{l.depth_bottom.toFixed(2)}</td>
            <td>
              <span className="layer-swatch" style={{ background: l.zone_color }} />
              {l.zone_number}. {l.zone_name}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MeasurementsTable({ cpt }: { cpt: Cpt | null }) {
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;
  if (!cpt) return <p className="panel-empty">—</p>;
  const total = cpt.points.length;
  const start = page * PAGE_SIZE;
  const slice = cpt.points.slice(start, start + PAGE_SIZE);
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  return (
    <div>
      <table className="measurements-table">
        <thead>
          <tr><th>diepte</th><th>qc</th><th>fs</th><th>Rf</th></tr>
        </thead>
        <tbody>
          {slice.map((p, i) => (
            <tr key={start + i}>
              <td>{p.depth.toFixed(2)}</td>
              <td>{p.qc?.toFixed(2) ?? "—"}</td>
              <td>{p.fs?.toFixed(3) ?? "—"}</td>
              <td>{p.rf?.toFixed(2) ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pagination">
        <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>‹</button>
        <span>{start + 1}–{Math.min(start + PAGE_SIZE, total)} / {total}</span>
        <button onClick={() => setPage(p => Math.min(lastPage, p + 1))} disabled={page >= lastPage}>›</button>
      </div>
    </div>
  );
}
