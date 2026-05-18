//! BRO (Basisregistratie Ondergrond) public REST proxy commands.
//!
//! BRO exposes its data via XML/JSON REST endpoints under
//! `https://publiek.broservices.nl`. We hit it from Rust to avoid CORS in
//! the webview and to keep XML parsing on the native side.
//!
//! Endpoints used (verified live 2025/2026 against the public OpenAPI):
//! - `POST /sr/cpt/v1/characteristics/searches`     — CPT (sondering) area search
//! - `GET  /sr/cpt/v1/objects/{broId}`              — full CPT XML (used by `fetch_bro_cpt`)
//! - `POST /sr/bhrgt/v2/characteristics/searches`   — BHRGT (geotechnical borehole) area search
//! - `GET  /sr/bhrgt/v2/objects/{broId}`            — full BHRGT XML
//!
//! The characteristics endpoint accepts JSON in but only emits XML (the
//! BRO `dispatchCharacteristicsResponse` envelope, ~500 KB for a few
//! hundred features). We parse the XML with `quick-xml` and flatten each
//! `dispatchDocument` into a `BroFeature` containing the lat/lon plus a
//! handful of "interesting" fields (registration date, depth, quality,
//! purpose) inside the `extra` map for popup rendering.

use chrono::NaiveDate;
use quick_xml::events::Event;
use quick_xml::Reader;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

const HTTP_TIMEOUT: Duration = Duration::from_secs(30);
const BASE: &str = "https://publiek.broservices.nl";
/// BRO requires `endDate <= today`, so we cap the registration window
/// at today's date when building search payloads.
const SEARCH_START_DATE: &str = "2017-01-01";

#[derive(Debug, Deserialize)]
pub struct BBox {
    pub min_lat: f64,
    pub min_lon: f64,
    pub max_lat: f64,
    pub max_lon: f64,
}

#[derive(Debug, Serialize, Clone)]
pub struct BroFeature {
    pub id: String,
    pub lat: f64,
    pub lon: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub depth: Option<f64>,
    /// `"cpt"` or `"bore"` — drives marker styling on the React side.
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registration_date: Option<String>,
    /// Bag of useful but loosely-typed fields (project number, quality
    /// class, purpose, vertical datum, …) for popup rendering.
    pub extra: HashMap<String, String>,
}

// ───────────────────────────────────────────────────────────────────
// Public Tauri commands
// ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn fetch_bro_area(bbox: BBox) -> Result<Vec<BroFeature>, String> {
    let url = format!("{BASE}/sr/cpt/v1/characteristics/searches");
    let body = build_search_body(&bbox);
    let xml = post_xml(&url, &body).await?;
    parse_characteristics(&xml, "cpt").map_err(|e| format!("parse CPT search: {e}"))
}

#[tauri::command]
pub async fn fetch_bro_bores(bbox: BBox) -> Result<Vec<BroFeature>, String> {
    let url = format!("{BASE}/sr/bhrgt/v2/characteristics/searches");
    let body = build_search_body(&bbox);
    let xml = post_xml(&url, &body).await?;
    parse_characteristics(&xml, "bore").map_err(|e| format!("parse BHRGT search: {e}"))
}

#[tauri::command]
pub async fn fetch_bro_cpt(bro_id: String) -> Result<String, String> {
    let url = format!("{BASE}/sr/cpt/v1/objects/{bro_id}");
    let client = http_client()?;
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("BRO CPT API HTTP {}", resp.status()));
    }
    resp.text().await.map_err(|e| e.to_string())
}

/// Fetch the full BHR-GT borehole XML for a single BRO object. Returns
/// the raw XML so the front-end can parse + render a strip log without
/// needing additional Rust types. Same shape as `fetch_bro_cpt`.
#[tauri::command]
pub async fn fetch_bro_bore(bro_id: String) -> Result<String, String> {
    let url = format!("{BASE}/sr/bhrgt/v2/objects/{bro_id}");
    let client = http_client()?;
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("BRO bore API HTTP {}", resp.status()));
    }
    resp.text().await.map_err(|e| e.to_string())
}

/// Fetch the *full* BRO object metadata for a CPT or borehole and return
/// it as a flat key/value map suitable for popup rendering. `kind` must
/// be `"cpt"` or `"bore"`.
#[tauri::command]
pub async fn fetch_bro_object_metadata(
    id: String,
    kind: String,
) -> Result<HashMap<String, String>, String> {
    let url = match kind.as_str() {
        "cpt" => format!("{BASE}/sr/cpt/v1/objects/{id}"),
        "bore" | "bhrgt" => format!("{BASE}/sr/bhrgt/v2/objects/{id}"),
        other => return Err(format!("unsupported BRO kind: {other}")),
    };
    let client = http_client()?;
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("BRO API HTTP {}", resp.status()));
    }
    let xml = resp.text().await.map_err(|e| e.to_string())?;
    parse_object_metadata(&xml).map_err(|e| format!("parse object metadata: {e}"))
}

// ───────────────────────────────────────────────────────────────────
// Internals
// ───────────────────────────────────────────────────────────────────

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .user_agent("OpenGeoStudio/0.1 (+https://github.com/OpenAEC-Foundation/open-geotechniek-studio)")
        .build()
        .map_err(|e| e.to_string())
}

async fn post_xml(url: &str, body: &serde_json::Value) -> Result<String, String> {
    let client = http_client()?;
    let resp = client
        .post(url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/xml")
        .json(body)
        .send()
        .await
        .map_err(|e| format!("BRO POST failed: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        // BRO error responses are usually small XML; surface a snippet.
        let snippet: String = text.chars().take(400).collect();
        return Err(format!("BRO HTTP {status}: {snippet}"));
    }
    Ok(text)
}

fn build_search_body(bbox: &BBox) -> serde_json::Value {
    // Cap endDate at today — BRO rejects future dates with HTTP 400.
    let today = chrono::Local::now()
        .date_naive()
        .format("%Y-%m-%d")
        .to_string();
    serde_json::json!({
        "registrationPeriod": {
            "beginDate": SEARCH_START_DATE,
            "endDate": today,
        },
        "area": {
            "boundingBox": {
                "lowerCorner": { "lat": bbox.min_lat, "lon": bbox.min_lon },
                "upperCorner": { "lat": bbox.max_lat, "lon": bbox.max_lon },
            }
        }
    })
}

/// Parse a `dispatchCharacteristicsResponse` XML payload from either the
/// CPT or BHRGT search endpoint and flatten each `dispatchDocument` into
/// a `BroFeature`. Keeps a small whitelist of "interesting" leaf elements
/// in `extra` for popup rendering.
fn parse_characteristics(xml: &str, kind: &str) -> Result<Vec<BroFeature>, String> {
    // We emit a feature for every `dispatchDocument` in the response.
    // Inside each document we look for namespace-suffixed local names like
    // `broId`, `standardizedLocation`, `pos`, `finalDepth`, etc. quick-xml
    // gives us the full prefixed name, so we match on the *local* part to
    // stay robust against namespace prefix changes.
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut features = Vec::new();
    let mut buf = Vec::new();

    // Per-document state.
    let mut in_doc = false;
    let mut depth_stack: Vec<String> = Vec::new();
    let mut current: Option<DocBuilder> = None;
    let mut text_buf = String::new();
    let mut last_attrs: HashMap<String, String> = HashMap::new();
    let mut rejection_reason: Option<String> = None;

    loop {
        match reader
            .read_event_into(&mut buf)
            .map_err(|e| format!("xml read: {e}"))?
        {
            Event::Start(e) => {
                let name = local_name(e.name().as_ref());
                if name == "dispatchDocument" {
                    in_doc = true;
                    current = Some(DocBuilder::new(kind));
                    depth_stack.clear();
                }
                if in_doc {
                    depth_stack.push(name.clone());
                    last_attrs = read_attrs(&e);
                    if let Some(b) = current.as_mut() {
                        b.note_start(&depth_stack, &last_attrs);
                    }
                }
                text_buf.clear();
            }
            Event::Text(t) => {
                text_buf.push_str(&t.unescape().unwrap_or_default());
            }
            Event::End(e) => {
                let name = local_name(e.name().as_ref());
                if in_doc {
                    if let Some(b) = current.as_mut() {
                        b.note_end(&depth_stack, &text_buf, &last_attrs);
                    }
                    if !depth_stack.is_empty() {
                        depth_stack.pop();
                    }
                }
                text_buf.clear();
                if name == "dispatchDocument" {
                    if let Some(b) = current.take() {
                        if let Some(f) = b.build() {
                            features.push(f);
                        }
                    }
                    in_doc = false;
                }
                if name == "rejectionReason" {
                    rejection_reason = Some(text_buf.clone());
                }
            }
            Event::Empty(_) => {
                // Self-closing tags (rare in BRO content) carry no leaf text.
            }
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }

    if let Some(reason) = rejection_reason {
        if features.is_empty() {
            return Err(format!("BRO rejection: {reason}"));
        }
    }
    Ok(features)
}

/// Strip the XML namespace prefix and return the local name.
fn local_name(qname: &[u8]) -> String {
    let s = std::str::from_utf8(qname).unwrap_or("");
    match s.find(':') {
        Some(i) => s[i + 1..].to_string(),
        None => s.to_string(),
    }
}

fn read_attrs(e: &quick_xml::events::BytesStart) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for a in e.attributes().with_checks(false).flatten() {
        let k = local_name(a.key.as_ref());
        let v = String::from_utf8_lossy(&a.value).to_string();
        out.insert(k, v);
    }
    out
}

/// Builder that accumulates fields out of one `<dispatchDocument>` block.
struct DocBuilder {
    kind: String,
    id: Option<String>,
    lat: Option<f64>,
    lon: Option<f64>,
    depth: Option<f64>,
    registration_date: Option<String>,
    extra: HashMap<String, String>,
    /// True while inside `standardizedLocation` (so we know which `<pos>`
    /// to interpret as WGS84 lat/lon — there's also a deliveredLocation
    /// in RD coords that we ignore).
    in_standardized_location: bool,
}

impl DocBuilder {
    fn new(kind: &str) -> Self {
        Self {
            kind: kind.to_string(),
            id: None,
            lat: None,
            lon: None,
            depth: None,
            registration_date: None,
            extra: HashMap::new(),
            in_standardized_location: false,
        }
    }

    fn note_start(&mut self, stack: &[String], _attrs: &HashMap<String, String>) {
        if let Some(top) = stack.last() {
            if top == "standardizedLocation" {
                self.in_standardized_location = true;
            }
        }
    }

    fn note_end(&mut self, stack: &[String], text: &str, _attrs: &HashMap<String, String>) {
        let Some(name) = stack.last() else { return };
        let text = text.trim();

        match name.as_str() {
            "broId" => {
                self.id = Some(text.to_string());
            }
            "objectRegistrationTime" => {
                // ISO 8601 — trim to date for the popup.
                self.registration_date = Some(text.split('T').next().unwrap_or(text).to_string());
                self.extra
                    .insert("Geregistreerd".into(), self.registration_date.clone().unwrap());
            }
            "researchReportDate" | "date" => {
                // Some BRO docs nest the report date as `<researchReportDate><date>YYYY-MM-DD</date></researchReportDate>`.
                if name == "date"
                    && stack.len() >= 2
                    && stack[stack.len() - 2] == "researchReportDate"
                {
                    if let Ok(d) = NaiveDate::parse_from_str(text, "%Y-%m-%d") {
                        self.extra
                            .insert("Rapportdatum".into(), d.format("%Y-%m-%d").to_string());
                    }
                }
            }
            "finalDepth" => {
                if let Ok(v) = text.parse::<f64>() {
                    self.depth = Some(v);
                    self.extra.insert("Einddiepte (m)".into(), format_num(v));
                }
            }
            "finalDepthBoring" => {
                if let Ok(v) = text.parse::<f64>() {
                    self.depth = Some(v);
                    self.extra.insert("Einddiepte boring (m)".into(), format_num(v));
                }
            }
            "predrilledDepth" => {
                if let Ok(v) = text.parse::<f64>() {
                    self.extra
                        .insert("Voorboring (m)".into(), format_num(v));
                }
            }
            "offset" => {
                if let Ok(v) = text.parse::<f64>() {
                    self.extra
                        .insert("Maaiveld t.o.v. NAP (m)".into(), format_num(v));
                }
            }
            "qualityRegime" => {
                self.extra.insert("Kwaliteitsregime".into(), text.to_string());
            }
            "qualityClass" => {
                self.extra.insert("Kwaliteitsklasse".into(), text.to_string());
            }
            "cptStandard" => {
                self.extra.insert("CPT-norm".into(), text.to_string());
            }
            "surveyPurpose" => {
                self.extra.insert("Onderzoeksdoel".into(), text.to_string());
            }
            "discipline" => {
                self.extra.insert("Discipline".into(), text.to_string());
            }
            "stopCriterion" => {
                self.extra.insert("Stopcriterium".into(), text.to_string());
            }
            "deliveryAccountableParty" => {
                self.extra.insert("Bronhouder".into(), text.to_string());
            }
            "rockReached" => {
                self.extra.insert("Vaste rots bereikt".into(), text.to_string());
            }
            "deregistered" => {
                if text != "nee" {
                    self.extra.insert("Uitgeschreven".into(), text.to_string());
                }
            }
            "verticalDatum" => {
                self.extra.insert("Verticaal datum".into(), text.to_string());
            }
            "pos" => {
                // <gml:pos>lat lon</gml:pos> — we trust standardizedLocation
                // (EPSG:4258 ≈ WGS84 for Netherlands).
                if self.in_standardized_location {
                    let mut it = text.split_whitespace();
                    if let (Some(la), Some(lo)) = (it.next(), it.next()) {
                        if let (Ok(la), Ok(lo)) = (la.parse::<f64>(), lo.parse::<f64>()) {
                            self.lat = Some(la);
                            self.lon = Some(lo);
                        }
                    }
                }
            }
            "standardizedLocation" => {
                self.in_standardized_location = false;
            }
            _ => {}
        }
    }

    fn build(self) -> Option<BroFeature> {
        let id = self.id?;
        let lat = self.lat?;
        let lon = self.lon?;
        Some(BroFeature {
            id,
            lat,
            lon,
            depth: self.depth,
            kind: self.kind,
            registration_date: self.registration_date,
            extra: self.extra,
        })
    }
}

fn format_num(v: f64) -> String {
    if v.fract().abs() < 1e-6 {
        format!("{:.0}", v)
    } else {
        format!("{:.2}", v)
    }
}

/// Parse a single-object BRO XML (`*Dispatch_*` or `dispatchDataResponse`)
/// into a flat key/value map. We just walk the entire tree, skipping
/// container elements with no text, and preserve leaf values keyed by
/// local element name. Duplicate keys are concatenated.
fn parse_object_metadata(xml: &str) -> Result<HashMap<String, String>, String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut stack: Vec<String> = Vec::new();
    let mut text_buf = String::new();
    let mut out: HashMap<String, String> = HashMap::new();
    // A short whitelist of fields worth surfacing in the popup. The full
    // BRO object is hundreds of nested elements (sounding curve, etc.) —
    // we don't want to dump all that into the UI.
    let interesting: &[&str] = &[
        "broId",
        "objectRegistrationTime",
        "qualityRegime",
        "qualityClass",
        "cptStandard",
        "deliveryAccountableParty",
        "surveyPurpose",
        "discipline",
        "researchReportDate",
        "finalDepth",
        "finalDepthBoring",
        "predrilledDepth",
        "offset",
        "verticalDatum",
        "stopCriterion",
        "dissipationTestPerformed",
        "rockReached",
        "startTime",
        "boringStartDate",
        "boringEndDate",
        "descriptionProcedure",
        "descriptionQuality",
        "analysisReportDate",
        "deregistered",
    ];
    loop {
        match reader
            .read_event_into(&mut buf)
            .map_err(|e| format!("xml read: {e}"))?
        {
            Event::Start(e) => {
                stack.push(local_name(e.name().as_ref()));
                text_buf.clear();
            }
            Event::Text(t) => {
                text_buf.push_str(&t.unescape().unwrap_or_default());
            }
            Event::End(_) => {
                if let Some(name) = stack.last().cloned() {
                    let val = text_buf.trim();
                    if !val.is_empty() && interesting.contains(&name.as_str()) {
                        // Only set the *first* occurrence; many fields appear
                        // multiple times throughout a BRO object payload.
                        out.entry(name).or_insert_with(|| val.to_string());
                    }
                    stack.pop();
                }
                text_buf.clear();
            }
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A minimal slice of a real BRO CPT characteristics response, just enough
    /// to verify the parser pulls out broId / lat-lon / depth / a couple of extras.
    const CPT_FIXTURE: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<dispatchCharacteristicsResponse xmlns="http://www.broservices.nl/xsd/dscpt/1.1"
 xmlns:brocom="http://www.broservices.nl/xsd/brocommon/3.0"
 xmlns:gml="http://www.opengis.net/gml/3.2">
 <brocom:responseType>dispatch</brocom:responseType>
 <numberOfDocuments>1</numberOfDocuments>
 <dispatchDocument><CPT_C gml:id="BRO_0002">
   <brocom:broId>CPT000000004317</brocom:broId>
   <brocom:deregistered>nee</brocom:deregistered>
   <brocom:deliveryAccountableParty>50200097</brocom:deliveryAccountableParty>
   <brocom:qualityRegime>IMBRO/A</brocom:qualityRegime>
   <brocom:objectRegistrationTime>2017-01-10T20:16:33+01:00</brocom:objectRegistrationTime>
   <brocom:standardizedLocation srsName="urn:ogc:def:crs:EPSG::4258"><gml:pos>51.818667120 4.675892190</gml:pos></brocom:standardizedLocation>
   <brocom:deliveredLocation srsName="EPSG:28992"><gml:pos>105956.00 425801.00</gml:pos></brocom:deliveredLocation>
   <cptStandard codeSpace="urn:bro:cpt:CPTStandard">NEN5140</cptStandard>
   <offset uom="m">-4.030</offset>
   <qualityClass codeSpace="urn:bro:cpt:QualityClass">klasse2</qualityClass>
   <finalDepth uom="m">36.520</finalDepth>
   <surveyPurpose codeSpace="urn:bro:cpt:SurveyPurpose">onbekend</surveyPurpose>
 </CPT_C></dispatchDocument>
</dispatchCharacteristicsResponse>"#;

    #[test]
    fn parses_cpt_characteristics() {
        let f = parse_characteristics(CPT_FIXTURE, "cpt").expect("parse ok");
        assert_eq!(f.len(), 1);
        let one = &f[0];
        assert_eq!(one.id, "CPT000000004317");
        assert!((one.lat - 51.818667120).abs() < 1e-6);
        assert!((one.lon - 4.675892190).abs() < 1e-6);
        assert_eq!(one.depth, Some(36.520));
        assert_eq!(one.kind, "cpt");
        assert_eq!(
            one.extra.get("Kwaliteitsklasse"),
            Some(&"klasse2".to_string())
        );
        assert_eq!(one.extra.get("CPT-norm"), Some(&"NEN5140".to_string()));
    }

    #[test]
    fn rejection_returns_err() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<dispatchCharacteristicsResponse xmlns:brocom="http://www.broservices.nl/xsd/brocommon/3.0">
 <brocom:responseType>rejection</brocom:responseType>
 <brocom:rejectionReason>Some reason</brocom:rejectionReason>
</dispatchCharacteristicsResponse>"#;
        let r = parse_characteristics(xml, "cpt");
        assert!(r.is_err(), "expected rejection to surface as Err");
    }
}
