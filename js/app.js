/**
 * CPT Viewer — Main application logic
 */

(function () {
    const gefParser = new GefParser();
    const broParser = new BroXmlParser();
    const chart = new CptChart();

    // State
    const cptDataSets = [];
    let activeIndex = -1;

    // DOM elements
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const cptList = document.getElementById('cpt-list');
    const cptTabs = document.getElementById('cpt-tabs');
    const infoSection = document.getElementById('info-section');
    const cptInfo = document.getElementById('cpt-info');
    const chartSection = document.getElementById('chart-section');
    const tableSection = document.getElementById('table-section');

    // --- File handling ---

    dropZone.addEventListener('dragover', e => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        handleFiles(e.dataTransfer.files);
    });

    fileInput.addEventListener('change', e => {
        handleFiles(e.target.files);
        fileInput.value = '';
    });

    function handleFiles(fileList) {
        for (const file of fileList) {
            const name = file.name.toLowerCase();
            const isGef = name.endsWith('.gef');
            const isXml = name.endsWith('.xml');
            if (!isGef && !isXml) continue;

            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const result = isXml
                        ? broParser.parse(reader.result)
                        : gefParser.parse(reader.result);
                    result.fileName = file.name;
                    result.format = isXml ? 'BRO-XML' : 'GEF';
                    cptDataSets.push(result);
                    updateTabs();
                    selectCpt(cptDataSets.length - 1);
                } catch (err) {
                    alert(`Fout bij het lezen van ${file.name}:\n${err.message}`);
                    console.error(err);
                }
            };
            reader.readAsText(file, isXml ? 'utf-8' : 'iso-8859-1');
        }
    }

    // --- Tabs ---

    function updateTabs() {
        cptList.classList.remove('hidden');
        cptTabs.innerHTML = '';

        cptDataSets.forEach((ds, i) => {
            const tab = document.createElement('button');
            tab.className = 'cpt-tab' + (i === activeIndex ? ' active' : '');
            const label = ds.header.name || ds.fileName;
            tab.textContent = ds.format ? `${label} (${ds.format})` : label;
            tab.addEventListener('click', () => selectCpt(i));
            cptTabs.appendChild(tab);
        });
    }

    function selectCpt(index) {
        activeIndex = index;
        const ds = cptDataSets[index];

        updateTabs();
        renderInfo(ds);
        chart.render(ds.data, ds.columns);
        renderTable(ds);

        infoSection.classList.remove('hidden');
        chartSection.classList.remove('hidden');
        tableSection.classList.remove('hidden');
    }

    // --- Info panel ---

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
        if (meta.x && meta.y) items.push(['Coördinaten (RD)', `X: ${meta.x}  Y: ${meta.y}`]);
        if (meta.lat && meta.lon) items.push(['Coördinaten (WGS84)', `${meta.lat}, ${meta.lon}`]);

        const depths = ds.data.map(r => r.length || r.depth || 0).filter(v => v !== null && v !== 0);
        const maxDepth = depths.length > 0 ? Math.max(...depths) : 0;
        if (meta.finalDepth) {
            items.push(['Einddiepte', `${meta.finalDepth} m`]);
        } else {
            items.push(['Sondeerlengte', `${maxDepth.toFixed(2)} m`]);
        }
        items.push(['Meetpunten', `${ds.data.length}`]);

        cptInfo.innerHTML = items.map(([label, value]) => `
            <div class="info-item">
                <div class="label">${label}</div>
                <div class="value">${value}</div>
            </div>
        `).join('');
    }

    // --- Data table ---

    function renderTable(ds) {
        const thead = document.querySelector('#data-table thead');
        const tbody = document.querySelector('#data-table tbody');

        const displayCols = ds.columns.filter(c =>
            ['length', 'depth', 'qc', 'fs', 'rf', 'u2'].includes(c.key)
        );

        thead.innerHTML = '<tr>' + displayCols.map(c =>
            `<th>${c.label}<br><small>${c.unit}</small></th>`
        ).join('') + '</tr>';

        const maxRows = 500;
        const rows = ds.data.slice(0, maxRows);

        tbody.innerHTML = rows.map(row =>
            '<tr>' + displayCols.map(c => {
                const v = row[c.key];
                return `<td>${v !== null && v !== undefined ? v.toFixed(4) : '—'}</td>`;
            }).join('') + '</tr>'
        ).join('');

        if (ds.data.length > maxRows) {
            tbody.innerHTML += `<tr><td colspan="${displayCols.length}" style="text-align:center;color:var(--color-text-muted)">
                ... ${ds.data.length - maxRows} rijen niet getoond
            </td></tr>`;
        }
    }
})();
