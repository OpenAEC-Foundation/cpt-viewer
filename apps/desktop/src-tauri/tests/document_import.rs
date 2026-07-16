use open_geo_studio_lib::commands::document::{
    open_geotechnical_document_core, ExpectedDocumentKind,
};
use open_geo_studio_lib::state::AppState;

fn import_json(xml: &str, filename: &str) -> serde_json::Value {
    let state = AppState::default();
    let dto =
        open_geotechnical_document_core(xml, filename, ExpectedDocumentKind::Bore, &state).unwrap();
    serde_json::to_value(dto).unwrap()
}

#[test]
fn bhr_gt_dto_preserves_ui_metadata_and_secondary_semantics() {
    let value = import_json(include_str!("fixtures/bhr-gt.xml"), "bhr-gt.xml");
    let metadata = &value["data"]["metadata"];
    assert_eq!(metadata["project_name"], "Project Noord");
    assert_eq!(metadata["project_number"], "PN-42");
    assert_eq!(metadata["description_date"], "2026-01-02");
    assert_eq!(metadata["start_date"], "2026-01-01");
    assert_eq!(metadata["end_date"], "2026-01-03");
    assert_eq!(metadata["accountable_party"], "ACME-001");
    assert_eq!(metadata["delivered_via"], "digitaleLevering");
    assert_eq!(metadata["source_file"], "bhr-gt.xml");

    let secondary = value["data"]["layers"][0]["secondary"].as_array().unwrap();
    assert!(secondary.iter().any(|item| item
        == &serde_json::json!({
            "label": "Bijmenging",
            "value": "zand (weinig)"
        })));
    assert!(secondary.iter().any(|item| item
        == &serde_json::json!({
            "label": "Brok",
            "value": "veen (enkele)"
        })));
    assert!(secondary.iter().any(|item| item
        == &serde_json::json!({
            "label": "Humus",
            "value": "zwakHumeus"
        })));
}

#[test]
fn bhr_g_dto_uses_lithology_and_readable_extension_labels() {
    let value = import_json(include_str!("fixtures/bhr-g.xml"), "bhr-g.xml");
    assert_eq!(
        value["data"]["metadata"]["project_name"],
        "Geologisch project"
    );
    assert_eq!(value["data"]["metadata"]["project_number"], "GG-7");
    assert_eq!(value["data"]["layers"][0]["soil_name"], "zand");
    assert_eq!(
        value["data"]["layers"][0]["secondary"][0],
        serde_json::json!({
            "label": "Korrelgrootte",
            "value": "matigFijn"
        })
    );
    assert_eq!(
        value["data"]["layers"][1]["secondary"][0],
        serde_json::json!({
            "label": "Schelpen",
            "value": "weinig"
        })
    );
}

#[test]
fn wrong_expected_kind_does_not_mutate_kernel_state() {
    let state = AppState::default();
    let error = open_geotechnical_document_core(
        include_str!("fixtures/bhr-gt.xml"),
        "bhr-gt.xml",
        ExpectedDocumentKind::Cpt,
        &state,
    )
    .unwrap_err();

    assert!(error.contains("CPT"));
    assert_eq!(
        state
            .with_project(|project| project.objects().count())
            .unwrap(),
        0
    );
}
