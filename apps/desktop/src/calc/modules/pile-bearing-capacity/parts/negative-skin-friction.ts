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
