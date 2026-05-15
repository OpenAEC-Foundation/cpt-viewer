import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Cpt, ProjectMeta } from "../types/cpt";

interface HoveredPoint {
  depth: number;
  qc?: number;
  fs?: number;
  rf?: number;
  u2?: number;
  soil?: string;
}

interface CptStore {
  cpts: Map<string, Cpt>;
  activeCptId: string | null;
  hoveredPoint: HoveredPoint | null;
  projectMeta: ProjectMeta;

  closeCpt: (id: string) => Promise<void>;
  closeAll: () => Promise<void>;
  setActive: (id: string | null) => void;
  setHover: (p: HoveredPoint | null) => void;
  setProjectMeta: (m: Partial<ProjectMeta>) => void;
}

const today = new Date().toISOString().slice(0, 10);

export const useCptStore = create<CptStore>((set, get) => ({
  cpts: new Map(),
  activeCptId: null,
  hoveredPoint: null,
  projectMeta: {
    title: "Nieuw project",
    client: "",
    location: "",
    project_number: "",
    author: "",
    date: today,
  },

  async closeCpt(id: string) {
    await invoke("close_cpt", { id });
    set((s) => {
      const next = new Map(s.cpts);
      next.delete(id);
      const firstKey = next.keys().next();
      const newActive = s.activeCptId === id
        ? (firstKey.done ? null : firstKey.value)
        : s.activeCptId;
      return { cpts: next, activeCptId: newActive };
    });
  },

  async closeAll() {
    const ids = Array.from(get().cpts.keys());
    for (const id of ids) await invoke("close_cpt", { id });
    set({ cpts: new Map(), activeCptId: null });
  },

  setActive(id) { set({ activeCptId: id }); },
  setHover(p) { set({ hoveredPoint: p }); },
  setProjectMeta(m) { set((s) => ({ projectMeta: { ...s.projectMeta, ...m } })); },
}));

/**
 * Invokes the `open_cpt` Tauri command with file content + filename,
 * then merges the returned Cpt into the store and makes it active.
 */
export async function loadCptFromContent(content: string, filename: string): Promise<Cpt> {
  const cpt = await invoke<Cpt>("open_cpt", { content, filename });
  useCptStore.setState((s) => {
    const next = new Map(s.cpts);
    next.set(cpt.id, cpt);
    return { cpts: next, activeCptId: cpt.id };
  });
  return cpt;
}
