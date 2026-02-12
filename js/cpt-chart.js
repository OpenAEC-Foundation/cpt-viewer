/**
 * CPT Chart — renders Chart.js charts for CPT data.
 * Charts are plotted with depth on the Y-axis (inverted) and measured values on X.
 */

class CptChart {
    constructor() {
        this.charts = {};
    }

    /**
     * Render all four standard CPT charts.
     */
    render(data, columns) {
        this.destroy();

        const depthKey = this._findKey(columns, ['depth', 'length']);
        const depths = data.map(r => {
            const v = r[depthKey];
            // If using 'length', show as positive depth below surface
            return depthKey === 'length' ? v : (v !== null ? Math.abs(v) : null);
        });

        this._renderSingle('chart-qc', depths, data, columns, 'qc', {
            color: getComputedStyle(document.documentElement).getPropertyValue('--color-qc').trim(),
            label: 'qc (MPa)',
        });

        this._renderSingle('chart-fs', depths, data, columns, 'fs', {
            color: getComputedStyle(document.documentElement).getPropertyValue('--color-fs').trim(),
            label: 'fs (MPa)',
        });

        this._renderSingle('chart-rf', depths, data, columns, 'rf', {
            color: getComputedStyle(document.documentElement).getPropertyValue('--color-rf').trim(),
            label: 'Rf (%)',
        });

        this._renderSingle('chart-u2', depths, data, columns, 'u2', {
            color: getComputedStyle(document.documentElement).getPropertyValue('--color-u2').trim(),
            label: 'u2 (MPa)',
        });
    }

    _findKey(columns, candidates) {
        for (const key of candidates) {
            if (columns.some(c => c.key === key)) return key;
        }
        return candidates[0];
    }

    _renderSingle(canvasId, depths, data, columns, key, opts) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const hasData = columns.some(c => c.key === key) && data.some(r => r[key] !== null && r[key] !== undefined);
        const wrapper = canvas.closest('.chart-wrapper');

        if (!hasData) {
            if (wrapper) wrapper.style.opacity = '0.3';
            return;
        }
        if (wrapper) wrapper.style.opacity = '1';

        const values = data.map(r => r[key]);
        const points = [];
        for (let i = 0; i < depths.length; i++) {
            if (values[i] !== null && values[i] !== undefined && depths[i] !== null) {
                points.push({ x: values[i], y: depths[i] });
            }
        }

        this.charts[canvasId] = new Chart(canvas, {
            type: 'scatter',
            data: {
                datasets: [{
                    label: opts.label,
                    data: points,
                    showLine: true,
                    borderColor: opts.color,
                    borderWidth: 1.5,
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    fill: false,
                    tension: 0,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                scales: {
                    y: {
                        reverse: true,
                        title: { display: true, text: 'Diepte (m)', font: { size: 11 } },
                        grid: { color: '#e2e8f010' },
                    },
                    x: {
                        position: 'top',
                        title: { display: true, text: opts.label, font: { size: 11 } },
                        beginAtZero: true,
                        grid: { color: '#e2e8f040' },
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => `${opts.label}: ${ctx.parsed.x.toFixed(3)} @ ${ctx.parsed.y.toFixed(2)} m`
                        }
                    }
                },
                animation: { duration: 300 },
            }
        });

        // Force proper height
        canvas.parentElement.style.height = '550px';
    }

    destroy() {
        for (const key in this.charts) {
            if (this.charts[key]) {
                this.charts[key].destroy();
                delete this.charts[key];
            }
        }
    }
}
