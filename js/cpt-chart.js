/**
 * CPT Chart — Professional Dutch CPT plot renderer
 *
 * Layout (left to right):
 *   [Depth axis] [Soil strip] [qc panel] [fs panel] [Rf panel]
 *
 * Each parameter gets its own panel with proper scale.
 * Soil strip shows Robertson SBT as solid colored bands.
 * All panels share the Y-axis (depth, increasing downward).
 */

class CptChart {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.dpr = window.devicePixelRatio || 1;

        this.data = null;
        this.columns = null;
        this.layers = null;
        this.depths = null;

        // Depth viewport
        this.depthMin = 0;
        this.depthMax = 30;
        this.depthViewMin = 0;
        this.depthViewMax = 30;

        // Scale ranges (auto-computed)
        this.qcMax = 30;
        this.fsMax = 0.3;
        this.rfMax = 10;

        // Interaction
        this.hoverY = null;
        this.isPanning = false;
        this.panStartY = 0;
        this.panStartDepthMin = 0;
        this.panStartDepthMax = 0;
        this.onHover = null;

        // Style
        this.COLORS = {
            bg:         '#0d1117',
            panelBg:    '#0f1318',
            grid:       'rgba(255,255,255,0.05)',
            gridMajor:  'rgba(255,255,255,0.10)',
            border:     'rgba(255,255,255,0.08)',
            text:       '#6e7681',
            textBright: '#8b949e',
            headerBg:   '#161b22',
            crosshair:  'rgba(255,255,255,0.25)',
            depthLabel: '#e6edf3',
            qc:         '#3b82f6',
            fs:         '#ef4444',
            rf:         '#22c55e',
        };

        this._bindEvents();
    }

    _bindEvents() {
        this.canvas.addEventListener('mousemove', e => this._onMouseMove(e));
        this.canvas.addEventListener('mouseleave', () => this._onMouseLeave());
        this.canvas.addEventListener('wheel', e => this._onWheel(e), { passive: false });
        this.canvas.addEventListener('mousedown', e => this._onMouseDown(e));
        this.canvas.addEventListener('mouseup', () => this._onMouseUp());
        window.addEventListener('mouseup', () => this._onMouseUp());
    }

    resize() {
        const p = this.canvas.parentElement;
        if (!p) return;
        const r = p.getBoundingClientRect();
        const w = Math.floor(r.width);
        const h = Math.floor(r.height);
        if (w < 10 || h < 10) return;
        this.dpr = window.devicePixelRatio || 1;
        this.canvas.width = w * this.dpr;
        this.canvas.height = h * this.dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.W = w;
        this.H = h;
        this.draw();
    }

    setData(data, columns, layers) {
        this.data = data;
        this.columns = columns;
        this.layers = layers;

        const hasDepth = columns.some(c => c.key === 'depth');
        this.depths = data.map(r => {
            const v = hasDepth ? r.depth : r.length;
            return v != null ? Math.abs(v) : null;
        });

        const valid = this.depths.filter(d => d !== null);
        this.depthMin = 0;
        this.depthMax = valid.length ? Math.ceil(Math.max(...valid) * 1.02 + 0.5) : 30;

        const vals = k => data.map(r => r[k]).filter(v => v != null && v > 0);
        this.qcMax = this._niceMax(Math.max(0.1, ...vals('qc')));
        this.fsMax = this._niceMax(Math.max(0.01, ...vals('fs')));
        this.rfMax = this._niceMax(Math.max(1, ...vals('rf')));

        this.depthViewMin = this.depthMin;
        this.depthViewMax = this.depthMax;
        this.resize();
    }

    _niceMax(v) {
        if (v <= 0) return 1;
        const p = Math.pow(10, Math.floor(Math.log10(v)));
        const n = v / p;
        if (n <= 1.0) return p;
        if (n <= 1.5) return 1.5 * p;
        if (n <= 2.0) return 2 * p;
        if (n <= 3.0) return 3 * p;
        if (n <= 5.0) return 5 * p;
        return 10 * p;
    }

    // ---- Layout ----

    _layout() {
        const w = this.W, h = this.H;
        const narrow = w < 280;

        const HEADER = 28;            // Scale labels area at top
        const BOTTOM = 4;
        const DEPTH_W = narrow ? 30 : 42;  // Depth axis column
        const SOIL_W = narrow ? 14 : 22;    // Soil type strip
        const GAP = 1;

        const plotT = HEADER;
        const plotB = h - BOTTOM;
        const plotH = plotB - plotT;

        // Remaining width for 3 data panels
        const avail = w - DEPTH_W - SOIL_W - GAP * 4;
        // qc gets 45%, fs 25%, Rf 30%
        const qcW = Math.floor(avail * 0.45);
        const fsW = Math.floor(avail * 0.25);
        const rfW = avail - qcW - fsW;

        let x = DEPTH_W;
        const soilL = x; x += SOIL_W + GAP;
        const qcL   = x; x += qcW + GAP;
        const fsL   = x; x += fsW + GAP;
        const rfL   = x;

        return {
            plotT, plotB, plotH, narrow,
            depthW: DEPTH_W, headerH: HEADER,
            soil: { l: soilL, w: SOIL_W },
            qc:   { l: qcL,   w: qcW },
            fs:   { l: fsL,   w: fsW },
            rf:   { l: rfL,   w: rfW },
        };
    }

    _d2y(d, L) { return L.plotT + ((d - this.depthViewMin) / (this.depthViewMax - this.depthViewMin)) * L.plotH; }
    _y2d(y, L) { return this.depthViewMin + ((y - L.plotT) / L.plotH) * (this.depthViewMax - this.depthViewMin); }

    // ---- Drawing ----

    draw() {
        if (!this.W || !this.H) return;
        const c = this.ctx;
        c.save();
        c.scale(this.dpr, this.dpr);
        c.fillStyle = this.COLORS.bg;
        c.fillRect(0, 0, this.W, this.H);

        const L = this._layout();

        // Header background
        c.fillStyle = this.COLORS.headerBg;
        c.fillRect(0, 0, this.W, L.headerH);

        // Panel backgrounds
        c.fillStyle = this.COLORS.panelBg;
        c.fillRect(L.soil.l, L.plotT, L.soil.w, L.plotH);
        c.fillRect(L.qc.l,   L.plotT, L.qc.w,   L.plotH);
        c.fillRect(L.fs.l,   L.plotT, L.fs.w,   L.plotH);
        c.fillRect(L.rf.l,   L.plotT, L.rf.w,   L.plotH);

        if (this.data) {
            this._drawSoilStrip(c, L);
        }

        this._drawGridH(c, L);
        this._drawGridV(c, L, L.qc, this.qcMax);
        this._drawGridV(c, L, L.fs, this.fsMax);
        this._drawGridV(c, L, L.rf, this.rfMax);
        this._drawDepthAxis(c, L);
        this._drawPanelHeader(c, L, L.soil, 'SBT', this.COLORS.textBright, null, null);
        this._drawPanelHeader(c, L, L.qc, 'qc (MPa)', this.COLORS.qc, this.qcMax, null);
        this._drawPanelHeader(c, L, L.fs, 'fs (MPa)', this.COLORS.fs, this.fsMax, null);
        this._drawPanelHeader(c, L, L.rf, 'Rf (%)', this.COLORS.rf, this.rfMax, null);

        if (this.data) {
            this._drawLine(c, L, L.qc, 'qc', this.qcMax, this.COLORS.qc, 1.8);
            this._drawLine(c, L, L.fs, 'fs', this.fsMax, this.COLORS.fs, 1.4);
            this._drawLine(c, L, L.rf, 'rf', this.rfMax, this.COLORS.rf, 1.4);
            this._drawCrosshair(c, L);
        }

        // Panel borders
        this._panelBorder(c, L, L.soil);
        this._panelBorder(c, L, L.qc);
        this._panelBorder(c, L, L.fs);
        this._panelBorder(c, L, L.rf);

        c.restore();
    }

    _panelBorder(c, L, p) {
        c.strokeStyle = this.COLORS.border;
        c.lineWidth = 1;
        c.strokeRect(p.l + 0.5, L.plotT + 0.5, p.w - 1, L.plotH - 1);
    }

    // ---- Soil type strip ----

    _drawSoilStrip(c, L) {
        if (!this.layers || !this.layers.length) return;
        const p = L.soil;
        for (const layer of this.layers) {
            const y1 = Math.max(this._d2y(layer.startDepth, L), L.plotT);
            const y2 = Math.min(this._d2y(layer.endDepth, L), L.plotB);
            if (y2 <= y1) continue;
            c.fillStyle = layer.zone.color;
            c.globalAlpha = 0.7;
            c.fillRect(p.l, y1, p.w, y2 - y1);
            c.globalAlpha = 1;
        }
        // Also draw light color bands behind qc panel
        for (const layer of this.layers) {
            const y1 = Math.max(this._d2y(layer.startDepth, L), L.plotT);
            const y2 = Math.min(this._d2y(layer.endDepth, L), L.plotB);
            if (y2 <= y1) continue;
            c.fillStyle = layer.zone.color;
            c.globalAlpha = 0.08;
            c.fillRect(L.qc.l, y1, L.qc.w, y2 - y1);
            c.globalAlpha = 1;
        }
    }

    // ---- Grid ----

    _drawGridH(c, L) {
        const range = this.depthViewMax - this.depthViewMin;
        const step = this._niceStep(range, 8);
        const totalL = L.soil.l;
        const totalR = L.rf.l + L.rf.w;

        for (let d = Math.ceil(this.depthViewMin / step) * step; d <= this.depthViewMax; d = +(d + step).toFixed(6)) {
            const y = Math.round(this._d2y(d, L)) + 0.5;
            if (y < L.plotT || y > L.plotB) continue;
            const major = Math.abs(d - Math.round(d)) < 0.001;
            c.strokeStyle = major ? this.COLORS.gridMajor : this.COLORS.grid;
            c.lineWidth = 1;
            c.beginPath();
            c.moveTo(totalL, y);
            c.lineTo(totalR, y);
            c.stroke();
        }
    }

    _drawGridV(c, L, panel, maxVal) {
        const steps = Math.max(2, Math.min(6, Math.floor(panel.w / 35)));
        const step = maxVal / steps;

        for (let i = 1; i < steps; i++) {
            const x = Math.round(panel.l + (i / steps) * panel.w) + 0.5;
            c.strokeStyle = this.COLORS.grid;
            c.lineWidth = 1;
            c.beginPath();
            c.moveTo(x, L.plotT);
            c.lineTo(x, L.plotB);
            c.stroke();
        }
    }

    // ---- Headers ----

    _drawPanelHeader(c, L, panel, label, color, maxVal) {
        const cx = panel.l + panel.w / 2;

        // Label
        c.textAlign = 'center';
        c.textBaseline = 'top';
        c.font = `600 ${L.narrow ? 9 : 10}px Inter, system-ui, sans-serif`;
        c.fillStyle = color;
        c.fillText(label, cx, 3);

        // Scale ticks (0 and max)
        if (maxVal !== null && panel.w > 30) {
            c.font = `${L.narrow ? 7 : 9}px JetBrains Mono, monospace`;
            c.fillStyle = this.COLORS.text;
            c.textAlign = 'left';
            c.fillText('0', panel.l + 2, 15);
            c.textAlign = 'right';
            c.fillText(this._fmtScale(maxVal), panel.l + panel.w - 2, 15);

            // Middle tick
            if (panel.w > 60) {
                c.textAlign = 'center';
                c.fillText(this._fmtScale(maxVal / 2), cx, 15);
            }
        }
    }

    // ---- Depth axis ----

    _drawDepthAxis(c, L) {
        const range = this.depthViewMax - this.depthViewMin;
        const step = this._niceStep(range, 8);

        c.textAlign = 'right';
        c.textBaseline = 'middle';
        c.font = `${L.narrow ? 8 : 9}px JetBrains Mono, monospace`;
        c.fillStyle = this.COLORS.text;

        for (let d = Math.ceil(this.depthViewMin / step) * step; d <= this.depthViewMax; d = +(d + step).toFixed(6)) {
            const y = this._d2y(d, L);
            if (y < L.plotT + 6 || y > L.plotB - 3) continue;
            c.fillText(d.toFixed(1), L.depthW - 4, y);
        }

        // Vertical label
        if (!L.narrow) {
            c.save();
            c.translate(10, L.plotT + L.plotH / 2);
            c.rotate(-Math.PI / 2);
            c.textAlign = 'center';
            c.font = '600 9px Inter, system-ui, sans-serif';
            c.fillStyle = this.COLORS.text;
            c.fillText('Diepte (m)', 0, 0);
            c.restore();
        }
    }

    // ---- Data lines ----

    _drawLine(c, L, panel, key, maxVal, color, lw) {
        if (!this.data) return;
        c.save();
        c.beginPath();
        c.rect(panel.l, L.plotT, panel.w, L.plotH);
        c.clip();

        c.strokeStyle = color;
        c.lineWidth = lw;
        c.lineJoin = 'round';
        c.beginPath();

        let on = false;
        for (let i = 0; i < this.data.length; i++) {
            const d = this.depths[i];
            const v = this.data[i][key];
            if (d === null || v == null) { on = false; continue; }
            const x = panel.l + (v / maxVal) * panel.w;
            const y = this._d2y(d, L);
            if (!on) { c.moveTo(x, y); on = true; } else { c.lineTo(x, y); }
        }
        c.stroke();
        c.restore();
    }

    // ---- Crosshair + markers ----

    _drawCrosshair(c, L) {
        if (this.hoverY === null) return;
        const y = this.hoverY;
        if (y < L.plotT || y > L.plotB) return;

        const totalL = L.soil.l;
        const totalR = L.rf.l + L.rf.w;

        // Horizontal dashed line
        c.strokeStyle = this.COLORS.crosshair;
        c.lineWidth = 1;
        c.setLineDash([3, 3]);
        c.beginPath();
        c.moveTo(totalL, y);
        c.lineTo(totalR, y);
        c.stroke();
        c.setLineDash([]);

        // Depth label box
        const depth = this._y2d(y, L);
        const txt = depth.toFixed(2) + ' m';
        c.font = '9px JetBrains Mono, monospace';
        const tw = c.measureText(txt).width;
        c.fillStyle = 'rgba(22,27,34,0.92)';
        c.fillRect(L.depthW - tw - 8, y - 8, tw + 6, 16);
        c.fillStyle = this.COLORS.depthLabel;
        c.textAlign = 'right';
        c.textBaseline = 'middle';
        c.fillText(txt, L.depthW - 5, y);

        // Value markers on nearest data point
        const idx = this._nearest(depth);
        if (idx < 0) return;
        const row = this.data[idx];
        const my = this._d2y(this.depths[idx], L);

        this._marker(c, L.qc, row.qc, this.qcMax, my, this.COLORS.qc);
        this._marker(c, L.fs, row.fs, this.fsMax, my, this.COLORS.fs);
        this._marker(c, L.rf, row.rf, this.rfMax, my, this.COLORS.rf);
    }

    _marker(c, panel, val, maxVal, y, color) {
        if (val == null) return;
        const x = panel.l + (val / maxVal) * panel.w;
        c.fillStyle = color;
        c.beginPath();
        c.arc(x, y, 3.5, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = this.COLORS.bg;
        c.lineWidth = 1.5;
        c.stroke();
    }

    _nearest(targetDepth) {
        if (!this.depths) return -1;
        let bi = -1, bd = Infinity;
        for (let i = 0; i < this.depths.length; i++) {
            if (this.depths[i] === null) continue;
            const d = Math.abs(this.depths[i] - targetDepth);
            if (d < bd) { bd = d; bi = i; }
        }
        return bi;
    }

    // ---- Mouse interaction ----

    _onMouseMove(e) {
        const r = this.canvas.getBoundingClientRect();
        const y = e.clientY - r.top;

        if (this.isPanning) {
            const L = this._layout();
            const dy = y - this.panStartY;
            const dPerPx = (this.panStartDepthMax - this.panStartDepthMin) / L.plotH;
            this.depthViewMin = this.panStartDepthMin - dy * dPerPx;
            this.depthViewMax = this.panStartDepthMax - dy * dPerPx;
            this.draw();
            return;
        }

        this.hoverY = y;
        this.draw();

        if (this.onHover && this.data) {
            const L = this._layout();
            if (y >= L.plotT && y <= L.plotB) {
                const depth = this._y2d(y, L);
                const idx = this._nearest(depth);
                if (idx >= 0) {
                    const row = this.data[idx];
                    this.onHover({
                        depth: this.depths[idx],
                        qc: row.qc, fs: row.fs, rf: row.rf,
                        zone: Robertson.classify(row.qc, row.rf),
                    });
                }
            } else {
                this.onHover(null);
            }
        }
    }

    _onMouseLeave() {
        this.hoverY = null;
        this.isPanning = false;
        this.draw();
        if (this.onHover) this.onHover(null);
    }

    _onMouseDown(e) {
        if (e.button === 0) {
            this.isPanning = true;
            this.panStartY = e.clientY - this.canvas.getBoundingClientRect().top;
            this.panStartDepthMin = this.depthViewMin;
            this.panStartDepthMax = this.depthViewMax;
            this.canvas.style.cursor = 'grabbing';
        }
    }

    _onMouseUp() {
        this.isPanning = false;
        this.canvas.style.cursor = 'crosshair';
    }

    _onWheel(e) {
        e.preventDefault();
        const r = this.canvas.getBoundingClientRect();
        const y = e.clientY - r.top;
        const L = this._layout();
        if (y < L.plotT || y > L.plotB) return;

        const d = this._y2d(y, L);
        const f = e.deltaY > 0 ? 1.12 : 1 / 1.12;
        const nMin = d - (d - this.depthViewMin) * f;
        const nMax = d + (this.depthViewMax - d) * f;
        if (nMax - nMin < 0.5) return;
        this.depthViewMin = nMin;
        this.depthViewMax = nMax;
        this.draw();
    }

    zoomIn() {
        const c = (this.depthViewMin + this.depthViewMax) / 2;
        const r = (this.depthViewMax - this.depthViewMin) / 1.3;
        if (r < 0.5) return;
        this.depthViewMin = c - r / 2;
        this.depthViewMax = c + r / 2;
        this.draw();
    }

    zoomOut() {
        const c = (this.depthViewMin + this.depthViewMax) / 2;
        const r = (this.depthViewMax - this.depthViewMin) * 1.3;
        this.depthViewMin = c - r / 2;
        this.depthViewMax = c + r / 2;
        this.draw();
    }

    zoomFit() {
        this.depthViewMin = this.depthMin;
        this.depthViewMax = this.depthMax;
        this.draw();
    }

    // ---- Utility ----

    _niceStep(range, targetSteps) {
        if (range <= 0) return 1;
        const raw = range / Math.max(2, targetSteps);
        const p = Math.pow(10, Math.floor(Math.log10(raw)));
        const n = raw / p;
        if (n <= 1) return p;
        if (n <= 2) return 2 * p;
        if (n <= 5) return 5 * p;
        return 10 * p;
    }

    _fmtScale(v) {
        if (v === 0) return '0';
        if (v >= 10) return v % 1 === 0 ? v.toString() : v.toFixed(0);
        if (v >= 1) return v % 1 === 0 ? v.toString() : v.toFixed(1);
        if (v >= 0.1) return v.toFixed(1);
        return v.toFixed(2);
    }
}
