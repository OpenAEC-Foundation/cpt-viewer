// Eenvoudige soil-layer detector — leidt een SoilLayer[] af uit een
// CPT (qc + optioneel fs / rf) via een vereenvoudigde Robertson-
// classificatie. Gebruikt door de verification-test om per sondering
// een soil-profile te genereren zodat computeShaftFriction +
// computeNegKleef met realistische input kunnen draaien.
//
// Dit is een VERSIMPELDE classifier — productie-gebruik draait op
// cpt_core::detect_layers (Robertson 2009 met Ic-index). Hier
// implementeren we alleen de zand/klei/veen-distinctie die voor de
// schachtwrijving + neg-kleef volstaat.

import type { Cpt } from "../../../../types/cpt";
import type { SoilLayer, SoilKind } from "../types";
import { SOIL_DEFAULTS } from "../catalog";

/** Classificeer één meetpunt naar SoilKind op basis van qc + Rf. */
function classifyPoint(qc: number, rfPct: number | undefined): SoilKind {
  // Rf-gebaseerd (Robertson 1990 ruwe drempels):
  //   Rf < 1,0% en qc > 5 MPa → zand
  //   Rf 1–4%                  → siltig zand / siltige klei → klei (conservatief)
  //   Rf > 4%                  → klei
  //   qc < 0,5 MPa             → veen (lage cohesie)
  //
  // Zonder Rf (fallback): pure qc-threshold:
  //   qc >= 5 MPa  → zand-wet
  //   qc >= 1 MPa  → klei
  //   qc <  1 MPa  → veen
  if (qc < 0.4) return "peat";
  if (rfPct === undefined) {
    if (qc >= 5) return "sand-wet";
    if (qc >= 1) return "clay";
    return "peat";
  }
  if (rfPct < 1.0 && qc >= 5) return "sand-wet";
  if (rfPct >= 5.0) return qc < 1 ? "peat" : "clay";
  if (rfPct >= 1.0) return "clay";
  if (qc >= 5) return "sand-wet";
  if (qc >= 1) return "clay";
  return "peat";
}

interface DetectorInputs {
  /** Niveau van GWS [m NAP]. Boven dit niveau → "sand-dry" i.p.v. "sand-wet". */
  waterNap: number;
  /** Minimum laag-dikte in m — kleinere clusters worden samengevoegd met
   *  de vorige laag. Voorkomt fragmentatie door qc-spikes. */
  minLayerThicknessM?: number;
  /** Beperk de output tot lagen tussen deze twee NAP-grenzen. */
  topNap: number;
  botNap: number;
}

/**
 * Detect soil-layers uit een CPT. Procedure:
 *   1. Classificeer elk meetpunt → SoilKind
 *   2. Cluster consecutive same-kind points in lagen
 *   3. Smooth kleine lagen (< minLayerThicknessM) weg via majority-voting
 *      met de buurlagen
 *   4. Map naar SoilLayer[] met γ/φ uit SOIL_DEFAULTS
 */
export function detectSoilLayers(cpt: Cpt, inputs: DetectorInputs): SoilLayer[] {
  const minThick = inputs.minLayerThicknessM ?? 0.30;
  const { topNap, botNap, waterNap } = inputs;

  // Filter punten binnen het bereik [botNap, topNap] (botNap is dieper, hogere depth).
  const points = cpt.points
    .map((p) => ({
      nap: p.depth_nap ?? (cpt.metadata.ground_level_nap ?? 0) - p.depth,
      qc: p.qc ?? 0,
      // Rf (%): bereken uit fs/qc als rf niet direct is.
      rf:
        p.rf !== undefined
          ? p.rf
          : p.fs !== undefined && p.qc !== undefined && p.qc > 0
            ? (p.fs / p.qc) * 100
            : undefined,
    }))
    .filter((p) => p.nap <= topNap && p.nap >= botNap)
    .sort((a, b) => b.nap - a.nap); // top → bot (descending NAP)

  if (points.length < 2) return [];

  // Classify + cluster.
  type Cluster = { kind: SoilKind; topNap: number; botNap: number };
  const clusters: Cluster[] = [];
  for (const p of points) {
    const kind = classifyPoint(p.qc, p.rf);
    const last = clusters[clusters.length - 1];
    if (last && last.kind === kind) {
      last.botNap = p.nap; // extend
    } else {
      clusters.push({ kind, topNap: p.nap, botNap: p.nap });
    }
  }
  // Eerste cluster: stretch top tot exact topNap.
  if (clusters.length > 0) clusters[0].topNap = topNap;
  // Laatste cluster: stretch bot tot botNap.
  if (clusters.length > 0) clusters[clusters.length - 1].botNap = botNap;

  // Merge kleine lagen.
  const merged: Cluster[] = [];
  for (const c of clusters) {
    const thickness = c.topNap - c.botNap;
    if (thickness < minThick && merged.length > 0) {
      // Smelt deze cluster in de vorige (extend botNap).
      merged[merged.length - 1].botNap = c.botNap;
    } else {
      merged.push({ ...c });
    }
  }

  // Map naar SoilLayer met defaults uit catalog.
  return merged.map((c): SoilLayer => {
    const def = SOIL_DEFAULTS[c.kind];
    // gammaW: 0 als laag VOLLEDIG boven GWS, anders default.
    const above = c.botNap >= waterNap;
    const gammaW = above ? 0 : def.gammaW;
    // Voor zand-droog (laag boven water): switch kind naar sand-dry.
    const finalKind: SoilKind =
      c.kind === "sand-wet" && above ? "sand-dry" : c.kind;
    return {
      kind: finalKind,
      startNap: c.topNap,
      endNap: c.botNap,
      gammaK: SOIL_DEFAULTS[finalKind].gammaK,
      gammaW,
      phi: SOIL_DEFAULTS[finalKind].phi,
    };
  });
}
