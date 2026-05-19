import { useEffect, useState } from "react";
import "./TekeningProperties.css";

/**
 * Right-panel Properties view for the Sonderingstekening tab.
 *
 * Communicates with SonderingstekeningView via window events instead of
 * a shared store — keeps the existing complex Leaflet state local to
 * the view, while the Properties panel stays a thin form that mirrors
 * whatever the view exposes.
 *
 * Event protocol:
 *   - This panel emits `ogs:tekening-request-snapshot` on mount.
 *   - SonderingstekeningView replies (and re-emits on any change) with
 *     `ogs:tekening-state-snapshot` carrying { titleBlock, selection,
 *     selectedRaster, selectedMarker } as detail.
 *   - User edits in this panel emit either
 *     `ogs:tekening-set-titleblock` { field, value } or
 *     `ogs:tekening-update-selected-raster` { patch }, which the view
 *     listens for and applies to its local state.
 */

interface TitleBlockData {
  project: string;
  projectNumber: string;
  address: string;
  drawingNumber: string;
  scale: string;
  date: string;
  drawnBy: string;
  checkedBy: string;
  version: string;
}

interface RasterSnapshot {
  id: string;
  rows: number;
  cols: number;
  spacingX: number;
  spacingY: number;
  rotation: number;
}

interface OverlaySnapshot {
  id: string;
  name: string;
  widthMeters: number;
}

interface Snapshot {
  titleBlock: TitleBlockData;
  paperSize: "A2" | "A3";
  /** Doel-schaal (gekozen preset of door gebruiker getypte custom
   *  waarde). Vroeger een vaste union (500|1000|2000|5000), nu een
   *  willekeurig positief getal zodat het titleblock een eigen
   *  schaal kan zetten. */
  scale: number;
  /** Werkelijke schaal afgeleid uit de huidige Leaflet zoom — verandert
   *  live als de gebruiker met het muiswiel in- of uitzoomt. */
  liveScale?: number;
  frozen?: boolean;
  selectionKind: "raster" | "marker" | "overlay" | "line" | null;
  selectionId: string | null;
  selectedRaster?: RasterSnapshot | null;
  selectedMarker?: { id: string; kleefmeting: boolean } | null;
  selectedOverlay?: OverlaySnapshot | null;
  /** Properties van de geselecteerde lijn — id + huidige override-
   *  kleur (undefined = kind-default). De kleur-picker in dit paneel
   *  dispatcht `ogs:tekening-set-line-color` om hem te wijzigen. */
  selectedLine?: { id: string; kind: "line" | "dimension"; color?: string } | null;
}

const TB_FIELDS: { key: keyof TitleBlockData; label: string }[] = [
  { key: "project",       label: "Project" },
  { key: "projectNumber", label: "Projectnr" },
  { key: "address",       label: "Adres" },
  { key: "drawingNumber", label: "Tekening-nr" },
  { key: "scale",         label: "Schaal" },
  { key: "date",          label: "Datum" },
  { key: "drawnBy",       label: "Getekend" },
  { key: "checkedBy",     label: "Gecontroleerd" },
  { key: "version",       label: "Versie" },
];

export default function TekeningProperties() {
  const [snap, setSnap] = useState<Snapshot | null>(null);

  // Subscribe to state snapshots from SonderingstekeningView.
  useEffect(() => {
    const onSnap = (e: Event) => {
      const ce = e as CustomEvent<Snapshot>;
      setSnap(ce.detail);
    };
    window.addEventListener("ogs:tekening-state-snapshot", onSnap as EventListener);
    // Ask the view to publish its current state now that we're listening.
    window.dispatchEvent(new CustomEvent("ogs:tekening-request-snapshot"));
    return () =>
      window.removeEventListener("ogs:tekening-state-snapshot", onSnap as EventListener);
  }, []);

  const setTb = (field: keyof TitleBlockData, value: string) => {
    window.dispatchEvent(
      new CustomEvent("ogs:tekening-set-titleblock", {
        detail: { field, value },
      }),
    );
  };

  const updateRaster = (patch: Partial<RasterSnapshot>) => {
    window.dispatchEvent(
      new CustomEvent("ogs:tekening-update-selected-raster", {
        detail: { patch },
      }),
    );
  };

  const deleteSelection = () => {
    window.dispatchEvent(new CustomEvent("ogs:tekening-delete"));
  };

  if (!snap) {
    return (
      <div className="tekprops">
        <p className="tekprops-empty">Eigenschappen laden…</p>
      </div>
    );
  }

  return (
    <div className="tekprops">
      {/* ── Paper + scale (moved from view topbar) ───────────── */}
      <section className="tekprops-section">
        <header className="tekprops-section-header">
          <span>Papier &amp; schaal</span>
        </header>
        <div className="tekprops-body">
          <label className="tekprops-field tekprops-field-wide">
            <span>Papier</span>
            <select
              value={snap.paperSize}
              onChange={(e) =>
                window.dispatchEvent(
                  new CustomEvent("ogs:tekening-set-papersize", {
                    detail: { paperSize: e.target.value as "A2" | "A3" },
                  }),
                )
              }
            >
              <option value="A2">A2 liggend</option>
              <option value="A3">A3 liggend</option>
            </select>
          </label>
          {/* Schaal als getal-input — geen dropdown meer. Typ "850" of
              "1000" en klik buiten / Enter; de tekening zoomt direct
              naar 1:dat-getal. Voorgevuld met de live-berekende schaal
              zodat je ziet wat er nu op het papier staat. */}
          <ScaleNumberField
            scale={snap.scale}
            liveScale={snap.liveScale}
          />
          {/* Snel-presets voor de gangbare bouwkundige drukschalen.
              Klik op een chip = exacte 1:N (zelfde event als de
              getypte waarde). Active-state op chip die matcht de
              huidige requested scale (snap.scale, niet liveScale —
              anders flikkert het bij zoom-correcties). */}
          <div className="tekprops-scale-presets" role="group" aria-label="Schaal-presets">
            {[500, 1000, 2000, 5000].map((preset) => (
              <button
                key={preset}
                type="button"
                className={`tekprops-scale-chip${snap.scale === preset ? " active" : ""}`}
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("ogs:tekening-set-scale", {
                      detail: { scale: preset },
                    }),
                  )
                }
                title={`Zet schaal op 1:${preset}`}
              >
                1:{preset}
              </button>
            ))}
          </div>
          {/* Freeze viewport — checkbox-vorm in het paneel. De ribbon-
              knop blijft ook bestaan; ze schrijven naar dezelfde state
              via `ogs:tekening-toggle-freeze`. */}
          <label className="tekprops-field tekprops-field-wide">
            <span>Freeze viewport</span>
            <input
              type="checkbox"
              checked={!!snap.frozen}
              onChange={() =>
                window.dispatchEvent(
                  new CustomEvent("ogs:tekening-toggle-freeze"),
                )
              }
              title="Bevries pan + zoom zodat de tekening exact blijft staan"
            />
          </label>
        </div>
      </section>

      {/* ── Selected object ─────────────────────────────────── */}
      <section className="tekprops-section">
        <header className="tekprops-section-header">
          {snap.selectionKind === "raster" && snap.selectedRaster && (
            <span>Raster {snap.selectedRaster.id}</span>
          )}
          {snap.selectionKind === "marker" && snap.selectionId && (
            <span>Sondering {snap.selectionId}</span>
          )}
          {snap.selectionKind === "overlay" && snap.selectedOverlay && (
            <span>Achtergrond</span>
          )}
          {!snap.selectionKind && <span>Geen selectie</span>}
        </header>

        {snap.selectionKind === "raster" && snap.selectedRaster && (
          <div className="tekprops-body">
            <div className="tekprops-row">
              <label className="tekprops-field">
                <span>Rijen</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={snap.selectedRaster.rows}
                  onChange={(e) =>
                    updateRaster({
                      rows: Math.max(1, Math.min(50, Number(e.target.value) || 1)),
                    })
                  }
                />
              </label>
              <label className="tekprops-field">
                <span>Kolommen</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={snap.selectedRaster.cols}
                  onChange={(e) =>
                    updateRaster({
                      cols: Math.max(1, Math.min(50, Number(e.target.value) || 1)),
                    })
                  }
                />
              </label>
            </div>
            <div className="tekprops-row">
              <label className="tekprops-field">
                <span>H.o.h. X (m)</span>
                <input
                  type="number"
                  min={0.5}
                  max={500}
                  step={0.5}
                  value={Number(snap.selectedRaster.spacingX.toFixed(2))}
                  onChange={(e) =>
                    updateRaster({
                      spacingX: Math.max(0.5, Number(e.target.value) || 0.5),
                    })
                  }
                />
              </label>
              <label className="tekprops-field">
                <span>H.o.h. Y (m)</span>
                <input
                  type="number"
                  min={0.5}
                  max={500}
                  step={0.5}
                  value={Number(snap.selectedRaster.spacingY.toFixed(2))}
                  onChange={(e) =>
                    updateRaster({
                      spacingY: Math.max(0.5, Number(e.target.value) || 0.5),
                    })
                  }
                />
              </label>
            </div>
            <label className="tekprops-field tekprops-field-wide">
              <span>Rotatie (°)</span>
              <input
                type="range"
                min={-180}
                max={180}
                step={1}
                value={Math.round(snap.selectedRaster.rotation)}
                onChange={(e) =>
                  updateRaster({ rotation: Number(e.target.value) })
                }
              />
              <span className="tekprops-num-val">
                {`${Math.round(snap.selectedRaster.rotation)}°`}
              </span>
            </label>
            <button
              type="button"
              className="tekprops-btn tekprops-btn-danger"
              onClick={deleteSelection}
            >
              Verwijder raster
            </button>
          </div>
        )}

        {snap.selectionKind === "marker" && snap.selectionId && (
          <div className="tekprops-body">
            <label className="tekprops-field tekprops-field-wide">
              <span>Sonderingsnr</span>
              <input
                type="text"
                value={snap.selectionId}
                onChange={(e) => {
                  const newId = e.target.value.trim();
                  if (!newId) return;
                  window.dispatchEvent(
                    new CustomEvent("ogs:tekening-set-placed-id", {
                      detail: { oldId: snap.selectionId!, newId },
                    }),
                  );
                }}
              />
            </label>
            <label className="tekprops-field tekprops-field-wide">
              <span>Kleefmeting</span>
              <input
                type="checkbox"
                checked={!!snap.selectedMarker?.kleefmeting}
                onChange={(e) =>
                  window.dispatchEvent(
                    new CustomEvent("ogs:tekening-set-kleefmeting", {
                      detail: {
                        id: snap.selectionId!,
                        kleefmeting: e.target.checked,
                      },
                    }),
                  )
                }
              />
            </label>
            <p className="tekprops-hint">
              Sleep de marker op de kaart om te verplaatsen.
            </p>
            <button
              type="button"
              className="tekprops-btn tekprops-btn-danger"
              onClick={deleteSelection}
            >
              Verwijder sondering
            </button>
          </div>
        )}

        {snap.selectionKind === "line" && snap.selectedLine && (
          <div className="tekprops-body">
            <p className="tekprops-hint">
              {snap.selectedLine.kind === "dimension" ? "Maatlijn" : "Lijn"} {snap.selectedLine.id}
            </p>
            <label className="tekprops-field tekprops-field-wide">
              <span>Kleur</span>
              <input
                type="color"
                value={
                  snap.selectedLine.color ??
                  (snap.selectedLine.kind === "dimension" ? "#d97706" : "#36363e")
                }
                onChange={(e) =>
                  window.dispatchEvent(
                    new CustomEvent("ogs:tekening-set-line-color", {
                      detail: { id: snap.selectionId!, color: e.target.value },
                    }),
                  )
                }
              />
            </label>
            {snap.selectedLine.color && (
              <button
                type="button"
                className="tekprops-btn"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("ogs:tekening-set-line-color", {
                      detail: { id: snap.selectionId!, color: null },
                    }),
                  )
                }
              >
                Reset naar standaard
              </button>
            )}
            <button
              type="button"
              className="tekprops-btn tekprops-btn-danger"
              onClick={deleteSelection}
            >
              Verwijder lijn
            </button>
          </div>
        )}

        {snap.selectionKind === "overlay" && snap.selectedOverlay && (
          <div className="tekprops-body">
            <p className="tekprops-hint">
              {snap.selectedOverlay.name}
            </p>
            <label className="tekprops-field tekprops-field-wide">
              <span>Breedte (m)</span>
              <input
                type="number"
                min={1}
                max={5000}
                step={1}
                value={Math.round(snap.selectedOverlay.widthMeters)}
                onChange={(e) =>
                  window.dispatchEvent(
                    new CustomEvent("ogs:tekening-update-selected-overlay", {
                      detail: { widthMeters: Number(e.target.value) || 1 },
                    }),
                  )
                }
              />
            </label>
            <button
              type="button"
              className="tekprops-btn tekprops-btn-danger"
              onClick={deleteSelection}
            >
              Verwijder achtergrond
            </button>
          </div>
        )}

        {!snap.selectionKind && (
          <div className="tekprops-body">
            <p className="tekprops-hint">
              Klik op een sondering, raster of object op het papier om
              de eigenschappen te bewerken.
            </p>
          </div>
        )}
      </section>

      {/* ── Tekeningkader / titleblock ──────────────────────── */}
      <section className="tekprops-section">
        <header className="tekprops-section-header">
          <span>Tekeningkader</span>
        </header>
        <div className="tekprops-body">
          {TB_FIELDS.map(({ key, label }) => (
            <label key={key} className="tekprops-field tekprops-field-wide">
              <span>{label}</span>
              <input
                type="text"
                value={snap.titleBlock[key] ?? ""}
                onChange={(e) => setTb(key, e.target.value)}
              />
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * Schaal-veld in TekeningProperties — een tekstinput met de live
 * waarde als placeholder. De gebruiker typt een geheel getal (of
 * "1:N") en bevestigt met Enter of blur; dat dispatcht
 * `ogs:tekening-set-scale` met de nieuwe schaal, waarop de view
 * de Leaflet-zoom naar die exacte 1:N stelt.
 */
function ScaleNumberField({
  scale,
  liveScale,
}: {
  scale: number;
  liveScale?: number;
}) {
  // Live schaal wint zolang de gebruiker niet aan het typen is.
  // Snap naar de gevraagde scale wanneer liveScale binnen ±2 zit —
  // anders krijgt de gebruiker 1:498 te zien terwijl ze 1:500 typten
  // (de iteratieve scale-setter convergeert binnen 0.1% maar één
  // pixel-rounding kan nog steeds ±1-2 opleveren in de read-out).
  // Bij grotere drift (b.v. wanneer de gebruiker zelf met het
  // muiswiel zoomt) verschijnt wel de echte live-waarde.
  const displayed =
    liveScale != null && Math.abs(liveScale - scale) <= 2
      ? scale
      : (liveScale ?? scale);
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? String(displayed);

  const commit = () => {
    if (draft === null) return;
    const m = draft.match(/(\d+)\s*$/);
    const n = m ? parseInt(m[1], 10) : NaN;
    if (Number.isFinite(n) && n >= 50 && n <= 100000) {
      window.dispatchEvent(
        new CustomEvent("ogs:tekening-set-scale", { detail: { scale: n } }),
      );
    }
    setDraft(null);
  };

  return (
    <label
      className="tekprops-field tekprops-field-wide"
      title="Typ een schaal (bv. 1000 voor 1:1000) en Enter — de tekening past zich aan"
    >
      <span>Schaal 1:</span>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => {
          if (draft === null) setDraft(String(displayed));
          e.currentTarget.select();
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}
