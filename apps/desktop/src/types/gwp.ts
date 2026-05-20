/**
 * Grondwatermonitoringput (GMW) types + XML-parser.
 *
 * Werkt op de BRO publieke REST API (https://publiek.broservices.nl/gm/gmw/v1)
 * en op losse GMW-XML-bestanden die de gebruiker uit BROloket heeft
 * gedownload.
 *
 * Gerelateerde domeinen die we LATER kunnen ophalen:
 *   - GLD (Grondwaterstandonderzoek): tijdseries per monitoring-tube
 *   - GMN (Grondwatermonitoringnet):  groepering van putten in netten
 *   - GAR (Samenstellingsonderzoek):  waterkwaliteit
 */

export interface GwpMonitoringTube {
  /** Volgnummer binnen de put (1-based). */
  tubeNumber: number;
  /** Materiaal (peHighDensity, pvc, etc.) — vertaalde Nederlandse code. */
  material?: string;
  /** Buis-bovenkant in m t.o.v. NAP. */
  tubeTopPositionNap?: number;
  /** Diameter buis-bovenkant in mm. */
  tubeTopDiameterMm?: number;
  /** Lengte van het filter (screen) in m. */
  screenLengthM?: number;
  /** Bovenkant filter NAP. */
  screenTopPositionNap?: number;
  /** Onderkant filter NAP. */
  screenBottomPositionNap?: number;
  /** Status (gebruiksklaar, buitenGebruik, etc.). */
  tubeStatus?: string;
}

export interface Gwp {
  /** BRO-id (b.v. GMW000000016202). */
  broId: string;
  /** Beheerder (KvK-nummer of organisatie). */
  deliveryAccountableParty?: string;
  /** Kwaliteitsregime (IMBRO / IMBRO/A). */
  qualityRegime?: string;
  /** RD-coördinaten (X, Y in meter). */
  rdX?: number;
  rdY?: number;
  /** WGS84-coördinaten — afgeleid uit standardizedLocation. */
  lat?: number;
  lon?: number;
  /** Maaiveld-positie in m NAP (b.v. -0.45 voor 45cm onder NAP). */
  groundLevelNap?: number;
  /** Datum waarop de put is geconstrueerd (ISO yyyy-mm-dd). */
  constructionDate?: string;
  /** Aantal monitoringbuizen (1 of meerdere filters per put). */
  numberOfMonitoringTubes?: number;
  /** Lokale put-code (b.v. GMW38W115904) — handig voor cross-ref met
   *  archieven van waterschap/provincie. */
  wellCode?: string;
  /** Eigenaar (KvK-nummer). */
  owner?: string;
  /** Putkop-bescherming (potNietWaterdicht / pot / etc.). */
  wellHeadProtector?: string;
  /** Initiële functie (stand / kwaliteit / etc.). */
  initialFunction?: string;
  /** De individuele monitoring-tubes (= filters) van deze put. */
  tubes: GwpMonitoringTube[];
}

/**
 * Sniff: is dit XML een GMW-dispatch-document?
 * Werkt op de eerste paar KB — we hoeven niet de hele payload te parsen.
 */
export function looksLikeGwpXml(xml: string): boolean {
  return (
    /<\s*GMW_PO\b/.test(xml) ||
    /<\s*[\w-]+:GMW_PO\b/.test(xml) ||
    /<\s*GMW_O\b/.test(xml) ||
    xml.includes("xsd/dsgmw/") ||
    xml.includes("xsd/gmwcommon/")
  );
}

/**
 * Parse een BRO GMW XML-dispatch-document naar onze Gwp-struct.
 * Gebruikt DOMParser zodat namespace-handling geen pijn doet — we
 * checken op localName.
 */
export function parseGmwXml(xml: string): Gwp | null {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return null;

  // GMW_PO is de wrapper voor de put-data (Producten Object).
  const root =
    findByLocalName(doc.documentElement, "GMW_PO") ??
    findByLocalName(doc.documentElement, "GMW_O");
  if (!root) return null;

  const broId = textByLocalName(root, "broId") ?? "";
  if (!broId) return null;

  const gwp: Gwp = {
    broId,
    deliveryAccountableParty: textByLocalName(root, "deliveryAccountableParty"),
    qualityRegime: textByLocalName(root, "qualityRegime"),
    constructionDate: textByLocalName(
      findByLocalName(root, "wellConstructionDate") ?? root,
      "date",
    ),
    numberOfMonitoringTubes: parseIntOrUndefined(
      textByLocalName(root, "numberOfMonitoringTubes"),
    ),
    wellCode: textByLocalName(root, "wellCode"),
    owner: textByLocalName(root, "owner"),
    wellHeadProtector: textByLocalName(root, "wellHeadProtector"),
    initialFunction: textByLocalName(root, "initialFunction"),
    tubes: [],
  };

  // RD-coordinaten zitten in deliveredLocation/location/pos.
  const deliveredLoc = findByLocalName(root, "deliveredLocation");
  if (deliveredLoc) {
    const pos = textByLocalName(deliveredLoc, "pos");
    if (pos) {
      const parts = pos.trim().split(/\s+/).map(Number);
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        gwp.rdX = parts[0];
        gwp.rdY = parts[1];
      }
    }
  }
  // WGS84 in standardizedLocation/location/pos (lat lon volgorde).
  const stdLoc = findByLocalName(root, "standardizedLocation");
  if (stdLoc) {
    const pos = textByLocalName(stdLoc, "pos");
    if (pos) {
      const parts = pos.trim().split(/\s+/).map(Number);
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        gwp.lat = parts[0];
        gwp.lon = parts[1];
      }
    }
  }
  // Ground-level NAP.
  const verticalPos = findByLocalName(root, "deliveredVerticalPosition");
  if (verticalPos) {
    const gl = textByLocalName(verticalPos, "groundLevelPosition");
    if (gl) {
      const v = parseFloat(gl);
      if (!isNaN(v)) gwp.groundLevelNap = v;
    }
  }

  // Monitoring-tubes — kan 1 of meerdere zijn.
  const tubeEls = findAllByLocalName(root, "monitoringTube");
  for (const tubeEl of tubeEls) {
    const tube: GwpMonitoringTube = {
      tubeNumber:
        parseIntOrUndefined(textByLocalName(tubeEl, "tubeNumber")) ?? 0,
      material: textByLocalName(tubeEl, "tubeMaterial"),
      tubeTopPositionNap: parseFloatOrUndefined(
        textByLocalName(tubeEl, "tubeTopPosition"),
      ),
      tubeTopDiameterMm: parseFloatOrUndefined(
        textByLocalName(tubeEl, "tubeTopDiameter"),
      ),
      tubeStatus: textByLocalName(tubeEl, "tubeStatus"),
    };
    const screen = findByLocalName(tubeEl, "screen");
    if (screen) {
      tube.screenLengthM = parseFloatOrUndefined(
        textByLocalName(screen, "screenLength"),
      );
      tube.screenTopPositionNap = parseFloatOrUndefined(
        textByLocalName(screen, "screenTopPosition"),
      );
      tube.screenBottomPositionNap = parseFloatOrUndefined(
        textByLocalName(screen, "screenBottomPosition"),
      );
    }
    gwp.tubes.push(tube);
  }

  return gwp;
}

// ── Helpers ─────────────────────────────────────────────────────

function findByLocalName(root: Element, name: string): Element | null {
  // Zoek in alle descendants op localName (negeert namespace-prefix).
  const all = root.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === name) return all[i];
  }
  return null;
}

function findAllByLocalName(root: Element, name: string): Element[] {
  const all = root.getElementsByTagName("*");
  const out: Element[] = [];
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === name) out.push(all[i]);
  }
  return out;
}

function textByLocalName(root: Element, name: string): string | undefined {
  const el = findByLocalName(root, name);
  return el?.textContent?.trim() || undefined;
}

function parseIntOrUndefined(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const v = parseInt(s, 10);
  return isNaN(v) ? undefined : v;
}

function parseFloatOrUndefined(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const v = parseFloat(s);
  return isNaN(v) ? undefined : v;
}
