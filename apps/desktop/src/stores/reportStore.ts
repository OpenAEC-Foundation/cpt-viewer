import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type {
  ReportData,
  Section,
  ContentBlock,
  TemplateInfo,
  TenantInfo,
  BrandConfig,
} from '../types/report';
import { createBlankReport } from '../types/report';

export type ReportPageSize = 'A4' | 'A3';
export type ReportOrientation = 'portrait' | 'landscape';

/** Section toggles — each maps to an optional block in the generated PDF. */
export interface ReportSectionToggles {
  cover: boolean;
  colofon: boolean;
  toc: boolean;
  introduction: boolean;
  content: boolean;
  appendices: boolean;
  backcover: boolean;
}

export const ALL_SECTIONS_ON: ReportSectionToggles = {
  cover: true,
  colofon: true,
  toc: true,
  introduction: true,
  content: true,
  appendices: true,
  backcover: true,
};

/** Which Rust backend to use for PDF generation. */
export type ReportEngine =
  | 'local'   // Template-bundled minimal engine (src-tauri/src/pdf/)
  | 'openaec'; // openaec-core engine (production-grade, from openaec-reports workspace)

interface ReportState {
  // Current report
  report: ReportData;
  activeSectionIndex: number | null;
  activeBlockIndex: number | null;

  // Display / output settings
  pageSize: ReportPageSize;
  orientation: ReportOrientation;
  sectionToggles: ReportSectionToggles;
  engine: ReportEngine;

  // Tenant & template
  tenant: string;
  tenants: TenantInfo[];
  templates: TemplateInfo[];
  brand: BrandConfig | null;

  // PDF preview
  pdfBytes: Uint8Array | null;
  pdfBlobUrl: string | null;
  generatedAt: number | null;
  isGenerating: boolean;
  error: string | null;

  // Actions — Report
  setReport: (report: ReportData) => void;
  updateMetadata: (fields: Partial<ReportData>) => void;
  addSection: (section: Section) => void;
  updateSection: (index: number, section: Partial<Section>) => void;
  removeSection: (index: number) => void;
  addBlock: (sectionIndex: number, block: ContentBlock) => void;
  updateBlock: (sectionIndex: number, blockIndex: number, block: ContentBlock) => void;
  removeBlock: (sectionIndex: number, blockIndex: number) => void;
  setActiveSection: (index: number | null) => void;
  setActiveBlock: (index: number | null) => void;

  // Actions — Page & toggles
  setPageSize: (size: ReportPageSize) => void;
  setOrientation: (orientation: ReportOrientation) => void;
  setSectionToggle: (key: keyof ReportSectionToggles, value: boolean) => void;
  resetSectionToggles: () => void;
  setEngine: (engine: ReportEngine) => void;

  // Actions — Tenant
  setTenant: (tenant: string) => void;
  loadTenants: () => Promise<void>;
  loadTemplates: () => Promise<void>;
  loadBrand: () => Promise<void>;

  // Actions — PDF
  generatePdf: () => Promise<void>;
  savePdf: (path: string) => Promise<void>;
  clearPdf: () => void;
}

export const useReportStore = create<ReportState>((set, get) => ({
  report: createBlankReport(),
  activeSectionIndex: null,
  activeBlockIndex: null,
  pageSize: 'A4',
  orientation: 'portrait',
  sectionToggles: { ...ALL_SECTIONS_ON },
  engine: 'openaec',
  tenant: 'openaec_foundation',
  tenants: [],
  templates: [],
  brand: null,
  pdfBytes: null,
  pdfBlobUrl: null,
  generatedAt: null,
  isGenerating: false,
  error: null,

  setReport: (report) => set({ report }),

  updateMetadata: (fields) =>
    set((state) => ({
      report: { ...state.report, ...fields },
    })),

  addSection: (section) =>
    set((state) => ({
      report: {
        ...state.report,
        sections: [...state.report.sections, section],
      },
    })),

  updateSection: (index, updates) =>
    set((state) => {
      const sections = [...state.report.sections];
      sections[index] = { ...sections[index]!, ...updates };
      return { report: { ...state.report, sections } };
    }),

  removeSection: (index) =>
    set((state) => ({
      report: {
        ...state.report,
        sections: state.report.sections.filter((_, i) => i !== index),
      },
    })),

  addBlock: (sectionIndex, block) =>
    set((state) => {
      const sections = [...state.report.sections];
      const section = { ...sections[sectionIndex]! };
      section.blocks = [...section.blocks, block];
      sections[sectionIndex] = section;
      return { report: { ...state.report, sections } };
    }),

  updateBlock: (sectionIndex, blockIndex, block) =>
    set((state) => {
      const sections = [...state.report.sections];
      const section = { ...sections[sectionIndex]! };
      section.blocks = [...section.blocks];
      section.blocks[blockIndex] = block;
      sections[sectionIndex] = section;
      return { report: { ...state.report, sections } };
    }),

  removeBlock: (sectionIndex, blockIndex) =>
    set((state) => {
      const sections = [...state.report.sections];
      const section = { ...sections[sectionIndex]! };
      section.blocks = section.blocks.filter((_, i) => i !== blockIndex);
      sections[sectionIndex] = section;
      return { report: { ...state.report, sections } };
    }),

  setActiveSection: (index) => set({ activeSectionIndex: index }),
  setActiveBlock: (index) => set({ activeBlockIndex: index }),

  setPageSize: (size) =>
    set((state) => ({
      pageSize: size,
      report: { ...state.report, format: size },
    })),

  setOrientation: (orientation) =>
    set((state) => ({
      orientation,
      report: {
        ...state.report,
        orientation: orientation === 'portrait' ? 'Portrait' : 'Landscape',
      },
    })),

  setSectionToggle: (key, value) =>
    set((state) => ({
      sectionToggles: { ...state.sectionToggles, [key]: value },
    })),

  resetSectionToggles: () => set({ sectionToggles: { ...ALL_SECTIONS_ON } }),

  setEngine: (engine) => set({ engine }),

  setTenant: (tenant) => {
    set({ tenant });
    get().loadTemplates();
    get().loadBrand();
  },

  loadTenants: async () => {
    try {
      const tenants = await invoke<TenantInfo[]>('list_tenants');
      set({ tenants });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadTemplates: async () => {
    try {
      const { tenant } = get();
      const templates = await invoke<TemplateInfo[]>('list_templates', { tenant });
      set({ templates });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadBrand: async () => {
    try {
      const { tenant } = get();
      const brand = await invoke<BrandConfig>('get_brand', { tenant });
      set({ brand });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  generatePdf: async () => {
    set({ isGenerating: true, error: null });
    try {
      const { report, tenant, engine, pdfBlobUrl: oldUrl } = get();

      // Route through the chosen engine. 'openaec' is the production
      // engine from openaec-reports; 'local' uses the bundled minimal one.
      const bytes =
        engine === 'openaec'
          ? await invoke<number[]>('engine_generate_pdf', { report })
          : await invoke<number[]>('generate_pdf', { report, tenant });

      const byteArray = new Uint8Array(bytes);

      if (oldUrl) URL.revokeObjectURL(oldUrl);

      const blob = new Blob([byteArray as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      set({
        pdfBytes: byteArray,
        pdfBlobUrl: url,
        generatedAt: Date.now(),
        isGenerating: false,
      });
    } catch (e) {
      set({ error: String(e), isGenerating: false });
    }
  },

  savePdf: async (path: string) => {
    set({ isGenerating: true, error: null });
    try {
      const { report, tenant, engine } = get();
      if (engine === 'openaec') {
        await invoke('engine_save_pdf', { report, path });
      } else {
        await invoke('save_pdf', { report, tenant, path });
      }
      set({ isGenerating: false });
    } catch (e) {
      set({ error: String(e), isGenerating: false });
    }
  },

  clearPdf: () => {
    const { pdfBlobUrl } = get();
    if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    set({ pdfBytes: null, pdfBlobUrl: null, generatedAt: null });
  },
}));
