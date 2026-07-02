// Gedeelde rapport-sectie-selectie — één bron van waarheid voor de
// vinkjes in de rapport-preview én de ribbon-knoppen (Genereer/Open PDF).
//
// Vroeger leefde deze state alleen als useState in ReportPreview: de
// ribbon-knop "Genereer PDF" stuurde daardoor GEEN sections mee en het
// geëxporteerde bestand negeerde stilletjes wat de gebruiker net had
// aangevinkt. Een module-singleton (zelfde patroon als tekeningState)
// deelt de actuele selectie zonder store-verbouwing; ReportPreview
// blijft eigenaar (schrijft), de ribbon leest op klik-moment.

export interface ReportSections {
  cover: boolean;
  coordTable: boolean;
  map: boolean;
  perCpt: boolean;
  sbtLegend: boolean;
  metadata: boolean;
}

export const DEFAULT_SECTIONS: ReportSections = {
  cover: true,
  coordTable: true,
  map: true,
  perCpt: true,
  sbtLegend: false,
  metadata: false,
};

export function sectionsAreDefault(s: ReportSections): boolean {
  return (Object.keys(DEFAULT_SECTIONS) as Array<keyof ReportSections>).every(
    (k) => s[k] === DEFAULT_SECTIONS[k],
  );
}

let current: ReportSections = { ...DEFAULT_SECTIONS };

/** Door ReportPreview aangeroepen bij elke toggle-wijziging. */
export function setCurrentReportSections(s: ReportSections): void {
  current = { ...s };
}

/** Actuele selectie — gelezen door de ribbon op het moment van genereren. */
export function getCurrentReportSections(): ReportSections {
  return { ...current };
}
