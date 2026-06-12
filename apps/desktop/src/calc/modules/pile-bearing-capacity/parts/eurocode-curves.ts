// apps/desktop/src/calc/modules/pile-bearing-capacity/parts/eurocode-curves.ts
/**
 * Lastzakkingslijn 1 (grondverdringende geheide palen) uit Eurocode 7
 * NB:2019 Figuur 7.n + 7.o.
 *
 * Figuur 7.n: sb/Deq [%] → Rb/Rb;cal;max [%]
 * Figuur 7.o: sb [mm]     → Rs/Rs;cal;max [%]
 *
 * De control-points zijn geijkt op de 8 werkpunten uit de externe
 * referentie-berekening (984.pdf, bladen 3/6/9/12/15/18/21/26):
 *
 *   7.n: 0,59%→36  0,73%→39  0,78%→40  1,14%→49  1,23%→50  1,37%→53  1,42%→53
 *   7.o: 1,3→49  1,6→53  1,7→54  2,2→62  2,5→65  2,7→69  3,0→72  3,1→73
 *
 * Alle referentieparen reproduceren binnen ±1% (integer-afronding in het
 * referentierapport maakt exacter onmogelijk). Lineaire interpolatie
 * tussen control-points.
 */

interface Pt { x: number; y: number }

// Figuur 7.n — sb/Deq (%) op X, Rb/Rb;max (%) op Y
const FIG_7N: Pt[] = [
  { x: 0,    y: 0 },
  { x: 0.5,  y: 33.5 },
  { x: 1.0,  y: 46 },
  { x: 1.5,  y: 55 },
  { x: 2.0,  y: 62 },
  { x: 2.5,  y: 68 },
  { x: 3.0,  y: 73 },
  { x: 4.0,  y: 82 },
  { x: 5.0,  y: 89 },
  { x: 7.5,  y: 97 },
  { x: 10,   y: 100 },
];

// Figuur 7.o — sb [mm] op X, Rs/Rs;max (%) op Y
const FIG_7O: Pt[] = [
  { x: 0,    y: 0 },
  { x: 0.5,  y: 24 },
  { x: 1.0,  y: 43 },
  { x: 1.5,  y: 52 },
  { x: 2.0,  y: 59 },
  { x: 2.5,  y: 65 },
  { x: 3.0,  y: 72.5 },
  { x: 3.5,  y: 77.5 },
  { x: 4.0,  y: 82 },
  { x: 5.0,  y: 89 },
  { x: 6.0,  y: 94 },
  { x: 7.0,  y: 97.5 },
  { x: 8.0,  y: 100 },
  { x: 20,   y: 100 },
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
