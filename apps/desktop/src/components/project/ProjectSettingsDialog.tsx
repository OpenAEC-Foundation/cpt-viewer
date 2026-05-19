import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import Modal from "../Modal";
import {
  useCptStore,
  addCptToActiveProject,
  addBoreToActiveProject,
  removeBoreFromActiveProject,
  newProjectDocument,
} from "../../store/useCptStore";

interface ProjectSettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Project setup dialog — only meaningful when the active document is a
 * ProjectDocument. Edits the project metadata used on the PDF cover and
 * manages the list of CPTs that belong to the project.
 *
 * If the active doc is a CptDocument (or there is no active doc), the
 * dialog renders a hint explaining that there is no project active.
 */
export default function ProjectSettingsDialog({ open, onClose }: ProjectSettingsDialogProps) {
  const { t } = useTranslation("cpt");
  const documents = useCptStore((s) => s.documents);
  const activeDocId = useCptStore((s) => s.activeDocId);
  const activeDoc = useMemo(
    () => documents.find((d) => d.id === activeDocId),
    [documents, activeDocId],
  );
  const setMeta = useCptStore((s) => s.setProjectMeta);
  const closeCpt = useCptStore((s) => s.closeCpt);

  const isProject = activeDoc?.kind === "project";
  const meta = isProject ? activeDoc.meta : null;
  const cpts = useMemo(
    () => (isProject ? Array.from(activeDoc.cpts.values()) : []),
    [isProject, activeDoc],
  );
  const bores = useMemo(
    () => (isProject ? Array.from(activeDoc.bores.values()) : []),
    [isProject, activeDoc],
  );

  async function addCpts() {
    const selected = await openDialog({
      multiple: true,
      filters: [{ name: "CPT", extensions: ["gef", "GEF", "xml", "XML"] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    for (const p of paths) {
      try {
        const content = await readTextFile(p);
        const filename = p.split(/[\\/]/).pop() ?? p;
        await addCptToActiveProject(content, filename);
      } catch (err) {
        console.error("addCpts: failed to open", p, err);
      }
    }
  }

  function removeAllCpts() {
    if (!isProject) return;
    const ids = Array.from(activeDoc.cpts.keys());
    for (const id of ids) void closeCpt(id);
  }

  /**
   * Open BHR-GT XML-bestanden en voeg ze als boring aan het project
   * toe. Faalt stilletjes per bestand (log naar console) zodat één
   * bad-XML niet de hele batch om zeep helpt.
   */
  async function addBores() {
    const selected = await openDialog({
      multiple: true,
      filters: [{ name: "BHR-GT XML", extensions: ["xml", "XML"] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    for (const p of paths) {
      try {
        const content = await readTextFile(p);
        const filename = p.split(/[\\/]/).pop() ?? p;
        await addBoreToActiveProject(content, filename);
      } catch (err) {
        console.error("addBores: failed to open", p, err);
      }
    }
  }

  function removeAllBores() {
    if (!isProject) return;
    const ids = Array.from(activeDoc.bores.keys());
    for (const id of ids) removeBoreFromActiveProject(id);
  }

  return (
    <Modal open={open} onClose={onClose} title={t("projectInfo", "Projectinfo")} width={640}>
      {!isProject ? (
        <NoProjectHint
          onClose={onClose}
          onCreate={() => {
            newProjectDocument();
            // Keep the dialog open so the user can immediately edit the new
            // project; the active doc has just switched to it.
          }}
        />
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); onClose(); }}>
          {/* Geen extra "Projectinfo"-header hier — die staat al in de
              modal-titelbalk; dubbel tonen ziet er onverzorgd uit. */}
          <Field label={t("title", "Titel")}
                 value={meta!.title}
                 onChange={(v) => setMeta({ title: v })} />
          <Field label={t("client", "Opdrachtgever")}
                 value={meta!.client}
                 onChange={(v) => setMeta({ client: v })} />
          <Field label={t("location", "Locatie")}
                 value={meta!.location}
                 onChange={(v) => setMeta({ location: v })} />
          <Field label={t("projectNumber", "Projectnummer")}
                 value={meta!.project_number}
                 onChange={(v) => setMeta({ project_number: v })} />
          <Field label={t("author", "Auteur")}
                 value={meta!.author}
                 onChange={(v) => setMeta({ author: v })} />
          <Field type="date"
                 label={t("date", "Datum")}
                 value={meta!.date}
                 onChange={(v) => setMeta({ date: v })} />

          <div className="ps-section-header">
            <h3 className="ps-section-title">
              {t("cptsInProject", "Sonderingen in dit project")}
              <span className="ps-count">({cpts.length})</span>
            </h3>
            <div className="ps-section-actions">
              {cpts.length > 0 && (
                <button type="button" className="ps-link-btn"
                        onClick={removeAllCpts}>
                  {t("removeAll", "Verwijder alle")}
                </button>
              )}
              <button type="button" className="ps-add-btn"
                      onClick={() => void addCpts()}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                <span>{t("addCpt", "Sondering toevoegen")}</span>
              </button>
            </div>
          </div>

          {cpts.length === 0 ? (
            <div className="ps-empty">
              <p>{t("noCptsHint", "Nog geen sonderingen toegevoegd. Klik op 'Sondering toevoegen' of sleep GEF/BRO-XML bestanden in het venster.")}</p>
            </div>
          ) : (
            <ul className="ps-cpt-list">
              {cpts.map((c) => (
                <li key={c.id} className="ps-cpt-item">
                  <div className="ps-cpt-info">
                    <span className="ps-cpt-id">{c.id}</span>
                    <span className="ps-cpt-meta">
                      {c.points.length} punten · {(c.points.reduce((m, p) => Math.max(m, p.depth), 0)).toFixed(1)} m diepte
                      {c.position && ` · RD ${c.position.x_rd.toFixed(0)}, ${c.position.y_rd.toFixed(0)}`}
                    </span>
                  </div>
                  <button type="button" className="ps-remove-btn"
                          onClick={() => void closeCpt(c.id)}
                          aria-label={t("remove", "Verwijder")}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Boringen-sectie — analoog aan sonderingen, accept .xml
              (BHR-GT). Boring-id + diepte als meta-regel. */}
          <div className="ps-section-header">
            <h3 className="ps-section-title">
              {t("boresInProject", "Boringen in dit project")}
              <span className="ps-count">({bores.length})</span>
            </h3>
            <div className="ps-section-actions">
              {bores.length > 0 && (
                <button type="button" className="ps-link-btn"
                        onClick={removeAllBores}>
                  {t("removeAll", "Verwijder alle")}
                </button>
              )}
              <button type="button" className="ps-add-btn"
                      onClick={() => void addBores()}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                <span>{t("addBore", "Boring toevoegen")}</span>
              </button>
            </div>
          </div>

          {bores.length === 0 ? (
            <div className="ps-empty">
              <p>{t("noBoresHint", "Nog geen boringen toegevoegd. Klik op 'Boring toevoegen' om BHR-GT XML te importeren.")}</p>
            </div>
          ) : (
            <ul className="ps-cpt-list">
              {bores.map((b) => {
                const layerCount = b.layers?.length ?? 0;
                // base_depth (NEN-conventie) = onderkant van de laag;
                // diepste laag geeft totale boordiepte. Optioneel
                // valt het terug op b.final_depth als die er is.
                const maxDepth =
                  b.layers && b.layers.length > 0
                    ? Math.max(...b.layers.map((l) => l.base_depth ?? 0))
                    : (b.final_depth ?? 0);
                return (
                  <li key={b.id} className="ps-cpt-item">
                    <div className="ps-cpt-info">
                      <span className="ps-cpt-id">{b.id}</span>
                      <span className="ps-cpt-meta">
                        {layerCount} lagen · {maxDepth.toFixed(1)} m diepte
                        {b.position && ` · RD ${b.position.x_rd.toFixed(0)}, ${b.position.y_rd.toFixed(0)}`}
                      </span>
                    </div>
                    <button type="button" className="ps-remove-btn"
                            onClick={() => removeBoreFromActiveProject(b.id)}
                            aria-label={t("remove", "Verwijder")}>
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="ps-footer">
            <button type="button" onClick={onClose}>{t("cancel", "Annuleer")}</button>
            <button type="submit" className="btn-primary">{t("save", "Opslaan")}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function NoProjectHint({ onClose, onCreate }: { onClose: () => void; onCreate: () => void }) {
  return (
    <div style={{ padding: "16px 4px" }}>
      <p style={{ margin: 0, marginBottom: 12, color: "var(--theme-text)" }}>
        Geen project actief — open of maak een <code>.ifcx</code> project.
      </p>
      <p style={{ margin: 0, marginBottom: 20, color: "var(--theme-text-muted)", fontSize: "0.9rem" }}>
        De huidige actieve tab is een losse sondering. Projectinfo (titel,
        opdrachtgever, locatie, sonderingenlijst) leeft binnen een project —
        maak er een aan of open een bestaand <code>.ifcx</code> bestand.
      </p>
      <div className="ps-footer">
        <button type="button" onClick={onClose}>Sluiten</button>
        <button type="button" className="btn-primary" onClick={onCreate}>
          Nieuw project
        </button>
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}

function Field({ label, value, onChange, type = "text" }: FieldProps) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={{ display: "block", fontSize: "0.875rem", marginBottom: 4 }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          padding: "8px 12px",
          border: "1px solid var(--theme-border, #D6D3D1)",
          borderRadius: 8,
          fontFamily: "var(--font-ui, Inter)",
          fontSize: "0.875rem",
          background: "var(--theme-input-bg, #fff)",
          color: "var(--theme-text, inherit)",
          boxSizing: "border-box",
        }}
      />
    </label>
  );
}
