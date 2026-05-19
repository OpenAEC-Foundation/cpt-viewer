import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useCptStore } from "../../store/useCptStore";

/**
 * IfcView — twee-koloms representatie van het actieve document:
 *
 *   Links: IFC4x3 STEP (auto-gegenereerd, syntax-highlighted STEP-tekst)
 *   Rechts: IFCX (JSON-flavoured IFC5 representatie)
 *
 * Beide formats worden door `scheduleIfcGenerate` op de achtergrond
 * gegenereerd en in `ifcCache` opgeslagen. Side-by-side zodat de
 * gebruiker de twee uitvoeringen rechtstreeks kan vergelijken — was
 * voorheen drie tabs (Parsed/IFC4x3/IFCX) maar de tab-switcher
 * verhinderde directe vergelijking.
 */

export default function IfcView() {
  const { t } = useTranslation("ribbon");

  // Subscribe per primitive (Zustand v5 strict-equal).
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
        : 0;
  const hasCptContent = cptCount > 0;

  return (
    <div className="ifc-view-split">
      <div className="ifc-split-col ifc-split-col-left">
        <IfcPane
          format="ifc4x3"
          content={ifc4x3}
          hasContent={hasCptContent}
          t={t}
        />
      </div>
      <div className="ifc-split-divider" aria-hidden />
      <div className="ifc-split-col ifc-split-col-right">
        <IfcPane
          format="ifcx"
          content={ifcx}
          hasContent={hasCptContent}
          t={t}
        />
      </div>
    </div>
  );
}


/**
 * One pane for IFC4x3 / IFCX. Renders the format header + actions +
 * scrollable body. Empty states explain whether we're waiting for the
 * background generator or whether the doc has no CPTs to generate from.
 */
type IfcFormat = "ifc4x3" | "ifcx";
const FORMAT_LABEL: Record<IfcFormat, string> = {
  ifc4x3: "IFC4x3",
  ifcx: "IFCX",
};

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

  const highlighted = useMemo(() => {
    if (!content) return null;
    return format === "ifc4x3" ? highlightStep(content) : highlightJson(content);
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
        </div>
      </header>
      <div className="ifc-pane-body">
        {highlighted ? (
          <pre
            className={`ifc-pane-content ifc-syntax ifc-syntax-${format}`}
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
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

/* ─────────────────────────────────────────────────────────────────────
   Syntax highlighting — identiek aan de vorige IfcView versie.
   ─────────────────────────────────────────────────────────────────── */

const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};
function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => HTML_ESCAPE[c] ?? c);
}

const STEP_KEYWORDS = new Set([
  "ISO-10303-21",
  "HEADER",
  "DATA",
  "ENDSEC",
  "END-ISO-10303-21",
  "FILE_DESCRIPTION",
  "FILE_NAME",
  "FILE_SCHEMA",
]);

function highlightStep(src: string): string {
  const len = src.length;
  let i = 0;
  let out = "";
  const push = (kind: string, text: string) => {
    out += `<span class="ifc-tok-${kind}">${escapeHtml(text)}</span>`;
  };
  while (i < len) {
    const c = src[i];
    if (c === "'") {
      let j = i + 1;
      while (j < len) {
        if (src[j] === "'") {
          if (src[j + 1] === "'") { j += 2; continue; }
          j++;
          break;
        }
        j++;
      }
      push("str", src.slice(i, j));
      i = j;
      continue;
    }
    if (c === "#" && i + 1 < len && src[i + 1] >= "0" && src[i + 1] <= "9") {
      let j = i + 1;
      while (j < len && src[j] >= "0" && src[j] <= "9") j++;
      push("ref", src.slice(i, j));
      i = j;
      continue;
    }
    if (c === "$" || c === "*") {
      push("nil", c);
      i++;
      continue;
    }
    if (isStepIdStart(c)) {
      let j = i + 1;
      while (j < len) {
        const ch = src[j];
        if (isStepIdPart(ch)) { j++; continue; }
        if (ch === "-" && j + 1 < len && isStepIdStart(src[j + 1])) {
          j++;
          continue;
        }
        break;
      }
      const word = src.slice(i, j);
      let kind: string;
      if (STEP_KEYWORDS.has(word)) {
        kind = "kw";
      } else if (word.startsWith("IFC") && src[j] === "(") {
        kind = "entity";
      } else {
        kind = "ident";
      }
      push(kind, word);
      i = j;
      continue;
    }
    if (isStepNumberStart(src, i)) {
      let j = i;
      if (src[j] === "+" || src[j] === "-") j++;
      while (j < len && src[j] >= "0" && src[j] <= "9") j++;
      if (src[j] === ".") {
        j++;
        while (j < len && src[j] >= "0" && src[j] <= "9") j++;
      }
      if (src[j] === "e" || src[j] === "E") {
        j++;
        if (src[j] === "+" || src[j] === "-") j++;
        while (j < len && src[j] >= "0" && src[j] <= "9") j++;
      }
      push("num", src.slice(i, j));
      i = j;
      continue;
    }
    out += escapeHtml(c);
    i++;
  }
  return out;
}

function isStepIdStart(c: string): boolean {
  return (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c === "_";
}
function isStepIdPart(c: string): boolean {
  return isStepIdStart(c) || (c >= "0" && c <= "9");
}
function isStepNumberStart(s: string, i: number): boolean {
  const c = s[i];
  if (c >= "0" && c <= "9") return true;
  if ((c === "+" || c === "-") && i + 1 < s.length) {
    const n = s[i + 1];
    if (n >= "0" && n <= "9") return true;
    if (n === ".") {
      const n2 = s[i + 2];
      return !!n2 && n2 >= "0" && n2 <= "9";
    }
  }
  if (c === ".") {
    const n = s[i + 1];
    return !!n && n >= "0" && n <= "9";
  }
  return false;
}

function highlightJson(src: string): string {
  const len = src.length;
  let i = 0;
  let out = "";
  const push = (kind: string, text: string) => {
    out += `<span class="ifc-tok-${kind}">${escapeHtml(text)}</span>`;
  };
  while (i < len) {
    const c = src[i];
    if (c === '"') {
      let j = i + 1;
      while (j < len) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === '"') { j++; break; }
        j++;
      }
      let k = j;
      while (k < len && (src[k] === " " || src[k] === "\t")) k++;
      push(src[k] === ":" ? "key" : "str", src.slice(i, j));
      i = j;
      continue;
    }
    if (isStepNumberStart(src, i)) {
      let j = i;
      if (src[j] === "+" || src[j] === "-") j++;
      while (j < len && src[j] >= "0" && src[j] <= "9") j++;
      if (src[j] === ".") {
        j++;
        while (j < len && src[j] >= "0" && src[j] <= "9") j++;
      }
      if (src[j] === "e" || src[j] === "E") {
        j++;
        if (src[j] === "+" || src[j] === "-") j++;
        while (j < len && src[j] >= "0" && src[j] <= "9") j++;
      }
      push("num", src.slice(i, j));
      i = j;
      continue;
    }
    if (c >= "a" && c <= "z") {
      let j = i + 1;
      while (j < len && src[j] >= "a" && src[j] <= "z") j++;
      const word = src.slice(i, j);
      if (word === "true" || word === "false" || word === "null") {
        push("nil", word);
      } else {
        out += escapeHtml(word);
      }
      i = j;
      continue;
    }
    if (c === "{" || c === "}" || c === "[" || c === "]") {
      push("punct", c);
      i++;
      continue;
    }
    out += escapeHtml(c);
    i++;
  }
  return out;
}
