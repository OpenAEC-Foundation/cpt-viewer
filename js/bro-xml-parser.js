/**
 * BRO (Basisregistratie Ondergrond) XML Parser for CPT data.
 *
 * Parses BRO CPT dispatchDataResponse XML files containing CPT_O or CPT_O_DP
 * documents with SWE DataArray encoded measurement data.
 *
 * The BRO XML format uses a fixed 25-column order for measurement data,
 * with -999999 as the null/void value.
 */

// Fixed 25-column order as defined by the BRO CPT standard
const BRO_COLUMN_ORDER = [
    { key: 'length',              label: 'Sondeerlengte',              unit: 'm',      paramTag: 'penetrationLength' },
    { key: 'depth',               label: 'Diepte',                     unit: 'm',      paramTag: 'depth' },
    { key: 'elapsedTime',         label: 'Verstreken tijd',            unit: 's',      paramTag: 'elapsedTime' },
    { key: 'qc',                  label: 'Conusweerstand',             unit: 'MPa',    paramTag: 'coneResistance' },
    { key: 'corrected_qc',        label: 'Gecorr. conusweerstand',     unit: 'MPa',    paramTag: 'correctedConeResistance' },
    { key: 'net_qc',              label: 'Netto conusweerstand',       unit: 'MPa',    paramTag: 'netConeResistance' },
    { key: 'mag_x',               label: 'Magnetisch veld X',          unit: 'nT',     paramTag: 'magneticFieldStrengthX' },
    { key: 'mag_y',               label: 'Magnetisch veld Y',          unit: 'nT',     paramTag: 'magneticFieldStrengthY' },
    { key: 'mag_z',               label: 'Magnetisch veld Z',          unit: 'nT',     paramTag: 'magneticFieldStrengthZ' },
    { key: 'mag_total',           label: 'Magnetisch veld totaal',     unit: 'nT',     paramTag: 'magneticFieldStrengthTotal' },
    { key: 'electric_cond',       label: 'Elektrische geleidbaarheid', unit: 'S/m',    paramTag: 'electricalConductivity' },
    { key: 'incl_ew',             label: 'Inclinatie O-W',             unit: 'graden', paramTag: 'inclinationEW' },
    { key: 'incl_ns',             label: 'Inclinatie N-Z',             unit: 'graden', paramTag: 'inclinationNS' },
    { key: 'incl_x',              label: 'Inclinatie X',               unit: 'graden', paramTag: 'inclinationX' },
    { key: 'incl_y',              label: 'Inclinatie Y',               unit: 'graden', paramTag: 'inclinationY' },
    { key: 'inclination',         label: 'Inclinatie resultant',       unit: 'graden', paramTag: 'inclinationResultant' },
    { key: 'mag_inclination',     label: 'Magnetische inclinatie',     unit: 'graden', paramTag: 'magneticInclination' },
    { key: 'mag_declination',     label: 'Magnetische declinatie',     unit: 'graden', paramTag: 'magneticDeclination' },
    { key: 'fs',                  label: 'Plaatselijke wrijving',      unit: 'MPa',    paramTag: 'localFriction' },
    { key: 'pore_ratio',          label: 'Poriënratio',                unit: '-',      paramTag: 'poreRatio' },
    { key: 'temp',                label: 'Temperatuur',                unit: '°C',     paramTag: 'temperature' },
    { key: 'u1',                  label: 'Waterspanning u1',           unit: 'MPa',    paramTag: 'porePressureU1' },
    { key: 'u2',                  label: 'Waterspanning u2',           unit: 'MPa',    paramTag: 'porePressureU2' },
    { key: 'u3',                  label: 'Waterspanning u3',           unit: 'MPa',    paramTag: 'porePressureU3' },
    { key: 'rf',                  label: 'Wrijvingsgetal',             unit: '%',      paramTag: 'frictionRatio' },
];

const BRO_VOID_VALUE = -999999;

class BroXmlParser {
    parse(xmlText) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlText, 'application/xml');

        const parseError = doc.querySelector('parsererror');
        if (parseError) {
            throw new Error('Ongeldig XML-bestand: ' + parseError.textContent.substring(0, 200));
        }

        // Find the CPT object (CPT_O or CPT_O_DP)
        const cptObj = doc.querySelector('CPT_O, CPT_O_DP');
        if (!cptObj) {
            throw new Error('Geen CPT_O of CPT_O_DP element gevonden in XML');
        }

        // Extract metadata
        const header = this._extractMetadata(doc, cptObj);

        // Parse parameters to determine active columns
        const activeColumns = this._parseParameters(cptObj);

        // Parse measurement data
        const { data, columns } = this._parseData(cptObj, activeColumns);

        // Compute friction ratio if not present
        this._computeDerived(data, columns);

        return { header, columns, data };
    }

    _extractMetadata(doc, cptObj) {
        const meta = {};

        meta.testId = this._getText(cptObj, 'broId') || '';
        meta.name = meta.testId;

        meta.qualityRegime = this._getText(cptObj, 'qualityRegime') || '';

        // Report date
        const reportDate = cptObj.querySelector('researchReportDate');
        if (reportDate) {
            meta.date = this._getText(reportDate, 'date') || '';
        }

        // CPT standard
        meta.cptStandard = this._getText(cptObj, 'cptStandard') || '';

        // Location - standardized (WGS84)
        const stdLoc = cptObj.querySelector('standardizedLocation');
        if (stdLoc) {
            const pos = this._getText(stdLoc, 'pos');
            if (pos) {
                const [lat, lon] = pos.trim().split(/\s+/);
                meta.lat = lat;
                meta.lon = lon;
            }
        }

        // Location - delivered (RD)
        const delLoc = cptObj.querySelector('deliveredLocation');
        if (delLoc) {
            const pos = delLoc.querySelector('pos');
            if (pos) {
                const [x, y] = pos.textContent.trim().split(/\s+/);
                meta.x = x;
                meta.y = y;
            }
        }

        // Vertical position
        const vertPos = cptObj.querySelector('deliveredVerticalPosition');
        if (vertPos) {
            const offset = this._getText(vertPos, 'offset');
            const datum = this._getText(vertPos, 'verticalDatum');
            if (offset) {
                meta.surfaceLevel = `${offset} m ${datum || 'NAP'}`;
            }
        }

        // Trajectory
        const trajectory = cptObj.querySelector('trajectory');
        if (trajectory) {
            meta.predrilledDepth = this._getText(trajectory, 'predrilledDepth');
            meta.finalDepth = this._getText(trajectory, 'finalDepth');
        }

        // Quality class
        const survey = cptObj.querySelector('conePenetrometerSurvey');
        if (survey) {
            meta.qualityClass = this._getText(survey, 'qualityClass') || '';
            meta.cptMethod = this._getText(survey, 'cptMethod') || '';
        }

        // Company
        meta.company = this._getText(cptObj, 'deliveryAccountableParty') || '';

        return meta;
    }

    _parseParameters(cptObj) {
        const paramsEl = cptObj.querySelector('parameters');
        if (!paramsEl) {
            // If no parameters element, assume all 25 columns are present
            return BRO_COLUMN_ORDER.map(() => true);
        }

        return BRO_COLUMN_ORDER.map(col => {
            const el = paramsEl.querySelector(col.paramTag);
            return el ? el.textContent.trim().toLowerCase() === 'ja' : false;
        });
    }

    _parseData(cptObj, activeColumns) {
        // Find the cptResult values element
        const valuesEl = cptObj.querySelector('values');
        if (!valuesEl) {
            throw new Error('Geen meetdata (cptcommon:values) gevonden in XML');
        }

        // Determine separators from TextEncoding
        let tokenSep = ',';
        let blockSep = ';';
        const encoding = cptObj.querySelector('TextEncoding');
        if (encoding) {
            tokenSep = encoding.getAttribute('tokenSeparator') || ',';
            blockSep = encoding.getAttribute('blockSeparator') || ';';
        }

        // Build column map for active columns only
        const columns = [];
        for (let i = 0; i < BRO_COLUMN_ORDER.length; i++) {
            if (activeColumns[i]) {
                columns.push({
                    index: i,
                    key: BRO_COLUMN_ORDER[i].key,
                    label: BRO_COLUMN_ORDER[i].label,
                    unit: BRO_COLUMN_ORDER[i].unit,
                });
            }
        }

        // Parse data rows
        const rawText = valuesEl.textContent.trim();
        const blocks = rawText.split(blockSep).filter(b => b.trim());
        const data = [];

        for (const block of blocks) {
            const tokens = block.trim().split(tokenSep);
            if (tokens.length < 25) continue;

            const row = {};
            for (let i = 0; i < 25; i++) {
                const val = parseFloat(tokens[i]);
                const colDef = BRO_COLUMN_ORDER[i];

                if (isNaN(val) || val === BRO_VOID_VALUE) {
                    row[colDef.key] = null;
                } else {
                    row[colDef.key] = val;
                }
            }
            data.push(row);
        }

        return { data, columns };
    }

    _computeDerived(data, columns) {
        const hasKey = key => columns.some(c => c.key === key);

        // Compute friction ratio if missing
        if (!hasKey('rf') && hasKey('qc') && hasKey('fs')) {
            for (const row of data) {
                if (row.qc !== null && row.fs !== null && row.qc !== 0) {
                    row.rf = (row.fs / row.qc) * 100;
                } else {
                    row.rf = null;
                }
            }
            columns.push({ key: 'rf', label: 'Wrijvingsgetal (berekend)', unit: '%', computed: true });
        }
    }

    _getText(parent, localName) {
        // Search for element by local name (ignoring namespace prefix)
        const els = parent.getElementsByTagName('*');
        for (const el of els) {
            if (el.localName === localName) {
                return el.textContent.trim();
            }
        }
        return null;
    }
}
