/**
 * BRO Map — Leaflet map with BRO CPT locations from PDOK WFS
 */

class BroMap {
    constructor(containerId) {
        this.markers = L.layerGroup();
        this.loadedMarkers = L.layerGroup();
        this.onCptSelect = null;
        this._loading = false;

        // Dark tile layer (CartoDB Dark Matter)
        const darkTiles = L.tileLayer(
            'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
                subdomains: 'abcd',
                maxZoom: 19,
            }
        );

        this.map = L.map(containerId, {
            center: [52.1, 5.1],
            zoom: 8,
            layers: [darkTiles],
            zoomControl: true,
        });

        this.markers.addTo(this.map);
        this.loadedMarkers.addTo(this.map);

        // CPT marker icon
        this._cptIcon = L.divIcon({
            className: '',
            html: '<div style="width:8px;height:8px;border-radius:50%;background:#3b82f6;border:1px solid #0d1117;"></div>',
            iconSize: [8, 8],
            iconAnchor: [4, 4],
        });

        this._loadedIcon = L.divIcon({
            className: '',
            html: '<div style="width:10px;height:10px;border-radius:50%;background:#22c55e;border:2px solid #0d1117;"></div>',
            iconSize: [10, 10],
            iconAnchor: [5, 5],
        });
    }

    invalidateSize() {
        setTimeout(() => this.map.invalidateSize(), 100);
    }

    /**
     * Load CPT locations from BRO PDOK WFS for the current map bounds.
     */
    async loadArea(statusCallback) {
        if (this._loading) return;
        this._loading = true;

        const bounds = this.map.getBounds();
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();

        if (statusCallback) statusCallback('Laden van BRO data...');

        try {
            // Try PDOK BRO CPT WFS
            const bbox = `${sw.lat},${sw.lng},${ne.lat},${ne.lng},urn:ogc:def:crs:EPSG::4326`;
            const url = `https://service.pdok.nl/bzk/brocpt/wfs/v1_0?` +
                `service=WFS&version=2.0.0&request=GetFeature` +
                `&outputFormat=application/json&count=1000` +
                `&bbox=${bbox}`;

            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

            const data = await resp.json();

            if (!data.features || data.features.length === 0) {
                if (statusCallback) statusCallback('Geen sonderingen gevonden in dit gebied');
                this._loading = false;
                return;
            }

            this.markers.clearLayers();

            for (const feature of data.features) {
                const coords = feature.geometry?.coordinates;
                if (!coords) continue;

                // GeoJSON coordinates are [lon, lat]
                const lat = coords[1];
                const lon = coords[0];
                const props = feature.properties || {};
                const broId = props.bro_id || props.broId || props.BRO_ID || feature.id || 'Onbekend';

                const marker = L.marker([lat, lon], { icon: this._cptIcon });
                marker.bindPopup(this._createPopup(broId, props));
                marker.on('popupopen', () => {
                    const btn = document.querySelector(`.btn-load-cpt[data-bro-id="${broId}"]`);
                    if (btn) {
                        btn.addEventListener('click', () => {
                            if (this.onCptSelect) this.onCptSelect(broId);
                        });
                    }
                });
                this.markers.addLayer(marker);
            }

            if (statusCallback) statusCallback(`${data.features.length} sonderingen geladen`);
        } catch (err) {
            console.warn('PDOK WFS fout:', err);
            if (statusCallback) statusCallback(`Fout: ${err.message}. Probeer opnieuw of zoom meer in.`);
        }

        this._loading = false;
    }

    _createPopup(broId, props) {
        const depth = props.final_depth || props.finalDepth || '';
        const date = props.research_report_date || props.researchReportDate || '';
        return `<div class="cpt-marker-popup">
            <b>${broId}</b><br>
            ${depth ? `Diepte: ${depth} m<br>` : ''}
            ${date ? `Datum: ${date}<br>` : ''}
            <button class="btn-load-cpt" data-bro-id="${broId}">Open sondering</button>
        </div>`;
    }

    /**
     * Add a marker for a loaded CPT dataset (green marker).
     */
    addLoadedCpt(ds) {
        const meta = ds.header;
        let lat, lon;

        if (meta.lat && meta.lon) {
            lat = parseFloat(meta.lat);
            lon = parseFloat(meta.lon);
        } else if (meta.x && meta.y) {
            // Convert RD (EPSG:28992) to WGS84 approximately
            const rd = this._rdToWgs84(parseFloat(meta.x), parseFloat(meta.y));
            lat = rd.lat;
            lon = rd.lon;
        }

        if (!lat || !lon || isNaN(lat) || isNaN(lon)) return;

        const name = meta.name || meta.testId || ds.fileName;
        const marker = L.marker([lat, lon], { icon: this._loadedIcon });
        marker.bindPopup(`<div class="cpt-marker-popup"><b>${name}</b><br>Geladen sondering</div>`);
        this.loadedMarkers.addLayer(marker);
    }

    clearMarkers() {
        this.markers.clearLayers();
    }

    /**
     * Approximate RD New (EPSG:28992) to WGS84 conversion.
     * Uses simplified polynomial transformation — accuracy ~1m.
     */
    _rdToWgs84(x, y) {
        const x0 = 155000;
        const y0 = 463000;
        const phi0 = 52.15517440;
        const lam0 = 5.38720621;

        const dx = (x - x0) * 1e-5;
        const dy = (y - y0) * 1e-5;

        const lat = phi0 + (
            3235.65389 * dy
            - 32.58297 * dx * dx
            - 0.2475 * dy * dy
            - 0.84978 * dx * dx * dy
            - 0.0655 * dy * dy * dy
            - 0.01709 * dx * dx * dy * dy
            - 0.00738 * dx
            + 0.0053 * dx * dx * dx * dx
            - 0.00039 * dx * dx * dy * dy * dy
            + 0.00033 * dx * dx * dx * dx * dy
            - 0.00012 * dx * dy
        ) / 3600;

        const lon = lam0 + (
            5260.52916 * dx
            + 105.94684 * dx * dy
            + 2.45656 * dx * dy * dy
            - 0.81885 * dx * dx * dx
            + 0.05594 * dx * dy * dy * dy
            - 0.05607 * dx * dx * dx * dy
            + 0.01199 * dy
            - 0.00256 * dx * dx * dx * dy * dy
            + 0.00128 * dx * dy * dy * dy * dy
            + 0.00022 * dy * dy
            - 0.00022 * dx * dx
            + 0.00026 * dx * dx * dx * dx * dx
        ) / 3600;

        return { lat, lon };
    }
}
