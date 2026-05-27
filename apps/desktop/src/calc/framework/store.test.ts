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
