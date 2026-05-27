// apps/desktop/src/calc/modules/pile-bearing-capacity/parts/eurocode-curves.ts
/**
 * Lastzakkingslijn 1 (voorgespannen palen, geheid) uit Eurocode 7
 * NB:2019 Figuur 7.n + 7.o. Curve-data gedigitaliseerd uit het figuur.
 *
 * Figuur 7.n: sb/Deq [%] → Rb/Rb;cal;max [%]
 * Figuur 7.o: sb [mm]     → Rs/Rs;cal;max [%]
 *
 * v1 gebruikt lineaire interpolatie tussen control-points. Voor v2:
 * cubic-spline voor smoother resultaat (verwaarloosbaar verschil
 * voor zakkingsberekening).
 */

interface Pt { x: number; y: number }

// Figuur 7.n — sb/Deq (%) op X, Rb/Rb;max (%) op Y
const FIG_7N: Pt[] = [
  { x: 0,   y: 0 },
  { x: 0.5, y: 24 },
  { x: 1.0, y: 45 },
  { x: 1.5, y: 60 },
  { x: 2.0, y: 73 },
  { x: 2.5, y: 82 },
  { x: 3.0, y: 88 },
  { x: 4.0, y: 96 },
  { x: 5.0, y: 100 },
  { x: 10,  y: 100 },
];

// Figuur 7.o — sb [mm] op X, Rs/Rs;max (%) op Y
const FIG_7O: Pt[] = [
  { x: 0,  y: 0 },
  { x: 1,  y: 35 },
  { x: 2,  y: 55 },
  { x: 3,  y: 70 },
  { x: 4,  y: 82 },
  { x: 5,  y: 90 },
  { x: 6,  y: 95 },
  { x: 8,  y: 100 },
  { x: 20, y: 100 },
];

function interp(table: Pt[], x: number): number {
  if (x <= table[0].x) return table[0].y;
  if (x >= table[table.length - 1].x) return table[table.length - 1].y;
  for (let i = 0; i < table.length - 1; i++) {
    const a = table[i], b = table[i + 1];
    if (x >= a.x && x <= b.x) {
      const t = (x - a.x) / (b.x - a.x);
      return a.y + (b.y - a.y) * t;
    }
  }
  return 0;
}

/** Mobiliseerde puntdraagvermogen-fractie bij sb/Deq verhouding in %. */
export function mobBase(sbOverDeqPct: number): number {
  return interp(FIG_7N, sbOverDeqPct) / 100;
}

/** Mobiliseerde schachtwrijvings-fractie bij sb in mm. */
export function mobShaft(sbMm: number): number {
  return interp(FIG_7O, sbMm) / 100;
}
