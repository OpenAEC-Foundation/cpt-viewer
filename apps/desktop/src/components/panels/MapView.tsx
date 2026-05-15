import { useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { invoke } from "@tauri-apps/api/core";
import { loadCptFromContent } from "../../store/useCptStore";

interface BroFeature {
  id: string;
  lat: number;
  lon: number;
  depth?: number;
}

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const [status, setStatus] = useState("Zoom in en klik 'Laad gebied'");

  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current).setView([52.156, 5.388], 8);
    // PDOK BRT (background)
    L.tileLayer(
      "https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png",
      { attribution: "Kaartgegevens © Kadaster | PDOK", maxZoom: 19 },
    ).addTo(map);
    markersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const onLoad = async () => {
      const b = map.getBounds();
      const bbox = {
        min_lat: b.getSouth(),
        min_lon: b.getWest(),
        max_lat: b.getNorth(),
        max_lon: b.getEast(),
      };
      setStatus("Bezig met laden...");
      try {
        const features = await invoke<BroFeature[]>("fetch_bro_area", { bbox });
        markersRef.current?.clearLayers();
        features.forEach((f) => {
          const m = L.marker([f.lat, f.lon]).bindPopup(
            `<strong>${f.id}</strong><br>diepte ${f.depth?.toFixed(1) ?? "—"} m`
          );
          m.on("click", async () => {
            try {
              const xml = await invoke<string>("fetch_bro_cpt", { broId: f.id });
              await loadCptFromContent(xml, `${f.id}.xml`);
            } catch (e) {
              console.error("fetch_bro_cpt failed", e);
            }
          });
          markersRef.current?.addLayer(m);
        });
        setStatus(`${features.length} sonderingen geladen`);
      } catch (e) {
        setStatus(`Fout: ${String(e)}`);
      }
    };
    const onClear = () => {
      markersRef.current?.clearLayers();
      setStatus("Markers gewist");
    };
    window.addEventListener("ogs:bro-load-area", onLoad);
    window.addEventListener("ogs:bro-clear", onClear);
    return () => {
      window.removeEventListener("ogs:bro-load-area", onLoad);
      window.removeEventListener("ogs:bro-clear", onClear);
      map.remove();
    };
  }, []);

  return (
    <div className="map-view-wrap">
      <div ref={containerRef} className="map-view-container" />
      <div className="map-status">{status}</div>
    </div>
  );
}
