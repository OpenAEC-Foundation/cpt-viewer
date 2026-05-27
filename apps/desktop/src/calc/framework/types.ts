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
