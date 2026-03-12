/**
 * CPT Viewer — Main application logic
 *
 * Features:
 * - Ribbon UI with Start / Kaart tabs
 * - Multiple CPT charts side-by-side
 * - BRO PDOK map with CPT locations
 * - Robertson SBT classification + legend
 * - CPT list, layer table, mini location map
 * - Export to CSV / GeoJSON
 */

(function () {
    const gefParser = new GefParser();
    const broParser = new BroXmlParser();

    // State
    const cptDataSets = [];
    const chartInstances = [];
    let activeIndex = -1;
    let broMap = null;
    let miniMap = null;
    let miniMapMarker = null;

    // DOM elements
    const fileInput = document.getElementById('file-input');
    const dropZone = document.getElementById('drop-zone');
    const welcomeOverlay = document.getElementById('welcome-overlay');
    const chartsContainer = document.getElementById('charts-container');
    const cptInfo = document.getElementById('cpt-info');
    const cptList = document.getElementById('cpt-list');
    const sbtLegend = document.getElementById('sbt-legend');
    const sbtDistBar = document.getElementById('sbt-distribution-bar');
    const mapStatus = document.getElementById('map-status');

    // Status bar
    const statusDepth = document.getElementById('status-depth');
    const statusQc = document.getElementById('status-qc');
    const statusFs = document.getElementById('status-fs');
    const statusRf = document.getElementById('status-rf');
    const statusU2 = document.getElementById('status-u2');
    const statusU2Item = document.getElementById('status-u2-item');
    const statusSoil = document.getElementById('status-soil');
    const statusInfo = document.getElementById('status-info');

    // ============================================
    // COLLAPSIBLE PANELS
    // ============================================

    document.querySelectorAll('.panel-header.collapsible').forEach(header => {
        header.addEventListener('click', () => {
            const sectionId = header.dataset.section;
            const body = document.getElementById(sectionId);
            if (body) {
                body.classList.toggle('collapsed');
                const toggle = header.querySelector('.panel-toggle');
                if (toggle) {
                    toggle.style.transform = body.classList.contains('collapsed') ? 'rotate(-90deg)' : '';
                }
            }
        });
    });

    // ============================================
    // RIBBON TAB SWITCHING
    // ============================================

    document.querySelectorAll('.ribbon-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.ribbon-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const tabId = tab.dataset.tab;
            document.querySelectorAll('.ribbon-content').forEach(c => c.classList.remove('active'));
            document.querySelector(`.ribbon-content[data-tab="${tabId}"]`).classList.add('active');
        });
    });

    // ============================================
    // FILE HANDLING
    // ============================================

    document.getElementById('btn-upload').addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        handleFiles(e.dataTransfer.files);
    });

    fileInput.addEventListener('change', e => { handleFiles(e.target.files); fileInput.value = ''; });

    // Drag/drop on chart area
    const contentArea = document.getElementById('content-area');
    contentArea.addEventListener('dragover', e => e.preventDefault());
    contentArea.addEventListener('drop', e => { e.preventDefault(); handleFiles(e.dataTransfer.files); });

    function handleFiles(fileList) {
        for (const file of fileList) {
            const name = file.name.toLowerCase();
            const isGef = name.endsWith('.gef');
            const isXml = name.endsWith('.xml');
            if (!isGef && !isXml) continue;

            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const result = isXml ? broParser.parse(reader.result) : gefParser.parse(reader.result);
                    result.fileName = file.name;
                    result.format = isXml ? 'BRO-XML' : 'GEF';
                    addDataSet(result);
                } catch (err) {
                    console.error(err);
                    statusInfo.textContent = `Fout: ${err.message}`;
                }
            };
            reader.readAsText(file, isXml ? 'utf-8' : 'iso-8859-1');
        }
    }

    // ============================================
    // SAMPLE FILES
    // ============================================

    function loadSampleFile(url, fileName) {
        const isXml = fileName.toLowerCase().endsWith('.xml');
        statusInfo.textContent = `Laden: ${fileName}...`;
        fetch(url)
            .then(r => r.text())
            .then(text => {
                const result = isXml ? broParser.parse(text) : gefParser.parse(text);
                result.fileName = fileName;
                result.format = isXml ? 'BRO-XML' : 'GEF';
                addDataSet(result);
            })
            .catch(err => {
                console.error(`Kon ${fileName} niet laden:`, err);
                statusInfo.textContent = `Fout bij laden ${fileName}`;
            });
    }

    document.querySelectorAll('[data-sample]').forEach(btn => {
        btn.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            loadSampleFile(btn.dataset.sample, btn.dataset.name || btn.dataset.sample.split('/').pop());
        });
    });

    // ============================================
    // DATA MANAGEMENT + MULTI-CHART
    // ============================================

    function addDataSet(ds) {
        // Robertson classification
        const classifications = Robertson.classifyDataset(ds.data);
        ds.layers = Robertson.mergeLayers(classifications, 0.2);
        ds.distribution = Robertson.computeDistribution(ds.layers);

        cptDataSets.push(ds);
        const index = cptDataSets.length - 1;

        // Create chart panel
        createChartPanel(ds, index);

        // Select this CPT
        selectCpt(index);

        // Hide welcome overlay
        welcomeOverlay.classList.add('hidden');

        // Add to map
        if (broMap) broMap.addLoadedCpt(ds);

        updateStatusInfo();
    }

    function createChartPanel(ds, index) {
        const panel = document.createElement('div');
        panel.className = 'chart-panel';
        panel.dataset.index = index;

        // Header
        const header = document.createElement('div');
        header.className = 'chart-panel-header';
        const label = ds.header.name || ds.fileName;
        header.innerHTML = `<span>${label}</span>`;

        const closeBtn = document.createElement('button');
        closeBtn.className = 'chart-panel-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.title = 'Sluit sondering';
        closeBtn.addEventListener('click', e => {
            e.stopPropagation();
            removeCpt(index);
        });
        header.appendChild(closeBtn);

        header.addEventListener('click', () => selectCpt(index));
        panel.appendChild(header);

        // Canvas wrapper (for ResizeObserver)
        const canvasWrap = document.createElement('div');
        canvasWrap.style.cssText = 'flex:1;min-height:0;position:relative;';
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;cursor:crosshair;';
        canvasWrap.appendChild(canvas);
        panel.appendChild(canvasWrap);

        chartsContainer.appendChild(panel);

        // Create chart instance
        const chart = new CptChart(canvas);
        chart.onHover = (info) => onChartHover(info, index);

        chartInstances[index] = { ds, chart, panel, canvasWrap };

        // Observe resize
        const ro = new ResizeObserver(() => chart.resize());
        ro.observe(canvasWrap);

        // Set data after a tick so canvas has dimensions
        requestAnimationFrame(() => {
            chart.setData(ds.data, ds.columns, ds.layers);
        });
    }

    function removeCpt(index) {
        const inst = chartInstances[index];
        if (!inst) return;

        inst.panel.remove();
        chartInstances[index] = null;
        cptDataSets[index] = null;

        // Select another CPT if the removed one was active
        if (activeIndex === index) {
            const remaining = chartInstances.findIndex(c => c !== null);
            if (remaining >= 0) {
                selectCpt(remaining);
            } else {
                activeIndex = -1;
                clearInfoPanel();
                welcomeOverlay.classList.remove('hidden');
            }
        }

        renderCptList();
        updateStatusInfo();
    }

    function selectCpt(index) {
        activeIndex = index;
        const ds = cptDataSets[index];
        if (!ds) return;

        // Update panel highlights
        chartInstances.forEach((inst, i) => {
            if (inst) {
                inst.panel.classList.toggle('active', i === index);
            }
        });

        renderCptList();
        renderInfo(ds);
        renderTable(ds);
        renderSbtLegend(ds);
        renderLayerTable(ds);
        updateMiniMap(ds);
        updateU2Visibility(ds);
        updateStatusInfo();
    }

    function clearInfoPanel() {
        cptInfo.innerHTML = '';
        cptList.innerHTML = '';
        document.querySelector('#data-table thead').innerHTML = '';
        document.querySelector('#data-table tbody').innerHTML = '';
        document.querySelector('#layer-table thead').innerHTML = '';
        document.querySelector('#layer-table tbody').innerHTML = '';
        sbtLegend.innerHTML = '';
        sbtDistBar.innerHTML = '';
        clearMiniMap();
    }

    // Close all
    document.getElementById('btn-close-all').addEventListener('click', () => {
        chartInstances.forEach((inst) => {
            if (inst) inst.panel.remove();
        });
        chartInstances.length = 0;
        cptDataSets.length = 0;
        activeIndex = -1;
        clearInfoPanel();
        welcomeOverlay.classList.remove('hidden');
        statusInfo.textContent = 'Geen data geladen';
    });

    // ============================================
    // CPT LIST
    // ============================================

    function renderCptList() {
        cptList.innerHTML = '';
        cptDataSets.forEach((ds, i) => {
            if (!ds) return;
            const item = document.createElement('div');
            item.className = 'cpt-list-item' + (i === activeIndex ? ' active' : '');
            item.innerHTML = `
                <span class="cpt-list-dot"></span>
                <span class="cpt-list-name">${ds.header.name || ds.fileName}</span>
            `;

            const closeBtn = document.createElement('button');
            closeBtn.className = 'cpt-list-close';
            closeBtn.innerHTML = '&times;';
            closeBtn.title = 'Sluit';
            closeBtn.addEventListener('click', e => {
                e.stopPropagation();
                removeCpt(i);
            });
            item.appendChild(closeBtn);

            item.addEventListener('click', () => selectCpt(i));
            cptList.appendChild(item);
        });
    }

    // ============================================
    // ZOOM (applied to active chart)
    // ============================================

    document.getElementById('btn-zoom-in').addEventListener('click', () => {
        const inst = chartInstances[activeIndex];
        if (inst) inst.chart.zoomIn();
    });

    document.getElementById('btn-zoom-out').addEventListener('click', () => {
        const inst = chartInstances[activeIndex];
        if (inst) inst.chart.zoomOut();
    });

    document.getElementById('btn-zoom-fit').addEventListener('click', () => {
        const inst = chartInstances[activeIndex];
        if (inst) inst.chart.zoomFit();
    });

    // ============================================
    // HOVER → STATUS BAR
    // ============================================

    function onChartHover(info, index) {
        // Auto-select chart on hover
        if (index !== activeIndex && chartInstances[index]) {
            selectCpt(index);
        }

        if (!info) {
            statusDepth.textContent = '—';
            statusQc.textContent = '—';
            statusFs.textContent = '—';
            statusRf.textContent = '—';
            statusU2.textContent = '—';
            statusSoil.textContent = '—';
            return;
        }
        statusDepth.textContent = info.depth !== null ? info.depth.toFixed(2) + ' m' : '—';
        statusQc.textContent = info.qc !== null && info.qc !== undefined ? info.qc.toFixed(3) + ' MPa' : '—';
        statusFs.textContent = info.fs !== null && info.fs !== undefined ? info.fs.toFixed(4) + ' MPa' : '—';
        statusRf.textContent = info.rf !== null && info.rf !== undefined ? info.rf.toFixed(1) + ' %' : '—';
        statusU2.textContent = info.u2 !== null && info.u2 !== undefined ? info.u2.toFixed(4) + ' MPa' : '—';
        statusSoil.textContent = info.zone ? info.zone.name : '—';
    }

    function updateU2Visibility(ds) {
        const hasU2 = ds.data.some(r => r.u2 != null);
        statusU2Item.style.display = hasU2 ? '' : 'none';
    }

    // ============================================
    // INFO PANEL
    // ============================================

    function renderInfo(ds) {
        const meta = ds.header;
        const items = [];
        if (ds.format) items.push(['Formaat', ds.format]);
        if (meta.testId) items.push(['Sondering', meta.testId]);
        if (meta.projectId) items.push(['Project ID', meta.projectId]);
        if (meta.projectName) items.push(['Projectnaam', meta.projectName]);
        if (meta.company) items.push(['Bedrijf', meta.company]);
        if (meta.qualityRegime) items.push(['Kwaliteitsregime', meta.qualityRegime]);
        if (meta.qualityClass) items.push(['Kwaliteitsklasse', meta.qualityClass]);
        if (meta.cptStandard) items.push(['Norm', meta.cptStandard]);
        if (meta.date) items.push(['Datum', meta.date]);
        if (meta.surfaceLevel) items.push(['Maaiveld', meta.surfaceLevel]);
        if (meta.x && meta.y) items.push(['RD', `${meta.x}, ${meta.y}`]);
        if (meta.lat && meta.lon) items.push(['WGS84', `${meta.lat}, ${meta.lon}`]);
        if (meta.finalDepth) items.push(['Einddiepte', `${meta.finalDepth} m`]);
        items.push(['Meetpunten', `${ds.data.length}`]);

        cptInfo.innerHTML = items.map(([label, value]) => `
            <div class="info-item">
                <div class="label">${label}</div>
                <div class="value">${value}</div>
            </div>
        `).join('');
    }

    // ============================================
    // DATA TABLE
    // ============================================

    function renderTable(ds) {
        const thead = document.querySelector('#data-table thead');
        const tbody = document.querySelector('#data-table tbody');
        const displayCols = ds.columns.filter(c => ['length', 'depth', 'qc', 'fs', 'rf', 'u2'].includes(c.key));

        thead.innerHTML = '<tr>' + displayCols.map(c =>
            `<th>${c.key}<br><small>${c.unit}</small></th>`
        ).join('') + '</tr>';

        const maxRows = 300;
        const rows = ds.data.slice(0, maxRows);
        tbody.innerHTML = rows.map(row =>
            '<tr>' + displayCols.map(c => {
                const v = row[c.key];
                return `<td>${v !== null && v !== undefined ? v.toFixed(3) : '—'}</td>`;
            }).join('') + '</tr>'
        ).join('');

        if (ds.data.length > maxRows) {
            tbody.innerHTML += `<tr><td colspan="${displayCols.length}" style="text-align:center;color:var(--text-muted);padding:8px">
                ... ${ds.data.length - maxRows} rijen niet getoond
            </td></tr>`;
        }
    }

    // ============================================
    // LAYER TABLE (Grondopbouw)
    // ============================================

    function renderLayerTable(ds) {
        const thead = document.querySelector('#layer-table thead');
        const tbody = document.querySelector('#layer-table tbody');

        if (!ds.layers || ds.layers.length === 0) {
            thead.innerHTML = '';
            tbody.innerHTML = '<tr><td style="padding:8px;color:var(--text-muted)">Geen lagen geïnterpreteerd</td></tr>';
            return;
        }

        thead.innerHTML = `<tr>
            <th>Van</th>
            <th>Tot</th>
            <th>Dikte</th>
            <th>Grondsoort</th>
            <th>qc gem.</th>
        </tr>`;

        tbody.innerHTML = ds.layers.map(layer => {
            const thickness = (layer.endDepth - layer.startDepth).toFixed(2);
            // Compute average qc for layer
            const pointsInLayer = ds.data.filter(r => {
                const d = r.depth !== undefined ? Math.abs(r.depth) : r.length;
                return d >= layer.startDepth && d <= layer.endDepth && r.qc != null;
            });
            const avgQc = pointsInLayer.length > 0
                ? (pointsInLayer.reduce((s, r) => s + r.qc, 0) / pointsInLayer.length).toFixed(2)
                : '—';

            return `<tr>
                <td>${layer.startDepth.toFixed(2)}</td>
                <td>${layer.endDepth.toFixed(2)}</td>
                <td>${thickness}</td>
                <td><span class="layer-color-swatch" style="background:${layer.zone.color}"></span>${layer.zone.name}</td>
                <td>${avgQc}</td>
            </tr>`;
        }).join('');
    }

    // ============================================
    // MINI LOCATION MAP
    // ============================================

    function initMiniMap() {
        if (miniMap) return;

        const darkTiles = L.tileLayer(
            'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                attribution: '',
                subdomains: 'abcd',
                maxZoom: 18,
            }
        );

        miniMap = L.map('mini-map', {
            center: [52.1, 5.1],
            zoom: 8,
            layers: [darkTiles],
            zoomControl: false,
            attributionControl: false,
            dragging: true,
            scrollWheelZoom: false,
        });
    }

    function updateMiniMap(ds) {
        const meta = ds.header;
        let lat, lon;

        if (meta.lat && meta.lon) {
            lat = parseFloat(meta.lat);
            lon = parseFloat(meta.lon);
        } else if (meta.x && meta.y) {
            const rd = rdToWgs84(parseFloat(meta.x), parseFloat(meta.y));
            lat = rd.lat;
            lon = rd.lon;
        }

        if (!lat || !lon || isNaN(lat) || isNaN(lon)) {
            clearMiniMap();
            return;
        }

        initMiniMap();

        // Remove old marker
        if (miniMapMarker) {
            miniMap.removeLayer(miniMapMarker);
        }

        miniMapMarker = L.marker([lat, lon], {
            icon: L.divIcon({
                className: '',
                html: '<div style="width:12px;height:12px;border-radius:50%;background:#3b82f6;border:2px solid #fff;box-shadow:0 0 6px rgba(59,130,246,0.5);"></div>',
                iconSize: [12, 12],
                iconAnchor: [6, 6],
            })
        }).addTo(miniMap);

        miniMap.setView([lat, lon], 14);
        setTimeout(() => miniMap.invalidateSize(), 100);
    }

    function clearMiniMap() {
        if (miniMap && miniMapMarker) {
            miniMap.removeLayer(miniMapMarker);
            miniMapMarker = null;
        }
    }

    // RD to WGS84 (same algorithm as BroMap)
    function rdToWgs84(x, y) {
        const x0 = 155000, y0 = 463000;
        const phi0 = 52.15517440, lam0 = 5.38720621;
        const dx = (x - x0) * 1e-5;
        const dy = (y - y0) * 1e-5;

        const lat = phi0 + (
            3235.65389 * dy - 32.58297 * dx * dx - 0.2475 * dy * dy
            - 0.84978 * dx * dx * dy - 0.0655 * dy * dy * dy
            - 0.01709 * dx * dx * dy * dy - 0.00738 * dx
            + 0.0053 * dx * dx * dx * dx - 0.00039 * dx * dx * dy * dy * dy
            + 0.00033 * dx * dx * dx * dx * dy - 0.00012 * dx * dy
        ) / 3600;

        const lon = lam0 + (
            5260.52916 * dx + 105.94684 * dx * dy + 2.45656 * dx * dy * dy
            - 0.81885 * dx * dx * dx + 0.05594 * dx * dy * dy * dy
            - 0.05607 * dx * dx * dx * dy + 0.01199 * dy
            - 0.00256 * dx * dx * dx * dy * dy + 0.00128 * dx * dy * dy * dy * dy
            + 0.00022 * dy * dy - 0.00022 * dx * dx + 0.00026 * dx * dx * dx * dx * dx
        ) / 3600;

        return { lat, lon };
    }

    // ============================================
    // ROBERTSON SBT LEGEND
    // ============================================

    function renderSbtLegend(ds) {
        if (ds.distribution && ds.distribution.length > 0) {
            sbtDistBar.innerHTML = ds.distribution.map(d =>
                `<div class="segment" style="width:${d.percentage}%;background:${d.zone.color}"></div>`
            ).join('');
        } else {
            sbtDistBar.innerHTML = '';
        }

        const distMap = {};
        if (ds.distribution) {
            for (const d of ds.distribution) distMap[d.zone.zone] = d.percentage;
        }

        sbtLegend.innerHTML = ROBERTSON_ZONES.map(z => {
            const pct = distMap[z.zone];
            const dimmed = pct === undefined;
            return `
                <div class="legend-item" style="${dimmed ? 'opacity:0.35' : ''}">
                    <div class="legend-swatch" style="background:${z.color}"></div>
                    <div class="legend-label">${z.zone}. ${z.name}</div>
                    <div class="legend-pct">${pct !== undefined ? pct.toFixed(0) + '%' : ''}</div>
                </div>
            `;
        }).join('');
    }

    // ============================================
    // EXPORT (CSV / GeoJSON)
    // ============================================

    document.getElementById('btn-export-csv').addEventListener('click', () => {
        const ds = cptDataSets[activeIndex];
        if (!ds) { statusInfo.textContent = 'Geen data om te exporteren'; return; }

        const exportCols = ds.columns.filter(c =>
            ['length', 'depth', 'qc', 'fs', 'rf', 'u2', 'u1', 'u3', 'inclination'].includes(c.key)
        );
        const header = exportCols.map(c => `${c.key} (${c.unit})`).join(',');
        const rows = ds.data.map(row =>
            exportCols.map(c => {
                const v = row[c.key];
                return v !== null && v !== undefined ? v : '';
            }).join(',')
        );

        const csv = header + '\n' + rows.join('\n');
        const filename = (ds.header.name || ds.fileName || 'cpt_data').replace(/\.[^.]+$/, '') + '.csv';
        downloadFile(csv, filename, 'text/csv');
        statusInfo.textContent = `CSV geëxporteerd: ${filename}`;
    });

    document.getElementById('btn-export-geojson').addEventListener('click', () => {
        const ds = cptDataSets[activeIndex];
        if (!ds) { statusInfo.textContent = 'Geen data om te exporteren'; return; }

        const meta = ds.header;
        let lat, lon;
        if (meta.lat && meta.lon) {
            lat = parseFloat(meta.lat);
            lon = parseFloat(meta.lon);
        } else if (meta.x && meta.y) {
            const rd = rdToWgs84(parseFloat(meta.x), parseFloat(meta.y));
            lat = rd.lat;
            lon = rd.lon;
        }

        const properties = {
            name: meta.name || ds.fileName,
            format: ds.format,
            testId: meta.testId || '',
            date: meta.date || '',
            finalDepth: meta.finalDepth || '',
            surfaceLevel: meta.surfaceLevel || '',
            dataPoints: ds.data.length,
        };

        // Add layer summary
        if (ds.layers && ds.layers.length > 0) {
            properties.layers = ds.layers.map(l => ({
                from: l.startDepth,
                to: l.endDepth,
                soilType: l.zone.name,
                zone: l.zone.zone,
            }));
        }

        const geojson = {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                geometry: lat && lon ? {
                    type: 'Point',
                    coordinates: [lon, lat]
                } : null,
                properties
            }]
        };

        const text = JSON.stringify(geojson, null, 2);
        const filename = (meta.name || ds.fileName || 'cpt_data').replace(/\.[^.]+$/, '') + '.geojson';
        downloadFile(text, filename, 'application/geo+json');
        statusInfo.textContent = `GeoJSON geëxporteerd: ${filename}`;
    });

    function downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ============================================
    // BRO MAP (always visible)
    // ============================================

    function initMap() {
        if (broMap) return;
        broMap = new BroMap('map');

        broMap.onCptSelect = (broId) => {
            statusInfo.textContent = `Laden BRO sondering ${broId}...`;
            loadBroCpt(broId);
        };
    }

    initMap();

    document.getElementById('btn-load-area').addEventListener('click', () => {
        broMap.loadArea(msg => { mapStatus.textContent = msg; });
    });

    document.getElementById('btn-map-clear').addEventListener('click', () => {
        broMap.clearMarkers();
        mapStatus.textContent = 'Markers gewist';
    });

    async function loadBroCpt(broId) {
        try {
            const url = `https://publiek.broservices.nl/sr/bro-cptv2/api/v2/objects/${broId}?outputFormat=xml`;
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const xml = await resp.text();

            const result = broParser.parse(xml);
            result.fileName = broId;
            result.format = 'BRO-XML';
            addDataSet(result);

            statusInfo.textContent = `${broId} geladen`;
        } catch (err) {
            console.error(`Fout bij laden ${broId}:`, err);
            statusInfo.textContent = `Fout bij laden ${broId}: ${err.message}`;
        }
    }

    // ============================================
    // RESIZE
    // ============================================

    function resizeAllCharts() {
        chartInstances.forEach(inst => {
            if (inst) inst.chart.resize();
        });
    }

    const resizeObserver = new ResizeObserver(() => {
        resizeAllCharts();
    });
    resizeObserver.observe(document.getElementById('content-area'));

    // ============================================
    // STATUS INFO
    // ============================================

    function updateStatusInfo() {
        const count = chartInstances.filter(c => c !== null).length;
        if (count === 0) {
            statusInfo.textContent = 'Geen data geladen';
            return;
        }
        const ds = cptDataSets[activeIndex];
        if (!ds) return;
        const depths = ds.data.map(r => r.length || r.depth || 0).filter(v => v !== null && v !== 0);
        const maxDepth = depths.length > 0 ? Math.max(...depths.map(Math.abs)) : 0;
        statusInfo.textContent = `${ds.header.name || ds.fileName} | ${count} sondering${count > 1 ? 'en' : ''} | ${maxDepth.toFixed(1)} m`;
    }

    statusInfo.textContent = 'Geen data geladen';
})();
