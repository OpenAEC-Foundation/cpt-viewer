// apps/desktop/src/calc/modules/pile-bearing-capacity/parts/multi-cpt-summary.ts
//
// Multi-sondering paaldraagvermogen-analyse per NEN 9997-1 NB:2019
// §7.6.2.3 (5) + Tabel A.10b. Voor een paalontwerp met n sonderingen
// wordt de karakteristieke draagkracht Rc;k bepaald als het MINIMUM van:
//   - (Rc;k)gem = mean(Rc;cal) / ξ3
//   - (Rc;k)min = min(Rc;cal)  / ξ4
// waarna Rc;d = Rc;k / γm en Rc;net;d = Rc;d − Fnk;d.
//
// De ξ-waarden zijn afhankelijk van:
//   - aantal sonderingen n
//   - type bouwwerk (stijf / niet-stijf — onafhankelijke palen)
//   - of de variatiecoëfficiënt VC < 12% is (dan: gunstige ξ-waarden)
//
// Tabel A.10b uit NEN 9997-1+C2:2017 NB:2019 — afgekapte versie voor
// niet-stijve bouwwerken (de meest voorkomende casus voor losse palen
// onder funderingsherstel).

/** Eén sondering-case in de multi-CPT analyse. */
export interface PerCptCase {
  /** Sondering-id of -naam (voor rapportage). */
  cptId: string;
  /** Maximum puntdraagvermogen Rb;cal;max [kN]. */
  rbCalMax: number;
  /** Maximum schachtwrijving Rs;cal;max [kN]. */
  rsCalMax: number;
  /** Totaal: Rc;cal = Rb;cal;max + Rs;cal;max [kN]. */
  rcCal: number;
  /** Negatieve kleef Fnk;d voor deze sondering [kN] — optioneel; als
   *  null gebruiken we het project-level Fnk;d in de eindstap. */
  fnkD?: number;
}

export interface MultiCptSummary {
  /** Aantal sonderingen n. */
  n: number;
  /** Gemiddelde Rc;cal over alle sonderingen [kN]. */
  rcCalMean: number;
  /** Minimum Rc;cal over alle sonderingen [kN]. */
  rcCalMin: number;
  /** Standaarddeviatie van Rc;cal (n−1 noemer, sample stddev) [kN]. */
  stdDev: number;
  /** Variatiecoëfficiënt VC = (stdDev / rcCalMean) × 100% [%]. */
  variatieCoeffPct: number;
  /** ξ3 uit Tabel A.10b. */
  xi3: number;
  /** ξ4 uit Tabel A.10b. */
  xi4: number;
  /** (Rc;k)gem = rcCalMean / ξ3 [kN]. */
  rcKGem: number;
  /** (Rc;k)min = rcCalMin / ξ4 [kN]. */
  rcKMin: number;
  /** Maatgevende Rc;k = min(rcKGem, rcKMin) [kN]. */
  rcK: number;
  /** Rekenwaarde Rc;d = rcK / γm [kN]. */
  rcD: number;
  /** Gemiddelde Fnk;d project-level (uit per-sondering fnkD of override) [kN]. */
  fnkDMean: number;
  /** Netto rekenwaarde Rc;net;d = rcD − fnkDMean [kN]. */
  rcNetD: number;
  /** Unity check = NEd / Rc;net;d. */
  unityCheck: number;
  /** True als UC ≤ 1,0. */
  passes: boolean;
}

/** Type bouwwerk per NEN 9997-1 NB §7.6.2.2. */
export type BuildingStiffness = "stiff" | "non-stiff";

/**
 * Bepaal ξ3 en ξ4 uit Tabel A.10b van NEN 9997-1 NB:2019.
 *
 * De tabel onderscheidt twee categorieën:
 *   - Niet-stijf bouwwerk (losse palen, geen verdeling van belasting)
 *   - Stijf bouwwerk (palen werken samen, betere verdeling → kleinere ξ)
 *
 * En per categorie twee sub-rijen:
 *   - VC < 12% — gunstige (lagere) ξ-waarden
 *   - VC ≥ 12% — standaard ξ-waarden
 *
 * Voor n > 10 wordt het tabel-extrapolatieprincipe gevolgd (Tabel A.10b
 * topt op n=10). Voor n niet in de tabel: pakken we de naast-hogere
 * tabel-rij — conservatief.
 *
 * NB: voor n=1 zijn ξ3 = ξ4 = 1,39 (niet-stijf) / 1,29 (stijf), conform
 * de "geen statistiek mogelijk"-rij in de tabel.
 */
export function getXiFactors(
  n: number,
  vcUnder12pct: boolean,
  stiffness: BuildingStiffness = "non-stiff",
): { xi3: number; xi4: number } {
  if (n < 1) throw new Error("n must be ≥ 1");

  // Tabel A.10b — niet-stijf bouwwerk
  // [n, xi3 (VC≥12%), xi4 (VC≥12%), xi3 (VC<12%), xi4 (VC<12%)]
  const tableNonStiff: ReadonlyArray<readonly [number, number, number, number, number]> = [
    [1,  1.39, 1.39, 1.39, 1.39],
    [2,  1.32, 1.20, 1.30, 1.13],
    [3,  1.30, 1.11, 1.28, 1.05],
    [4,  1.28, 1.08, 1.27, 1.04],
    [5,  1.27, 1.07, 1.27, 1.02],
    [7,  1.27, 1.05, 1.27, 1.01],
    [10, 1.26, 1.04, 1.26, 1.00],
  ];
  // Tabel A.10b — stijf bouwwerk
  const tableStiff: ReadonlyArray<readonly [number, number, number, number, number]> = [
    [1,  1.29, 1.29, 1.29, 1.29],
    [2,  1.23, 1.14, 1.21, 1.09],
    [3,  1.20, 1.08, 1.19, 1.04],
    [4,  1.19, 1.06, 1.18, 1.03],
    [5,  1.18, 1.05, 1.18, 1.02],
    [7,  1.18, 1.04, 1.18, 1.00],
    [10, 1.17, 1.03, 1.17, 1.00],
  ];
  const table = stiffness === "stiff" ? tableStiff : tableNonStiff;

  // Vind de eerste rij met tabel-n ≥ requested n (conservatieve afronding).
  const row = table.find((r) => r[0] >= n) ?? table[table.length - 1];
  const xi3 = vcUnder12pct ? row[3] : row[1];
  const xi4 = vcUnder12pct ? row[4] : row[2];
  return { xi3, xi4 };
}

interface MultiCptInputs {
  cases: ReadonlyArray<PerCptCase>;
  /** γm voor de paalreactie [Tabel A.10] — typisch 1,20. */
  gammaM: number;
  /** Belasting in ULS [kN]. */
  nEd: number;
  /** Type bouwwerk; default niet-stijf (losse paal). */
  stiffness?: BuildingStiffness;
  /** Project-level Fnk;d override [kN]. Indien gegeven wordt deze waarde
   *  gebruikt i.p.v. het gemiddelde van per-sondering Fnk;d. Handig voor
   *  reproductie van externe rapporten (Referentie) waar het project-Fnk
   *  rechtstreeks is opgegeven. */
  fnkDOverride?: number;
}

/**
 * Multi-sondering paaldraagvermogen-analyse. Implementeert exact de
 * procedure uit NEN 9997-1 NB:2019 §7.6.2.3 (5) + Tabel A.10b zoals
 * gerapporteerd op blad 23 van de Referentie zijn 984.pdf:
 *
 *   VC = std / mean × 100%
 *   (ξ3, ξ4) ← Tabel A.10b op basis van n + (VC < 12%) + bouwwerktype
 *   (Rc;k)gem = mean(Rc;cal) / ξ3
 *   (Rc;k)min = min(Rc;cal)  / ξ4
 *   Rc;d = min((Rc;k)gem, (Rc;k)min) / γm
 *   Rc;net;d = Rc;d − Fnk;d
 *   UC = NEd / Rc;net;d   →   ≤ 1,0 = voldoet
 */
export function computeMultiCptSummary(inputs: MultiCptInputs): MultiCptSummary {
  const { cases, gammaM, nEd, stiffness = "non-stiff", fnkDOverride } = inputs;
  const n = cases.length;
  if (n === 0) throw new Error("multi-CPT summary: geen sonderingen");

  const rcCalValues = cases.map((c) => c.rcCal);
  const rcCalMean = rcCalValues.reduce((a, b) => a + b, 0) / n;
  const rcCalMin = Math.min(...rcCalValues);

  // Sample-standaarddeviatie (n−1 noemer); voor n=1 = 0.
  let stdDev = 0;
  if (n > 1) {
    const sumSq = rcCalValues.reduce((s, v) => s + (v - rcCalMean) ** 2, 0);
    stdDev = Math.sqrt(sumSq / (n - 1));
  }
  const variatieCoeffPct = rcCalMean > 0 ? (stdDev / rcCalMean) * 100 : 0;
  const vcUnder12pct = variatieCoeffPct < 12;

  const { xi3, xi4 } = getXiFactors(n, vcUnder12pct, stiffness);

  const rcKGem = rcCalMean / xi3;
  const rcKMin = rcCalMin / xi4;
  const rcK = Math.min(rcKGem, rcKMin);
  const rcD = rcK / gammaM;

  // Fnk;d project-level: override óf gemiddelde van per-sondering waarden.
  let fnkDMean = 0;
  if (fnkDOverride !== undefined) {
    fnkDMean = fnkDOverride;
  } else {
    const fnkVals = cases
      .map((c) => c.fnkD)
      .filter((v): v is number => v !== undefined);
    if (fnkVals.length > 0) {
      fnkDMean = fnkVals.reduce((a, b) => a + b, 0) / fnkVals.length;
    }
  }

  const rcNetD = rcD - fnkDMean;
  const unityCheck = rcNetD > 0 ? nEd / rcNetD : Infinity;
  const passes = unityCheck <= 1.0;

  return {
    n,
    rcCalMean,
    rcCalMin,
    stdDev,
    variatieCoeffPct,
    xi3,
    xi4,
    rcKGem,
    rcKMin,
    rcK,
    rcD,
    fnkDMean,
    rcNetD,
    unityCheck,
    passes,
  };
}
