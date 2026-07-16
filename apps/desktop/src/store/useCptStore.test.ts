import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

Object.defineProperty(globalThis, "isTauri", {
  configurable: true,
  value: true,
});

import {
  loadBoreFromContent,
  loadCptFromContent,
  useCptStore,
} from "./useCptStore";

const bore = {
  id: "BHR000000000001",
  position: { x_rd: 155000, y_rd: 463000, z_nap: 1.2 },
  final_depth: 4,
  layers: [
    { top_depth: 0, base_depth: 2, soil_name: "sterkSiltigeKlei" },
  ],
  metadata: { source_file: "bore.xml" },
};

const cpt = {
  id: "CPT000000000001",
  position: { x_rd: 155000, y_rd: 463000 },
  points: [{ depth: 0.1, qc: 13.3 }],
  metadata: { source_file: "cpt.xml" },
};

describe("native geotechnical document routing", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useCptStore.setState({
      documents: [],
      activeDocId: null,
      cpts: new Map(),
      activeCptId: null,
    });
  });

  it("opens a native BHR-GT result as an unchanged Bore document", async () => {
    invokeMock.mockResolvedValue({ kind: "bore", data: bore });

    await loadBoreFromContent("<xml />", "bore.xml");

    expect(invokeMock).toHaveBeenCalledWith("open_geotechnical_document", {
      content: "<xml />",
      filename: "bore.xml",
    });
    const documents = useCptStore.getState().documents;
    const document = documents[documents.length - 1];
    expect(document?.kind).toBe("bore");
    if (document?.kind === "bore") expect(document.bore).toEqual(bore);
  });

  it("opens a native BHR-G result in the same Bore presentation shape", async () => {
    const geologicalBore = {
      ...bore,
      id: "BHR000000000002",
      layers: [{ top_depth: 0, base_depth: 2, soil_name: "zand" }],
    };
    invokeMock.mockResolvedValue({ kind: "bore", data: geologicalBore });

    await loadBoreFromContent("<BHR_G_O />", "geological.xml");

    const documents = useCptStore.getState().documents;
    const document = documents[documents.length - 1];
    expect(document?.kind).toBe("bore");
    if (document?.kind === "bore") expect(document.bore).toEqual(geologicalBore);
  });

  it("opens a native CPT result in the current Cpt presentation shape", async () => {
    invokeMock.mockResolvedValue({ kind: "cpt", data: cpt });

    await loadCptFromContent("<CPT_O />", "cpt.xml");

    expect(invokeMock).toHaveBeenCalledWith("open_geotechnical_document", {
      content: "<CPT_O />",
      filename: "cpt.xml",
    });
    const documents = useCptStore.getState().documents;
    const document = documents[documents.length - 1];
    expect(document?.kind).toBe("cpt");
    if (document?.kind === "cpt") expect(document.cpt).toEqual(cpt);
  });
});
