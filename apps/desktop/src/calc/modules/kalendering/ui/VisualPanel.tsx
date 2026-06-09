// apps/desktop/src/calc/modules/kalendering/ui/VisualPanel.tsx
//
// Schematische weergave van de kalendering-opstelling:
//  - Een valblok dat van hoogte h omhoog valt op de paal
//  - De paal die in de grond zit (met grijze grond-arcering)
//  - Een arrow + label voor de valhoogte
//  - Cross-section onderaan met paaldoorsnede (rond of rechthoekig)
//
// Niet bedoeld als technische tekening — puur educatieve schematische
// schets zodat de gebruiker visueel ziet wat hij heeft ingevoerd.

import type { KalenderingInput, KalenderingResult } from "../types";
import { resolveValblok } from "../compute";
import "./styles.css";

interface Props {
  input: KalenderingInput;
  result: KalenderingResult;
}

// SVG-viewbox — vaste grootte voor consistente schaling.
const V_W = 400;
const V_H = 480;

/** Veilige number-render: behandelt undefined/NaN als "—" zodat een
 *  tussenstand met lege input (bv. tussen addCalc en updateCalc) geen
 *  TypeError op `.toFixed()` veroorzaakt. */
function fmt(n: number | undefined, digits: number): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export function VisualPanel({ input, result }: Props) {
  const valblok = resolveValblok(input);

  // Layout-coördinaten — in viewBox-eenheden.
  const cx = V_W / 2;
  const groundY = 200;   // bovenkant grond
  const pileTopY = 200;  // bovenkant paal == grondniveau
  const pileBotY = 440;  // onderkant paal (= paalpunt)
  const pileHeight = pileBotY - pileTopY;

  // Paalbreedte in viewBox-pixels — schaal D_eq / 800mm op 60px max.
  // result.dEqMm + input.diameterMm kunnen 0/undefined zijn als de
  // instance net is aangemaakt en defaultInput nog niet is doorgegeven.
  const dForVis = Math.max(result.dEqMm || input.diameterMm || 200, 50);
  const pileWidthVB = Math.min(80, Math.max(30, (dForVis / 800) * 80));
  const pileLeft = cx - pileWidthVB / 2;
  const pileRight = cx + pileWidthVB / 2;

  // Valblok bovenop paal — iets breder dan paal
  const blokW = pileWidthVB * 1.4;
  const blokH = 50;
  const blokLeft = cx - blokW / 2;
  const valhoogtePx = 110; // visuele val-pijl-lengte (niet op schaal)
  const blokBottom = pileTopY - 20;
  const blokTop = blokBottom - blokH;
  const valStartY = blokTop - valhoogtePx;

  const eBlokTxt = result.eBlokKnm > 0 ? `${fmt(result.eBlokKnm, 2)} kNm` : "—";
  const valhoogteTxt = valblok ? `${fmt(valblok.valhoogteM, 2)} m` : "—";
  const massaTxt = valblok ? `${valblok.massaKg ?? "—"} kg` : "—";

  return (
    <div className="kalendering-visual">
      <h3>Schematische weergave kalendering</h3>
      <div className="kalendering-visual-svg-wrap">
        <svg
          className="kalendering-visual-svg"
          viewBox={`0 0 ${V_W} ${V_H}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* ─── Lucht-achtergrond (boven grondniveau) ─── */}
          <rect x={0} y={0} width={V_W} height={groundY} fill="#fafaf9" />
          {/* ─── Grondarcering (onder grondniveau) ─── */}
          <defs>
            <pattern id="kal-soil" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="10" stroke="#a8a29e" strokeWidth="1" />
            </pattern>
            <marker id="kal-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#52525b" />
            </marker>
          </defs>
          <rect x={0} y={groundY} width={V_W} height={V_H - groundY} fill="url(#kal-soil)" opacity={0.4} />
          <line x1={0} y1={groundY} x2={V_W} y2={groundY} stroke="#78716c" strokeWidth="1.5" />

          {/* ─── Paal in de grond ─── */}
          <rect
            x={pileLeft}
            y={pileTopY}
            width={pileWidthVB}
            height={pileHeight}
            fill="#94a3b8"
            stroke="#475569"
            strokeWidth="1.5"
          />
          {/* Paalpunt (driehoek) */}
          <polygon
            points={`${pileLeft},${pileBotY} ${pileRight},${pileBotY} ${cx},${pileBotY + 18}`}
            fill="#475569"
            stroke="#1e293b"
            strokeWidth="1"
          />

          {/* ─── Valblok bovenop paal ─── */}
          <rect
            x={blokLeft}
            y={blokTop}
            width={blokW}
            height={blokH}
            fill="#fbbf24"
            stroke="#92400e"
            strokeWidth="2"
            rx="4"
          />
          <text x={cx} y={blokTop + blokH / 2 + 4} textAnchor="middle" fill="#451a03" fontSize="11" fontWeight="700" fontFamily="Inter, sans-serif">
            VALBLOK
          </text>
          <text x={cx} y={blokTop + blokH / 2 + 18} textAnchor="middle" fill="#451a03" fontSize="10" fontFamily="Inter, sans-serif">
            {massaTxt}
          </text>

          {/* ─── Val-pijl + valhoogte label ─── */}
          <line
            x1={blokLeft - 30}
            y1={valStartY}
            x2={blokLeft - 30}
            y2={blokTop - 4}
            stroke="#52525b"
            strokeWidth="1.5"
            markerEnd="url(#kal-arrow)"
          />
          <line
            x1={blokLeft - 36}
            y1={valStartY}
            x2={blokLeft - 24}
            y2={valStartY}
            stroke="#52525b"
            strokeWidth="1.5"
          />
          <line
            x1={blokLeft - 36}
            y1={blokTop}
            x2={blokLeft - 24}
            y2={blokTop}
            stroke="#52525b"
            strokeWidth="1.5"
          />
          <text
            x={blokLeft - 40}
            y={(valStartY + blokTop) / 2}
            textAnchor="end"
            fill="#27272a"
            fontSize="11"
            fontFamily="Inter, sans-serif"
            fontWeight="600"
          >
            h = {valhoogteTxt}
          </text>

          {/* ─── E_blok label rechts van valblok ─── */}
          <text
            x={blokLeft + blokW + 14}
            y={blokTop + blokH / 2 - 4}
            fill="#27272a"
            fontSize="11"
            fontFamily="Inter, sans-serif"
            fontWeight="600"
          >
            E_blok
          </text>
          <text
            x={blokLeft + blokW + 14}
            y={blokTop + blokH / 2 + 12}
            fill="#27272a"
            fontSize="11"
            fontFamily="Inter, sans-serif"
          >
            {eBlokTxt}
          </text>

          {/* ─── q_c label onder paalpunt ─── */}
          <line
            x1={cx}
            y1={pileBotY + 22}
            x2={cx}
            y2={pileBotY + 42}
            stroke="#dc2626"
            strokeWidth="2"
            markerEnd="url(#kal-arrow)"
          />
          <text
            x={cx + 8}
            y={pileBotY + 35}
            fill="#991b1b"
            fontSize="11"
            fontWeight="700"
            fontFamily="Inter, sans-serif"
          >
            q_c = {fmt(input.conusweerstandMpa, 1)} MPa
          </text>

          {/* ─── Grondniveau-label ─── */}
          <text
            x={V_W - 10}
            y={groundY - 4}
            textAnchor="end"
            fill="#52525b"
            fontSize="10"
            fontFamily="Inter, sans-serif"
            fontStyle="italic"
          >
            maaiveld
          </text>

          {/* ─── Paaldiameter-label (links van paal) ─── */}
          <text
            x={pileLeft - 8}
            y={(pileTopY + pileBotY) / 2}
            textAnchor="end"
            fill="#27272a"
            fontSize="10"
            fontFamily="Inter, sans-serif"
          >
            {input.paalSoort === "rond"
              ? `D = ${input.diameterMm ?? "—"} mm`
              : `a × b = ${input.diameterMm ?? "—"} × ${input.zijdeBMm ?? "—"} mm`}
          </text>
          {input.paalSoort === "rechthoekig" && result.dEqMm > 0 && (
            <text
              x={pileLeft - 8}
              y={(pileTopY + pileBotY) / 2 + 14}
              textAnchor="end"
              fill="#52525b"
              fontSize="10"
              fontStyle="italic"
              fontFamily="Inter, sans-serif"
            >
              D_eq = {fmt(result.dEqMm, 0)} mm
            </text>
          )}
        </svg>
      </div>
      <p className="kalendering-visual-footnote">
        Schematische weergave — niet op schaal. Bedoeld om de invoer visueel te
        controleren (valblok-massa & valhoogte, paaldoorsnede en q_c op paalpunt).
      </p>
    </div>
  );
}
