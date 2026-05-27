# Calculations Framework + Pile-Bearing-Capacity Module — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lever een uitbreidbaar Berekeningen-framework op + de eerste werkende module (paaldraagvermogen volgens NEN-EN 1997-1 §7.6), inclusief 5 placeholder-modules voor toekomstige berekening-typen en IFCX-persistentie.

**Architecture:** Top-level "Berekeningen" Ribbon-tab → `CalculationsView` 3-pane (library/input | visualisatie | uitvoer). Pure TypeScript-berekeningen voor consistente browser+Tauri-werking. Module-registry pattern — elke calc-type is een opt-in extensie. Persistentie via `calculations[]` array in `.ifcgeo` (IFCX schema bump 0.3 → 0.4).

**Tech Stack:** TypeScript (strict), React 19, zustand 5, vitest (nieuw), React Testing Library (nieuw), Rust (cpt-core ifcgis schema). Geen WASM/Rust voor berekeningen — pure TS in `apps/desktop/src/calc/`.

**Specs:**
- [`2026-05-21-calculations-framework-design.md`](../specs/2026-05-21-calculations-framework-design.md)
- [`2026-05-21-pile-bearing-capacity-module-design.md`](../specs/2026-05-21-pile-bearing-capacity-module-design.md)

**Phases:**
- Phase 0 (Tasks 1-9): Framework skeleton + vitest infra
- Phase 1 (Tasks 10-14): Coming-soon placeholders + extension wiring
- Phase 2 (Tasks 15-27): Pile-bearing-capacity module (TDD per part)
- Phase 3 (Tasks 28-31): IFCX persistentie + Project save/load + polish

---

## Phase 0 — Framework Skeleton

### Task 1: Install vitest + jsdom + RTL

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/vite.config.ts`
- Create: `apps/desktop/src/test-setup.ts`

- [ ] **Step 1: Install dev dependencies**

```bash
cd apps/desktop && npm install -D vitest @vitest/ui jsdom @testing-library/react @testing-library/dom @testing-library/jest-dom
```

Expected: dependencies added to `package.json`, lockfile updated.

- [ ] **Step 2: Add test scripts to package.json**

Edit `apps/desktop/package.json` — vervang het hele `"scripts"` blok door:

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "test": "vitest run",
    "test:watch": "vitest"
  },
```

- [ ] **Step 3: Update vite.config.ts to include test config**

Vervang de hele inhoud van `apps/desktop/vite.config.ts` door:

```ts
/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 3020,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 3011 }
      : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "src-tauri"],
  },
}));
```

- [ ] **Step 4: Create test-setup.ts**

```ts
// apps/desktop/src/test-setup.ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: Smoke test to verify setup works**

Create `apps/desktop/src/test-smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("vitest setup", () => {
  it("runs basic assertions", () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `cd apps/desktop && npm test`

Expected: 1 passed test, no errors. Vitest output shows `test-smoke.test.ts`.

- [ ] **Step 6: Delete the smoke test + commit**

```bash
rm apps/desktop/src/test-smoke.test.ts
cd /c/Users/rickd/Documents/GitHub/cpt-viewer
git add apps/desktop/package.json apps/desktop/package-lock.json apps/desktop/vite.config.ts apps/desktop/src/test-setup.ts
git commit -m "chore(test): vitest + RTL setup voor calc-module unit tests"
```

---

### Task 2: Create framework types

**Files:**
- Create: `apps/desktop/src/calc/framework/types.ts`

- [ ] **Step 1: Write the types**

```ts
// apps/desktop/src/calc/framework/types.ts
import type { ReactNode, FC } from "react";
import type { Cpt, ProjectMeta } from "../../types/cpt";

/** Categorie waarmee modules in de UI gegroepeerd worden. */
export type CalcCategory = "pile" | "spread" | "wall" | "anchor";

/** Implementatie-status — bepaalt of de module échte UI rendert of een
 *  "Coming soon"-placeholder. */
export type CalcStatus = "available" | "coming-soon";

/** Context die de framework aan elke module-aanroep meegeeft. */
export interface ProjectContext {
  cpts: Map<string, Cpt>;
  activeCptId: string | null;
  projectMeta: ProjectMeta;
}

/** Eén element in een paneel van de Berekeningen-view. Module-specifiek. */
export interface PanelProps<TInput, TResult> {
  input: TInput;
  result: TResult;
  onChange?: (next: TInput) => void;
}

/** Module-blueprint. Elke calc-type implementeert deze interface. */
export interface CalcModule<TInput = unknown, TResult = unknown> {
  id: string;                    // "pile-bearing-capacity"
  name: string;                  // UI-naam in NL
  subtitle: string;              // korte ondertitel
  category: CalcCategory;
  icon: ReactNode;
  norm: string;                  // "NEN-EN 1997-1:2005+A1:2013+NB:2019"
  status: CalcStatus;
  defaultInput: (ctx: ProjectContext) => TInput;
  compute: (input: TInput, ctx: ProjectContext) => TResult;
  InputPanel: FC<PanelProps<TInput, TResult>>;
  VisualPanel: FC<PanelProps<TInput, TResult>>;
  ResultPanel: FC<PanelProps<TInput, TResult>>;
  statusLine?: (result: TResult) => { text: string; ok: boolean };
}

/** Eén berekening-instance binnen een project. */
export interface CalculationInstance {
  id: string;                    // UUID, stable over save/load
  moduleId: string;              // "pile-bearing-capacity"
  name: string;                  // user-given e.g. "Hoofdgebouw"
  input: unknown;                // module-specific JSON
  createdAt: string;             // ISO 8601
  updatedAt: string;             // ISO 8601
  cptRefs?: string[];
  boreRefs?: string[];
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd apps/desktop && npx tsc --noEmit`

Expected: no errors (file is imports-only, no runtime).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/calc/framework/types.ts
git commit -m "feat(calc): framework types — CalcModule, CalculationInstance, ProjectContext"
```

---

### Task 3: Module registry + lookup

**Files:**
- Create: `apps/desktop/src/calc/framework/registry.ts`
- Create: `apps/desktop/src/calc/framework/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/desktop/src/calc/framework/registry.test.ts
import { describe, it, expect } from "vitest";
import { CALC_REGISTRY, getCalcModule } from "./registry";

describe("calc registry", () => {
  it("exports a non-empty array", () => {
    expect(CALC_REGISTRY.length).toBeGreaterThan(0);
  });

  it("has unique module ids", () => {
    const ids = CALC_REGISTRY.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getCalcModule returns undefined for unknown id", () => {
    expect(getCalcModule("does-not-exist")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npm test`

Expected: FAIL — `Cannot find module './registry'`.

- [ ] **Step 3: Write minimal registry implementation**

```ts
// apps/desktop/src/calc/framework/registry.ts
import type { CalcModule } from "./types";

/**
 * Single source of truth voor alle calc-modules. Modules registreren
 * zichzelf hier via een import + entry. Volgorde bepaalt de UI-volgorde
 * in de "Nieuwe berekening"-dialog.
 *
 * Voor v1 begint deze leeg — modules worden toegevoegd in latere tasks.
 * De smoke-test in registry.test.ts gebruikt een lokale dummy zodat
 * deze file niet altijd modules nodig heeft om te valideren.
 */
export const CALC_REGISTRY: CalcModule[] = [];

export function getCalcModule(id: string): CalcModule | undefined {
  return CALC_REGISTRY.find((m) => m.id === id);
}
```

- [ ] **Step 4: Update test to handle empty registry**

Vervang `registry.test.ts` door:

```ts
import { describe, it, expect } from "vitest";
import { CALC_REGISTRY, getCalcModule } from "./registry";

describe("calc registry", () => {
  it("is a defined array", () => {
    expect(Array.isArray(CALC_REGISTRY)).toBe(true);
  });

  it("has unique module ids if any modules are registered", () => {
    const ids = CALC_REGISTRY.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getCalcModule returns undefined for unknown id", () => {
    expect(getCalcModule("does-not-exist")).toBeUndefined();
  });
});
```

- [ ] **Step 5: Run test to verify pass**

Run: `cd apps/desktop && npm test`

Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/calc/framework/registry.ts apps/desktop/src/calc/framework/registry.test.ts
git commit -m "feat(calc): module registry with getCalcModule lookup"
```

---

### Task 4: useCalculationsStore (zustand)

**Files:**
- Create: `apps/desktop/src/calc/framework/store.ts`
- Create: `apps/desktop/src/calc/framework/store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/desktop/src/calc/framework/store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useCalculationsStore } from "./store";

beforeEach(() => {
  // Reset store state between tests
  useCalculationsStore.setState({ byDoc: new Map(), activeCalcId: null });
});

describe("useCalculationsStore", () => {
  it("addCalculation creates instance with stable id + timestamps", () => {
    const id = useCalculationsStore
      .getState()
      .addCalculation("doc-1", "pile-bearing-capacity", "Hoofdgebouw");
    const state = useCalculationsStore.getState();
    const list = state.byDoc.get("doc-1");
    expect(list).toHaveLength(1);
    expect(list![0].id).toBe(id);
    expect(list![0].moduleId).toBe("pile-bearing-capacity");
    expect(list![0].name).toBe("Hoofdgebouw");
    expect(list![0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(state.activeCalcId).toBe(id);
  });

  it("updateCalculation merges patch + bumps updatedAt", async () => {
    const id = useCalculationsStore.getState().addCalculation("doc-1", "x", "n");
    const before = useCalculationsStore.getState().byDoc.get("doc-1")![0].updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    useCalculationsStore.getState().updateCalculation("doc-1", id, { name: "Nieuw" });
    const after = useCalculationsStore.getState().byDoc.get("doc-1")![0];
    expect(after.name).toBe("Nieuw");
    expect(after.updatedAt).not.toBe(before);
  });

  it("removeCalculation deletes by id and clears activeCalcId", () => {
    const id = useCalculationsStore.getState().addCalculation("doc-1", "x", "n");
    useCalculationsStore.getState().removeCalculation("doc-1", id);
    expect(useCalculationsStore.getState().byDoc.get("doc-1") ?? []).toHaveLength(0);
    expect(useCalculationsStore.getState().activeCalcId).toBeNull();
  });

  it("duplicate creates a copy with new id + ' (kopie)' suffix", () => {
    const id1 = useCalculationsStore.getState().addCalculation("doc-1", "x", "Origineel");
    const id2 = useCalculationsStore.getState().duplicate("doc-1", id1);
    expect(id2).not.toBe(id1);
    const list = useCalculationsStore.getState().byDoc.get("doc-1")!;
    expect(list).toHaveLength(2);
    expect(list[1].name).toBe("Origineel (kopie)");
  });

  it("loadFromIfcx replaces byDoc[docId] with deserialized list", () => {
    const sample = [
      {
        id: "u1",
        moduleId: "pile-bearing-capacity",
        name: "Test",
        input: { foo: 1 },
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];
    useCalculationsStore.getState().loadFromIfcx("doc-1", sample);
    const list = useCalculationsStore.getState().byDoc.get("doc-1")!;
    expect(list).toEqual(sample);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npm test`

Expected: FAIL — `Cannot find module './store'`.

- [ ] **Step 3: Write store implementation**

```ts
// apps/desktop/src/calc/framework/store.ts
import { create } from "zustand";
import type { CalculationInstance } from "./types";

interface CalculationsStore {
  byDoc: Map<string, CalculationInstance[]>;
  activeCalcId: string | null;

  addCalculation: (docId: string, moduleId: string, name: string, input?: unknown) => string;
  updateCalculation: (docId: string, id: string, patch: Partial<Omit<CalculationInstance, "id" | "createdAt">>) => void;
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
      next.set(docId, list.filter((c) => c.id !== id));
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
```

- [ ] **Step 4: Run tests**

Run: `cd apps/desktop && npm test`

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/calc/framework/store.ts apps/desktop/src/calc/framework/store.test.ts
git commit -m "feat(calc): useCalculationsStore — CRUD + duplicate + active state"
```

---

### Task 5: IFCX persistence helpers

**Files:**
- Create: `apps/desktop/src/calc/framework/persistence.ts`
- Create: `apps/desktop/src/calc/framework/persistence.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/desktop/src/calc/framework/persistence.test.ts
import { describe, it, expect } from "vitest";
import { toIfcxArray, fromIfcxArray } from "./persistence";
import type { CalculationInstance } from "./types";

const sample: CalculationInstance[] = [
  {
    id: "u1",
    moduleId: "pile-bearing-capacity",
    name: "Hoofdgebouw",
    input: { pile_top_nap: 0.34, pile_toe_nap: -14.5, diameter_mm: 219 },
    createdAt: "2026-05-21T10:00:00Z",
    updatedAt: "2026-05-21T11:30:00Z",
    cptRefs: ["CPT000000004317"],
  },
];

describe("calc persistence", () => {
  it("toIfcxArray converts camelCase keys to snake_case", () => {
    const out = toIfcxArray(sample);
    expect(out[0]).toMatchObject({
      id: "u1",
      module_id: "pile-bearing-capacity",
      name: "Hoofdgebouw",
      created_at: "2026-05-21T10:00:00Z",
      updated_at: "2026-05-21T11:30:00Z",
      cpt_refs: ["CPT000000004317"],
    });
    // input payload is doorgegeven zonder transformatie
    expect(out[0].input).toEqual(sample[0].input);
  });

  it("fromIfcxArray converts snake_case back to camelCase", () => {
    const raw = toIfcxArray(sample);
    const back = fromIfcxArray(raw);
    expect(back).toEqual(sample);
  });

  it("fromIfcxArray ignores entries with missing required fields", () => {
    const broken = [{ id: "x", name: "no module" }];
    expect(fromIfcxArray(broken)).toEqual([]);
  });

  it("fromIfcxArray accepts empty / undefined", () => {
    expect(fromIfcxArray([])).toEqual([]);
    expect(fromIfcxArray(undefined)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test (expect fail)**

Run: `cd apps/desktop && npm test`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement persistence**

```ts
// apps/desktop/src/calc/framework/persistence.ts
import type { CalculationInstance } from "./types";

/** Snake_case JSON-vorm zoals opgeslagen in .ifcgeo */
interface CalculationIfcx {
  id: string;
  module_id: string;
  name: string;
  input: unknown;
  created_at: string;
  updated_at: string;
  cpt_refs?: string[];
  bore_refs?: string[];
}

export function toIfcxArray(list: CalculationInstance[]): CalculationIfcx[] {
  return list.map((c) => {
    const out: CalculationIfcx = {
      id: c.id,
      module_id: c.moduleId,
      name: c.name,
      input: c.input,
      created_at: c.createdAt,
      updated_at: c.updatedAt,
    };
    if (c.cptRefs && c.cptRefs.length > 0) out.cpt_refs = c.cptRefs;
    if (c.boreRefs && c.boreRefs.length > 0) out.bore_refs = c.boreRefs;
    return out;
  });
}

export function fromIfcxArray(raw: unknown): CalculationInstance[] {
  if (!Array.isArray(raw)) return [];
  const out: CalculationInstance[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (
      typeof r.id !== "string" ||
      typeof r.module_id !== "string" ||
      typeof r.name !== "string"
    ) {
      continue;
    }
    out.push({
      id: r.id,
      moduleId: r.module_id,
      name: r.name,
      input: r.input ?? {},
      createdAt: typeof r.created_at === "string" ? r.created_at : new Date().toISOString(),
      updatedAt: typeof r.updated_at === "string" ? r.updated_at : new Date().toISOString(),
      cptRefs: Array.isArray(r.cpt_refs) ? (r.cpt_refs as string[]) : undefined,
      boreRefs: Array.isArray(r.bore_refs) ? (r.bore_refs as string[]) : undefined,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/desktop && npm test`

Expected: 4 passed (plus earlier tests still passing).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/calc/framework/persistence.ts apps/desktop/src/calc/framework/persistence.test.ts
git commit -m "feat(calc): IFCX persistence — snake_case roundtrip serializers"
```

---

### Task 6: CalculationsView skeleton + ComingSoonPanel

**Files:**
- Create: `apps/desktop/src/calc/framework/views/CalculationsView.tsx`
- Create: `apps/desktop/src/calc/framework/views/CalculationsView.css`
- Create: `apps/desktop/src/calc/framework/views/ComingSoonPanel.tsx`

- [ ] **Step 1: Create ComingSoonPanel**

```tsx
// apps/desktop/src/calc/framework/views/ComingSoonPanel.tsx
import type { CalcModule } from "../types";

export function ComingSoonPanel({ module }: { module: CalcModule }) {
  return (
    <div className="calc-coming-soon">
      <div className="calc-coming-soon-icon">🔜</div>
      <h2>{module.name}</h2>
      <p className="calc-coming-soon-norm">{module.norm}</p>
      <p className="calc-coming-soon-desc">{module.subtitle}</p>
      <p className="calc-coming-soon-hint">
        Deze module wordt nog gebouwd. Volg de roadmap op{" "}
        <a
          href="https://github.com/OpenAEC-Foundation/open-geotechniek-studio"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
        .
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Create CalculationsView container**

```tsx
// apps/desktop/src/calc/framework/views/CalculationsView.tsx
import { useMemo } from "react";
import { useCalculationsStore } from "../store";
import { getCalcModule } from "../registry";
import { useCptStore } from "../../../store/useCptStore";
import { ComingSoonPanel } from "./ComingSoonPanel";
import type { ProjectContext } from "../types";
import "./CalculationsView.css";

/**
 * Top-level werkruimte voor de Berekeningen-tab. Toont een 3-pane
 * layout: library + input links, visualisatie midden, uitvoer rechts.
 * Module-specifieke panelen worden via de CalcModule's InputPanel /
 * VisualPanel / ResultPanel exports geleverd.
 */
export function CalculationsView() {
  const active = useCalculationsStore((s) => s.getActive());
  const cpts = useCptStore((s) => s.cpts);
  const activeCptId = useCptStore((s) => s.activeCptId);
  const projectMeta = useCptStore((s) => s.projectMeta);

  const ctx: ProjectContext = useMemo(
    () => ({ cpts, activeCptId, projectMeta }),
    [cpts, activeCptId, projectMeta],
  );

  if (!active) {
    return (
      <div className="calc-view calc-view-empty">
        <div className="calc-empty-state">
          <p>Geen berekening geselecteerd.</p>
          <p className="calc-empty-hint">
            Maak een nieuwe berekening via "+" in het project-paneel.
          </p>
        </div>
      </div>
    );
  }

  const mod = getCalcModule(active.instance.moduleId);
  if (!mod) {
    return (
      <div className="calc-view calc-view-empty">
        <div className="calc-empty-state">
          <p>Onbekend module-type: <code>{active.instance.moduleId}</code></p>
        </div>
      </div>
    );
  }

  // Coming-soon: korte placeholder in plaats van échte berekening
  if (mod.status === "coming-soon") {
    return (
      <div className="calc-view">
        <aside className="calc-pane calc-pane-left">
          <h3 className="calc-pane-title">Project</h3>
          <p className="calc-empty-hint">Library volgt — Task 7</p>
        </aside>
        <main className="calc-pane calc-pane-mid">
          <ComingSoonPanel module={mod} />
        </main>
        <aside className="calc-pane calc-pane-right">
          <ComingSoonPanel module={mod} />
        </aside>
      </div>
    );
  }

  // Available module: render de drie module-specifieke panelen
  const input = active.instance.input as never;
  const result = mod.compute(input, ctx) as never;
  const onChange = (next: unknown) => {
    useCalculationsStore.getState().updateCalculation(
      active.docId,
      active.instance.id,
      { input: next },
    );
  };

  return (
    <div className="calc-view">
      <aside className="calc-pane calc-pane-left">
        <h3 className="calc-pane-title">{mod.name}</h3>
        <mod.InputPanel input={input} result={result} onChange={onChange} />
      </aside>
      <main className="calc-pane calc-pane-mid">
        <mod.VisualPanel input={input} result={result} />
      </main>
      <aside className="calc-pane calc-pane-right">
        <mod.ResultPanel input={input} result={result} />
      </aside>
    </div>
  );
}
```

- [ ] **Step 3: Create CSS**

```css
/* apps/desktop/src/calc/framework/views/CalculationsView.css */
.calc-view {
  display: grid;
  grid-template-columns: 300px 1fr 380px;
  height: 100%;
  background: var(--theme-bg, #fff);
  color: var(--theme-text, #36363e);
}

.calc-pane {
  overflow: auto;
  border-right: 1px solid var(--theme-border, #e7e5e4);
  padding: 16px;
}
.calc-pane:last-child {
  border-right: 0;
}
.calc-pane-title {
  font: 700 0.95rem var(--font-heading, "Space Grotesk"), "Inter", sans-serif;
  margin: 0 0 12px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--theme-border, #e7e5e4);
}

.calc-view-empty {
  display: flex;
  align-items: center;
  justify-content: center;
}
.calc-empty-state {
  text-align: center;
  color: var(--theme-text-secondary, #71717a);
}
.calc-empty-hint {
  font-size: 0.85rem;
  margin-top: 6px;
}

.calc-coming-soon {
  padding: 40px 20px;
  text-align: center;
  max-width: 460px;
  margin: 40px auto;
}
.calc-coming-soon-icon {
  font-size: 48px;
  margin-bottom: 12px;
}
.calc-coming-soon h2 {
  margin: 0 0 4px;
  font: 700 1.2rem "Inter", sans-serif;
}
.calc-coming-soon-norm {
  font: 500 0.78rem var(--font-code, "JetBrains Mono"), monospace;
  color: var(--theme-text-secondary, #71717a);
  margin: 0 0 16px;
}
.calc-coming-soon-desc {
  font-size: 0.9rem;
  margin-bottom: 16px;
}
.calc-coming-soon-hint {
  font-size: 0.85rem;
  color: var(--theme-text-secondary, #71717a);
}
```

- [ ] **Step 4: Verify TS compiles**

Run: `cd apps/desktop && npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/calc/framework/views/
git commit -m "feat(calc): CalculationsView 3-pane skeleton + ComingSoonPanel"
```

---

### Task 7: ProjectTreePanel — library of calc-instances

**Files:**
- Create: `apps/desktop/src/calc/framework/views/ProjectTreePanel.tsx`
- Modify: `apps/desktop/src/calc/framework/views/CalculationsView.tsx`

- [ ] **Step 1: Create ProjectTreePanel**

```tsx
// apps/desktop/src/calc/framework/views/ProjectTreePanel.tsx
import { useState } from "react";
import { useCalculationsStore } from "../store";
import { useCptStore } from "../../../store/useCptStore";
import { getCalcModule, CALC_REGISTRY } from "../registry";
import type { CalculationInstance } from "../types";

interface Props {
  onAddClick: () => void;
}

/** Library-tree per actief project — lijst van calc-instances. */
export function ProjectTreePanel({ onAddClick }: Props) {
  const activeDocId = useCptStore((s) => s.activeDocId);
  const activeCalcId = useCalculationsStore((s) => s.activeCalcId);
  const list = useCalculationsStore((s) =>
    activeDocId ? s.byDoc.get(activeDocId) ?? [] : [],
  );
  const setActive = useCalculationsStore((s) => s.setActive);
  const remove = useCalculationsStore((s) => s.removeCalculation);
  const duplicate = useCalculationsStore((s) => s.duplicate);
  const update = useCalculationsStore((s) => s.updateCalculation);

  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  if (!activeDocId) {
    return (
      <div className="calc-tree-empty">
        <p>Open een project om berekeningen toe te voegen.</p>
      </div>
    );
  }

  // Group per category
  const grouped = list.reduce<Record<string, CalculationInstance[]>>((acc, c) => {
    const mod = getCalcModule(c.moduleId);
    const cat = mod?.category ?? "other";
    (acc[cat] = acc[cat] ?? []).push(c);
    return acc;
  }, {});

  const categoryNames: Record<string, string> = {
    pile: "Palen",
    spread: "Funderingen",
    wall: "Wanden",
    anchor: "Ankers",
    other: "Overig",
  };

  return (
    <div className="calc-tree">
      <button className="calc-tree-add" onClick={onAddClick}>
        + Nieuwe berekening
      </button>

      {list.length === 0 && (
        <p className="calc-tree-empty-hint">
          Nog geen berekeningen. Klik op "+" om er een toe te voegen.
        </p>
      )}

      {Object.entries(grouped).map(([cat, items]) => (
        <div key={cat} className="calc-tree-group">
          <div className="calc-tree-group-title">{categoryNames[cat] ?? cat}</div>
          <ul>
            {items.map((c) => {
              const mod = getCalcModule(c.moduleId);
              const isActive = c.id === activeCalcId;
              const isRenaming = renaming === c.id;
              return (
                <li key={c.id} className={isActive ? "active" : ""}>
                  {isRenaming ? (
                    <input
                      autoFocus
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onBlur={() => {
                        if (draftName.trim()) {
                          update(activeDocId, c.id, { name: draftName.trim() });
                        }
                        setRenaming(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        if (e.key === "Escape") setRenaming(null);
                      }}
                    />
                  ) : (
                    <button
                      className="calc-tree-item"
                      onClick={() => setActive(c.id)}
                      onDoubleClick={() => {
                        setRenaming(c.id);
                        setDraftName(c.name);
                      }}
                      title={`${mod?.name ?? c.moduleId} — ${c.updatedAt}`}
                    >
                      <span className="calc-tree-item-name">{c.name}</span>
                      {mod?.status === "coming-soon" && (
                        <span className="calc-tree-badge">🔜</span>
                      )}
                    </button>
                  )}
                  <div className="calc-tree-actions">
                    <button
                      onClick={() => duplicate(activeDocId, c.id)}
                      title="Dupliceren"
                    >
                      ⎘
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Verwijder "${c.name}"?`)) {
                          remove(activeDocId, c.id);
                        }
                      }}
                      title="Verwijderen"
                    >
                      ×
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Append CSS for tree**

Append aan `apps/desktop/src/calc/framework/views/CalculationsView.css`:

```css
.calc-tree {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.calc-tree-add {
  padding: 8px 12px;
  background: var(--amber, #d97706);
  color: white;
  border: none;
  border-radius: 6px;
  font: 600 0.85rem "Inter", sans-serif;
  cursor: pointer;
}
.calc-tree-add:hover { opacity: 0.92; }
.calc-tree-empty,
.calc-tree-empty-hint {
  font-size: 0.85rem;
  color: var(--theme-text-secondary, #71717a);
}
.calc-tree-group-title {
  font: 600 0.72rem "Inter", sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--theme-text-secondary, #71717a);
  margin-bottom: 4px;
}
.calc-tree ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.calc-tree li {
  display: flex;
  align-items: center;
  gap: 4px;
}
.calc-tree li.active .calc-tree-item {
  background: var(--theme-bg-lighter, #f5f5f4);
  border-color: var(--amber, #d97706);
}
.calc-tree-item {
  flex: 1;
  text-align: left;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 6px 8px;
  font: 500 0.82rem "Inter", sans-serif;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.calc-tree-item:hover { background: var(--theme-bg-lighter, #f5f5f4); }
.calc-tree-badge {
  font-size: 11px;
  opacity: 0.7;
}
.calc-tree-actions {
  display: flex;
  gap: 2px;
}
.calc-tree-actions button {
  background: transparent;
  border: none;
  color: var(--theme-text-secondary, #71717a);
  cursor: pointer;
  padding: 2px 4px;
  font-size: 14px;
}
.calc-tree-actions button:hover { color: var(--theme-text, #36363e); }
```

- [ ] **Step 3: Wire ProjectTreePanel into CalculationsView**

Replace the `<aside className="calc-pane calc-pane-left">` block in `CalculationsView.tsx` to also render the tree:

```tsx
// Add import:
import { ProjectTreePanel } from "./ProjectTreePanel";
import { NewCalculationDialog } from "./NewCalculationDialog";  // built next task
import { useState } from "react";

// Inside the component:
const [showNewDialog, setShowNewDialog] = useState(false);

// And the JSX:
return (
  <div className="calc-view">
    <aside className="calc-pane calc-pane-left">
      <ProjectTreePanel onAddClick={() => setShowNewDialog(true)} />
      {active && mod && mod.status === "available" && (
        <>
          <h3 className="calc-pane-title" style={{ marginTop: 16 }}>{mod.name}</h3>
          <mod.InputPanel input={input} result={result} onChange={onChange} />
        </>
      )}
    </aside>
    {/* ... mid + right unchanged ... */}
    <NewCalculationDialog open={showNewDialog} onClose={() => setShowNewDialog(false)} />
  </div>
);
```

> Note: The full restructure of `CalculationsView.tsx` is non-trivial — the engineer should replace the existing render to integrate the tree on the left and split when there's no active instance. Keep the empty state but always render ProjectTreePanel first.

- [ ] **Step 4: Verify TS compiles (NewCalculationDialog import will fail until Task 8)**

For now create a stub:

```tsx
// apps/desktop/src/calc/framework/views/NewCalculationDialog.tsx (stub)
export function NewCalculationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <div onClick={onClose}>NewCalculationDialog stub — built in Task 8</div>;
}
```

Run: `cd apps/desktop && npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/calc/framework/views/
git commit -m "feat(calc): ProjectTreePanel with grouped library + rename/duplicate/delete"
```

---

### Task 8: NewCalculationDialog — module picker

**Files:**
- Modify: `apps/desktop/src/calc/framework/views/NewCalculationDialog.tsx`
- Append: `apps/desktop/src/calc/framework/views/CalculationsView.css`

- [ ] **Step 1: Replace stub with real dialog**

```tsx
// apps/desktop/src/calc/framework/views/NewCalculationDialog.tsx
import { useState, useMemo } from "react";
import { CALC_REGISTRY } from "../registry";
import { useCalculationsStore } from "../store";
import { useCptStore } from "../../../store/useCptStore";
import type { CalcCategory } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<CalcCategory, string> = {
  pile: "Palen",
  spread: "Funderingen",
  wall: "Wanden",
  anchor: "Ankers",
};

export function NewCalculationDialog({ open, onClose }: Props) {
  const activeDocId = useCptStore((s) => s.activeDocId);
  const projectMeta = useCptStore((s) => s.projectMeta);
  const cpts = useCptStore((s) => s.cpts);
  const activeCptId = useCptStore((s) => s.activeCptId);
  const addCalc = useCalculationsStore((s) => s.addCalculation);
  const updateCalc = useCalculationsStore((s) => s.updateCalculation);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");

  const grouped = useMemo(() => {
    const g: Record<string, typeof CALC_REGISTRY> = {};
    for (const m of CALC_REGISTRY) {
      (g[m.category] = g[m.category] ?? []).push(m);
    }
    return g;
  }, []);

  if (!open) return null;

  const handleAdd = () => {
    if (!selectedId || !activeDocId) return;
    const mod = CALC_REGISTRY.find((m) => m.id === selectedId);
    if (!mod) return;
    const ctx = { cpts, activeCptId, projectMeta };
    const input = mod.defaultInput(ctx);
    const finalName = name.trim() || `${mod.name} ${Date.now().toString(36).slice(-4)}`;
    const id = addCalc(activeDocId, mod.id, finalName);
    updateCalc(activeDocId, id, { input });
    onClose();
  };

  return (
    <div className="calc-modal-backdrop" onClick={onClose}>
      <div className="calc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="calc-modal-header">
          <h2>Nieuwe berekening</h2>
          <button className="calc-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="calc-modal-body">
          <label className="calc-modal-field">
            <span>Naam</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="bv. Hoofdgebouw paalfundering"
            />
          </label>

          <div className="calc-modal-modules">
            {(Object.keys(CATEGORY_LABELS) as CalcCategory[]).map((cat) => (
              <div key={cat} className="calc-modal-category">
                <div className="calc-modal-category-title">{CATEGORY_LABELS[cat]}</div>
                {(grouped[cat] ?? []).map((m) => (
                  <label key={m.id} className="calc-modal-module">
                    <input
                      type="radio"
                      name="module"
                      value={m.id}
                      checked={selectedId === m.id}
                      onChange={() => setSelectedId(m.id)}
                    />
                    <div className="calc-modal-module-text">
                      <div>
                        <strong>{m.name}</strong>
                        {m.status === "coming-soon" && (
                          <span className="calc-modal-soon"> 🔜</span>
                        )}
                      </div>
                      <small>{m.norm}</small>
                    </div>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="calc-modal-footer">
          <button onClick={onClose}>Annuleren</button>
          <button
            className="primary"
            disabled={!selectedId || !activeDocId}
            onClick={handleAdd}
          >
            Toevoegen
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Append modal CSS**

Append aan `CalculationsView.css`:

```css
.calc-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}
.calc-modal {
  background: var(--theme-bg, #fff);
  border-radius: 8px;
  width: 540px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
}
.calc-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--theme-border, #e7e5e4);
}
.calc-modal-header h2 { margin: 0; font: 700 1.1rem "Inter", sans-serif; }
.calc-modal-close {
  background: transparent;
  border: none;
  font-size: 22px;
  cursor: pointer;
  color: var(--theme-text-secondary, #71717a);
}
.calc-modal-body {
  padding: 16px 20px;
  overflow: auto;
}
.calc-modal-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 16px;
}
.calc-modal-field span {
  font: 600 0.78rem "Inter", sans-serif;
}
.calc-modal-field input {
  padding: 6px 8px;
  border: 1px solid var(--theme-border, #cbd5e1);
  border-radius: 4px;
  font-size: 0.9rem;
}
.calc-modal-category {
  margin-bottom: 12px;
}
.calc-modal-category-title {
  font: 600 0.72rem "Inter", sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--theme-text-secondary, #71717a);
  margin-bottom: 4px;
}
.calc-modal-module {
  display: flex;
  gap: 8px;
  padding: 6px;
  border-radius: 4px;
  cursor: pointer;
}
.calc-modal-module:hover {
  background: var(--theme-bg-lighter, #f5f5f4);
}
.calc-modal-module-text small {
  display: block;
  font: 400 0.72rem var(--font-code, "JetBrains Mono"), monospace;
  color: var(--theme-text-secondary, #71717a);
}
.calc-modal-soon { color: var(--amber, #d97706); }
.calc-modal-footer {
  padding: 12px 20px;
  border-top: 1px solid var(--theme-border, #e7e5e4);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.calc-modal-footer button {
  padding: 6px 14px;
  border-radius: 4px;
  border: 1px solid var(--theme-border, #cbd5e1);
  background: var(--theme-bg, #fff);
  cursor: pointer;
  font: 600 0.85rem "Inter", sans-serif;
}
.calc-modal-footer button.primary {
  background: var(--amber, #d97706);
  color: white;
  border-color: var(--amber, #d97706);
}
.calc-modal-footer button.primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

- [ ] **Step 3: Verify TS compiles**

Run: `cd apps/desktop && npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/calc/framework/views/
git commit -m "feat(calc): NewCalculationDialog module-picker with category grouping"
```

---

### Task 9: Berekeningen Ribbon-tab + App routing

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/components/ribbon/Ribbon.tsx`
- Create: `apps/desktop/src/components/ribbon/BerekeningenTab.tsx`

- [ ] **Step 1: Create the BerekeningenTab Ribbon component**

```tsx
// apps/desktop/src/components/ribbon/BerekeningenTab.tsx
import { useCalculationsStore } from "../../calc/framework/store";
import { useCptStore } from "../../store/useCptStore";

/** Ribbon-tab content voor "Berekeningen". Toont een knop "+ Nieuwe
 *  berekening" + lijst van bestaande berekeningen in het actieve
 *  project (snel-selecteer). */
export function BerekeningenTab() {
  const activeDocId = useCptStore((s) => s.activeDocId);
  const list = useCalculationsStore((s) =>
    activeDocId ? s.byDoc.get(activeDocId) ?? [] : [],
  );
  const setActive = useCalculationsStore((s) => s.setActive);

  return (
    <div className="ribbon-content ribbon-berekeningen">
      <button
        className="ribbon-btn ribbon-btn-primary"
        onClick={() => {
          window.dispatchEvent(new CustomEvent("ogs:open-new-calc"));
        }}
      >
        + Nieuwe berekening
      </button>
      <div className="ribbon-divider" />
      <div className="ribbon-calc-list">
        {list.length === 0 && (
          <span className="ribbon-empty">Nog geen berekeningen</span>
        )}
        {list.map((c) => (
          <button
            key={c.id}
            className="ribbon-btn ribbon-btn-tab"
            onClick={() => setActive(c.id)}
          >
            {c.name}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add tab to Ribbon.tsx**

In `apps/desktop/src/components/ribbon/Ribbon.tsx`:
1. Import:
   ```ts
   import { BerekeningenTab } from "./BerekeningenTab";
   import { useAllExtensions } from "../../hooks/useExtensions";
   ```
2. Inside the Ribbon component, compute `anyCalcEnabled`:
   ```ts
   const exts = useAllExtensions();
   const anyCalcEnabled = Object.entries(exts).some(
     ([id, on]) => on && id.startsWith("calc."),
   );
   ```
3. Voeg de tab toe aan de tab-bar (volg het bestaande pattern voor Sonderingstekening):
   ```tsx
   {anyCalcEnabled && (
     <RibbonTabButton
       id="berekeningen"
       label="Berekeningen"
       active={activeTab === "berekeningen"}
       onClick={() => setActiveTab("berekeningen")}
     />
   )}
   // ...
   {activeTab === "berekeningen" && <BerekeningenTab />}
   ```

> Note: tab-button + tab-content pattern verschilt mogelijk per Ribbon-implementatie. Engineer past het aan op het bestaande pattern; gebruik `Sonderingstekening` als referentie.

- [ ] **Step 3: Add routing in App.tsx**

In `apps/desktop/src/App.tsx`:
1. Add import:
   ```ts
   import { CalculationsView } from "./calc/framework/views/CalculationsView";
   ```
2. Extend the view-union:
   ```ts
   type AppView = "map" | "tekening" | "report" | "ifc" | "calculations";
   ```
3. Listen to ribbon-switch event for `view: "calculations"` en render `<CalculationsView />` in the main work-area branch.

- [ ] **Step 4: Wire "Nieuwe berekening" trigger**

Inside `CalculationsView.tsx`, useEffect met window-listener:

```tsx
useEffect(() => {
  const onOpen = () => setShowNewDialog(true);
  window.addEventListener("ogs:open-new-calc", onOpen);
  return () => window.removeEventListener("ogs:open-new-calc", onOpen);
}, []);
```

- [ ] **Step 5: Verify TS compiles**

Run: `cd apps/desktop && npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/
git commit -m "feat(ribbon): Berekeningen-tab + CalculationsView routing"
```

---

## Phase 1 — Coming-soon Placeholders + Extension Wiring

### Task 10: Helper for placeholder modules

**Files:**
- Create: `apps/desktop/src/calc/framework/comingSoonModule.ts`

- [ ] **Step 1: Create helper**

```ts
// apps/desktop/src/calc/framework/comingSoonModule.ts
import type { ReactNode } from "react";
import type { CalcModule, CalcCategory, PanelProps } from "./types";
import { ComingSoonPanel } from "./views/ComingSoonPanel";

/** Factory voor een placeholder-module. Render-functies wijzen naar
 *  ComingSoonPanel zodat de UI in alle drie de panelen consistent
 *  een "🔜 Wordt gebouwd"-melding toont. */
export function makeComingSoonModule(opts: {
  id: string;
  name: string;
  subtitle: string;
  category: CalcCategory;
  icon: ReactNode;
  norm: string;
}): CalcModule {
  const wrap = (props: PanelProps<unknown, unknown>) => {
    void props;
    return <ComingSoonPanel module={mod} />;
  };
  const mod: CalcModule = {
    ...opts,
    status: "coming-soon",
    defaultInput: () => ({}),
    compute: () => ({}),
    InputPanel: wrap,
    VisualPanel: wrap,
    ResultPanel: wrap,
  };
  return mod;
}
```

> Note: `comingSoonModule.ts` uses JSX so must be renamed to `.tsx` if your linter complains. Use `.tsx` extension.

- [ ] **Step 2: Rename to .tsx + commit**

Move the file: `mv comingSoonModule.ts comingSoonModule.tsx`

```bash
git add apps/desktop/src/calc/framework/comingSoonModule.tsx
git commit -m "feat(calc): makeComingSoonModule helper for placeholder modules"
```

---

### Task 11: Five placeholder modules + register

**Files:**
- Create: `apps/desktop/src/calc/modules/spread-foundation-drained/module.ts`
- Create: `apps/desktop/src/calc/modules/spread-foundation-undrained/module.ts`
- Create: `apps/desktop/src/calc/modules/laterally-loaded-pile/module.ts`
- Create: `apps/desktop/src/calc/modules/sheet-pile-wall/module.ts`
- Create: `apps/desktop/src/calc/modules/ground-anchor/module.ts`
- Modify: `apps/desktop/src/calc/framework/registry.ts`

- [ ] **Step 1: Create each placeholder module**

Repeat for each, only `id`/`name`/`subtitle`/`category`/`norm` differ:

```ts
// apps/desktop/src/calc/modules/spread-foundation-drained/module.ts
import { makeComingSoonModule } from "../../framework/comingSoonModule";

export const spreadFoundationDrainedModule = makeComingSoonModule({
  id: "spread-foundation-drained",
  name: "Fundering op staal — gedraineerd",
  subtitle: "Bezwijken gedraineerde grond (NEN-EN 1997-1 §6.5.2)",
  category: "spread",
  icon: "▭",
  norm: "NEN-EN 1997-1 §6.5",
});
```

Analoog voor:
- `spread-foundation-undrained` — `name: "Fundering op staal — ongedraineerd"`, `subtitle: "Bezwijken ongedraineerde grond (NEN-EN 1997-1 §6.5.2)"`, `category: "spread"`, `norm: "NEN-EN 1997-1 §6.5"`
- `laterally-loaded-pile` — `name: "Horizontaal belaste paal"`, `subtitle: "Dwarsbelasting + buigmoment in de paal"`, `category: "pile"`, `norm: "CUR 166 / NEN 9997-1 §7.7"`
- `sheet-pile-wall` — `name: "Damwandberekening"`, `subtitle: "Gronddruk + buigmoment + zakking"`, `category: "wall"`, `norm: "CUR 166 / NEN-EN 1997-1 §9"`
- `ground-anchor` — `name: "Groutanker"`, `subtitle: "Ankertrekproef + voorspanning"`, `category: "anchor"`, `norm: "EN 1537 / NEN-EN 1997-1 §8"`

- [ ] **Step 2: Wire all modules into registry**

```ts
// apps/desktop/src/calc/framework/registry.ts (replace contents)
import type { CalcModule } from "./types";
import { spreadFoundationDrainedModule } from "../modules/spread-foundation-drained/module";
import { spreadFoundationUndrainedModule } from "../modules/spread-foundation-undrained/module";
import { laterallyLoadedPileModule } from "../modules/laterally-loaded-pile/module";
import { sheetPileWallModule } from "../modules/sheet-pile-wall/module";
import { groundAnchorModule } from "../modules/ground-anchor/module";

export const CALC_REGISTRY: CalcModule[] = [
  // pile-bearing-capacity module komt in Task 26
  laterallyLoadedPileModule,
  spreadFoundationDrainedModule,
  spreadFoundationUndrainedModule,
  sheetPileWallModule,
  groundAnchorModule,
];

export function getCalcModule(id: string): CalcModule | undefined {
  return CALC_REGISTRY.find((m) => m.id === id);
}
```

- [ ] **Step 3: Run tests + TS check**

```bash
cd apps/desktop && npm test && npx tsc --noEmit
```

Expected: all tests pass, no TS errors.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/calc/
git commit -m "feat(calc): 5 placeholder modules registered (coming-soon UI)"
```

---

### Task 12: ExtensionId + defaults for calc modules

**Files:**
- Modify: `apps/desktop/src/hooks/useExtensions.ts`

- [ ] **Step 1: Extend ExtensionId union + SETTING_KEYS + DEFAULTS**

Replace the relevant section of `apps/desktop/src/hooks/useExtensions.ts`:

```ts
export type ExtensionId =
  | "tekening"
  | "offertes"
  | "calc.pile-bearing-capacity"
  | "calc.spread-foundation-drained"
  | "calc.spread-foundation-undrained"
  | "calc.laterally-loaded-pile"
  | "calc.sheet-pile-wall"
  | "calc.ground-anchor";

const SETTING_KEYS: Record<ExtensionId, string> = {
  tekening: "ext.tekening.enabled",
  offertes: "ext.offertes.enabled",
  "calc.pile-bearing-capacity": "ext.calc.pile-bearing-capacity.enabled",
  "calc.spread-foundation-drained": "ext.calc.spread-foundation-drained.enabled",
  "calc.spread-foundation-undrained": "ext.calc.spread-foundation-undrained.enabled",
  "calc.laterally-loaded-pile": "ext.calc.laterally-loaded-pile.enabled",
  "calc.sheet-pile-wall": "ext.calc.sheet-pile-wall.enabled",
  "calc.ground-anchor": "ext.calc.ground-anchor.enabled",
};

const DEFAULTS: Record<ExtensionId, boolean> = {
  tekening: false,
  offertes: false,
  "calc.pile-bearing-capacity": false,
  "calc.spread-foundation-drained": false,
  "calc.spread-foundation-undrained": false,
  "calc.laterally-loaded-pile": false,
  "calc.sheet-pile-wall": false,
  "calc.ground-anchor": false,
};
```

Update de array in `useAllExtensions` (al die calc-ids ook toevoegen aan `const ids: ExtensionId[]`).

- [ ] **Step 2: Verify TS compiles**

Run: `cd apps/desktop && npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/hooks/useExtensions.ts
git commit -m "feat(extensions): add calc.* namespace IDs for all calc-modules"
```

---

### Task 13: ExtensionManagerPanel includes calc modules

**Files:**
- Modify: `apps/desktop/src/components/backstage/ExtensionManagerPanel.tsx`
- Modify: `apps/desktop/src/components/settings/SettingsDialog.tsx`

- [ ] **Step 1: Auto-generate INSTALLED_EXTENSIONS from CALC_REGISTRY**

In `ExtensionManagerPanel.tsx`:

```tsx
import { CALC_REGISTRY } from "../../calc/framework/registry";

// Replace existing INSTALLED_EXTENSIONS with:
const TEKENING_EXT = {
  id: "tekening" as const,
  name: "Situatietekening",
  version: "0.2.9",
  description: "CAD-papier (A2/A3/A4) met sonderingen, snap-systeem, overlays en PDF-export.",
  author: "OpenAEC Foundation",
  category: "Tekening",
};
const OFFERTES_EXT = {
  id: "offertes" as const,
  name: "Offertes opvragen",
  version: "0.2.9",
  description: "Vraagt offertes op bij dichtsbijzijnde sondeerbedrijven.",
  author: "OpenAEC Foundation",
  category: "Werkflow",
};

const INSTALLED_EXTENSIONS = [
  TEKENING_EXT,
  OFFERTES_EXT,
  ...CALC_REGISTRY.map((m) => ({
    id: `calc.${m.id}` as const,
    name: m.name,
    version: m.status === "available" ? "0.3.0" : "0.0.1-coming-soon",
    description: `${m.subtitle} — ${m.norm}`,
    author: "OpenAEC Foundation",
    category: "Berekening",
  })),
];
```

Voor de toggle-checkbox: ook `id`-typing aanpassen naar `string` zodat de `calc.xxx`-ids werken. Gebruik de bestaande `useAllExtensions()` voor de live-state.

- [ ] **Step 2: Update SettingsDialog ExtensionsTabContent similarly**

In `SettingsDialog.tsx` `ExtensionsTabContent`:

```tsx
import { CALC_REGISTRY } from "../../calc/framework/registry";

const items = [
  { id: "tekening" as const, title: "Situatietekening", description: "..." },
  { id: "offertes" as const, title: "Offertes opvragen", description: "..." },
  ...CALC_REGISTRY.map((m) => ({
    id: `calc.${m.id}` as const,
    title: m.name,
    description: `${m.subtitle} (${m.norm})${m.status === "coming-soon" ? " — komt binnenkort" : ""}`,
  })),
];
```

- [ ] **Step 3: TS check + commit**

```bash
cd apps/desktop && npx tsc --noEmit
git add apps/desktop/src/components/
git commit -m "feat(extensions): generate calc-module ext-entries from registry"
```

---

### Task 14: Manual smoke test of framework

- [ ] **Step 1: Start dev server**

```bash
cd apps/desktop && npm run tauri dev
```

- [ ] **Step 2: Verify in app**

1. Open Backstage → Extensies → zie nu de 5 coming-soon calc-modules + existing tekening/offertes
2. Aanvinken b.v. "Horizontaal belaste paal"
3. Sluit Backstage — Ribbon toont nu "Berekeningen"-tab
4. Klik Berekeningen-tab → BerekeningenTab in Ribbon zichtbaar met "+ Nieuwe berekening"
5. Klik "+ Nieuwe berekening" → modal opent
6. Selecteer "Horizontaal belaste paal", typ naam "Test 1", klik Toevoegen
7. CalculationsView toont 3-pane met ComingSoonPanel in midden + rechts

- [ ] **Step 3: No commit — handmatige verificatie**

If iets niet werkt: dat is een bug in Tasks 6-13, debug + commit fix.

---

## Phase 2 — Pile-Bearing-Capacity Module

### Task 15: Module file structure + types

**Files:**
- Create: `apps/desktop/src/calc/modules/pile-bearing-capacity/types.ts`

- [ ] **Step 1: Write all types**

```ts
// apps/desktop/src/calc/modules/pile-bearing-capacity/types.ts

/** Soil-type voor neg.kleef + schachtwrijving. */
export type SoilKind = "sand-dry" | "sand-wet" | "clay" | "peat";

export interface SoilLayer {
  kind: SoilKind;
  startNap: number;            // m NAP (top van laag)
  endNap: number;              // m NAP (onderkant van laag)
  /** Volumegewicht in kN/m³ (droog of nat afhankelijk van GWS). */
  gammaK: number;
  /** Waterdruk-aandeel; 0 voor lagen boven GWS, 10 voor verzadigd. */
  gammaW: number;
  /** Inwendige wrijvingshoek in graden. */
  phi: number;
}

export interface PileTypeSpec {
  id: string;                  // "steel-pipe-driven-closed"
  name: string;                // UI label
  alphaP: number;              // Tabel 7.c
  alphaS: number;
  alphaT: number;
  beta: number;                // 1.0 voor cilindrisch
  s: number;                   // 1.0 voor cilindrisch
  isCircular: boolean;
}

export interface PileInput {
  cptId: string | null;        // referentie naar CPT in project
  pileTypeId: string;          // "steel-pipe-driven-closed"
  diameterMm: number;          // 219
  wallThicknessMm: number;     // 8.0 — voor EA
  pileTopNap: number;          // 0.34
  pileToeNap: number;          // -14.50
  waterNap: number;            // -0.16
  excavationNap: number;       // 0.84
  nEd: number;                 // 324 kN
  nEk: number;                 // 303 kN
  gammaM: number;              // 1.20
  gammaFnk: number;            // 1.00
  negKleefBottomNap: number;   // -9.00
  soilProfile: SoilLayer[];    // user-editable
  ksMinFactor: number;         // 0.25 (Eurocode min-cap)
}

export interface NegKleefLayerResult {
  layer: SoilLayer;
  thickness: number;           // m
  sigmaRepTop: number;         // kPa cumulative at top
  sigmaRepBottom: number;      // kPa cumulative at bottom
  sigmaGemRep: number;         // kPa·m (× Δh)
  k0: number;
  delta: number;               // radians
  k0TanDelta: number;          // ≥ ksMinFactor
  fsNkRep: number;             // kN
}

export interface NegKleefResult {
  layers: NegKleefLayerResult[];
  fnkRep: number;              // sum, kN
  fnkD: number;                // = γf,nk × fnkRep
  bottomNap: number;
  deltaLnk: number;            // paalkop tot bottomNap
}

export interface BaseResistanceResult {
  deqMm: number;
  qcIGemMpa: number;
  qcIIGemMpa: number;
  qcIIIGemMpa: number;
  criticalDepthM: number;      // 0,7..4 Deq onder paalpunt
  qbMaxMpaRaw: number;         // voor cap
  qbMaxMpa: number;            // na cap op 15 MPa
  abMm2: number;
  rbCalMax: number;            // kN
}

export interface ShaftFrictionResult {
  perLayer: Array<{ layer: SoilLayer; qcGemMpa: number; qsMpa: number; rsLayer: number }>;
  rsCalMax: number;            // kN
}

export interface SettlementWorkpoint {
  fcTot: number;               // kN
  sbMm: number;                // paalpunt-zakking
  rbMobil: number;             // kN
  rsMobil: number;             // kN
  fgem: number;                // kN
  selMm: number;               // elastische verkorting
  s1Mm: number;                // totale paalkop-zakking
}

export interface SettlementResult {
  sls: SettlementWorkpoint;
  uls: SettlementWorkpoint;
  curve: Array<{ sbMm: number; rbKn: number; rsKn: number; totalKn: number }>;
}

export interface SpringStiffnessResult {
  kSlsKnPerM: number;
  kUlsKnPerM: number;
  kMinKnPerM: number;
  kMaxKnPerM: number;
}

export interface SummaryResult {
  xi3: number;
  xi4: number;
  rcCal: number;
  rcK: number;
  rcD: number;
  rcNetD: number;
  unityCheck: number;
  passes: boolean;
}

export interface PileResult {
  ok: boolean;
  error?: string;              // human-readable fout, b.v. "Sondering te ondiep"
  warnings: string[];          // niet-kritieke meldingen
  negKleef: NegKleefResult;
  base: BaseResistanceResult;
  shaft: ShaftFrictionResult;
  settlement: SettlementResult;
  spring: SpringStiffnessResult;
  summary: SummaryResult;
}
```

- [ ] **Step 2: Verify TS compiles**

```bash
cd apps/desktop && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/calc/modules/pile-bearing-capacity/types.ts
git commit -m "feat(pile): module types — Input/Result + intermediate per-step types"
```

---

### Task 16: Pile-type catalog + soil-kind defaults

**Files:**
- Create: `apps/desktop/src/calc/modules/pile-bearing-capacity/catalog.ts`

- [ ] **Step 1: Create catalog**

```ts
// apps/desktop/src/calc/modules/pile-bearing-capacity/catalog.ts
import type { PileTypeSpec, SoilKind, SoilLayer } from "./types";

/** Tabel 7.c uit Eurocode 7 NB:2019 — paalklassefactoren. v1: alleen
 *  stalen buispaal geheid gesloten. Uitbreidbaar in v2. */
export const PILE_TYPE_CATALOG: PileTypeSpec[] = [
  {
    id: "steel-pipe-driven-closed",
    name: "Stalen buispaal — geheid (gesloten punt)",
    alphaP: 0.7,
    alphaS: 0.008,
    alphaT: 0.006,
    beta: 1.0,
    s: 1.0,
    isCircular: true,
  },
];

export function getPileType(id: string): PileTypeSpec | undefined {
  return PILE_TYPE_CATALOG.find((p) => p.id === id);
}

/** Default Φ/γ per grondsoort — afgestemd op 3BM CGEO1 ODS template. */
export const SOIL_DEFAULTS: Record<SoilKind, { gammaK: number; gammaW: number; phi: number; label: string }> = {
  "sand-dry": { gammaK: 17, gammaW: 0,  phi: 32.5, label: "Zand droog" },
  "sand-wet": { gammaK: 17, gammaW: 10, phi: 32.5, label: "Zand nat" },
  "clay":     { gammaK: 18, gammaW: 10, phi: 22.5, label: "Klei nat" },
  "peat":     { gammaK: 13, gammaW: 10, phi: 15.0, label: "Veen nat" },
};

/** qs;max per grondsoort in MPa — Tabel 7.d caps. */
export const QS_MAX_PER_SOIL: Record<SoilKind, number> = {
  "sand-dry": 0.15,
  "sand-wet": 0.15,
  "clay":     0.10,
  "peat":     0.02,
};

export function buildDefaultSoilLayers(
  pileTopNap: number,
  pileToeNap: number,
  waterNap: number,
): SoilLayer[] {
  // Conservatieve default: alles tussen paalkop en paalpunt als "klei nat"
  // (geeft hoge neg.kleef). Engineer past dit aan in de UI.
  const layer: SoilLayer = {
    kind: "clay",
    startNap: pileTopNap,
    endNap: pileToeNap,
    gammaK: SOIL_DEFAULTS.clay.gammaK,
    gammaW: pileTopNap > waterNap ? 0 : SOIL_DEFAULTS.clay.gammaW,
    phi: SOIL_DEFAULTS.clay.phi,
  };
  return [layer];
}
```

- [ ] **Step 2: Verify TS + commit**

```bash
cd apps/desktop && npx tsc --noEmit
git add apps/desktop/src/calc/modules/pile-bearing-capacity/catalog.ts
git commit -m "feat(pile): Tabel 7.c catalog + soil-kind defaults"
```

---

### Task 17: CPT fixtures from 984.pdf + 3BM CGEO1

**Files:**
- Create: `apps/desktop/src/calc/modules/pile-bearing-capacity/__fixtures__/sondering-984.json`
- Create: `apps/desktop/src/calc/modules/pile-bearing-capacity/__fixtures__/sondering-3bm-cgeo1.json`

- [ ] **Step 1: Create 984.pdf fixture**

> NOTE: De engineer extraheert de CPT-data uit `verification-files/Constructieberekeningen/Funderingspaal/984.pdf` blad 2 (sondering 1). Voor de fixture maken we een minimaal CPT-object met depth/qc-paren uit de PDF-grafiek, plus de paal-input.

```json
// apps/desktop/src/calc/modules/pile-bearing-capacity/__fixtures__/sondering-984.json
{
  "cpt": {
    "id": "984-S1",
    "metadata": {
      "source_file": "984.pdf blad 1 — sondering 1",
      "project_name": "Funderingsherstel",
      "ground_level_nap": 0.84
    },
    "position": { "x_rd": 108159.7, "y_rd": 445889.3, "z_nap": -1.731 },
    "points": [
      { "depth": 0.0,  "depth_nap": 0.84,   "qc": 0.0 }
    ]
  },
  "input": {
    "cptId": "984-S1",
    "pileTypeId": "steel-pipe-driven-closed",
    "diameterMm": 219,
    "wallThicknessMm": 8.0,
    "pileTopNap": 0.34,
    "pileToeNap": -14.5,
    "waterNap": -0.16,
    "excavationNap": 0.84,
    "nEd": 324,
    "nEk": 303,
    "gammaM": 1.2,
    "gammaFnk": 1.0,
    "negKleefBottomNap": -9.0,
    "ksMinFactor": 0.25,
    "soilProfile": []
  },
  "expected": {
    "fnkD": 35,
    "qbMaxMpa": 11.12,
    "rbCalMax": 419,
    "rsCalMax": 202,
    "rcCal": 621,
    "rcD": 372,
    "rcNetD": 337,
    "unityCheck": 0.96
  }
}
```

> **Engineer:** vul de `points`-array verder met depth+qc-paren uit de 984.pdf grafiek (zie verification-files map). Minimaal 50 punten over 0..−16 m NAP voor representatieve qc;I/II/III gemiddelden. Gebruik approximation: qc-curve heeft ~17-18 MPa rond -4..-5 m, ~14 MPa onder paalpunt, ~9-10 MPa rond -9 m.

- [ ] **Step 2: Create 3BM CGEO1 fixture**

```json
// apps/desktop/src/calc/modules/pile-bearing-capacity/__fixtures__/sondering-3bm-cgeo1.json
{
  "cpt": {
    "id": "3BM-CGEO1",
    "metadata": {
      "source_file": "3151-CB-21 Constructieberekening.ods CGEO1",
      "project_name": "Bodegraven dakopbouw",
      "ground_level_nap": -0.5
    },
    "points": []
  },
  "input": {
    "cptId": "3BM-CGEO1",
    "pileTypeId": "steel-pipe-driven-closed",
    "diameterMm": 168,
    "wallThicknessMm": 5.6,
    "pileTopNap": -0.5,
    "pileToeNap": -14.0,
    "waterNap": -2.5,
    "excavationNap": -0.5,
    "nEd": 110,
    "nEk": 92,
    "gammaM": 1.2,
    "gammaFnk": 1.0,
    "negKleefBottomNap": -8.0,
    "ksMinFactor": 0.25,
    "soilProfile": [
      { "kind": "sand-dry", "startNap": -0.5, "endNap": -2.5, "gammaK": 17, "gammaW": 0,  "phi": 32.5 },
      { "kind": "sand-wet", "startNap": -2.5, "endNap": -4.0, "gammaK": 17, "gammaW": 10, "phi": 32.5 },
      { "kind": "peat",     "startNap": -4.0, "endNap": -6.0, "gammaK": 13, "gammaW": 10, "phi": 15.0 },
      { "kind": "clay",     "startNap": -6.0, "endNap": -8.0, "gammaK": 18, "gammaW": 10, "phi": 22.5 }
    ]
  },
  "expected": {
    "negKleefPerLayer": [4.49, 7.77, 12.53, 15.44],
    "fnkD": 40.2,
    "rbCal": 141.1,
    "rsCal": 79.2,
    "rcD": 132.1,
    "rcNetD": 91.8
  }
}
```

> **Engineer:** Voor deze fixture is `cpt.points` minder kritiek omdat we de neg.kleef-berekening kunnen valideren zonder CPT-data (alle inputs zijn handmatig). Voor rbCal/rsCal validatie: vul de qc-waarden uit ODS CGEO1 cellen C18/C20/C22 (12/12/6 MPa) en D47 (5 MPa) als constante qc-blokken.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/calc/modules/pile-bearing-capacity/__fixtures__/
git commit -m "test(pile): fixtures — 984.pdf sondering 1 + 3BM CGEO1 template"
```

---

### Task 18: Negative skin friction part (TDD)

**Files:**
- Create: `apps/desktop/src/calc/modules/pile-bearing-capacity/parts/negative-skin-friction.ts`
- Create: `apps/desktop/src/calc/modules/pile-bearing-capacity/parts/negative-skin-friction.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/desktop/src/calc/modules/pile-bearing-capacity/parts/negative-skin-friction.test.ts
import { describe, it, expect } from "vitest";
import { computeNegKleef } from "./negative-skin-friction";
import fixture from "../__fixtures__/sondering-3bm-cgeo1.json";
import type { PileInput } from "../types";

const input = fixture.input as PileInput;
const exp = fixture.expected;

describe("negative skin friction — 3BM CGEO1", () => {
  const result = computeNegKleef(input);

  it("computes per-layer Fs;nk;rep matching ODS CGEO1 within 0.5 kN", () => {
    const perLayer = result.layers.map((l) => l.fsNkRep);
    expect(perLayer.length).toBe(4);
    perLayer.forEach((v, i) => {
      expect(v).toBeCloseTo(exp.negKleefPerLayer[i], 0);
    });
  });

  it("totals Fnk;d to 40.2 kN", () => {
    expect(result.fnkD).toBeCloseTo(exp.fnkD, 0);
  });

  it("applies K0·tan(δ) min-cap of 0.25", () => {
    // Voor zand droog (Φ=32,5°): K0=0.463, δ=24.4°, tan=0.453, product=0.21 → cap naar 0.25
    const sandDry = result.layers.find((l) => l.layer.kind === "sand-dry");
    expect(sandDry).toBeDefined();
    expect(sandDry!.k0TanDelta).toBeCloseTo(0.25, 2);
  });
});
```

- [ ] **Step 2: Run test (expect fail)**

```bash
cd apps/desktop && npm test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement neg-kleef**

```ts
// apps/desktop/src/calc/modules/pile-bearing-capacity/parts/negative-skin-friction.ts
import type { PileInput, NegKleefResult, NegKleefLayerResult } from "../types";

const PI = Math.PI;
const toRad = (deg: number) => (deg * PI) / 180;

export function computeNegKleef(input: PileInput): NegKleefResult {
  const Os = PI * (input.diameterMm / 1000); // omtrek in m

  // Filter lagen die in de neg.kleef-zone vallen (boven negKleefBottomNap)
  const zoneTop = input.pileTopNap;
  const zoneBot = input.negKleefBottomNap;
  const inZone = input.soilProfile.filter(
    (l) => l.endNap < zoneTop && l.startNap > zoneBot,
  );

  // σ-stack opbouwen — top naar bottom (afnemende NAP)
  let sigmaCum = 0;
  const layers: NegKleefLayerResult[] = inZone.map((l) => {
    const thickness = l.startNap - l.endNap; // m
    const sigmaTop = sigmaCum;
    const dSigma = thickness * (l.gammaK - l.gammaW);
    const sigmaBot = sigmaTop + dSigma;
    const sigmaGem = ((sigmaTop + sigmaBot) / 2) * thickness; // kPa·m

    const phiRad = toRad(l.phi);
    const k0 = 1 - Math.sin(phiRad);
    const delta = 0.75 * phiRad;
    const tanDelta = Math.tan(delta);
    const k0TanDeltaRaw = k0 * tanDelta;
    const k0TanDelta = Math.max(k0TanDeltaRaw, input.ksMinFactor);

    const fsNkRep = sigmaGem * Os * k0TanDelta; // kN

    sigmaCum = sigmaBot;

    return {
      layer: l,
      thickness,
      sigmaRepTop: sigmaTop,
      sigmaRepBottom: sigmaBot,
      sigmaGemRep: sigmaGem,
      k0,
      delta,
      k0TanDelta,
      fsNkRep,
    };
  });

  const fnkRep = layers.reduce((s, l) => s + l.fsNkRep, 0);
  const fnkD = input.gammaFnk * fnkRep;

  return {
    layers,
    fnkRep,
    fnkD,
    bottomNap: zoneBot,
    deltaLnk: zoneTop - zoneBot,
  };
}
```

- [ ] **Step 4: Run tests**

```bash
cd apps/desktop && npm test
```

Expected: 3 passed for neg-kleef (plus earlier tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/calc/modules/pile-bearing-capacity/parts/
git commit -m "feat(pile): negative skin friction per-layer with K0·tan(δ) cap"
```

---

### Task 19: Base resistance part (TDD)

**Files:**
- Create: `apps/desktop/src/calc/modules/pile-bearing-capacity/parts/base-resistance.ts`
- Create: `apps/desktop/src/calc/modules/pile-bearing-capacity/parts/base-resistance.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/desktop/src/calc/modules/pile-bearing-capacity/parts/base-resistance.test.ts
import { describe, it, expect } from "vitest";
import { computeBaseResistance } from "./base-resistance";
import { getPileType } from "../catalog";

describe("base resistance — synthetic constant qc", () => {
  // Synthetisch CPT met constant qc — dan zijn qc;I/II/III gemiddelden alle drie gelijk
  const constQc = 12; // MPa
  const cpt = {
    id: "x",
    points: Array.from({ length: 200 }, (_, i) => ({
      depth: i * 0.1, // 0 tot 20 m
      qc: constQc,
    })),
  };
  const pileType = getPileType("steel-pipe-driven-closed")!;
  const result = computeBaseResistance(cpt as never, {
    pileToeDepth: 14.84,
    diameterMm: 219,
    pileType,
  });

  it("qc;I, qc;II, qc;III gem all equal to input qc (constant case)", () => {
    expect(result.qcIGemMpa).toBeCloseTo(constQc, 1);
    expect(result.qcIIGemMpa).toBeCloseTo(constQc, 1);
    expect(result.qcIIIGemMpa).toBeCloseTo(constQc, 1);
  });

  it("qb;max = ½·αp·β·s·((qcI+qcII)/2 + qcIII)", () => {
    // = ½ · 0.7 · 1 · 1 · (12 + 12) = 8.4 MPa
    expect(result.qbMaxMpaRaw).toBeCloseTo(8.4, 1);
    expect(result.qbMaxMpa).toBeCloseTo(8.4, 1);
  });

  it("applies 15 MPa cap when raw qbMax exceeds it", () => {
    const bigQc = 50;
    const bigCpt = {
      id: "x",
      points: Array.from({ length: 200 }, (_, i) => ({ depth: i * 0.1, qc: bigQc })),
    };
    const r = computeBaseResistance(bigCpt as never, {
      pileToeDepth: 14.84,
      diameterMm: 219,
      pileType,
    });
    expect(r.qbMaxMpaRaw).toBeGreaterThan(15);
    expect(r.qbMaxMpa).toBe(15);
  });

  it("Rb;cal;max = Ab · qb;max", () => {
    // Ab = π/4 · 219² = 37 668 mm²
    // Rb = 37668 · 8.4 · 1e-3 = 316 kN
    expect(result.rbCalMax).toBeCloseTo(316, 0);
  });
});
```

- [ ] **Step 2: Run test (expect fail)**

```bash
cd apps/desktop && npm test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement base-resistance**

```ts
// apps/desktop/src/calc/modules/pile-bearing-capacity/parts/base-resistance.ts
import type { Cpt } from "../../../../types/cpt";
import type { PileTypeSpec, BaseResistanceResult } from "../types";

interface Args {
  pileToeDepth: number;        // depth onder maaiveld in m
  diameterMm: number;
  pileType: PileTypeSpec;
}

const PI = Math.PI;

export function computeBaseResistance(cpt: Cpt, args: Args): BaseResistanceResult {
  const D = args.diameterMm / 1000;        // m
  const Deq = D;                            // voor ronde palen
  const DeqMm = args.diameterMm;
  const Ab = (PI / 4) * args.diameterMm ** 2; // mm²

  // Functie: gemiddelde qc tussen depths [d1, d2] (in m vanaf maaiveld)
  // gebruikt depth-gewogen gemiddelde — geen running-min, gewoon
  // rekenkundig (interpolatie tussen meetpunten)
  const avgQc = (d1: number, d2: number): number => {
    let sumQ = 0, sumW = 0;
    for (let i = 0; i < cpt.points.length - 1; i++) {
      const a = cpt.points[i], b = cpt.points[i + 1];
      if (b.depth <= d1 || a.depth >= d2) continue;
      const lo = Math.max(a.depth, d1);
      const hi = Math.min(b.depth, d2);
      const w = hi - lo;
      if (w <= 0) continue;
      const qa = a.qc ?? 0, qb = b.qc ?? 0;
      // Gemiddelde qc over de overlapping zone (lineaire interpolatie)
      const fracA = (lo - a.depth) / (b.depth - a.depth || 1);
      const fracB = (hi - a.depth) / (b.depth - a.depth || 1);
      const qLo = qa + (qb - qa) * fracA;
      const qHi = qa + (qb - qa) * fracB;
      sumQ += ((qLo + qHi) / 2) * w;
      sumW += w;
    }
    return sumW > 0 ? sumQ / sumW : 0;
  };

  // qc;I: zoek de optimale critical depth dc ∈ [0,7·Deq, 4·Deq] die qb minimaliseert
  let bestDc = 0.7 * Deq;
  let bestQc1 = avgQc(args.pileToeDepth, args.pileToeDepth + bestDc);
  for (let dc = 0.7 * Deq; dc <= 4 * Deq; dc += 0.01 * Deq) {
    const q = avgQc(args.pileToeDepth, args.pileToeDepth + dc);
    if (q < bestQc1) {
      bestQc1 = q;
      bestDc = dc;
    }
  }
  const qcIGemMpa = bestQc1;

  // qc;II: terug van bestDc → 0 (omhoog naar paalpunt), running min van qc-waarden
  // We benaderen door simpelweg gemiddelde van qc in [paalpunt, paalpunt + bestDc]
  // — vereenvoudigde benadering voor v1; running-min komt in v2
  const qcIIGemMpa = avgQc(args.pileToeDepth, args.pileToeDepth + bestDc);

  // qc;III: gemiddelde qc van paalpunt naar omhoog tot 8·Deq
  const qcIIIGemMpa = avgQc(Math.max(0, args.pileToeDepth - 8 * Deq), args.pileToeDepth);

  // qb;max formule 7.6.2.3(e)
  const { alphaP, beta, s } = args.pileType;
  const qbMaxMpaRaw = 0.5 * alphaP * beta * s * ((qcIGemMpa + qcIIGemMpa) / 2 + qcIIIGemMpa);
  const qbMaxMpa = Math.min(qbMaxMpaRaw, 15);

  const rbCalMax = (Ab * qbMaxMpa) / 1000; // kN: mm² × MPa × 1e-3

  return {
    deqMm: DeqMm,
    qcIGemMpa,
    qcIIGemMpa,
    qcIIIGemMpa,
    criticalDepthM: bestDc,
    qbMaxMpaRaw,
    qbMaxMpa,
    abMm2: Ab,
    rbCalMax,
  };
}
```

- [ ] **Step 4: Run tests**

```bash
cd apps/desktop && npm test
```

Expected: 4 passed for base-resistance.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/calc/modules/pile-bearing-capacity/parts/base-resistance.ts apps/desktop/src/calc/modules/pile-bearing-capacity/parts/base-resistance.test.ts
git commit -m "feat(pile): base resistance qb;max + 15 MPa cap + Rb;cal;max"
```

---

### Task 20: Shaft friction part (TDD)

**Files:**
- Create: `apps/desktop/src/calc/modules/pile-bearing-capacity/parts/shaft-friction.ts`
- Create: `apps/desktop/src/calc/modules/pile-bearing-capacity/parts/shaft-friction.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/desktop/src/calc/modules/pile-bearing-capacity/parts/shaft-friction.test.ts
import { describe, it, expect } from "vitest";
import { computeShaftFriction } from "./shaft-friction";
import { getPileType } from "../catalog";
import type { SoilLayer } from "../types";

const pileType = getPileType("steel-pipe-driven-closed")!;

describe("shaft friction", () => {
  it("sums α_s · qc · h per layer × Os, capped per soil-kind", () => {
    // 1 zandlaag 3 m dik, qc=5 MPa, D=168mm
    // Os = π·0.168 = 0.5278 m
    // qs;max = αs·qc = 0.008·5 = 0.04 MPa < 0.15 cap voor zand
    // Rs = Os · qs · h × 1000 = 0.5278 · 0.04 · 3 × 1000 = 63.3 kN
    const layers: SoilLayer[] = [
      { kind: "sand-wet", startNap: -5, endNap: -8, gammaK: 17, gammaW: 10, phi: 32.5 },
    ];
    // Synthetische CPT: qc constant 5 MPa
    const cpt = {
      id: "x",
      metadata: { ground_level_nap: 0 },
      points: Array.from({ length: 100 }, (_, i) => ({ depth: i * 0.1, depth_nap: -i * 0.1, qc: 5 })),
    };
    const result = computeShaftFriction(cpt as never, {
      pileType,
      diameterMm: 168,
      negKleefBottomNap: -5,
      pileToeNap: -8,
    }, layers);

    expect(result.perLayer.length).toBe(1);
    expect(result.rsCalMax).toBeCloseTo(63.3, 0);
  });

  it("caps qs at 0.02 MPa for peat regardless of αs·qc", () => {
    const layers: SoilLayer[] = [
      { kind: "peat", startNap: -5, endNap: -7, gammaK: 13, gammaW: 10, phi: 15 },
    ];
    const cpt = {
      id: "x",
      metadata: { ground_level_nap: 0 },
      points: Array.from({ length: 100 }, (_, i) => ({ depth: i * 0.1, depth_nap: -i * 0.1, qc: 50 })),
    };
    const result = computeShaftFriction(cpt as never, {
      pileType,
      diameterMm: 168,
      negKleefBottomNap: -5,
      pileToeNap: -7,
    }, layers);
    // qs zonder cap: 0.008·50=0.4 MPa, met cap=0.02 MPa
    // Rs = 0.5278 · 0.02 · 2 × 1000 = 21.1 kN
    expect(result.perLayer[0].qsMpa).toBe(0.02);
    expect(result.rsCalMax).toBeCloseTo(21.1, 0);
  });
});
```

- [ ] **Step 2: Run test (expect fail)**

```bash
cd apps/desktop && npm test
```

- [ ] **Step 3: Implement**

```ts
// apps/desktop/src/calc/modules/pile-bearing-capacity/parts/shaft-friction.ts
import type { Cpt } from "../../../../types/cpt";
import type { PileTypeSpec, SoilLayer, ShaftFrictionResult } from "../types";
import { QS_MAX_PER_SOIL } from "../catalog";

interface Args {
  pileType: PileTypeSpec;
  diameterMm: number;
  negKleefBottomNap: number;
  pileToeNap: number;
}

const PI = Math.PI;

export function computeShaftFriction(
  cpt: Cpt,
  args: Args,
  soilProfile: SoilLayer[],
): ShaftFrictionResult {
  const Os = PI * (args.diameterMm / 1000); // m

  // Schachtwrijvings-zone: tussen negKleefBottomNap en pileToeNap
  // (alleen POSITIEVE schachtwrijving)
  const zoneTop = args.negKleefBottomNap;
  const zoneBot = args.pileToeNap;
  const layersInZone = soilProfile.filter(
    (l) => l.endNap < zoneTop && l.startNap > zoneBot,
  );

  const groundNap = cpt.metadata.ground_level_nap ?? 0;

  // Helper: gemiddelde qc tussen twee NAP-niveaus (intern depths conversion)
  const avgQc = (napTop: number, napBot: number): number => {
    const dTop = groundNap - napTop; // depth onder maaiveld
    const dBot = groundNap - napBot;
    let sumQ = 0, sumW = 0;
    for (let i = 0; i < cpt.points.length - 1; i++) {
      const a = cpt.points[i], b = cpt.points[i + 1];
      const lo = Math.max(a.depth, Math.min(dTop, dBot));
      const hi = Math.min(b.depth, Math.max(dTop, dBot));
      const w = hi - lo;
      if (w <= 0) continue;
      const qa = a.qc ?? 0, qb = b.qc ?? 0;
      const frac = (lo - a.depth) / (b.depth - a.depth || 1);
      const qLo = qa + (qb - qa) * frac;
      sumQ += qLo * w;
      sumW += w;
    }
    return sumW > 0 ? sumQ / sumW : 0;
  };

  const perLayer = layersInZone.map((l) => {
    const layerTop = Math.min(l.startNap, zoneTop);
    const layerBot = Math.max(l.endNap, zoneBot);
    const thickness = layerTop - layerBot;
    const qcGemMpa = avgQc(layerTop, layerBot);
    const qsRaw = args.pileType.alphaS * qcGemMpa;
    const qsCap = QS_MAX_PER_SOIL[l.kind];
    const qsMpa = Math.min(qsRaw, qsCap);
    const rsLayer = Os * qsMpa * thickness * 1000; // kN: m × MPa × m × 1000 = kN
    return { layer: l, qcGemMpa, qsMpa, rsLayer };
  });

  const rsCalMax = perLayer.reduce((s, l) => s + l.rsLayer, 0);

  return { perLayer, rsCalMax };
}
```

- [ ] **Step 4: Run tests**

```bash
cd apps/desktop && npm test
```

Expected: 2 passed for shaft-friction.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/calc/modules/pile-bearing-capacity/parts/
git commit -m "feat(pile): shaft friction with Tabel 7.d qs caps per soil-kind"
```

---

### Task 21: Eurocode curves (Figuur 7.n + 7.o) lookup data

**Files:**
- Create: `apps/desktop/src/calc/modules/pile-bearing-capacity/parts/eurocode-curves.ts`

- [ ] **Step 1: Digitize curves as lookup tables**

```ts
// apps/desktop/src/calc/modules/pile-bearing-capacity/parts/eurocode-curves.ts
/**
 * Lastzakkingslijn 1 (voorgespannen palen, geheid) uit Eurocode 7
 * NB:2019 Figuur 7.n + 7.o. Curve-data gedigitaliseerd uit het figuur.
 *
 * Figuur 7.n: sb/Deq [%] → Rb/Rb;cal;max [%]
 * Figuur 7.o: sb [mm]     → Rs/Rs;cal;max [%]
 *
 * v1 gebruikt lineaire interpolatie tussen control-points. Voor v2:
 * cubic-spline voor smoother resultaat (verwaarloosbaar verschil
 * voor zakkingsberekening).
 */

interface Pt { x: number; y: number }

// Figuur 7.n — sb/Deq (%) op X, Rb/Rb;max (%) op Y
// Controlepunten uit Eurocode-figuur Lastzakkingslijn 1
const FIG_7N: Pt[] = [
  { x: 0,   y: 0 },
  { x: 0.5, y: 24 },
  { x: 1.0, y: 45 },
  { x: 1.5, y: 60 },
  { x: 2.0, y: 73 },
  { x: 2.5, y: 82 },
  { x: 3.0, y: 88 },
  { x: 4.0, y: 96 },
  { x: 5.0, y: 100 },
  { x: 10,  y: 100 },
];

// Figuur 7.o — sb [mm] op X, Rs/Rs;max (%) op Y
const FIG_7O: Pt[] = [
  { x: 0,  y: 0 },
  { x: 1,  y: 35 },
  { x: 2,  y: 55 },
  { x: 3,  y: 70 },
  { x: 4,  y: 82 },
  { x: 5,  y: 90 },
  { x: 6,  y: 95 },
  { x: 8,  y: 100 },
  { x: 20, y: 100 },
];

function interp(table: Pt[], x: number): number {
  if (x <= table[0].x) return table[0].y;
  if (x >= table[table.length - 1].x) return table[table.length - 1].y;
  for (let i = 0; i < table.length - 1; i++) {
    const a = table[i], b = table[i + 1];
    if (x >= a.x && x <= b.x) {
      const t = (x - a.x) / (b.x - a.x);
      return a.y + (b.y - a.y) * t;
    }
  }
  return 0;
}

/** Mobiliseerde puntdraagvermogen-fractie bij sb/Deq verhouding in %. */
export function mobBase(sbOverDeqPct: number): number {
  return interp(FIG_7N, sbOverDeqPct) / 100;
}

/** Mobiliseerde schachtwrijvings-fractie bij sb in mm. */
export function mobShaft(sbMm: number): number {
  return interp(FIG_7O, sbMm) / 100;
}
```

- [ ] **Step 2: Quick test (smoke)**

Append to `apps/desktop/src/calc/modules/pile-bearing-capacity/parts/eurocode-curves.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mobBase, mobShaft } from "./eurocode-curves";

describe("Eurocode lastzakkingslijn 1 curves", () => {
  it("returns 0 at sb=0", () => {
    expect(mobBase(0)).toBe(0);
    expect(mobShaft(0)).toBe(0);
  });
  it("returns ~1 at large sb", () => {
    expect(mobBase(10)).toBe(1);
    expect(mobShaft(20)).toBe(1);
  });
  it("interpolates between control-points", () => {
    expect(mobBase(1)).toBeCloseTo(0.45, 2);
    expect(mobShaft(2)).toBeCloseTo(0.55, 2);
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
cd apps/desktop && npm test
git add apps/desktop/src/calc/modules/pile-bearing-capacity/parts/eurocode-curves.ts apps/desktop/src/calc/modules/pile-bearing-capacity/parts/eurocode-curves.test.ts
git commit -m "feat(pile): Eurocode 7 Figuur 7.n + 7.o digital lookup tables"
```

---

### Task 22: Settlement + spring-stiffness (TDD)

**Files:**
- Create: `apps/desktop/src/calc/modules/pile-bearing-capacity/parts/settlement.ts`
- Create: `apps/desktop/src/calc/modules/pile-bearing-capacity/parts/settlement.test.ts`
- Create: `apps/desktop/src/calc/modules/pile-bearing-capacity/parts/spring-stiffness.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/desktop/src/calc/modules/pile-bearing-capacity/parts/settlement.test.ts
import { describe, it, expect } from "vitest";
import { computeSettlement } from "./settlement";

describe("settlement bisection", () => {
  it("converges to sb where Rb+Rs equals Fc;tot", () => {
    // Rb_max=400, Rs_max=200, Fc_tot=300 → sb moet daar liggen waar
    // mobiliseerde Rb+Rs ≈ 300 kN
    const r = computeSettlement({
      fcTotSls: 300,
      fcTotUls: 350,
      rbCalMax: 400,
      rsCalMax: 200,
      deqMm: 219,
      EA_N: 1_356_065_000,
      ellM: 0.5,
      L_m: 14.84,
      deltaL_m: 5.5,
    });

    const total = mobAt(r.sls.sbMm, 219, 400, 200);
    expect(total).toBeCloseTo(300, 0); // ±1 kN
    expect(r.sls.s1Mm).toBeGreaterThan(r.sls.sbMm);
    expect(r.uls.sbMm).toBeGreaterThan(r.sls.sbMm); // hogere belasting → meer zakking
  });
});

function mobAt(sbMm: number, deqMm: number, rbMax: number, rsMax: number): number {
  // Use the lookup directly to verify
  const { mobBase, mobShaft } = require("./eurocode-curves");
  return mobBase((sbMm / deqMm) * 100) * rbMax + mobShaft(sbMm) * rsMax;
}
```

- [ ] **Step 2: Run test (expect fail)**

```bash
cd apps/desktop && npm test
```

- [ ] **Step 3: Implement settlement**

```ts
// apps/desktop/src/calc/modules/pile-bearing-capacity/parts/settlement.ts
import type { SettlementResult, SettlementWorkpoint } from "../types";
import { mobBase, mobShaft } from "./eurocode-curves";

export interface SettlementArgs {
  fcTotSls: number;            // kN — NEk + Fnk
  fcTotUls: number;            // kN — NEd + Fnk
  rbCalMax: number;            // kN
  rsCalMax: number;            // kN
  deqMm: number;
  EA_N: number;                // axiale stijfheid paal in N (E·A)
  ellM: number;                // l = paalkop − maaiveld
  L_m: number;                 // paallengte
  deltaL_m: number;            // schachtwrijvings-zone
}

function solveSb(fcTot: number, rbMax: number, rsMax: number, deqMm: number): number {
  let lo = 0;
  let hi = 0.05 * deqMm; // 5% verhouding als bovengrens
  // Als zelfs bij hi nog Rb+Rs < Fc;tot, vergroot tot 30%
  while (
    mobBase((hi / deqMm) * 100) * rbMax + mobShaft(hi) * rsMax < fcTot &&
    hi < 0.30 * deqMm
  ) {
    hi *= 2;
  }
  for (let i = 0; i < 50; i++) {
    const sb = (lo + hi) / 2;
    const tot = mobBase((sb / deqMm) * 100) * rbMax + mobShaft(sb) * rsMax;
    if (tot > fcTot) hi = sb;
    else lo = sb;
    if (hi - lo < 0.0001) break;
  }
  return (lo + hi) / 2;
}

function computeWorkpoint(fcTot: number, args: SettlementArgs): SettlementWorkpoint {
  const sbMm = solveSb(fcTot, args.rbCalMax, args.rsCalMax, args.deqMm);
  const rbMobil = mobBase((sbMm / args.deqMm) * 100) * args.rbCalMax;
  const rsMobil = mobShaft(sbMm) * args.rsCalMax;
  const fgem = (args.ellM * fcTot + 0.5 * args.deltaL_m * (fcTot - rbMobil)) / args.L_m;
  // sel = L · F · 10³ / EA — eenheden: m · kN · 1000 / N → mm
  const selMm = (args.L_m * fgem * 1000) / args.EA_N;
  const s1Mm = sbMm + selMm;
  return { fcTot, sbMm, rbMobil, rsMobil, fgem, selMm, s1Mm };
}

export function computeSettlement(args: SettlementArgs): SettlementResult {
  const sls = computeWorkpoint(args.fcTotSls, args);
  const uls = computeWorkpoint(args.fcTotUls, args);

  // Curve voor het zakkings-diagram — 50 punten van sb=0 tot 0,1·Deq
  const curve = [];
  const maxSb = 0.1 * args.deqMm;
  for (let i = 0; i <= 50; i++) {
    const sb = (i / 50) * maxSb;
    const rb = mobBase((sb / args.deqMm) * 100) * args.rbCalMax;
    const rs = mobShaft(sb) * args.rsCalMax;
    curve.push({ sbMm: sb, rbKn: rb, rsKn: rs, totalKn: rb + rs });
  }

  return { sls, uls, curve };
}
```

- [ ] **Step 4: Spring-stiffness module**

```ts
// apps/desktop/src/calc/modules/pile-bearing-capacity/parts/spring-stiffness.ts
import type { SettlementResult, SpringStiffnessResult } from "../types";

export function computeSpringStiffness(s: SettlementResult): SpringStiffnessResult {
  // k = Fc;tot / s1, in kN/m (s1 is in mm → ×1000)
  const kSls = s.sls.s1Mm > 0 ? (s.sls.fcTot / s.sls.s1Mm) * 1000 : 0;
  const kUls = s.uls.s1Mm > 0 ? (s.uls.fcTot / s.uls.s1Mm) * 1000 : 0;
  return {
    kSlsKnPerM: kSls,
    kUlsKnPerM: kUls,
    kMinKnPerM: kSls / Math.SQRT2,
    kMaxKnPerM: kSls * Math.SQRT2,
  };
}
```

- [ ] **Step 5: Run tests + commit**

```bash
cd apps/desktop && npm test
git add apps/desktop/src/calc/modules/pile-bearing-capacity/parts/
git commit -m "feat(pile): settlement bisection + spring stiffness SLS/ULS"
```

---

### Task 23: Summary (ξ, Rc;d, unity check)

**Files:**
- Create: `apps/desktop/src/calc/modules/pile-bearing-capacity/parts/summary.ts`
- Create: `apps/desktop/src/calc/modules/pile-bearing-capacity/parts/summary.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/desktop/src/calc/modules/pile-bearing-capacity/parts/summary.test.ts
import { describe, it, expect } from "vitest";
import { computeSummary } from "./summary";

describe("summary — n=1 case", () => {
  it("uses ξ3=ξ4=1.39 for n=1", () => {
    const r = computeSummary({ rbCalMax: 419, rsCalMax: 202, fnkD: 35, nEd: 324, gammaM: 1.2 });
    expect(r.xi3).toBeCloseTo(1.39, 2);
    expect(r.xi4).toBeCloseTo(1.39, 2);
    expect(r.rcCal).toBe(621);
    expect(r.rcK).toBeCloseTo(447, 0); // 621/1.39
    expect(r.rcD).toBeCloseTo(372, 0);  // 447/1.20
    expect(r.rcNetD).toBeCloseTo(337, 0); // 372-35
    expect(r.unityCheck).toBeCloseTo(324 / 337, 2);
    expect(r.passes).toBe(true);
  });

  it("flags unity > 1 as failing", () => {
    const r = computeSummary({ rbCalMax: 100, rsCalMax: 50, fnkD: 30, nEd: 500, gammaM: 1.2 });
    expect(r.unityCheck).toBeGreaterThan(1);
    expect(r.passes).toBe(false);
  });
});
```

- [ ] **Step 2: Run test (expect fail)**

```bash
cd apps/desktop && npm test
```

- [ ] **Step 3: Implement summary**

```ts
// apps/desktop/src/calc/modules/pile-bearing-capacity/parts/summary.ts
import type { SummaryResult } from "../types";

export interface SummaryArgs {
  rbCalMax: number;
  rsCalMax: number;
  fnkD: number;
  nEd: number;
  gammaM: number;
}

export function computeSummary(args: SummaryArgs): SummaryResult {
  // Tabel A.10a n=1: ξ3 = ξ4 = 1.39
  const xi3 = 1.39;
  const xi4 = 1.39;
  const rcCal = args.rbCalMax + args.rsCalMax;
  const rcK = rcCal / xi3;
  const rcD = rcK / args.gammaM;
  const rcNetD = rcD - args.fnkD;
  const unityCheck = rcNetD > 0 ? args.nEd / rcNetD : Infinity;
  return {
    xi3,
    xi4,
    rcCal,
    rcK,
    rcD,
    rcNetD,
    unityCheck,
    passes: unityCheck <= 1,
  };
}
```

- [ ] **Step 4: Run + commit**

```bash
cd apps/desktop && npm test
git add apps/desktop/src/calc/modules/pile-bearing-capacity/parts/summary.ts apps/desktop/src/calc/modules/pile-bearing-capacity/parts/summary.test.ts
git commit -m "feat(pile): summary ξ-factors + Rc;d + unity check (n=1)"
```

---

### Task 24: Compose computePile() + golden test

**Files:**
- Create: `apps/desktop/src/calc/modules/pile-bearing-capacity/compute.ts`
- Create: `apps/desktop/src/calc/modules/pile-bearing-capacity/compute.test.ts`

- [ ] **Step 1: Write the golden test**

```ts
// apps/desktop/src/calc/modules/pile-bearing-capacity/compute.test.ts
import { describe, it, expect } from "vitest";
import { computePile } from "./compute";
import fixture3bm from "./__fixtures__/sondering-3bm-cgeo1.json";
import type { PileInput } from "./types";
import type { Cpt } from "../../../types/cpt";

describe("computePile — 3BM CGEO1 golden", () => {
  const input = { ...fixture3bm.input } as PileInput;
  // Build a synthetic CPT — 5 MPa boven -8 m, 12 MPa daaronder
  const cpt: Cpt = {
    id: "3BM-CGEO1",
    metadata: { source_file: "test", ground_level_nap: -0.5 },
    points: Array.from({ length: 200 }, (_, i) => {
      const d = i * 0.1; // 0..20 m
      const napDepth = -0.5 - d;
      const qc = napDepth > -8 ? 5 : 12;
      return { depth: d, depth_nap: napDepth, qc };
    }),
  };

  const exp = fixture3bm.expected;
  const result = computePile(input, cpt);

  it("computes Fnk;d matching ODS within 1 kN", () => {
    expect(result.ok).toBe(true);
    expect(result.negKleef.fnkD).toBeCloseTo(exp.fnkD, 0);
  });

  it("returns unity check + passes flag", () => {
    expect(result.summary.unityCheck).toBeGreaterThan(0);
    expect(typeof result.summary.passes).toBe("boolean");
  });
});
```

- [ ] **Step 2: Run test (expect fail)**

```bash
cd apps/desktop && npm test
```

- [ ] **Step 3: Implement compose**

```ts
// apps/desktop/src/calc/modules/pile-bearing-capacity/compute.ts
import type { Cpt } from "../../../types/cpt";
import type { PileInput, PileResult } from "./types";
import { getPileType } from "./catalog";
import { computeNegKleef } from "./parts/negative-skin-friction";
import { computeBaseResistance } from "./parts/base-resistance";
import { computeShaftFriction } from "./parts/shaft-friction";
import { computeSettlement } from "./parts/settlement";
import { computeSpringStiffness } from "./parts/spring-stiffness";
import { computeSummary } from "./parts/summary";

const E_STEEL_GPA = 210;

function computeEA_N(diameterMm: number, wallMm: number): number {
  // ringshape: A = π/4 · (D² − (D−2t)²) mm²
  const D = diameterMm;
  const innerD = Math.max(0, D - 2 * wallMm);
  const A_mm2 = (Math.PI / 4) * (D * D - innerD * innerD);
  // EA = E · A — E in N/mm² (1 GPa = 1000 N/mm²)
  return E_STEEL_GPA * 1000 * A_mm2;
}

function emptyResult(error: string): PileResult {
  return {
    ok: false,
    error,
    warnings: [],
    negKleef: { layers: [], fnkRep: 0, fnkD: 0, bottomNap: 0, deltaLnk: 0 },
    base: { deqMm: 0, qcIGemMpa: 0, qcIIGemMpa: 0, qcIIIGemMpa: 0, criticalDepthM: 0, qbMaxMpaRaw: 0, qbMaxMpa: 0, abMm2: 0, rbCalMax: 0 },
    shaft: { perLayer: [], rsCalMax: 0 },
    settlement: { sls: anyZero(), uls: anyZero(), curve: [] },
    spring: { kSlsKnPerM: 0, kUlsKnPerM: 0, kMinKnPerM: 0, kMaxKnPerM: 0 },
    summary: { xi3: 1.39, xi4: 1.39, rcCal: 0, rcK: 0, rcD: 0, rcNetD: 0, unityCheck: 0, passes: false },
  };
}
function anyZero() {
  return { fcTot: 0, sbMm: 0, rbMobil: 0, rsMobil: 0, fgem: 0, selMm: 0, s1Mm: 0 };
}

export function computePile(input: PileInput, cpt: Cpt | null): PileResult {
  if (!cpt) return emptyResult("Geen actieve sondering");
  const pileType = getPileType(input.pileTypeId);
  if (!pileType) return emptyResult(`Onbekend paaltype: ${input.pileTypeId}`);

  const groundNap = cpt.metadata.ground_level_nap ?? 0;
  const pileToeDepth = groundNap - input.pileToeNap;

  // Edge-case: sondering te ondiep
  const lastDepth = cpt.points[cpt.points.length - 1]?.depth ?? 0;
  const Deq = input.diameterMm / 1000;
  if (lastDepth < pileToeDepth + 0.7 * Deq) {
    return emptyResult(
      `Sondering te ondiep (reikt tot ${lastDepth.toFixed(1)} m, vereist ≥ ${(pileToeDepth + 0.7 * Deq).toFixed(1)} m)`,
    );
  }

  const negKleef = computeNegKleef(input);
  const base = computeBaseResistance(cpt, {
    pileToeDepth,
    diameterMm: input.diameterMm,
    pileType,
  });
  const shaft = computeShaftFriction(cpt, {
    pileType,
    diameterMm: input.diameterMm,
    negKleefBottomNap: input.negKleefBottomNap,
    pileToeNap: input.pileToeNap,
  }, input.soilProfile);

  const fcTotSls = input.nEk + negKleef.fnkD;
  const fcTotUls = input.nEd + negKleef.fnkD;
  const EA = computeEA_N(input.diameterMm, input.wallThicknessMm);
  const L = input.pileTopNap - input.pileToeNap;
  const deltaL = input.negKleefBottomNap - input.pileToeNap;
  const ell = input.pileTopNap - input.excavationNap;

  const settlement = computeSettlement({
    fcTotSls,
    fcTotUls,
    rbCalMax: base.rbCalMax,
    rsCalMax: shaft.rsCalMax,
    deqMm: base.deqMm,
    EA_N: EA,
    ellM: ell,
    L_m: L,
    deltaL_m: deltaL,
  });

  const spring = computeSpringStiffness(settlement);

  const summary = computeSummary({
    rbCalMax: base.rbCalMax,
    rsCalMax: shaft.rsCalMax,
    fnkD: negKleef.fnkD,
    nEd: input.nEd,
    gammaM: input.gammaM,
  });

  const warnings: string[] = [];
  if (base.qbMaxMpaRaw > 15) {
    warnings.push(`qb;max gecapt op 15 MPa (ruwe waarde ${base.qbMaxMpaRaw.toFixed(2)} MPa)`);
  }

  return {
    ok: true,
    warnings,
    negKleef,
    base,
    shaft,
    settlement,
    spring,
    summary,
  };
}
```

- [ ] **Step 4: Run + commit**

```bash
cd apps/desktop && npm test
git add apps/desktop/src/calc/modules/pile-bearing-capacity/compute.ts apps/desktop/src/calc/modules/pile-bearing-capacity/compute.test.ts
git commit -m "feat(pile): computePile compose function + golden test against 3BM CGEO1"
```

---

### Task 25: Pile module UI — InputPanel

**Files:**
- Create: `apps/desktop/src/calc/modules/pile-bearing-capacity/ui/InputPanel.tsx`
- Create: `apps/desktop/src/calc/modules/pile-bearing-capacity/ui/styles.css`

- [ ] **Step 1: Implement InputPanel**

```tsx
// apps/desktop/src/calc/modules/pile-bearing-capacity/ui/InputPanel.tsx
import { useCptStore } from "../../../../store/useCptStore";
import { PILE_TYPE_CATALOG } from "../catalog";
import type { PileInput, PileResult } from "../types";
import "./styles.css";

interface Props {
  input: PileInput;
  result: PileResult;
  onChange?: (next: PileInput) => void;
}

export function InputPanel({ input, onChange }: Props) {
  const cpts = useCptStore((s) => s.cpts);
  const set = <K extends keyof PileInput>(key: K, value: PileInput[K]) => {
    if (!onChange) return;
    onChange({ ...input, [key]: value });
  };

  return (
    <div className="pile-input">
      <fieldset>
        <legend>Sondering</legend>
        <select value={input.cptId ?? ""} onChange={(e) => set("cptId", e.target.value || null)}>
          <option value="">— kies CPT —</option>
          {Array.from(cpts.values()).map((c) => (
            <option key={c.id} value={c.id}>{c.id}</option>
          ))}
        </select>
      </fieldset>

      <fieldset>
        <legend>Paal</legend>
        <label>Type
          <select value={input.pileTypeId} onChange={(e) => set("pileTypeId", e.target.value)}>
            {PILE_TYPE_CATALOG.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label>Diameter [mm]<input type="number" value={input.diameterMm} onChange={(e) => set("diameterMm", +e.target.value)} /></label>
        <label>Wanddikte [mm]<input type="number" step="0.1" value={input.wallThicknessMm} onChange={(e) => set("wallThicknessMm", +e.target.value)} /></label>
      </fieldset>

      <fieldset>
        <legend>Paalniveaus [m NAP]</legend>
        <label>Paalkop<input type="number" step="0.01" value={input.pileTopNap} onChange={(e) => set("pileTopNap", +e.target.value)} /></label>
        <label>Paalpunt<input type="number" step="0.01" value={input.pileToeNap} onChange={(e) => set("pileToeNap", +e.target.value)} /></label>
        <label>Water<input type="number" step="0.01" value={input.waterNap} onChange={(e) => set("waterNap", +e.target.value)} /></label>
        <label>Ontgraving<input type="number" step="0.01" value={input.excavationNap} onChange={(e) => set("excavationNap", +e.target.value)} /></label>
      </fieldset>

      <fieldset>
        <legend>Belasting [kN]</legend>
        <label>NEd<input type="number" value={input.nEd} onChange={(e) => set("nEd", +e.target.value)} /></label>
        <label>NEk<input type="number" value={input.nEk} onChange={(e) => set("nEk", +e.target.value)} /></label>
        <label>γm<input type="number" step="0.01" value={input.gammaM} onChange={(e) => set("gammaM", +e.target.value)} /></label>
        <label>γf,nk<input type="number" step="0.01" value={input.gammaFnk} onChange={(e) => set("gammaFnk", +e.target.value)} /></label>
      </fieldset>

      <fieldset>
        <legend>Negatieve kleef</legend>
        <label>Onderkant zone [m NAP]
          <input type="number" step="0.01" value={input.negKleefBottomNap} onChange={(e) => set("negKleefBottomNap", +e.target.value)} />
        </label>
        <label>K0·tan(δ) minimum<input type="number" step="0.01" value={input.ksMinFactor} onChange={(e) => set("ksMinFactor", +e.target.value)} /></label>
        {/* Soil layers editor — v2 */}
      </fieldset>
    </div>
  );
}
```

- [ ] **Step 2: Create styles.css**

```css
/* apps/desktop/src/calc/modules/pile-bearing-capacity/ui/styles.css */
.pile-input fieldset {
  border: 1px solid var(--theme-border, #e7e5e4);
  border-radius: 6px;
  padding: 8px 12px;
  margin-bottom: 12px;
}
.pile-input legend {
  font: 600 0.78rem "Inter", sans-serif;
  padding: 0 6px;
  color: var(--theme-text, #36363e);
}
.pile-input label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font: 500 0.82rem "Inter", sans-serif;
  margin-bottom: 4px;
}
.pile-input input,
.pile-input select {
  flex: 1;
  max-width: 140px;
  padding: 3px 6px;
  border: 1px solid var(--theme-border, #cbd5e1);
  border-radius: 3px;
  font: 500 0.82rem var(--font-code, "JetBrains Mono"), monospace;
}
```

- [ ] **Step 3: Verify TS + commit**

```bash
cd apps/desktop && npx tsc --noEmit
git add apps/desktop/src/calc/modules/pile-bearing-capacity/ui/
git commit -m "feat(pile-ui): InputPanel form bindings + styles"
```

---

### Task 26: Pile module UI — ResultPanel + VisualPanel + module export

**Files:**
- Create: `apps/desktop/src/calc/modules/pile-bearing-capacity/ui/ResultPanel.tsx`
- Create: `apps/desktop/src/calc/modules/pile-bearing-capacity/ui/VisualPanel.tsx`
- Create: `apps/desktop/src/calc/modules/pile-bearing-capacity/module.ts`
- Modify: `apps/desktop/src/calc/framework/registry.ts`

- [ ] **Step 1: ResultPanel (formules + zakkingsdiagram)**

```tsx
// apps/desktop/src/calc/modules/pile-bearing-capacity/ui/ResultPanel.tsx
import type { PileInput, PileResult } from "../types";

export function ResultPanel({ result }: { input: PileInput; result: PileResult; onChange?: never }) {
  if (!result.ok) {
    return <div className="pile-result-error">⚠️ {result.error}</div>;
  }
  const { negKleef, base, shaft, settlement, spring, summary } = result;
  return (
    <div className="pile-result">
      {result.warnings.length > 0 && (
        <div className="pile-warnings">
          {result.warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}
        </div>
      )}

      <section>
        <h3>Negatieve kleef</h3>
        <table className="pile-formula-table">
          <thead><tr><th>Laag</th><th>σ·Os·K₀tanδ</th><th>F<sub>s;nk</sub></th></tr></thead>
          <tbody>
            {negKleef.layers.map((l, i) => (
              <tr key={i}>
                <td>{l.layer.kind}</td>
                <td>{l.sigmaGemRep.toFixed(1)} · {l.k0TanDelta.toFixed(3)}</td>
                <td><strong>{l.fsNkRep.toFixed(1)} kN</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>F<sub>nk;d</sub> = γ<sub>f,nk</sub> · ΣF<sub>s;nk</sub> = <strong>{negKleef.fnkD.toFixed(0)} kN</strong></p>
      </section>

      <section>
        <h3>Puntdraagvermogen</h3>
        <p>q<sub>c;I;gem</sub> = {base.qcIGemMpa.toFixed(2)} MPa, q<sub>c;II;gem</sub> = {base.qcIIGemMpa.toFixed(2)}, q<sub>c;III;gem</sub> = {base.qcIIIGemMpa.toFixed(2)}</p>
        <p>q<sub>b;max</sub> = {base.qbMaxMpa.toFixed(2)} MPa {base.qbMaxMpaRaw > 15 && "(gecapt op 15)"}</p>
        <p>R<sub>b;cal;max</sub> = A<sub>b</sub> · q<sub>b;max</sub> = <strong>{base.rbCalMax.toFixed(0)} kN</strong></p>
      </section>

      <section>
        <h3>Maximumschachtwrijving</h3>
        <p>R<sub>s;cal;max</sub> = <strong>{shaft.rsCalMax.toFixed(0)} kN</strong></p>
      </section>

      <section>
        <h3>Maximum gronddraagvermogen</h3>
        <p>R<sub>c;cal</sub> = <strong>{summary.rcCal.toFixed(0)} kN</strong></p>
      </section>

      <section>
        <h3>Zakking</h3>
        <p>SLS: s<sub>b</sub>={settlement.sls.sbMm.toFixed(1)} mm, s<sub>1</sub>={settlement.sls.s1Mm.toFixed(1)} mm</p>
        <p>ULS: s<sub>b</sub>={settlement.uls.sbMm.toFixed(1)} mm, s<sub>1</sub>={settlement.uls.s1Mm.toFixed(1)} mm</p>
      </section>

      <section>
        <h3>Veerwaarde</h3>
        <p>k<sub>SLS</sub> = <strong>{spring.kSlsKnPerM.toFixed(0)} kN/m</strong></p>
        <p>k<sub>min</sub> = {spring.kMinKnPerM.toFixed(0)} / k<sub>max</sub> = {spring.kMaxKnPerM.toFixed(0)} kN/m</p>
      </section>

      <section>
        <h3>Samenvatting</h3>
        <p>R<sub>c;d</sub> = {summary.rcD.toFixed(0)} kN</p>
        <p>R<sub>c;net;d</sub> = {summary.rcNetD.toFixed(0)} kN</p>
        <p className={summary.passes ? "pile-pass" : "pile-fail"}>
          Unity check: N<sub>Ed</sub> / R<sub>c;net;d</sub> = <strong>{summary.unityCheck.toFixed(2)}</strong>
          {summary.passes ? " ✓ voldoet" : " ✗ voldoet NIET"}
        </p>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: VisualPanel — CPT-chart placeholder met paal-annotaties**

```tsx
// apps/desktop/src/calc/modules/pile-bearing-capacity/ui/VisualPanel.tsx
import { useCptStore } from "../../../../store/useCptStore";
import type { PileInput, PileResult } from "../types";

export function VisualPanel({ input, result }: { input: PileInput; result: PileResult; onChange?: never }) {
  const cpt = useCptStore((s) => (input.cptId ? s.cpts.get(input.cptId) : null));
  if (!cpt) {
    return <div className="pile-visual-empty">Geen sondering geselecteerd</div>;
  }
  // v1: simple text-based summary. v2: full SVG chart overlay (out of scope).
  return (
    <div className="pile-visual">
      <h3>Sondering: {cpt.id}</h3>
      <table>
        <tbody>
          <tr><th>Paalkop</th><td>NAP {input.pileTopNap.toFixed(2)} m</td></tr>
          <tr><th>Paalpunt</th><td>NAP {input.pileToeNap.toFixed(2)} m</td></tr>
          <tr><th>Neg. kleef tot</th><td>NAP {input.negKleefBottomNap.toFixed(2)} m (ΔL={result.negKleef.deltaLnk.toFixed(1)} m)</td></tr>
          <tr><th>F<sub>nk;d</sub></th><td>{result.negKleef.fnkD.toFixed(0)} kN</td></tr>
          <tr><th>R<sub>s;cal;max</sub></th><td>{result.shaft.rsCalMax.toFixed(0)} kN</td></tr>
          <tr><th>R<sub>b;cal;max</sub></th><td>{result.base.rbCalMax.toFixed(0)} kN</td></tr>
        </tbody>
      </table>
      <p style={{ color: "#888", fontSize: "12px", marginTop: "20px" }}>
        Volledige CPT-chart met overlays komt in iteratie 2.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Module export**

```tsx
// apps/desktop/src/calc/modules/pile-bearing-capacity/module.tsx
import type { CalcModule, ProjectContext } from "../../framework/types";
import type { PileInput, PileResult } from "./types";
import { computePile } from "./compute";
import { PILE_TYPE_CATALOG, buildDefaultSoilLayers } from "./catalog";
import { InputPanel } from "./ui/InputPanel";
import { VisualPanel } from "./ui/VisualPanel";
import { ResultPanel } from "./ui/ResultPanel";

function defaultInput(ctx: ProjectContext): PileInput {
  const cpt = ctx.activeCptId ? ctx.cpts.get(ctx.activeCptId) : null;
  const groundNap = cpt?.metadata.ground_level_nap ?? 0;
  const pileTop = groundNap + 0.34;
  const pileToe = groundNap - 14;
  const water = groundNap - 0.5;
  return {
    cptId: ctx.activeCptId,
    pileTypeId: PILE_TYPE_CATALOG[0].id,
    diameterMm: 219,
    wallThicknessMm: 8.0,
    pileTopNap: pileTop,
    pileToeNap: pileToe,
    waterNap: water,
    excavationNap: groundNap,
    nEd: 0,
    nEk: 0,
    gammaM: 1.20,
    gammaFnk: 1.00,
    negKleefBottomNap: groundNap - 8,
    ksMinFactor: 0.25,
    soilProfile: buildDefaultSoilLayers(pileTop, pileToe, water),
  };
}

export const pileBearingCapacityModule: CalcModule<PileInput, PileResult> = {
  id: "pile-bearing-capacity",
  name: "Funderingspaal",
  subtitle: "Paaldraagvermogen (NEN-EN 1997-1 §7.6)",
  category: "pile",
  icon: "▼",
  norm: "NEN-EN 1997-1:2005+A1:2013+NB:2019",
  status: "available",
  defaultInput,
  compute: (input, ctx) => {
    const cpt = input.cptId ? ctx.cpts.get(input.cptId) ?? null : null;
    return computePile(input, cpt);
  },
  InputPanel,
  VisualPanel,
  ResultPanel,
  statusLine: (r) => ({
    text: r.ok ? `u.c. ${r.summary.unityCheck.toFixed(2)} ${r.summary.passes ? "✓" : "✗"}` : `Fout: ${r.error}`,
    ok: r.ok && r.summary.passes,
  }),
};
```

- [ ] **Step 4: Register in CALC_REGISTRY**

In `apps/desktop/src/calc/framework/registry.ts` voeg import + array-entry toe:

```ts
import { pileBearingCapacityModule } from "../modules/pile-bearing-capacity/module";

export const CALC_REGISTRY: CalcModule[] = [
  pileBearingCapacityModule,     // ← available
  laterallyLoadedPileModule,
  spreadFoundationDrainedModule,
  spreadFoundationUndrainedModule,
  sheetPileWallModule,
  groundAnchorModule,
];
```

- [ ] **Step 5: Verify TS + tests + commit**

```bash
cd apps/desktop && npx tsc --noEmit && npm test
git add apps/desktop/src/calc/
git commit -m "feat(pile): module export + ResultPanel + VisualPanel + registered"
```

---

### Task 27: End-to-end smoke test

- [ ] **Step 1: Start dev**

```bash
cd apps/desktop && npm run tauri dev
```

- [ ] **Step 2: Manual verification**

1. Open Backstage → Extensies → vink "Funderingspaal" aan
2. Open een project met ≥1 CPT (b.v. example.gef)
3. Ga naar Berekeningen-tab
4. Klik "+ Nieuwe berekening" → kies "Funderingspaal" → naam "Test 1" → Toevoegen
5. CalculationsView toont 3-pane met paal-input/visualisatie/resultaten
6. Vul NEd=324, NEk=303, andere defaults → resultaten updaten live
7. Verify Unity check + groen/rood
8. Wijzig paalpunt → resultaten + chart updaten

- [ ] **Step 3: No commit unless fixes needed**

---

## Phase 3 — IFCX Persistence + Polish

### Task 28: Rust-side IFCX schema update

**Files:**
- Modify: `crates-warehouse/cpt-core/src/ifcgis.rs`

- [ ] **Step 1: Add CalculationDef struct + field**

In `crates-warehouse/cpt-core/src/ifcgis.rs`:

```rust
const SCHEMA_VERSION: &str = "ifcgis-0.4";  // bump van 0.3

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalculationDef {
    pub id: String,
    pub module_id: String,
    pub name: String,
    #[serde(default)]
    pub input: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cpt_refs: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bore_refs: Option<Vec<String>>,
}

// In struct ProjectFile, voeg toe na deliverable:
#[serde(default, skip_serializing_if = "Vec::is_empty")]
pub calculations: Vec<CalculationDef>,
```

- [ ] **Step 2: Run Rust tests**

```bash
cd crates-warehouse && cargo test -p cpt-core
```

Expected: all existing tests still pass.

- [ ] **Step 3: Commit (in crates-warehouse repo)**

```bash
cd crates-warehouse && git add cpt-core/src/ifcgis.rs && git commit -m "feat(ifcgis): add calculations field — schema 0.4"
```

---

### Task 29: TS-side IFCX save/load wiring

**Files:**
- Modify: `apps/desktop/src/components/backstage/Backstage.tsx`
- Modify: `apps/desktop/src/store/useCptStore.ts`

- [ ] **Step 1: Include calculations in save payload**

In `Backstage.tsx` `saveProject`, na bestaande velden:

```ts
import { useCalculationsStore } from "../../calc/framework/store";
import { toIfcxArray } from "../../calc/framework/persistence";

// Binnen saveProject:
const calcs = useCalculationsStore.getState().byDoc.get(activeDoc.id) ?? [];
const payload = {
  header: { schema: "ifcgis-0.4", ... },
  // ... bestaande velden ...
  calculations: toIfcxArray(calcs),
};
```

- [ ] **Step 2: Restore calculations on project open**

In `useCptStore.openProjectIfcgis`, na het laden van CPTs/bores/tekening:

```ts
import { useCalculationsStore } from "../calc/framework/store";
import { fromIfcxArray } from "../calc/framework/persistence";

// After project is loaded and docId is known:
if (result.calculations && Array.isArray(result.calculations)) {
  useCalculationsStore.getState().loadFromIfcx(docId, fromIfcxArray(result.calculations));
}
```

- [ ] **Step 3: TS check + commit**

```bash
cd apps/desktop && npx tsc --noEmit
git add apps/desktop/src/
git commit -m "feat(calc): save/load calculations in .ifcgeo IFCX schema 0.4"
```

---

### Task 30: Roundtrip test for IFCX persistence

**Files:**
- Create: `apps/desktop/src/calc/framework/persistence.roundtrip.test.ts`

- [ ] **Step 1: Add e2e-style test**

```ts
// apps/desktop/src/calc/framework/persistence.roundtrip.test.ts
import { describe, it, expect } from "vitest";
import { toIfcxArray, fromIfcxArray } from "./persistence";
import { useCalculationsStore } from "./store";

describe("IFCX roundtrip — store ↔ ifcx ↔ store", () => {
  it("preserves all instance data through save+load cycle", () => {
    useCalculationsStore.setState({ byDoc: new Map(), activeCalcId: null });
    const id = useCalculationsStore.getState().addCalculation(
      "project-1",
      "pile-bearing-capacity",
      "Test",
    );
    useCalculationsStore.getState().updateCalculation("project-1", id, {
      input: { foo: 1, bar: [2, 3] },
    });

    // Serialize
    const list = useCalculationsStore.getState().byDoc.get("project-1")!;
    const ifcx = toIfcxArray(list);

    // Wipe + reload
    useCalculationsStore.setState({ byDoc: new Map(), activeCalcId: null });
    useCalculationsStore.getState().loadFromIfcx("project-1", fromIfcxArray(ifcx));

    const reloaded = useCalculationsStore.getState().byDoc.get("project-1")!;
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].id).toBe(id);
    expect(reloaded[0].name).toBe("Test");
    expect(reloaded[0].input).toEqual({ foo: 1, bar: [2, 3] });
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
cd apps/desktop && npm test
git add apps/desktop/src/calc/framework/persistence.roundtrip.test.ts
git commit -m "test(calc): IFCX roundtrip — store ↔ persistence ↔ store"
```

---

### Task 31: Final polish + version bump

**Files:**
- Modify: `apps/desktop/package.json` (version)
- Modify: `apps/desktop/src-tauri/tauri.conf.json` (version)

- [ ] **Step 1: Bump versions to 0.3.0**

```bash
# package.json: "version": "0.2.9" → "0.3.0"
# tauri.conf.json: "version": "0.2.9" → "0.3.0"
```

- [ ] **Step 2: Run full test suite**

```bash
cd apps/desktop && npm test && npx tsc --noEmit && npm run build
```

Expected: all tests pass, no TS errors, vite build succeeds.

- [ ] **Step 3: Commit + tag**

```bash
git add apps/desktop/package.json apps/desktop/src-tauri/tauri.conf.json
git commit -m "chore(release): v0.3.0 — Calculations framework + Funderingspaal module"
git tag v0.3.0 -m "v0.3.0 — Berekeningen-tab + Funderingspaal (NEN-EN 1997-1)"
git push origin main v0.3.0
```

CI builds Windows + Linux installers via Release-workflow.

---

## Self-Review Notes

- **Spec coverage:** Alle hoofdstukken uit beide specs hebben een corresponderende task.
- **Vitest setup** is included als Task 1 omdat het nog niet in de codebase zat.
- **Snake_case JSON ↔ camelCase TS** loopt door `persistence.ts` (Tasks 5 + 30 testen roundtrip).
- **Engelse file-naming** consistent in alle paden onder `calc/`.
- **TDD pattern** gevolgd voor alle calc-parts (Tasks 18-23).
- **Visual chart-annotations** (full SVG-overlay) zijn expliciet v2 — Task 26 levert een tabellarische placeholder, voldoende voor MVP-validatie.
- **K0·tan(δ) per laag** met 0.25 cap geïmplementeerd in Task 18.
- **Veerwaarde op basis van werkelijke belasting** in Task 22 (settlement workpoints + spring).
- **Zakkings-diagram chart** komt in v2 — Task 26 ResultPanel toont SLS/ULS waarden in tekst.
