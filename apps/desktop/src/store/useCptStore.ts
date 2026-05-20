import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Cpt, ProjectMeta } from "../types/cpt";
import type { Bore } from "../types/bore";
import { parseBhrgtXml, looksLikeBoringXml } from "../types/bore";
import {
  setPendingTekeningRestore,
  tekeningStateFromIfcgis,
  titleBlockFromIfcgis,
} from "./tekeningState";

// ─── Document model ──────────────────────────────────────────────
//
// Every tab in the DocumentBar is an "AppDocument" — either a single
// standalone CPT (sondering), a single BHR-GT borehole (boring) or a
// project (.ifcgis) which contains a ProjectMeta + multiple CPTs. The
// active document determines what the chart, panels, and right panel
// render.

export type DocumentKind = "cpt" | "bore" | "project" | "gwp";

export interface CptDocument {
  kind: "cpt";
  id: string;            // tab id
  title: string;         // shown in tab — typically filename
  path?: string;
  cpt: Cpt;
}

export interface BoreDocument {
  kind: "bore";
  id: string;
  title: string;
  path?: string;
  bore: Bore;
  /** Origineel BHR-XML, bewaard zodat de verkenner een "Ruwe data"-
   *  paneel kan tonen. Geen Rust roundtrip nodig — alle borings
   *  worden client-side geparsed dus we hebben de tekst toch al. */
  rawXml?: string;
}

export interface GwpDocument {
  kind: "gwp";
  id: string;
  title: string;
  path?: string;
  gwp: import("../types/gwp").Gwp;
  /** Origineel GMW-XML. */
  rawXml?: string;
}

export interface ProjectDocument {
  kind: "project";
  id: string;
  title: string;         // shown in tab — typically project meta title
  path?: string;
  meta: ProjectMeta;
  cpts: Map<string, Cpt>;
  /** Boringen die bij dit project horen (BHR-GT XML, geparsed client-
   *  side). Net als `cpts` keyed by id zodat dedup + remove eenvoudig
   *  blijft. Bores worden meegeschreven naar de `bores`-sectie van
   *  het .ifcx-bestand. */
  bores: Map<string, Bore>;
  activeCptId: string | null;
}

export type AppDocument =
  | CptDocument
  | BoreDocument
  | ProjectDocument
  | GwpDocument;

interface HoveredPoint {
  depth: number;
  depthNap?: number;
  qc?: number;
  fs?: number;
  rf?: number;
  u2?: number;
  soil?: string;
}

const today = () => new Date().toISOString().slice(0, 10);

const DEFAULT_PROJECT_META: ProjectMeta = {
  title: "Nieuw project",
  client: "",
  location: "",
  project_number: "",
  author: "",
  date: today(),
};

interface DocStore {
  // ── New doc-tab state ───────────────────────────────
  documents: AppDocument[];
  activeDocId: string | null;

  // ── Derived (kept in sync via every set) ────────────
  cpts: Map<string, Cpt>;
  activeCptId: string | null;
  projectMeta: ProjectMeta;
  hoveredPoint: HoveredPoint | null;

  /**
   * Last-known map viewport (lat / lon / zoom) — updated by MapView on
   * every `moveend` so that other map-based views (notably the
   * Sonderingstekening paper view) can default to the same location
   * instead of recentring on the geographic middle of NL.
   * `null` until the user has actually moved the Kaart at least once.
   */
  lastMapView: { lat: number; lon: number; zoom: number } | null;

  /** Per-CPT visibility flag — present means hidden from the chart and map.
   *  Cleaned up automatically by `closeCpt` so stale ids don't accumulate. */
  hiddenCptIds: Set<string>;

  /**
   * Project-wide CPT selectie (multi-select op de Kaart-tab). De Map
   * laat de gebruiker met Ctrl/Cmd+klik markers toevoegen aan de
   * selectie, of met Shift+drag een rechthoek trekken. Andere views
   * (LeftPanel, Situatietekening) kunnen op de selectie reageren —
   * b.v. om alleen de geselecteerde sonderingen op een tekening te
   * plaatsen of in bulk te verbergen. Wordt automatisch leeggemaakt
   * als het actieve document wisselt.
   */
  selectedCptIds: Set<string>;
  /** Voeg of verwijder één CPT uit de selectie. */
  toggleCptSelection: (id: string) => void;
  /** Zet (of voeg toe aan) een hele lijst van CPT-ids. `replace=true`
   *  vervangt de huidige selectie, `false` (default) voegt ze toe. */
  selectCpts: (ids: string[], replace?: boolean) => void;
  /** Maak de hele selectie leeg. */
  clearCptSelection: () => void;

  /**
   * Pre-rendered PDF bytes keyed by document id. Populated in the
   * background by `schedulePdfPreview` so the Rapport tab can swap in
   * an instant preview instead of waiting for a fresh `preview_report`
   * roundtrip. Invalidated whenever the doc's CPT list or project meta
   * changes (see `invalidatePdfCache`).
   */
  pdfCache: Map<string, Uint8Array>;
  setPdfCache: (docId: string, bytes: Uint8Array) => void;
  invalidatePdfCache: (docId: string) => void;

  /**
   * Pre-rendered IFC text keyed by document id. Populated in the
   * background by `scheduleIfcGenerate` whenever a doc opens or its
   * CPT list/meta changes — so the IFC tab is always live without the
   * user clicking "Genereer". Both formats are cached side-by-side.
   */
  ifcCache: Map<string, { ifc4x3?: string; ifcx?: string }>;
  setIfcCacheEntry: (docId: string, format: "ifc4x3" | "ifcx", content: string) => void;
  invalidateIfcCache: (docId: string) => void;

  // ── Doc-level operations ────────────────────────────
  setActiveDoc: (id: string | null) => void;
  closeDoc: (id: string) => Promise<void>;

  // ── Within-doc operations ───────────────────────────
  /** For project docs, switches the active CPT inside the project.
   *  For CPT docs, no-op (a CPT doc only ever has one CPT). */
  setActive: (id: string | null) => void;
  /** Removes a CPT. Project: removes from the project's CPT map.
   *  CPT doc: closes the entire document. */
  closeCpt: (id: string) => Promise<void>;
  /** Closes the active doc (or all CPTs in active project). */
  closeAll: () => Promise<void>;
  /** Toggles a CPT's visibility (eye / eye-slash). Hidden CPTs stay in the
   *  project but are filtered out of chart, main map, and mini map. */
  toggleHidden: (id: string) => void;

  // ── Project meta / hover ─────────────────────────────
  setProjectMeta: (m: Partial<ProjectMeta>) => void;
  setHover: (p: HoveredPoint | null) => void;
  setLastMapView: (v: { lat: number; lon: number; zoom: number }) => void;
}

// ── Helpers ───────────────────────────────────────────

function deriveFromActive(documents: AppDocument[], activeDocId: string | null) {
  const active = documents.find((d) => d.id === activeDocId);
  if (!active) {
    return {
      cpts: new Map<string, Cpt>(),
      activeCptId: null as string | null,
      projectMeta: { ...DEFAULT_PROJECT_META },
    };
  }
  if (active.kind === "cpt") {
    return {
      cpts: new Map<string, Cpt>([[active.cpt.id, active.cpt]]),
      activeCptId: active.cpt.id,
      projectMeta: { ...DEFAULT_PROJECT_META },
    };
  }
  if (active.kind === "bore") {
    // Boring documents have no CPT data — clear the chart-related
    // derived state so the chart doesn't keep rendering the prior CPT.
    // Title becomes the boring id so any header that reads projectMeta
    // gets a sensible label.
    return {
      cpts: new Map<string, Cpt>(),
      activeCptId: null as string | null,
      projectMeta: { ...DEFAULT_PROJECT_META, title: active.bore.id || active.title },
    };
  }
  if (active.kind === "gwp") {
    // Grondwaterput-documenten hebben geen CPT-data. Net als bij
    // boringen wissen we de chart-state en zetten we de meta-title
    // op de bro-id zodat een eventuele header iets zinnigs toont.
    return {
      cpts: new Map<string, Cpt>(),
      activeCptId: null as string | null,
      projectMeta: { ...DEFAULT_PROJECT_META, title: active.gwp.broId || active.title },
    };
  }
  // project
  return {
    cpts: active.cpts,
    activeCptId: active.activeCptId,
    projectMeta: active.meta,
  };
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Store ─────────────────────────────────────────────

export const useCptStore = create<DocStore>((set, get) => ({
  documents: [],
  activeDocId: null,

  cpts: new Map(),
  activeCptId: null,
  projectMeta: { ...DEFAULT_PROJECT_META },
  hoveredPoint: null,
  lastMapView: null,
  hiddenCptIds: new Set(),
  selectedCptIds: new Set(),
  pdfCache: new Map(),
  ifcCache: new Map(),

  setPdfCache(docId, bytes) {
    set((s) => {
      const next = new Map(s.pdfCache);
      next.set(docId, bytes);
      return { pdfCache: next };
    });
  },
  invalidatePdfCache(docId) {
    set((s) => {
      if (!s.pdfCache.has(docId)) return s;
      const next = new Map(s.pdfCache);
      next.delete(docId);
      return { pdfCache: next };
    });
  },
  setIfcCacheEntry(docId, format, content) {
    set((s) => {
      const next = new Map(s.ifcCache);
      const prev = next.get(docId) ?? {};
      next.set(docId, { ...prev, [format]: content });
      return { ifcCache: next };
    });
  },
  invalidateIfcCache(docId) {
    set((s) => {
      if (!s.ifcCache.has(docId)) return s;
      const next = new Map(s.ifcCache);
      next.delete(docId);
      return { ifcCache: next };
    });
  },

  setActiveDoc(id) {
    set((s) => {
      const documents = s.documents;
      const derived = deriveFromActive(documents, id);
      // Selectie hoort bij het project — wissel project = nieuwe set
      // CPTs, oude selectie zou stale ids bevatten. Reset hem hier.
      return {
        activeDocId: id,
        selectedCptIds: new Set<string>(),
        ...derived,
      };
    });
  },

  async closeDoc(id) {
    // Best-effort cleanup on the Rust side: free any CPTs that were owned by
    // this doc. Stale entries on the Rust side are harmless if this fails.
    const target = get().documents.find((d) => d.id === id);
    if (target) {
      // Collect CPT ids to free on the Rust side. Borings don't allocate
      // a Rust-side CPT entry, so skip them.
      const ids =
        target.kind === "cpt"
          ? [target.cpt.id]
          : target.kind === "project"
            ? Array.from(target.cpts.keys())
            : [];
      for (const cid of ids) {
        try { await invoke("close_cpt", { id: cid }); } catch { /* no-op */ }
      }
    }
    set((s) => {
      const documents = s.documents.filter((d) => d.id !== id);
      let activeDocId = s.activeDocId;
      if (activeDocId === id) {
        activeDocId = documents[0]?.id ?? null;
      }
      // Drop any cached PDF + IFC for the closed doc.
      const pdfCache = s.pdfCache.has(id)
        ? (() => { const n = new Map(s.pdfCache); n.delete(id); return n; })()
        : s.pdfCache;
      const ifcCache = s.ifcCache.has(id)
        ? (() => { const n = new Map(s.ifcCache); n.delete(id); return n; })()
        : s.ifcCache;
      const derived = deriveFromActive(documents, activeDocId);
      return { documents, activeDocId, pdfCache, ifcCache, ...derived };
    });
  },

  setActive(id) {
    set((s) => {
      const active = s.documents.find((d) => d.id === s.activeDocId);
      if (!active || active.kind !== "project") return s;
      const documents = s.documents.map((d) =>
        d.id === active.id ? { ...d, activeCptId: id } : d
      );
      const derived = deriveFromActive(documents, s.activeDocId);
      return { documents, ...derived };
    });
  },

  async closeCpt(id) {
    try { await invoke("close_cpt", { id }); } catch { /* no-op */ }
    let projectToReSchedule: ProjectDocument | null = null;
    set((s) => {
      const active = s.documents.find((d) => d.id === s.activeDocId);
      if (!active) return s;

      // Always clean up the hidden flag — the CPT is gone, the flag is stale.
      const hiddenCptIds = s.hiddenCptIds.has(id)
        ? (() => { const n = new Set(s.hiddenCptIds); n.delete(id); return n; })()
        : s.hiddenCptIds;

      // En dezelfde opruim voor de Kaart-tab-selectie — anders blijven
      // er stale ids in `selectedCptIds` staan die niet meer naar een
      // bestaande CPT verwijzen.
      const selectedCptIds = s.selectedCptIds.has(id)
        ? (() => { const n = new Set(s.selectedCptIds); n.delete(id); return n; })()
        : s.selectedCptIds;

      // Standalone CPT doc — closing the only CPT closes the doc.
      if (active.kind === "cpt") {
        if (active.cpt.id !== id) return { hiddenCptIds, selectedCptIds };
        const documents = s.documents.filter((d) => d.id !== active.id);
        const activeDocId = documents[0]?.id ?? null;
        const pdfCache = s.pdfCache.has(active.id)
          ? (() => { const n = new Map(s.pdfCache); n.delete(active.id); return n; })()
          : s.pdfCache;
        const ifcCache = s.ifcCache.has(active.id)
          ? (() => { const n = new Map(s.ifcCache); n.delete(active.id); return n; })()
          : s.ifcCache;
        const derived = deriveFromActive(documents, activeDocId);
        return { documents, activeDocId, hiddenCptIds, selectedCptIds, pdfCache, ifcCache, ...derived };
      }

      // Boring + GMW docs — close-CPT is a no-op (zij hebben geen
      // eigen CPT-collectie). Het type valt na deze guard naar
      // ProjectDocument waardoor `active.cpts` veilig is.
      if (active.kind === "bore" || active.kind === "gwp") {
        return { hiddenCptIds, selectedCptIds };
      }

      // Project doc — drop the CPT from its map.
      const next = new Map(active.cpts);
      next.delete(id);
      const newActiveCptId = active.activeCptId === id
        ? (next.keys().next().value ?? null)
        : active.activeCptId;
      const documents = s.documents.map((d) => {
        if (d.id !== active.id || d.kind !== "project") return d;
        const updated: ProjectDocument = { ...d, cpts: next, activeCptId: newActiveCptId };
        projectToReSchedule = updated;
        return updated;
      });
      // Project's CPT list changed — drop the cached PDF + IFC.
      const pdfCache = s.pdfCache.has(active.id)
        ? (() => { const n = new Map(s.pdfCache); n.delete(active.id); return n; })()
        : s.pdfCache;
      const ifcCache = s.ifcCache.has(active.id)
        ? (() => { const n = new Map(s.ifcCache); n.delete(active.id); return n; })()
        : s.ifcCache;
      const derived = deriveFromActive(documents, s.activeDocId);
      return { documents, hiddenCptIds, selectedCptIds, pdfCache, ifcCache, ...derived };
    });
    if (projectToReSchedule) {
      schedulePdfPreview(projectToReSchedule);
      scheduleIfcGenerate(projectToReSchedule);
    }
  },

  toggleHidden(id) {
    set((s) => {
      const next = new Set(s.hiddenCptIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { hiddenCptIds: next };
    });
  },

  toggleCptSelection(id) {
    set((s) => {
      const next = new Set(s.selectedCptIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedCptIds: next };
    });
  },
  selectCpts(ids, replace = false) {
    set((s) => {
      const next = replace ? new Set<string>() : new Set(s.selectedCptIds);
      for (const id of ids) next.add(id);
      return { selectedCptIds: next };
    });
  },
  clearCptSelection() {
    set((s) => {
      if (s.selectedCptIds.size === 0) return s;
      return { selectedCptIds: new Set() };
    });
  },

  async closeAll() {
    const state = get();
    const active = state.documents.find((d) => d.id === state.activeDocId);
    if (!active) return;

    // Collect CPT ids owned by this doc and try to free them on the Rust
    // side. Bores hold no Rust-side CPT entries so they contribute none.
    const cptIds =
      active.kind === "cpt"
        ? [active.cpt.id]
        : active.kind === "project"
          ? Array.from(active.cpts.keys())
          : [];
    for (const cid of cptIds) {
      try { await invoke("close_cpt", { id: cid }); } catch { /* no-op */ }
    }

    set((s) => {
      // Closing the active doc — same semantics as closeDoc.
      const documents = s.documents.filter((d) => d.id !== active.id);
      const activeDocId = documents[0]?.id ?? null;
      const pdfCache = s.pdfCache.has(active.id)
        ? (() => { const n = new Map(s.pdfCache); n.delete(active.id); return n; })()
        : s.pdfCache;
      const ifcCache = s.ifcCache.has(active.id)
        ? (() => { const n = new Map(s.ifcCache); n.delete(active.id); return n; })()
        : s.ifcCache;
      const derived = deriveFromActive(documents, activeDocId);
      return { documents, activeDocId, pdfCache, ifcCache, ...derived };
    });
  },

  setProjectMeta(m) {
    set((s) => {
      const active = s.documents.find((d) => d.id === s.activeDocId);
      if (!active || active.kind !== "project") return s;
      const newMeta = { ...active.meta, ...m };
      const documents = s.documents.map((d) =>
        d.id === active.id ? { ...d, meta: newMeta, title: newMeta.title || d.title } : d
      );
      // Project meta changed — drop the cached PDF + IFC for this doc; a
      // new one will be scheduled lazily by the next Rapport-tab render.
      const pdfCache = s.pdfCache.has(active.id)
        ? (() => { const n = new Map(s.pdfCache); n.delete(active.id); return n; })()
        : s.pdfCache;
      const ifcCache = s.ifcCache.has(active.id)
        ? (() => { const n = new Map(s.ifcCache); n.delete(active.id); return n; })()
        : s.ifcCache;
      const derived = deriveFromActive(documents, s.activeDocId);
      return { documents, pdfCache, ifcCache, ...derived };
    });
    // Re-schedule a fresh background PDF preview + IFC for this doc.
    const state = get();
    const active = state.documents.find((d) => d.id === state.activeDocId);
    if (active) {
      schedulePdfPreview(active);
      scheduleIfcGenerate(active);
    }
  },

  setHover(p) { set({ hoveredPoint: p }); },
  setLastMapView(v) { set({ lastMapView: v }); },
}));

// ─── Pre-rendered PDF cache ──────────────────────────────────────
//
// `schedulePdfPreview` fires off a background `preview_report` invoke
// for the given document and stores the resulting PDF bytes in the
// store's `pdfCache`. Fire-and-forget — failures are swallowed
// (the next Rapport-tab visit will simply re-trigger via the live path).
//
// Called from every doc-loading helper below so the PDF is ready by
// the time the user clicks the Rapport tab. Also invoked again whenever
// project meta or the CPT list changes for an open document.

/**
 * Debounce window per doc — multiple `schedulePdfPreview(doc)` calls for
 * the same doc within this window are coalesced into a single run.
 * Opening 4 sondering files at once → 4 debounce timers → after the
 * window each fires once (still queued globally below). Stops the rapid
 * "open → metaChange → open" loop from spamming the Rust side.
 */
const PDF_DEBOUNCE_MS = 400;
const pdfDebounceTimers: Map<string, number> = new Map();

/**
 * Global serial queue — only one PDF preview is generated at a time, so
 * opening N CPTs spreads the CPU work over time instead of saturating
 * the runtime. New requests for the same docId replace older queued
 * ones (latest-wins). The actual render still runs on Rust's blocking
 * thread pool (see `preview_report`); this just throttles dispatch.
 */
interface PdfQueueEntry {
  docId: string;
  cptIds: string[];
  meta: ProjectMeta;
}
const pdfQueue: PdfQueueEntry[] = [];
let pdfQueueRunning = false;

async function runPdfQueue(): Promise<void> {
  if (pdfQueueRunning) return;
  pdfQueueRunning = true;
  try {
    while (pdfQueue.length > 0) {
      // Take the *last* entry (newest wins) and drop everything else for
      // the same docId — only the most recent state needs to render.
      const entry = pdfQueue.pop()!;
      for (let i = pdfQueue.length - 1; i >= 0; i--) {
        if (pdfQueue[i].docId === entry.docId) pdfQueue.splice(i, 1);
      }
      try {
        const bytes = await invoke<number[]>("preview_report", {
          cptIds: entry.cptIds,
          project: entry.meta,
        });
        const state = useCptStore.getState();
        if (!state.documents.some((d) => d.id === entry.docId)) continue;
        state.setPdfCache(entry.docId, new Uint8Array(bytes));
      } catch {
        // Swallow — Rapport tab will retry via the live path.
      }
    }
  } finally {
    pdfQueueRunning = false;
  }
}

export function schedulePdfPreview(doc: AppDocument): void {
  // Browser: geen Rust PDF-engine beschikbaar — sla het scheduler-
  // werk over. ReportPreview toont in plaats daarvan een browser-
  // only melding (zie utils/platform.ts + ReportPreview.tsx).
  if (typeof window !== "undefined") {
    const g = globalThis as unknown as { isTauri?: boolean };
    if (!g.isTauri && !("__TAURI_INTERNALS__" in window) && !("__TAURI__" in window)) {
      return;
    }
  }
  // Boring + GMW-documenten genereren geen CPT-style chart-rapport —
  // sla over zodat de rest van de doc-open pipeline niet faalt.
  if (doc.kind === "bore" || doc.kind === "gwp") return;
  const cptIds = doc.kind === "cpt"
    ? [doc.cpt.id]
    : Array.from(doc.cpts.keys());
  if (cptIds.length === 0) return;

  const meta = doc.kind === "project" ? doc.meta : { ...DEFAULT_PROJECT_META };
  const docId = doc.id;

  // Coalesce rapid re-schedules per docId. Each call wins; the timer is
  // reset on every invocation so the queue entry only lands after the
  // user pauses for `PDF_DEBOUNCE_MS`.
  const existing = pdfDebounceTimers.get(docId);
  if (existing) window.clearTimeout(existing);
  const timer = window.setTimeout(() => {
    pdfDebounceTimers.delete(docId);
    // Replace any older queued entry for this docId with the freshest snapshot.
    for (let i = pdfQueue.length - 1; i >= 0; i--) {
      if (pdfQueue[i].docId === docId) pdfQueue.splice(i, 1);
    }
    pdfQueue.push({ docId, cptIds, meta });
    void runPdfQueue();
  }, PDF_DEBOUNCE_MS);
  pdfDebounceTimers.set(docId, timer);
}

// ─── Auto-generated IFC cache ────────────────────────────────────
//
// `scheduleIfcGenerate` fires off `generate_ifc` in the background for
// BOTH formats (ifc4x3 + ifcx). The results are stored in `ifcCache`
// keyed by doc id so the IfcView panel can render them instantly —
// users never click "Genereer". Called every time a doc opens or its
// CPT list / meta changes.
//
// Fire-and-forget — failures are swallowed and the IfcView shows
// "Bezig met genereren..." or a retry path until a successful run.

interface GeneratedIfcResult {
  filename: string;
  format: string;
  generated_at: string;
  byte_count: number;
  full_path: string;
  content: string;
}

export function scheduleIfcGenerate(doc: AppDocument): void {
  // Browser: geen Rust IFC-generator — sla over zoals schedulePdfPreview.
  if (typeof window !== "undefined") {
    const g = globalThis as unknown as { isTauri?: boolean };
    if (!g.isTauri && !("__TAURI_INTERNALS__" in window) && !("__TAURI__" in window)) {
      return;
    }
  }
  // Boring + GMW-documenten krijgen (nog) geen auto-IFC-export —
  // skip om een lege/foutieve IFCX in de cache te vermijden.
  if (doc.kind === "bore" || doc.kind === "gwp") return;
  const cptIds = doc.kind === "cpt"
    ? [doc.cpt.id]
    : Array.from(doc.cpts.keys());
  if (cptIds.length === 0) return;

  const meta = doc.kind === "project"
    ? doc.meta
    : { ...DEFAULT_PROJECT_META, title: doc.title || "Sondering" };
  const docId = doc.id;

  void (async () => {
    for (const format of ["ifc4x3", "ifcx"] as const) {
      try {
        const result = await invoke<GeneratedIfcResult>("generate_ifc", {
          project: { ...meta, id: docId },
          cptIds,
          format,
        });
        // Only commit if the doc is still around.
        const state = useCptStore.getState();
        if (!state.documents.some((d) => d.id === docId)) return;
        state.setIfcCacheEntry(docId, format, result.content);
        // Notify the IfcView (so it can show the generated_at + filename
        // alongside the cached body content).
        window.dispatchEvent(
          new CustomEvent("ogs:ifc-generated", {
            detail: {
              docId,
              entry: {
                filename: result.filename,
                format: result.format,
                generated_at: result.generated_at,
                byte_count: result.byte_count,
                full_path: result.full_path,
              },
              content: result.content,
            },
          }),
        );
      } catch {
        // Swallow — IfcView shows the "Bezig met genereren..." state
        // until a successful generation lands in the cache.
      }
    }
  })();
}

// ─── External helpers ────────────────────────────────────────────

/**
 * Parses a CPT (GEF / BRO-XML) via de `open_cpt` Tauri-command en
 * opent het als nieuwe CptDocument-tab. Altijd nieuwe tab — opent
 * GEEN CPT in een bestaand project (gebruik `addCptToActiveProject`
 * voor die flow).
 *
 * Browser-fallback: als `invoke()` faalt (geen Tauri-runtime, of
 * `open_cpt` command niet beschikbaar) en de content er als GEF
 * uitziet, gebruiken we de pure-TS `parseGef` parser zodat de
 * webversie van de app GEF-bestanden óók kan openen.
 */
export async function loadCptFromContent(
  content: string,
  filename: string,
  path?: string,
): Promise<Cpt> {
  // Eén platform-call — desktop gaat naar Rust (autoritair), web
  // naar de TS-parsers (gefParser + broCptParser). Zie utils/platform.ts.
  const { cpt: cptPlatform } = await import("../utils/platform");
  const cpt = await cptPlatform.parse(content, filename);
  let createdDoc: CptDocument | null = null;
  useCptStore.setState((s) => {
    const doc: CptDocument = {
      kind: "cpt",
      id: makeId(),
      title: filename,
      path,
      cpt,
    };
    createdDoc = doc;
    const documents = [...s.documents, doc];
    const activeDocId = doc.id;
    const derived = deriveFromActive(documents, activeDocId);
    return { documents, activeDocId, ...derived };
  });
  if (createdDoc) {
    schedulePdfPreview(createdDoc);
    scheduleIfcGenerate(createdDoc);
  }
  return cpt;
}

/**
 * Parses a BHR-GT (borehole) XML in TypeScript and opens it as a brand-
 * new BoreDocument tab. Used by the BRO popup's "Open in viewer" action
 * when the marker is a boring. Always creates a fresh tab — borings can
 * also be added to a project via a future `addBoreToActiveProject` helper.
 */
export async function loadBoreFromContent(
  xml: string,
  filename: string,
  path?: string,
): Promise<Bore> {
  const bore = parseBhrgtXml(xml, filename);
  useCptStore.setState((s) => {
    const doc: BoreDocument = {
      kind: "bore",
      id: makeId(),
      title: bore.id || filename,
      path,
      bore,
      rawXml: xml,
    };
    const documents = [...s.documents, doc];
    const activeDocId = doc.id;
    const derived = deriveFromActive(documents, activeDocId);
    return { documents, activeDocId, ...derived };
  });
  return bore;
}

/**
 * Parses a BRO GMW dispatch XML (grondwaterput) and opens it as a fresh
 * GwpDocument tab. Used by:
 *   - de "Open in viewer"-knop op een grondwaterput-marker op de kaart
 *   - openPathByExtension wanneer de gebruiker een GMW-XML-bestand uit
 *     BROloket opent
 *
 * Geen Rust roundtrip — parsing gebeurt 100% client-side in
 * `parseGmwXml`. We bewaren de raw XML zodat een "Ruwe data"-paneel
 * de dispatch kan terug-tonen.
 */
export async function loadGwpFromContent(
  xml: string,
  filename: string,
  path?: string,
): Promise<import("../types/gwp").Gwp> {
  const { parseGmwXml } = await import("../types/gwp");
  const gwp = parseGmwXml(xml);
  if (!gwp) {
    throw new Error(
      `${filename}: kon geen GMW-dispatch parsen (geen <GMW_PO>/<GMW_O> root of geen broId gevonden)`,
    );
  }
  useCptStore.setState((s) => {
    const doc: GwpDocument = {
      kind: "gwp",
      id: makeId(),
      title: gwp.broId || filename,
      path,
      gwp,
      rawXml: xml,
    };
    const documents = [...s.documents, doc];
    const activeDocId = doc.id;
    const derived = deriveFromActive(documents, activeDocId);
    return { documents, activeDocId, ...derived };
  });
  return gwp;
}

/**
 * Haalt een grondwaterput op via de BRO publieke REST-API
 * (https://publiek.broservices.nl/gm/gmw/v1/objects/{broId}) en opent
 * 'm als nieuw GwpDocument-tab. Wordt aangeroepen door de
 * "Open in viewer"-actie op een GMW-marker op de kaart.
 *
 * De BRO publieke API serveert CORS-headers waardoor we direct vanuit
 * de WebView kunnen `fetch()` zonder Tauri-side proxy nodig te hebben.
 */
export async function openGwpFromBroId(
  broId: string,
): Promise<import("../types/gwp").Gwp> {
  const url = `https://publiek.broservices.nl/gm/gmw/v1/objects/${encodeURIComponent(broId)}`;
  const res = await fetch(url, { headers: { Accept: "application/xml" } });
  if (!res.ok) {
    throw new Error(`BRO ${broId}: HTTP ${res.status} ${res.statusText}`);
  }
  const xml = await res.text();
  return loadGwpFromContent(xml, `${broId}.xml`);
}

/**
 * Adds a CPT to the currently active project document. Use this when the
 * user clicks "Sondering toevoegen" inside the project settings dialog.
 * If the active doc is not a project, falls back to creating a standalone
 * CPT tab (same as `loadCptFromContent`).
 */
export async function addCptToActiveProject(
  content: string,
  filename: string,
): Promise<Cpt> {
  // Eén platform-call — zie utils/platform.ts voor de Tauri/web split.
  const { cpt: cptPlatform } = await import("../utils/platform");
  const cpt = await cptPlatform.parse(content, filename);
  const state = useCptStore.getState();
  const active = state.documents.find((d) => d.id === state.activeDocId);
  if (!active || active.kind !== "project") {
    // No active project — create a standalone tab instead.
    let createdDoc: CptDocument | null = null;
    useCptStore.setState((s) => {
      const doc: CptDocument = {
        kind: "cpt",
        id: makeId(),
        title: filename,
        cpt,
      };
      createdDoc = doc;
      const documents = [...s.documents, doc];
      const activeDocId = doc.id;
      const derived = deriveFromActive(documents, activeDocId);
      return { documents, activeDocId, ...derived };
    });
    if (createdDoc) {
      schedulePdfPreview(createdDoc);
      scheduleIfcGenerate(createdDoc);
    }
    return cpt;
  }

  let updatedDoc: ProjectDocument | null = null;
  useCptStore.setState((s) => {
    const target = s.documents.find((d) => d.id === active.id);
    if (!target || target.kind !== "project") return s;
    const next = new Map(target.cpts);
    next.set(cpt.id, cpt);
    const documents = s.documents.map((d) => {
      if (d.id !== target.id || d.kind !== "project") return d;
      const updated: ProjectDocument = { ...d, cpts: next, activeCptId: cpt.id };
      updatedDoc = updated;
      return updated;
    });
    // Project's CPT list changed — drop the cached PDF + IFC.
    const pdfCache = s.pdfCache.has(target.id)
      ? (() => { const n = new Map(s.pdfCache); n.delete(target.id); return n; })()
      : s.pdfCache;
    const ifcCache = s.ifcCache.has(target.id)
      ? (() => { const n = new Map(s.ifcCache); n.delete(target.id); return n; })()
      : s.ifcCache;
    const derived = deriveFromActive(documents, s.activeDocId);
    return { documents, pdfCache, ifcCache, ...derived };
  });
  if (updatedDoc) {
    schedulePdfPreview(updatedDoc);
    scheduleIfcGenerate(updatedDoc);
  }
  return cpt;
}

/**
 * Voeg een boring toe aan het actieve project. Analoog aan
 * addCptToActiveProject maar dan voor BHR-GT XML. Parsing gebeurt
 * client-side (parseBhrgtXml) — geen Rust roundtrip nodig. Als er
 * geen actief project is wordt de boring als losse Bore-tab geopend.
 */
export async function addBoreToActiveProject(
  xml: string,
  filename: string,
): Promise<Bore> {
  if (!looksLikeBoringXml(xml)) {
    throw new Error(
      `${filename}: lijkt geen BHR-GT XML (geen <BHR_*_O> root gevonden)`,
    );
  }
  const bore = parseBhrgtXml(xml, filename);
  const state = useCptStore.getState();
  const active = state.documents.find((d) => d.id === state.activeDocId);
  if (!active || active.kind !== "project") {
    // Geen actief project — open als losse boring-tab.
    useCptStore.setState((s) => {
      const doc: BoreDocument = {
        kind: "bore",
        id: makeId(),
        title: filename,
        bore,
        rawXml: xml,
      };
      const documents = [...s.documents, doc];
      const activeDocId = doc.id;
      const derived = deriveFromActive(documents, activeDocId);
      return { documents, activeDocId, ...derived };
    });
    return bore;
  }

  let updatedDoc: ProjectDocument | null = null;
  useCptStore.setState((s) => {
    const target = s.documents.find((d) => d.id === active.id);
    if (!target || target.kind !== "project") return s;
    const next = new Map(target.bores);
    next.set(bore.id, bore);
    const documents = s.documents.map((d) => {
      if (d.id !== target.id || d.kind !== "project") return d;
      const updated: ProjectDocument = { ...d, bores: next };
      updatedDoc = updated;
      return updated;
    });
    // Project content changed — drop cached PDF + IFC zodat de
    // volgende preview de boring meeneemt.
    const pdfCache = s.pdfCache.has(target.id)
      ? (() => { const n = new Map(s.pdfCache); n.delete(target.id); return n; })()
      : s.pdfCache;
    const ifcCache = s.ifcCache.has(target.id)
      ? (() => { const n = new Map(s.ifcCache); n.delete(target.id); return n; })()
      : s.ifcCache;
    const derived = deriveFromActive(documents, s.activeDocId);
    return { documents, pdfCache, ifcCache, ...derived };
  });
  if (updatedDoc) {
    schedulePdfPreview(updatedDoc);
    scheduleIfcGenerate(updatedDoc);
  }
  return bore;
}

/**
 * Remove a boring from the active project. No-op if the active doc is
 * not a project or the bore id is not in the project. Triggers a
 * cache-bust + reschedule analoog aan closeCpt.
 */
export function removeBoreFromActiveProject(id: string): void {
  let updatedDoc: ProjectDocument | null = null;
  useCptStore.setState((s) => {
    const active = s.documents.find((d) => d.id === s.activeDocId);
    if (!active || active.kind !== "project") return s;
    if (!active.bores.has(id)) return s;
    const next = new Map(active.bores);
    next.delete(id);
    const documents = s.documents.map((d) => {
      if (d.id !== active.id || d.kind !== "project") return d;
      const updated: ProjectDocument = { ...d, bores: next };
      updatedDoc = updated;
      return updated;
    });
    const pdfCache = s.pdfCache.has(active.id)
      ? (() => { const n = new Map(s.pdfCache); n.delete(active.id); return n; })()
      : s.pdfCache;
    const ifcCache = s.ifcCache.has(active.id)
      ? (() => { const n = new Map(s.ifcCache); n.delete(active.id); return n; })()
      : s.ifcCache;
    const derived = deriveFromActive(documents, s.activeDocId);
    return { documents, pdfCache, ifcCache, ...derived };
  });
  if (updatedDoc) {
    schedulePdfPreview(updatedDoc);
    scheduleIfcGenerate(updatedDoc);
  }
}

/**
 * Opens a `.ifcgis` project file via the `open_project_ifcgis_full` Tauri
 * command (ifcgis-0.2 schema, includes optional tekening + title_block)
 * and creates a new ProjectDocument tab. Falls back to the legacy
 * `open_project_ifcgis` command for older 0.1 files that Rust may not
 * be able to parse strictly under 0.2's stricter schema.
 *
 * Tekening + title-block worden in de module-level singleton gezet
 * (`setPendingTekeningRestore`) zodat SonderingstekeningView ze op
 * mount kan oppikken. Een bestaand gemount component krijgt ze niet
 * vanzelf — dat is v2-werk (event dispatch + listener).
 */
export async function openProjectIfcgis(path: string): Promise<void> {
  // ifcgis-0.2 full payload: header + project + cpts + bores + crs +
  // tekening? + title_block?. Snake_case zoals Rust het serialiseert.
  type IfcgisProjectInfo = {
    type?: string;
    title: string;
    client?: string;
    location?: string;
    project_number?: string;
    author?: string;
    date: string;
  };
  type IfcgisFile = {
    header: { schema: string; originating_system: string; timestamp: string };
    project: IfcgisProjectInfo;
    cpts?: Cpt[];
    bores?: unknown[];
    crs?: { epsg: number; name?: string };
    tekening?: unknown;
    title_block?: unknown;
  };
  const result = await invoke<IfcgisFile>("open_project_ifcgis_full", { path });
  const projectMeta: ProjectMeta = {
    title: result.project.title ?? "",
    client: result.project.client ?? "",
    location: result.project.location ?? "",
    project_number: result.project.project_number ?? "",
    author: result.project.author ?? "",
    date: result.project.date ?? "",
  };
  const cptList: Cpt[] = Array.isArray(result.cpts) ? result.cpts : [];
  // Bores: het ifcgis-bestand bewaart ze als opaque JSON (de Rust-side
  // doet geen strict parsing). Wij doen hier een minimal cast naar Bore
  // — als de shape niet klopt valt de UI-rendering terug op de error-
  // banner van BoreView. Geen exception om de open niet te blokkeren.
  const boreList: Bore[] = Array.isArray(result.bores)
    ? (result.bores as Bore[]).filter((b) => b && typeof b === "object" && "id" in b)
    : [];
  let createdDoc: ProjectDocument | null = null;
  useCptStore.setState((s) => {
    const cpts = new Map<string, Cpt>();
    for (const c of cptList) cpts.set(c.id, c);
    const bores = new Map<string, Bore>();
    for (const b of boreList) bores.set(b.id, b);
    const filename = path.split(/[\\/]/).pop() ?? path;
    const doc: ProjectDocument = {
      kind: "project",
      id: makeId(),
      title: projectMeta.title || filename,
      path,
      meta: projectMeta,
      cpts,
      bores,
      activeCptId: cptList[0]?.id ?? null,
    };
    createdDoc = doc;
    const documents = [...s.documents, doc];
    const activeDocId = doc.id;
    const derived = deriveFromActive(documents, activeDocId);
    return { documents, activeDocId, ...derived };
  });
  if (createdDoc) {
    schedulePdfPreview(createdDoc);
    scheduleIfcGenerate(createdDoc);
  }
  // Tekening + title-block in de singleton zetten zodat
  // SonderingstekeningView ze bij mount kan herstellen.
  if (result.tekening || result.title_block) {
    const tekState = tekeningStateFromIfcgis(result.tekening) ?? {
      paperSize: "A3" as const,
      scale: 500,
      center: { lat: 51.81435338, lon: 4.66003133, zoom: 18 },
      markers: [],
      rasters: [],
      lines: [],
      coordTags: [],
      overlay: null,
      titleBlock: {
        project: "",
        projectNumber: "",
        address: "",
        drawingNumber: "",
        scale: "",
        date: "",
        drawnBy: "",
        checkedBy: "",
        version: "",
      },
    };
    const titleBlock = titleBlockFromIfcgis(result.title_block);
    if (titleBlock) tekState.titleBlock = titleBlock;
    setPendingTekeningRestore(tekState);
  }
}

/**
 * Creates a brand-new (empty) project document tab and activates it.
 * Used by the Backstage "New" item.
 */
export function newProjectDocument(): void {
  useCptStore.setState((s) => {
    // Inherit author from the previous default if any project was active.
    const prevActive = s.documents.find((d) => d.id === s.activeDocId);
    const inheritedAuthor = prevActive?.kind === "project"
      ? prevActive.meta.author
      : "";
    const meta: ProjectMeta = {
      ...DEFAULT_PROJECT_META,
      author: inheritedAuthor,
      date: today(),
    };
    const doc: ProjectDocument = {
      kind: "project",
      id: makeId(),
      title: meta.title,
      meta,
      cpts: new Map(),
      bores: new Map(),
      activeCptId: null,
    };
    const documents = [...s.documents, doc];
    const activeDocId = doc.id;
    const derived = deriveFromActive(documents, activeDocId);
    return { documents, activeDocId, ...derived };
  });
}

/**
 * Routes a file path to the right loader based on extension + content:
 *   .ifcgis            → openProjectIfcgis (Project tab)
 *   .gef / .ifcgeo     → loadCptFromContent (CPT tab)
 *   .xml               → sniff for `<BHR_*_O>` root → loadBoreFromContent
 *                        (Bore tab), otherwise loadCptFromContent.
 *
 * Returns true when the file was handled, false otherwise.
 */
export async function openPathByExtension(path: string): Promise<boolean> {
  const lower = path.toLowerCase();
  // `.ifcgis` is legacy project-extensie — leest nog steeds via de
  // project-loader (oude opslag-bestanden blijven werken).
  if (lower.endsWith(".ifcx") || lower.endsWith(".ifcgis")) {
    await openProjectIfcgis(path);
    return true;
  }
  if (lower.endsWith(".gef") || lower.endsWith(".xml") || lower.endsWith(".ifcgeo")) {
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const content = await readTextFile(path);
    const filename = path.split(/[\\/]/).pop() ?? path;
    return openContentByFilename(content, filename, path);
  }
  return false;
}

/**
 * Path-loos broertje van `openPathByExtension` — routet op basis van
 * (filename + content) i.p.v. een bestandspad. Wordt aangeroepen door:
 *   - openPathByExtension (na readTextFile in Tauri)
 *   - de browser-fallback file-picker (web-versie zonder fs-toegang)
 *
 * Voor formats die de Rust-side nodig hebben (GEF, CPT-XML, .ifcgeo
 * project) zal `invoke()` falen in browser-context — de aanroeper
 * moet die error opvangen en een nette UI-melding tonen.
 */
export async function openContentByFilename(
  content: string,
  filename: string,
  path?: string,
): Promise<boolean> {
  const lower = filename.toLowerCase();
  // XML: sniff first 4 KB om onderscheid te maken tussen GMW
  // (grondwaterput), BHR (boring) en CPT/GEF. Volgorde matters —
  // GMW eerst want de wrapper-element-namen overlappen niet maar de
  // sniffer is goedkoper dan boring-sniff. Daarna boring, anders CPT.
  if (lower.endsWith(".xml")) {
    const head = content.slice(0, 4096);
    const { looksLikeGwpXml } = await import("../types/gwp");
    if (looksLikeGwpXml(head)) {
      await loadGwpFromContent(content, filename, path);
      return true;
    }
    if (looksLikeBoringXml(head)) {
      await loadBoreFromContent(content, filename, path);
      return true;
    }
  }
  // `.ifcgeo` is sinds 2026 de gecombineerde extensie voor zowel
  // project-bestanden (meerdere CPTs + tekening + title-block) als
  // losse CPT-snapshots. Onderscheiden gebeurt door de eerste ~4 KB
  // te sniffen op de JSON-shape:
  //   - project: heeft `"cpts": [` of `"schema": "ifcgis-`
  //   - single CPT: heeft alleen één `"points"`-array op top-level
  // Bij twijfel valt-ie terug op de single-CPT-loader (oude .ifcgeo
  // bestanden); de Rust-side gooit dan een nette parse-error als
  // het tóch een project-payload blijkt.
  if (lower.endsWith(".ifcgeo") && looksLikeProjectIfcgeo(content.slice(0, 4096))) {
    if (!path) {
      throw new Error(
        "Projectbestanden (.ifcgeo) zijn alleen ondersteund in de desktop-versie.",
      );
    }
    await openProjectIfcgis(path);
    return true;
  }
  if (lower.endsWith(".ifcx") || lower.endsWith(".ifcgis")) {
    if (!path) {
      throw new Error(
        "Projectbestanden (.ifcgis/.ifcx) zijn alleen ondersteund in de desktop-versie.",
      );
    }
    await openProjectIfcgis(path);
    return true;
  }
  // Alles wat overblijft (GEF, generieke XML, single-CPT .ifcgeo) gaat
  // door de Rust-CPT-parser. In Tauri werkt dat; in browser gooit
  // invoke() — caller moet daarop voorbereid zijn.
  await loadCptFromContent(content, filename, path);
  return true;
}

/**
 * Lichtgewicht sniff: is dit `.ifcgeo`-bestand een project (meerdere
 * CPTs + tekening) of een losse CPT? Werkt op de eerste paar KB —
 * we hoeven dus niet de hele payload te parsen om te beslissen welke
 * loader nodig is.
 */
function looksLikeProjectIfcgeo(head: string): boolean {
  return (
    /"schema"\s*:\s*"ifcgis-/i.test(head) ||
    /"cpts"\s*:\s*\[/i.test(head) ||
    /"project"\s*:\s*\{/i.test(head)
  );
}

/**
 * Fetches a BRO sondering by id and adds it as a CPT to the currently
 * active project document. Used by the "Voeg toe aan project" action on a
 * BRO map marker when the active doc is a project.
 *
 * Throws if no project is currently active — the caller is responsible
 * for first checking `activeDocKindRef.current === "project"`.
 */
export async function addBroToActiveProject(broId: string): Promise<Cpt> {
  const state = useCptStore.getState();
  const active = state.documents.find((d) => d.id === state.activeDocId);
  if (!active || active.kind !== "project") {
    throw new Error("Geen project actief — kan BRO-sondering niet toevoegen.");
  }
  // Eén platform-call — zie utils/platform.ts (Tauri: Rust-proxy; web: direct fetch).
  const { bro } = await import("../utils/platform");
  const xml = await bro.fetchCptXml(broId);
  return addCptToActiveProject(xml, `${broId}.xml`);
}

/**
 * Merges an existing standalone CptDocument and a freshly-fetched second
 * CPT (parsed from `newCptContent`) into a brand-new ProjectDocument.
 *
 * Used by the "Maak project + voeg toe" action on a BRO map marker:
 * combines whatever CPT the user is currently looking at with the BRO
 * sondering they just clicked, into a fresh project tab. Atomically
 * replaces the standalone CPT tab with the new project tab.
 */
export async function mergeIntoNewProject(
  existingCptId: string,
  newCptContent: string,
  newCptFilename: string,
): Promise<void> {
  // Eén platform-call — zie utils/platform.ts.
  const { cpt: cptPlatform } = await import("../utils/platform");
  const newCpt = await cptPlatform.parse(newCptContent, newCptFilename);
  let createdDoc: ProjectDocument | null = null;
  useCptStore.setState((s) => {
    // Locate the existing standalone CPT doc.
    const existingDoc = s.documents.find(
      (d) => d.kind === "cpt" && d.cpt.id === existingCptId,
    ) as CptDocument | undefined;
    const existingCpt = existingDoc?.cpt;
    if (!existingCpt) return s;

    // Build the project document containing both CPTs (existing first).
    const cpts = new Map<string, Cpt>();
    cpts.set(existingCpt.id, existingCpt);
    cpts.set(newCpt.id, newCpt);
    const meta: ProjectMeta = {
      ...DEFAULT_PROJECT_META,
      title: `Nieuw project (${cpts.size} sonderingen)`,
      date: today(),
    };
    const projectDoc: ProjectDocument = {
      kind: "project",
      id: makeId(),
      title: meta.title,
      meta,
      cpts,
      bores: new Map(),
      activeCptId: newCpt.id,
    };
    createdDoc = projectDoc;

    // Drop the original standalone CPT tab — it's now folded into the project.
    // Drop the cached PDF for that standalone too, since it no longer exists.
    const pdfCache = s.pdfCache.has(existingDoc!.id)
      ? (() => { const n = new Map(s.pdfCache); n.delete(existingDoc!.id); return n; })()
      : s.pdfCache;
    const documents = s.documents
      .filter((d) => d.id !== existingDoc!.id)
      .concat(projectDoc);
    const activeDocId = projectDoc.id;
    const derived = deriveFromActive(documents, activeDocId);
    return { documents, pdfCache, activeDocId, ...derived };
  });
  if (createdDoc) {
    schedulePdfPreview(createdDoc);
    scheduleIfcGenerate(createdDoc);
  }
}
