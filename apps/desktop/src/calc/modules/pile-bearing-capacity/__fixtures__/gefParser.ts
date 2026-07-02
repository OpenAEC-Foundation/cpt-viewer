// Minimale GEF-parser voor verification-tests. Leest de essentiële
// kolommen (depth + qc) uit een GEF-bestand en bouwt een Cpt-achtig
// object dat door computePile() kan worden verwerkt.
//
// Voor productie-gebruik draait de echte parser in Rust (cpt-core);
// deze TS-versie bestaat ALLEEN voor unit-tests zodat we niet via
// een Tauri-roundtrip de GEFs hoeven te laden. Ondersteunt het
// happy-path GEF-formaat (3BM/Van Dijk Geotechniek style):
//   - ASCII data
//   - COLUMNINFO definieert volgorde van kolommen (we zoeken de
//     kolom met "sondeerlengte" voor depth en "Puntdruk" voor qc)
//   - COLUMNVOID = -9999 (skip die rijen)
//   - ZID = 31000, <ground_level_nap>, <accuracy>
//   - #EOH markeert het einde van de header

import type { Cpt } from "../../../../types/cpt";

interface ParsedHeader {
  groundLevelNap: number;
  depthColIdx: number;
  qcColIdx: number;
  fsColIdx: number;  // -1 als niet aanwezig
  rfColIdx: number;  // -1 als niet aanwezig (wrijvingsgetal %)
  voidValues: Record<number, number>; // 1-based kolom-idx → void waarde
  separator: string;
}

function parseHeader(headerLines: string[]): ParsedHeader {
  let groundLevelNap = 0;
  let depthColIdx = -1;
  let qcColIdx = -1;
  let fsColIdx = -1;
  let rfColIdx = -1;
  const voidValues: Record<number, number> = {};
  let separator = " "; // default — whitespace

  for (const raw of headerLines) {
    const line = raw.trim();
    if (line.startsWith("#ZID=")) {
      // "#ZID= 31000, 0.84, 0.04" → ground = 0.84
      const parts = line.slice(5).split(",").map((s) => s.trim());
      if (parts.length >= 2) {
        const n = Number(parts[1]);
        if (Number.isFinite(n)) groundLevelNap = n;
      }
    } else if (line.startsWith("#COLUMNINFO=")) {
      // "#COLUMNINFO= 1, m, sondeerlengte, 1"        → col 1 = depth
      // "#COLUMNINFO= 2, MPa, Puntdruk, 2"            → col 2 = qc
      // "#COLUMNINFO= 3, Mpa, Lokale wrijving, 3"     → col 3 = fs
      // "#COLUMNINFO= 8, %, Wrijvingsgetal, 4"        → col 8 = rf
      const parts = line.slice(12).split(",").map((s) => s.trim());
      if (parts.length >= 4) {
        const colIdx = Number(parts[0]);
        const label = parts[2].toLowerCase();
        if (label.includes("gecorrigeerde diepte")) {
          // Heltekorrectie (GEF-grootheid 11) — de échte verticale diepte.
          // Heeft ALTIJD voorrang op sondeerlengte: bij scheefstand is de
          // sondeerlengte groter dan de diepte, waardoor de 4D/8D-
          // trajecten anders bemonsterd worden (1-3% afwijking op
          // qc;I/II/III t.o.v. de externe referentie-berekening).
          depthColIdx = colIdx;
        } else if (
          (label.includes("sondeerlengte") || label.includes("depth")) &&
          depthColIdx < 1
        ) {
          // Fallback wanneer er geen gecorrigeerde-diepte-kolom is.
          depthColIdx = colIdx;
        } else if (label.includes("puntdruk") || label === "qc") {
          qcColIdx = colIdx;
        } else if (label.includes("lokale wrijving") || label === "fs") {
          fsColIdx = colIdx;
        } else if (label.includes("wrijvingsgetal") || label === "rf") {
          rfColIdx = colIdx;
        }
      }
    } else if (line.startsWith("#COLUMNVOID=")) {
      // "#COLUMNVOID= 1, -9999.000000"
      const parts = line.slice(12).split(",").map((s) => s.trim());
      if (parts.length >= 2) {
        const colIdx = Number(parts[0]);
        const voidVal = Number(parts[1]);
        if (Number.isFinite(colIdx) && Number.isFinite(voidVal)) {
          voidValues[colIdx] = voidVal;
        }
      }
    } else if (line.startsWith("#COLUMNSEPARATOR=")) {
      separator = line.slice(17).trim();
    }
  }

  if (depthColIdx < 1 || qcColIdx < 1) {
    throw new Error(
      `GEF parse: kon depth/qc kolommen niet vinden (depth=${depthColIdx}, qc=${qcColIdx})`,
    );
  }
  return { groundLevelNap, depthColIdx, qcColIdx, fsColIdx, rfColIdx, voidValues, separator };
}

export function parseGef(content: string, idHint: string): Cpt {
  const lines = content.split(/\r?\n/);
  const eohIdx = lines.findIndex((l) => l.trim().startsWith("#EOH"));
  if (eohIdx < 0) throw new Error("GEF parse: geen #EOH gevonden");

  const header = parseHeader(lines.slice(0, eohIdx));
  const dataLines = lines.slice(eohIdx + 1).filter((l) => l.trim().length > 0);

  // Splitter: default whitespace (handles spatie + tab); custom als #COLUMNSEPARATOR
  // expliciet iets anders zegt.
  const splitRe = header.separator === " "
    ? /\s+/
    : new RegExp(header.separator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  const points = dataLines
    .map((line) => {
      const cols = line.trim().split(splitRe).filter((s) => s.length > 0);
      const depth = Number(cols[header.depthColIdx - 1]);
      const qc = Number(cols[header.qcColIdx - 1]);
      if (!Number.isFinite(depth) || !Number.isFinite(qc)) return null;
      // Filter void-waarden.
      const depthVoid = header.voidValues[header.depthColIdx];
      const qcVoid = header.voidValues[header.qcColIdx];
      if (depthVoid !== undefined && depth === depthVoid) return null;
      if (qcVoid !== undefined && qc === qcVoid) return null;
      // Optional fs / rf — return null als void.
      let fs: number | undefined;
      let rf: number | undefined;
      if (header.fsColIdx > 0) {
        const v = Number(cols[header.fsColIdx - 1]);
        const voidV = header.voidValues[header.fsColIdx];
        if (Number.isFinite(v) && v !== voidV) fs = v < 0 ? 0 : v;
      }
      if (header.rfColIdx > 0) {
        const v = Number(cols[header.rfColIdx - 1]);
        const voidV = header.voidValues[header.rfColIdx];
        if (Number.isFinite(v) && v !== voidV) rf = v < 0 ? 0 : v;
      }
      return {
        depth,
        depth_nap: header.groundLevelNap - depth,
        qc: qc < 0 ? 0 : qc, // clip negatieve qc (meetfouten) op 0
        ...(fs !== undefined ? { fs } : {}),
        ...(rf !== undefined ? { rf } : {}),
      };
    })
    .filter((p): p is { depth: number; depth_nap: number; qc: number; fs?: number; rf?: number } => p !== null);

  return {
    id: idHint,
    metadata: {
      source_file: idHint,
      ground_level_nap: header.groundLevelNap,
    },
    points,
  };
}
