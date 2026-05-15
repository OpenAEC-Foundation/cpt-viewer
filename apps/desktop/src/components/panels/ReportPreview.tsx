import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  useReportStore,
  type ReportSectionToggles,
} from "../../stores/reportStore";
import "./ReportPreview.css";

interface ReportPreviewProps {
  /** Unused — kept for backward compat. PageSize/orientation now come from the store. */
  pageSize?: "A4" | "A3";
  orientation?: "portrait" | "landscape";
}

const SECTION_KEYS: Array<{ key: keyof ReportSectionToggles; labelKey: string; defaultLabel: string; alwaysOn?: boolean }> = [
  { key: "cover", labelKey: "report.sectionCover", defaultLabel: "Voorblad", alwaysOn: true },
  { key: "colofon", labelKey: "report.sectionColofon", defaultLabel: "Colofon" },
  { key: "toc", labelKey: "report.sectionToc", defaultLabel: "Inhoudsopgave" },
  { key: "introduction", labelKey: "report.sectionIntro", defaultLabel: "Inleiding" },
  { key: "content", labelKey: "report.sectionContent", defaultLabel: "Inhoud" },
  { key: "appendices", labelKey: "report.sectionAppendices", defaultLabel: "Bijlagen" },
  { key: "backcover", labelKey: "report.sectionBackcover", defaultLabel: "Achterblad" },
];

export default function ReportPreview(_props: ReportPreviewProps) {
  const { t } = useTranslation("ribbon");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const pageSize = useReportStore((s) => s.pageSize);
  const orientation = useReportStore((s) => s.orientation);
  const report = useReportStore((s) => s.report);
  const sectionToggles = useReportStore((s) => s.sectionToggles);
  const setSectionToggle = useReportStore((s) => s.setSectionToggle);
  const resetSectionToggles = useReportStore((s) => s.resetSectionToggles);
  const pdfBlobUrl = useReportStore((s) => s.pdfBlobUrl);
  const generatedAt = useReportStore((s) => s.generatedAt);
  const isGenerating = useReportStore((s) => s.isGenerating);
  const error = useReportStore((s) => s.error);
  const generatePdf = useReportStore((s) => s.generatePdf);

  const handleGenerate = useCallback(() => {
    generatePdf();
  }, [generatePdf]);

  const iframeKey = generatedAt ?? 0;
  const generatedTime = generatedAt
    ? new Date(generatedAt).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  return (
    <div className="report-preview">
      {/* ─── Left sidebar (collapsible): section toggles ─── */}
      {sidebarOpen ? (
        <aside className="report-sidebar">
          <div className="report-sidebar-header">
            <span className="report-sidebar-title">{t("report.sections")}</span>
            <button
              className="report-sidebar-toggle"
              onClick={() => setSidebarOpen(false)}
              title="Inklappen"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          </div>

          <div className="report-sidebar-body">
            <p className="report-sidebar-hint">
              {t("report.sectionsHint", "Kies welke onderdelen in het rapport komen.")}
            </p>

            <div className="report-section-list">
              {SECTION_KEYS.map(({ key, labelKey, defaultLabel, alwaysOn }) => (
                <label
                  key={key}
                  className={`report-section-toggle${alwaysOn ? " always-on" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={alwaysOn ? true : sectionToggles[key]}
                    disabled={alwaysOn}
                    onChange={(e) => setSectionToggle(key, e.target.checked)}
                  />
                  <span>{t(labelKey, defaultLabel)}</span>
                </label>
              ))}
            </div>

            <button className="report-reset-btn" onClick={resetSectionToggles}>
              {t("report.resetSections", "Alles aan")}
            </button>

            <div className="report-sidebar-meta">
              <div className="report-meta-row">
                <span className="report-meta-label">Pagina:</span>
                <span>{pageSize} · {orientation === "portrait" ? "Portret" : "Landschap"}</span>
              </div>
              {report.project && (
                <div className="report-meta-row">
                  <span className="report-meta-label">Project:</span>
                  <span>{report.project}</span>
                </div>
              )}
              {generatedTime && (
                <div className="report-meta-row">
                  <span className="report-meta-label">Laatst:</span>
                  <span>{generatedTime}</span>
                </div>
              )}
            </div>
          </div>
        </aside>
      ) : (
        <button
          className="report-sidebar-collapsed"
          onClick={() => setSidebarOpen(true)}
          title={t("report.sections")}
        >
          <span>{t("report.sections")}</span>
        </button>
      )}

      {/* ─── Main: PDF preview ─── */}
      <div className="report-main">
        <div className="report-toolbar">
          <span className="report-page-info">
            {pageSize} · {orientation === "portrait" ? "Portret" : "Landschap"}
            {report.project && ` · ${report.project}`}
            {generatedTime && (
              <span className="report-generated-time"> · gegenereerd {generatedTime}</span>
            )}
          </span>
          <button
            className="report-generate-btn"
            onClick={handleGenerate}
            disabled={isGenerating}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <path d="M14 2v6h6" />
              <path d="M12 18v-6m-3 3h6" />
            </svg>
            {isGenerating
              ? t("report.generating", "Bezig...")
              : pdfBlobUrl
                ? t("report.regenerate", "Hergenereren")
                : t("report.generate", "Genereer PDF")}
          </button>
        </div>

        <div className="report-pages-wrapper">
          {error && (
            <div className="report-error">
              <p>{error}</p>
            </div>
          )}

          {pdfBlobUrl ? (
            <iframe
              key={iframeKey}
              src={pdfBlobUrl}
              title="Rapport preview"
              className="report-iframe"
            />
          ) : (
            <div className="report-empty-state">
              <div className="report-empty-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--theme-text-muted)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
              </div>
              <p className="report-empty-title">{t("report.noPreview", "Nog geen rapport gegenereerd")}</p>
              <p className="report-empty-subtitle">
                {t("report.emptyHint", 'Klik op "Genereer PDF" om een rapport te maken')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
