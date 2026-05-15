# Component Manifest

> Per template-component: wat het doet, of het verplicht is, en wat je moet aanpassen.
>
> Legenda:
> - **VERPLICHT** — moet mee, breekt zonder
> - **AANBEVOLEN** — sterk aangeraden, maar app werkt zonder
> - **OPTIONEEL** — gebruik alleen als relevant voor jouw project

---

## Shell Components

### TitleBar.tsx + TitleBar.css — VERPLICHT

**Functie:** Custom window chrome (frameless). Bevat app-icoon, quick-access knoppen, titel, window controls (min/max/close).

**Aanpassen:**

| Element | Regel | Wat doen |
|---------|-------|----------|
| App-icoon (SVG) | 67-94 | Vervang het "tmp" SVG door jouw app-icoon |
| Quick-access knoppen | 97-156 | Koppel `onClick` handlers aan Save, Undo, Redo, Print. Verwijder knoppen die je niet nodig hebt |
| "Send Feedback" knop | 165-171 | Verwijder als je geen FeedbackDialog gebruikt |

**Niet aanraken:**
- Window control knoppen (min/max/close) — werken out-of-the-box
- Drag region logic — correct ingesteld
- Maximize state tracking — werkt automatisch
- Close button rode hover kleur (#e81123) — Windows conventie, bewust hardcoded

**Afhankelijkheden:** `@tauri-apps/api/window`, `@tauri-apps/api/app`, i18n, TitleBar.css

---

### StatusBar.tsx + StatusBar.css — OPTIONEEL

**Functie:** Informatieve footer-balk onderaan het venster.

**Aanpassen:**

De huidige inhoud is volledig placeholder (hardcoded "0 items", "100% zoom").
Je hebt drie opties:

1. **Verwijderen** — verwijder `<StatusBar />` uit App.tsx en de bestanden
2. **Dynamisch vullen** — koppel aan project state:
   ```tsx
   <span className="status-item-value">{rooms.length}</span>
   ```
3. **Behouden als is** — alleen als je later wilt invullen

**Niet aanraken:** CSS styling (gebruikt theme vars correct)

---

### DocumentBar.tsx + DocumentBar.css — OPTIONEEL

**Functie:** Multi-document tab bar (zoals browser-tabs voor open bestanden).

**Wanneer gebruiken:** Alleen als jouw app meerdere documenten tegelijk open heeft
(bv. code-editor, tekst-editor). Voor single-document apps (warmteverlies, rapportage):
verwijder of vervang door een simpele project-naam indicator.

**Verwijderen:** Haal `<DocumentBar />` weg uit App.tsx.

---

### Modal.tsx + Modal.css — VERPLICHT

**Functie:** Herbruikbare dialog container met overlay, header, scrollable content, en footer.

**Aanpassen:** Niets — dit is een generiek component. Gebruik het voor eigen dialogs:

```tsx
<Modal open={isOpen} onClose={handleClose} title="Mijn Dialog" width={500}>
  <div>Inhoud hier</div>
</Modal>
```

**Niet aanraken:** Overlay kleur, animatie, escape-key handling.

---

### ThemedSelect.tsx + ThemedSelect.css — VERPLICHT

**Functie:** Styled dropdown die het thema volgt. Gebruikt door SettingsDialog.

**Aanpassen:** Niets — generiek component. Gebruik het in eigen formulieren als alternatief
voor `<select>`.

---

## Ribbon Components

### Ribbon.tsx + Ribbon.css — VERPLICHT

**Functie:** Tab-based toolbar. Beheert actieve tab, toont/verbergt tab-content.

**Aanpassen:**

| Element | Wat doen |
|---------|----------|
| `TABS` array / tab registratie | Voeg jouw domein-tabs toe |
| "Bestand" tab (File) | Triggert Backstage — niet aanpassen |
| Tab volgorde | Bepaal de volgorde van jouw tabs |

**Niet aanraken:** Tab-switching logica, CSS hover/active states, File tab click handler.

---

### RibbonButton.tsx — VERPLICHT

**Functie:** Enkele knop in een RibbonGroup. Ondersteunt icon + label.

**Aanpassen:** Niets — dit is een bouwsteen. Gebruik in eigen tabs:

```tsx
<RibbonButton
  icon={myIcon}
  label="Bereken"
  onClick={handleCalculate}
  active={isCalculating}
/>
```

**Props:**
- `icon` (string) — SVG markup
- `label` (string) — knoptekst
- `onClick` (function) — VERPLICHT, geen loze knoppen
- `active` (boolean) — toggle state
- `disabled` (boolean) — grayed out

---

### RibbonGroup.tsx — VERPLICHT

**Functie:** Visuele groep van RibbonButtons met een label onderaan.

**Aanpassen:** Niets — bouwsteen.

```tsx
<RibbonGroup label="Berekeningen">
  <RibbonButton ... />
  <RibbonButton ... />
</RibbonGroup>
```

---

### RibbonTab.tsx — VERPLICHT

**Functie:** Tab-knop in de ribbon header. Intern gebruikt door Ribbon.tsx.

**Aanpassen:** Niet direct — wordt automatisch aangemaakt per geregistreerde tab.

---

### RibbonButtonStack.tsx — VERPLICHT

**Functie:** Verticale stack van 2-3 kleine knoppen (compact layout).

**Aanpassen:** Niets — bouwsteen voor compacte toolbar-groepen.

---

### HomeTab.tsx — VERWIJDEREN

**Functie:** Voorbeeld-tab met Settings en Help knoppen.

**Actie:** Verwijder of hernoem. Dit is een demo — vervang door jouw eerste domein-tab.

---

### icons.ts — AANPASSEN

**Functie:** SVG icon definities als template strings.

**Aanpassen:** Voeg jouw domein-iconen toe. Behoud de bestaande (settings, help, info)
als je ze gebruikt.

**Formaat:**
```ts
export const calculateIcon = `<svg width="20" height="20" viewBox="0 0 24 24"
  fill="none" stroke="currentColor" stroke-width="2">...</svg>`;
```

---

## Backstage Components

### Backstage.tsx + Backstage.css — VERPLICHT

**Functie:** File-menu overlay (Nieuw, Openen, Opslaan, Import, Export, etc.).

**Aanpassen:**

| Element | Wat doen |
|---------|----------|
| MenuItem `onClick` handlers | Koppel aan jouw project-logica |
| Import panel | Pas kaarten aan naar jouw import-formaten |
| Export panel | Pas kaarten aan naar jouw export-formaten |
| About panel | Pas naam, logo, beschrijving aan |
| "Exit" menu-item | Werkt out-of-the-box (Tauri window close) |

**Menu-items verwijderen:** Verwijder items die je niet nodig hebt.
Bv. als je geen Print hebt, verwijder die MenuItem.

**Niet aanraken:** Overlay-animatie, escape-key handling, sidebar layout.

---

## Settings Components

### SettingsDialog.tsx + SettingsDialog.css — VERPLICHT

**Functie:** Instellingen dialog met sidebar tabs.

**Werkende tabs (out-of-the-box):**

| Tab | Functie | Persistentie |
|-----|---------|--------------|
| General | Taalselectie | Tauri store |
| Appearance | Themaselectie | Tauri store |
| About | App info | Statisch |

**Aanpassen:**

1. **General tab (regels 159-203):**
   - Taalselectie: werkt, geen actie nodig
   - "Restore session" / "Check updates": placeholder checkboxen — verwijder of implementeer
   - "Author name": placeholder input — verwijder of koppel aan project state

2. **Appearance tab (regels 206-241):**
   - Themaselectie: werkt, geen actie nodig
   - Font size selector: placeholder — verwijder of implementeer via CSS `--theme-font-size`

3. **TAB_IDS (regel 15):** Pas aan. Voeg domein-tabs toe, verwijder wat je niet nodig hebt:
   ```ts
   const TAB_IDS = ["general", "appearance", "calculation", "about"] as const;
   ```

4. **About tab (regels 418-433):** Pas naam, versie, beschrijving aan via i18n keys.

---

## Feedback Components

### FeedbackDialog.tsx — OPTIONEEL

**Functie:** In-app feedback formulier.

**Aanpassen:**
- `FEEDBACK_API_URL` (regel ~42) — wijst naar OpenAEC feedback endpoint.
  Pas aan als je een eigen endpoint hebt.
- `APP_ID` — pas aan naar jouw app-identifier.

**Verwijderen:** Als je geen feedback wilt: verwijder component + "Send Feedback"
knop uit TitleBar.tsx + FeedbackDialog import uit App.tsx.

---

## Theme Files

### themes.css — VERPLICHT

**Functie:** Alle CSS custom properties voor beide thema's.

**Aanpassen:**

1. **Niet aanraken:** Alle `--theme-*` variabelen — deze sturen de shell.

2. **Toevoegen:** `--domain-*` variabelen voor jouw project-specifieke kleuren:
   ```css
   /* ─── Domain tokens (project-specifiek) ─── */
   --domain-chart-1: #3b82f6;
   --domain-badge-success: #22c55e;
   ```

3. **Eventueel aanpassen per thema:** Als domain tokens er anders uit moeten zien
   in dark mode, definieer ze in beide `[data-theme]` blokken.

---

### tailwind.config.ts — AANBEVOLEN

**Functie:** Tailwind CSS configuratie met CSS var bridge.

**Aanpassen:**

1. **Bridge tokens:** Staan al ingesteld — `bg-surface`, `text-on-surface`, etc.

2. **Domain tokens toevoegen:**
   ```ts
   "domain-1": "var(--domain-chart-1)",
   "domain-2": "var(--domain-chart-2)",
   ```

3. **Project-specifieke kleuren:** Voeg toe als Tailwind extend:
   ```ts
   boundary: {
     exterior: "var(--domain-boundary-exterior)",
     ground: "var(--domain-boundary-ground)",
   }
   ```

---

## i18n Files

### i18n/config.ts — VERPLICHT

**Functie:** i18next configuratie. Laadt namespaces, detecteert browsertaal.

**Aanpassen:**
- Voeg extra namespaces toe voor jouw domein:
  ```ts
  ns: ["common", "ribbon", "backstage", "settings", "feedback", "isso51"],
  ```

### i18n/locales/ — VERPLICHT

**Functie:** Vertaalbestanden per taal en namespace.

**Aanpassen:**
- Pas bestaande bestanden aan met jouw labels
- Voeg domein-namespace bestanden toe: `locales/nl/isso51.json`

---

## Store

### store.ts — VERPLICHT

**Functie:** Tauri persistent preferences (theme, language).

**Aanpassen:** Voeg eigen settings toe via `getSetting()`/`setSetting()`:

```ts
await setSetting("lastProject", projectId);
const lastProject = await getSetting("lastProject", "");
```

**Niet verwarren met:** Zustand stores of Redux stores in jouw project.
Dit is alleen voor app-level preferences (thema, taal, window-positie).

---

*Zie `INTEGRATION.md` voor de stap-voor-stap integratieworkflow.*
