import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useRecentFiles, type RecentFile } from "../../hooks/useRecentFiles";
import {
  useCptStore,
  newProjectDocument,
  openPathByExtension,
  openContentByFilename,
} from "../../store/useCptStore";
import { IS_TAURI, files as filesPlatform } from "../../utils/platform";
import { saveJsonAsFile } from "../../utils/browserSave";
import {
  getLatestTekening,
  tekeningStateToIfcgis,
  titleBlockToIfcgis,
  buildDeliverable,
  getAllLayerLive,
  getEnabledLayerIds,
} from "../../store/tekeningState";
import { catalogToIfcgisLayers } from "../../utils/gisLayerCatalog";
import ExtensionManagerPanel from "./ExtensionManagerPanel";
import "./Backstage.css";

const ICONS = {
  new: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6m-3 3h6"/></svg>',
  open: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>',
  save: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V7l-4-4z"/><path d="M17 3v4a1 1 0 01-1 1H8"/><path d="M7 14h10v7H7z"/></svg>',
  saveAs: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V7l-4-4z"/><path d="M17 3v4a1 1 0 01-1 1H8"/><path d="M12 12v6m-3-3h6"/></svg>',
  print: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
  export: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
  import: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  preferences: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>',
  about: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  exit: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
  extensions: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/></svg>',
};

function MenuItem({
  icon,
  label,
  shortcut,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  shortcut?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`backstage-item${active ? " active" : ""}`}
      onClick={onClick}
    >
      <span
        className="backstage-item-icon"
        dangerouslySetInnerHTML={{ __html: icon }}
      />
      <span className="backstage-item-label">{label}</span>
      {shortcut && (
        <span className="backstage-item-shortcut">{shortcut}</span>
      )}
    </button>
  );
}

function Divider() {
  return <div className="backstage-divider" />;
}

interface BackstageProps {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenFile?: (path: string) => void;
}

export default function Backstage({ open, onClose, onOpenSettings, onOpenFile }: BackstageProps) {
  const { t } = useTranslation("backstage");
  const [activePanel, setActivePanel] = useState<string>("none");
  const { recentFiles, removeRecentFile, clearRecentFiles } = useRecentFiles();
  const documents = useCptStore((s) => s.documents);
  const activeDocId = useCptStore((s) => s.activeDocId);
  const activeDoc = useMemo(
    () => documents.find((d) => d.id === activeDocId),
    [documents, activeDocId],
  );

  const actionAndClose = useCallback(
    (fn?: () => void) => {
      onClose();
      fn?.();
    },
    [onClose]
  );

  // ── .ifcgis project file actions ────────────────────────────
  // Save only makes sense when the active doc is a project.
  // We bouwen een volledig ifcgis-0.2 payload (header + project + cpts
  // + bores + crs + tekening + title_block) en geven dat aan de
  // Rust-command `save_project_ifcgis_full`. Daar wordt het tegen het
  // schema gevalideerd vóór schrijven, zodat een corrupt project niet
  // op schijf belandt.
  const saveProject = useCallback(async () => {
    if (!activeDoc || activeDoc.kind !== "project") {
      alert("Geen project actief — open of maak een .ifcgeo project.");
      return;
    }
    const defaultName = `${activeDoc.meta.title || "project"}.ifcgeo`;
    const tauriDst = IS_TAURI
      ? await save({
          defaultPath: defaultName,
          // `.ifcgeo` is sinds 2026 de officiële extensie voor zowel
          // single-CPT-snapshots als hele projecten. De CONTENT is 100%
          // IFCX-shaped (IFC5 alpha JSON); de loader sniffed het schema
          // om project vs single te onderscheiden. `.ifcgis` en `.ifcx`
          // blijven leesbaar in de open-dialog (legacy bestanden).
          filters: [
            { name: "Open Geotechniek Studio bestand", extensions: ["ifcgeo", "ifcgis", "ifcx"] },
          ],
        })
      : null;
    if (IS_TAURI && !tauriDst) return;
    try {
      // Project-meta → ifcgis ProjectInfo (snake_case + 'type' veld).
      const meta = activeDoc.meta;
      const projectInfo = {
        type: "OpenGeoProject",
        title: meta.title,
        client: meta.client,
        location: meta.location,
        project_number: meta.project_number,
        author: meta.author,
        // ifcgis verwacht NaiveDate (YYYY-MM-DD); meta.date is al ISO.
        date: meta.date.slice(0, 10),
      };
      // CPTs uit de project-document map; .values() geeft een Iterable
      // dus we converteren via Array.from. Rust verwacht een array.
      const cpts = Array.from(activeDoc.cpts.values());
      // Bores idem — Rust accepteert ze als opaque serde_json::Value
      // (BoreJson), dus we sturen de hele Bore-struct mee zonder
      // verdere transformatie. Lege array als het project geen
      // boringen heeft.
      const bores = Array.from(activeDoc.bores.values());
      // Tekening + title-block uit de singleton (gevuld door
      // SonderingstekeningView). Beide kunnen null zijn als de
      // tekening-tab nooit geopend is — dan schrijft Rust gewoon geen
      // `tekening` / `title_block` sectie.
      const tekState = getLatestTekening();
      const tekening = tekState ? tekeningStateToIfcgis(tekState) : null;
      const titleBlock = tekState
        ? titleBlockToIfcgis(tekState.titleBlock)
        : null;
      // GIS-sectie (ifcgis-0.3): alle bekende lagen + hun live
      // enabled/opacity-state (overschrijft defaults waar MapView een
      // toggle/opacity heeft gepubliceerd). Center wordt overgenomen
      // van de tekening-view-center als die er is, anders default NL.
      const liveLayerOverrides = getAllLayerLive();
      const gis = {
        epsg: 28992,
        name: "Amersfoort / RD New",
        center: tekState
          ? {
              lat: tekState.center.lat,
              lon: tekState.center.lon,
              zoom: tekState.center.zoom,
            }
          : null,
        layers: catalogToIfcgisLayers(liveLayerOverrides),
      };
      // Deliverable (ifcgis-0.3): IFC4x3-stijl flat-annotations-snapshot
      // van de tekening. Alleen aanmaken als er een tekening-state is.
      const deliverable = tekState
        ? buildDeliverable({
            projectName: meta.title,
            projectNumber: meta.project_number,
            tek: tekState,
            activeLayerIds: getEnabledLayerIds(),
          })
        : null;
      const payload = {
        header: {
          schema: "ifcgis-0.3",
          originating_system: "Open Geotechniek Studio",
          timestamp: new Date().toISOString(),
        },
        project: projectInfo,
        cpts,
        bores,
        crs: { epsg: 28992, name: "Amersfoort / RD New" },
        gis,
        ...(tekening ? { tekening } : {}),
        ...(titleBlock ? { title_block: titleBlock } : {}),
        ...(deliverable ? { deliverable } : {}),
      };
      if (IS_TAURI && tauriDst) {
        await invoke("save_project_ifcgis_full", {
          payload,
          path: tauriDst,
        });
      } else {
        // Browser-fallback: download het project als JSON via showSaveFilePicker
        // (Chrome/Edge) of <a download> (overige browsers). Geen Rust-zijde
        // validatie — de gebruiker krijgt de raw payload.
        await saveJsonAsFile(payload, defaultName);
      }
      onClose();
    } catch (err) {
      console.error("save_project_ifcgis_full failed", err);
      alert(`Opslaan mislukt: ${err}`);
    }
  }, [activeDoc, onClose]);

  /// Save-as for a CPT document — offers GEF / BRO-XML / IfcGeo format
  /// conversion. Project documents fall through to `saveProject`.
  const [showCptSaveAsMenu, setShowCptSaveAsMenu] = useState(false);
  const saveCptAs = useCallback(
    async (format: "gef" | "bro" | "ifcgeo") => {
      if (!activeDoc || activeDoc.kind !== "cpt") return;
      const ext = format === "bro" ? "xml" : format;
      const filterName =
        format === "gef"
          ? "GEF (.gef)"
          : format === "bro"
          ? "BRO XML (.xml)"
          : "Geotechniek-object (.ifcgeo)";
      const baseName = activeDoc.cpt.id || "sondering";
      // Browser-modus: alleen .ifcgeo (JSON-snapshot) wordt
      // ondersteund — GEF + BRO-XML serializers zitten in Rust en
      // hebben geen TS-port. Geef de gebruiker een duidelijke melding
      // in plaats van een lege download.
      if (!IS_TAURI) {
        if (format !== "ifcgeo") {
          alert(
            "Exporteren naar GEF of BRO-XML vereist de desktop-versie " +
              "(serializer zit in Rust). In de webversie kun je wel " +
              "naar .ifcgeo (JSON-snapshot) exporteren.",
          );
          return;
        }
        await saveJsonAsFile(activeDoc.cpt, `${baseName}.ifcgeo`);
        setShowCptSaveAsMenu(false);
        onClose();
        return;
      }
      const dst = await save({
        defaultPath: `${baseName}.${ext}`,
        filters: [{ name: filterName, extensions: [ext] }],
      });
      if (!dst) return;
      try {
        await invoke("save_cpt_as", {
          cptId: activeDoc.cpt.id,
          format,
          path: dst,
        });
        setShowCptSaveAsMenu(false);
        onClose();
      } catch (err) {
        console.error("save_cpt_as failed", err);
        alert(`Opslaan mislukt: ${err}`);
      }
    },
    [activeDoc, onClose],
  );

  /// Routes the Save-As button by document kind. CPT docs surface the
  /// format-picker submenu; project docs save .ifcgis directly.
  const onSaveAs = useCallback(() => {
    if (activeDoc?.kind === "cpt") {
      setShowCptSaveAsMenu((v) => !v);
      return;
    }
    void saveProject();
  }, [activeDoc, saveProject]);

  // Single "open anything" entry. Combined filter — the file's extension
  // determines whether we create a CptDocument or a ProjectDocument tab.
  //
  // In Tauri-modus gebruiken we de plugin-dialog (geeft een pad terug)
  // en lezen we via plugin-fs. In browser-modus (npm run dev open in
  // browser i.p.v. Tauri-window) valt-ie terug op een HTML
  // `<input type="file">` zodat de webversie óók bestanden kan openen.
  const openAny = useCallback(async () => {
    // One platform-call handles both desktop (native OS-dialog +
    // plugin-fs) and web (HTML file picker). Returned shape is
    // identical — path is only set in Tauri-modus.
    const picked = await filesPlatform.pickAndRead(true);
    if (picked.length === 0) return;
    let openedAny = false;
    for (const f of picked) {
      try {
        if (f.path) {
          // Desktop: use path-routed loader so de Rust-side weet
          // welk bestand op disk staat (handig voor save-back).
          const handled = await openPathByExtension(f.path);
          if (handled) openedAny = true;
        } else {
          // Web: alleen content beschikbaar, geen pad.
          const handled = await openContentByFilename(f.text, f.name);
          if (handled) openedAny = true;
        }
      } catch (err) {
        console.error("open failed for", f.name, err);
        if (!IS_TAURI) {
          const msg = err instanceof Error ? err.message : String(err);
          alert(
            `Kon ${f.name} niet openen in browser-modus:\n${msg}\n\n` +
            "Tip: BHR-GT XML + GMW XML + GEF + BRO CPT-XML werken wél in de browser. " +
            "Voor .ifcgeo/.ifcgis projectbestanden heb je de desktop-versie nodig.",
          );
        } else {
          alert(`Kon ${f.name} niet openen: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    if (openedAny) onClose();
  }, [onClose]);

  const newProject = useCallback(() => {
    newProjectDocument();
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      setActivePanel("none");
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const hasActivePanel =
    activePanel === "open" ||
    activePanel === "about" ||
    activePanel === "import" ||
    activePanel === "export" ||
    activePanel === "extensions";

  return (
    <div className="backstage-overlay">
      <div className="backstage-sidebar">
        <button className="backstage-back" onClick={onClose}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          <span>{t("file")}</span>
        </button>
        <div className="backstage-items">
          <MenuItem
            icon={ICONS.new}
            label={t("new")}
            shortcut="Ctrl+N"
            onClick={newProject}
          />
          <MenuItem
            icon={ICONS.open}
            label={t("open")}
            shortcut="Ctrl+O"
            onClick={() => void openAny()}
          />
          {/* Recent-files quick list — sits directly under the Open
              menu item so the user can jump straight to a previous
              file without the intermediate Open panel. */}
          {recentFiles.length > 0 && (
            <div className="backstage-recent-list">
              <div className="backstage-recent-header">
                <span>{t("openPanel.title", "Recent")}</span>
                <button
                  type="button"
                  className="backstage-recent-clear"
                  onClick={clearRecentFiles}
                  title={t("openPanel.clearAll", "Clear all")}
                >
                  ✕
                </button>
              </div>
              <ul className="backstage-recent-items">
                {recentFiles.slice(0, 8).map((f) => (
                  <li key={f.path}>
                    <button
                      type="button"
                      className="backstage-recent-item"
                      onClick={() => {
                        onClose();
                        onOpenFile?.(f.path);
                      }}
                      title={f.path}
                    >
                      <span className="backstage-recent-name">{f.name}</span>
                      <span className="backstage-recent-path">{f.path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <MenuItem
            icon={ICONS.save}
            label={t("save")}
            shortcut="Ctrl+S"
            onClick={() => void saveProject()}
          />
          <MenuItem
            icon={ICONS.saveAs}
            label={t("saveAs")}
            shortcut="Ctrl+Shift+S"
            onClick={onSaveAs}
          />
          {showCptSaveAsMenu && activeDoc?.kind === "cpt" && (
            <div className="backstage-submenu">
              <button
                className="backstage-subitem"
                onClick={() => void saveCptAs("gef")}
              >
                GEF (.gef)
              </button>
              <button
                className="backstage-subitem"
                onClick={() => void saveCptAs("bro")}
              >
                BRO XML (.xml)
              </button>
              <button
                className="backstage-subitem"
                onClick={() => void saveCptAs("ifcgeo")}
              >
                Geotechniek-object (.ifcgeo)
              </button>
            </div>
          )}
          <MenuItem
            icon={ICONS.print}
            label={t("print")}
            shortcut="Ctrl+P"
            onClick={() => actionAndClose()}
          />
          <Divider />
          <MenuItem
            icon={ICONS.import}
            label={t("import")}
            active={activePanel === "import"}
            onClick={() => setActivePanel("import")}
          />
          <MenuItem
            icon={ICONS.export}
            label={t("export")}
            active={activePanel === "export"}
            onClick={() => setActivePanel("export")}
          />
          <MenuItem
            icon={ICONS.extensions}
            label={t("extensions")}
            active={activePanel === "extensions"}
            onClick={() => setActivePanel("extensions")}
          />
          <Divider />
          <MenuItem
            icon={ICONS.preferences}
            label={t("preferences")}
            shortcut="Ctrl+,"
            onClick={() => actionAndClose(onOpenSettings)}
          />
          <Divider />
          <MenuItem
            icon={ICONS.about}
            label={t("about")}
            active={activePanel === "about"}
            onClick={() => setActivePanel("about")}
          />
          <Divider />
          <MenuItem
            icon={ICONS.exit}
            label={t("exit")}
            shortcut="Alt+F4"
            onClick={() => {
              onClose();
              import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
                getCurrentWindow().close()
              );
            }}
          />
        </div>
      </div>
      {hasActivePanel && (
        <div className="backstage-content">
          {activePanel === "open" && (
            <OpenPanel
              recentFiles={recentFiles}
              onOpenFile={(path) => { onClose(); onOpenFile?.(path); }}
              onRemoveFile={removeRecentFile}
              onClearAll={clearRecentFiles}
              onOpenAny={openAny}
            />
          )}
          {activePanel === "about" && <AboutPanel />}
          {activePanel === "import" && <ImportPanel />}
          {activePanel === "export" && <ExportPanel />}
          {activePanel === "extensions" && <ExtensionManagerPanel />}
        </div>
      )}
      {/* Click anywhere outside the menu/panel to close */}
      <div className="backstage-dismiss-area" onClick={onClose} />
    </div>
  );
}

function AboutPanel() {
  const { t } = useTranslation("backstage");

  const openExternal = (url: string) => async (e: React.MouseEvent) => {
    e.preventDefault();
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="bs-about-panel">
      <h2 className="bs-about-title">{t("aboutPanel.title")}</h2>
      <div className="bs-about-app">
        <div className="bs-about-logo">
          <svg
            viewBox="0 0 1024 1024"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect x="40" y="40" width="944" height="944" rx="180" fill="var(--theme-accent)" />
            <text
              x="512"
              y="600"
              textAnchor="middle"
              dominantBaseline="middle"
              fill="var(--theme-accent-text)"
              fontSize="320"
              fontFamily="'Space Grotesk', 'Inter', Arial, sans-serif"
              fontWeight="700"
            >
              OA
            </text>
          </svg>
        </div>
        <div className="bs-about-app-info">
          <h1 className="bs-about-app-name">{t("aboutPanel.appName")}</h1>
          <p className="bs-about-version">{t("aboutPanel.version")} 0.1.0</p>
        </div>
      </div>
      <p className="bs-about-tagline">{t("aboutPanel.tagline")}</p>
      <p className="bs-about-description">{t("aboutPanel.description")}</p>
      <div className="bs-about-company">
        <h3 className="bs-about-company-name">{t("aboutPanel.companyName")}</h3>
        <p className="bs-about-company-desc">{t("aboutPanel.companyDescription")}</p>
        <p className="bs-about-company-meta">
          {t("aboutPanel.stichting")}
        </p>
      </div>
      <div className="bs-about-links">
        <a
          href="https://www.open-aec.com/"
          className="bs-about-link"
          onClick={openExternal("https://www.open-aec.com/")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10A15.3 15.3 0 0112 2z" />
          </svg>
          {t("aboutPanel.website")}
        </a>
        <a
          href="https://github.com/OpenAEC-Foundation"
          className="bs-about-link"
          onClick={openExternal("https://github.com/OpenAEC-Foundation")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22" />
          </svg>
          {t("aboutPanel.github")}
        </a>
      </div>
      <div className="bs-about-footer">
        <p className="bs-about-copyright">
          {t("aboutPanel.copyright")}
        </p>
      </div>
    </div>
  );
}

function ImportPanel() {
  const { t } = useTranslation("backstage");
  return (
    <div className="bs-export-panel">
      <h2 className="bs-export-title">{t("importPanel.title")}</h2>
      <div className="bs-export-cards">
        <div className="bs-export-card">
          <div className="bs-export-card-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <path d="M14 2v6h6" />
              <path d="M12 18v-6m-3 3h6" />
            </svg>
          </div>
          <div className="bs-export-card-info">
            <h3>{t("importPanel.fromFile")}</h3>
            <p>{t("importPanel.fromFileDesc")}</p>
          </div>
        </div>
        <div className="bs-export-card">
          <div className="bs-export-card-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </div>
          <div className="bs-export-card-info">
            <h3>{t("importPanel.fromTemplate")}</h3>
            <p>{t("importPanel.fromTemplateDesc")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function OpenPanel({
  recentFiles,
  onOpenFile,
  onRemoveFile,
  onClearAll,
  onOpenAny,
}: {
  recentFiles: RecentFile[];
  onOpenFile: (path: string) => void;
  onRemoveFile: (path: string) => void;
  onClearAll: () => void;
  onOpenAny: () => void | Promise<void>;
}) {
  const { t } = useTranslation("backstage");

  const typeIcon = (type: RecentFile["type"]) => {
    switch (type) {
      case "ifc":
        return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>';
      case "report":
        return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>';
      case "project":
        return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>';
      default:
        return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M13 2v7h7"/></svg>';
    }
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return t("openPanel.justNow", "Just now");
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return d.toLocaleDateString();
  };

  return (
    <div className="bs-export-panel">
      <h2 className="bs-export-title" style={{ marginTop: 0, marginBottom: 16 }}>
        {t("openPanel.openTitle", "Openen")}
      </h2>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginBottom: 28 }}>
        <button className="bs-open-card" onClick={() => void onOpenAny()}>
          <div className="bs-open-card-icon" style={{ color: "var(--amber, #D97706)" }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
            </svg>
          </div>
          <div className="bs-open-card-text">
            <strong>{t("openPanel.openTitle", "Openen")}</strong>
            <span>{t("openPanel.openAnyHint", "Sondering (GEF / BRO-XML) of project/sondering (.ifcgeo) — elk bestand opent in een eigen tab")}</span>
          </div>
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h3 className="bs-export-title" style={{ margin: 0, fontSize: "1rem" }}>{t("openPanel.title", "Recent Files")}</h3>
        {recentFiles.length > 0 && (
          <button
            onClick={onClearAll}
            style={{
              background: "none",
              border: "none",
              color: "var(--theme-text-muted, #888)",
              cursor: "pointer",
              fontSize: "0.8rem",
              textDecoration: "underline",
            }}
          >
            {t("openPanel.clearAll", "Clear all")}
          </button>
        )}
      </div>
      {recentFiles.length === 0 ? (
        <p style={{ color: "var(--theme-text-muted, #888)", fontStyle: "italic" }}>
          {t("openPanel.noRecent", "No recent files")}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {recentFiles.map((file) => (
            <div
              key={file.path}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                borderRadius: 6,
                cursor: "pointer",
                transition: "background 0.15s",
              }}
              className="bs-recent-item"
              onClick={() => onOpenFile(file.path)}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--theme-hover, rgba(0,0,0,0.05))")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span dangerouslySetInnerHTML={{ __html: typeIcon(file.type) }} style={{ opacity: 0.6, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {file.name}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--theme-text-muted, #888)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {file.path}
                </div>
              </div>
              <span style={{ fontSize: "0.75rem", color: "var(--theme-text-muted, #888)", flexShrink: 0 }}>
                {formatDate(file.timestamp)}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onRemoveFile(file.path); }}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 4,
                  opacity: 0.4,
                  color: "currentColor",
                  flexShrink: 0,
                }}
                title={t("openPanel.remove", "Remove")}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M3 3l6 6M9 3l-6 6" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExportPanel() {
  const { t } = useTranslation("backstage");
  const activeId = useCptStore((s) => s.activeCptId);
  const cptsMap = useCptStore((s) => s.cpts);
  const cptIds = useMemo(() => Array.from(cptsMap.keys()), [cptsMap]);
  const hasActive = activeId != null;
  const hasAny = cptIds.length > 0;

  async function exportCsv() {
    if (!activeId) return;
    const dst = await save({
      defaultPath: `${activeId}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!dst) return;
    try {
      await invoke("export_csv", { cptId: activeId, path: dst });
    } catch (e) {
      console.error("export_csv failed", e);
    }
  }

  async function exportGeoJson() {
    if (cptIds.length === 0) return;
    const dst = await save({
      defaultPath: "cpt-locations.geojson",
      filters: [{ name: "GeoJSON", extensions: ["geojson", "json"] }],
    });
    if (!dst) return;
    try {
      await invoke("export_geojson", { cptIds, path: dst });
    } catch (e) {
      console.error("export_geojson failed", e);
    }
  }

  return (
    <div className="bs-export-panel">
      <h2 className="bs-export-title">{t("exportPanel.title")}</h2>
      <div className="bs-export-cards">
        <button
          type="button"
          className="bs-export-card"
          onClick={() => void exportCsv()}
          disabled={!hasActive}
          style={{
            cursor: hasActive ? "pointer" : "not-allowed",
            opacity: hasActive ? 1 : 0.5,
            textAlign: "left",
            font: "inherit",
            color: "inherit",
            width: "100%",
          }}
        >
          <div className="bs-export-card-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <path d="M14 2v6h6" />
              <path d="M8 13h2M8 17h2M14 13h2M14 17h2" />
            </svg>
          </div>
          <div className="bs-export-card-info">
            <h3>{t("exportPanel.asCsv")}</h3>
            <p>{t("exportPanel.asCsvDesc")}</p>
          </div>
        </button>
        <button
          type="button"
          className="bs-export-card"
          onClick={() => void exportGeoJson()}
          disabled={!hasAny}
          style={{
            cursor: hasAny ? "pointer" : "not-allowed",
            opacity: hasAny ? 1 : 0.5,
            textAlign: "left",
            font: "inherit",
            color: "inherit",
            width: "100%",
          }}
        >
          <div className="bs-export-card-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10A15.3 15.3 0 0112 2z" />
            </svg>
          </div>
          <div className="bs-export-card-info">
            <h3>{t("exportPanel.asGeoJson")}</h3>
            <p>{t("exportPanel.asGeoJsonDesc")}</p>
          </div>
        </button>
      </div>
    </div>
  );
}
