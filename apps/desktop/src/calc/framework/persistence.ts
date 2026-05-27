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
