import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import RibbonGroup from "./RibbonGroup";
import RibbonButton from "./RibbonButton";
import RibbonButtonStack from "./RibbonButtonStack";
import { useExtension } from "../../hooks/useExtensions";

/**
 * Sonderingstekening ribbon — full toolset.
 *
 * Everything that used to live in the view's right-hand toolbox now lives
 * here: place a sondering, place a raster, drop an RD-coordinate tag,
 * copy / delete / nudge a selected object, and export PDF. The view
 * listens for the global events these buttons dispatch (see the
 * `ogs:tekening-*` handlers) so the ribbon stays purely declarative.
 */

const printIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ` +
  `d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4H7v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>`;

// Sondering — neerwaartse driehoek met een horizontaal kleefmeting-
// streepje eronder. Exact hetzelfde symbool als de geplaatste marker op
// de kaart (Dutch CPT-conventie), zodat de knop leest als "dit plaats je".
const sonderingIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 4h14L12 17z"/>` +
  `<path stroke-linecap="round" stroke-width="2" d="M7 20.5h10"/></svg>`;

// Boring — open cirkel met midden-dot (zelfde conventie als de BRO-laag
// op de Kaart en de geplaatste boring-marker).
const boreIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<circle cx="12" cy="12" r="8" stroke-width="2"/>` +
  `<circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/></svg>`;

const overlayIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ` +
  `d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>`;

// Kader (tekeningframe) — buitenrand met een titelblok-cartouche in de
// rechteronderhoek. Onderscheidt zich duidelijk van het image-icoon.
const frameIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ` +
  `d="M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1z"/>` +
  `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M12 19v-4h9"/></svg>`;

// Sonderingsraster — een regelmatig rooster van sondeer-driehoekjes (2×2)
// binnen een licht kader, i.p.v. een kaal grid. Leest meteen als "een
// raster vól sonderingen".
const rasterIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<rect x="3" y="3" width="18" height="18" rx="1" stroke-width="1.4" opacity="0.55"/>` +
  `<g stroke-width="1.4" stroke-linejoin="round">` +
  `<path d="M6 7h4l-2 4z"/><path d="M14 7h4l-2 4z"/>` +
  `<path d="M6 14h4l-2 4z"/><path d="M14 14h4l-2 4z"/></g></svg>`;

// RD-coördinaat — een survey-kruisdraad: cirkel met doorstekende assen en
// een middenpunt. Leest als "prik hier een exact coördinaatpunt".
const tagIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<circle cx="12" cy="12" r="6" stroke-width="2"/>` +
  `<path stroke-linecap="round" stroke-width="2" d="M12 2v4M12 18v4M2 12h4M18 12h4"/>` +
  `<circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>`;

// ── Bewerken-icons (select / move / copy / delete) ────────────────
// Heroicons-style strokes that match the rest of the ribbon. The Bewerken
// group is back — Open PDF Studio / Open 2D Studio convention is to have
// these four edit acties (selecteren, verplaatsen, kopiëren, verwijderen)
// always one klik away regardless of which sub-tool the user picked.
const moveIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ` +
  `d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/></svg>`;

// Offertes-icon — envelop met handgeschreven streep (snelheid /
// uitgaande mail-symbool). Heroicons "envelope" met arrow.
const quotesIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ` +
  `d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"/></svg>`;

// Exporteer-PDF-icon — document met omlaag-pijl (download/opslaan).
const exportPdfIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ` +
  `d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12l-3 3m0 0l-3-3m3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>`;

// Roteer-icon — een ronde pijl die 270° om een centrum buigt (open
// aan de bovenkant). Heroicons "arrow-path" stijl.
const rotateIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ` +
  `d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>`;

const copyIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ` +
  `d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-2M8 5a2 2 0 002 2h6a2 2 0 002-2M8 5a2 2 0 012-2h6a2 2 0 012 2m0 0h2a2 2 0 012 2v3a2 2 0 01-2 2h-2"/></svg>`;

const deleteIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ` +
  `d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V3a2 2 0 012-2h2a2 2 0 012 2v4"/></svg>`;

// Select / cursor — arrow icon for the default pick tool.
const selectIcon =
  `<svg fill="currentColor" viewBox="0 0 24 24">` +
  `<path d="M3 2 L3 18 L8 14 L11 21 L13.5 20 L10.5 13 L17 13 Z" />` +
  `</svg>`;

// Vrije lijn — simpel slash van linksonder naar rechtsboven.
const lineIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<path stroke-linecap="round" stroke-width="2" d="M4 20L20 4"/></svg>`;

// Vlak — polygon met lichte vulling.
const vlakIcon =
  `<svg fill="currentColor" fill-opacity="0.25" stroke="currentColor" viewBox="0 0 24 24">` +
  `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8l6-4 10 3-2 11-9 2-5-7z"/></svg>`;

// Opmerking — tekstballon.
const noteIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h8M8 14h5m-9 6l3.5-3H18a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v14z"/></svg>`;

// Maatlijn — horizontale lijn met uiteinde-tikken (┤───┤).
const dimensionIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<path stroke-linecap="round" stroke-width="2" d="M3 12h18M5 8v8M19 8v8"/></svg>`;

// ── CAD-edit-icons ───────────────────────────────────────────────
// Klassieke tekenprogramma-symbolen (Trim / Extend / Mirror / Offset).
// Bewust simpel: één bestaande lijn + een schaartje / verlengpijl /
// spiegelglyf / parallel-streep. Visueel onderscheidbaar in een
// gestackte ribbon-kolom van 22px hoog.

// Trim — schaartje door een lijn. Twee handvatten + middendiagonaal
// "knip"-streep zodat het op het eerste oog leest als een knipgebaar.
const trimIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<g stroke-linecap="round" stroke-linejoin="round" stroke-width="2">` +
  `<path d="M4 20L20 4"/>` +
  `<circle cx="6" cy="18" r="2"/><circle cx="11" cy="18" r="2"/>` +
  `<path d="M8 16L13 11"/></g></svg>`;

// Extend — een korte lijn met een pijlkop die naar een verticale
// referentiestreep wijst (rechts). Suggesties: "trek door tot dáár".
const extendIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<g stroke-linecap="round" stroke-linejoin="round" stroke-width="2">` +
  `<path d="M3 12h13"/>` +
  `<path d="M12 8l4 4-4 4"/>` +
  `<path d="M20 4v16"/></g></svg>`;

// Mirror — twee tegenovergestelde driehoekjes met een verticale
// spiegelas ertussen. Klassiek CAD-symbool.
const mirrorIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<g stroke-linecap="round" stroke-linejoin="round" stroke-width="2">` +
  `<path d="M12 3v18" stroke-dasharray="2 2"/>` +
  `<path d="M3 6l7 6-7 6V6z"/>` +
  `<path d="M21 6l-7 6 7 6V6z"/></g></svg>`;

// Offset — twee parallelle lijnen met een pijltje tussen.
const offsetIcon =
  `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">` +
  `<g stroke-linecap="round" stroke-linejoin="round" stroke-width="2">` +
  `<path d="M4 7h16"/><path d="M4 17h16"/>` +
  `<path d="M12 10v4"/><path d="M10 12l2-2 2 2"/>` +
  `<path d="M10 14l2 2 2-2"/></g></svg>`;

// Freeze viewport heeft geen ribbon-knop meer — alleen het vinkje in
// TekeningProperties (rechter eigenschappen-paneel) bedient hem nu.

const dispatch = (name: string, detail?: unknown) =>
  window.dispatchEvent(new CustomEvent(name, { detail }));

export default function SonderingstekeningTab() {
  const { t } = useTranslation("ribbon");
  const extOffertes = useExtension("offertes");

  // Houd lokaal bij of select-mode aan staat in de view, zodat de
  // Selecteren-knop kan highlighten (active-style). De view dispatcht
  // `ogs:tekening-select-mode-changed` zodra de gebruiker hem toggelt.
  const [selectActive, setSelectActive] = useState(false);
  useEffect(() => {
    const onChange = (e: Event) => {
      const ce = e as CustomEvent<{ active: boolean }>;
      setSelectActive(!!ce.detail?.active);
    };
    window.addEventListener("ogs:tekening-select-mode-changed", onChange);
    return () => {
      window.removeEventListener("ogs:tekening-select-mode-changed", onChange);
    };
  }, []);

  return (
    <div className="ribbon-content">
      <div className="ribbon-groups">
        <RibbonGroup label={t("tekening.selectGroup", "Selecteer")}>
          <RibbonButton
            icon={selectIcon}
            label={t("tekening.selectMode", "Selecteren")}
            size="large"
            active={selectActive}
            onClick={() => dispatch("ogs:tekening-select-mode")}
          />
        </RibbonGroup>

        {/* Bewerken-groep: TWEE gestackte kolommen.
            Kolom 1: Verplaatsen / Kopiëren / Roteren / Verwijderen.
            Kolom 2: Trim / Extend / Mirror / Offset (de CAD-edit-tools
            die voorheen in een aparte "Tekenen"-groep zaten — verzoek
            gebruiker: bij elkaar onder Bewerken). */}
        <RibbonGroup label={t("tekening.editGroup", "Bewerken")}>
          <RibbonButtonStack>
            <RibbonButton
              icon={moveIcon}
              label={t("tekening.moveSelection", "Verplaatsen")}
              size="small"
              title={t(
                "tekening.moveHint",
                "Pijltjestoetsen verplaatsen 1 m (Shift = 5 m)",
              )}
              onClick={() => dispatch("ogs:tekening-move", { dx: 1, dy: 0 })}
            />
            <RibbonButton
              icon={copyIcon}
              label={t("tekening.copySelection", "Kopiëren")}
              size="small"
              title={t("tekening.copyHint", "Dupliceer naast het geselecteerde object (Ctrl+D)")}
              onClick={() => dispatch("ogs:tekening-copy")}
            />
            <RibbonButton
              icon={rotateIcon}
              label={t("tekening.rotate", "Roteren…")}
              size="small"
              title={t(
                "tekening.rotateHint",
                "Vraag de gewenste hoek in graden (negatief = tegen de klok in).",
              )}
              onClick={() => {
                const raw = window.prompt(
                  "Roteer met hoeveel graden? (negatief = tegen de klok in)",
                  "90",
                );
                if (raw === null) return;
                const deg = parseFloat(raw.replace(",", "."));
                if (!Number.isFinite(deg) || deg === 0) return;
                dispatch("ogs:tekening-rotate", { deg });
              }}
            />
            <RibbonButton
              icon={deleteIcon}
              label={t("tekening.deleteSelection", "Verwijderen")}
              size="small"
              title={t("tekening.deleteHint", "Verwijder het geselecteerde object (Delete)")}
              onClick={() => dispatch("ogs:tekening-delete")}
            />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton
              icon={trimIcon}
              label={t("tekening.cadTrim", "Trim")}
              size="small"
              title={t(
                "tekening.cadTrimHint",
                "Klik eerst een referentielijn, dan het deel van een andere lijn dat WEG moet (op het snijpunt geknipt).",
              )}
              onClick={() => dispatch("ogs:tekening-cad-trim")}
            />
            <RibbonButton
              icon={extendIcon}
              label={t("tekening.cadExtend", "Extend")}
              size="small"
              title={t(
                "tekening.cadExtendHint",
                "Klik eerst een referentielijn, dan het uiteinde van de lijn dat verlengd moet worden.",
              )}
              onClick={() => dispatch("ogs:tekening-cad-extend")}
            />
            <RibbonButton
              icon={mirrorIcon}
              label={t("tekening.cadMirror", "Mirror")}
              size="small"
              title={t(
                "tekening.cadMirrorHint",
                "Selecteer eerst een lijn, klik dan twee punten op de kaart om de spiegelas vast te zetten.",
              )}
              onClick={() => dispatch("ogs:tekening-cad-mirror")}
            />
            <RibbonButton
              icon={offsetIcon}
              label={t("tekening.cadOffset", "Offset")}
              size="small"
              title={t(
                "tekening.cadOffsetHint",
                "Klik een lijn, geef de afstand in m, klik aan de zijde waar de parallel-kopie moet komen.",
              )}
              onClick={() => dispatch("ogs:tekening-cad-offset")}
            />
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label={t("tekening.placeGroup", "Plaatsen")}>
          <RibbonButton
            icon={sonderingIcon}
            label={t("tekening.placeMode", "Sondering")}
            size="large"
            onClick={() => dispatch("ogs:tekening-toggle-place")}
          />
          <RibbonButton
            icon={boreIcon}
            label={t("tekening.placeBore", "Boring")}
            size="large"
            onClick={() => dispatch("ogs:tekening-toggle-place-bore")}
          />
          <RibbonButton
            icon={rasterIcon}
            label={t("tekening.placeRaster", "Sonderingsraster")}
            size="large"
            onClick={() => dispatch("ogs:tekening-place-raster")}
          />
          <RibbonButton
            icon={lineIcon}
            label={t("tekening.drawLine", "Lijn")}
            size="large"
            onClick={() => dispatch("ogs:tekening-draw-line")}
          />
          <RibbonButton
            icon={dimensionIcon}
            label={t("tekening.drawDim", "Maatlijn")}
            size="large"
            onClick={() => dispatch("ogs:tekening-draw-dimension")}
          />
          <RibbonButton
            icon={tagIcon}
            label={t("tekening.coordTag", "RD-coördinaat")}
            size="large"
            onClick={() => dispatch("ogs:tekening-coord-tag")}
          />
          <RibbonButton
            icon={vlakIcon}
            label={t("tekening.drawVlak", "Vlak")}
            size="large"
            onClick={() => dispatch("ogs:tekening-draw-vlak")}
          />
          <RibbonButton
            icon={noteIcon}
            label={t("tekening.addNote", "Opmerking")}
            size="large"
            onClick={() => dispatch("ogs:tekening-add-note")}
          />
        </RibbonGroup>

        <RibbonGroup label={t("tekening.overlayGroup", "Overlay")}>
          <RibbonButton
            icon={overlayIcon}
            label={t("tekening.addOverlay", "Image/PDF import")}
            size="large"
            onClick={() => dispatch("ogs:tekening-add-overlay")}
          />
          <RibbonButton
            icon={frameIcon}
            label={t("tekening.loadFrame", "Kader (SVG)")}
            size="large"
            onClick={() => dispatch("ogs:tekening-load-frame")}
          />
          <RibbonButton
            icon={deleteIcon}
            label={t("tekening.clearAll", "Wis alles")}
            size="small"
            onClick={() => dispatch("ogs:tekening-clear-all")}
          />
        </RibbonGroup>

        <RibbonGroup label={t("tekening.exportGroup", "Export")}>
          <RibbonButton
            icon={exportPdfIcon}
            label={t("tekening.exportPdf", "Exporteer PDF")}
            size="large"
            onClick={() => dispatch("ogs:tekening-export-pdf")}
          />
          <RibbonButton
            icon={printIcon}
            label={t("tekening.print", "Print")}
            size="large"
            onClick={() => dispatch("ogs:tekening-print")}
          />
        </RibbonGroup>

        {extOffertes && (
          <RibbonGroup label={t("tekening.offertesGroup", "Offertes")}>
            <RibbonButton
              icon={quotesIcon}
              label={t("tekening.requestQuotes", "Offertes opvragen")}
              size="large"
              title={t(
                "tekening.requestQuotesHint",
                "Open een dialog met de dichtstbijzijnde sondeerbedrijven en open een mailto-offerte-aanvraag in Outlook",
              )}
              onClick={() => dispatch("ogs:tekening-request-quotes")}
            />
          </RibbonGroup>
        )}
      </div>
    </div>
  );
}
