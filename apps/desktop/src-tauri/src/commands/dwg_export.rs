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
//!
//! De REST-API gebruikt dezelfde opbouw via `export_dwg_bytes` en geeft
//! het bestand als bytes terug (de afbeelding-sidecars levert de client
//! daar zelf aan — hij bezit de base64 immers al).

use std::collections::{HashMap, HashSet};
use std::path::Path;

use acadrust::entities::{
    BoundaryEdge, BoundaryPath, EntityType, Hatch, Line, LwPolyline, Point, PolylineEdge,
    RasterImage, Text,
};
use acadrust::objects::{ImageDefinition, ObjectType};
use acadrust::tables::Layer;
use acadrust::types::{Color, Handle, Vector2, Vector3};
use acadrust::{CadDocument, DwgWriter, DxfWriter};
use base64::Engine;
use serde::Deserialize;

/// Eén tekenobject in het door de frontend aangeleverde CAD-model.
#[derive(Deserialize)]
pub struct DwgEntity {
    /// Laagnaam, bv. "SONDERINGEN", "LIJNEN", "GIS_GEBOUWEN".
    pub layer: String,
    /// Objecttype: "line" | "polyline" | "point" | "text" | "hatch".
    #[serde(rename = "type")]
    pub kind: String,
    /// RD-punten als [easting, northing]. line = 2 punten, polyline/hatch
    /// = n, point/text = 1.
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

/// Eén georefereerde afbeelding (image-overlay) in de export. De bytes
/// worden als sidecar-bestand naast de DWG/DXF geschreven; het CAD-bestand
/// verwijst er relatief naar (net als een externe xref).
#[derive(Deserialize)]
pub struct DwgImage {
    /// Bestandsnaam-stam voor het sidecar-bestand (zonder pad/extensie).
    pub name: String,
    /// Extensie zonder punt ("png" / "jpg").
    #[serde(default)]
    pub ext: String,
    /// Ruwe base64 (zonder `data:`-URL-prefix).
    pub data_base64: String,
    /// Invoegpunt (linksonder) in RD [easting, northing].
    pub insertion: [f64; 2],
    /// Breedte en hoogte in tekeningeenheden (meters).
    pub world_width: f64,
    pub world_height: f64,
    /// Rotatie in graden (tegen de klok in). Draait om het invoegpunt.
    #[serde(default)]
    pub rotation: f64,
    /// Pixelafmetingen (metadata + aspect).
    pub px_w: f64,
    pub px_h: f64,
}

/// Volledige export-payload.
#[derive(Deserialize)]
pub struct DwgPayload {
    pub entities: Vec<DwgEntity>,
    /// Laagnaam → ACI-kleurindex (1=rood, 3=groen, 5=blauw, 7=wit…),
    /// zodat de lagen in CAD een herkenbare kleur krijgen. Optioneel.
    #[serde(default)]
    pub layer_colors: HashMap<String, i16>,
    /// Georefereerde afbeeldingen (image-overlays). Optioneel.
    #[serde(default)]
    pub images: Vec<DwgImage>,
}

/// Resultaat van [`build_document`]: het CAD-document plus de afbeelding-
/// sidecars (bestandsnaam → bytes) waar het document relatief naar verwijst.
pub struct BuiltDocument {
    pub doc: CadDocument,
    pub sidecars: Vec<(String, Vec<u8>)>,
}

/// Bouw het CAD-document uit de payload. Gedeeld door het Tauri-command
/// (schrijft naar een pad + sidecars ernaast) en de REST-API (geeft bytes
/// terug). Layers worden vooraf aangemaakt zodat elke CAD-lezer ze kent.
pub fn build_document(payload: &DwgPayload) -> Result<BuiltDocument, String> {
    let mut doc = CadDocument::new();

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
            "hatch" => {
                // Gevuld vlak ("arcering"): solid hatch met de punten als
                // gesloten polyline-rand.
                if ent.points.len() >= 3 {
                    let mut hatch = Hatch::new();
                    let verts: Vec<Vector2> =
                        ent.points.iter().map(|p| Vector2::new(p[0], p[1])).collect();
                    let mut bp = BoundaryPath::new();
                    bp.add_edge(BoundaryEdge::Polyline(PolylineEdge::new(verts, true)));
                    hatch.paths.push(bp);
                    hatch.common.layer = ent.layer.clone();
                    doc.add_entity(EntityType::Hatch(hatch))
                        .map_err(|e| e.to_string())?;
                }
            }
            _ => {}
        }
    }

    // Georefereerde afbeeldingen: RasterImage + ImageDefinition die
    // relatief naar het sidecar-bestand verwijzen. De bytes zelf gaan
    // als sidecars terug naar de caller (pad-schrijven of client).
    let mut sidecars: Vec<(String, Vec<u8>)> = Vec::new();
    if !payload.images.is_empty() {
        doc.layers.add(Layer::new("AFBEELDINGEN")).ok();
    }
    for (idx, im) in payload.images.iter().enumerate() {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(im.data_base64.trim())
            .map_err(|e| format!("afbeelding {idx}: base64-fout: {e}"))?;
        let ext = if im.ext.is_empty() { "png" } else { im.ext.as_str() };
        let fname = format!("{}_afb{}.{}", im.name, idx + 1, ext);
        let px_w = im.px_w.max(1.0);
        let px_h = im.px_h.max(1.0);
        let mut img = RasterImage::with_size(
            &fname,
            Vector3::new(im.insertion[0], im.insertion[1], 0.0),
            px_w,
            px_h,
            im.world_width.max(0.01),
            im.world_height.max(0.01),
        );
        if im.rotation.abs() > 1e-6 {
            let r = im.rotation.to_radians();
            let (c, s) = (r.cos(), r.sin());
            let uw = im.world_width.max(0.01) / px_w;
            let vh = im.world_height.max(0.01) / px_h;
            img.u_vector = Vector3::new(uw * c, uw * s, 0.0);
            img.v_vector = Vector3::new(-vh * s, vh * c, 0.0);
        }
        let def_handle = Handle::new(doc.next_handle());
        let mut def = ImageDefinition::new(fname.clone());
        def.set_size_pixels(px_w as u32, px_h as u32);
        img.definition_handle = Some(def_handle);
        img.common.layer = "AFBEELDINGEN".to_string();
        doc.objects.insert(def_handle, ObjectType::ImageDefinition(def));
        doc.add_entity(EntityType::RasterImage(img))
            .map_err(|e| e.to_string())?;
        sidecars.push((fname, bytes));
    }

    Ok(BuiltDocument { doc, sidecars })
}

/// Bouw het document en geef het CAD-bestand als bytes terug ("dxf" of
/// "dwg"). Gaat via een tijdelijk bestand omdat de acadrust-writers naar
/// paden schrijven. De sidecars worden hier bewust NIET geschreven — de
/// caller (REST-client) bezit de afbeeldingsbytes zelf al.
pub fn export_dwg_bytes(payload: &DwgPayload, format: &str) -> Result<Vec<u8>, String> {
    let built = build_document(payload)?;
    let ext = if format.eq_ignore_ascii_case("dwg") { "dwg" } else { "dxf" };
    let mut tmp = std::env::temp_dir();
    tmp.push(format!("ogs-dwg-export-{}.{ext}", std::process::id()));
    if ext == "dxf" {
        DxfWriter::new(&built.doc)
            .write_to_file(&tmp)
            .map_err(|e| e.to_string())?;
    } else {
        DwgWriter::write_to_file(&tmp, &built.doc).map_err(|e| e.to_string())?;
    }
    let bytes = std::fs::read(&tmp).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&tmp);
    Ok(bytes)
}

/// Tauri-command: bouw het document, schrijf sidecars naast het doel-pad
/// en schrijf het CAD-bestand. De bestandsextensie bepaalt het formaat:
/// `.dxf` → DXF (ASCII), anders DWG (binair).
#[tauri::command]
pub fn export_dwg(payload: DwgPayload, path: String) -> Result<(), String> {
    let built = build_document(&payload)?;

    if let Some(dir) = Path::new(&path).parent() {
        for (fname, bytes) in &built.sidecars {
            std::fs::write(dir.join(fname), bytes)
                .map_err(|e| format!("sidecar {fname}: schrijven mislukt: {e}"))?;
        }
    }

    let lower = path.to_lowercase();
    if lower.ends_with(".dxf") {
        DxfWriter::new(&built.doc)
            .write_to_file(&path)
            .map_err(|e| e.to_string())?;
    } else {
        DwgWriter::write_to_file(&path, &built.doc).map_err(|e| e.to_string())?;
    }
    Ok(())
}
