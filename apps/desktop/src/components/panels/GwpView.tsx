import { useEffect, useMemo, useRef, useState } from "react";
import type { Gwp } from "../../types/gwp";
import "./GwpView.css";

/**
 * GwpView — viewer voor één Grondwaterput (GMW).
 *
 * Layout: header met BRO-id + locatie/eigenaar, gevolgd door een tabel
 * van monitoring-buizen (filters) en daaronder de GLD-tijdsgrafiek
 * met grondwaterstanden over de tijd.
 *
 * De GLD-data wordt lazy gehaald op het moment dat de tab open gaat
 * (mount). We zoeken alle GLD-features in een klein bbox rondom de put
 * via de PDOK OGC API en laden vervolgens de CSV-tijdseries.
 */
export default function GwpView({ gwp }: { gwp: Gwp }) {
  // Onderkant filter (diepste tube) — handig voor de header.
  const deepestFilter = useMemo(() => {
    let minN = Infinity;
    for (const t of gwp.tubes) {
      if (typeof t.screenBottomPositionNap === "number") {
        minN = Math.min(minN, t.screenBottomPositionNap);
      }
    }
    return Number.isFinite(minN) ? minN : undefined;
  }, [gwp.tubes]);

  // BROloket-link voor de put zelf.
  const brokloketUrl =
    `https://www.broloket.nl/ondergrondgegevens?bro-id=${encodeURIComponent(gwp.broId)}`;

  return (
    <div className="gwp-view">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="gwp-header">
        <div>
          <h2 className="gwp-title">{gwp.broId}</h2>
          <p className="gwp-sub">
            Grondwatermonitoringput (BRO/GMW)
            {gwp.wellCode ? ` · ${gwp.wellCode}` : ""}
            {gwp.owner ? ` · eigenaar ${gwp.owner}` : ""}
          </p>
        </div>
        <dl className="gwp-meta">
          {(typeof gwp.lat === "number" && typeof gwp.lon === "number") && (
            <>
              <dt>WGS84</dt>
              <dd>
                <code>
                  {gwp.lat.toFixed(5)}, {gwp.lon.toFixed(5)}
                </code>
              </dd>
            </>
          )}
          {(typeof gwp.rdX === "number" && typeof gwp.rdY === "number") && (
            <>
              <dt>RD</dt>
              <dd>
                <code>
                  {gwp.rdX.toFixed(1)}, {gwp.rdY.toFixed(1)}
                </code>
              </dd>
            </>
          )}
          {typeof gwp.groundLevelNap === "number" && (
            <>
              <dt>Maaiveld</dt>
              <dd>
                <code>{gwp.groundLevelNap.toFixed(2)} m NAP</code>
              </dd>
            </>
          )}
          {typeof deepestFilter === "number" && (
            <>
              <dt>Onderste filter</dt>
              <dd>
                <code>{deepestFilter.toFixed(2)} m NAP</code>
              </dd>
            </>
          )}
          {gwp.constructionDate && (
            <>
              <dt>Geconstrueerd</dt>
              <dd>
                <code>{gwp.constructionDate}</code>
              </dd>
            </>
          )}
          {typeof gwp.numberOfMonitoringTubes === "number" && (
            <>
              <dt>Aantal buizen</dt>
              <dd>
                <code>{gwp.numberOfMonitoringTubes}</code>
              </dd>
            </>
          )}
        </dl>
      </header>

      {/* ── Knoppen-balk ───────────────────────────────────────── */}
      <div className="gwp-toolbar">
        <a
          className="gwp-link-btn"
          href={brokloketUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open in BROloket ↗
        </a>
      </div>

      {/* ── Tubes-tabel ────────────────────────────────────────── */}
      {gwp.tubes.length > 0 && (
        <section className="gwp-section">
          <h3 className="gwp-section-title">Monitoring-buizen (filters)</h3>
          <div className="gwp-table-wrap">
            <table className="gwp-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Status</th>
                  <th>Materiaal</th>
                  <th>Buisbovenkant<br/>(m NAP)</th>
                  <th>Buisdiameter<br/>(mm)</th>
                  <th>Filter boven<br/>(m NAP)</th>
                  <th>Filter onder<br/>(m NAP)</th>
                  <th>Filterlengte<br/>(m)</th>
                </tr>
              </thead>
              <tbody>
                {gwp.tubes
                  .slice()
                  .sort((a, b) => a.tubeNumber - b.tubeNumber)
                  .map((t) => (
                    <tr key={t.tubeNumber}>
                      <td>{t.tubeNumber}</td>
                      <td>{t.tubeStatus ?? "—"}</td>
                      <td>{t.material ?? "—"}</td>
                      <td className="num">
                        {t.tubeTopPositionNap?.toFixed(2) ?? "—"}
                      </td>
                      <td className="num">
                        {t.tubeTopDiameterMm?.toFixed(0) ?? "—"}
                      </td>
                      <td className="num">
                        {t.screenTopPositionNap?.toFixed(2) ?? "—"}
                      </td>
                      <td className="num">
                        {t.screenBottomPositionNap?.toFixed(2) ?? "—"}
                      </td>
                      <td className="num">
                        {t.screenLengthM?.toFixed(2) ?? "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── GLD-tijdsgrafiek ───────────────────────────────────── */}
      <section className="gwp-section">
        <h3 className="gwp-section-title">Grondwaterstand over de tijd (GLD)</h3>
        <GldTimeseriesPanel gwp={gwp} />
      </section>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// GLD-tijdsgrafiek
// ════════════════════════════════════════════════════════════════

interface GldSummary {
  broId: string;
  tubeNumber?: number;
  csvUrl: string;
  numberOfObservations?: number;
  firstDate?: string;
  lastDate?: string;
}

interface GldSeries {
  broId: string;
  points: { t: number; v: number }[]; // t = ms epoch, v = m NAP
}

/**
 * Haalt alle GLD's binnen ~50 m van de put en toont per GLD een
 * tijdsgrafiek met grondwaterstanden. Series worden eenmalig gefetcht
 * en daarna client-side getekend in een SVG met wheel-zoom + drag-pan.
 */
function GldTimeseriesPanel({ gwp }: { gwp: Gwp }) {
  const [summaries, setSummaries] = useState<GldSummary[] | null>(null);
  const [series, setSeries] = useState<GldSeries[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stap 1: zoek alle GLD-features binnen ~50 m van de put-positie.
  useEffect(() => {
    if (typeof gwp.lat !== "number" || typeof gwp.lon !== "number") {
      setError("Put heeft geen WGS84-coördinaten — kan GLD's niet zoeken.");
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError(null);
    const d = 0.0005; // ~55 m bij 52°N
    const bbox = [
      gwp.lon - d,
      gwp.lat - d,
      gwp.lon + d,
      gwp.lat + d,
    ].join(",");
    const url =
      "https://api.pdok.nl/tno/bro-grondwatermonitoring-in-samenhang-karakteristieken/ogc/v1/collections/gm_gld/items" +
      `?bbox=${bbox}&limit=50&f=json`;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: any) => {
        if (cancelled) return;
        const out: GldSummary[] = [];
        for (const f of data.features ?? []) {
          const p = f.properties ?? {};
          // Filter: alleen GLD's waarvan we redelijk zeker zijn dat
          // ze bij déze put horen — geometry valt al binnen bbox.
          const csv =
            p.series_fully_assessed_csv_url ||
            p.series_preliminary_csv_url ||
            p.series_unknown_csv_url;
          if (!csv || !p.bro_id) continue;
          out.push({
            broId: p.bro_id,
            csvUrl: csv,
            numberOfObservations: p.number_of_observations,
            firstDate: p.research_first_date,
            lastDate: p.research_last_date,
          });
        }
        setSummaries(out);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(`Kon GLD's niet ophalen: ${e instanceof Error ? e.message : String(e)}`);
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gwp.lat, gwp.lon]);

  // Stap 2: laad CSV voor elke GLD (parallel, met progress).
  useEffect(() => {
    if (!summaries || summaries.length === 0) {
      setSeries([]);
      return;
    }
    let cancelled = false;
    setBusy(true);
    Promise.all(
      summaries.map(async (s) => {
        const r = await fetch(s.csvUrl);
        if (!r.ok) throw new Error(`${s.broId}: HTTP ${r.status}`);
        const text = await r.text();
        return { broId: s.broId, points: parseGldCsv(text) };
      }),
    )
      .then((data) => {
        if (cancelled) return;
        // Filter: alleen series met ≥ 2 punten zijn zinvol om te tekenen.
        setSeries(data.filter((s) => s.points.length >= 2));
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(`CSV laden mislukt: ${e instanceof Error ? e.message : String(e)}`);
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [summaries]);

  if (error) {
    return <div className="gwp-empty">{error}</div>;
  }
  if (busy && series.length === 0) {
    return <div className="gwp-empty">Grondwaterstanden ophalen…</div>;
  }
  if (!summaries || summaries.length === 0) {
    return (
      <div className="gwp-empty">
        Geen GLD-tijdseries gevonden in de buurt van deze put.
      </div>
    );
  }
  if (series.length === 0) {
    return <div className="gwp-empty">GLD's gevonden ({summaries.length}) maar geen meetwaarden ontvangen.</div>;
  }

  return (
    <>
      <p className="gwp-section-sub">
        {series.length} tijdseries{series.length === 1 ? "" : ""} gevonden bij deze put.
        Scrollen = horizontaal zoomen, slepen = verschuiven, dubbelklik = reset.
      </p>
      <GldChart series={series} />
      <ul className="gwp-gld-list">
        {summaries.map((s) => (
          <li key={s.broId}>
            <code>{s.broId}</code>
            {typeof s.numberOfObservations === "number" && (
              <> · {s.numberOfObservations} metingen</>
            )}
            {s.firstDate && s.lastDate && (
              <> · {s.firstDate} → {s.lastDate}</>
            )}
            <a
              className="gwp-link-inline"
              href={`https://www.broloket.nl/ondergrondgegevens?bro-id=${encodeURIComponent(s.broId)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              BROloket ↗
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Parse de "compact" GLD-CSV van publiek.broservices.nl naar
 * tijd/waarde-paren. Format (geen header, komma-gescheiden, dubbele
 * quotes):
 *   "2019-05-01T18:41:00+02:00","11.497","onbeslist",,,"discontinu"
 * Velden: timestamp, waarde (m NAP), beoordeling, ..., regelmethode.
 */
function parseGldCsv(text: string): { t: number; v: number }[] {
  const out: { t: number; v: number }[] = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    if (!raw || !raw.trim()) continue;
    // Snelle CSV-split — velden zijn altijd "..." of leeg.
    const parts = raw.split(",");
    if (parts.length < 2) continue;
    const tStr = parts[0].replace(/^"|"$/g, "");
    const vStr = parts[1].replace(/^"|"$/g, "");
    if (!tStr || !vStr) continue;
    const t = Date.parse(tStr);
    const v = parseFloat(vStr);
    if (isNaN(t) || isNaN(v)) continue;
    out.push({ t, v });
  }
  // Sort op tijd (sommige GLD's staan niet helemaal chronologisch).
  out.sort((a, b) => a.t - b.t);
  return out;
}

// ── Chart ────────────────────────────────────────────────────────

const COLORS = ["#0EA5E9", "#F97316", "#22C55E", "#EC4899", "#A855F7", "#EAB308"];

function GldChart({ series }: { series: GldSeries[] }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(800);
  const h = 320;
  const padL = 56;
  const padR = 12;
  const padT = 12;
  const padB = 32;

  // Resize-observer voor responsive breedte.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width > 0) setW(Math.floor(r.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Domain: vol bereik over alle series, met visuele padding op v-as.
  const fullDomain = useMemo(() => {
    let tMin = Infinity;
    let tMax = -Infinity;
    let vMin = Infinity;
    let vMax = -Infinity;
    for (const s of series) {
      for (const p of s.points) {
        if (p.t < tMin) tMin = p.t;
        if (p.t > tMax) tMax = p.t;
        if (p.v < vMin) vMin = p.v;
        if (p.v > vMax) vMax = p.v;
      }
    }
    if (!isFinite(tMin) || !isFinite(vMin)) {
      return { tMin: 0, tMax: 1, vMin: 0, vMax: 1 };
    }
    if (tMin === tMax) tMax = tMin + 1;
    if (vMin === vMax) {
      vMin -= 0.5;
      vMax += 0.5;
    } else {
      const pad = (vMax - vMin) * 0.05;
      vMin -= pad;
      vMax += pad;
    }
    return { tMin, tMax, vMin, vMax };
  }, [series]);

  // View-domain (zoom/pan) — initieel = volle domain.
  const [view, setView] = useState(fullDomain);
  useEffect(() => {
    setView(fullDomain);
  }, [fullDomain]);

  // Pan-state.
  const dragRef = useRef<{ x: number; y: number; tMin: number; tMax: number; vMin: number; vMax: number } | null>(null);

  const innerW = Math.max(50, w - padL - padR);
  const innerH = Math.max(50, h - padT - padB);

  const xScale = (t: number) =>
    padL + ((t - view.tMin) / (view.tMax - view.tMin)) * innerW;
  const yScale = (v: number) =>
    padT + (1 - (v - view.vMin) / (view.vMax - view.vMin)) * innerH;

  // Wheel = horizontaal zoomen rond de muis-positie.
  const svgRef = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const tAtCursor =
        view.tMin + ((mx - padL) / innerW) * (view.tMax - view.tMin);
      const factor = e.deltaY < 0 ? 0.8 : 1.25;
      const newSpan = (view.tMax - view.tMin) * factor;
      const fullSpan = fullDomain.tMax - fullDomain.tMin;
      const clampedSpan = Math.max(60 * 1000, Math.min(fullSpan, newSpan));
      const ratio = (mx - padL) / innerW;
      let nMin = tAtCursor - ratio * clampedSpan;
      let nMax = nMin + clampedSpan;
      // Clamp binnen volledige domain.
      if (nMin < fullDomain.tMin) {
        nMin = fullDomain.tMin;
        nMax = nMin + clampedSpan;
      }
      if (nMax > fullDomain.tMax) {
        nMax = fullDomain.tMax;
        nMin = nMax - clampedSpan;
        if (nMin < fullDomain.tMin) nMin = fullDomain.tMin;
      }
      setView((v) => ({ ...v, tMin: nMin, tMax: nMax }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [view, fullDomain, innerW]);

  const onMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      tMin: view.tMin,
      tMax: view.tMax,
      vMin: view.vMin,
      vMax: view.vMax,
    };
  };
  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!dragRef.current) return;
    const d = dragRef.current;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    const span = d.tMax - d.tMin;
    const vSpan = d.vMax - d.vMin;
    const dt = -(dx / innerW) * span;
    const dv = (dy / innerH) * vSpan;
    let nMin = d.tMin + dt;
    let nMax = d.tMax + dt;
    // Clamp horizontaal binnen volledige domain.
    if (nMin < fullDomain.tMin) {
      nMin = fullDomain.tMin;
      nMax = nMin + span;
    }
    if (nMax > fullDomain.tMax) {
      nMax = fullDomain.tMax;
      nMin = nMax - span;
    }
    setView({ tMin: nMin, tMax: nMax, vMin: d.vMin + dv, vMax: d.vMax + dv });
  };
  const onMouseUp = () => {
    dragRef.current = null;
  };
  const onDoubleClick = () => {
    setView(fullDomain);
  };

  // Tijd-as ticks — kies een leesbare stap-grootte.
  const tTicks = useMemo(() => niceTimeTicks(view.tMin, view.tMax, 6), [view.tMin, view.tMax]);
  // V-as ticks.
  const vTicks = useMemo(() => niceLinearTicks(view.vMin, view.vMax, 6), [view.vMin, view.vMax]);

  // Polyline-paths per serie. We "decimeren" punten als er heel veel
  // zijn om SVG-renders snel te houden — bv. maximaal 2000 punten.
  const paths = useMemo(() => {
    return series.map((s, idx) => {
      const filt = s.points.filter((p) => p.t >= view.tMin && p.t <= view.tMax);
      const step = Math.max(1, Math.ceil(filt.length / 2000));
      const pts: string[] = [];
      for (let i = 0; i < filt.length; i += step) {
        const p = filt[i];
        pts.push(`${xScale(p.t).toFixed(1)},${yScale(p.v).toFixed(1)}`);
      }
      return {
        d: pts.length > 0 ? `M${pts.join(" L")}` : "",
        color: COLORS[idx % COLORS.length],
        broId: s.broId,
        count: filt.length,
      };
    });
  }, [series, view, innerW, innerH]);

  return (
    <div className="gwp-chart-wrap" ref={wrapRef}>
      <svg
        ref={svgRef}
        width={w}
        height={h}
        className="gwp-chart"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onDoubleClick={onDoubleClick}
      >
        {/* Y-as gridlijnen + labels */}
        {vTicks.map((v) => (
          <g key={`v-${v}`}>
            <line
              x1={padL}
              x2={padL + innerW}
              y1={yScale(v)}
              y2={yScale(v)}
              stroke="#e5e5e5"
              strokeWidth={1}
            />
            <text
              x={padL - 6}
              y={yScale(v)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={11}
              fill="#71717a"
            >
              {v.toFixed(2)}
            </text>
          </g>
        ))}
        {/* X-as ticks + labels */}
        {tTicks.map((t) => (
          <g key={`t-${t}`}>
            <line
              x1={xScale(t)}
              x2={xScale(t)}
              y1={padT}
              y2={padT + innerH}
              stroke="#f1f1f1"
              strokeWidth={1}
            />
            <text
              x={xScale(t)}
              y={padT + innerH + 14}
              textAnchor="middle"
              fontSize={11}
              fill="#71717a"
            >
              {formatTimeTick(t, view.tMax - view.tMin)}
            </text>
          </g>
        ))}
        {/* As-titels */}
        <text
          x={8}
          y={padT + innerH / 2}
          fontSize={11}
          fill="#71717a"
          transform={`rotate(-90, 8, ${padT + innerH / 2})`}
          textAnchor="middle"
        >
          Waterstand (m NAP)
        </text>
        {/* Frame */}
        <rect
          x={padL}
          y={padT}
          width={innerW}
          height={innerH}
          fill="none"
          stroke="#71717a"
          strokeWidth={1}
        />
        {/* Series-lijnen */}
        {paths.map((p) => (
          <path
            key={p.broId}
            d={p.d}
            fill="none"
            stroke={p.color}
            strokeWidth={1.5}
            opacity={0.85}
          />
        ))}
      </svg>
      {/* Legend */}
      <div className="gwp-chart-legend">
        {paths.map((p) => (
          <span key={p.broId} className="gwp-chart-legend-item">
            <span
              className="gwp-chart-legend-swatch"
              style={{ background: p.color }}
            />
            <code>{p.broId}</code> ({p.count})
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Tick helpers ─────────────────────────────────────────────────

function niceLinearTicks(min: number, max: number, target: number): number[] {
  const span = max - min;
  if (span <= 0) return [min];
  const raw = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let step;
  if (norm < 1.5) step = 1 * mag;
  else if (norm < 3) step = 2 * mag;
  else if (norm < 7) step = 5 * mag;
  else step = 10 * mag;
  const first = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = first; v <= max + 1e-9; v += step) {
    out.push(+v.toFixed(6));
    if (out.length > 50) break;
  }
  return out;
}

function niceTimeTicks(tMin: number, tMax: number, target: number): number[] {
  const span = tMax - tMin;
  const day = 86400 * 1000;
  const week = 7 * day;
  const month = 30 * day;
  const year = 365 * day;
  const candidates = [
    60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000,
    6 * 60 * 60 * 1000, day, 2 * day, week, 2 * week,
    month, 3 * month, 6 * month, year, 2 * year, 5 * year, 10 * year,
  ];
  const ideal = span / target;
  let step = candidates[0];
  for (const c of candidates) if (c <= ideal) step = c;
  const first = Math.ceil(tMin / step) * step;
  const out: number[] = [];
  for (let v = first; v <= tMax + 1; v += step) {
    out.push(v);
    if (out.length > 50) break;
  }
  return out;
}

function formatTimeTick(t: number, span: number): string {
  const d = new Date(t);
  const year = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hr = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  if (span < 2 * 86400 * 1000) return `${day}/${mo} ${hr}:${mi}`;
  if (span < 365 * 86400 * 1000) return `${day}/${mo}`;
  if (span < 5 * 365 * 86400 * 1000) return `${mo}/${year}`;
  return `${year}`;
}
