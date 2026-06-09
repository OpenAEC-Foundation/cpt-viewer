// apps/desktop/src/calc/modules/kalendering/ui/InputPanel.tsx
import type { KalenderingInput, KalenderingResult, KalenderingPaalSoort } from "../types";
import { VALBLOK_CATALOG, CUSTOM_VALBLOK_ID, computeEBlokKnm } from "../catalog";
import "./styles.css";

interface Props {
  input: KalenderingInput;
  result: KalenderingResult;
  onChange?: (next: KalenderingInput) => void;
}

export function InputPanel({ input, onChange }: Props) {
  const set = <K extends keyof KalenderingInput>(key: K, value: KalenderingInput[K]) => {
    if (!onChange) return;
    onChange({ ...input, [key]: value });
  };

  const isCustom = input.valblokId === CUSTOM_VALBLOK_ID;
  const customEBlok = computeEBlokKnm(input.customMassaKg, input.customValhoogteM);

  return (
    <div className="kalendering-input">
      <fieldset>
        <legend>Valblok</legend>
        <label>Selectie
          <select
            value={input.valblokId}
            onChange={(e) => set("valblokId", e.target.value)}
          >
            {VALBLOK_CATALOG.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
            <option value={CUSTOM_VALBLOK_ID}>Custom — eigen waarden</option>
          </select>
        </label>
        {isCustom ? (
          <>
            <label>Massa [kg]
              <input
                type="number"
                step="1"
                min={0}
                value={input.customMassaKg}
                onChange={(e) => set("customMassaKg", +e.target.value)}
              />
            </label>
            <label>Valhoogte [m]
              <input
                type="number"
                step="0.05"
                min={0}
                value={input.customValhoogteM}
                onChange={(e) => set("customValhoogteM", +e.target.value)}
              />
            </label>
            <label>E_blok [kNm]
              <input
                type="number"
                className="kalendering-readonly"
                value={customEBlok.toFixed(2)}
                readOnly
              />
            </label>
            <p className="kalendering-hint">
              E = m · g · h = {input.customMassaKg} · 9,81 · {input.customValhoogteM} / 1000
            </p>
          </>
        ) : (
          <label>E_blok [kNm]
            <input
              type="number"
              className="kalendering-readonly"
              value={(
                VALBLOK_CATALOG.find((v) => v.id === input.valblokId)?.eBlokKnm ?? 0
              ).toFixed(2)}
              readOnly
            />
          </label>
        )}
      </fieldset>

      <fieldset>
        <legend>Paaldoorsnede</legend>
        <div className="kalendering-radio-row">
          {(["rond", "rechthoekig"] as KalenderingPaalSoort[]).map((soort) => (
            <label key={soort}>
              <input
                type="radio"
                name="paalSoort"
                value={soort}
                checked={input.paalSoort === soort}
                onChange={() => set("paalSoort", soort)}
              />
              {soort === "rond" ? "Rond" : "Rechthoekig"}
            </label>
          ))}
        </div>
        {input.paalSoort === "rond" ? (
          <label>Diameter [mm]
            <input
              type="number"
              step="1"
              min={0}
              value={input.diameterMm}
              onChange={(e) => set("diameterMm", +e.target.value)}
            />
          </label>
        ) : (
          <>
            <label>Zijde a [mm]
              <input
                type="number"
                step="1"
                min={0}
                value={input.diameterMm}
                onChange={(e) => set("diameterMm", +e.target.value)}
              />
            </label>
            <label>Zijde b [mm]
              <input
                type="number"
                step="1"
                min={0}
                value={input.zijdeBMm}
                onChange={(e) => set("zijdeBMm", +e.target.value)}
              />
            </label>
            <p className="kalendering-hint">
              D_eq = √(a · b) — geometrisch gemiddelde voor rechthoekige doorsnede.
            </p>
          </>
        )}
      </fieldset>

      <fieldset>
        <legend>Grondreactie</legend>
        <label>q_c op paalpunt [MPa]
          <input
            type="number"
            step="0.1"
            min={0}
            value={input.conusweerstandMpa}
            onChange={(e) => set("conusweerstandMpa", +e.target.value)}
          />
        </label>
        <p className="kalendering-hint">
          Conusweerstand op paalpunt-niveau (eenvoudige aflezing uit het CPT-diagram).
          Voor projectberekeningen kan dit later automatisch uit de Funderingspaal-module
          worden overgenomen.
        </p>
      </fieldset>

      <fieldset>
        <legend>Slag-set</legend>
        <label>Zakkings-afstand [mm]
          <input
            type="number"
            step="10"
            min={0}
            value={input.slagSetMm}
            onChange={(e) => set("slagSetMm", +e.target.value)}
          />
        </label>
        <p className="kalendering-hint">
          Standaard 400 mm (= 40 cm) — zoals in het project-template.
          De resulterende kalendering wordt uitgedrukt als aantal slagen
          benodigd om de paal deze afstand verder de grond in te slaan.
        </p>
      </fieldset>
    </div>
  );
}
