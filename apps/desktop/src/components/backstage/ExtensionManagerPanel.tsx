import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useAllExtensions,
  setExtension,
  type ExtensionId,
} from "../../hooks/useExtensions";
import "./ExtensionManagerPanel.css";

/**
 * Beschrijving van één extensie zoals getoond in het Extensions-paneel.
 * Bij elke nieuwe ExtensionId die in `useExtensions.ts` wordt
 * toegevoegd hoort hier ook een entry — anders verschijnt-ie wel in de
 * lijst (via useAllExtensions) maar zónder naam/beschrijving.
 */
interface ExtensionMeta {
  id: ExtensionId;
  name: string;
  version: string;
  description: string;
  author: string;
  category: string;
}

const INSTALLED_EXTENSIONS: ExtensionMeta[] = [
  {
    id: "tekening",
    name: "Situatietekening",
    version: "0.2.8",
    description:
      "CAD-papier (A2/A3/A4) met sonderingen op de kaart, kader, schaalbalk, snap-systeem, overlays en PDF-export.",
    author: "OpenAEC Foundation",
    category: "Tekening",
  },
  {
    id: "offertes",
    name: "Offertes opvragen",
    version: "0.2.8",
    description:
      "Vraagt offertes op bij dichtsbijzijnde sondeerbedrijven via een mailto-flow (vereist de Situatietekening-extensie).",
    author: "OpenAEC Foundation",
    category: "Werkflow",
  },
];

const CATEGORY_COLORS: Record<string, string> = {
  "Tekening": "#22d3ee",
  "Werkflow": "#a78bfa",
  "Import/Export": "#60a5fa",
  "Reporting": "#a78bfa",
  "Utility": "#a1a1aa",
  "Other": "#71717a",
};

export default function ExtensionManagerPanel() {
  const { t } = useTranslation("backstage");
  const [tab, setTab] = useState<"installed" | "browse">("installed");
  const [search, setSearch] = useState("");
  const enabledMap = useAllExtensions();

  const toggleExtension = (id: ExtensionId) => {
    void setExtension(id, !enabledMap[id]);
  };

  const filteredInstalled = INSTALLED_EXTENSIONS.filter(
    (e) =>
      !search ||
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.description.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="ext-manager">
      <h2 className="ext-manager-title">{t("extensions")}</h2>

      <div className="ext-tabs">
        <button
          className={`ext-tab${tab === "installed" ? " active" : ""}`}
          onClick={() => setTab("installed")}
        >
          {t("extInstalled")} ({INSTALLED_EXTENSIONS.length})
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
      </div>

      <div className="ext-list">
        {tab === "installed" &&
          filteredInstalled.map((ext) => {
            const enabled = enabledMap[ext.id];
            return (
              <div key={ext.id} className={`ext-card${enabled ? "" : " disabled"}`}>
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
                      checked={enabled}
                      onChange={() => toggleExtension(ext.id)}
                    />
                    <span className="ext-toggle-slider" />
                  </label>
                </div>
              </div>
            );
          })}

        {tab === "browse" && (
          <div
            style={{
              padding: 24,
              textAlign: "center",
              color: "var(--theme-text-secondary, #71717a)",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            <p style={{ margin: 0 }}>
              Geen externe extensie-catalogus beschikbaar.
            </p>
            <p style={{ margin: "8px 0 0", fontSize: 12 }}>
              Open Geotechniek Studio gebruikt momenteel alleen ingebouwde extensies
              (zie tab "{t("extInstalled")}"). Een community-catalogus volgt in een
              latere versie.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
