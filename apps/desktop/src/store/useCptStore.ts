import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Cpt, ProjectMeta } from "../types/cpt";

// ─── Document model ──────────────────────────────────────────────
//
// Every tab in the DocumentBar is an "AppDocument" — either a single
// standalone CPT (sondering) or a project (.ifcgis) which contains a
// ProjectMeta + multiple CPTs. The active document determines what the
// chart, panels, and right panel render.

export type DocumentKind = "cpt" | "project";

export interface CptDocument {
  kind: "cpt";
  id: string;            // tab id
  title: string;         // shown in tab — typically filename
  path?: string;
  cpt: Cpt;
}

export interface ProjectDocument {
  kind: "project";
  id: string;
  title: string;         // shown in tab — typically project meta title
  path?: string;
  meta: ProjectMeta;
  cpts: Map<string, Cpt>;
  activeCptId: string | null;
}

export type AppDocument = CptDocument | ProjectDocument;

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

  /** Per-CPT visibility flag — present means hidden from the chart and map.
   *  Cleaned up automatically by `closeCpt` so stale ids don't accumulate. */
  hiddenCptIds: Set<string>;

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
  hiddenCptIds: new Set(),
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
      return { activeDocId: id, ...derived };
    });
  },

  async closeDoc(id) {
    // Best-effort cleanup on the Rust side: free any CPTs that were owned by
    // this doc. Stale entries on the Rust side are harmless if this fails.
    const target = get().documents.find((d) => d.id === id);
    if (target) {
      const ids = target.kind === "cpt"
        ? [target.cpt.id]
        : Array.from(target.cpts.keys());
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

      // Standalone CPT doc — closing the only CPT closes the doc.
      if (active.kind === "cpt") {
        if (active.cpt.id !== id) return { hiddenCptIds };
        const documents = s.documents.filter((d) => d.id !== active.id);
        const activeDocId = documents[0]?.id ?? null;
        const pdfCache = s.pdfCache.has(active.id)
          ? (() => { const n = new Map(s.pdfCache); n.delete(active.id); return n; })()
          : s.pdfCache;
        const ifcCache = s.ifcCache.has(active.id)
          ? (() => { const n = new Map(s.ifcCache); n.delete(active.id); return n; })()
          : s.ifcCache;
        const derived = deriveFromActive(documents, activeDocId);
        return { documents, activeDocId, hiddenCptIds, pdfCache, ifcCache, ...derived };
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
      return { documents, hiddenCptIds, pdfCache, ifcCache, ...derived };
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

  async closeAll() {
    const state = get();
    const active = state.documents.find((d) => d.id === state.activeDocId);
    if (!active) return;

    // Collect CPT ids owned by this doc and try to free them on the Rust side.
    const cptIds = active.kind === "cpt"
      ? [active.cpt.id]
      : Array.from(active.cpts.keys());
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

export function schedulePdfPreview(doc: AppDocument): void {
  const cptIds = doc.kind === "cpt"
    ? [doc.cpt.id]
    : Array.from(doc.cpts.keys());
  if (cptIds.length === 0) return;

  const meta = doc.kind === "project" ? doc.meta : { ...DEFAULT_PROJECT_META };
  const docId = doc.id;

  // Run async; never block the caller.
  void (async () => {
    try {
      const bytes = await invoke<number[]>("preview_report", {
        cptIds,
        project: meta,
      });
      const u8 = new Uint8Array(bytes);
      // Only commit if the doc is still around (doc may have been closed).
      const state = useCptStore.getState();
      if (!state.documents.some((d) => d.id === docId)) return;
      state.setPdfCache(docId, u8);
    } catch {
      // Swallow — Rapport tab will retry via the live path.
    }
  })();
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
 * Parses a CPT (GEF / BRO-XML) via the `open_cpt` Tauri command and
 * opens it as a brand-new CptDocument tab. Always creates a new tab —
 * opening a CPT does NOT push it into the currently active project.
 * (Use `addCptToActiveProject` for that explicit flow.)
 */
export async function loadCptFromContent(
  content: string,
  filename: string,
  path?: string,
): Promise<Cpt> {
  const cpt = await invoke<Cpt>("open_cpt", { content, filename });
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
 * Adds a CPT to the currently active project document. Use this when the
 * user clicks "Sondering toevoegen" inside the project settings dialog.
 * If the active doc is not a project, falls back to creating a standalone
 * CPT tab (same as `loadCptFromContent`).
 */
export async function addCptToActiveProject(
  content: string,
  filename: string,
): Promise<Cpt> {
  const cpt = await invoke<Cpt>("open_cpt", { content, filename });
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
 * Opens a `.ifcgis` project file via the `open_project_ifcgis` Tauri command
 * and creates a new ProjectDocument tab.
 */
export async function openProjectIfcgis(path: string): Promise<void> {
  const result = await invoke<{ project: ProjectMeta; cpts: Cpt[] }>(
    "open_project_ifcgis",
    { path },
  );
  let createdDoc: ProjectDocument | null = null;
  useCptStore.setState((s) => {
    const cpts = new Map<string, Cpt>();
    for (const c of result.cpts) cpts.set(c.id, c);
    const filename = path.split(/[\\/]/).pop() ?? path;
    const doc: ProjectDocument = {
      kind: "project",
      id: makeId(),
      title: result.project.title || filename,
      path,
      meta: result.project,
      cpts,
      activeCptId: result.cpts[0]?.id ?? null,
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
      activeCptId: null,
    };
    const documents = [...s.documents, doc];
    const activeDocId = doc.id;
    const derived = deriveFromActive(documents, activeDocId);
    return { documents, activeDocId, ...derived };
  });
}

/**
 * Routes a file path to either `loadCptFromContent` (GEF / XML) or
 * `openProjectIfcgis` (.ifcgis) based on the extension. Returns true
 * when the file was handled, false otherwise.
 */
export async function openPathByExtension(path: string): Promise<boolean> {
  const lower = path.toLowerCase();
  if (lower.endsWith(".ifcgis")) {
    await openProjectIfcgis(path);
    return true;
  }
  if (lower.endsWith(".gef") || lower.endsWith(".xml") || lower.endsWith(".ifcgeo")) {
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const content = await readTextFile(path);
    const filename = path.split(/[\\/]/).pop() ?? path;
    await loadCptFromContent(content, filename, path);
    return true;
  }
  return false;
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
  const xml = await invoke<string>("fetch_bro_cpt", { broId });
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
  // Parse the new CPT first — failure should leave state unchanged.
  const newCpt = await invoke<Cpt>("open_cpt", {
    content: newCptContent,
    filename: newCptFilename,
  });
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
