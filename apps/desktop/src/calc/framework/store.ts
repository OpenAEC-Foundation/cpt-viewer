import { create } from "zustand";
import type { CalculationInstance } from "./types";

interface CalculationsStore {
  byDoc: Map<string, CalculationInstance[]>;
  activeCalcId: string | null;

  addCalculation: (docId: string, moduleId: string, name: string, input?: unknown) => string;
  updateCalculation: (
    docId: string,
    id: string,
    patch: Partial<Omit<CalculationInstance, "id" | "createdAt">>,
  ) => void;
  removeCalculation: (docId: string, id: string) => void;
  duplicate: (docId: string, id: string) => string;
  setActive: (id: string | null) => void;
  loadFromIfcx: (docId: string, list: CalculationInstance[]) => void;
  getList: (docId: string) => CalculationInstance[];
  getActive: () => { docId: string; instance: CalculationInstance } | null;
}

function makeId(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

export const useCalculationsStore = create<CalculationsStore>((set, get) => ({
  byDoc: new Map(),
  activeCalcId: null,

  addCalculation: (docId, moduleId, name, input = {}) => {
    const id = makeId();
    const ts = nowIso();
    const instance: CalculationInstance = {
      id,
      moduleId,
      name,
      input,
      createdAt: ts,
      updatedAt: ts,
    };
    set((s) => {
      const next = new Map(s.byDoc);
      next.set(docId, [...(next.get(docId) ?? []), instance]);
      return { byDoc: next, activeCalcId: id };
    });
    return id;
  },

  updateCalculation: (docId, id, patch) => {
    set((s) => {
      const list = s.byDoc.get(docId);
      if (!list) return s;
      const next = new Map(s.byDoc);
      next.set(
        docId,
        list.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: nowIso() } : c)),
      );
      return { byDoc: next };
    });
  },

  removeCalculation: (docId, id) => {
    set((s) => {
      const list = s.byDoc.get(docId);
      if (!list) return s;
      const next = new Map(s.byDoc);
      next.set(
        docId,
        list.filter((c) => c.id !== id),
      );
      const wasActive = s.activeCalcId === id;
      return { byDoc: next, activeCalcId: wasActive ? null : s.activeCalcId };
    });
  },

  duplicate: (docId, id) => {
    const list = get().byDoc.get(docId);
    if (!list) return "";
    const src = list.find((c) => c.id === id);
    if (!src) return "";
    const newId = makeId();
    const ts = nowIso();
    const copy: CalculationInstance = {
      ...src,
      id: newId,
      name: `${src.name} (kopie)`,
      createdAt: ts,
      updatedAt: ts,
    };
    set((s) => {
      const next = new Map(s.byDoc);
      next.set(docId, [...(next.get(docId) ?? []), copy]);
      return { byDoc: next };
    });
    return newId;
  },

  setActive: (id) => set({ activeCalcId: id }),

  loadFromIfcx: (docId, list) => {
    set((s) => {
      const next = new Map(s.byDoc);
      next.set(docId, list);
      return { byDoc: next };
    });
  },

  getList: (docId) => get().byDoc.get(docId) ?? [],

  getActive: () => {
    const id = get().activeCalcId;
    if (!id) return null;
    for (const [docId, list] of get().byDoc) {
      const inst = list.find((c) => c.id === id);
      if (inst) return { docId, instance: inst };
    }
    return null;
  },
}));
