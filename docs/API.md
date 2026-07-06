# Open Geotechniek Studio — REST API

Start de lokale API met:

```
open-geo-studio --serve            # default poort 8787
open-geo-studio --serve --port 8791
```

De server bindt uitsluitend op `127.0.0.1` (alleen lokaal bereikbaar,
geen authenticatie nodig of aanwezig). Dezelfde kernfuncties zijn ook
beschikbaar als MCP-server (`open-geo-studio --mcp`, stdio-transport);
beide roepen dezelfde interne `*_core`-functies aan als de desktop-GUI.

`GET /api` geeft de volledige endpoint-catalogus machine-leesbaar terug.

## Overzicht

| Methode | Pad                          | Omschrijving |
|---------|------------------------------|--------------|
| GET     | `/api`                       | Zelfbeschrijvende endpoint-index |
| GET     | `/api/health`                | Status + aantal geladen CPT's |
| GET     | `/api/cpts`                  | Alle geparste CPT's (incl. meetdata) |
| POST    | `/api/cpts`                  | GEF- of BRO-XML parsen en cachen |
| GET     | `/api/cpts/:id`              | Eén CPT (incl. meetdata) |
| DELETE  | `/api/cpts/:id`              | CPT uit de cache verwijderen |
| GET     | `/api/cpts/:id/layers`       | Robertson-laagdetectie |
| GET     | `/api/cpts/:id/csv`          | Meetdata als CSV (`text/csv`) |
| POST    | `/api/export/geojson`        | GeoJSON FeatureCollection van CPT-locaties |
| POST    | `/api/export/dwg`            | Tekening-geometrie naar DXF/DWG (bytes) |
| POST    | `/api/report`                | Multi-CPT PDF-rapport (`application/pdf`) |
| POST    | `/api/ifc`                   | IFC4x3 of IFCX genereren uit geladen CPT's |
| POST    | `/api/project/ifcx`          | IFCX-preview van een tekening-state |
| POST    | `/api/bro/area`              | BRO-sonderingen binnen een bbox |
| POST    | `/api/bro/bores`             | BRO-boringen binnen een bbox |
| GET     | `/api/bro/cpt/:bro_id`       | BRO CPT-XML |
| GET     | `/api/bro/bore/:bro_id`      | BRO boring-XML |
| GET     | `/api/bro/meta/:kind/:bro_id`| BRO object-metadata (`kind`: `cpt` \| `bore`) |

Fouten komen terug als HTTP 400 met een leesbare platte-tekst-melding.
De request-body-limiet is 64 MB.

## Werkstroom: CPT importeren → analyseren → rapporteren

```bash
# 1. GEF importeren (of BRO-XML — de bestandsnaam stuurt de detectie)
curl -s -X POST http://127.0.0.1:8787/api/cpts \
  -H "Content-Type: application/json" \
  -d "{\"content\": $(python -c "import json,sys;print(json.dumps(open('sondering.gef').read()))"), \"filename\": \"sondering.gef\"}"
# → volledige CPT-JSON, het veld "id" gebruik je in de vervolg-calls

# 2. Robertson-lagen
curl -s http://127.0.0.1:8787/api/cpts/CPT000000036564/layers

# 3. Meetdata als CSV
curl -s http://127.0.0.1:8787/api/cpts/CPT000000036564/csv -o sondering.csv

# 4. PDF-rapport (sections optioneel; weggelaten = alle standaard-secties)
curl -s -X POST http://127.0.0.1:8787/api/report \
  -H "Content-Type: application/json" \
  -d '{
    "cpt_ids": ["CPT000000036564"],
    "project": { "title": "Voorbeeldproject", "client": "-", "location": "-",
                 "project_number": "P-001", "author": "API", "date": "2026-07-06" },
    "sections": { "cover": true, "coordTable": true, "map": true,
                  "perCpt": true, "sbtLegend": true, "metadata": false }
  }' -o rapport.pdf
```

## BRO rechtstreeks

```bash
# Sonderingen in een gebied (WGS84-bbox)
curl -s -X POST http://127.0.0.1:8787/api/bro/area \
  -H "Content-Type: application/json" \
  -d '{"bbox": {"min_lat": 51.812, "min_lon": 4.659, "max_lat": 51.816, "max_lon": 4.664}}'

# Boringen: zelfde body op /api/bro/bores

# Eén object ophalen en direct importeren
curl -s http://127.0.0.1:8787/api/bro/cpt/CPT000000036564 -o bro.xml
# → daarna POST /api/cpts met de XML-inhoud en filename "bro.xml"

# Metadata zonder de volledige XML
curl -s http://127.0.0.1:8787/api/bro/meta/cpt/CPT000000036564
```

## Exports

### GeoJSON

```bash
curl -s -X POST http://127.0.0.1:8787/api/export/geojson \
  -H "Content-Type: application/json" \
  -d '{"cpt_ids": ["CPT000000036564"]}'
```

### DXF / DWG

De body draagt de tekening-geometrie als platte entity-lijst per laag, in
meters (RD-coördinaten EPSG:28992, of een lokale oorsprong — de API neemt
de getallen letterlijk over). `format` is `"dxf"` (default, meest robuuste
round-trip) of `"dwg"`. De response is het CAD-bestand als bytes.

```bash
curl -s -X POST http://127.0.0.1:8787/api/export/dwg \
  -H "Content-Type: application/json" \
  -d '{
    "format": "dxf",
    "entities": [
      { "layer": "LIJNEN",      "type": "line",     "points": [[0,0],[50,25]] },
      { "layer": "VLAKKEN",     "type": "hatch",    "points": [[0,0],[10,0],[10,10]], "closed": true },
      { "layer": "SONDERINGEN", "type": "point",    "points": [[5,5]] },
      { "layer": "SONDERINGEN", "type": "text",     "points": [[6,6]], "text": "S1", "height": 1.2 },
      { "layer": "PERCELEN",    "type": "polyline", "points": [[0,0],[20,0],[20,20],[0,20]], "closed": true }
    ],
    "layer_colors": { "LIJNEN": 7, "VLAKKEN": 4, "SONDERINGEN": 5 }
  }' -o tekening.dxf
```

Entity-typen: `line` (2 punten), `polyline` (n punten, `closed` optioneel),
`point`, `text` (`text`, `height` in m, `rotation` in graden) en `hatch`
(gevuld vlak, ≥ 3 punten). `layer_colors` koppelt een ACI-kleurindex aan
een laagnaam (1 = rood, 2 = geel, 3 = groen, 4 = cyaan, 5 = blauw, 7 = wit).

Optioneel veld `images`: georefereerde afbeeldingen als
`{ name, ext, data_base64, insertion: [x, y], world_width, world_height,
rotation, px_w, px_h }`. Het CAD-bestand verwijst relatief naar
`<name>_afbN.<ext>`; plaats dat bestand zelf naast de DXF/DWG (de API geeft
alleen het CAD-bestand terug — de afbeeldingsbytes had de client al).

## IFC

```bash
# IFC4x3 (of "ifcx") uit geladen CPT's; response bevat o.a. "content"
curl -s -X POST http://127.0.0.1:8787/api/ifc \
  -H "Content-Type: application/json" \
  -d '{"cpt_ids": ["CPT000000036564"], "project": {"title": "Voorbeeld"}, "format": "ifc4x3"}'
```

`POST /api/project/ifcx` accepteert een volledige `.ifcgis`-payload (zoals
de desktop-app die opslaat) en geeft de IFCX-serialisatie terug — handig om
een situatietekening-state scriptmatig om te zetten.

## MCP-server

Dezelfde functionaliteit is beschikbaar via `open-geo-studio --mcp`
(Model Context Protocol over stdio) met tools voor CPT-import, lagen,
exports, BRO, IFC en rapporten. De `report_preview`-tool accepteert
dezelfde optionele `sections`-selectie als `POST /api/report`.
