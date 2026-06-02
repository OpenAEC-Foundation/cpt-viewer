import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useAllExtensions,
  setExtension,
  isExtensionSelectable,
  type ExtensionId,
} from "../../hooks/useExtensions";
import { CALC_REGISTRY } from "../../calc/framework/registry";
import "./ExtensionManagerPanel.css";

/**
 * Beschrijving van één extensie zoals getoond in het Extensions-paneel.
 * Bij elke nieuwe ExtensionId die in `useExtensions.ts` wordt
 * toegevoegd hoort hier ook een entry — anders verschijnt-ie wel in de
 * lijst (via useAllExtensions) maar zónder naam/beschrijving.
 *
 * Calc-module entries worden automatisch gegenereerd uit
 * `CALC_REGISTRY` zodat een nieuwe module alleen in de registry
 * geregistreerd hoeft te worden (en als ExtensionId in
 * useExtensions.ts) om hier te verschijnen.
 */
interface ExtensionMeta {
  id: ExtensionId;
  name: string;
  version: string;
  description: string;
  author: string;
  category: string;
}

const TEKENING_EXT: ExtensionMeta = {
  id: "tekening",
  name: "Situatietekening",
  version: "0.2.9",
  description:
    "CAD-papier (A2/A3/A4) met sonderingen, snap-systeem, overlays en PDF-export.",
  author: "OpenAEC Foundation",
  category: "Tekening",
};
const OFFERTES_EXT: ExtensionMeta = {
  id: "offertes",
  name: "Offertes opvragen",
  version: "0.2.9",
  description:
    "Vraagt offertes op bij dichtsbijzijnde sondeerbedrijven.",
  author: "OpenAEC Foundation",
  category: "Werkflow",
};

const INSTALLED_EXTENSIONS: ExtensionMeta[] = [
  TEKENING_EXT,
  OFFERTES_EXT,
  ...CALC_REGISTRY.map<ExtensionMeta>((m) => ({
    id: `calc.${m.id}` as ExtensionId,
    name: m.name,
    version: m.status === "available" ? "0.3.0" : "0.0.1-coming-soon",
    description: `${m.subtitle} — ${m.norm}`,
    author: "OpenAEC Foundation",
    category: "Berekening",
  })),
];

const CATEGORY_COLORS: Record<string, string> = {
  "Tekening": "#22d3ee",
  "Werkflow": "#a78bfa",
  "Berekening": "#f59e0b",
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
            const selectable = isExtensionSelectable(ext.id);
            const lockedLabel = "Nog niet productie-gereed";
            return (
              <div
                key={ext.id}
                className={`ext-card${enabled ? "" : " disabled"}${selectable ? "" : " ext-card--locked"}`}
              >
                <div className="ext-card-header">
                  <span
                    className="ext-category-badge"
                    style={{ background: CATEGORY_COLORS[ext.category] || "#71717a" }}
                  >
                    {ext.category}
                  </span>
                  {!selectable && (
                    <span className="ext-locked-badge" title={lockedLabel}>
                      🚧 In ontwikkeling
                    </span>
                  )}
                  <span className="ext-version">v{ext.version}</span>
                </div>
                <div className="ext-card-body">
                  <strong className="ext-name">{ext.name}</strong>
                  <p className="ext-desc">{ext.description}</p>
                  {!selectable && (
                    <p className="ext-desc-locked">
                      Deze berekening is nog in ontwikkeling — getallen zijn nog niet
                      productie-geverifieerd. De toggle is daarom uitgeschakeld.
                    </p>
                  )}
                  <span className="ext-author">{ext.author}</span>
                </div>
                <div className="ext-card-actions">
                  <label
                    className={`ext-toggle${selectable ? "" : " ext-toggle--disabled"}`}
                    title={selectable ? "" : lockedLabel}
                  >
                    <input
                      type="checkbox"
                      checked={enabled && selectable}
                      disabled={!selectable}
                      onChange={() => selectable && toggleExtension(ext.id)}
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
