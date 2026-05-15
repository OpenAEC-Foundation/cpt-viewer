# OpenAEC Template — Integratiehandleiding

> Stap-voor-stap handleiding voor het integreren van deze template in een bestaand of nieuw project.
> Gebaseerd op ervaringen met de warmteverliesberekening (eerste productie-integratie, maart 2026).

---

## Overzicht

Deze template levert een complete **applicatie-shell**: TitleBar, Ribbon, Backstage, StatusBar, SettingsDialog, i18n, en theming. Jouw project levert de **domein-componenten**: formulieren, tabellen, grafieken, editors, etc.

```
┌─────────────────────────────────────────────┐
│  TitleBar (template)                        │
├─────────────────────────────────────────────┤
│  Ribbon tabs (template + jouw tabs)         │
├───────┬─────────────────────────┬───────────┤
│ Left  │ Main content area       │ Right     │
│ Panel │ (JOUW DOMEIN)           │ Panel     │
│ (tmpl)│                         │ (tmpl)    │
├───────┴─────────────────────────┴───────────┤
│  StatusBar (template)                       │
└─────────────────────────────────────────────┘
```

**De template is de schil. Jouw code is de vulling.**

---

## Fase 1: Bestanden kopieren

### 1.1 Kopieer deze mappen/bestanden naar `src/`

```
src/
├── themes.css              ← VERPLICHT — alle CSS custom properties
├── store.ts                ← VERPLICHT — Tauri preferences (theme, language)
├── App.css                 ← VERPLICHT — layout styles
├── i18n/
│   ├── config.ts           ← VERPLICHT — i18next setup
│   └── locales/
│       ├── en/             ← 5 namespace bestanden
│       └── nl/             ← 5 namespace bestanden
├── components/
│   ├── TitleBar.tsx + .css ← VERPLICHT
│   ├── StatusBar.tsx + .css← OPTIONEEL (kan verwijderd worden)
│   ├── DocumentBar.tsx+.css← OPTIONEEL (alleen bij multi-document apps)
│   ├── Modal.tsx + .css    ← VERPLICHT (gebruikt door Settings + dialogs)
│   ├── ThemedSelect.tsx+css← VERPLICHT (gebruikt door Settings)
│   ├── ribbon/             ← VERPLICHT (hele map)
│   ├── backstage/          ← VERPLICHT (hele map)
│   ├── settings/           ← VERPLICHT (hele map)
│   └── feedback/           ← OPTIONEEL
```

### 1.2 Dependencies toevoegen

```bash
npm install i18next react-i18next i18next-browser-languagedetector @tauri-apps/plugin-store
```

### 1.3 Tauri configuratie

In `src-tauri/tauri.conf.json`:
```json
{
  "app": {
    "windows": [{
      "decorations": false,
      "visible": false
    }]
  }
}
```

- `decorations: false` — OS window chrome uit, TitleBar.tsx neemt het over
- `visible: false` — voorkomt witte flits bij startup (App.tsx roept `show()` aan)

### 1.4 CSS import volgorde

In `main.tsx` of `App.tsx`:
```tsx
import "./themes.css";    // EERST — definieert alle CSS custom properties
import "./App.css";       // Layout (gebruikt theme vars)
// ... component imports
```

---

## Fase 2: Tailwind bridge instellen

> **Dit is de belangrijkste stap.** Zonder deze bridge gebruiken domein-componenten
> hardcoded Tailwind kleuren die niet meebewegen met het thema.

### 2.1 Tailwind config aanpassen

Voeg in `tailwind.config.ts` de CSS var bridge toe (zie meegeleverde `tailwind.config.ts`):

```ts
colors: {
  // === CSS VAR BRIDGE — theme-aware tokens ===
  surface:      "var(--theme-bg)",
  "surface-alt": "var(--theme-bg-lighter)",
  "on-surface": "var(--theme-text)",
  "on-surface-secondary": "var(--theme-text-secondary)",
  "on-surface-muted": "var(--theme-text-muted)",
  accent:       "var(--theme-accent)",
  "accent-hover": "var(--theme-accent-hover)",
  "on-accent":  "var(--theme-accent-text)",
  border:       "var(--theme-border)",
  "border-subtle": "var(--theme-border-subtle)",
  content:      "var(--theme-content-bg)",
  danger:       "var(--theme-danger-color)",
  "danger-hover": "var(--theme-danger-hover)",
}
```

### 2.2 Gebruik in domein-componenten

```tsx
// FOUT — hardcoded Tailwind kleur, reageert niet op thema
<div className="bg-stone-800 text-stone-100 border-stone-600">

// GOED — via CSS var bridge, volgt het thema automatisch
<div className="bg-surface text-on-surface border-border">
```

### 2.3 Vuistregel

| Context | Gebruik | Voorbeeld |
|---------|---------|-----------|
| Shell-componenten (template) | CSS custom properties direct | `var(--theme-bg)` in `.css` bestanden |
| Domein-componenten (jouw code) | Tailwind bridge tokens | `bg-surface`, `text-on-surface` in JSX |
| Grafieken/charts | CSS vars via `getComputedStyle()` of domain tokens | Zie Fase 4 |

---

## Fase 3: Ribbon tabs aanpassen

### 3.1 Template tabs verwijderen

De template bevat alleen `HomeTab.tsx` als voorbeeld. Verwijder of hernoem deze.

### 3.2 Eigen tabs maken

Maak per domein-onderdeel een tab in `components/ribbon/`:

```tsx
// components/ribbon/ProjectTab.tsx
import RibbonGroup from "./RibbonGroup";
import RibbonButton from "./RibbonButton";

export default function ProjectTab() {
  return (
    <div className="ribbon-content">
      <div className="ribbon-groups">
        <RibbonGroup label="Projectgegevens">
          <RibbonButton icon={editIcon} label="Bewerken" onClick={...} />
        </RibbonGroup>
        <RibbonGroup label="Berekenen">
          <RibbonButton icon={calcIcon} label="Bereken" onClick={...} />
        </RibbonGroup>
      </div>
    </div>
  );
}
```

### 3.3 Registreer tabs in Ribbon.tsx

In `Ribbon.tsx`, voeg je tabs toe aan de `TABS` array:

```tsx
const TABS = [
  { id: "project", labelKey: "tabs.project", component: ProjectTab },
  { id: "constructions", labelKey: "tabs.constructions", component: ConstructionsTab },
  // etc.
];
```

### 3.4 Elke knop moet iets doen

**BELANGRIJK:** Voeg geen knoppen toe zonder `onClick` handler. Een knop zonder actie
is erger dan geen knop — het ondermijnt vertrouwen in de UI.

Als een feature nog niet klaar is:
- Laat de knop weg, of
- Voeg `disabled` toe met een tooltip "Binnenkort beschikbaar"

---

## Fase 4: Domein-kleuren definiëren

### 4.1 Domain tokens in themes.css

Voeg project-specifieke kleuren toe in de `/* ─── Domain tokens ─── */` sectie
van `themes.css`. Deze tokens zijn voor kleuren die semantisch vastliggen
(bv. "blauw = buitenlucht") en niet per thema hoeven te variëren:

```css
:root,
[data-theme="light"] {
  /* ─── Domain tokens (project-specifiek) ─── */
  --domain-chart-1: #3b82f6;
  --domain-chart-2: #22c55e;
  --domain-chart-3: #f59e0b;
  --domain-chart-4: #8b5cf6;
  --domain-chart-5: #78716c;
  --domain-badge-info: #3b82f6;
  --domain-badge-success: #22c55e;
  --domain-badge-warning: #f59e0b;
  --domain-badge-danger: #ef4444;
}
```

### 4.2 Chart-kleuren gebruiken

```tsx
// FOUT — hardcoded hex in TypeScript
const SEGMENTS = [
  { label: "Categorie A", color: "#3b82f6" },
  { label: "Categorie B", color: "#22c55e" },
];

// GOED — via CSS custom properties
const style = getComputedStyle(document.documentElement);
const SEGMENTS = [
  { label: "Categorie A", color: style.getPropertyValue("--domain-chart-1").trim() },
  { label: "Categorie B", color: style.getPropertyValue("--domain-chart-2").trim() },
];

// NOG BETER — helper functie
function getDomainColor(token: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(`--domain-${token}`).trim();
}
```

### 4.3 Tailwind bridge voor domain tokens

Voeg domain-kleuren ook toe aan de Tailwind bridge:

```ts
// tailwind.config.ts
colors: {
  // ... bestaande bridge tokens
  "domain-1": "var(--domain-chart-1)",
  "domain-2": "var(--domain-chart-2)",
}
```

---

## Fase 5: SettingsDialog aanpassen

### 5.1 Wat werkt out-of-the-box

| Tab | Functie | Actie nodig |
|-----|---------|-------------|
| **General** | Taalselectie | Geen — werkt direct |
| **Appearance** | Themaselectie | Geen — werkt direct |
| **About** | App info | Pas naam/versie/beschrijving aan in i18n |

### 5.2 Wat je moet aanpassen

De template bevat bewust **geen** placeholder tabs meer voor Editor, Files,
Shortcuts of Plugins. Voeg alleen tabs toe die je project daadwerkelijk nodig heeft:

```tsx
// Voorbeeld: voeg een "Berekening" tab toe voor ISSO-specifieke settings
const TAB_IDS = ["general", "appearance", "calculation", "about"] as const;
```

### 5.3 Checklist General tab

De General tab bevat standaard:
- Taalselectie (werkt)
- Startup opties (pas aan of verwijder naar behoefte)
- Author naam (pas aan of verwijder)

Verwijder wat je niet nodig hebt. Voeg toe wat je wel nodig hebt.

---

## Fase 6: Backstage aanpassen

### 6.1 Menu-items koppelen

Elk menu-item in `Backstage.tsx` heeft een `onClick` die nu `actionAndClose()` aanroept
zonder actie. Koppel deze aan jouw project-logica:

```tsx
<MenuItem
  icon={ICONS.save}
  label={t("save")}
  shortcut="Ctrl+S"
  onClick={() => actionAndClose(() => projectStore.save())}
/>
```

### 6.2 Import/Export panels

De template bevat placeholder Import en Export panels. Pas de kaarten aan
naar jouw bestandsformaten:

```tsx
// Voorbeeld: IFC import kaart
<div className="bs-export-card" onClick={handleIfcImport}>
  <div className="bs-export-card-icon">{/* IFC icon */}</div>
  <div className="bs-export-card-info">
    <h3>IFC Bestand</h3>
    <p>Importeer een IFC4 bestandmodel</p>
  </div>
</div>
```

### 6.3 About panel

Pas de About panel aan met jouw app-naam, logo, en links.
De teksten staan in `i18n/locales/*/backstage.json`.

---

## Fase 7: Cleanup checklist

Na het kopieren en aanpassen, loop deze checklist af:

### Knoppen & acties
- [ ] Elke TitleBar quick-access knop heeft een `onClick` handler
- [ ] Elke Backstage menu-item is gekoppeld aan een actie
- [ ] Elke Ribbon knop doet iets (of is verwijderd/disabled)
- [ ] StatusBar toont dynamische data (of is verwijderd)

### Kleuren & theming
- [ ] Geen hardcoded `stone-*`, `slate-*`, `gray-*` Tailwind classes in domein-componenten
- [ ] Geen hardcoded hex-waarden in TypeScript (charts, badges)
- [ ] Alle domein-kleuren staan in `themes.css` als `--domain-*` tokens
- [ ] Tailwind bridge in `tailwind.config.ts` is ingesteld
- [ ] Beide thema's (light + openaec) visueel getest

### i18n
- [ ] Alle hardcoded UI-teksten geextraheerd naar locale JSON
- [ ] Domein-specifiek namespace aangemaakt (bv. `isso51.json`)
- [ ] Beide talen (NL + EN) compleet
- [ ] Taalwisseling via Settings getest

### Settings
- [ ] Geen placeholder tabs (Editor, Files, Shortcuts, Plugins) aanwezig
- [ ] General tab: alleen relevante opties
- [ ] Appearance tab: thema's werken
- [ ] About tab: correcte app-naam en versie

### Template-restanten
- [ ] Geen "tmp" of "OpenAEC Template" teksten in de UI
- [ ] TitleBar icon aangepast naar jouw app
- [ ] Backstage About logo/naam aangepast
- [ ] FeedbackDialog URL klopt (of component verwijderd)

---

## Veelgemaakte fouten

### 1. Hardcoded Tailwind kleuren in domein-componenten

**Symptoom:** Formulieren, tabellen en badges zien er goed uit in het light thema
maar zijn onleesbaar in het dark thema.

**Oorzaak:** `bg-stone-800 text-stone-100` zijn vaste kleuren. Ze veranderen niet
als `[data-theme]` wisselt.

**Oplossing:** Gebruik de Tailwind bridge: `bg-surface text-on-surface`.

### 2. Chart-kleuren hardcoded in TypeScript

**Symptoom:** Donut-charts en bar-charts gebruiken altijd dezelfde kleuren,
ongeacht het thema.

**Oorzaak:** Hex-waarden rechtstreeks in component code:
```tsx
const color = "#3b82f6"; // Dit verandert nooit
```

**Oplossing:** Definieer als CSS custom property en lees via `getComputedStyle()`.

### 3. Loze knoppen in de UI

**Symptoom:** Gebruiker klikt op Save, Undo, Print — er gebeurt niets.

**Oorzaak:** Template-knoppen zijn overgenomen zonder `onClick` handlers.

**Oplossing:** Koppel elke knop aan een actie, of verwijder de knop.

### 4. Te veel Settings tabs

**Symptoom:** Settings dialog heeft 7 tabs waarvan 4 placeholder zijn.

**Oorzaak:** Template bevatte generieke tabs (Editor, Files, Shortcuts, Plugins)
die niet relevant zijn voor het domein.

**Oplossing:** Verwijder wat je niet nodig hebt. Minder is meer.

### 5. StatusBar zonder inhoud

**Symptoom:** StatusBar toont "0 items" en "100% zoom" — altijd.

**Oorzaak:** Template-waarden zijn hardcoded, niet gekoppeld aan state.

**Oplossing:** Koppel aan project state of verwijder de StatusBar.

---

## Architectuur referentie

### Wat de template levert (raak niet aan)

| Component | Functie | Locatie |
|-----------|---------|---------|
| TitleBar | Window chrome, drag, min/max/close | `components/TitleBar.tsx` |
| Ribbon | Tab-based toolbar framework | `components/ribbon/Ribbon.tsx` |
| RibbonButton | Enkele toolbar-knop | `components/ribbon/RibbonButton.tsx` |
| RibbonGroup | Groep van knoppen met label | `components/ribbon/RibbonGroup.tsx` |
| RibbonTab | Tab-knop in de ribbon header | `components/ribbon/RibbonTab.tsx` |
| Backstage | File-menu overlay | `components/backstage/Backstage.tsx` |
| Modal | Dialog container | `components/Modal.tsx` |
| ThemedSelect | Styled dropdown | `components/ThemedSelect.tsx` |
| SettingsDialog | Theme + taal instellingen | `components/settings/SettingsDialog.tsx` |
| FeedbackDialog | Feedback formulier | `components/feedback/FeedbackDialog.tsx` |
| themes.css | CSS custom properties | `themes.css` |
| store.ts | Tauri preferences | `store.ts` |
| i18n | Vertaling framework | `i18n/` |

### Wat jij levert (jouw domein)

| Component | Voorbeeld |
|-----------|-----------|
| Ribbon tabs | `ProjectTab.tsx`, `ResultsTab.tsx` |
| Main content | Formulieren, editors, viewers |
| Left panel content | Navigatie, boomstructuur |
| Right panel content | Properties, details |
| Domain-specifieke dialogs | Import wizards, configuratie |
| Charts/grafieken | Domein-specifieke visualisaties |
| Domain tokens | `--domain-*` in themes.css |
| Tailwind bridge | Mapping in tailwind.config.ts |
| i18n namespaces | Extra locale bestanden |

---

## Web-mode (zonder Tauri)

De template is primair voor Tauri desktop apps. Voor web-only gebruik:

1. TitleBar: verberg window controls (`handleMinimize` etc. falen graceful)
2. store.ts: valt terug op `localStorage` als Tauri API niet beschikbaar is
3. Backstage "Exit": verberg (geen `window.close()` in browsers)
4. `decorations` setting in tauri.conf.json: niet relevant voor web

De template detecteert automatisch of Tauri APIs beschikbaar zijn en valt
terug op browser-alternatieven waar mogelijk.

---

*Laatst bijgewerkt: maart 2026 — na eerste productie-integratie (warmteverliesberekening)*
