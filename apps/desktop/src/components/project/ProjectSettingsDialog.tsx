import { useTranslation } from "react-i18next";
import Modal from "../Modal";
import { useCptStore } from "../../store/useCptStore";

interface ProjectSettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Dialog for editing the project metadata used on the PDF cover page.
 *
 * Fields are bound directly to the `projectMeta` slice of `useCptStore`;
 * a re-render of the report preview happens automatically because
 * `ReportPreview` watches the same slice.
 */
export default function ProjectSettingsDialog({ open, onClose }: ProjectSettingsDialogProps) {
  const { t } = useTranslation("cpt");
  const meta = useCptStore((s) => s.projectMeta);
  const setMeta = useCptStore((s) => s.setProjectMeta);

  return (
    <Modal open={open} onClose={onClose} title={t("projectInfo", "Projectinfo")} width={560}>
      <form onSubmit={(e) => { e.preventDefault(); onClose(); }}>
        <Field label={t("title", "Titel")}
               value={meta.title}
               onChange={(v) => setMeta({ title: v })} />
        <Field label={t("client", "Opdrachtgever")}
               value={meta.client}
               onChange={(v) => setMeta({ client: v })} />
        <Field label={t("location", "Locatie")}
               value={meta.location}
               onChange={(v) => setMeta({ location: v })} />
        <Field label={t("projectNumber", "Projectnummer")}
               value={meta.project_number}
               onChange={(v) => setMeta({ project_number: v })} />
        <Field label={t("author", "Auteur")}
               value={meta.author}
               onChange={(v) => setMeta({ author: v })} />
        <Field type="date"
               label={t("date", "Datum")}
               value={meta.date}
               onChange={(v) => setMeta({ date: v })} />
        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onClose}>{t("cancel", "Annuleer")}</button>
          <button type="submit" className="btn-primary">{t("save", "Opslaan")}</button>
        </div>
      </form>
    </Modal>
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
