import { useEffect, useRef, useState } from "react";

/**
 * PDOK Locatieserver address-search box for the Kaart view.
 *
 * Floating in the top-left corner of the map. As the user types we hit
 * the `suggest` endpoint (cheap, returns a list of completions). Pick a
 * suggestion → call `lookup` to get the WGS84 centroid → fly the map
 * there. Suggestions cover both adressen and woonplaatsen so a quick
 * "Amsterdam" or "Tiel" works just as well as a full street address.
 *
 * The component is purely controlled and doesn't touch the Leaflet
 * instance itself — it dispatches an `ogs:map-fly-to` event that the
 * MapView listens for. This keeps the addr-search self-contained and
 * means the same component can be reused in any other map-bearing view
 * later (Sonderingstekening, etc.).
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

  // Debounced suggest on every keystroke.
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
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
  }, [query]);

  // Close the dropdown when clicking outside.
  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

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
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(items.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      void pick(items[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

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
          placeholder="Zoek adres of plaats…"
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          aria-label="Adres zoeken"
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
      {open && items.length > 0 && (
        <ul className="map-addrsearch-results" role="listbox">
          {items.map((it, i) => (
            <li key={it.id}>
              <button
                type="button"
                className={`map-addrsearch-item${i === highlight ? " highlight" : ""}`}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => void pick(it)}
                role="option"
                aria-selected={i === highlight}
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
