//! DWG/DXF-export van de situatietekening via de `acadrust`-crate.
//!
//! De frontend stelt alle geometrie samen — sonderingen, boringen,
//! rasters, lijnen, maatlijnen, coördinaatpunten, vlakken én de GIS-lagen
//! (BAG-gebouwen, kadastrale percelen) — in RD-coördinaten (meters,
//! EPSG:28992), of desgewenst verschoven naar een lokale oorsprong. Het
//! levert een platte lijst entities aan, gegroepeerd per laag. Dit command
//! bouwt daar een CAD-document van en schrijft het naar het door de
//! gebruiker gekozen pad. De bestandsextensie bepaalt het formaat:
//! `.dxf` → DXF (ASCII), anders → DWG (binair).

use std::collections::{HashMap, HashSet};

use acadrust::entities::{EntityType, Line, LwPolyline, Point, Text};
use acadrust::tables::Layer;
use acadrust::types::{Color, Vector2, Vector3};
use acadrust::{CadDocument, DwgWriter, DxfWriter};
use serde::Deserialize;

/// Eén tekenobject in het door de frontend aangeleverde CAD-model.
#[derive(Deserialize)]
pub struct DwgEntity {
    /// Laagnaam, bv. "SONDERINGEN", "LIJNEN", "GIS_GEBOUWEN".
    pub layer: String,
    /// Objecttype: "line" | "polyline" | "point" | "text".
    #[serde(rename = "type")]
    pub kind: String,
    /// RD-punten als [easting, northing]. line = 2 punten, polyline = n,
    /// point/text = 1.
    #[serde(default)]
    pub points: Vec<[f64; 2]>,
    /// Tekstinhoud (alleen bij kind == "text").
    #[serde(default)]
    pub text: Option<String>,
    /// Sluit de polyline (vlakken / percelen / gebouwen).
    #[serde(default)]
    pub closed: bool,
    /// Teksthoogte in tekeningeenheden (meters). Default 1.0.
    #[serde(default)]
    pub height: Option<f64>,
    /// Tekstrotatie in graden (tegen de klok in, CAD-conventie).
    #[serde(default)]
    pub rotation: Option<f64>,
}

/// Volledige export-payload.
#[derive(Deserialize)]
pub struct DwgPayload {
    pub entities: Vec<DwgEntity>,
    /// Laagnaam → ACI-kleurindex (1=rood, 3=groen, 5=blauw, 7=wit…),
    /// zodat de lagen in CAD een herkenbare kleur krijgen. Optioneel.
    #[serde(default)]
    pub layer_colors: HashMap<String, i16>,
}

/// Bouw het CAD-document en schrijf het naar `path`. `.dxf` → DXF, anders
/// DWG. Geeft een leesbare foutmelding terug bij mislukken.
#[tauri::command]
pub fn export_dwg(payload: DwgPayload, path: String) -> Result<(), String> {
    let mut doc = CadDocument::new();

    // Lagen vooraf aanmaken (met kleur) zodat elke CAD-lezer ze kent en
    // de entities er netjes op belanden.
    let mut seen: HashSet<&str> = HashSet::new();
    for ent in &payload.entities {
        if seen.insert(ent.layer.as_str()) {
            let mut layer = Layer::new(ent.layer.clone());
            if let Some(idx) = payload.layer_colors.get(&ent.layer) {
                layer.color = Color::from_index(*idx);
            }
            doc.layers.add(layer).ok();
        }
    }

    for ent in &payload.entities {
        match ent.kind.as_str() {
            "line" => {
                if ent.points.len() >= 2 {
                    let a = ent.points[0];
                    let b = ent.points[1];
                    let mut line = Line::from_coords(a[0], a[1], 0.0, b[0], b[1], 0.0);
                    line.common.layer = ent.layer.clone();
                    doc.add_entity(EntityType::Line(line))
                        .map_err(|e| e.to_string())?;
                }
            }
            "polyline" => {
                if ent.points.len() >= 2 {
                    let mut pl = LwPolyline::new();
                    for p in &ent.points {
                        pl.add_point(Vector2::new(p[0], p[1]));
                    }
                    if ent.closed {
                        pl.close();
                    }
                    pl.common.layer = ent.layer.clone();
                    doc.add_entity(EntityType::LwPolyline(pl))
                        .map_err(|e| e.to_string())?;
                }
            }
            "point" => {
                if let Some(p) = ent.points.first() {
                    let mut pt = Point::from_coords(p[0], p[1], 0.0);
                    pt.common.layer = ent.layer.clone();
                    doc.add_entity(EntityType::Point(pt))
                        .map_err(|e| e.to_string())?;
                }
            }
            "text" => {
                if let (Some(p), Some(t)) = (ent.points.first(), ent.text.as_ref()) {
                    let mut txt = Text::with_value(t.clone(), Vector3::new(p[0], p[1], 0.0))
                        .with_height(ent.height.unwrap_or(1.0));
                    if let Some(r) = ent.rotation {
                        txt = txt.with_rotation(r);
                    }
                    txt.common.layer = ent.layer.clone();
                    doc.add_entity(EntityType::Text(txt))
                        .map_err(|e| e.to_string())?;
                }
            }
            _ => {}
        }
    }

    let lower = path.to_lowercase();
    if lower.ends_with(".dxf") {
        DxfWriter::new(&doc)
            .write_to_file(&path)
            .map_err(|e| e.to_string())?;
    } else {
        DwgWriter::write_to_file(&path, &doc).map_err(|e| e.to_string())?;
    }
    Ok(())
}
