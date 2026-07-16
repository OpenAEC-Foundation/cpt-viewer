//! Native import adapter between the geotechnical kernel and frontend DTOs.

use std::collections::BTreeMap;

use open_geotechniek_kernel::{
    DuplicatePolicy, GeotechnicalObject, GeotechnicalProject, ProjectMetadata,
};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::state::AppState;

#[derive(Debug, Serialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum ImportedDocumentDto {
    Cpt(cpt_core::Cpt),
    Bore(BoreDto),
}

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExpectedDocumentKind {
    #[default]
    Any,
    Cpt,
    Bore,
}

#[derive(Debug, Serialize)]
pub struct BoreDto {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    position: Option<BorePositionDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    final_depth: Option<f64>,
    layers: Vec<BoreLayerDto>,
    metadata: BoreMetadataDto,
}

#[derive(Debug, Serialize)]
pub struct BorePositionDto {
    x_rd: f64,
    y_rd: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    z_nap: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct BoreLayerDto {
    top_depth: f64,
    base_depth: f64,
    soil_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    colour: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    secondary: Vec<BoreSecondaryDto>,
}

#[derive(Debug, Serialize)]
pub struct BoreSecondaryDto {
    label: String,
    value: String,
}

#[derive(Debug, Serialize)]
pub struct BoreMetadataDto {
    #[serde(skip_serializing_if = "Option::is_none")]
    project_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    project_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    start_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    end_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    quality_regime: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description_procedure: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bore_method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    accountable_party: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    delivered_via: Option<String>,
    source_file: String,
    extra: BTreeMap<String, String>,
}

pub fn open_geotechnical_document_core(
    content: &str,
    filename: &str,
    expected_kind: ExpectedDocumentKind,
    state: &AppState,
) -> Result<ImportedDocumentDto, String> {
    let mut incoming = GeotechnicalProject::new(ProjectMetadata::default());
    let object = if content.trim_start().starts_with('<') {
        incoming
            .import_bro(content, filename)
            .map_err(|error| error.to_string())?
    } else {
        GeotechnicalObject::Cpt(
            incoming
                .import_cpt(content, filename)
                .map_err(|error| error.to_string())?,
        )
    };
    validate_expected_kind(&object, expected_kind)?;
    let dto = object_to_dto(object, filename);
    state.with_project_mut(|project| {
        project.merge_from(incoming, DuplicatePolicy::Replace)?;
        Ok(())
    })?;
    Ok(dto)
}

fn validate_expected_kind(
    object: &GeotechnicalObject,
    expected: ExpectedDocumentKind,
) -> Result<(), String> {
    let matches = match expected {
        ExpectedDocumentKind::Any => true,
        ExpectedDocumentKind::Cpt => matches!(object, GeotechnicalObject::Cpt(_)),
        ExpectedDocumentKind::Bore => matches!(
            object,
            GeotechnicalObject::BhrGt(_) | GeotechnicalObject::BhrG(_)
        ),
    };
    if matches {
        return Ok(());
    }
    let expected_name = match expected {
        ExpectedDocumentKind::Any => unreachable!(),
        ExpectedDocumentKind::Cpt => "CPT",
        ExpectedDocumentKind::Bore => "boring",
    };
    Err(format!("document is geen {expected_name}"))
}

fn object_to_dto(object: GeotechnicalObject, source_file: &str) -> ImportedDocumentDto {
    match object {
        GeotechnicalObject::Cpt(cpt) => ImportedDocumentDto::Cpt(cpt),
        GeotechnicalObject::BhrGt(document) => {
            let common = document.common;
            let position = bore_position(&common);
            let metadata = bore_metadata(
                &common,
                source_file,
                document.description_procedure,
                document.boring_procedure,
            );
            ImportedDocumentDto::Bore(BoreDto {
                id: common.bro_id,
                position,
                final_depth: document.final_depth,
                layers: document
                    .intervals
                    .into_iter()
                    .map(|interval| {
                        let soil_name = interval.soil_name.unwrap_or_default();
                        let secondary = geotechnical_secondary(interval.secondary, &soil_name);
                        BoreLayerDto {
                            top_depth: interval.upper_boundary,
                            base_depth: interval.lower_boundary,
                            soil_name,
                            colour: interval.colour,
                            description: interval.description,
                            secondary,
                        }
                    })
                    .collect(),
                metadata,
            })
        }
        GeotechnicalObject::BhrG(document) => {
            let common = document.common;
            let position = bore_position(&common);
            let metadata = bore_metadata(&common, source_file, None, None);
            ImportedDocumentDto::Bore(BoreDto {
                id: common.bro_id,
                position,
                final_depth: document.final_depth,
                layers: document
                    .intervals
                    .into_iter()
                    .map(|interval| BoreLayerDto {
                        top_depth: interval.upper_boundary,
                        base_depth: interval.lower_boundary,
                        soil_name: interval.lithology.unwrap_or_default(),
                        colour: interval.colour,
                        description: interval.description,
                        secondary: geological_secondary(interval.extensions),
                    })
                    .collect(),
                metadata,
            })
        }
    }
}

fn bore_metadata(
    common: &bro_xml::CommonMetadata,
    source_file: &str,
    description_procedure: Option<String>,
    bore_method: Option<String>,
) -> BoreMetadataDto {
    BoreMetadataDto {
        project_name: extension_value(common, &["projectName", "researchProject"]),
        project_number: extension_value(common, &["projectNumber", "objectReference"]),
        description_date: extension_value(common, &["descriptionReportDate", "researchReportDate"]),
        start_date: common
            .research_start_date
            .map(|date| date.to_string())
            .or_else(|| extension_value(common, &["boringStartDate", "researchStartDate"])),
        end_date: common
            .research_end_date
            .map(|date| date.to_string())
            .or_else(|| extension_value(common, &["boringEndDate", "researchEndDate"])),
        quality_regime: common.quality_regime.clone(),
        description_procedure,
        bore_method,
        accountable_party: common.accountable_party.clone().or_else(|| {
            extension_value(
                common,
                &["objectIdAccountableParty", "deliveryAccountableParty"],
            )
        }),
        delivered_via: extension_value(common, &["deliveryContext"]),
        source_file: source_file.to_owned(),
        extra: common.extensions.clone(),
    }
}

fn extension_value(common: &bro_xml::CommonMetadata, local_names: &[&str]) -> Option<String> {
    common.extensions.iter().find_map(|(path, value)| {
        let local = path.rsplit('/').next().unwrap_or(path);
        local_names
            .iter()
            .any(|candidate| local.eq_ignore_ascii_case(candidate))
            .then(|| value.clone())
    })
}

fn meaningful(value: &str) -> bool {
    let normalized = value.trim().to_lowercase();
    !normalized.is_empty() && normalized != "geen" && !normalized.contains("onbekend")
}

fn geotechnical_secondary(
    attributes: Vec<bro_xml::SecondaryAttribute>,
    soil_name: &str,
) -> Vec<BoreSecondaryDto> {
    let mut groups = Vec::<(String, Vec<String>)>::new();
    for attribute in attributes {
        let normalized = attribute.code.to_ascii_lowercase();
        if let Some((_, values)) = groups.iter_mut().find(|(code, _)| *code == normalized) {
            values.push(attribute.value);
        } else {
            groups.push((normalized, vec![attribute.value]));
        }
    }

    let mut result = Vec::new();
    for (code, values) in groups {
        let (label, combine) = match code.as_str() {
            "anomalouslayer" => ("Bijmenging", true),
            "chunks" | "chunk" => ("Brok", true),
            "peatfraction" => ("Veenrest", true),
            "pedologicalsoilname" => ("Pedologisch", false),
            "peattype" => ("Veentype", false),
            "organicmattercontentclass" | "organicmatterclass" => ("Humus", false),
            "carbonatecontentclass" | "carbonateclass" => ("Kalk", false),
            "ripening" | "ripingclass" => ("Rijping", false),
            "structure" | "soilstructure" => ("Structuur", false),
            "horizon" | "horizonvalue" | "soilhorizon" => ("Horizont", false),
            _ => (code.as_str(), false),
        };
        let meaningful_values = values
            .into_iter()
            .filter(|value| meaningful(value))
            .filter(|value| code != "pedologicalsoilname" || value != soil_name)
            .filter(|value| {
                !(matches!(code.as_str(), "carbonatecontentclass" | "carbonateclass")
                    && value.to_lowercase().starts_with("kalkloos"))
            })
            .collect::<Vec<_>>();
        if combine {
            for pair in meaningful_values.chunks(2) {
                let value = match pair {
                    [value, detail] => format!("{value} ({detail})"),
                    [value] => value.clone(),
                    _ => unreachable!(),
                };
                result.push(BoreSecondaryDto {
                    label: label.to_owned(),
                    value,
                });
            }
        } else {
            result.extend(meaningful_values.into_iter().map(|value| BoreSecondaryDto {
                label: label.to_owned(),
                value,
            }));
        }
    }
    result
}

fn geological_secondary(extensions: BTreeMap<String, String>) -> Vec<BoreSecondaryDto> {
    extensions
        .into_iter()
        .filter(|(_, value)| meaningful(value))
        .map(|(path, value)| {
            let local = path.rsplit('/').next().unwrap_or(&path);
            let label = match local.to_ascii_lowercase().as_str() {
                "grainsize" => "Korrelgrootte".to_owned(),
                "shellcontent" => "Schelpen".to_owned(),
                "organicmattercontentclass" => "Humus".to_owned(),
                "carbonatecontentclass" => "Kalk".to_owned(),
                _ => local.to_owned(),
            };
            BoreSecondaryDto { label, value }
        })
        .collect()
}

fn bore_position(common: &bro_xml::CommonMetadata) -> Option<BorePositionDto> {
    common.position.as_ref().map(|position| BorePositionDto {
        x_rd: position.x,
        y_rd: position.y,
        z_nap: common
            .vertical_position
            .as_ref()
            .map(|vertical| vertical.offset),
    })
}

#[tauri::command]
pub fn open_geotechnical_document(
    content: String,
    filename: String,
    expected_kind: Option<ExpectedDocumentKind>,
    state: State<'_, AppState>,
) -> Result<ImportedDocumentDto, String> {
    open_geotechnical_document_core(
        &content,
        &filename,
        expected_kind.unwrap_or_default(),
        state.inner(),
    )
}
