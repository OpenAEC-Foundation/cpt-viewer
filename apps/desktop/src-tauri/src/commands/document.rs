//! Native import adapter between the geotechnical kernel and frontend DTOs.

use std::collections::BTreeMap;

use open_geotechniek_kernel::{
    DuplicatePolicy, GeotechnicalObject, GeotechnicalProject, ProjectMetadata,
};
use serde::Serialize;
use tauri::State;

use crate::state::AppState;

#[derive(Debug, Serialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum ImportedDocumentDto {
    Cpt(cpt_core::Cpt),
    Bore(BoreDto),
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
    source_file: String,
    extra: BTreeMap<String, String>,
}

pub fn open_geotechnical_document_core(
    content: &str,
    filename: &str,
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
    let dto = object_to_dto(object, filename);
    state.with_project_mut(|project| {
        project.merge_from(incoming, DuplicatePolicy::Replace)?;
        Ok(())
    })?;
    Ok(dto)
}

fn object_to_dto(object: GeotechnicalObject, source_file: &str) -> ImportedDocumentDto {
    match object {
        GeotechnicalObject::Cpt(cpt) => ImportedDocumentDto::Cpt(cpt),
        GeotechnicalObject::BhrGt(document) => {
            let common = document.common;
            let position = bore_position(&common);
            let metadata = BoreMetadataDto {
                start_date: common.research_start_date.map(|date| date.to_string()),
                end_date: common.research_end_date.map(|date| date.to_string()),
                quality_regime: common.quality_regime,
                description_procedure: document.description_procedure,
                bore_method: document.boring_procedure,
                accountable_party: common.accountable_party,
                source_file: source_file.to_owned(),
                extra: common.extensions,
            };
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
                        soil_name: interval.soil_name.unwrap_or_default(),
                        colour: interval.colour,
                        description: interval.description,
                        secondary: interval
                            .secondary
                            .into_iter()
                            .map(|attribute| BoreSecondaryDto {
                                label: attribute.code,
                                value: attribute.value,
                            })
                            .collect(),
                    })
                    .collect(),
                metadata,
            })
        }
        GeotechnicalObject::BhrG(document) => {
            let common = document.common;
            let position = bore_position(&common);
            let metadata = BoreMetadataDto {
                start_date: common.research_start_date.map(|date| date.to_string()),
                end_date: common.research_end_date.map(|date| date.to_string()),
                quality_regime: common.quality_regime,
                description_procedure: None,
                bore_method: None,
                accountable_party: common.accountable_party,
                source_file: source_file.to_owned(),
                extra: common.extensions,
            };
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
                        secondary: interval
                            .extensions
                            .into_iter()
                            .map(|(label, value)| BoreSecondaryDto { label, value })
                            .collect(),
                    })
                    .collect(),
                metadata,
            })
        }
    }
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
    state: State<'_, AppState>,
) -> Result<ImportedDocumentDto, String> {
    open_geotechnical_document_core(&content, &filename, state.inner())
}
