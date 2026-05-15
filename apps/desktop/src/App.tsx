import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
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
import IfcViewerPanel from "./components/panels/IfcViewerPanel";
import ReportPreview from "./components/panels/ReportPreview";
import { getDetachedParams, useWindowManager } from "./hooks/useWindowManager";
import { getSetting, setSetting } from "./store";
import "./themes.css";
import "./App.css";

const ThreeViewer = lazy(() => import("./components/panels/ThreeViewer"));

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
      case "ifc":
        return <IfcViewerPanel />;
      case "report":
        return <ReportPreview />;
      case "viewer":
        return (
          <Suspense fallback={<div className="placeholder"><p>Loading 3D Viewer...</p></div>}>
            <ThreeViewer />
          </Suspense>
        );
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
  const [startSidebarVisible, setStartSidebarVisible] = useState<boolean | null>(null);
  useEffect(() => {
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
      const newWidth = Math.max(160, Math.min(480, window.innerWidth - ev.clientX));
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

  // Full-width views (3D viewer, IFC viewer) hide the side panels
  const isFullWidthView = activeView === "viewer" || activeView === "ifc" || activeView === "report";

  const renderMainContent = () => {
    switch (activeView) {
      case "ifc":
        return <IfcViewerPanel />;
      case "report":
        return <ReportPreview />;
      case "viewer":
        return (
          <Suspense fallback={<div className="placeholder"><p>Loading 3D Viewer...</p></div>}>
            <ThreeViewer />
          </Suspense>
        );
      default:
        return (
          <div className="placeholder">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <h2>{t("noDocumentOpen")}</h2>
            <p>{t("noDocumentHint")}</p>
          </div>
        );
    }
  };

  return (
    <>
      <TitleBar onSettingsClick={() => setSettingsOpen(true)} onFeedbackClick={() => setFeedbackOpen(true)} />
      <Ribbon
        onFileTabClick={() => setBackstageOpen(true)}
        onSettingsClick={() => setSettingsOpen(true)}
        onProjectSettingsClick={() => setProjectSettingsOpen(true)}
        activeView={activeView}
        onViewChange={setActiveView}
      />
      <DocumentBar />
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
                <div className="left-panel-body">
                  <PanelSection title={t("section", { number: 1 })} defaultOpen>
                    <div className="panel-placeholder">{t("contentPlaceholder")}</div>
                  </PanelSection>
                  <PanelSection title={t("section", { number: 2 })} defaultOpen>
                    <div className="panel-placeholder">{t("contentPlaceholder")}</div>
                  </PanelSection>
                </div>
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
                <div className="right-panel-body">
                  <PanelSection title={t("section", { number: 1 })} defaultOpen>
                    <div className="panel-placeholder">{t("contentPlaceholder")}</div>
                  </PanelSection>
                  <PanelSection title={t("section", { number: 2 })} defaultOpen>
                    <div className="panel-placeholder">{t("contentPlaceholder")}</div>
                  </PanelSection>
                </div>
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
      <Backstage open={backstageOpen} onClose={() => setBackstageOpen(false)} onOpenSettings={() => setSettingsOpen(true)} onOpenFile={(path) => console.log("Open file:", path)} />
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

function PanelSection({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="panel-section">
      <button className="panel-section-header" onClick={() => setOpen(!open)}>
        <svg className={`panel-section-chevron${open ? " open" : ""}`} width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="2,3 5,6 8,3" /></svg>
        <span className="panel-section-title">{title}</span>
      </button>
      {open && <div className="panel-section-body">{children}</div>}
    </div>
  );
}

export default App;
