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

  // σ-stack opbouwen — top naar bottom (afnemende NAP).
  // BELANGRIJK: per laag KLIP de top/bot op de neg-kleef-zonegrens
  // zodat een laag die buiten de zone uitsteekt (bv. één laag van
  // paalkop tot paalpunt terwijl de neg-kleef-zone alleen tussen
  // paalkop en negKleefBottomNap loopt) alleen voor het zone-gedeelte
  // bijdraagt. Zonder deze clip werd de volledige laagdikte gebruikt,
  // wat leidde tot een sterke overschatting van Fnk.
  //
  // σ0: de verticale korrelspanning op paalkop-niveau is NIET nul
  // wanneer het ontgravingsniveau (= maaiveld na ontgraven) boven de
  // paalkop ligt — de grond dáárboven weegt mee. Geverifieerd tegen de
  // externe referentie-berekening: bij kleefniveau NAP 0,00 (ΔLnk
  // slechts 0,34 m) print die Fnk = 1 kN, wat alleen reproduceert met
  // overburden vanaf het ontgravingsniveau (+0,84); zonder σ0 komt er
  // 0 kN uit. We lopen het profiel af van ontgraving tot zoneTop; voor
  // het stuk boven de bovenste profiellaag geldt de γ van die laag.
  let sigmaCum = 0;
  if (input.excavationNap > zoneTop && input.soilProfile.length > 0) {
    let nap = input.excavationNap;
    while (nap > zoneTop + 1e-9) {
      const step = Math.min(0.05, nap - zoneTop);
      const mid = nap - step / 2;
      const lay =
        input.soilProfile.find((l) => l.startNap >= mid && mid > l.endNap) ??
        input.soilProfile[0];
      sigmaCum += (lay.gammaK - lay.gammaW) * step;
      nap -= step;
    }
  }
  const layers: NegKleefLayerResult[] = inZone.map((l) => {
    const layerTop = Math.min(l.startNap, zoneTop); // hoogste NAP binnen zone
    const layerBot = Math.max(l.endNap, zoneBot);   // laagste NAP binnen zone
    const thickness = Math.max(0, layerTop - layerBot);
    const sigmaTop = sigmaCum;
    const dSigma = thickness * (l.gammaK - l.gammaW);
    const sigmaBot = sigmaTop + dSigma;
    // sigmaGemRep = integraal van σ over de laag (= σ_gem × h) — wordt
    // direct gebruikt in fsNkRep, daarom multipliciren met thickness hier.
    const sigmaGemRep = ((sigmaTop + sigmaBot) / 2) * thickness; // kPa·m

    const phiRad = toRad(l.phi);
    const k0 = 1 - Math.sin(phiRad);
    const delta = 0.75 * phiRad;
    const tanDelta = Math.tan(delta);
    const k0TanDeltaRaw = k0 * tanDelta;
    const k0TanDelta = Math.max(k0TanDeltaRaw, input.ksMinFactor);

    const fsNkRep = sigmaGemRep * Os * k0TanDelta; // kN

    sigmaCum = sigmaBot;

    return {
      layer: l,
      thickness,
      sigmaRepTop: sigmaTop,
      sigmaRepBottom: sigmaBot,
      sigmaGemRep,
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
