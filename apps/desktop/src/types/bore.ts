/**
 * Minimal Borehole (BHR-GT) data model used by the in-app strip log view.
 *
 * Mirrors the shape of `Cpt` (id, position, layers) but keyed on soil
 * descriptions instead of qc/fs measurements. Parsed directly in
 * TypeScript via `parseBhrgtXml` — keeps the Rust side minimal (only a
 * fetch_bro_bore command) since boring XMLs are small enough to parse
 * client-side without measurable cost.
 */

export interface BorePosition {
  x_rd: number;
  y_rd: number;
  z_nap?: number;
}

export interface BoreLayer {
  /** Top depth below ground level (m, positive downward). */
  top_depth: number;
  /** Bottom depth below ground level (m, positive downward). */
  base_depth: number;
  /** NEN5104/NEN1997 soil name as supplied by the data provider. */
  soil_name: string;
  /** Optional Dutch colour description (e.g. "grijsbruin"). */
  colour?: string;
  /** Free-form description blob — anything the parser couldn't classify. */
  description?: string;
  /**
   * Nevenlagen / secondary attributes — anomalousLayer ("Bijmenging"),
   * chunk ("Brokken"), peatFraction ("Veen"), and BHR-P pedologicalSoilName,
   * peatType, organicMatterClass, carbonateClass, structure descriptors.
   * Rendered as compact chips under the main soil name.
   */
  secondary?: { label: string; value: string }[];
}

export interface Bore {
  id: string;
  position?: BorePosition;
  /** Final depth below ground level (m). */
  final_depth?: number;
  layers: BoreLayer[];
  metadata: {
    project_name?: string;
    project_number?: string;
    description_date?: string;
    /** Datum waarop de boring in het veld is uitgevoerd (BRO
     *  `boringStartDate` of `objectIdAccountableParty` afgeleid). */
    start_date?: string;
    end_date?: string;
    quality_regime?: string;
    description_procedure?: string;
    /** "boormethode" of "boringProcedure" — type boring (handboring,
     *  pulsboor, ...). */
    bore_method?: string;
    /** Bronhouder / accountable party — wie heeft de boring gemeld. */
    accountable_party?: string;
    delivered_via?: string;
    source_file: string;
    /** Vrije sleutel-waarde paren afkomstig uit het BHR-document.
     *  Voor verbatim-zicht in het Verkenner-paneel (analoog aan
     *  `Cpt.metadata.extra`). */
    extra?: Record<string, string>;
  };
}

/**
 * Parse a BHR-GT v2 XML document into the simplified `Bore` shape above.
 *
 * The schema namespaces are noisy and version-dependent (xmlns prefixes
 * vary by registration year), so we walk the parsed DOM by *local* tag
 * names with case-insensitive matching to stay robust across providers.
 */
export function parseBhrgtXml(xml: string, sourceFile: string): Bore {
  const dom = new DOMParser().parseFromString(xml, "application/xml");
  const err = dom.querySelector("parsererror");
  if (err) {
    throw new Error(`Boring XML kon niet worden gelezen: ${err.textContent}`);
  }

  // Local-name lookup helper — case-insensitive, ignores prefixes.
  const byLocal = (root: ParentNode, names: string[]): Element[] => {
    const out: Element[] = [];
    const set = new Set(names.map((n) => n.toLowerCase()));
    const walk = (n: Node) => {
      if (n.nodeType === 1) {
        const el = n as Element;
        const local = (el.localName ?? el.nodeName.split(":").pop() ?? "").toLowerCase();
        if (set.has(local)) out.push(el);
        for (const c of Array.from(el.children)) walk(c);
      } else {
        // Document / DocumentFragment: descend into the element children
        // directly. Without this branch a Document root (nodeType 9)
        // would short-circuit before we ever visit the actual XML root,
        // and every byLocal call against `dom` would return [].
        const parent = n as ParentNode;
        if (parent.children) {
          for (const c of Array.from(parent.children)) walk(c);
        }
      }
    };
    walk(root as Node);
    return out;
  };

  const firstText = (root: ParentNode, names: string[]): string | undefined => {
    const els = byLocal(root, names);
    const txt = els[0]?.textContent?.trim();
    return txt && txt.length > 0 ? txt : undefined;
  };

  // ID — from broId / objectIdAccountableParty.
  const id =
    firstText(dom, ["broId", "objectIdAccountableParty"]) ??
    sourceFile.replace(/\.xml$/i, "");

  // Position — gml:pos under deliveredLocation, format "x y" (RD).
  let position: BorePosition | undefined;
  const deliveredLoc = byLocal(dom, ["deliveredLocation", "standardizedLocation"])[0];
  if (deliveredLoc) {
    const pos = firstText(deliveredLoc, ["pos"]);
    if (pos) {
      const parts = pos.split(/\s+/).map((s) => parseFloat(s));
      if (parts.length >= 2 && parts.every(Number.isFinite)) {
        position = { x_rd: parts[0], y_rd: parts[1] };
      }
    }
  }
  // Vertical position (z NAP) lives in deliveredVerticalPosition/offset.
  const vert = byLocal(dom, ["deliveredVerticalPosition"])[0];
  const offsetTxt = vert ? firstText(vert, ["offset"]) : undefined;
  const z = offsetTxt ? parseFloat(offsetTxt) : NaN;
  if (position && Number.isFinite(z)) position.z_nap = z;

  // Final depth — BHR-GT/BHR-G use `<finalDepthBoring>`, BHR-P (bodemkundig)
  // puts it inside `<boring><boredTrajectory><endDepth>`. Try the explicit
  // names first; if absent, scope to a `boredTrajectory` element and grab
  // the endDepth nested under it (not the per-layer ones).
  let final_depth: number | undefined;
  const directTxt = firstText(dom, ["finalDepthBoring", "finalDepth"]);
  if (directTxt) {
    final_depth = parseFloat(directTxt);
  } else {
    const traj = byLocal(dom, ["boredTrajectory"])[0];
    if (traj) {
      const endTxt = firstText(traj, ["endDepth"]);
      if (endTxt) final_depth = parseFloat(endTxt);
    }
  }

  // Layers — describedInterval / layer / soilLayer / Layer (the BHR-G
  // schema wraps each entry in `<bhrgcom:layer>` containing a nested
  // `<bhrgcom:Layer>`, both of which match our case-insensitive search.
  // We dedupe by (top, base, soil) so wrapper + inner-element collapse
  // into a single layer entry.
  const layers: BoreLayer[] = [];
  const seenKeys = new Set<string>();
  const intervals = byLocal(dom, ["describedInterval", "layer", "soilLayer"]);
  for (const interval of intervals) {
    const upper = firstText(interval, [
      "upperBoundary", "topDepth", "beginDepth",
    ]);
    const lower = firstText(interval, [
      "lowerBoundary", "baseDepth", "endDepth", "bottomDepth",
    ]);
    if (!upper || !lower) continue;
    const top = parseFloat(upper);
    const bot = parseFloat(lower);
    if (!Number.isFinite(top) || !Number.isFinite(bot)) continue;
    if (bot <= top) continue;
    const soil =
      firstText(interval, [
        "standardSoilName",
        "soilNameNEN1997",
        "soilNameNEN5104",
        "soilName",
      ]) ?? "Onbekend";
    const key = `${top.toFixed(3)}-${bot.toFixed(3)}-${soil}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const colour = firstText(interval, ["colour", "color"]);
    const description = firstText(interval, [
      "comment", "remarks", "specialMaterial",
    ]);

    // ── Nevenlagen / secondary attributes ──────────────────────
    // BRO XMLs annotate each layer with bijmengingen, brokken,
    // veenresten + a list of NEN classifications. Collect them as
    // labelled chips so the strip-log can show them under the main
    // soil name without losing information.
    const secondary: { label: string; value: string }[] = [];
    const isMeaningful = (v: string | undefined): v is string =>
      !!v && !v.toLowerCase().includes("onbekend") && v.toLowerCase() !== "geen";

    for (const anom of byLocal(interval, ["anomalousLayer"])) {
      const t = firstText(anom, ["soilType", "soilName", "standardSoilName"]);
      const prop = firstText(anom, [
        "layerProportionClassArchive",
        "layerProportionClass",
      ]);
      if (t) {
        secondary.push({
          label: "Bijmenging",
          value: prop ? `${t} (${prop})` : t,
        });
      }
    }
    for (const ch of byLocal(interval, ["chunk"])) {
      const t = firstText(ch, ["soilType", "soilName"]);
      const prop = firstText(ch, ["archiveClass"]);
      if (t) {
        secondary.push({
          label: "Brok",
          value: prop ? `${t} (${prop})` : t,
        });
      }
    }
    for (const peat of byLocal(interval, ["peatFraction"])) {
      const plant = firstText(peat, ["plantRemainType"]);
      const arch = firstText(peat, ["archiveClass"]);
      if (plant) {
        secondary.push({
          label: "Veenrest",
          value: arch ? `${plant} (${arch})` : plant,
        });
      }
    }

    // Single-value descriptors — only push when they carry new info.
    const pedological = firstText(interval, ["pedologicalSoilName"]);
    if (isMeaningful(pedological) && pedological !== soil) {
      secondary.push({ label: "Pedologisch", value: pedological });
    }
    const peatType = firstText(interval, ["peatType"]);
    if (isMeaningful(peatType)) {
      secondary.push({ label: "Veentype", value: peatType });
    }
    const organicClass = firstText(interval, [
      "organicMatterClass",
      "organicMatterContentClassNEN5104",
    ]);
    if (isMeaningful(organicClass)) {
      secondary.push({ label: "Humus", value: organicClass });
    }
    const carbonate = firstText(interval, [
      "carbonateClass",
      "carbonateContentClass",
    ]);
    if (isMeaningful(carbonate) && !carbonate.toLowerCase().startsWith("kalkloos")) {
      secondary.push({ label: "Kalk", value: carbonate });
    }
    const riping = firstText(interval, ["ripingClass"]);
    if (isMeaningful(riping)) {
      secondary.push({ label: "Rijping", value: riping });
    }
    const structure = firstText(interval, ["structure"]);
    if (isMeaningful(structure)) {
      secondary.push({ label: "Structuur", value: structure });
    }
    const horizon = firstText(interval, ["horizonCode"]);
    if (isMeaningful(horizon)) {
      secondary.push({ label: "Horizont", value: horizon });
    }

    layers.push({
      top_depth: top,
      base_depth: bot,
      soil_name: soil,
      colour,
      description,
      secondary: secondary.length > 0 ? secondary : undefined,
    });
  }
  // Sort by top depth — XML order is usually correct, but be defensive.
  layers.sort((a, b) => a.top_depth - b.top_depth);

  // Verbatim extra metadata — same idea as Cpt's `metadata.extra`. We
  // walk every leaf element with a primitive text value and collect a
  // flat key→value map. The structured fields above stay top-level so
  // the standard UI rows don't double-render them.
  const EXTRA_SKIP = new Set([
    "geometry",
    "pos",
    "envelope",
    "lowercorner",
    "uppercorner",
    "fielddatum",
  ]);
  const extra: Record<string, string> = {};
  const collectExtra = (n: Element) => {
    for (const child of Array.from(n.children)) {
      const local = (child.localName ?? "").toLowerCase();
      if (EXTRA_SKIP.has(local)) continue;
      // Element met alleen tekst-content → top-level metadata.
      if (
        child.children.length === 0 &&
        child.textContent &&
        child.textContent.trim().length > 0 &&
        child.textContent.trim().length < 200
      ) {
        const key = child.localName ?? local;
        const value = child.textContent.trim();
        if (!(key in extra)) extra[key] = value;
      } else if (child.children.length > 0) {
        collectExtra(child);
      }
    }
  };
  const root = dom.documentElement;
  if (root) collectExtra(root);

  const metadata = {
    project_name: firstText(dom, ["projectName", "researchProject"]),
    project_number: firstText(dom, ["projectNumber", "objectReference"]),
    description_date: firstText(dom, ["descriptionReportDate", "researchReportDate"]),
    start_date: firstText(dom, ["boringStartDate", "researchStartDate"]),
    end_date: firstText(dom, ["boringEndDate", "researchEndDate"]),
    quality_regime: firstText(dom, ["qualityRegime"]),
    description_procedure: firstText(dom, ["descriptionProcedure"]),
    bore_method: firstText(dom, ["boringProcedure", "boringMethod"]),
    accountable_party: firstText(dom, ["objectIdAccountableParty"]),
    delivered_via: firstText(dom, ["deliveryContext"]),
    source_file: sourceFile,
    extra,
  };

  return { id, position, final_depth, layers, metadata };
}

/**
 * Colour lookup for the strip-log fill. Matches the conventional Dutch
 * geotechnical symbol palette.
 *
 * Robust against BRO camelCase names (e.g. `sterkSiltigeKlei`,
 * `mineraalarmVeen`, `zwakSiltigZand`) by lowercasing the whole string
 * and probing for the dominant noun substring. Falls back to a neutral
 * gray for soils we don't recognise so the strip still reads.
 */
export function soilColour(soilName: string | undefined): string {
  const lc = (soilName ?? "").toLowerCase();
  if (!lc) return "#D4D4D8";

  // Order matters: more-specific matches must come first. "klei" must
  // beat the (false) "silt" inside "siltigeKlei", etc.
  if (lc.includes("veen") || lc.includes("peat")) return "#7C2D12"; // peat — dark brown
  if (lc.includes("klei") || lc.includes("clay")) return "#4CAF50"; // clay — green
  if (lc.includes("zand") || lc.includes("sand")) return "#FACC15"; // sand — yellow
  if (lc.includes("grind") || lc.includes("gravel")) return "#D97706"; // gravel — amber
  if (lc.includes("leem") || lc.includes("loam") || lc.includes("silt"))
    return "#8BC34A"; // silt/loam — light green
  if (lc.includes("puin") || lc.includes("steen") || lc.includes("baksteen"))
    return "#A1A1AA"; // rubble — gray
  if (lc.includes("water")) return "#60A5FA";
  return "#D4D4D8";
}

/**
 * Soil mixture parser — splits Dutch composite names like
 * `zwakSiltigeKlei`, `matigZandigeKlei`, `sterkSiltigZand` into:
 *   - `main`: dominant noun (e.g. "klei", "zand")
 *   - `admixture`: bijmenging noun (e.g. "silt", "zand")
 *   - `strength`: "zwak" | "matig" | "sterk" — drives the visual width
 *     ratio between main and bijmenging on the strip log.
 *
 * Single-soil names ("puin", "veen") yield only `main`. Unknown shapes
 * fall back to treating the whole string as main.
 */
export interface SoilMix {
  main: string;
  admixture?: string;
  strength?: "zwak" | "matig" | "sterk";
}
export function parseSoilMix(name: string | undefined): SoilMix {
  if (!name) return { main: "" };
  const lower = name.toLowerCase();

  // Names without a recognisable strength prefix → single soil. Catches
  // "puin", "veen", "klei", "zand", "grind", as well as English forms.
  for (const pre of ["zwak", "matig", "sterk"] as const) {
    if (lower.startsWith(pre)) {
      const body = name.slice(pre.length);
      // Split the body on the second capital letter — first segment is
      // the adjective (Siltige / Zandige / Siltig / Zandig / Humeus),
      // the rest is the main noun. Falls back to body-as-main when no
      // adjective boundary exists.
      const ups: number[] = [];
      for (let i = 0; i < body.length; i++) {
        const c = body[i];
        if (c >= "A" && c <= "Z") ups.push(i);
      }
      if (ups.length >= 2) {
        const adj = body.slice(ups[0], ups[1]).toLowerCase();
        const main = body.slice(ups[1]).toLowerCase();
        const admixture = mapAdjectiveToSoil(adj);
        return { main, admixture, strength: pre };
      }
      return { main: body.toLowerCase(), strength: pre };
    }
  }
  return { main: lower };
}

/** Map a Dutch adjective ("Siltige", "Zandig", "Humeus") to the base
 *  soil noun used by `soilColour` / `soilPattern`. */
function mapAdjectiveToSoil(adj: string): string {
  if (adj.startsWith("silt")) return "silt";
  if (adj.startsWith("zand")) return "zand";
  if (adj.startsWith("klei")) return "klei";
  if (adj.startsWith("veen") || adj.startsWith("organisch")) return "veen";
  if (adj.startsWith("grind")) return "grind";
  if (adj.startsWith("humeus") || adj.startsWith("humus")) return "humeus";
  return adj;
}

/** Width-fraction of the main soil band given the mixture strength.
 *  Higher strength = bigger admixture column. Returns 1.0 if there is
 *  no admixture so the renderer can skip the split. */
export function mainWidthFraction(mix: SoilMix): number {
  if (!mix.admixture) return 1;
  switch (mix.strength) {
    case "zwak":  return 0.78;
    case "matig": return 0.62;
    case "sterk": return 0.48;
    default:      return 0.7;
  }
}

/**
 * SVG-pattern fill for a soil noun — used inside the strip log to
 * render layers in the standard NL boorprofiel cartografie (groene
 * arcering voor klei, gele puntjes voor zand, grijze puntjes voor
 * silt, donkerbruine balken voor veen, blauwe vlakke kleur voor
 * puin, amberkleurige cirkeltjes voor grind).
 *
 * Returns a CSS `background` value (a `url(data:image/svg+xml;...)`).
 * Falls back to the solid `soilColour` swatch for unknown nouns.
 */
export function soilPattern(soilName: string | undefined): string {
  const lc = (soilName ?? "").toLowerCase();
  if (!lc) return soilColour(soilName);
  if (lc.includes("veen") || lc.includes("peat")) return PATTERN_VEEN;
  if (lc.includes("klei") || lc.includes("clay")) return PATTERN_KLEI;
  if (lc.includes("zand") || lc.includes("sand")) return PATTERN_ZAND;
  if (lc.includes("grind") || lc.includes("gravel")) return PATTERN_GRIND;
  if (lc.includes("leem") || lc.includes("loam") || lc.includes("silt"))
    return PATTERN_SILT;
  if (lc.includes("puin") || lc.includes("steen") || lc.includes("baksteen"))
    return PATTERN_PUIN;
  if (lc.includes("humeus") || lc.includes("humus")) return PATTERN_HUMUS;
  if (lc.includes("water")) return "#60A5FA";
  return soilColour(soilName);
}

// Tile-able SVG patterns. Encoded once at module load and re-used as
// CSS `background` values. The colors mirror `soilColour` so the
// solid-fallback swatches in legends still match.
function svgUrl(svg: string): string {
  // Percent-encode the bits CSS-data-URLs care about. Quotes inside the
  // SVG are intentionally double-encoded so the outer url("...") parse
  // doesn't choke.
  const enc = encodeURIComponent(svg)
    .replace(/'/g, "%27")
    .replace(/"/g, "%22");
  return `url("data:image/svg+xml;utf8,${enc}")`;
}
// Klei — diagonale donkergroene arcering op groene basis.
const PATTERN_KLEI = svgUrl(
  `<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14'>` +
  `<rect width='14' height='14' fill='#4CAF50'/>` +
  `<path d='M-2 16 L16 -2 M-2 8 L8 -2 M6 16 L16 6' stroke='#1F5D1F' stroke-width='1.4' fill='none'/>` +
  `</svg>`,
);
// Zand — gele basis met donker-amber puntjes.
const PATTERN_ZAND = svgUrl(
  `<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12'>` +
  `<rect width='12' height='12' fill='#FACC15'/>` +
  `<circle cx='2' cy='3' r='1' fill='#92400E'/>` +
  `<circle cx='8' cy='5' r='1' fill='#92400E'/>` +
  `<circle cx='5' cy='9' r='1' fill='#92400E'/>` +
  `<circle cx='10' cy='10' r='1' fill='#92400E'/>` +
  `</svg>`,
);
// Silt — lichtgrijs/groen met fijne puntjes.
const PATTERN_SILT = svgUrl(
  `<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'>` +
  `<rect width='10' height='10' fill='#D4D4D8'/>` +
  `<circle cx='2' cy='2' r='0.6' fill='#52525B'/>` +
  `<circle cx='5' cy='4' r='0.6' fill='#52525B'/>` +
  `<circle cx='8' cy='3' r='0.6' fill='#52525B'/>` +
  `<circle cx='3' cy='7' r='0.6' fill='#52525B'/>` +
  `<circle cx='7' cy='8' r='0.6' fill='#52525B'/>` +
  `</svg>`,
);
// Veen — donkerbruine basis met horizontale "vezel"-streepjes.
const PATTERN_VEEN = svgUrl(
  `<svg xmlns='http://www.w3.org/2000/svg' width='14' height='10'>` +
  `<rect width='14' height='10' fill='#7C2D12'/>` +
  `<path d='M0 3 H14 M0 7 H14' stroke='#451A03' stroke-width='1.1'/>` +
  `</svg>`,
);
// Grind — amber basis met grotere cirkels.
const PATTERN_GRIND = svgUrl(
  `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'>` +
  `<rect width='16' height='16' fill='#D97706'/>` +
  `<circle cx='4' cy='4' r='2' fill='none' stroke='#7C2D12' stroke-width='1.2'/>` +
  `<circle cx='11' cy='8' r='2' fill='none' stroke='#7C2D12' stroke-width='1.2'/>` +
  `<circle cx='6' cy='12' r='2' fill='none' stroke='#7C2D12' stroke-width='1.2'/>` +
  `</svg>`,
);
// Puin — vlak licht-blauw (zoals in de screenshot voor "puin").
const PATTERN_PUIN = "#2563EB";
// Humus — donkerbruin met geel-groene tinten.
const PATTERN_HUMUS = svgUrl(
  `<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12'>` +
  `<rect width='12' height='12' fill='#65A30D'/>` +
  `<path d='M0 4 L12 4 M0 9 L12 9' stroke='#365314' stroke-width='1'/>` +
  `</svg>`,
);

/**
 * Quick sniff to decide whether a piece of XML is a BHR-O / BHR-G-O /
 * BHR-GT-O borehole document (and therefore should open as a Bore tab,
 * not a CPT tab). Uses a stringy substring search so we don't have to
 * DOM-parse the file just to route it.
 */
export function looksLikeBoringXml(xml: string): boolean {
  return (
    /<\s*BHR(_GT)?(_G)?_O\b/.test(xml) ||
    /<\s*[\w-]+:BHR(_GT)?(_G)?_O\b/.test(xml) ||
    /<BHR_O\b/.test(xml)
  );
}
