import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Historical Topotijdreis years available from the Kadaster/Esri NL
 * ArcGIS service. Verified against
 *   https://tiles.arcgis.com/tiles/nSZVuSZjHpEZZbRo/arcgis/rest/services?f=json
 * (services named `Historische_tijdreis_<year>`). Pre-1900 coverage is
 * sparse, post-1950 mostly 5-year increments, gaps before 1850.
 *
 * The 1823_1829 range entry maps to a single slider tick labelled "1823"
 * but uses the merged Historische_tijdreis_1823_1829 service id.
 */
interface TopoYear {
  /** Year label shown to the user. */
  year: number;
  /** AGS service identifier suffix (e.g. "1815" or "1823_1829"). */
  serviceId: string;
}

const TOPO_YEARS: TopoYear[] = [
  { year: 1815, serviceId: "1815" },
  { year: 1820, serviceId: "1820" },
  { year: 1823, serviceId: "1823_1829" },
  { year: 1850, serviceId: "1850" },
  { year: 1865, serviceId: "1865" },
  { year: 1875, serviceId: "1875" },
  { year: 1880, serviceId: "1880" },
  { year: 1900, serviceId: "1900" },
  { year: 1910, serviceId: "1910" },
  { year: 1920, serviceId: "1920" },
  { year: 1925, serviceId: "1925" },
  { year: 1930, serviceId: "1930" },
  { year: 1940, serviceId: "1940" },
  { year: 1945, serviceId: "1945" },
  { year: 1950, serviceId: "1950" },
  { year: 1955, serviceId: "1955" },
  { year: 1960, serviceId: "1960" },
  { year: 1965, serviceId: "1965" },
  { year: 1970, serviceId: "1970" },
  { year: 1975, serviceId: "1975" },
  { year: 1980, serviceId: "1980" },
  { year: 1985, serviceId: "1985" },
  { year: 1990, serviceId: "1990" },
  { year: 1995, serviceId: "1995" },
  { year: 2000, serviceId: "2000" },
  { year: 2005, serviceId: "2005" },
  { year: 2010, serviceId: "2010" },
  { year: 2014, serviceId: "2014" },
  { year: 2015, serviceId: "2015" },
];

/** Debounce window when dragging the slider before firing the year event. */
const DEBOUNCE_MS = 200;

/**
 * Horizontal year slider docked at the bottom of the Kaart view.
 *
 * Emits `ogs:topotijdreis-year` (detail = { year, serviceId } or null)
 * whenever the user changes the year. MapView listens to this event and
 * swaps the historical-map tile layer in/out.
 *
 * Index 0 of the slider track means "off" (revert to whatever base layer
 * the GisLayerPanel currently has on). Indexes 1..N correspond to the
 * TOPO_YEARS entries.
 */
export default function TopotijdreisSlider() {
  // sliderIdx === 0 → off. Otherwise points into TOPO_YEARS at idx - 1.
  // Default: 0 (off) so the slider doesn't fight with the user's chosen
  // base layer on first mount.
  const [sliderIdx, setSliderIdx] = useState(0);
  const debounceRef = useRef<number | null>(null);

  const max = TOPO_YEARS.length; // slider range 0..N
  const current = sliderIdx === 0 ? null : TOPO_YEARS[sliderIdx - 1];

  const dispatchYear = useCallback((entry: TopoYear | null) => {
    window.dispatchEvent(
      new CustomEvent("ogs:topotijdreis-year", {
        detail: entry
          ? { year: entry.year, serviceId: entry.serviceId }
          : { year: null, serviceId: null },
      }),
    );
  }, []);

  // Debounced dispatch — dragging would otherwise stamp the network with
  // a request per pixel of slider movement.
  const onChange = useCallback(
    (idx: number) => {
      setSliderIdx(idx);
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        const entry = idx === 0 ? null : TOPO_YEARS[idx - 1];
        dispatchYear(entry);
      }, DEBOUNCE_MS);
    },
    [dispatchYear],
  );

  // Clean up any pending debounce on unmount — and proactively switch
  // off the topotijdreis layer so it doesn't linger when the user
  // navigates away from the Kaart view.
  useEffect(() => {
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      dispatchYear(null);
    };
  }, [dispatchYear]);

  // Compute tick marks for the labelled-year hints below the track.
  // We pick every 4th entry plus the endpoints so the strip doesn't
  // look crowded.
  const tickIndices = useMemo(() => {
    const ticks: number[] = [];
    for (let i = 0; i < TOPO_YEARS.length; i += 4) ticks.push(i);
    if (ticks[ticks.length - 1] !== TOPO_YEARS.length - 1) {
      ticks.push(TOPO_YEARS.length - 1);
    }
    return ticks;
  }, []);

  return (
    <div className="topotijdreis-slider">
      <div className="topotijdreis-year-display">
        {current ? (
          <span className="topotijdreis-year-label">{current.year}</span>
        ) : (
          <span className="topotijdreis-year-off">Topotijdreis uit</span>
        )}
      </div>
      <div className="topotijdreis-controls">
        <button
          type="button"
          className="topotijdreis-off-btn"
          onClick={() => onChange(0)}
          disabled={sliderIdx === 0}
          title="Zet historische kaart uit"
        >
          Uit
        </button>
        <input
          className="topotijdreis-range"
          type="range"
          min={0}
          max={max}
          step={1}
          value={sliderIdx}
          onChange={(e) => onChange(Number(e.currentTarget.value))}
          aria-label="Jaartal historische kaart"
        />
        <button
          type="button"
          className="topotijdreis-latest-btn"
          onClick={() => onChange(max)}
          disabled={sliderIdx === max}
          title="Spring naar meest recente jaar"
        >
          {TOPO_YEARS[TOPO_YEARS.length - 1].year}
        </button>
      </div>
      <div className="topotijdreis-ticks">
        {tickIndices.map((i) => (
          <span
            key={i}
            className="topotijdreis-tick"
            style={{ left: `${((i + 1) / max) * 100}%` }}
          >
            {TOPO_YEARS[i].year}
          </span>
        ))}
      </div>
    </div>
  );
}
