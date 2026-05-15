import { useTranslation } from "react-i18next";
import { setSetting } from "../../store";
import { useRecentFiles } from "../../hooks/useRecentFiles";
import "./WelcomeScreen.css";

interface WelcomeScreenProps {
  onClose: () => void;
  onNewProject: () => void;
  onOpenProject: () => void;
  onOpenFile?: (path: string) => void;
}

export default function WelcomeScreen({ onClose, onNewProject, onOpenProject, onOpenFile }: WelcomeScreenProps) {
  const { t } = useTranslation("common");
  const { recentFiles } = useRecentFiles();

  const handleNewProject = () => {
    onNewProject();
    onClose();
  };

  const handleOpenProject = () => {
    onOpenProject();
    onClose();
  };

  const handleSkip = async () => {
    onClose();
  };

  const handleToggleStartup = async (show: boolean) => {
    await setSetting("showWelcome", show);
  };

  return (
    <div className="welcome-overlay">
      <div className="welcome-dialog">
        <div className="welcome-header">
          <div className="welcome-logo">
            <svg viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="40" y="40" width="944" height="944" rx="180" fill="var(--theme-accent)" />
              <text x="512" y="580" textAnchor="middle" dominantBaseline="middle" fill="var(--theme-accent-text)" fontSize="340" fontFamily="Arial, sans-serif" fontWeight="400">OA</text>
            </svg>
          </div>
          <div className="welcome-title-area">
            <h1 className="welcome-title">{t("appName")}</h1>
            <p className="welcome-subtitle">{t("welcome.subtitle")}</p>
          </div>
        </div>

        <div className="welcome-body">
          <div className="welcome-actions">
            <h2>{t("welcome.getStarted")}</h2>
            <button className="welcome-action-btn primary" onClick={handleNewProject}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <path d="M14 2v6h6" />
                <path d="M12 18v-6m-3 3h6" />
              </svg>
              <div>
                <strong>{t("welcome.newProject")}</strong>
                <span>{t("welcome.newProjectDesc")}</span>
              </div>
            </button>
            <button className="welcome-action-btn" onClick={handleOpenProject}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
              <div>
                <strong>{t("welcome.openProject")}</strong>
                <span>{t("welcome.openProjectDesc")}</span>
              </div>
            </button>
          </div>

          <div className="welcome-recent">
            <h2>{t("welcome.recent")}</h2>
            {recentFiles.length === 0 ? (
              <p className="welcome-empty">{t("welcome.noRecent")}</p>
            ) : (
              <div className="welcome-recent-list">
                {recentFiles.map((f, i) => (
                  <button key={i} className="welcome-recent-item" onClick={() => { onOpenFile?.(f.path); onClose(); }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                      <path d="M14 2v6h6" />
                    </svg>
                    <div className="welcome-recent-info">
                      <span className="welcome-recent-name">{f.name}</span>
                      <span className="welcome-recent-path">{f.path}</span>
                    </div>
                    <span className="welcome-recent-date">
                      {new Date(f.timestamp).toLocaleDateString()}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="welcome-footer">
          <label className="welcome-checkbox">
            <input
              type="checkbox"
              defaultChecked={true}
              onChange={(e) => handleToggleStartup(e.target.checked)}
            />
            {t("welcome.showOnStartup")}
          </label>
          <button className="welcome-skip-btn" onClick={handleSkip}>
            {t("welcome.skip")}
          </button>
        </div>
      </div>
    </div>
  );
}
