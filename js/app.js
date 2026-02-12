/**
 * CPT Viewer — Main application logic
 *
 * Features:
 * - Ribbon UI with Start / Kaart tabs
 * - Multiple CPT charts side-by-side
 * - BRO PDOK map with CPT locations
 * - Robertson SBT classification + legend
 */

(function () {
    const gefParser = new GefParser();
    const broParser = new BroXmlParser();

    // State
    const cptDataSets = [];      // All loaded CPTs
    const chartInstances = [];   // { ds, chart, panel } per loaded CPT
    let activeIndex = -1;
    let broMap = null;

    // DOM elements
    const fileInput = document.getElementById('file-input');
    const dropZone = document.getElementById('drop-zone');
    const welcomeOverlay = document.getElementById('welcome-overlay');
    const chartsContainer = document.getElementById('charts-container');
    const cptInfo = document.getElementById('cpt-info');
    const sbtLegend = document.getElementById('sbt-legend');
    const sbtDistBar = document.getElementById('sbt-distribution-bar');
    const mapStatus = document.getElementById('map-status');

    // Status bar
    const statusDepth = document.getElementById('status-depth');
    const statusQc = document.getElementById('status-qc');
    const statusFs = document.getElementById('status-fs');
    const statusRf = document.getElementById('status-rf');
    const statusSoil = document.getElementById('status-soil');
    const statusInfo = document.getElementById('status-info');

    // ============================================
    // RIBBON TAB SWITCHING (ribbon content only, no view switching)
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

        renderInfo(ds);
        renderTable(ds);
        renderSbtLegend(ds);
        updateStatusInfo();
    }

    function clearInfoPanel() {
        cptInfo.innerHTML = '';
        document.querySelector('#data-table thead').innerHTML = '';
        document.querySelector('#data-table tbody').innerHTML = '';
        sbtLegend.innerHTML = '';
        sbtDistBar.innerHTML = '';
    }

    // Close all
    document.getElementById('btn-close-all').addEventListener('click', () => {
        chartInstances.forEach((inst, i) => {
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
            statusSoil.textContent = '—';
            return;
        }
        statusDepth.textContent = info.depth !== null ? info.depth.toFixed(2) + ' m' : '—';
        statusQc.textContent = info.qc !== null && info.qc !== undefined ? info.qc.toFixed(3) + ' MPa' : '—';
        statusFs.textContent = info.fs !== null && info.fs !== undefined ? info.fs.toFixed(4) + ' MPa' : '—';
        statusRf.textContent = info.rf !== null && info.rf !== undefined ? info.rf.toFixed(1) + ' %' : '—';
        statusSoil.textContent = info.zone ? info.zone.name : '—';
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
        const displayCols = ds.columns.filter(c => ['length', 'depth', 'qc', 'fs', 'rf'].includes(c.key));

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

    // Initialize map immediately
    initMap();

    // Load area button
    document.getElementById('btn-load-area').addEventListener('click', () => {
        broMap.loadArea(msg => { mapStatus.textContent = msg; });
    });

    // Clear markers
    document.getElementById('btn-map-clear').addEventListener('click', () => {
        broMap.clearMarkers();
        mapStatus.textContent = 'Markers gewist';
    });

    /**
     * Load a CPT from BRO by its broId (e.g. CPT000000123456).
     */
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

    // Initial status
    statusInfo.textContent = 'Geen data geladen';
})();
