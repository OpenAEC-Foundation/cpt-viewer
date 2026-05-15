import { useState } from "react";
import { useTranslation } from "react-i18next";
import "./ExtensionManagerPanel.css";

interface InstalledExtension {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  category: string;
  enabled: boolean;
}

interface CatalogEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  category: string;
}

const SAMPLE_INSTALLED: InstalledExtension[] = [
  {
    id: "ifc-importer",
    name: "IFC Importer",
    version: "1.0.0",
    description: "Import IFC4 STEP files into the application",
    author: "OpenAEC Foundation",
    category: "Import/Export",
    enabled: true,
  },
  {
    id: "pdf-export",
    name: "PDF Export",
    version: "0.9.0",
    description: "Export reports as PDF using OpenAEC Report Generator",
    author: "OpenAEC Foundation",
    category: "Reporting",
    enabled: true,
  },
];

const SAMPLE_CATALOG: CatalogEntry[] = [
  {
    id: "excel-importer",
    name: "Excel Importer",
    version: "1.2.0",
    description: "Import data from Excel spreadsheets (.xlsx)",
    author: "Community",
    category: "Import/Export",
  },
  {
    id: "bonsai-sync",
    name: "Bonsai Live Sync",
    version: "0.5.0",
    description: "Sync IFC models with Bonsai/Blender via WebSocket",
    author: "OpenAEC Foundation",
    category: "Utility",
  },
  {
    id: "calculation-engine",
    name: "Structural Calc Engine",
    version: "0.3.0",
    description: "Basic structural calculation blocks for reports",
    author: "Community",
    category: "Calculation",
  },
];

const CATEGORY_COLORS: Record<string, string> = {
  "Import/Export": "#22d3ee",
  Calculation: "#60a5fa",
  Reporting: "#a78bfa",
  Utility: "#a1a1aa",
  Other: "#71717a",
};

export default function ExtensionManagerPanel() {
  const { t } = useTranslation("backstage");
  const [tab, setTab] = useState<"installed" | "browse">("installed");
  const [search, setSearch] = useState("");
  const [extensions, setExtensions] = useState(SAMPLE_INSTALLED);

  const toggleExtension = (id: string) => {
    setExtensions((prev) =>
      prev.map((ext) => (ext.id === id ? { ...ext, enabled: !ext.enabled } : ext))
    );
  };

  const filteredInstalled = extensions.filter(
    (e) =>
      !search ||
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.description.toLowerCase().includes(search.toLowerCase())
  );

  const filteredCatalog = SAMPLE_CATALOG.filter(
    (e) =>
      !search ||
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="ext-manager">
      <h2 className="ext-manager-title">{t("extensions")}</h2>

      <div className="ext-tabs">
        <button
          className={`ext-tab${tab === "installed" ? " active" : ""}`}
          onClick={() => setTab("installed")}
        >
          {t("extInstalled")} ({extensions.length})
        </button>
        <button
          className={`ext-tab${tab === "browse" ? " active" : ""}`}
          onClick={() => setTab("browse")}
        >
          {t("extBrowse")}
        </button>
      </div>

      <div className="ext-search-row">
        <input
          type="text"
          className="ext-search"
          placeholder={t("extSearchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="ext-upload-btn" title={t("extInstallFile")}>
          + ZIP
        </button>
      </div>

      <div className="ext-list">
        {tab === "installed" &&
          filteredInstalled.map((ext) => (
            <div key={ext.id} className={`ext-card${ext.enabled ? "" : " disabled"}`}>
              <div className="ext-card-header">
                <span
                  className="ext-category-badge"
                  style={{ background: CATEGORY_COLORS[ext.category] || "#71717a" }}
                >
                  {ext.category}
                </span>
                <span className="ext-version">v{ext.version}</span>
              </div>
              <div className="ext-card-body">
                <strong className="ext-name">{ext.name}</strong>
                <p className="ext-desc">{ext.description}</p>
                <span className="ext-author">{ext.author}</span>
              </div>
              <div className="ext-card-actions">
                <label className="ext-toggle">
                  <input
                    type="checkbox"
                    checked={ext.enabled}
                    onChange={() => toggleExtension(ext.id)}
                  />
                  <span className="ext-toggle-slider" />
                </label>
              </div>
            </div>
          ))}

        {tab === "browse" &&
          filteredCatalog.map((ext) => {
            const isInstalled = extensions.some((e) => e.id === ext.id);
            return (
              <div key={ext.id} className="ext-card">
                <div className="ext-card-header">
                  <span
                    className="ext-category-badge"
                    style={{ background: CATEGORY_COLORS[ext.category] || "#71717a" }}
                  >
                    {ext.category}
                  </span>
                  <span className="ext-version">v{ext.version}</span>
                </div>
                <div className="ext-card-body">
                  <strong className="ext-name">{ext.name}</strong>
                  <p className="ext-desc">{ext.description}</p>
                  <span className="ext-author">{ext.author}</span>
                </div>
                <div className="ext-card-actions">
                  {isInstalled ? (
                    <span className="ext-installed-badge">{t("extInstalledBadge")}</span>
                  ) : (
                    <button className="ext-install-btn">{t("extInstallBtn")}</button>
                  )}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
