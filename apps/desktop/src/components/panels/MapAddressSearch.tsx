import { useEffect, useMemo, useRef, useState } from "react";
import proj4 from "proj4";

/**
 * PDOK Locatieserver address-search box for the Kaart view.
 *
 * Floating in the top-left corner of the map. As the user types we hit
 * the `suggest` endpoint (cheap, returns a list of completions). Pick a
 * suggestion → call `lookup` to get the WGS84 centroid → fly the map
 * there. Suggestions cover both adressen and woonplaatsen so a quick
 * "Amsterdam" or "Tiel" works just as well as a full street address.
 *
 * Naast adressen accepteert het input-veld ook **coordinaten-paren**:
 *   - RD New (EPSG:28992):  `155123 / 463789` of `155123, 463789`
 *   - WGS84 lat/lon:        `52.156, 5.387`  of `52.156 5.387`
 * Detectie gebaseerd op getalbereik (NL-specifiek). Als coords herkend
 * worden, krijgt de gebruiker een "📍 Vlieg naar locatie" suggestion
 * bovenaan de dropdown die direct naar die coords flyt.
 *
 * The component is purely controlled and doesn't touch the Leaflet
 * instance itself — it dispatches an `ogs:map-fly-to` event that the
 * MapView listens for.
 */

interface SuggestItem {
  id: string;
  weergavenaam: string;
  type: string;
}

interface SuggestResponse {
  response: {
    docs: SuggestItem[];
  };
}

interface LookupResponse {
  response: {
    docs: Array<{ centroide_ll?: string; weergavenaam?: string }>;
  };
}

/** Parse PDOK "POINT(lon lat)" WKT into [lat, lon]. Returns null on malformed input. */
function parseCentroide(wkt: string | undefined): [number, number] | null {
  if (!wkt) return null;
  const m = /POINT\(([-\d.]+)\s+([-\d.]+)\)/i.exec(wkt);
  if (!m) return null;
  const lon = parseFloat(m[1]);
  const lat = parseFloat(m[2]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lat, lon];
}

/** Geparseerd coordinaten-resultaat met source-kind voor weergave-label. */
interface ParsedCoords {
  lat: number;
  lon: number;
  /** Bron-formaat waarin de gebruiker het invoerde — bepaalt het label. */
  kind: "rd" | "wgs84";
  /** Originele waarden (voor display in suggestion-label). */
  raw: { a: number; b: number };
}

/**
 * Probeer de input als coordinaten-paar te parsen. Accepteert:
 *   - Twee getallen gescheiden door komma, puntkomma, slash of spatie
 *   - RD New (NL): x ∈ [0..300000], y ∈ [300000..650000]
 *   - WGS84 (NL): lat ∈ [50..54], lon ∈ [3..8] (ook andersom)
 * Returnt null wanneer de input geen valide NL-coordinatenpaar is.
 */
function parseCoordinates(input: string): ParsedCoords | null {
  const cleaned = input.trim();
  if (cleaned.length === 0) return null;
  // Split op komma / puntkomma / slash / whitespace.
  const parts = cleaned.split(/[,;/\s]+/).filter((p) => p.length > 0);
  if (parts.length !== 2) return null;
  const a = parseFloat(parts[0]);
  const b = parseFloat(parts[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  // RD New (NL-bereik): x in [0..300k], y in [300k..650k].
  if (a >= 0 && a <= 300_000 && b >= 300_000 && b <= 650_000) {
    try {
      const [lon, lat] = proj4("EPSG:28992", "WGS84", [a, b]) as [number, number];
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        return { lat, lon, kind: "rd", raw: { a, b } };
      }
    } catch {
      // proj4 kan gooien bij coords buiten projectie-domein.
    }
    return null;
  }

  // WGS84 (NL-bereik): lat ∈ [50..54], lon ∈ [3..8].
  if (a >= 50 && a <= 54 && b >= 3 && b <= 8) {
    return { lat: a, lon: b, kind: "wgs84", raw: { a, b } };
  }
  // Andersom (sommige GPS-apps geven lon, lat order).
  if (b >= 50 && b <= 54 && a >= 3 && a <= 8) {
    return { lat: b, lon: a, kind: "wgs84", raw: { a, b } };
  }
  return null;
}

const SUGGEST_URL = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/suggest";
const LOOKUP_URL = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/lookup";

export default function MapAddressSearch() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SuggestItem[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Live coordinaten-detectie op de huidige query — re-berekend bij elke
  // keystroke. Verschijnt als top-item in de dropdown wanneer != null,
  // zodat de gebruiker visueel ziet "ah, dit wordt herkend als coords".
  const parsedCoords = useMemo(() => parseCoordinates(query), [query]);

  // Debounced suggest on every keystroke — overslaan als de input een
  // valide coordinaten-paar is (PDOK kent geen "155123, 463789" als adres).
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (parsedCoords) {
      // Coords herkend → geen PDOK-suggest call.
      setItems([]);
      return;
    }
    if (!query || query.trim().length < 2) {
      setItems([]);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const url = `${SUGGEST_URL}?q=${encodeURIComponent(query)}&rows=8`;
      fetch(url, { signal: ctrl.signal })
        .then((r) => r.json() as Promise<SuggestResponse>)
        .then((j) => {
          setItems(j.response?.docs ?? []);
          setHighlight(0);
        })
        .catch((err) => {
          if ((err as Error).name !== "AbortError") {
            console.warn("[MapAddressSearch] suggest failed", err);
          }
        });
    }, 180);
  }, [query, parsedCoords]);

  // Close the dropdown when clicking outside.
  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  const flyToCoords = (c: ParsedCoords) => {
    setOpen(false);
    window.dispatchEvent(
      new CustomEvent("ogs:map-fly-to", {
        detail: { lat: c.lat, lon: c.lon, zoom: 18 },
      }),
    );
  };

  const pick = async (item: SuggestItem) => {
    setOpen(false);
    setQuery(item.weergavenaam);
    try {
      const r = await fetch(`${LOOKUP_URL}?id=${encodeURIComponent(item.id)}`);
      const j = (await r.json()) as LookupResponse;
      const doc = j.response?.docs?.[0];
      const ll = parseCentroide(doc?.centroide_ll);
      if (!ll) return;
      // Zoom level depends on what was picked: an exact adres deserves a
      // tighter zoom than a woonplaats.
      const zoom = /adres|nummeraanduiding/i.test(item.type) ? 19 : 14;
      window.dispatchEvent(
        new CustomEvent("ogs:map-fly-to", {
          detail: { lat: ll[0], lon: ll[1], zoom },
        }),
      );
    } catch (err) {
      console.warn("[MapAddressSearch] lookup failed", err);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      // 1. Coordinaten hebben voorrang — wanneer herkend, fly er direct heen.
      if (parsedCoords) {
        flyToCoords(parsedCoords);
        return;
      }
      // 2. Anders: pak de gehighlight-te suggestion uit de dropdown.
      if (open && items.length > 0) {
        void pick(items[highlight]);
      }
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(items.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    }
  };

  // Label voor de coord-suggestion — toon de bron-vorm + projectie zodat
  // de gebruiker meteen ziet hoe zijn input is geïnterpreteerd.
  const coordLabel = parsedCoords
    ? parsedCoords.kind === "rd"
      ? `RD ${parsedCoords.raw.a.toFixed(1)} / ${parsedCoords.raw.b.toFixed(1)} → WGS ${parsedCoords.lat.toFixed(5)}, ${parsedCoords.lon.toFixed(5)}`
      : `WGS ${parsedCoords.lat.toFixed(5)}, ${parsedCoords.lon.toFixed(5)}`
    : null;

  const showDropdown = open && (parsedCoords !== null || items.length > 0);

  return (
    <div className="map-addrsearch" ref={containerRef}>
      <div className="map-addrsearch-input-wrap">
        <svg className="map-addrsearch-icon" viewBox="0 0 24 24" width="14" height="14"
             fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.5" y2="16.5" />
        </svg>
        <input
          className="map-addrsearch-input"
          type="text"
          value={query}
          placeholder="Zoek adres, plaats of coordinaat (RD / WGS84)…"
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          aria-label="Adres of coordinaat zoeken"
        />
        {query && (
          <button
            type="button"
            className="map-addrsearch-clear"
            onClick={() => { setQuery(""); setItems([]); }}
            title="Wissen"
          >
            ✕
          </button>
        )}
      </div>
      {showDropdown && (
        <ul className="map-addrsearch-results" role="listbox">
          {parsedCoords && coordLabel && (
            <li>
              <button
                type="button"
                className="map-addrsearch-item map-addrsearch-item--coord highlight"
                onClick={() => flyToCoords(parsedCoords)}
                role="option"
                aria-selected={true}
              >
                <span className="map-addrsearch-item-name">📍 Vlieg naar locatie</span>
                <span className="map-addrsearch-item-type">{coordLabel}</span>
              </button>
            </li>
          )}
          {items.map((it, i) => (
            <li key={it.id}>
              <button
                type="button"
                className={`map-addrsearch-item${i === highlight && !parsedCoords ? " highlight" : ""}`}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => void pick(it)}
                role="option"
                aria-selected={i === highlight && !parsedCoords}
              >
                <span className="map-addrsearch-item-name">{it.weergavenaam}</span>
                <span className="map-addrsearch-item-type">{it.type}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
