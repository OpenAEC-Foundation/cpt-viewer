# Calculations Framework — Design

**Datum:** 2026-05-21
**Status:** Brainstorm-spec, ter review
**Naming convention:** alle code-paden, module-id's en bestandsnamen in
het Engels. UI-labels en gebruikersdocumentatie blijven Nederlands.
**Persistentie:** alle berekeningen worden opgeslagen in het `.ifcgeo`
projectbestand (IFCX-shaped JSON).

## 1. Doel

Een uitbreidbaar framework voor geotechnische en constructieve
berekeningen binnen Open Geotechniek Studio. Elke berekening is een
opt-in **module** (extensie) die volgens een uniform UI-concept gebruikt
wordt: een 3-paneel split-view met library/input links, visualisatie
midden, uitvoer rechts.

### MVP v1

- **Eén nieuwe Ribbon-tab: "Berekeningen"** — altijd zichtbaar zodra ≥1
  calc-module actief is
- **Module-registry** met 6 entries; 1 werkende (Funderingspaal),
  5 placeholders ("Coming soon")
- **Project-tree** in links-paneel — meerdere instances per module
- **Uniforme 3-pane UI** voor elke calc-module
- **IFCX-persistentie** — `calculations[]` array in `.ifcgeo`
- **Per-module extensie-toggle** — zelfde mechanisme als bestaande
  `tekening`/`offertes`, met namespace `calc.*`

### Buiten scope v1

- Implementatie van de 5 placeholder-modules — alleen registry-entries +
  "Coming soon"-paneel
- Cross-module dependencies (b.v. paalreactie automatisch in damwand-
  berekening voeren)
- Versioning/history van calc-instances binnen één project
- Real-time collaboration / multi-user editing

## 2. Module-registry

### 2.1 CalcModule interface

```ts
// apps/desktop/src/calc/framework/types.ts

export interface CalcModule<TInput = unknown, TResult = unknown> {
  /** Stable identifier — gebruikt voor IFCX-opslag + extensie-toggle. */
  id: string;                      // "pile-bearing-capacity"

  /** Display name in Nederlands (UI). */
  name: string;                    // "Funderingspaal"

  /** Korte ondertitel voor library/picker. */
  subtitle: string;                // "Paaldraagvermogen (NEN-EN 1997-1)"

  /** Module-categorie voor filtering/grouping in de UI. */
  category: CalcCategory;          // "pile" | "spread" | "wall" | "anchor"

  /** Material design-icon of inline SVG. */
  icon: ReactNode;

  /** Toegepaste norm — getoond in module-header. */
  norm: string;                    // "NEN-EN 1997-1:2005+A1:2013+NB:2019"

  /** Implementatie-status — bepaalt of de module échte UI rendert of
   *  alleen een "Coming soon"-placeholder. */
  status: "available" | "coming-soon";

  /** Default input voor een nieuwe instance van deze module. ProjectContext
   *  geeft toegang tot actieve CPT, projectgegevens, etc. */
  defaultInput: (ctx: ProjectContext) => TInput;

  /** Pure compute-functie — zelfde input geeft zelfde output. */
  compute: (input: TInput, ctx: ProjectContext) => TResult;

  /** UI-componenten per paneel — module-specifiek. */
  InputPanel: React.FC<{ input: TInput; onChange: (next: TInput) => void; result: TResult }>;
  VisualPanel: React.FC<{ input: TInput; result: TResult }>;
  ResultPanel: React.FC<{ input: TInput; result: TResult }>;

  /** Optionele één-regel-samenvatting voor StatusBar (b.v. "u.c. 0,92 ✓"). */
  statusLine?: (result: TResult) => { text: string; ok: boolean };
}

export type CalcCategory =
  | "pile"      // paalberekeningen
  | "spread"    // fundering op staal
  | "wall"      // grondkerende constructies
  | "anchor";   // ankers

export interface ProjectContext {
  cpts: Map<string, Cpt>;
  activeCptId: string | null;
  projectMeta: ProjectMeta;
}
```

### 2.2 Geplande modules

| Module-id (Engels) | UI-naam (NL) | Norm | v1 status |
|---|---|---|---|
| `pile-bearing-capacity` | Funderingspaal | NEN-EN 1997-1 §7.6 | ✅ available |
| `spread-foundation-drained` | Fundering op staal — gedraineerd | NEN-EN 1997-1 §6.5 | 🔜 coming-soon |
| `spread-foundation-undrained` | Fundering op staal — ongedraineerd | NEN-EN 1997-1 §6.5 | 🔜 coming-soon |
| `laterally-loaded-pile` | Horizontaal belaste paal | CUR 166 / NEN 9997-1 §7.7 | 🔜 coming-soon |
| `sheet-pile-wall` | Damwandberekening | CUR 166 / NEN-EN 1997-1 §9 | 🔜 coming-soon |
| `ground-anchor` | Groutanker | EN 1537 / NEN-EN 1997-1 §8 | 🔜 coming-soon |

### 2.3 Registry-locatie

```
apps/desktop/src/calc/framework/registry.ts
```

```ts
import { pileBearingCapacityModule } from "../modules/pile-bearing-capacity/module";
import { spreadFoundationDrainedModule } from "../modules/spread-foundation-drained/module";
// ...

export const CALC_REGISTRY: CalcModule[] = [
  pileBearingCapacityModule,
  spreadFoundationDrainedModule,
  spreadFoundationUndrainedModule,
  laterallyLoadedPileModule,
  sheetPileWallModule,
  groundAnchorModule,
];

export function getCalcModule(id: string): CalcModule | undefined {
  return CALC_REGISTRY.find((m) => m.id === id);
}
```

## 3. File-layout (alles Engels)

```
apps/desktop/src/calc/
├── framework/
│   ├── types.ts                    # CalcModule, ProjectContext, CalcInstance
│   ├── registry.ts                 # CALC_REGISTRY array
│   ├── store.ts                    # useCalculationsStore (zustand)
│   ├── persistence.ts              # toIfcx / fromIfcx serializers
│   └── views/
│       ├── CalculationsView.tsx    # 3-pane container
│       ├── ProjectTreePanel.tsx    # library left — list per project
│       ├── NewCalculationDialog.tsx # module-picker modal
│       ├── ComingSoonPanel.tsx     # placeholder voor coming-soon modules
│       └── CalculationsView.css
│
└── modules/
    ├── pile-bearing-capacity/
    │   ├── module.ts               # CalcModule export
    │   ├── types.ts                # PileInput, PileResult
    │   ├── compute.ts              # main computePile()
    │   ├── catalog.ts              # pile types from Tabel 7.c
    │   ├── parts/                  # sub-calculations
    │   │   ├── negative-skin-friction.ts
    │   │   ├── base-resistance.ts
    │   │   ├── shaft-friction.ts
    │   │   ├── settlement.ts
    │   │   ├── spring-stiffness.ts
    │   │   └── summary.ts
    │   ├── ui/
    │   │   ├── InputPanel.tsx
    │   │   ├── VisualPanel.tsx
    │   │   └── ResultPanel.tsx
    │   └── __fixtures__/
    │       ├── sondering-984.json
    │       └── sondering-3bm-cgeo1.json
    │
    ├── spread-foundation-drained/
    │   └── module.ts               # placeholder export — coming-soon
    ├── spread-foundation-undrained/
    │   └── module.ts               # placeholder
    ├── laterally-loaded-pile/
    │   └── module.ts               # placeholder
    ├── sheet-pile-wall/
    │   └── module.ts               # placeholder
    └── ground-anchor/
        └── module.ts               # placeholder
```

**Naming-conventie**:
- Folders + bestandsnamen: `kebab-case`, Engels
- Module-id's: `kebab-case`, Engels (zelfde als folder-naam)
- TypeScript identifiers: `camelCase` voor variabelen, `PascalCase` voor types/components
- UI-strings: Nederlands

## 4. UI-architectuur

### 4.1 Ribbon-tab

Nieuwe tab "Berekeningen" in de Ribbon (`Ribbon.tsx`). Zichtbaar zodra
ten minste één `calc.*`-extensie aan staat:

```tsx
const anyCalcEnabled = useExtensions().some(
  (id, enabled) => enabled && id.startsWith("calc."),
);
{anyCalcEnabled && <RibbonTab id="berekeningen" label="Berekeningen" />}
```

Klik → `activeView = "calculations"` → werkruimte vervangen door
`<CalculationsView />`.

### 4.2 CalculationsView (3-pane container)

```
┌──────────────────────────────────────────────────────────────────────┐
│  ProjectTreePanel  │   VisualPanel        │   ResultPanel             │
│  + active          │   (module-specifiek) │   (module-specifiek)       │
│   InputPanel       │                      │                            │
│  300 px            │   flex               │   380 px                   │
└────────────────────┴──────────────────────┴────────────────────────────┘
```

**ProjectTreePanel** (links, vast 300 px):
- Header: project-naam + "+ Nieuwe berekening"-knop
- Boomstructuur — gegroepeerd per categorie (Palen / Funderingen /
  Wanden / Ankers)
- Per node: icon + naam + status-indicator (✓ groen / ✗ rood / ⏳ grijs)
- Klik op node → selecteert die calc-instance als actief
- Context-menu (rechtermuis): Hernoemen / Dupliceren / Verwijderen
- Onder de boom: invoer-paneel van actieve calc (module's `InputPanel`)

**VisualPanel** (midden, flex): module-specifieke visualisatie. Voor
`pile-bearing-capacity`: de CPT-chart met paal-annotaties. Voor toekomst:
fundatie-tekening, damwand-doorsnede, ankerschema, etc.

**ResultPanel** (rechts, vast 380 px): module-specifieke uitvoer.
Formules + tussenstappen + samenvatting.

Voor `coming-soon` modules wordt zowel Visual als Result vervangen door
`<ComingSoonPanel module={...} />` met norm-referentie + "🔜 Wordt
gebouwd. Volg de roadmap op GitHub" + voorbeeld-screenshot van wat de
module gaat doen.

### 4.3 NewCalculationDialog

Modal die opent via "+ Nieuwe berekening"-knop in ProjectTreePanel:

```
┌──────────────────────────────────────────┐
│  Nieuwe berekening                    [X] │
├──────────────────────────────────────────┤
│  Naam: [_____________________________]    │
│                                            │
│  Kies module-type:                         │
│                                            │
│  PALEN                                     │
│  ⊙ Funderingspaal                          │
│       NEN-EN 1997-1 §7.6                   │
│  ○ Horizontaal belaste paal       🔜       │
│       CUR 166 / NEN 9997-1 §7.7            │
│                                            │
│  FUNDERINGEN                               │
│  ○ Fundering op staal (gedraineerd) 🔜    │
│  ○ Fundering op staal (ongedraineerd) 🔜  │
│                                            │
│  WANDEN                                    │
│  ○ Damwandberekening              🔜       │
│                                            │
│  ANKERS                                    │
│  ○ Groutanker                     🔜       │
│                                            │
│              [Annuleren] [Toevoegen]      │
└──────────────────────────────────────────┘
```

Modules met `status: "coming-soon"` kunnen WEL aangemaakt worden (als
placeholder) — geeft een paneel met norm-referentie maar geen rekenwerk.
Helpt de gebruiker plannen.

## 5. State management

### 5.1 useCalculationsStore (zustand)

```ts
// apps/desktop/src/calc/framework/store.ts

export interface CalculationInstance {
  id: string;                       // UUID
  moduleId: string;                 // "pile-bearing-capacity"
  name: string;                     // user-given
  input: unknown;                   // module-specific input
  createdAt: string;                // ISO timestamp
  updatedAt: string;                // ISO timestamp
}

interface CalculationsStore {
  /** Calculations per active project, keyed by docId. */
  byDoc: Map<string, CalculationInstance[]>;

  /** Active calc-instance id voor de Berekeningen-view. */
  activeCalcId: string | null;

  addCalculation: (docId: string, moduleId: string, name: string) => string;
  updateCalculation: (docId: string, id: string, patch: Partial<CalculationInstance>) => void;
  removeCalculation: (docId: string, id: string) => void;
  setActive: (id: string | null) => void;
  duplicate: (docId: string, id: string) => string;
}
```

Calculations zijn **per project** (per `docId`) zodat ze automatisch
mee-bewegen met tab-wisselingen, ge-load worden op project-open en
op-saved worden bij project-save.

### 5.2 Compute-resultaten

Resultaten worden **niet** opgeslagen in de store — altijd live
afgeleid via `useMemo`:

```tsx
const result = useMemo(
  () => module.compute(input, projectContext),
  [input, projectContext],
);
```

Voordeel: geen stale-state-bugs, simpeler model, en input ↔ output
blijft altijd consistent.

## 6. IFCX-persistentie

### 6.1 Schema-uitbreiding

Het bestaande `.ifcgeo`-bestand (IFCX-shaped JSON, header + project +
cpts + bores + tekening + title_block + gis + deliverable) krijgt één
nieuwe top-level array:

```ts
interface IfcgisProjectV05 {
  header: { schema: "ifcgis-0.5"; ... };
  project: ProjectInfo;
  cpts?: Cpt[];
  bores?: BoreJson[];
  // ... bestaande velden ...

  /** v0.5 toevoeging: geotechnische + constructieve berekeningen. */
  calculations?: CalculationDef[];
}

interface CalculationDef {
  id: string;                       // UUID, stable over save/load
  module_id: string;                // "pile-bearing-capacity"
  name: string;                     // user-given e.g. "Hoofdgebouw"
  input: Record<string, unknown>;   // module-specific
  created_at: string;               // ISO 8601
  updated_at: string;               // ISO 8601

  /** Optionele referenties naar CPTs/bores die deze calc gebruikt.
   *  Wordt door save-flow auto-gevuld; bij load gebruikt om snelle
   *  cross-references te maken in de UI. */
  cpt_refs?: string[];              // CPT ids
  bore_refs?: string[];
}
```

Bewust **geen result-cache** in het bestand — bij open hercomputen we
alles. Voordelen: bestanden blijven klein, geen schema-versie-gedoe als
formules wijzigen, geen risico op stale resultaten.

### 6.2 Backwards-compatibility

- Oudere `.ifcgeo`-bestanden zonder `calculations`-veld laden gewoon
  zonder calc-instances — geen breaking change
- Schema-versie bumpt naar `ifcgis-0.5` (was 0.4 voor laatste tekening-
  toevoeging). Loader accepteert beide versies; 0.4 wordt bij save
  opgewaardeerd naar 0.5

### 6.3 Rust-side wijzigingen

```
apps/desktop/src-tauri/src/commands/project_io.rs:
  + struct CalculationDef { ... }
  + add calculations field to IfcgisFile struct
  + serialize/deserialize via serde
```

Pure JSON-doorgeefluik — de Rust-side hoeft niets te begrijpen van de
calc-inhoud; module-input wordt als `serde_json::Value` opgeslagen. De
TS-side serialiseert/deserialiseert module-specifiek.

## 7. Extensie-systeem

### 7.1 Extension-id namespace

Nieuwe conventie: `calc.<module-id>` voor calc-modules. Bestaande
extensies (`tekening`, `offertes`) blijven zoals ze zijn — geen breaking
rename.

```ts
// apps/desktop/src/hooks/useExtensions.ts

export type ExtensionId =
  | "tekening"
  | "offertes"
  // Berekeningen-modules:
  | "calc.pile-bearing-capacity"
  | "calc.spread-foundation-drained"
  | "calc.spread-foundation-undrained"
  | "calc.laterally-loaded-pile"
  | "calc.sheet-pile-wall"
  | "calc.ground-anchor";

const DEFAULTS: Record<ExtensionId, boolean> = {
  tekening: false,
  offertes: false,
  "calc.pile-bearing-capacity": false,
  "calc.spread-foundation-drained": false,
  // ...allemaal false default
};
```

### 7.2 Extension manager-UI

Backstage → Extensies + Settings → Extensies krijgen automatisch alle
calc-extensies erbij via `INSTALLED_EXTENSIONS` array:

```ts
const INSTALLED_EXTENSIONS = [
  { id: "tekening", name: "Situatietekening", category: "Tekening", ... },
  { id: "offertes", name: "Offertes opvragen", category: "Werkflow", ... },
  // Berekeningen — gegenereerd uit CALC_REGISTRY:
  ...CALC_REGISTRY.map(toExtensionMeta),
];
```

`toExtensionMeta(module)` mapt een `CalcModule` naar het bestaande
extensie-meta-formaat (id, name, version, description, author, category).

## 8. Implementatie-volgorde

1. **Framework skeleton** — `calc/framework/*` + types + registry +
   store + persistence. Geen UI nog, alleen de plumbing. Tests:
   serialisatie roundtrip.
2. **Funderingspaal-module migratie** — verplaats het werk uit de
   bestaande Funderingspaal-spec naar `calc/modules/pile-bearing-capacity/`.
   Hergebruik alle calc-logica + tests uit dat spec.
3. **CalculationsView + ProjectTreePanel** — basis 3-pane UI met
   library-tree. Klikken op een instance laadt 'm in panelen.
4. **NewCalculationDialog** — module-picker met categorie-grouping.
5. **Coming-soon panelen** — placeholder-UI voor de 5 niet-
   geïmplementeerde modules.
6. **Extension-toggles** — calc-modules in Settings + Backstage.
7. **IFCX-persistentie** — Rust-side schema bump + TS save/load.
8. **Polish** — context-menu's, status-indicators, sneltoetsen.

## 9. Open punten

1. **Cross-referentie tussen calcs** — niet in scope v1. Toekomst:
   damwand-berekening kan paal-reactie uit `pile-bearing-capacity`
   automatisch importeren. Vereist een dependency-graph in de store.
2. **PDF-rapport per calc-module** — niet in scope. Toekomst: elke
   module krijgt een `exportPdf(input, result)` method, gerendered
   door de bestaande Rust PDF-engine.
3. **Module-versioning** — als de Funderingspaal-formules in v2
   wijzigen, hoe behandelen we oude saves? Toekomst: `module_version`-
   veld in `CalculationDef`. Voor v1: geen versie-tracking, gebruiker
   krijgt vermelding "berekening opnieuw geverifieerd in v0.x.y".
4. **WASM voor zware berekeningen** — niet voor v1. Damwand- en
   horizontaal-belaste-paal-modules zullen waarschijnlijk Rust-side
   willen draaien (matrix-FEM-achtige berekeningen). Het framework
   moet dat ondersteunen via een per-module `compute`-implementatie
   die intern `invoke()` kan doen.

## 10. Wijziging in het Funderingspaal-spec

Het bestaande `2026-05-21-funderingspaal-extension-design.md` blijft
geldig voor de calc-logica + formules, maar krijgt deze aanpassingen
(in een aparte commit, na approval):

- **Hernoemd** naar `2026-05-21-pile-bearing-capacity-module-design.md`
- **§2.1 Extension-registratie** — id `funderingspaal` → `calc.pile-bearing-capacity`
- **§2.2 File-layout** — schuift onder `calc/modules/pile-bearing-capacity/`
  met Engelse sub-folders (`parts/`, `ui/`, `__fixtures__/`)
- **§2.4 View-routing** — geen eigen Ribbon-tab meer; render in de
  framework's `CalculationsView` via de module's `InputPanel` /
  `VisualPanel` / `ResultPanel` exports
- **§2.5 Persistentie** — vervangen door verwijzing naar §6 van dit
  framework-spec (IFCX `calculations[]` array)
- Alle andere secties (berekeningen, formules, edge-cases, tests,
  scope-grenzen) blijven onveranderd

## 11. Niet-doelen

- Geen UI-strings vertaald naar Engels — blijft Nederlands
- Geen wijziging aan bestaande `tekening` of `offertes` extensies
- Geen automatische cross-module data-doorgifte
- Geen rapport-export per calc in v1
- Geen module-versie-migratie tooling
