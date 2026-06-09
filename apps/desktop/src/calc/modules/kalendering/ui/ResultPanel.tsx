// apps/desktop/src/calc/modules/kalendering/ui/ResultPanel.tsx
//
// Toont de uitkomst van de Kalendering-berekening:
//  - Foutmelding (als ok=false)
//  - Warnings (als die er zijn)
//  - OCS-style 3-rij formules voor E_blok (bij custom), D_eq, en N_slagen
//  - Twee kerncijfer-blokjes: slagen-per-set + slagen-per-meter

import type { ReactNode } from "react";
import type { KalenderingInput, KalenderingResult } from "../types";
import { CUSTOM_VALBLOK_ID, G_M_S2 } from "../catalog";
import { resolveValblok } from "../compute";
import "./styles.css";

interface FormulaProps {
  lhs: ReactNode;
  symbolic: ReactNode;
  filled?: ReactNode;
  result: ReactNode;
}

function Formula({ lhs, symbolic, filled, result }: FormulaProps) {
  return (
    <div className="kalendering-formula">
      <div className="kalendering-formula-row">
        <span className="kalendering-formula-lhs">{lhs}</span>
        <span className="kalendering-formula-eq">=</span>
        <span className="kalendering-formula-rhs">{symbolic}</span>
      </div>
      {filled !== undefined && (
        <div className="kalendering-formula-row">
          <span className="kalendering-formula-lhs" aria-hidden="true" />
          <span className="kalendering-formula-eq">=</span>
          <span className="kalendering-formula-rhs">{filled}</span>
        </div>
      )}
      <div className="kalendering-formula-row kalendering-formula-row--result">
        <span className="kalendering-formula-lhs" aria-hidden="true" />
        <span className="kalendering-formula-eq">=</span>
        <span className="kalendering-formula-rhs">
          <strong>{result}</strong>
        </span>
      </div>
    </div>
  );
}

interface Props {
  input: KalenderingInput;
  result: KalenderingResult;
  onChange?: (next: KalenderingInput) => void;
}

export function ResultPanel({ input, result }: Props) {
  if (!result.ok) {
    return (
      <div className="kalendering-result">
        <div className="kalendering-result-error">
          ⚠ {result.error ?? "Onbekende fout in berekening."}
        </div>
      </div>
    );
  }

  const valblok = resolveValblok(input);
  const isCustom = input.valblokId === CUSTOM_VALBLOK_ID;
  const dEqM = result.dEqMm / 1000;
  const numerator = input.slagSetMm * dEqM * dEqM * input.conusweerstandMpa;

  return (
    <div className="kalendering-result">
      {result.warnings.length > 0 && (
        <div>
          {result.warnings.map((w, i) => (
            <p key={i} className="kalendering-result-warning">⚠ {w}</p>
          ))}
        </div>
      )}

      <h4>Kerncijfers</h4>
      <div className="kalendering-stats">
        <div className="kalendering-stat">
          <div className="kalendering-stat-label">Slagen per set</div>
          <div className="kalendering-stat-value">
            {result.slagenPerSet}
            <span className="kalendering-stat-unit">per {input.slagSetMm} mm</span>
          </div>
        </div>
        <div className="kalendering-stat">
          <div className="kalendering-stat-label">Slagen per meter</div>
          <div className="kalendering-stat-value">
            {Math.round(result.slagenPerMeter)}
            <span className="kalendering-stat-unit">per 1 m</span>
          </div>
        </div>
        <div className="kalendering-stat">
          <div className="kalendering-stat-label">E_blok</div>
          <div className="kalendering-stat-value">
            {result.eBlokKnm.toFixed(2)}
            <span className="kalendering-stat-unit">kNm</span>
          </div>
        </div>
        <div className="kalendering-stat">
          <div className="kalendering-stat-label">D_eq</div>
          <div className="kalendering-stat-value">
            {result.dEqMm.toFixed(0)}
            <span className="kalendering-stat-unit">mm</span>
          </div>
        </div>
      </div>

      <h4>Berekening</h4>

      {isCustom && valblok && (
        <Formula
          lhs={<>E<sub>blok</sub></>}
          symbolic={<>m · g · h / 1000</>}
          filled={<>{valblok.massaKg} · {G_M_S2.toFixed(2)} · {valblok.valhoogteM.toFixed(2)} / 1000</>}
          result={<>{result.eBlokKnm.toFixed(2)} kNm</>}
        />
      )}

      {input.paalSoort === "rechthoekig" && (
        <Formula
          lhs={<>D<sub>eq</sub></>}
          symbolic={<>√(a · b)</>}
          filled={<>√({input.diameterMm} · {input.zijdeBMm})</>}
          result={<>{result.dEqMm.toFixed(0)} mm</>}
        />
      )}

      <Formula
        lhs={<>N<sub>slagen</sub></>}
        symbolic={
          <>
            ⌈ slag-set · D<sub>eq</sub>² · q<sub>c</sub> / E<sub>blok</sub> ⌉
          </>
        }
        filled={
          <>
            ⌈ {input.slagSetMm} · ({dEqM.toFixed(3)})² · {input.conusweerstandMpa.toFixed(1)} / {result.eBlokKnm.toFixed(2)} ⌉
            <br />
            = ⌈ {numerator.toFixed(2)} / {result.eBlokKnm.toFixed(2)} ⌉
            <br />
            = ⌈ {(numerator / result.eBlokKnm).toFixed(2)} ⌉
          </>
        }
        result={<>{result.slagenPerSet} slagen per {input.slagSetMm} mm</>}
      />

      <p className="kalendering-visual-footnote" style={{ marginTop: 12 }}>
        Bron-formule: <code>=AFRONDEN.BOVEN.EXCEL(slag-set / (E<sub>blok</sub> / (D<sub>eq</sub>² · q<sub>c</sub>)); 1)</code>
        <br />
        Eenheden: slag-set in mm · D<sub>eq</sub> in m · q<sub>c</sub> in MPa · E<sub>blok</sub> in kNm.
      </p>
    </div>
  );
}
