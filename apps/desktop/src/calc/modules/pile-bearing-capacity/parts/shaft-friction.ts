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
