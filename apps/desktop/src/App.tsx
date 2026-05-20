import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import TitleBar from "./components/TitleBar";
import Ribbon from "./components/ribbon/Ribbon";
import DocumentBar from "./components/DocumentBar";
import StatusBar from "./components/StatusBar";
import Backstage from "./components/backstage/Backstage";
import SettingsDialog, { applyTheme } from "./components/settings/SettingsDialog";
import FeedbackDialog from "./components/feedback/FeedbackDialog";
import WelcomeScreen from "./components/welcome/WelcomeScreen";
import { StartSidebar } from "./components/welcome/StartSidebar";
import ProjectSettingsDialog from "./components/project/ProjectSettingsDialog";
import ReportPreview from "./components/panels/ReportPreview";
import ChartView from "./components/panels/ChartView";
import MapView from "./components/panels/MapView";
import IfcView from "./components/panels/IfcView";
import "./components/panels/IfcView.css";
import SonderingstekeningView from "./components/panels/SonderingstekeningView";
import LeftPanel from "./components/panels/LeftPanel";
import GisLayerPanel from "./components/panels/GisLayerPanel";
import RightPanel from "./components/panels/RightPanel";
import TekeningProperties from "./components/panels/TekeningProperties";
import { getDetachedParams, useWindowManager } from "./hooks/useWindowManager";
import { getSetting, setSetting } from "./store";
import { openPathByExtension, openContentByFilename, useCptStore } from "./store/useCptStore";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { IS_TAURI } from "./utils/platform";
import "./themes.css";
import "./App.css";

/**
 * Detached window — shows only one view, no ribbon/backstage/etc.
 * Has a "dock back" button to re-attach to the main window.
 */
function DetachedApp({ view, title }: { view: string; title: string }) {
  const { requestDockBack } = useWindowManager();

  useEffect(() => {
    getSetting("theme", "light").then((saved) => applyTheme(saved));
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      getCurrentWindow().show();
    }).catch(() => {});
  }, []);

  const handleDockBack = () => {
    requestDockBack(title, view);
  };

  const renderView = () => {
    switch (view) {
      case "report":
        return <ReportPreview />;
      default:
        return <div className="placeholder"><p>Detached view</p></div>;
    }
  };

  return (
    <>
      <TitleBar onSettingsClick={() => {}} onFeedbackClick={() => {}} />
      {/* Dock-back bar */}
      <div className="detached-dock-bar">
        <span className="detached-dock-title">{title}</span>
        <button className="detached-dock-btn" onClick={handleDockBack} title="Dock back to main window">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
          <span>Dock back</span>
        </button>
      </div>
      <main className="main-view" style={{ flex: 1 }}>
        {renderView()}
      </main>
      <StatusBar />
    </>
  );
}

function App() {
  // Check if this is a detached window
  const detachedParams = getDetachedParams();
  if (detachedParams.detached && detachedParams.view) {
    return <DetachedApp view={detachedParams.view} title={detachedParams.title ?? "Untitled"} />;
  }
  const { t } = useTranslation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [backstageOpen, setBackstageOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [theme, setTheme] = useState("light");
  const [activeView, setActiveView] = useState("default");

  // Start sidebar — shown only on first launch.
  // Once the user dismisses it, the flag flips and it never auto-opens again.
  // Default: undefined (loading) → only render once we know the stored value.
  //
  // In browser-modus (webdemo) wordt-ie sowieso niet getoond — daar laden
  // we automatisch example.gef en de gebruiker komt direct in de chart-
  // view terecht. De StartSidebar is bedoeld als eerste-keer-hint voor
  // de desktop-versie ("klik hier om een bestand te openen"), wat in
  // de browser misleidend zou zijn want File→Open werkt daar anders.
  const [startSidebarVisible, setStartSidebarVisible] = useState<boolean | null>(null);
  useEffect(() => {
    if (!IS_TAURI) {
      setStartSidebarVisible(false);
      return;
    }
    getSetting<boolean>("startSidebarDismissed", false).then((dismissed) => {
      setStartSidebarVisible(!dismissed);
    });
  }, []);
  const dismissStartSidebar = useCallback(() => {
    setStartSidebarVisible(false);
    setSetting("startSidebarDismissed", true);
  }, []);

  // Left panel state (Explorer)
  const [leftPanelWidth, setLeftPanelWidth] = useState(240);
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const isLeftResizing = useRef(false);

  // Right panel state (Properties)
  const [rightPanelWidth, setRightPanelWidth] = useState(240);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const isRightResizing = useRef(false);

  const [isResizing, setIsResizing] = useState(false);

  // Drag-and-drop: receive native OS file drops and route them to the
  // appropriate doc-loader by file extension. GEF/XML → CptDocument tab,
  // .ifcgis → ProjectDocument tab.
  //
  // Twee implementaties: in Tauri (desktop-window) gebruiken we
  // getCurrentWebview().onDragDropEvent — die levert echte
  // OS-paden. In de browser-modus (localhost zonder Tauri-runtime)
  // vallen we terug op standaard HTML5-drop-events op `document` met
  // File-objects die we via `file.text()` lezen.
  const [dragOver, setDragOver] = useState(false);
  useEffect(() => {
    const isOpenable = (path: string) =>
      /\.(gef|xml|ifcgis|ifcgeo|ifcx)$/i.test(path);

    // Bail out in browser-test contexts (geen Tauri-runtime) — getCurrentWebview
    // crasht dan synchroon op undefined.metadata. In dat geval registreren
    // we de HTML5-drag-drop listeners verderop.
    let unsubscribePromise: Promise<() => void> | null = null;
    try {
      unsubscribePromise = getCurrentWebview().onDragDropEvent(async (event) => {
        const t = event.payload.type;
        if (t === "enter" || t === "over") {
          const paths = (event.payload as { paths?: string[] }).paths ?? [];
          // Only highlight if at least one dragged item looks openable.
          if (paths.length === 0 || paths.some(isOpenable)) setDragOver(true);
        } else if (t === "leave") {
          setDragOver(false);
        } else if (t === "drop") {
          setDragOver(false);
          const paths = (event.payload as { paths: string[] }).paths;
          for (const path of paths) {
            try {
              await openPathByExtension(path);
            } catch (err) {
              console.error("drag-drop open failed for", path, err);
            }
          }
        }
      });
    } catch (err) {
      console.warn("[App] getCurrentWebview unavailable (browser mode):", err);
    }
    return () => {
      if (unsubscribePromise) void unsubscribePromise.then((unsub) => unsub());
    };
  }, []);

  // Browser-fallback drag-and-drop: alleen registreren als we NIET in
  // Tauri draaien (anders zou je dubbele drop-events krijgen — Tauri's
  // webview vangt OS-drops al af). Hangt aan `window` zodat de hele
  // app-area als drop-zone fungeert.
  //
  // Counter-based aanpak: `dragenter` op een child element triggert
  // gelijk een `dragleave` op de parent — een naïeve setDragOver(false)
  // op leave doet de overlay daardoor flikkeren. We tellen daarom enters
  // minus leaves; overlay zichtbaar zolang teller > 0.
  useEffect(() => {
    if (IS_TAURI) return;

    const isOpenableExt = (name: string) =>
      /\.(gef|xml|ifcgis|ifcgeo|ifcx)$/i.test(name);

    let depth = 0;

    const hasFiles = (e: DragEvent): boolean => {
      const types = e.dataTransfer?.types;
      if (!types) return false;
      // `types` kan een DOMStringList zijn — convert via Array.from voor
      // includes(). "Files" verschijnt zodra de gebruiker iets van buiten
      // de browser sleept (echte bestand), niet bij interne text-drags.
      return Array.from(types as ArrayLike<string>).includes("Files");
    };

    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      if (depth === 1) setDragOver(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // preventDefault is verplicht — zonder dit gaat de browser het
      // bestand zélf openen (b.v. de XML inline in een nieuwe tab tonen).
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragOver(false);
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      let openedAny = false;
      for (const f of files) {
        if (!isOpenableExt(f.name)) {
          console.warn("Drop genegeerd — onbekende extensie:", f.name);
          continue;
        }
        try {
          const text = await f.text();
          await openContentByFilename(text, f.name);
          openedAny = true;
        } catch (err) {
          console.error("Browser drop open failed for", f.name, err);
          const msg = err instanceof Error ? err.message : String(err);
          alert(
            `Kon ${f.name} niet openen in browser-modus:\n${msg}\n\n` +
            "Tip: BHR-GT XML + GMW XML + GEF werken in de browser. " +
            "Voor BRO CPT-XML en projectbestanden heb je de desktop-versie nodig.",
          );
        }
      }
      if (openedAny) {
        // Verberg de auto-load demo-banner zodra de gebruiker zelf iets
        // heeft geopend — die was alleen bedoeld als "leeg-staat" hint.
      }
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  // Auto-load example.gef in browser-modus zodra de app voor het eerst
  // mount én er nog geen documenten open zijn. Geeft een directe demo-
  // ervaring voor bezoekers van de live webdemo zonder dat ze eerst
  // moeten weten waar ze klikken. In Tauri (desktop) doen we dit niet
  // — daar laten we de gebruiker zelf File → Open kiezen.
  const autoloadDoneRef = useRef(false);
  useEffect(() => {
    if (IS_TAURI || autoloadDoneRef.current) return;
    const docs = useCptStore.getState().documents;
    if (docs.length > 0) {
      autoloadDoneRef.current = true;
      return;
    }
    autoloadDoneRef.current = true;
    (async () => {
      try {
        const res = await fetch("./example.gef");
        if (!res.ok) {
          console.warn("Auto-load example.gef: HTTP", res.status);
          return;
        }
        const text = await res.text();
        await openContentByFilename(text, "example.gef");
      } catch (err) {
        console.warn("Auto-load example.gef failed:", err);
      }
    })();
  }, []);

  // Allow other components (eg. ReportPreview's sidebar action) to open
  // the ProjectSettingsDialog without prop-drilling — listen for a global
  // event and bounce it into the existing modal state.
  useEffect(() => {
    const onOpen = () => setProjectSettingsOpen(true);
    window.addEventListener("ogs:open-project-settings", onOpen);
    return () => window.removeEventListener("ogs:open-project-settings", onOpen);
  }, []);

  // Publish the currently active view both as a DOM attribute (so panels
  // can read it synchronously) and as a custom event. GisLayerPanel uses
  // these to keep its checkbox state per-view, and MapView / Sondering-
  // stekeningView filter incoming layer events on `detail.view` so a
  // toggle on one tab doesn't bleed into the other.
  useEffect(() => {
    const v = activeView === "tekening" ? "tekening" : "map";
    document.body.dataset.activeView = v;
    window.dispatchEvent(new CustomEvent("ogs:active-view-changed", {
      detail: { view: v },
    }));
  }, [activeView]);

  // ── Open-with handler ────────────────────────────────────────────
  // Tauri emits `ogs:open-file` for every CLI-passed file path on
  // launch (registered .gef / .ifcgis / .ifcgeo file associations).
  // Route each path through the same loader the drag-drop + Backstage
  // use, so behaviour is identical regardless of how the user opened it.
  useEffect(() => {
    let unsubFn: (() => void) | null = null;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<string>("ogs:open-file", (event) => {
        void openPathByExtension(event.payload);
      }).then((unsub) => { unsubFn = unsub; }),
    ).catch(() => { /* Tauri unavailable (browser test mode) */ });
    return () => { unsubFn?.(); };
  }, []);

  useEffect(() => {
    getSetting("theme", "light").then((saved) => {
      setTheme(saved);
      applyTheme(saved);
    });
    // Welcome modal is no longer auto-shown — the persistent StartSidebar
    // replaces it. Users can still open it via the help menu.
    getSetting("showWelcome", false).then((show) => {
      if (show) setWelcomeOpen(true);
    });
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      getCurrentWindow().show();
    }).catch(() => {});
  }, []);

  // Left panel resize handler
  const handleLeftResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isLeftResizing.current = true;
    setIsResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isLeftResizing.current) return;
      const newWidth = Math.max(160, Math.min(480, ev.clientX));
      setLeftPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      isLeftResizing.current = false;
      setIsResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

  // Right panel resize handler
  const handleRightResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isRightResizing.current = true;
    setIsResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isRightResizing.current) return;
      const newWidth = Math.max(160, Math.min(640, window.innerWidth - ev.clientX));
      setRightPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      isRightResizing.current = false;
      setIsResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

  // Full-width views hide the side panels. Map view keeps the right panel
  // so the Robertson legend + LocationMiniMap stay accessible alongside it.
  // The IFC view also goes full-width — its two-pane layout fills the
  // viewport and doesn't need the Explorer / Properties sidebars.
  // Sonderingstekening now also wants the left-side GisLayerPanel so
  // the user can toggle base + overlay layers without leaving the view.
  // Only Rapport + IFC stay full-width because they don't deal with maps.
  const isFullWidthView =
    activeView === "report" || activeView === "ifc";

  const renderMainContent = () => {
    switch (activeView) {
      case "report":
        return <ReportPreview />;
      case "map":
        return <MapView />;
      case "ifc":
        return <IfcView />;
      case "tekening":
        return <SonderingstekeningView />;
      default:
        return <ChartView />;
    }
  };

  return (
    <>
      <TitleBar
        onSettingsClick={() => setSettingsOpen(true)}
        onFeedbackClick={() => {
          // Gebruiker-verzoek: feedback nu via GitHub-issues ipv onze
          // eigen FeedbackDialog (mailto). Open de "new issue"-pagina
          // van de repo in de externe browser via @tauri-apps/plugin-
          // opener; valt onder Tauri terug op window.open zodat het
          // ook werkt in de browser-only preview.
          const url = "https://github.com/OpenAEC-Foundation/open-geotechniek-studio/issues/new";
          import("@tauri-apps/plugin-opener")
            .then(({ openUrl }) => openUrl(url))
            .catch(() => { window.open(url, "_blank", "noopener"); });
        }}
      />
      {dragOver && (
        <div className="drop-overlay">
          <div className="drop-overlay-card">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <p>Laat los om te openen — GEF, BRO-XML of .ifcgeo</p>
          </div>
        </div>
      )}
      <Ribbon
        onFileTabClick={() => setBackstageOpen(true)}
        onSettingsClick={() => setSettingsOpen(true)}
        onProjectSettingsClick={() => setProjectSettingsOpen(true)}
        activeView={activeView}
        onViewChange={setActiveView}
      />
      <DocumentBar onOpenClick={() => setBackstageOpen(true)} />
      <div className="content">
        {/* Start sidebar — shown only on first launch. Once dismissed, gone for good. */}
        {startSidebarVisible && (
          <StartSidebar
            onNewFile={() => {
              setProjectSettingsOpen(true);
              dismissStartSidebar();
            }}
            onOpenFile={() => {
              setBackstageOpen(true);
              dismissStartSidebar();
            }}
            onOpenRecentFile={(path) => {
              console.log("Open recent:", path);
              dismissStartSidebar();
            }}
            onClose={dismissStartSidebar}
          />
        )}

        {/* Left panel — Explorer (hidden in full-width views) */}
        {!isFullWidthView && (
          <aside className={`left-panel${leftPanelOpen ? "" : " collapsed"}${isResizing ? " no-transition" : ""}`} style={{ width: leftPanelOpen ? leftPanelWidth : 28 }}>
            {leftPanelOpen ? (
              <>
                <div className="left-panel-toolbar">
                  <span className="left-panel-title">{t("explorer")}</span>
                  <button className="left-panel-close-btn" onClick={() => setLeftPanelOpen(false)} title={t("close")}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2.5A1.5 1.5 0 013.5 1h9A1.5 1.5 0 0114 2.5v11a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 13.5v-11zM3.5 2a.5.5 0 00-.5.5v11a.5.5 0 00.5.5H6V2H3.5zM7 2v12h5.5a.5.5 0 00.5-.5v-11a.5.5 0 00-.5-.5H7z" /></svg>
                  </button>
                </div>
                {activeView === "map" || activeView === "tekening"
                  ? <GisLayerPanel />
                  : <LeftPanel />}
                <div className="left-panel-resize" onMouseDown={handleLeftResizeMouseDown} />
              </>
            ) : (
              <button className="left-panel-collapsed-tab" onClick={() => setLeftPanelOpen(true)} title={t("explorer")}>
                <span>{t("explorer")}</span>
              </button>
            )}
          </aside>
        )}

        <main className="main-view">
          {renderMainContent()}
        </main>

        {/* Right panel — Properties (hidden in full-width views) */}
        {!isFullWidthView && (
          <aside className={`right-panel${rightPanelOpen ? "" : " collapsed"}${isResizing ? " no-transition" : ""}`} style={{ width: rightPanelOpen ? rightPanelWidth : 28 }}>
            {rightPanelOpen ? (
              <>
                <div className="right-panel-resize" onMouseDown={handleRightResizeMouseDown} />
                <div className="right-panel-toolbar">
                  <span className="right-panel-title">{t("properties")}</span>
                  <button className="right-panel-close-btn" onClick={() => setRightPanelOpen(false)} title={t("close")}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2.5A1.5 1.5 0 013.5 1h9A1.5 1.5 0 0114 2.5v11a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 13.5v-11zM3.5 2a.5.5 0 00-.5.5v11a.5.5 0 00.5.5H9V2H3.5zM10 2v12h2.5a.5.5 0 00.5-.5v-11a.5.5 0 00-.5-.5H10z" /></svg>
                  </button>
                </div>
                {activeView === "tekening"
                  ? <TekeningProperties />
                  : <RightPanel />}
              </>
            ) : (
              <button className="right-panel-collapsed-tab" onClick={() => setRightPanelOpen(true)} title={t("properties")}>
                <span>{t("properties")}</span>
              </button>
            )}
          </aside>
        )}
      </div>
      <StatusBar />
      <Backstage
        open={backstageOpen}
        onClose={() => setBackstageOpen(false)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenFile={(path) => { void openPathByExtension(path); }}
      />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} theme={theme} onThemeChange={setTheme} />
      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
      <ProjectSettingsDialog open={projectSettingsOpen} onClose={() => setProjectSettingsOpen(false)} />
      {welcomeOpen && (
        <WelcomeScreen
          onClose={() => setWelcomeOpen(false)}
          onNewProject={() => setProjectSettingsOpen(true)}
          onOpenProject={() => setBackstageOpen(true)}
          onOpenFile={(path) => console.log("Open file:", path)}
        />
      )}
    </>
  );
}

export default App;
