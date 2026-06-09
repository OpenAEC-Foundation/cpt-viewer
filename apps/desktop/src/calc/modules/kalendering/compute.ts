// apps/desktop/src/calc/modules/kalendering/compute.ts
//
// Kalendering — verwacht aantal slagen per slag-set op basis van
// conusweerstand op paalpunt-niveau, paaldiameter en valblok-energie.
//
// Excel-bron (project-template):
//   =AFRONDEN.BOVEN.EXCEL(400/(($F$13/($J$13*$J$13*D16)));1)
//
// waar:
//   400  = slag-set in mm (over welke zakkings-afstand we tellen)
//   F13  = E_blok in kNm  (slag-energie van het valblok)
//   J13  = diameter van de paal in m
//   D16  = q_c (conusweerstand) in MPa
//
// Algebraïsch herwerkt:
//   N_slagen = CEILING( slagSet_mm × D_m² × q_c_MPa / E_blok_kNm )
//
// Voor rechthoekige palen rekenen we met de equivalente diameter
//   D_eq = √(a · b)   (a en b in mm, geconverteerd naar m voor de formule)
//
// Eenheden bewust gemengd zoals in de Excel — de formule is empirisch en
// werkt mits je slagSet in mm, D in m, q_c in MPa, en E in kNm invult.

import type { KalenderingInput, KalenderingResult, KalenderingValblok } from "./types";
import {
  CUSTOM_VALBLOK_ID,
  computeEBlokKnm,
  getValblok,
} from "./catalog";

function ceil(x: number): number {
  return Math.ceil(x);
}

/** Resolve het effectieve valblok: catalog-entry óf custom (uit input). */
export function resolveValblok(input: KalenderingInput): KalenderingValblok | null {
  if (input.valblokId === CUSTOM_VALBLOK_ID) {
    const eBlok = computeEBlokKnm(input.customMassaKg, input.customValhoogteM);
    if (eBlok <= 0) return null;
    return {
      id: CUSTOM_VALBLOK_ID,
      name: "Custom valblok",
      massaKg: input.customMassaKg,
      valhoogteM: input.customValhoogteM,
      eBlokKnm: eBlok,
    };
  }
  return getValblok(input.valblokId) ?? null;
}

/** Bereken de equivalente diameter [mm].
 *  - rond:        D_eq = D
 *  - rechthoekig: D_eq = √(a · b)
 */
export function computeDEqMm(input: KalenderingInput): number {
  if (input.paalSoort === "rond") return input.diameterMm;
  // rechthoekig: meetkundig gemiddelde van a en b
  const a = input.diameterMm;
  const b = input.zijdeBMm;
  if (a <= 0 || b <= 0) return 0;
  return Math.sqrt(a * b);
}

export function computeKalendering(input: KalenderingInput): KalenderingResult {
  const warnings: string[] = [];

  // 1. Valblok resolven
  const valblok = resolveValblok(input);
  if (!valblok) {
    return {
      ok: false,
      error:
        input.valblokId === CUSTOM_VALBLOK_ID
          ? "Custom valblok: massa en valhoogte moeten beide > 0 zijn."
          : `Onbekend valblok-id: ${input.valblokId}`,
      warnings,
      eBlokKnm: 0,
      dEqMm: 0,
      slagenPerSet: 0,
      slagenPerMeter: 0,
    };
  }

  // 2. Equivalente diameter
  const dEqMm = computeDEqMm(input);
  if (dEqMm <= 0) {
    return {
      ok: false,
      error:
        input.paalSoort === "rond"
          ? "Diameter moet > 0 zijn."
          : "Beide zijdes a en b moeten > 0 zijn voor een rechthoekige paal.",
      warnings,
      eBlokKnm: valblok.eBlokKnm,
      dEqMm: 0,
      slagenPerSet: 0,
      slagenPerMeter: 0,
    };
  }

  // 3. Sanity-checks op qc en slag-set
  if (!Number.isFinite(input.conusweerstandMpa) || input.conusweerstandMpa <= 0) {
    return {
      ok: false,
      error: "Conusweerstand moet > 0 MPa zijn.",
      warnings,
      eBlokKnm: valblok.eBlokKnm,
      dEqMm,
      slagenPerSet: 0,
      slagenPerMeter: 0,
    };
  }
  if (!Number.isFinite(input.slagSetMm) || input.slagSetMm <= 0) {
    return {
      ok: false,
      error: "Slag-set moet > 0 mm zijn.",
      warnings,
      eBlokKnm: valblok.eBlokKnm,
      dEqMm,
      slagenPerSet: 0,
      slagenPerMeter: 0,
    };
  }

  // 4. Formule — D omzetten naar meter (Excel-formule J13 zit in m).
  const dEqM = dEqMm / 1000;
  const numerator = input.slagSetMm * dEqM * dEqM * input.conusweerstandMpa;
  const ratio = numerator / valblok.eBlokKnm;
  const slagenPerSet = ceil(ratio);

  // 5. Slagen per meter — pro rata uit slagSet en aantal slagen.
  //    N_per_m = N_per_set × (1000 / slagSet_mm)
  //    NB: we ronden NIET af op heel getal hier, want dit is een
  //    extrapolatie — een fractioneel gemiddelde is informatiever
  //    dan een vroegtijdig afgeronde slag-count.
  const slagenPerMeter = slagenPerSet * (1000 / input.slagSetMm);

  // 6. Praktijk-waarschuwingen
  if (slagenPerSet > 200) {
    warnings.push(
      `Zeer hoge slagcount (${slagenPerSet} per ${input.slagSetMm} mm) — overweeg een zwaarder valblok om beschadiging van de paalkop te voorkomen.`,
    );
  }
  if (slagenPerSet < 3) {
    warnings.push(
      `Zeer lage slagcount (${slagenPerSet} per ${input.slagSetMm} mm) — controleer of de paal de berekende capaciteit daadwerkelijk haalt (kalendering kan te optimistisch zijn).`,
    );
  }
  if (input.conusweerstandMpa > 30) {
    warnings.push(
      `q_c = ${input.conusweerstandMpa.toFixed(1)} MPa is uitzonderlijk hoog — controleer of dit de correcte waarde op paalpunt-niveau is.`,
    );
  }

  return {
    ok: true,
    warnings,
    eBlokKnm: valblok.eBlokKnm,
    dEqMm,
    slagenPerSet,
    slagenPerMeter,
  };
}
