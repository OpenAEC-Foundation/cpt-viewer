use open_geo_studio_lib::commands::cpt::{close_cpt_core, list_cpts_core, open_cpt_core};
use open_geo_studio_lib::state::AppState;

#[test]
fn legacy_cpt_commands_share_kernel_state() {
    let state = AppState::default();
    let gef = include_str!("../../public/example.gef");
    let opened = open_cpt_core(gef, "example.gef", &state).unwrap();

    assert_eq!(list_cpts_core(&state).len(), 1);
    close_cpt_core(&opened.id, &state).unwrap();
    assert!(list_cpts_core(&state).is_empty());
    close_cpt_core(&opened.id, &state).unwrap();
}
