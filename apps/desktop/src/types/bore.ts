/** Presentation model for a native-parsed borehole document. */
export interface BorePosition {
  x_rd: number;
  y_rd: number;
  z_nap?: number;
}

export interface BoreLayer {
  top_depth: number;
  base_depth: number;
  soil_name: string;
  colour?: string;
  description?: string;
  secondary?: { label: string; value: string }[];
}

export interface Bore {
  id: string;
  position?: BorePosition;
  final_depth?: number;
  layers: BoreLayer[];
  metadata: {
    project_name?: string;
    project_number?: string;
    description_date?: string;
    start_date?: string;
    end_date?: string;
    quality_regime?: string;
    description_procedure?: string;
    bore_method?: string;
    accountable_party?: string;
    delivered_via?: string;
    source_file: string;
    extra?: Record<string, string>;
  };
}

export function soilColour(soilName: string | undefined): string {
  const lc = (soilName ?? "").toLowerCase();
  if (!lc) return "#D4D4D8";
  if (lc.includes("veen") || lc.includes("peat")) return "#7C2D12";
  if (lc.includes("klei") || lc.includes("clay")) return "#4CAF50";
  if (lc.includes("zand") || lc.includes("sand")) return "#FACC15";
  if (lc.includes("grind") || lc.includes("gravel")) return "#D97706";
  if (lc.includes("leem") || lc.includes("loam") || lc.includes("silt"))
    return "#8BC34A";
  if (lc.includes("puin") || lc.includes("steen") || lc.includes("baksteen"))
    return "#A1A1AA";
  if (lc.includes("water")) return "#60A5FA";
  return "#D4D4D8";
}

export interface SoilMix {
  main: string;
  admixture?: string;
  strength?: "zwak" | "matig" | "sterk";
}

export function parseSoilMix(name: string | undefined): SoilMix {
  if (!name) return { main: "" };
  const lower = name.toLowerCase();
  for (const pre of ["zwak", "matig", "sterk"] as const) {
    if (lower.startsWith(pre)) {
      const body = name.slice(pre.length);
      const capitals: number[] = [];
      for (let index = 0; index < body.length; index++) {
        const character = body[index];
        if (character >= "A" && character <= "Z") capitals.push(index);
      }
      if (capitals.length >= 2) {
        const adjective = body.slice(capitals[0], capitals[1]).toLowerCase();
        return {
          main: body.slice(capitals[1]).toLowerCase(),
          admixture: mapAdjectiveToSoil(adjective),
          strength: pre,
        };
      }
      return { main: body.toLowerCase(), strength: pre };
    }
  }
  return { main: lower };
}

function mapAdjectiveToSoil(adjective: string): string {
  if (adjective.startsWith("silt")) return "silt";
  if (adjective.startsWith("zand")) return "zand";
  if (adjective.startsWith("klei")) return "klei";
  if (adjective.startsWith("veen") || adjective.startsWith("organisch")) return "veen";
  if (adjective.startsWith("grind")) return "grind";
  if (adjective.startsWith("humeus") || adjective.startsWith("humus")) return "humeus";
  return adjective;
}

export function mainWidthFraction(mix: SoilMix): number {
  if (!mix.admixture) return 1;
  switch (mix.strength) {
    case "zwak": return 0.78;
    case "matig": return 0.62;
    case "sterk": return 0.48;
    default: return 0.7;
  }
}

export function soilPattern(soilName: string | undefined): string {
  const lc = (soilName ?? "").toLowerCase();
  if (!lc) return soilColour(soilName);
  if (lc.includes("veen") || lc.includes("peat")) return PATTERN_VEEN;
  if (lc.includes("klei") || lc.includes("clay")) return PATTERN_KLEI;
  if (lc.includes("zand") || lc.includes("sand")) return PATTERN_ZAND;
  if (lc.includes("grind") || lc.includes("gravel")) return PATTERN_GRIND;
  if (lc.includes("leem") || lc.includes("loam") || lc.includes("silt")) return PATTERN_SILT;
  if (lc.includes("puin") || lc.includes("steen") || lc.includes("baksteen")) return PATTERN_PUIN;
  if (lc.includes("humeus") || lc.includes("humus")) return PATTERN_HUMUS;
  if (lc.includes("water")) return "#60A5FA";
  return soilColour(soilName);
}

function svgUrl(svg: string): string {
  const encoded = encodeURIComponent(svg).replace(/'/g, "%27").replace(/"/g, "%22");
  return `url("data:image/svg+xml;utf8,${encoded}")`;
}

const PATTERN_KLEI = svgUrl(
  "<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14'><rect width='14' height='14' fill='#4CAF50'/><path d='M-2 16 L16 -2 M-2 8 L8 -2 M6 16 L16 6' stroke='#1F5D1F' stroke-width='1.4' fill='none'/></svg>",
);
const PATTERN_ZAND = svgUrl(
  "<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12'><rect width='12' height='12' fill='#FACC15'/><circle cx='2' cy='3' r='1' fill='#92400E'/><circle cx='8' cy='5' r='1' fill='#92400E'/><circle cx='5' cy='9' r='1' fill='#92400E'/><circle cx='10' cy='10' r='1' fill='#92400E'/></svg>",
);
const PATTERN_SILT = svgUrl(
  "<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'><rect width='10' height='10' fill='#D4D4D8'/><circle cx='2' cy='2' r='.6' fill='#52525B'/><circle cx='5' cy='4' r='.6' fill='#52525B'/><circle cx='8' cy='3' r='.6' fill='#52525B'/><circle cx='3' cy='7' r='.6' fill='#52525B'/><circle cx='7' cy='8' r='.6' fill='#52525B'/></svg>",
);
const PATTERN_VEEN = svgUrl(
  "<svg xmlns='http://www.w3.org/2000/svg' width='14' height='10'><rect width='14' height='10' fill='#7C2D12'/><path d='M0 3 H14 M0 7 H14' stroke='#451A03' stroke-width='1.1'/></svg>",
);
const PATTERN_GRIND = svgUrl(
  "<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><rect width='16' height='16' fill='#D97706'/><circle cx='4' cy='4' r='2' fill='none' stroke='#7C2D12' stroke-width='1.2'/><circle cx='11' cy='8' r='2' fill='none' stroke='#7C2D12' stroke-width='1.2'/><circle cx='6' cy='12' r='2' fill='none' stroke='#7C2D12' stroke-width='1.2'/></svg>",
);
const PATTERN_PUIN = "#2563EB";
const PATTERN_HUMUS = svgUrl(
  "<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12'><rect width='12' height='12' fill='#65A30D'/><path d='M0 4 L12 4 M0 9 L12 9' stroke='#365314' stroke-width='1'/></svg>",
);
