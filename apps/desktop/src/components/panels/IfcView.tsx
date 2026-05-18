import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useCptStore } from "../../store/useCptStore";

/**
 * IfcView — two horizontal panes (IFC4x3 on top, IFCX on the bottom).
 *
 * Both formats are auto-generated in the background by
 * `scheduleIfcGenerate` whenever a doc opens or its CPT list changes,
 * and the resulting text is stored in `ifcCache`. This view simply
 * reads from the cache — no fetch, no buttons. Empty states are either
 * "Bezig met genereren..." (CPTs exist but cache not ready yet) or
 * "Geen sonderingen" (project has no CPTs).
 */

type IfcFormat = "ifc4x3" | "ifcx";

const FORMAT_LABEL: Record<IfcFormat, string> = {
  ifc4x3: "IFC4x3",
  ifcx: "IFCX",
};

export default function IfcView() {
  const { t } = useTranslation("ribbon");

  // Subscribe to each primitive separately — returning a fresh object
  // from a single selector breaks Zustand v5's strict equality check and
  // produces "Maximum update depth exceeded" because every store update
  // (including unrelated ones) is seen as a change.
  const activeDocId = useCptStore((s) => s.activeDocId);
  const ifcCache = useCptStore((s) => s.ifcCache);
  const documents = useCptStore((s) => s.documents);

  const doc = activeDocId ? documents.find((d) => d.id === activeDocId) : undefined;
  const cached = doc ? ifcCache.get(doc.id) : undefined;
  const ifc4x3 = cached?.ifc4x3;
  const ifcx = cached?.ifcx;
  const cptCount = !doc
    ? 0
    : doc.kind === "cpt"
      ? 1
      : doc.kind === "project"
        ? doc.cpts.size
        : 0; // bore — IFC generation not yet supported
  const hasContent = cptCount > 0;

  return (
    <div className="ifc-view-twopane">
      <IfcPane
        format="ifc4x3"
        content={ifc4x3}
        hasContent={hasContent}
        t={t}
      />
      <IfcPane
        format="ifcx"
        content={ifcx}
        hasContent={hasContent}
        t={t}
      />
    </div>
  );
}

/**
 * One horizontal pane — either IFC4x3 (top) or IFCX (bottom). Renders
 * the format header + actions + scrollable body. Empty states explain
 * whether we're waiting for the background generator or whether the
 * doc has no CPTs to generate from.
 */
function IfcPane({
  format,
  content,
  hasContent,
  t,
}: {
  format: IfcFormat;
  content: string | undefined;
  hasContent: boolean;
  t: TFunction<"ribbon", undefined>;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  const onCopy = useCallback(async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1500);
    } catch (e) {
      console.error("clipboard write failed", e);
    }
  }, [content]);

  const onSaveAs = useCallback(async () => {
    if (!content) return;
    const defaultName = format === "ifcx" ? "export.ifcx.json" : "export.ifc";
    const target = await save({
      defaultPath: defaultName,
      filters: [
        format === "ifcx"
          ? { name: "IFCX JSON", extensions: ["json"] }
          : { name: "IFC4x3 STEP", extensions: ["ifc"] },
        { name: "Alles", extensions: ["*"] },
      ],
    });
    if (!target) return;
    try {
      await writeTextFile(target, content);
    } catch (e) {
      console.error("save failed", e);
    }
  }, [format, content]);

  return (
    <section className={`ifc-pane ifc-pane-${format}`}>
      <header className="ifc-pane-header">
        <div className="ifc-pane-title">
          <span className={`ifc-pane-badge ifc-pane-badge-${format}`}>
            {FORMAT_LABEL[format]}
          </span>
          {content && (
            <span className="ifc-pane-filename">
              {t("ifc.autoLive", "Live — automatisch gegenereerd")}
            </span>
          )}
        </div>
        <div className="ifc-pane-actions">
          <button
            type="button"
            className="ifc-pane-btn"
            onClick={() => void onCopy()}
            disabled={!content}
          >
            {copyState === "copied"
              ? t("ifc.copied", "Gekopieerd")
              : t("ifc.copy", "Kopieer")}
          </button>
          <button
            type="button"
            className="ifc-pane-btn"
            onClick={() => void onSaveAs()}
            disabled={!content}
          >
            {t("ifc.saveAs", "Opslaan als...")}
          </button>
        </div>
      </header>
      <div className="ifc-pane-body">
        {content ? (
          <pre className="ifc-pane-content">{content}</pre>
        ) : (
          <div className="ifc-pane-empty">
            {!hasContent ? (
              <p className="ifc-pane-empty-sub">
                {t(
                  "ifc.paneNoCpt",
                  "Geen sonderingen in project — voeg eerst een sondering toe.",
                )}
              </p>
            ) : (
              <p className="ifc-pane-empty-sub">
                {t("ifc.paneGenerating", "Bezig met genereren...")}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
