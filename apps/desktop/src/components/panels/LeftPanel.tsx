import { Fragment, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { useCptStore, addCptToActiveProject } from "../../store/useCptStore";
import type { BoreDocument } from "../../store/useCptStore";
import type { Cpt, Layer } from "../../types/cpt";
import type { Bore } from "../../types/bore";

/**
 * Document-aware left panel.
 *
 * - When the active document is a ProjectDocument, renders the project
 *   browser (project meta + sondering tree + per-CPT details).
 * - When the active document is a CptDocument, renders just the per-CPT
 *   metadata / layers / measurements (no project tree).
 * - When no doc is active, renders a quiet empty state.
 */
export default function LeftPanel() {
  const { t } = useTranslation("cpt");
  const documents = useCptStore((s) => s.documents);
  const activeDocId = useCptStore((s) => s.activeDocId);
  const activeDoc = useMemo(
    () => documents.find((d) => d.id === activeDocId),
    [documents, activeDocId],
  );

  if (!activeDoc) {
    return (
      <div className="left-panel-body">
        <p className="panel-empty" style={{ padding: "12px 10px" }}>{t("noCpts")}</p>
      </div>
    );
  }

  if (activeDoc.kind === "project") {
    return <ProjectBrowser />;
  }
  if (activeDoc.kind === "bore") {
    return <BoreDetails doc={activeDoc} />;
  }
  return <CptDetails cpt={activeDoc.cpt} />;
}

// ──────────────────────────────────────────────────────────────
// Standalone Boring (active doc = BoreDocument)
// ──────────────────────────────────────────────────────────────

function BoreDetails({ doc }: { doc: BoreDocument }) {
  const b = doc.bore;
  return (
    <div className="left-panel-body">
      <div className="project-header">
        <div className="project-header-icon"><FileIcon /></div>
        <div className="project-header-text">
          <div className="project-header-title">{b.id || doc.title}</div>
          <div className="project-header-sub">{b.metadata.source_file}</div>
        </div>
      </div>

      <PanelSection title="Boringsgegevens" defaultOpen>
        <BoreMetadataList bore={b} />
      </PanelSection>
      <PanelSection title="Bestandsmetadata">
        <BoreExtraList bore={b} />
      </PanelSection>
      <PanelSection title="Lagen" defaultOpen>
        <BoreLayersList bore={b} />
      </PanelSection>
      <PanelSection title="Ruwe data (XML)">
        <BoreRawXml xml={doc.rawXml} />
      </PanelSection>
    </div>
  );
}

function BoreMetadataList({ bore }: { bore: Bore }) {
  const m = bore.metadata;
  return (
    <dl className="metadata-list">
      <dt>Boring-ID</dt><dd>{bore.id || "—"}</dd>
      <dt>Project</dt><dd>{m.project_name ?? "—"}</dd>
      <dt>Projectnr</dt><dd>{m.project_number ?? "—"}</dd>
      <dt>Bronhouder</dt><dd>{m.accountable_party ?? "—"}</dd>
      <dt>Startdatum</dt><dd>{m.start_date ?? "—"}</dd>
      <dt>Einddatum</dt><dd>{m.end_date ?? "—"}</dd>
      <dt>Beschrijfdatum</dt><dd>{m.description_date ?? "—"}</dd>
      <dt>Kwaliteitsregime</dt><dd>{m.quality_regime ?? "—"}</dd>
      <dt>Beschrijfprocedure</dt><dd>{m.description_procedure ?? "—"}</dd>
      <dt>Boormethode</dt><dd>{m.bore_method ?? "—"}</dd>
      <dt>Levering</dt><dd>{m.delivered_via ?? "—"}</dd>
      <dt>RD x/y</dt>
      <dd>
        {bore.position
          ? `${bore.position.x_rd.toFixed(1)}, ${bore.position.y_rd.toFixed(1)}`
          : "—"}
      </dd>
      <dt>Maaiveld NAP</dt>
      <dd>
        {typeof bore.position?.z_nap === "number"
          ? `${bore.position.z_nap.toFixed(2)} m`
          : "—"}
      </dd>
      <dt>Eindiepte</dt>
      <dd>
        {typeof bore.final_depth === "number"
          ? `${bore.final_depth.toFixed(2)} m`
          : "—"}
      </dd>
      <dt>Aantal lagen</dt><dd>{bore.layers.length}</dd>
    </dl>
  );
}

/** Verbatim BHR-veld → waarde map. Bewust ongefilterd zodat zeldzame
 *  velden (boordiameter, peilbuis-info, organische-stofklasse) ook
 *  zichtbaar zijn. */
function BoreExtraList({ bore }: { bore: Bore }) {
  const extra = bore.metadata.extra ?? {};
  const entries = Object.entries(extra);
  if (entries.length === 0) {
    return <p className="panel-empty">Geen aanvullende metadata.</p>;
  }
  return (
    <dl className="metadata-list metadata-list-extra">
      {entries.map(([k, v]) => (
        <Fragment key={k}>
          <dt title={k}>{k}</dt>
          <dd>{v}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

/** Beknopte tabel met de geïnterpreteerde lagen. De volledige strip-log
 *  staat in BoreView; deze tabel is voor snel scannen vanuit de
 *  verkenner. */
function BoreLayersList({ bore }: { bore: Bore }) {
  if (bore.layers.length === 0) {
    return <p className="panel-empty">Geen lagen.</p>;
  }
  return (
    <table className="layers-table">
      <thead>
        <tr>
          <th>Top</th>
          <th>Basis</th>
          <th>Grondsoort</th>
        </tr>
      </thead>
      <tbody>
        {bore.layers.map((l, i) => (
          <tr key={i}>
            <td>{l.top_depth.toFixed(2)}</td>
            <td>{l.base_depth.toFixed(2)}</td>
            <td title={l.description}>{l.soil_name}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Read-only viewer voor het origineel BHR-XML. Geen syntax-highlight
 *  voor de eenvoud — wel een copy-knop en monospace font zodat de
 *  inspringing leesbaar blijft. */
function BoreRawXml({ xml }: { xml?: string }) {
  const [copied, setCopied] = useState(false);
  if (!xml) {
    return <p className="panel-empty">Geen ruwe XML beschikbaar.</p>;
  }
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(xml);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard refused — silent */
    }
  };
  return (
    <div className="bore-raw-wrap">
      <button
        type="button"
        className="bore-raw-copy"
        onClick={() => void onCopy()}
      >
        {copied ? "Gekopieerd" : "Kopieer XML"}
      </button>
      <pre className="bore-raw-pre">{xml}</pre>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Project browser (active doc = ProjectDocument)
// ──────────────────────────────────────────────────────────────

function ProjectBrowser() {
  const { t } = useTranslation("cpt");
  const documents = useCptStore((s) => s.documents);
  const activeDocId = useCptStore((s) => s.activeDocId);
  const setActiveCpt = useCptStore((s) => s.setActive);
  const closeCpt = useCptStore((s) => s.closeCpt);
  const hiddenCptIds = useCptStore((s) => s.hiddenCptIds);
  const toggleHidden = useCptStore((s) => s.toggleHidden);

  // Re-fetch the active project doc on each render so we react to its mutations.
  const project = useMemo(() => {
    const d = documents.find((d) => d.id === activeDocId);
    return d?.kind === "project" ? d : null;
  }, [documents, activeDocId]);

  if (!project) return null;

  const cpts = Array.from(project.cpts.values());
  const activeCptId = project.activeCptId;
  const active = activeCptId ? project.cpts.get(activeCptId) : undefined;

  async function addSonderingen() {
    const selected = await openDialog({
      multiple: true,
      filters: [{ name: "CPT (GEF / BRO-XML)", extensions: ["gef", "GEF", "xml", "XML"] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    for (const p of paths) {
      try {
        const content = await readTextFile(p);
        const filename = p.split(/[\\/]/).pop() ?? p;
        await addCptToActiveProject(content, filename);
      } catch (err) {
        console.error("addSonderingen: failed for", p, err);
      }
    }
  }

  return (
    <div className="left-panel-body">
      {/* Project header */}
      <div className="project-header">
        <div className="project-header-icon">
          <FolderIcon />
        </div>
        <div className="project-header-text">
          <div className="project-header-title">{project.meta.title || t("noTitle", "(geen titel)")}</div>
          {project.meta.client && <div className="project-header-sub">{project.meta.client}</div>}
        </div>
      </div>

      <PanelSection
        title={
          <>
            {t("sonderingen")}
            <span className="ps-count">({cpts.length})</span>
          </>
        }
        defaultOpen
        action={
          <button
            type="button"
            className="panel-section-add"
            onClick={(e) => { e.stopPropagation(); void addSonderingen(); }}
            title={t("addCpt", "Sondering toevoegen")}
            aria-label={t("addCpt", "Sondering toevoegen")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        }
      >
        {cpts.length === 0 ? (
          <p className="panel-empty">{t("noCptsHint", "Geen sonderingen — klik + om toe te voegen of sleep bestanden in het venster")}</p>
        ) : (
          <ul className="cpt-list">
            {cpts.map((c) => {
              const isHidden = hiddenCptIds.has(c.id);
              const liClass = [
                c.id === activeCptId ? "active" : "",
                isHidden ? "hidden" : "",
              ].filter(Boolean).join(" ");
              return (
                <li key={c.id} className={liClass}>
                  <button className="cpt-list-name" onClick={() => setActiveCpt(c.id)} title={c.metadata.source_file}>
                    <FileIcon />
                    <span>{c.id}</span>
                  </button>
                  <button
                    type="button"
                    className={`cpt-list-eye${isHidden ? " is-hidden" : ""}`}
                    onClick={(e) => { e.stopPropagation(); toggleHidden(c.id); }}
                    aria-label={isHidden ? t("show", "Tonen") : t("hide", "Verbergen")}
                    title={isHidden ? t("show", "Tonen") : t("hide", "Verbergen")}
                  >
                    {isHidden ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                  <button className="cpt-list-close" onClick={() => void closeCpt(c.id)} aria-label={t("close")}>×</button>
                </li>
              );
            })}
          </ul>
        )}
      </PanelSection>

      {active && (
        <>
          <PanelSection title={t("sonderingsgegevens")} defaultOpen>
            <MetadataList cpt={active} />
          </PanelSection>
          <PanelSection title={t("fileMetadata", "Bestandsmetadata")}>
            <ExtraMetadataList cpt={active} />
          </PanelSection>
          <PanelSection title={t("layers")} defaultOpen>
            <LayersTable cptId={active.id} />
          </PanelSection>
          <PanelSection title={t("measurements")}>
            <MeasurementsTable cpt={active} />
          </PanelSection>
        </>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Standalone CPT (active doc = CptDocument)
// ──────────────────────────────────────────────────────────────

function CptDetails({ cpt }: { cpt: Cpt }) {
  const { t } = useTranslation("cpt");
  return (
    <div className="left-panel-body">
      <div className="project-header">
        <div className="project-header-icon"><FileIcon /></div>
        <div className="project-header-text">
          <div className="project-header-title">{cpt.id}</div>
          <div className="project-header-sub">{cpt.metadata.source_file}</div>
        </div>
      </div>

      <PanelSection title={t("sonderingsgegevens")} defaultOpen>
        <MetadataList cpt={cpt} />
      </PanelSection>
      <PanelSection title={t("fileMetadata", "Bestandsmetadata")}>
        <ExtraMetadataList cpt={cpt} />
      </PanelSection>
      <PanelSection title={t("layers")} defaultOpen>
        <LayersTable cptId={cpt.id} />
      </PanelSection>
      <PanelSection title={t("measurements")}>
        <MeasurementsTable cpt={cpt} />
      </PanelSection>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Reusable sub-components
// ──────────────────────────────────────────────────────────────

function PanelSection({
  title, defaultOpen = false, children, action,
}: {
  title: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="panel-section">
      <div className="panel-section-header-row">
        <button className="panel-section-header" onClick={() => setOpen(!open)}>
          <span className={`panel-section-chevron${open ? " open" : ""}`}>▾</span>
          <span className="panel-section-title">{title}</span>
        </button>
        {action}
      </div>
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

/**
 * Renders every entry of `metadata.extra` (verbatim file metadata) as a
 * dt/dd row. Falls back to an empty-state placeholder when the parser
 * didn't surface any extras (eg. minimal GEF files).
 *
 * Keys are stored ALL-CAPS for GEF (`COMPANYID`) and camelCase for BRO
 * (`coneSurfaceQuotient`) — we render them as-is to keep the mapping
 * traceable; a future iteration can title-case + translate on demand.
 */
function ExtraMetadataList({ cpt }: { cpt: Cpt }) {
  const { t } = useTranslation("cpt");
  const extra = cpt.metadata.extra ?? {};
  const entries = Object.entries(extra);
  if (entries.length === 0) {
    return <p className="panel-empty">{t("noExtras", "Geen aanvullende metadata.")}</p>;
  }
  return (
    <dl className="metadata-list metadata-list-extra">
      {entries.map(([k, v]) => (
        <Fragment key={k}>
          <dt title={k}>{k}</dt>
          <dd>{v}</dd>
        </Fragment>
      ))}
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
          <tr>
            <th title="Diepte onder maaiveld">diepte</th>
            <th title="Diepte t.o.v. NAP">m NAP</th>
            <th>qc</th><th>fs</th><th>Rf</th>
          </tr>
        </thead>
        <tbody>
          {slice.map((p, i) => (
            <tr key={start + i}>
              <td>{p.depth.toFixed(2)}</td>
              <td>{p.depth_nap != null ? p.depth_nap.toFixed(2) : "—"}</td>
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

function FileIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
