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
    description_date?: string;
    quality_regime?: string;
    delivered_via?: string;
    source_file: string;
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

  const metadata = {
    project_name: firstText(dom, ["projectName"]),
    description_date: firstText(dom, ["descriptionReportDate", "researchReportDate"]),
    quality_regime: firstText(dom, ["qualityRegime"]),
    delivered_via: firstText(dom, ["deliveryContext"]),
    source_file: sourceFile,
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
