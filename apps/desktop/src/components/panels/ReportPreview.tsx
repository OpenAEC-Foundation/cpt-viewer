import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useCptStore } from "../../store/useCptStore";
import "./ReportPreview.css";

/**
 * PDF report preview — renders the openaec PDF in an iframe via a blob URL.
 *
 * Calls `preview_report` (Tauri) which combines the open CPTs from
 * `useCptStore` with the current `projectMeta` and returns PDF bytes.
 * Re-renders whenever the CPT list or project metadata changes.
 */
export default function ReportPreview() {
  const { t } = useTranslation("ribbon");
  const cpts = useCptStore((s) => Array.from(s.cpts.values()));
  const projectMeta = useCptStore((s) => s.projectMeta);

  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Track the active blob URL so we can revoke it on next render / unmount.
  const activeUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (cpts.length === 0) {
      if (activeUrlRef.current) {
        URL.revokeObjectURL(activeUrlRef.current);
        activeUrlRef.current = null;
      }
      setPdfUrl(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    invoke<number[]>("preview_report", {
      cptIds: cpts.map((c) => c.id),
      project: projectMeta,
    })
      .then((bytes) => {
        if (cancelled) return;
        const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        if (activeUrlRef.current) URL.revokeObjectURL(activeUrlRef.current);
        activeUrlRef.current = url;
        setPdfUrl(url);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cpts, projectMeta]);

  // Final cleanup on unmount.
  useEffect(() => {
    return () => {
      if (activeUrlRef.current) {
        URL.revokeObjectURL(activeUrlRef.current);
        activeUrlRef.current = null;
      }
    };
  }, []);

  if (cpts.length === 0) {
    return (
      <div className="report-preview">
        <div className="report-main">
          <div className="report-pages-wrapper">
            <div className="report-empty-state">
              <p className="report-empty-title">
                {t("report.noCpt", "Geen sonderingen geopend")}
              </p>
              <p className="report-empty-subtitle">
                {t("report.openCptHint", "Open een GEF of BRO-XML bestand om een rapport te genereren.")}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="report-preview">
        <div className="report-main">
          <div className="report-pages-wrapper">
            <div className="report-error">
              <p>{t("report.error", "Rapport-fout")}: {error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading || !pdfUrl) {
    return (
      <div className="report-preview">
        <div className="report-main">
          <div className="report-pages-wrapper">
            <div className="report-empty-state">
              <p className="report-empty-title">
                {t("report.generating", "Rapport genereren...")}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="report-preview">
      <div className="report-main">
        <div className="report-pages-wrapper">
          <iframe
            src={pdfUrl}
            title={t("report.preview", "Rapport preview")}
            className="report-iframe"
          />
        </div>
      </div>
    </div>
  );
}
