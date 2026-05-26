# Funderingspaal-extensie — Design

**Datum:** 2026-05-21
**Status:** Brainstorm-spec, ter review
**Auteur:** opgesteld via brainstorming-skill
**Methode:** NEN-EN 1997-1:2005+A1:2013+NB:2019 (Eurocode 7 — Geotechnisch ontwerp)
**Referentie-output:** `verification-files/Constructieberekeningen/Funderingspaal/984.pdf` (ExternPakket 2027.3.01)

## 1. Doel en scope

Een opt-in extensie die per CPT (sondering) het maximaal opneembare
paaldraagvermogen berekent volgens Eurocode 7 §7.6.2.3, vergelijkt met
de optredende belasting (NEd), en het resultaat met formule-tussenstappen
en chart-annotaties presenteert.

### MVP (v1)

- **Eén actieve sondering** (de geselecteerde CPT in de tab)
- **Eén paaltype** — *Stalen buispaal, geheid, gesloten punt* (αp=0,70, αs=0,008, αt=0,006 uit Tabel 7.c)
- **Computation klant-zijdig** (TypeScript, werkt in browser én Tauri)
- **Opt-in extensie** naast Situatietekening + Offertes — default UIT
- **Eigen Ribbon-tab** "Funderingspaal" die de werkruimte wisselt naar
  een 3-paneel split-view (input / CPT-chart met annotaties / berekening)
- **Statische berekening** met live update bij elke input-wijziging
- **Resultaten zichtbaar in UI**, geen PDF-export in MVP

### Buiten scope v1 (latere iteraties)

- Multi-CPT samenvatting met variatiecoëfficient VC en ξ-factoren over
  meerdere sonderingen
- Aanvullende paaltypen (betonpaal, boorpaal, schroefpaal, vibropaal)
- Paalgroep-effecten (negatieve kleef-reductie, groepsfactor)
- Trekpaal-controle
- Handmatige soillaag-editor (we leunen op Robertson uit cpt-core)
- PDF-rapport-export
- Lastzakkingsdiagram-tab (alleen ruwe waardes + veerwaarde in MVP)
- Funderingsbalk + zettingsverdeling

## 2. Architectuur

### 2.1 Extension-registratie

Bestaand systeem in `apps/desktop/src/hooks/useExtensions.ts` uitbreiden
met één nieuwe `ExtensionId`:

```ts
export type ExtensionId = "tekening" | "offertes" | "funderingspaal";

const SETTING_KEYS: Record<ExtensionId, string> = {
  tekening: "ext.tekening.enabled",
  offertes: "ext.offertes.enabled",
  funderingspaal: "ext.funderingspaal.enabled",
};

const DEFAULTS: Record<ExtensionId, boolean> = {
  tekening: false,
  offertes: false,
  funderingspaal: false,
};
```

Drie plekken pikken dit automatisch op:

- **Ribbon** (`apps/desktop/src/components/ribbon/Ribbon.tsx`) — toont de
  Funderingspaal-tab alleen als `useExtension("funderingspaal")` true is
- **Settings → Extensies** (`SettingsDialog.tsx` `ExtensionsTabContent`) — checkbox via `useAllExtensions()`
- **Backstage → Extensies** (`ExtensionManagerPanel.tsx`) — extra item in `INSTALLED_EXTENSIONS` array met
  category "Berekening", versie "0.3.0"

Persistentie loopt via `getSetting/setSetting` uit `apps/desktop/src/store.ts` —
in Tauri naar `preferences.json` via `@tauri-apps/plugin-store`, in
browser naar `window.localStorage` met `ogs:` prefix (al werkend sinds
commit e9eeb32).

### 2.2 File-layout

```
apps/desktop/src/
├── calc/
│   └── pile/
│       ├── types.ts                  # PileDesign, PileResult, PileTypeSpec, soil tables
│       ├── pileTypeCatalog.ts        # Tabel 7.c factoren (αp, αs, αt)
│       ├── negKleef.ts               # §7.6.2.2 — Fnk;rep + Fnk;d
│       ├── puntdraagvermogen.ts      # §7.6.2.3(e)(f) — qb;max + qc;I/II/III gem
│       ├── schachtwrijving.ts        # §7.6.2.3(h)(i) — Rs;cal;max
│       ├── zakking.ts                # Figuur 7.n/7.o — lastzakkingslijn iteratie
│       ├── samenvatting.ts           # ξ3/ξ4 (n=1), Rc;k, Rc;d, unity check
│       ├── compose.ts                # computePileDesign(cpt, design) → PileResult
│       └── __fixtures__/
│           └── sondering-984.json    # CPT-data uit blad 1 van 984.pdf
├── calc/pile.test.ts                 # vitest gouden test + unit tests
├── components/
│   ├── ribbon/
│   │   └── FunderingspaalTab.tsx     # Ribbon-tab (alleen zichtbaar als ext aan)
│   └── panels/
│       ├── FunderingspaalView.tsx    # 3-pane split-view container
│       ├── PileInputPanel.tsx        # links — paal/load/factoren input
│       ├── PileChartView.tsx         # midden — CPT-chart + paal-annotaties
│       ├── PileResultPanel.tsx       # rechts — formules + tussenstappen
│       └── FunderingspaalView.css    # split-view layout + result-formule styling
└── store/
    └── usePileStore.ts               # zustand store — PileDesign[] per project
```

### 2.3 Data-flow

```
PileInputPanel → setPileDesign(...) → usePileStore (zustand)
                                          ↓
                  ┌───────────────────────┴──┐
                  ↓                          ↓
            PileChartView           PileResultPanel
            (chart + annotaties)     (formules + getallen)
                  ↑                          ↑
                  └─── useMemo(() =>
                       computePileDesign(cpt, design) ───┘
```

`computePileDesign` is **pure**: zelfde input geeft zelfde output, geen
side-effects, idempotent. Resultaat wordt gecached via `useMemo` zodat
typen in een input-veld geen onnodige re-computatie veroorzaakt voor
panelen die niet wijzigen.

### 2.4 View-routing

Nieuwe case in `App.tsx`:

```ts
type AppView = "map" | "tekening" | "report" | "pile";  // pile is new
```

`FunderingspaalTab` dispatcht `ogs:view-change` met `view: "pile"` →
`App.tsx` rendert `<FunderingspaalView />` in de hoofdwerkruimte.
Bestaand pattern, hergebruik van Sonderingstekening-aanpak.

### 2.5 Persistentie binnen project

Per project één lijst van `PileDesign[]` — bewaard in zustand
`usePileStore`. Bij `Save Project (.ifcgeo)` worden de designs
meegeschreven onder een nieuwe top-level sectie `pile_designs` zodat
later openen ze terughaalt. Backwards-compatible — oudere `.ifcgeo`'s
zonder die sectie laden gewoon zonder paal-designs.

```ts
interface IfcgisProjectV04 {
  // ... bestaande velden ...
  pile_designs?: PileDesign[];
}
```

## 3. UI layout

### 3.1 Ribbon-tab

```
[Start] [Kaart] [Funderingspaal] [Sonderingstekening*] [Rapport] [IFC]
                  ^^^^^^^^^^^^^^   * zichtbaar alleen als ext aan
```

Klik = `activeView = "pile"`, werkruimte vervangen door `<FunderingspaalView />`.

### 3.2 FunderingspaalView (3-pane split)

```
┌─────────────────┬─────────────────────────┬──────────────────┐
│ PileInputPanel  │ PileChartView           │ PileResultPanel  │
│ 320 px vast     │ flex                    │ 380 px vast      │
│ scrollable      │ (chart canvas + overlay)│ scrollable       │
└─────────────────┴─────────────────────────┴──────────────────┘
```

Splitters resizable (drag-handle pattern uit bestaande
`LeftPanel ↔ ChartView`), state in zustand zodat groottes per sessie
behouden blijven.

### 3.3 PileInputPanel (links)

Collapsible secties met section-headers (zelfde pattern als bestaande
`PanelSection` in LeftPanel):

- **Sondering** — dropdown van CPTs uit actieve project; default
  = activeCptId
- **Paal** — type-cascade. Voor MVP één entry:
  - Type: "Stalen buispaal"
  - Specificatie: "Geheid (gesloten punt)" → autopopulate αp=0,70, αs=0,008, αt=0,006
  - D [mm], Ab afgeleid (πD²/4 voor rond)
  - Wanddikte t [mm] → EA berekend (E_staal=210 GPa × Ab_staal)
- **Paalniveaus** (m NAP):
  - Paalkop
  - Paalpunt
  - Waterniveau
  - Ontgravingsniveau
- **Belasting** (kN):
  - NEd (rekenwaarde)
  - NEk (karakteristiek)
- **Partiële factoren**:
  - γm = 1,20 (Tabel A.10, default)
  - γf,nk = 1,00 (Tabel A.6, default)
- **Bodemprofiel** (cruciaal voor neg.kleef-berekening):
  - "Auto van Robertson" (default) — Robertson zone-detectie levert
    laag-grenzen + soiltype-suggestie per laag
  - Tabel met kolommen: Grondsoort | Start NAP | Eind NAP | Δh | γ | γ_wat | Φ
  - Defaults uit grondsoort-tabel (sectie 4.1), per laag overrule-baar
  - Knop "Negatieve kleef-grens overrulen" → number input m NAP
  - Grondwaterstand (GWS) m NAP — bepaalt of `γ_wat` mee-telt per laag

### 3.4 PileChartView (midden)

Hergebruikt `ChartCanvas` met extra **paal-annotaties-overlay**:

- Horizontale lijnen op paalkop / paalpunt / water / ontgraving (met m NAP labels)
- Gekleurde diepe-zone-blokken: 8D omhoog (rood-paars), 4D omlaag (blauw),
  paalpunt-stippellijn (rood)
- qc;I / qc;II / qc;III gemiddelde-labels naast de qc-curve in invloed-gebied
- Pijl-annotaties bij paalpunt:
  - Boven: "35 kN" (Fnk)
  - Naast paal-as: "201 kN" (Rs;cal;max)
  - Onder paalpunt: "419 kN" (Rb;cal;max)
- Neg.kleef-grens horizontale lijn met label "NAP -9,00 m"

Hover-tooltip op annotaties (b.v. "Rb;cal;max = 419 kN — formule 7.6.2.3(e)").

### 3.5 PileResultPanel (rechts)

Secties analoog aan blad 3 van 984.pdf, in deze volgorde:

1. **Negatieve kleef** (§7.6.2.2)
2. **Puntdraagvermogen** (§7.6.2.3 e/f)
3. **Maximumschachtwrijving** (§7.6.2.3 h/i)
4. **Maximum gronddraagvermogen** (Rc;cal)
5. **Berekening zakking** (§7.6.4.2 + Figuur 7.n/7.o)
6. **Veerwaarde** (kmin / k / kmax)
7. **Samenvatting + Unity check**

Elke formule gerenderd als drie regels:

```
Symbolische vorm:    qb;max = ½·αp·β·s·((qc;I;gem + qc;II;gem)/2 + qc;III;gem)
Ingevulde getallen:  qb;max = ½·0,70·1,0·1,0·((17,97 + 17,73)/2 + 13,91)
Uitkomst:            qb;max = 11,12 MPa < 15,00 MPa ✓
```

Geen externe LaTeX-dep — pure HTML met `<sub>`/`<sup>` voor subscripts,
Unicode voor Greek (α, β, γ, σ). CSS in `FunderingspaalView.css`. Houdt
de bundel-size klein.

### 3.6 StatusBar onder de view

Eén-regel samenvatting, live update:

```
Unity check 0,92 ✓ • NEd = 324 kN < Rc;netto;d = 351 kN • Veer 67 MN/m
```

Bij `unity > 1.0` rood + ✗, anders groen + ✓.

## 4. Berekening — Eurocode 7 §7.6.2.3

### 4.1 Negatieve kleef (formule 7.6) — per-laag berekening

```
Per laag i (top..bottom van de neg.kleef-zone):
  σk;rep,i      = σk;rep,i-1 + Δhᵢ · (γᵢ - γwat,i)    (σ-stack opbouwen)
  σk;gem;rep,i  = (σk;rep,i-1 + σk;rep,i) / 2 · Δhᵢ   (gemiddelde × dikte)
  K₀,i          = 1 - sin(Φᵢ)                        (rusttegen­druk-coëfficient)
  δᵢ            = 0,75 · Φᵢ                          (paal-grond wrijvingshoek)
  (K₀·tan δ)ᵢ   = max(K₀,i · tan(δᵢ), 0,25)          (Eurocode min-cap)
  Fs;nk;rep,i   = σk;gem;rep,i · Os;gem · (K₀·tan δ)ᵢ

Totaal:
  Fnk;rep = Σᵢ Fs;nk;rep,i
  Fnk;d   = γf,nk · Fnk;rep                          (γf,nk = 1,00)
```

**Inputs per laag** (uit `pile/types.ts` grondsoort-tabel, default-waarden
afgestemd op de 3BM ODS-template):

| Grondsoort | γ [kN/m³] | γ_wat [kN/m³] | Φ [°] | Notitie |
|---|---|---|---|---|
| Zand droog | 17,0 | 0,0 | 32,5 | boven GWS |
| Zand nat | 17,0 | 10,0 | 32,5 | onder GWS |
| Veen nat | 13,0 | 10,0 | 15,0 | |
| Klei nat | 18,0 | 10,0 | 22,5 | matig consistentie |
| Klei vast | 19,0 | 10,0 | 25,0 | vaste kern |

User-editable via een soillaag-tabel in PileInputPanel (per laag: grondsoort
dropdown + Δh + auto-populated γ/Φ, met override-velden). Robertson zone-
detectie levert default soilkind per laag.

- `Os;gem` = π · D (rond) of 2(a+b) (rechthoek)
- Zone = paalkop → `negKleefBottomNAP`
  - Default `negKleefBottomNAP` = top eerste vaste-zandlaag uit Robertson
  - Gebruiker kan overrulen via input-panel
- `ΔLnk = pileTopNAP - negKleefBottomNAP`
- **K₀·tan(δ) wordt NIET hardcoded** — altijd berekend uit Φ per laag,
  met de Eurocode-minimumeis 0,25 als ondergrens.

### 4.2 Puntdraagvermogen (formule 7.6.2.3 e/f)

```
qb;max = ½ · αp · β · s · ((qc;I;gem + qc;II;gem)/2 + qc;III;gem)
qb;max ≤ 15 MPa                                      (cap uit (f))
Rb;cal;max = Ab · qb;max
```

**Implementatie qc;I/II/III** (kritische-dieptemethode van Boer):

```
Deq = D   (voor ronde palen)

Traject I:  paalpunt → paalpunt + dc,  waar dc ∈ [0,7·Deq, 4·Deq]
            kies dc die qb;max minimaliseert (sweep met stap 0,01·Deq)
            qc;I;gem = rekenkundig gemiddelde qc over Traject I

Traject II: dc → paalpunt (omhoog kijkend)
            running-min over qc-waarden (alleen waarden ≤ vorige worden meegenomen)
            qc;II;gem = rekenkundig gemiddelde qc over Traject II

Traject III: paalpunt → paalpunt - 8·Deq (omhoog)
             running-min
             qc;III;gem = rekenkundig gemiddelde qc over Traject III
```

Complexity O(N · 0,01·Deq/Δd) — bij Deq=219mm en Δd=20mm = ~110 iteraties
per N-meting in zone, totaal <1ms in TS.

### 4.3 Maximumschachtwrijving (formule 7.6.2.3 h/i)

```
Rs;cal;max = Os;gem · Σⱼ(αs · qc;j;gem · hⱼ)
qs;max ≤ qs_cap_per_soiltype                         (Tabel 7.d)
```

Zone = `negKleefBottomNAP` → paalpunt (alleen positieve schachtwrijving).
Per Robertson-laag j in die zone: gemiddelde qc met cap per grondsoort
(zand=0,15 MPa, klei=0,10 MPa, veen=0,02 MPa — uit tabel in `pile/types.ts`).

### 4.4 Maximum gronddraagvermogen

```
Rc;cal = Rb;cal;max + Rs;cal;max
```

### 4.5 Zakking — lastzakkingslijn (§7.6.4.2, Figuur 7.n + 7.o)

```
Fc;tot = NEk + Fnk
```

**Curves uit Eurocode digitaal als lookup-table** in `pile/zakking.ts`:

- `figuur7n[]` — `(sb/Deq · 100%) → (Rb/Rb;cal;max %)` voor voorgespannen
  paal (Lastzakkingslijn 1). Discretisatie elke 0,1% op X-as.
- `figuur7o[]` — `sb [mm] → (Rs/Rs;cal;max %)`. Discretisatie elke 0,5 mm.

**Iteratie**: bisectie op `sb`:

```ts
function solveSb(Fc_tot, Rb_max, Rs_max, Deq, EA, L, deltaL): number {
  let lo = 0, hi = 0.05 * Deq;  // 5% zakkingsratio als bovengrens
  for (let iter = 0; iter < 30; iter++) {
    const sb = (lo + hi) / 2;
    const Rb = lookup(figuur7n, sb / Deq * 100) / 100 * Rb_max;
    const Rs = lookup(figuur7o, sb * 1000) / 100 * Rs_max;
    if (Rb + Rs > Fc_tot) hi = sb; else lo = sb;
    if (hi - lo < 0.0001) break;  // <0,1 mm convergentie
  }
  return (lo + hi) / 2;
}
```

Daarna:

```
Fgem = (l·Fc;tot + 0,5·ΔL·(Fc;tot - Rb)) / L
sel = L · Fgem / EA
s1 = sb + sel
```

Met:
- `l` = paalkop tot maaiveld = `pileTopNAP - excavationNAP`
- `L` = paallengte = `pileTopNAP - pileToeNAP`
- `ΔL` = zone schachtwrijving = `negKleefBottomNAP - pileToeNAP`

### 4.6 Veerwaarde

```
k    = Fc;tot / s1
kmin = k / √2   = k · 0,7071
kmax = k · √2   = k · 1,4142
```

### 4.7 Samenvatting + unity check (n=1, MVP)

Uit Tabel A.10a met n=1:

```
ξ3 = ξ4 = 1,39
Rc;k = Rc;cal / ξ3 = Rc;cal / 1,39
Rc;d = Rc;k / γm                                     (γm = 1,20)
Rc;net;d = Rc;d - Fnk;d
unity = NEd / Rc;net;d                               (voldoet als ≤ 1,0)
```

### 4.8 Default factoren — Tabel 7.c

Eerste catalog-entry in `pileTypeCatalog.ts`:

```ts
{
  id: "stalen-buispaal-geheid-gesloten",
  name: "Stalen buispaal",
  specification: "Geheid (grondverdringend, gesloten punt)",
  alphaP: 0.70,
  alphaS: 0.008,
  alphaT: 0.006,
  isCircular: true,
  beta: 1.0,
  s: 1.0,
}
```

Catalog is uitbreidbaar in v2 met andere paaltypen — entries komen
één-op-één uit Tabel 7.c.

## 5. Error handling

Edge-cases met test-fixtures:

1. **Paalpunt in kleilaag** → Rb;cal;max < 50 kN → toon rode badge
   "Paalpunt in slappe laag — controleer pile.toeNAP"
2. **Sondering te ondiep** (eindigt < paalpunt + 0,7·Deq) → throw
   `PileCalcError("Sondering reikt ${X} m onder paalpunt — minimaal ${Y} m vereist")` →
   PileResultPanel vangt + toont nette melding
3. **Geen vaste zandlaag voor neg.kleef** → set `negKleefBottomNAP =
   paalpunt - 0,5m` als fallback + waarschuwingsbanner met knop "Stel
   handmatig in"
4. **qb;max > 15 MPa** → cap toepassen + opmerking in formule-paneel
   "qb;max = 18,3 → gecapt op 15 MPa per §7.6.2.3(f)"
5. **Robertson-classificatie ontbreekt** in browser-modus (geen WASM-port) →
   default-aanname "alles zand boven paalpunt" + waarschuwingsbanner
   "Browser-modus heeft geen automatische soillaag-classificatie —
   resultaten zijn indicatief, valideer in desktop-versie"
6. **NEd of NEk = 0** → unity check overslaan, alleen draagvermogen
   tonen + opmerking "Geen belasting opgegeven"
7. **EA = 0** → zakkings-berekening overslaan, sel = N/A in resultaat

## 6. Testen

`apps/desktop/src/calc/pile.test.ts` met vitest:

### 6.1 Gouden test A — referentie 984.pdf blad 1-3 (ExternPakket)

Fixture: `__fixtures__/sondering-984.json` met:
- Sondering 1 uit 984.pdf (CPT-data, paalkop +0,34, paalpunt -14,50)
- Verwachte input: NEd=324, NEk=303, γm=1,20, D=219mm, etc.

Assertions (tolerantie 1 kN / 0,01):
```ts
expect(result.Fnk).toBeCloseTo(35, 0)           // kN
expect(result.qbMaxMPa).toBeCloseTo(11.12, 2)   // MPa
expect(result.RbCalMax).toBeCloseTo(419, 0)
expect(result.RsCalMax).toBeCloseTo(202, 0)
expect(result.RcCal).toBeCloseTo(621, 0)
expect(result.RcD).toBeCloseTo(372, 0)          // 621/1.39/1.20
expect(result.RcNetD).toBeCloseTo(337, 0)       // 372 - 35
expect(result.unity).toBeCloseTo(0.96, 2)       // 324/337
```

> NB: De PDF gebruikt nog n=7 (multi-CPT) en komt op 0,92. Voor n=1
> wordt de unity iets hoger door grotere ξ-factor.

### 6.2 Gouden test B — referentie 3BM ODS-template (CGEO1)

Fixture: `__fixtures__/sondering-3bm-cgeo1.json` met:
- Inputs uit `3151-CB-21 Constructieberekening.ods`, tabblad CGEO1
- D=168mm (Deq=178mm), paalkop -0,5, paalpunt -14,0
- 4 lagen neg.kleef: Zand droog -0,5/-2,5; Zand nat -2,5/-4,0;
  Veen nat -4,0/-6,0; Klei nat -6,0/-8,0 (GWS -2,5)

Assertions (tolerantie 0,5 kN):
```ts
// Per-laag neg.kleef met K0·tan(δ) cap op 0,25
expect(result.negKleef.layers[0].fsNkRep).toBeCloseTo(4.49, 1)  // Zand droog
expect(result.negKleef.layers[1].fsNkRep).toBeCloseTo(7.77, 1)  // Zand nat
expect(result.negKleef.layers[2].fsNkRep).toBeCloseTo(12.53, 1) // Veen
expect(result.negKleef.layers[3].fsNkRep).toBeCloseTo(15.44, 1) // Klei
expect(result.Fnk).toBeCloseTo(40.2, 1)         // Σ
expect(result.RbCal).toBeCloseTo(141.1, 1)      // qbMax 5,67 MPa × 24884 mm²
expect(result.RsCal).toBeCloseTo(79.2, 1)
expect(result.RcD).toBeCloseTo(132.1, 1)
expect(result.RcNetD).toBeCloseTo(91.8, 1)      // 132,1 - 40,2
```

Deze test garandeert dat de per-laag K₀·tan(δ) berekening (inclusief de
0,25 minimum-cap) exact matcht met de praktijk-template die 3BM
Bouwtechniek dagelijks gebruikt.

### 6.2 Unit tests per stap

- `negKleef.test.ts` — vergelijk Fnk over verzonnen profiel met handmatig
  uitgewerkt voorbeeld
- `puntdraagvermogen.test.ts` — qc;I/II/III gemiddelden tegen handmatige
  sweep, qb-cap edge case
- `schachtwrijving.test.ts` — Rs cap per grondsoort, lege zone
- `zakking.test.ts` — bisectie-convergentie, edge case `Fc;tot >
  Rb+Rs;max` (toon "geen oplossing" foutmelding)
- `samenvatting.test.ts` — ξ-factoren voor n=1, n=2 (toekomstige uitbreiding)

### 6.3 UI snapshot-tests (optioneel)

Niet in MVP. Wel structuur klaarzetten voor `@testing-library/react`
zodat we later snapshot-tests kunnen toevoegen voor de drie panelen.

## 7. Open punten / aannames

Aannames die ik in dit design heb gemaakt — pas aan bij review als gewenst:

1. **Lastzakkingslijn als lookup-tabel** — Figuur 7.n/7.o uit Eurocode
   digitaliseren als hardcoded array in `zakking.ts`. Alternatief: data
   inlezen via JSON-resource zodat aanpassingen niet recompiles vereisen.
2. **EA paal** — afgeleid uit D + wanddikte t in input-panel (E_staal =
   210 GPa). Alternatief: directe input.
3. **K₀·tan(δ) per laag berekend** uit Φ (K₀=1-sin(Φ), δ=0,75·Φ) met
   Eurocode-minimumeis 0,25 als ondergrens. Φ-defaults per grondsoort uit
   tabel in sectie 4.1, user-editable. Bron-aanname: 3BM ExternPakket/ODS
   template "CGEO1" — geverifieerd 2026-05-21.
4. **qs;max per grondsoort** — defaults uit `Tabel 7.d` (zand 0,15 MPa,
   klei 0,10 MPa, veen 0,02 MPa). Bron-tabel in `pile/types.ts`, niet
   editable in MVP.
5. **Robertson in browser** — niet beschikbaar; webdemo toont
   waarschuwing en gebruikt aanname "alles zand boven paalpunt".
   Acceptabel voor demo-doel; valideren in desktop.
6. **`detect_layers` Tauri-command** — al beschikbaar in cpt-core.
   Aanroep via bestaand `cptPlatform.detectLayers(cptId)` patroon
   (toevoegen aan `platform.ts`).

## 8. Implementatie-volgorde (suggestie)

1. **Calc-laag eerst** — `apps/desktop/src/calc/pile/*.ts` + tests met
   984.pdf-fixture. Geen UI nodig om te valideren. Eindigt met groene
   gouden test.
2. **Extension-registratie** — `useExtensions.ts` + `ExtensionManagerPanel.tsx`
   + `SettingsDialog.tsx` (minimal mechanical change).
3. **View skeleton** — `FunderingspaalView.tsx` + lege panelen +
   Ribbon-tab + App.tsx routing. Toon "Hello world" — verifiëer dat
   tab werkt.
4. **PileInputPanel** — formulier-state in `usePileStore`, defaults uit
   actieve CPT (paalkop = ground level, etc.).
5. **PileResultPanel** — bind aan `useMemo(() => computePileDesign(...))`.
   Render alle formules met getallen.
6. **PileChartView** — annotaties-overlay op bestaande `ChartCanvas`.
   Begin met simpele horizontale lijnen, voeg gekleurde zones + pijlen
   incrementeel toe.
7. **StatusBar** — unity-check display onder de view.
8. **Persistentie** — `pile_designs` in Project-save/load flow.
9. **Polish** — error-banners, edge-case handling, hover-tooltips.

## 9. Niet-doelen

Om scope-creep te voorkomen, expliciet **niet** in v1:

- Geen PDF-export
- Geen multi-CPT samenvatting
- Geen andere paaltypen dan Stalen buispaal geheid
- Geen paalgroep
- Geen trekpaal
- Geen WASM-port van Robertson voor browser
- Geen handmatige soillaag-editor
- Geen historie van eerdere paal-designs binnen het project (alleen
  huidige design wordt bewaard)

Elk van bovenstaande is een mooie v2/v3-iteratie en past in dezelfde
architectuur zonder ingrijpende refactor — de calc-functies zijn
allemaal pure functies die we kunnen mappen over meerdere CPTs, de
catalog is uitbreidbaar, en het design-model is per-pile.
