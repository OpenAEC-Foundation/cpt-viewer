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
