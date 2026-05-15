import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getSetting, setSetting } from "../../store";
import "./ProjectSettingsDialog.css";

interface ProjectSettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

export interface ProjectInfo {
  name: string;
  projectNumber: string;
  engineer: string;
  company: string;
  date: string;
  description: string;
  notes: string;
  location: string;
  latitude?: number;
  longitude?: number;
}

interface ErpProject {
  name: string;
  project_name: string;
  customer: string;
  status: string;
}

const emptyProject: ProjectInfo = {
  name: "",
  projectNumber: "",
  engineer: "",
  company: "",
  date: new Date().toISOString().slice(0, 10),
  description: "",
  notes: "",
  location: "",
};

export default function ProjectSettingsDialog({ open, onClose }: ProjectSettingsDialogProps) {
  const { t } = useTranslation("common");
  const [project, setProject] = useState<ProjectInfo>(emptyProject);
  const [erpEnabled, setErpEnabled] = useState(false);
  const [erpUrl, setErpUrl] = useState("");
  const [erpSearch, setErpSearch] = useState("");
  const [erpResults, setErpResults] = useState<ErpProject[]>([]);
  const [erpLoading, setErpLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    getSetting<ProjectInfo>("projectInfo", emptyProject).then(setProject);
    getSetting("erpNextUrl", "").then(setErpUrl);
    getSetting("erpNextEnabled", false).then(setErpEnabled);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const updateField = (field: keyof ProjectInfo, value: string) => {
    setProject((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    await setSetting("projectInfo", project);
    await setSetting("erpNextUrl", erpUrl);
    await setSetting("erpNextEnabled", erpEnabled);
    onClose();
  };

  const handleErpSearch = async () => {
    if (!erpUrl || !erpSearch.trim()) return;
    setErpLoading(true);
    try {
      const res = await fetch(
        `${erpUrl}/api/resource/Project?filters=[["status","=","Open"],["name","like","%${erpSearch}%"]]&fields=["name","project_name","customer","status"]&limit_page_length=10`,
        { headers: { "Content-Type": "application/json" } }
      );
      if (res.ok) {
        const data = await res.json();
        setErpResults(data.data || []);
      }
    } catch {
      setErpResults([]);
    } finally {
      setErpLoading(false);
    }
  };

  const handleErpSelect = (ep: ErpProject) => {
    setProject((prev) => ({
      ...prev,
      name: ep.project_name || ep.name,
      projectNumber: ep.name,
      company: ep.customer || prev.company,
    }));
    setErpResults([]);
    setErpSearch("");
  };

  return (
    <div className="proj-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="proj-dialog">
        <div className="proj-header">
          <h2>{t("projectSettings.title")}</h2>
          <button className="proj-close" onClick={onClose}>&times;</button>
        </div>

        <div className="proj-body">
          {/* ERPNext Integration */}
          <div className="proj-section">
            <div className="proj-section-title">
              <label className="proj-toggle">
                <input type="checkbox" checked={erpEnabled} onChange={(e) => setErpEnabled(e.target.checked)} />
                {t("projectSettings.erpNext")}
              </label>
            </div>

            {erpEnabled && (
              <div className="proj-erp-section">
                <div className="proj-field">
                  <label>{t("projectSettings.erpUrl")}</label>
                  <input
                    type="url"
                    value={erpUrl}
                    onChange={(e) => setErpUrl(e.target.value)}
                    placeholder="https://erp.example.com"
                  />
                </div>
                <div className="proj-field proj-erp-search">
                  <label>{t("projectSettings.erpSearch")}</label>
                  <div className="proj-erp-search-row">
                    <input
                      type="text"
                      value={erpSearch}
                      onChange={(e) => setErpSearch(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleErpSearch()}
                      placeholder={t("projectSettings.erpSearchPlaceholder")}
                    />
                    <button className="proj-erp-search-btn" onClick={handleErpSearch} disabled={erpLoading}>
                      {erpLoading ? "..." : t("search")}
                    </button>
                  </div>
                  {erpResults.length > 0 && (
                    <div className="proj-erp-results">
                      {erpResults.map((ep) => (
                        <button key={ep.name} className="proj-erp-result" onClick={() => handleErpSelect(ep)}>
                          <strong>{ep.project_name || ep.name}</strong>
                          <span>{ep.customer} &middot; {ep.status}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Project Fields */}
          <div className="proj-section">
            <div className="proj-section-title">{t("projectSettings.info")}</div>
            <div className="proj-fields">
              <div className="proj-field">
                <label>{t("projectSettings.name")}</label>
                <input type="text" value={project.name} onChange={(e) => updateField("name", e.target.value)} />
              </div>
              <div className="proj-field">
                <label>{t("projectSettings.number")}</label>
                <input type="text" value={project.projectNumber} onChange={(e) => updateField("projectNumber", e.target.value)} />
              </div>
              <div className="proj-row">
                <div className="proj-field">
                  <label>{t("projectSettings.engineer")}</label>
                  <input type="text" value={project.engineer} onChange={(e) => updateField("engineer", e.target.value)} />
                </div>
                <div className="proj-field">
                  <label>{t("projectSettings.company")}</label>
                  <input type="text" value={project.company} onChange={(e) => updateField("company", e.target.value)} />
                </div>
              </div>
              <div className="proj-row">
                <div className="proj-field">
                  <label>{t("projectSettings.date")}</label>
                  <input type="date" value={project.date} onChange={(e) => updateField("date", e.target.value)} />
                </div>
                <div className="proj-field">
                  <label>{t("projectSettings.location")}</label>
                  <input type="text" value={project.location} onChange={(e) => updateField("location", e.target.value)} />
                </div>
              </div>
              <div className="proj-field">
                <label>{t("projectSettings.description")}</label>
                <textarea rows={2} value={project.description} onChange={(e) => updateField("description", e.target.value)} />
              </div>
              <div className="proj-field">
                <label>{t("projectSettings.notes")}</label>
                <textarea rows={2} value={project.notes} onChange={(e) => updateField("notes", e.target.value)} />
              </div>
            </div>
          </div>
        </div>

        <div className="proj-footer">
          <button className="proj-btn secondary" onClick={onClose}>{t("cancel")}</button>
          <button className="proj-btn primary" onClick={handleSave}>{t("save")}</button>
        </div>
      </div>
    </div>
  );
}
