import type { Config } from "tailwindcss";

/**
 * Tailwind CSS configuratie met CSS Variable Bridge
 *
 * BELANGRIJK: Dit bestand mapt CSS custom properties uit themes.css
 * naar Tailwind utility classes. Hierdoor volgen domein-componenten
 * automatisch het actieve thema.
 *
 * Gebruik:
 *   bg-surface      → var(--theme-bg)
 *   text-on-surface → var(--theme-text)
 *   bg-accent       → var(--theme-accent)
 *   border-border   → var(--theme-border)
 *
 * NIET doen:
 *   bg-stone-800    → hardcoded, volgt geen thema
 *   text-gray-100   → hardcoded, volgt geen thema
 *   border-slate-600→ hardcoded, volgt geen thema
 *
 * Zie INTEGRATION.md voor uitleg en voorbeelden.
 */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: ["selector", "[data-theme='openaec']"],
  theme: {
    extend: {
      colors: {
        /* ═══════════════════════════════════════════════════════
           CSS VAR BRIDGE — Theme-aware Tailwind tokens
           Deze kleuren volgen automatisch het actieve thema.
           ═══════════════════════════════════════════════════════ */

        // Backgrounds
        surface:        "var(--theme-bg)",
        "surface-alt":  "var(--theme-bg-lighter)",
        "surface-doc":  "var(--theme-docbar-bg)",
        content:        "var(--theme-content-bg)",

        // Text
        "on-surface":           "var(--theme-text)",
        "on-surface-secondary": "var(--theme-text-secondary)",
        "on-surface-muted":     "var(--theme-text-muted)",
        "on-surface-faint":     "var(--theme-text-faint)",

        // Accent (brand color)
        accent:         "var(--theme-accent)",
        "accent-hover": "var(--theme-accent-hover)",
        "on-accent":    "var(--theme-accent-text)",
        "accent-soft":  "var(--theme-accent-soft)",
        "accent-tint":  "var(--theme-accent-tint)",

        // Borders
        border:         "var(--theme-border)",
        "border-subtle": "var(--theme-border-subtle)",

        // Interactive states
        hover:          "var(--theme-hover)",
        "hover-strong": "var(--theme-hover-strong)",
        active:         "var(--theme-active)",

        // Semantic
        danger:         "var(--theme-danger-color)",
        "danger-hover": "var(--theme-danger-hover)",
        focus:          "var(--theme-focus-color)",

        // Buttons
        "btn-primary":        "var(--theme-btn-primary-bg)",
        "btn-primary-text":   "var(--theme-btn-primary-text)",
        "btn-primary-hover":  "var(--theme-btn-primary-hover-bg)",
        "btn-secondary":      "var(--theme-btn-secondary-bg)",
        "btn-secondary-text": "var(--theme-btn-secondary-text)",
        "btn-secondary-hover":"var(--theme-btn-secondary-hover-bg)",

        /* ═══════════════════════════════════════════════════════
           DESIGN SYSTEM — Vaste brand kleuren
           Gebruik voor elementen die NIET per thema variëren.
           ═══════════════════════════════════════════════════════ */
        "deep-forge":      "#36363E",
        "night-build":     "#2A2A32",
        "signal-orange":   "#EA580C",
        "warm-gold":       "#F59E0B",
        "scaffold-gray":   "#A1A1AA",
        "blueprint-white": "#FAFAF9",
        concrete:          "#F5F5F4",
        amber: {
          DEFAULT: "#D97706",
        },

        /* ═══════════════════════════════════════════════════════
           DOMAIN TOKENS — Project-specifieke kleuren
           Voeg hier kleuren toe voor jouw domein.

           Voorbeeld (warmteverlies):
             boundary: {
               exterior: "var(--domain-boundary-exterior)",
               unheated: "var(--domain-boundary-unheated)",
               ground:   "var(--domain-boundary-ground)",
             },
             chart: {
               1: "var(--domain-chart-1)",
               2: "var(--domain-chart-2)",
               3: "var(--domain-chart-3)",
             },
           ═══════════════════════════════════════════════════════ */
      },

      fontFamily: {
        heading: ['"Space Grotesk"', "system-ui", "sans-serif"],
        body: ['"Inter"', "system-ui", "sans-serif"],
        code: ['"JetBrains Mono"', "monospace"],
      },

      borderRadius: {
        sm: "4px",
        md: "8px",
        lg: "12px",
      },

      boxShadow: {
        dialog: "var(--theme-dialog-shadow)",
        panel:  "var(--theme-panel-shadow)",
        popover: "var(--theme-popover-shadow)",
      },
    },
  },
  plugins: [],
} satisfies Config;
