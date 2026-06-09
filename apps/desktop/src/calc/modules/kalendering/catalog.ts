// apps/desktop/src/calc/modules/kalendering/catalog.ts
import type { KalenderingValblok } from "./types";

/** Aardse zwaartekracht-versnelling [m/s²] voor E = m·g·h. */
export const G_M_S2 = 9.81;

/** Bereken slag-energie E_blok = m · g · h en zet om naar kNm.
 *
 *   E [J = N·m] = m [kg] · 9.81 [m/s²] · h [m]
 *   E [kNm]      = E [J] / 1000
 *
 *  Resultaat is afgerond op 2 decimalen om numerieke ruis te onderdrukken
 *  in de UI; intern in de compute-functie gebruiken we de exacte waarde. */
export function computeEBlokKnm(massaKg: number, valhoogteM: number): number {
  if (!Number.isFinite(massaKg) || !Number.isFinite(valhoogteM)) return 0;
  if (massaKg <= 0 || valhoogteM <= 0) return 0;
  const joules = massaKg * G_M_S2 * valhoogteM;
  return joules / 1000;
}

/** Voorgedefinieerde valblokken — typische combinaties in de NL-praktijk.
 *  De gebruiker kan altijd "Custom" kiezen om eigen waardes in te voeren. */
export const VALBLOK_CATALOG: KalenderingValblok[] = [
  {
    id: "vb-1500-1.0",
    name: "1,5 ton — 1,0 m val",
    massaKg: 1500,
    valhoogteM: 1.0,
    eBlokKnm: computeEBlokKnm(1500, 1.0), // ~14,7 kNm
  },
  {
    id: "vb-2000-1.0",
    name: "2 ton — 1,0 m val",
    massaKg: 2000,
    valhoogteM: 1.0,
    eBlokKnm: computeEBlokKnm(2000, 1.0), // ~19,6 kNm
  },
  {
    id: "vb-3000-1.2",
    name: "3 ton — 1,2 m val",
    massaKg: 3000,
    valhoogteM: 1.2,
    eBlokKnm: computeEBlokKnm(3000, 1.2), // ~35,3 kNm
  },
  {
    id: "vb-4000-1.5",
    name: "4 ton — 1,5 m val",
    massaKg: 4000,
    valhoogteM: 1.5,
    eBlokKnm: computeEBlokKnm(4000, 1.5), // ~58,9 kNm
  },
  {
    id: "vb-5000-1.2",
    name: "5 ton — 1,2 m val",
    massaKg: 5000,
    valhoogteM: 1.2,
    eBlokKnm: computeEBlokKnm(5000, 1.2), // ~58,9 kNm
  },
  {
    id: "vb-7000-1.0",
    name: "7 ton — 1,0 m val",
    massaKg: 7000,
    valhoogteM: 1.0,
    eBlokKnm: computeEBlokKnm(7000, 1.0), // ~68,7 kNm
  },
];

export const CUSTOM_VALBLOK_ID = "custom";

export function getValblok(id: string): KalenderingValblok | undefined {
  return VALBLOK_CATALOG.find((v) => v.id === id);
}

/** Default-startwaarde voor een verse berekening. */
export const DEFAULT_VALBLOK_ID = "vb-3000-1.2";
