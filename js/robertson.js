/**
 * Robertson (1990) Soil Behaviour Type Classification
 *
 * Simplified classification based on raw qc (MPa) and Rf (%)
 * without effective stress correction — common in Dutch geotechnical practice.
 */

const ROBERTSON_ZONES = [
    { zone: 1, name: 'Gevoelig fijnkorrelig',  color: '#00BCD4' },
    { zone: 2, name: 'Organisch / veen',        color: '#795548' },
    { zone: 3, name: 'Klei',                    color: '#4CAF50' },
    { zone: 4, name: 'Silt mengsels',           color: '#8BC34A' },
    { zone: 5, name: 'Zand mengsels',           color: '#FFC107' },
    { zone: 6, name: 'Zand',                    color: '#FF9800' },
    { zone: 7, name: 'Grof zand / grind',       color: '#FF5722' },
    { zone: 8, name: 'Zeer vast zand/klei',     color: '#F44336' },
    { zone: 9, name: 'Zeer vast fijnkorrelig',  color: '#9C27B0' },
];

class Robertson {
    /**
     * Classify a single measurement point.
     * @param {number} qc - Cone resistance in MPa
     * @param {number} rf - Friction ratio in %
     * @returns {object} Zone object { zone, name, color }
     */
    static classify(qc, rf) {
        if (qc === null || qc === undefined || rf === null || rf === undefined) {
            return null;
        }
        if (qc <= 0 || rf < 0) return null;

        // Simplified decision tree based on qc (MPa) and Rf (%)
        // Common Dutch practice approximation of Robertson 1990 SBTn chart

        if (qc > 25) {
            // Very high resistance
            if (rf < 1) return ROBERTSON_ZONES[6]; // Zone 7: Grof zand/grind
            return ROBERTSON_ZONES[7]; // Zone 8: Zeer vast zand/klei
        }

        if (qc > 10) {
            if (rf < 0.5) return ROBERTSON_ZONES[6]; // Zone 7: Grof zand/grind
            if (rf < 1.5) return ROBERTSON_ZONES[5]; // Zone 6: Zand
            if (rf < 3) return ROBERTSON_ZONES[4];   // Zone 5: Zand mengsels
            return ROBERTSON_ZONES[7];                // Zone 8: Zeer vast zand/klei
        }

        if (qc > 5) {
            if (rf < 1) return ROBERTSON_ZONES[5];   // Zone 6: Zand
            if (rf < 2) return ROBERTSON_ZONES[4];   // Zone 5: Zand mengsels
            if (rf < 4) return ROBERTSON_ZONES[3];   // Zone 4: Silt mengsels
            if (rf < 6) return ROBERTSON_ZONES[2];   // Zone 3: Klei
            return ROBERTSON_ZONES[8];                // Zone 9: Zeer vast fijnkorrelig
        }

        if (qc > 2) {
            if (rf < 1) return ROBERTSON_ZONES[4];   // Zone 5: Zand mengsels
            if (rf < 2.5) return ROBERTSON_ZONES[3]; // Zone 4: Silt mengsels
            if (rf < 5) return ROBERTSON_ZONES[2];   // Zone 3: Klei
            if (rf < 8) return ROBERTSON_ZONES[1];   // Zone 2: Organisch/veen
            return ROBERTSON_ZONES[0];                // Zone 1: Gevoelig fijnkorrelig
        }

        if (qc > 0.5) {
            if (rf < 1.5) return ROBERTSON_ZONES[3]; // Zone 4: Silt mengsels
            if (rf < 4) return ROBERTSON_ZONES[2];   // Zone 3: Klei
            if (rf < 8) return ROBERTSON_ZONES[1];   // Zone 2: Organisch/veen
            return ROBERTSON_ZONES[0];                // Zone 1: Gevoelig fijnkorrelig
        }

        // Very low qc
        if (rf < 5) return ROBERTSON_ZONES[2];       // Zone 3: Klei
        if (rf < 10) return ROBERTSON_ZONES[1];      // Zone 2: Organisch/veen
        return ROBERTSON_ZONES[0];                    // Zone 1: Gevoelig fijnkorrelig
    }

    /**
     * Classify an entire dataset.
     * @param {Array} data - Array of { depth, qc, rf, ... } objects
     * @returns {Array} Array of { depth, zone } where zone is the Robertson zone object
     */
    static classifyDataset(data) {
        return data
            .filter(row => {
                const d = row.depth !== undefined ? row.depth : row.length;
                return d !== null && d !== undefined;
            })
            .map(row => {
                const depth = row.depth !== undefined ? Math.abs(row.depth) : row.length;
                return {
                    depth,
                    zone: Robertson.classify(row.qc, row.rf),
                };
            });
    }

    /**
     * Merge classified points into continuous soil layers.
     * Adjacent points with the same zone are merged. Layers thinner
     * than minThickness are absorbed into adjacent thicker layers.
     *
     * @param {Array} classifications - Output from classifyDataset
     * @param {number} [minThickness=0.2] - Minimum layer thickness in meters
     * @returns {Array} Array of { startDepth, endDepth, zone }
     */
    static mergeLayers(classifications, minThickness = 0.2) {
        if (!classifications || classifications.length === 0) return [];

        // Filter out unclassified points
        const valid = classifications.filter(c => c.zone !== null);
        if (valid.length === 0) return [];

        // Sort by depth
        valid.sort((a, b) => a.depth - b.depth);

        // Build raw layers by merging consecutive same-zone points
        const layers = [];
        let current = {
            startDepth: valid[0].depth,
            endDepth: valid[0].depth,
            zone: valid[0].zone,
        };

        for (let i = 1; i < valid.length; i++) {
            if (valid[i].zone.zone === current.zone.zone) {
                current.endDepth = valid[i].depth;
            } else {
                layers.push({ ...current });
                current = {
                    startDepth: valid[i].depth,
                    endDepth: valid[i].depth,
                    zone: valid[i].zone,
                };
            }
        }
        layers.push({ ...current });

        // Remove thin layers by merging them into the previous layer
        if (minThickness > 0 && layers.length > 1) {
            const merged = [layers[0]];
            for (let i = 1; i < layers.length; i++) {
                const thickness = layers[i].endDepth - layers[i].startDepth;
                if (thickness < minThickness && merged.length > 0) {
                    // Absorb into previous layer
                    merged[merged.length - 1].endDepth = layers[i].endDepth;
                } else {
                    merged.push(layers[i]);
                }
            }
            return merged;
        }

        return layers;
    }

    /**
     * Get all zone definitions.
     * @returns {Array} The 9 Robertson zones
     */
    static get zones() {
        return ROBERTSON_ZONES;
    }

    /**
     * Compute distribution percentages for each zone in a layer set.
     * @param {Array} layers - Output from mergeLayers
     * @returns {Array} Array of { zone, thickness, percentage } sorted by percentage desc
     */
    static computeDistribution(layers) {
        if (!layers || layers.length === 0) return [];

        const totals = {};
        let totalThickness = 0;

        for (const layer of layers) {
            const t = layer.endDepth - layer.startDepth;
            if (t <= 0) continue;
            const z = layer.zone.zone;
            totals[z] = (totals[z] || 0) + t;
            totalThickness += t;
        }

        if (totalThickness === 0) return [];

        return ROBERTSON_ZONES
            .map(z => ({
                zone: z,
                thickness: totals[z.zone] || 0,
                percentage: ((totals[z.zone] || 0) / totalThickness) * 100,
            }))
            .filter(d => d.percentage > 0)
            .sort((a, b) => b.percentage - a.percentage);
    }
}
