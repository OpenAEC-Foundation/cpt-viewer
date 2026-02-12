/**
 * GEF (Geotechnical Exchange Format) Parser
 *
 * Parses GEF files commonly used in Dutch geotechnical practice for CPT data.
 * Supports GEF version 1.x with standard column definitions.
 */

const GEF_COLUMN_TYPES = {
    1:  { key: 'length',       label: 'Sondeerlengte',         unit: 'm' },
    2:  { key: 'qc',           label: 'Conusweerstand',        unit: 'MPa' },
    3:  { key: 'fs',           label: 'Plaatselijke wrijving', unit: 'MPa' },
    4:  { key: 'rf',           label: 'Wrijvingsgetal',        unit: '%' },
    5:  { key: 'u1',           label: 'Waterspanning u1',      unit: 'MPa' },
    6:  { key: 'u2',           label: 'Waterspanning u2',      unit: 'MPa' },
    7:  { key: 'u3',           label: 'Waterspanning u3',      unit: 'MPa' },
    8:  { key: 'inclination',  label: 'Inclinatie resultant',  unit: 'graden' },
    9:  { key: 'incl_ns',      label: 'Inclinatie N-Z',        unit: 'graden' },
    10: { key: 'incl_ew',      label: 'Inclinatie O-W',        unit: 'graden' },
    11: { key: 'depth',        label: 'Diepte',                unit: 'm NAP' },
    12: { key: 'time',         label: 'Tijd',                  unit: 's' },
    13: { key: 'corrected_qc', label: 'Gecorr. conusweerstand',unit: 'MPa' },
    14: { key: 'net_qc',       label: 'Netto conusweerstand',  unit: 'MPa' },
    15: { key: 'pore_ratio',   label: 'Poriënratio',           unit: '-' },
    20: { key: 'speed',        label: 'Sondeersnelheid',       unit: 'mm/s' },
    21: { key: 'temp',         label: 'Temperatuur',           unit: '°C' },
    23: { key: 'electric_cond',label: 'Elektrische geleidbaarheid', unit: 'S/m' },
    39: { key: 'friction_total',label: 'Totale wrijving',      unit: 'kN' },
};

class GefParser {
    parse(text) {
        const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        const header = {};
        const columns = [];
        let dataStartIndex = -1;

        // Parse header
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            if (line === '#EOH=' || line === '#EOH') {
                dataStartIndex = i + 1;
                break;
            }

            const match = line.match(/^#(\w+)\s*=\s*(.*)/);
            if (!match) continue;

            const keyword = match[1].toUpperCase();
            const value = match[2].trim();

            this._parseHeaderLine(header, columns, keyword, value);
        }

        if (dataStartIndex === -1) {
            throw new Error('Geen #EOH gevonden — ongeldig GEF-bestand');
        }

        // Build column mapping
        const columnMap = this._buildColumnMap(columns, header);

        // Parse data rows
        const separator = this._detectSeparator(header);
        const data = this._parseData(lines, dataStartIndex, separator, columnMap, header);

        // Compute derived columns if missing
        this._computeDerived(data, columnMap);

        return {
            header: this._extractMetadata(header),
            columns: columnMap,
            data,
        };
    }

    _parseHeaderLine(header, columns, keyword, value) {
        if (keyword === 'COLUMNINFO') {
            const parts = value.split(',').map(s => s.trim());
            if (parts.length >= 3) {
                const colIndex = parseInt(parts[0], 10) - 1;
                const unit = parts[1];
                const colName = parts[2];
                const colType = parts.length >= 4 ? parseInt(parts[3], 10) : null;
                columns[colIndex] = { unit, name: colName, type: colType };
            }
        } else if (keyword === 'COLUMNSEPARATOR') {
            header.COLUMNSEPARATOR = value;
        } else if (keyword === 'RECORDSEPARATOR') {
            header.RECORDSEPARATOR = value;
        } else if (keyword === 'COLUMNVOID') {
            const parts = value.split(',').map(s => s.trim());
            if (parts.length >= 2) {
                if (!header.COLUMNVOID) header.COLUMNVOID = {};
                header.COLUMNVOID[parseInt(parts[0], 10) - 1] = parseFloat(parts[1]);
            }
        } else if (keyword.startsWith('COLUMN')) {
            // Store raw for reference
            if (!header._columns) header._columns = [];
            header._columns.push({ keyword, value });
        } else {
            header[keyword] = value;
        }

        header._rawColumns = columns;
    }

    _buildColumnMap(columns, header) {
        const map = [];
        for (let i = 0; i < columns.length; i++) {
            const col = columns[i];
            if (!col) continue;

            const typeInfo = col.type ? GEF_COLUMN_TYPES[col.type] : null;
            map.push({
                index: i,
                key: typeInfo ? typeInfo.key : `col_${i + 1}`,
                label: typeInfo ? typeInfo.label : col.name,
                unit: col.unit || (typeInfo ? typeInfo.unit : ''),
                type: col.type,
                voidValue: header.COLUMNVOID ? header.COLUMNVOID[i] : undefined,
            });
        }
        return map;
    }

    _detectSeparator(header) {
        if (header.COLUMNSEPARATOR) {
            const sep = header.COLUMNSEPARATOR;
            if (sep === ';') return /;/;
            if (sep === ',') return /,/;
            if (sep === '|') return /\|/;
            return new RegExp(sep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        }
        return /\s+/;  // default: whitespace
    }

    _parseData(lines, startIndex, separator, columnMap, header) {
        const rows = [];
        const numCols = columnMap.length;

        for (let i = startIndex; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line.startsWith('#') || line.startsWith('!')) continue;

            const parts = line.split(separator).map(s => s.trim()).filter(s => s !== '');
            if (parts.length < numCols) continue;

            const row = {};
            for (const col of columnMap) {
                let val = parseFloat(parts[col.index]);
                if (isNaN(val)) { row[col.key] = null; continue; }
                if (col.voidValue !== undefined && val === col.voidValue) { row[col.key] = null; continue; }
                row[col.key] = val;
            }
            rows.push(row);
        }

        return rows;
    }

    _computeDerived(data, columnMap) {
        const hasKey = key => columnMap.some(c => c.key === key);

        // Compute depth from length if depth column not present
        if (!hasKey('depth') && hasKey('length')) {
            for (const row of data) {
                if (row.length !== null) {
                    row.depth = -row.length;  // depth as negative (below surface)
                }
            }
            columnMap.push({ key: 'depth', label: 'Diepte (berekend)', unit: 'm', computed: true });
        }

        // Compute friction ratio if missing
        if (!hasKey('rf') && hasKey('qc') && hasKey('fs')) {
            for (const row of data) {
                if (row.qc !== null && row.fs !== null && row.qc !== 0) {
                    row.rf = (row.fs / row.qc) * 100;
                } else {
                    row.rf = null;
                }
            }
            columnMap.push({ key: 'rf', label: 'Wrijvingsgetal (berekend)', unit: '%', computed: true });
        }
    }

    _extractMetadata(header) {
        const meta = {};

        if (header.TESTID) meta.testId = header.TESTID;
        if (header.PROJECTID) meta.projectId = header.PROJECTID;
        if (header.PROJECTNAME) meta.projectName = header.PROJECTNAME;
        if (header.COMPANYID) meta.company = header.COMPANYID;
        if (header.STARTDATE) {
            const parts = header.STARTDATE.split(',').map(s => s.trim());
            if (parts.length >= 3) {
                meta.date = `${parts[2].padStart(2, '0')}-${parts[1].padStart(2, '0')}-${parts[0]}`;
            }
        }
        if (header.ZID) {
            const parts = header.ZID.split(',').map(s => s.trim());
            meta.surfaceLevel = parts.length >= 2 ? `${parts[1]} m NAP` : header.ZID;
        }
        if (header.XYID) {
            const parts = header.XYID.split(',').map(s => s.trim());
            if (parts.length >= 3) {
                meta.x = parts[1];
                meta.y = parts[2];
                meta.coordSystem = parts[0];
            }
        }
        if (header.MEASUREMENTVAR) meta.measurementVar = header.MEASUREMENTVAR;
        if (header.GEFID) meta.gefVersion = header.GEFID;
        if (header.FILEOWNER) meta.fileOwner = header.FILEOWNER;

        meta.name = meta.testId || meta.projectId || 'Onbekend';

        return meta;
    }
}
