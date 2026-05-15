/** Report data — matches Rust ReportData struct */
export interface ReportData {
  template: string;
  format: 'A4' | 'A3';
  orientation: 'Portrait' | 'Landscape';
  project: string;
  project_number: string;
  address: string;
  client: string;
  architect: string;
  author: string;
  date: string;
  status: string;
  phase: string;
  drawing_type: string;
  drawing_number: string;
  scale: string;
  revision: string;
  sections: Section[];
}

export interface Section {
  title: string;
  level: number;
  blocks: ContentBlock[];
  page_break_before: boolean;
}

export type ContentBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; text: string; level?: number }
  | { type: 'table'; headers: string[]; rows: string[][]; col_widths?: number[] }
  | { type: 'calculation'; formula: string; result: string; unit: string }
  | { type: 'check'; label: string; calculated: number; limit: number; unity: number }
  | { type: 'spacer'; height_mm: number }
  | { type: 'page_break' };

export interface TemplateInfo {
  name: string;
  description: string;
  format: string;
  orientation: string;
}

export interface TenantInfo {
  id: string;
  name: string;
}

export interface BrandColors {
  primary: string;
  secondary: string;
  accent: string;
  [key: string]: string;
}

export interface BrandConfig {
  brand: { name: string; short_name: string; tagline: string };
  colors: BrandColors;
  fonts: Record<string, string>;
}

/** Create a blank report with defaults */
export function createBlankReport(): ReportData {
  const today = new Date().toISOString().split('T')[0]!;
  return {
    template: 'constructie_rapport',
    format: 'A3',
    orientation: 'Landscape',
    project: '',
    project_number: '',
    address: '',
    client: '',
    architect: '',
    author: '',
    date: today,
    status: 'CONCEPT',
    phase: '',
    drawing_type: 'Constructietekening',
    drawing_number: '',
    scale: '1:100',
    revision: '',
    sections: [],
  };
}
