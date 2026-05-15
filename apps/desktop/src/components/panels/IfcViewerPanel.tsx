import { useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import "./IfcViewerPanel.css";

// ── BuildingSMART documentation links ─────────────────────────

const IFC4_DOCS_BASE = "https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/lexical/";
function getIfcDocsUrl(entityType: string): string {
  // Normalize: IFCWALL -> IfcWall, IfcWall -> IfcWall
  const normalized = entityType.startsWith("IFC")
    ? "Ifc" + entityType.slice(3).toLowerCase().replace(/(^|_)(\w)/g, (_m, _p, c) => c.toUpperCase())
    : entityType;
  return `${IFC4_DOCS_BASE}${normalized}.htm`;
}

function openIfcDocs(entityType: string, e: React.MouseEvent) {
  e.stopPropagation();
  const url = getIfcDocsUrl(entityType);
  // Use Tauri shell opener if available, otherwise window.open
  import("@tauri-apps/plugin-opener").then(({ openUrl }) => {
    openUrl(url);
  }).catch(() => {
    window.open(url, "_blank", "noopener");
  });
}

// ── Syntax highlighting for IFC4 STEP ─────────────────────────

const STEP_KEYWORDS = new Set([
  "ISO-10303-21", "HEADER", "ENDSEC", "DATA", "END-ISO-10303-21",
  "FILE_DESCRIPTION", "FILE_NAME", "FILE_SCHEMA",
]);

function highlightStepLine(text: string): React.ReactNode {
  const tokens: React.ReactNode[] = [];
  const re = /(#\d+)|(IFC[A-Z][A-Z0-9_]+)|([A-Z_][A-Z_0-9]{3,})|('(?:[^'\\]|\\.)*')|(\.[A-Z_]+\.)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) tokens.push(text.slice(last, match.index));
    const [full] = match;
    if (match[1]) {
      tokens.push(<span key={key++} className="step-entity-ref">{full}</span>);
    } else if (match[2]) {
      // IFC entity type -> clickable link to BuildingSMART docs
      tokens.push(
        <a
          key={key++}
          className="step-entity-type step-link"
          title={`${full} — BuildingSMART docs`}
          onClick={(e) => openIfcDocs(full, e)}
        >
          {full}
        </a>
      );
    } else if (STEP_KEYWORDS.has(full)) {
      tokens.push(<span key={key++} className="step-keyword">{full}</span>);
    } else if (match[4]) {
      tokens.push(<span key={key++} className="step-string">{full}</span>);
    } else if (match[5]) {
      tokens.push(<span key={key++} className="step-enum">{full}</span>);
    } else {
      tokens.push(full);
    }
    last = match.index + full.length;
  }
  if (last < text.length) tokens.push(text.slice(last));
  return <>{tokens}</>;
}

// ── Syntax highlighting for IFCX JSON ─────────────────────────

function highlightJson(json: string): React.ReactNode {
  const tokens: React.ReactNode[] = [];
  const re = /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|(true|false|null)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],])/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = re.exec(json)) !== null) {
    if (match.index > last) tokens.push(json.slice(last, match.index));
    const [full] = match;
    if (match[1]) {
      tokens.push(<span key={key++} className="step-entity-type">{full}</span>);
    } else if (match[2]) {
      // Check if the string value is an IFC entity type (e.g. "IfcWall", "IfcSite")
      const inner = full.slice(1, -1); // strip quotes
      if (/^Ifc[A-Z][a-zA-Z]+$/.test(inner)) {
        tokens.push(
          <a
            key={key++}
            className="step-string step-link"
            title={`${inner} — BuildingSMART docs`}
            onClick={(e) => openIfcDocs(inner, e)}
          >
            {full}
          </a>
        );
      } else {
        tokens.push(<span key={key++} className="step-string">{full}</span>);
      }
    } else if (match[3]) {
      tokens.push(<span key={key++} className="step-enum">{full}</span>);
    } else if (match[4]) {
      tokens.push(<span key={key++} className="step-entity-ref">{full}</span>);
    } else if (match[5]) {
      tokens.push(<span key={key++} className="step-keyword">{full}</span>);
    } else {
      tokens.push(full);
    }
    last = match.index + full.length;
  }
  if (last < json.length) tokens.push(json.slice(last));
  return <>{tokens}</>;
}

// ── Sample data ───────────────────────────────────────────────

const SAMPLE_STEP = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('sample.ifc','2026-03-23T12:00:00',(''),(''),'','OpenAEC Template','');
FILE_SCHEMA(('IFC4'));
ENDSEC;

DATA;
#1=IFCPROJECT('0YvctVUKvCZxI',#2,'Sample Project',$,$,$,$,(#20),#7);
#2=IFCOWNERHISTORY(#3,#6,$,.NOCHANGE.,$,$,$,0);
#3=IFCPERSONANDORGANIZATION(#4,#5,$);
#4=IFCPERSON($,'Engineer',$,$,$,$,$,$);
#5=IFCORGANIZATION($,'OpenAEC Foundation',$,$,$);
#6=IFCAPPLICATION(#5,'0.1.0','Open Template','OpenTemplate');
#7=IFCUNITASSIGNMENT((#8,#9,#10));
#8=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#9=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);
#10=IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);
#20=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.0E-05,#21,$);
#21=IFCAXIS2PLACEMENT3D(#22,$,$);
#22=IFCCARTESIANPOINT((0.,0.,0.));
#30=IFCSITE('3De4wG8izHuO0',#2,'Default Site',$,$,#31,$,$,.ELEMENT.,$,$,$,$,$);
#31=IFCLOCALPLACEMENT($,#21);
#40=IFCBUILDING('0FmgI$EcvBNOz',#2,'Default Building',$,$,#41,$,$,.ELEMENT.,$,$,$);
#41=IFCLOCALPLACEMENT(#31,#21);
#50=IFCBUILDINGSTOREY('1wnBb0bT17RAR',#2,'Ground Floor',$,$,#51,$,$,.ELEMENT.,0.);
#51=IFCLOCALPLACEMENT(#41,#21);
#60=IFCRELAGGREGATES('2M0VDqHHrF$xR',#2,$,$,#1,(#30));
#61=IFCRELAGGREGATES('3WUw$nXaj9QQX',#2,$,$,#30,(#40));
#62=IFCRELAGGREGATES('1Z7kPrWHb6Awm',#2,$,$,#40,(#50));
ENDSEC;

END-ISO-10303-21;`;

const SAMPLE_IFCX = {
  schema: "IFCX",
  version: "0.1",
  header: {
    description: "IFCX export from Open Template",
    timestamp: new Date().toISOString(),
    application: "Open Template",
    applicationVersion: "0.1.0",
    originating_system: "OpenAEC Foundation",
  },
  units: {
    length: "MILLIMETRE",
    area: "SQUARE_METRE",
    volume: "CUBIC_METRE",
    angle: "RADIAN",
  },
  project: {
    globalId: "0YvctVUKvCZxI",
    name: "Sample Project",
    spatialStructure: {
      type: "IfcSite",
      name: "Default Site",
      children: [
        {
          type: "IfcBuilding",
          name: "Default Building",
          children: [
            {
              type: "IfcBuildingStorey",
              name: "Ground Floor",
              elevation: 0.0,
              children: [],
            },
          ],
        },
      ],
    },
  },
  data: [],
};

// ── Components ────────────────────────────────────────────────

function StepViewer({ content }: { content: string }) {
  const { t } = useTranslation("ribbon");
  const [copied, setCopied] = useState(false);

  const lines = useMemo(
    () => content.split("\n").map((text, i) => ({ lineNumber: i + 1, text })),
    [content]
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = content;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  const handleExport = useCallback(() => {
    const blob = new Blob([content], { type: "application/x-step" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "model.ifc";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [content]);

  const size = new Blob([content]).size;
  const sizeLabel = size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`;

  return (
    <div className="ifc-viewer-pane">
      <div className="ifc-viewer-toolbar">
        <span className="ifc-viewer-label">IFC4 STEP</span>
        <span className="ifc-viewer-stats">{lines.length} {t("ifc.lines")} &middot; {sizeLabel}</span>
        <div className="ifc-viewer-actions">
          <button onClick={handleCopy} title={t("copy")}>
            {copied ? "\u2713" : "\u2398"}
          </button>
          <button onClick={handleExport} title={t("export")}>
            .ifc
          </button>
        </div>
      </div>
      <div className="ifc-viewer-code">
        <table className="ifc-viewer-table">
          <tbody>
            {lines.map((line) => (
              <tr key={line.lineNumber}>
                <td className="ifc-viewer-linenum">{line.lineNumber}</td>
                <td className="ifc-viewer-text">{highlightStepLine(line.text)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function IfcxViewer({ content }: { content: string }) {
  const { t } = useTranslation("common");
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = content;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  const handleExport = useCallback(() => {
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "model.ifcx";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [content]);

  const size = new Blob([content]).size;
  const sizeLabel = size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`;

  return (
    <div className="ifc-viewer-pane">
      <div className="ifc-viewer-toolbar">
        <span className="ifc-viewer-label">IFCX JSON</span>
        <span className="ifc-viewer-stats">{sizeLabel}</span>
        <div className="ifc-viewer-actions">
          <button onClick={handleCopy} title={t("copy")}>
            {copied ? "\u2713" : "\u2398"}
          </button>
          <button onClick={handleExport} title={t("export")}>
            .ifcx
          </button>
        </div>
      </div>
      <div className="ifc-viewer-code">
        <pre className="ifc-viewer-json">{highlightJson(content)}</pre>
      </div>
    </div>
  );
}

// ── IFC Spatial Structure Browser ─────────────────────────────

interface TreeNode {
  type: string;
  name: string;
  count?: number;
  children?: TreeNode[];
}

const SAMPLE_TREE: TreeNode = {
  type: "IfcProject",
  name: "Sample Project",
  children: [
    {
      type: "IfcSite",
      name: "Default Site",
      children: [
        {
          type: "IfcBuilding",
          name: "Default Building",
          children: [
            {
              type: "IfcBuildingStorey",
              name: "Ground Floor",
              children: [
                { type: "IfcWall", name: "Walls", count: 5 },
                { type: "IfcSlab", name: "Slabs", count: 2 },
                { type: "IfcBeam", name: "Beams", count: 3 },
                { type: "IfcColumn", name: "Columns", count: 4 },
                { type: "IfcSpace", name: "Spaces", count: 2 },
              ],
            },
            {
              type: "IfcBuildingStorey",
              name: "First Floor",
              children: [
                { type: "IfcWall", name: "Walls", count: 4 },
                { type: "IfcSlab", name: "Slabs", count: 1 },
                { type: "IfcBeam", name: "Beams", count: 2 },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const TYPE_COLORS: Record<string, string> = {
  IfcProject: "#c084fc",
  IfcSite: "#34d399",
  IfcBuilding: "#60a5fa",
  IfcBuildingStorey: "#fbbf24",
  IfcWall: "#fb923c",
  IfcSlab: "#f472b6",
  IfcBeam: "#a78bfa",
  IfcColumn: "#38bdf8",
  IfcSpace: "#4ade80",
};

function TreeItem({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 3);
  const hasChildren = node.children && node.children.length > 0;
  const color = TYPE_COLORS[node.type] || "var(--theme-text-secondary)";

  return (
    <div className="ifc-tree-item">
      <button
        className="ifc-tree-row"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        {hasChildren ? (
          <svg className={`ifc-tree-chevron${expanded ? " open" : ""}`} width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
            <polyline points="3,2 7,5 3,8" />
          </svg>
        ) : (
          <span className="ifc-tree-dot" style={{ background: color }} />
        )}
        <a
          className="ifc-tree-type step-link"
          style={{ color }}
          title={`${node.type} — BuildingSMART docs`}
          onClick={(e) => openIfcDocs(node.type, e)}
        >{node.type}</a>
        <span className="ifc-tree-name">{node.name}</span>
        {node.count != null && <span className="ifc-tree-count">{node.count}</span>}
      </button>
      {expanded && hasChildren && (
        <div className="ifc-tree-children">
          {node.children!.map((child, i) => (
            <TreeItem key={i} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function StructureBrowser() {
  const { t } = useTranslation("ribbon");

  return (
    <div className="ifc-structure-pane">
      <div className="ifc-viewer-toolbar">
        <span className="ifc-viewer-label">{t("ifc.structure")}</span>
      </div>
      <div className="ifc-structure-tree">
        <TreeItem node={SAMPLE_TREE} />
      </div>
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────

export default function IfcViewerPanel() {
  const stepContent = SAMPLE_STEP;
  const ifcxContent = JSON.stringify(SAMPLE_IFCX, null, 2);

  return (
    <div className="ifc-viewer-panel">
      <StructureBrowser />
      <div className="ifc-viewer-divider" />
      <StepViewer content={stepContent} />
      <div className="ifc-viewer-divider" />
      <IfcxViewer content={ifcxContent} />
    </div>
  );
}
