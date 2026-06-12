// apps/desktop/src/calc/modules/pile-bearing-capacity/catalog.ts
import type { PileTypeSpec, SoilKind, SoilLayer } from "./types";

/** Tabel 7.c uit Eurocode 7 NB:2019 — paalklassefactoren. */
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
    material: "steel",
  },
  {
    id: "concrete-prefab-prestressed-driven",
    name: "Prefab voorgespannen betonpaal — geheid",
    alphaP: 0.7,
    alphaS: 0.010,    // Tabel 7.c — voorgespannen geheide betonpaal
    alphaT: 0.007,
    beta: 1.0,        // s=β=1 voor zowel rond als vierkant met a=b
    s: 1.0,
    isCircular: false, // vierkante doorsnede — diameterMm = zijlengte a
    material: "concrete",
  },
];

export function getPileType(id: string): PileTypeSpec | undefined {
  return PILE_TYPE_CATALOG.find((p) => p.id === id);
}

/** Default Φ/γ per grondsoort. γ-waarden afgestemd op de grondsoorten-
 *  tabel van de externe referentie-berekening (NEN 9997-1 Tabel 2.b-
 *  range): zand verzadigd 20 kN/m³ (schoon, matig), zand droog 18,
 *  klei zwak zandig matig 18, veen 13. */
export const SOIL_DEFAULTS: Record<SoilKind, { gammaK: number; gammaW: number; phi: number; label: string }> = {
  "sand-dry": { gammaK: 18, gammaW: 0,  phi: 32.5, label: "Zand droog" },
  "sand-wet": { gammaK: 20, gammaW: 10, phi: 32.5, label: "Zand nat" },
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
  // Conservatieve default: alles tussen paalkop en paalpunt als "klei nat".
  // SPLITS op het waterniveau zodat het effectieve gewicht klopt:
  //   - Boven GWS: gammaW = 0 (geen waterspanning-aftrek)
  //   - Onder GWS: gammaW = SOIL_DEFAULTS.clay.gammaW (=10) — effectief
  //     gewicht γ' = γ_k − γ_w wordt correct toegepast door computeNegKleef
  //     en computeShaftFriction.
  // Zonder deze split gaf de oude implementatie (gammaW = 0 als pileTop
  // > waterNap) voor een paal met paalkop boven water EN paalpunt onder
  // water een veel te grote overburden-stress → enorm overschatte Fnk.
  const clayDef = SOIL_DEFAULTS.clay;
  const layers: SoilLayer[] = [];
  if (waterNap > pileToeNap && waterNap < pileTopNap) {
    // Water doorkruist het profiel → twee lagen.
    layers.push({
      kind: "clay",
      startNap: pileTopNap,
      endNap: waterNap,
      gammaK: clayDef.gammaK,
      gammaW: 0,
      phi: clayDef.phi,
    });
    layers.push({
      kind: "clay",
      startNap: waterNap,
      endNap: pileToeNap,
      gammaK: clayDef.gammaK,
      gammaW: clayDef.gammaW,
      phi: clayDef.phi,
    });
  } else {
    // Volledig boven (paalpunt boven water) of volledig onder.
    const fullyDry = pileToeNap >= waterNap;
    layers.push({
      kind: "clay",
      startNap: pileTopNap,
      endNap: pileToeNap,
      gammaK: clayDef.gammaK,
      gammaW: fullyDry ? 0 : clayDef.gammaW,
      phi: clayDef.phi,
    });
  }
  return layers;
}
