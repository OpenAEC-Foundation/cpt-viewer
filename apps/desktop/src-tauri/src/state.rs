//! Shared application state for Tauri commands.

use std::collections::HashMap;
use std::sync::Mutex;

pub struct AppState {
    project: Mutex<open_geotechniek_kernel::GeotechnicalProject>,
    /// Extension toggle-state, key = ExtensionId-string (zelfde IDs als
    /// in apps/desktop/src/hooks/useExtensions.ts). Default leeg; bij
    /// `extensions_list` worden onbekende ids als "false" gerapporteerd
    /// (matcht het frontend-default-uit gedrag). Wordt op dit moment
    /// NIET gesynced met de tauri-plugin-store preferences.json die de
    /// GUI gebruikt — sync is een vervolg-feature.
    pub extensions: Mutex<HashMap<String, bool>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            project: Mutex::new(open_geotechniek_kernel::GeotechnicalProject::new(
                open_geotechniek_kernel::ProjectMetadata::default(),
            )),
            extensions: Mutex::new(HashMap::new()),
        }
    }
}

impl AppState {
    pub fn with_project<T>(
        &self,
        f: impl FnOnce(&open_geotechniek_kernel::GeotechnicalProject) -> T,
    ) -> Result<T, String> {
        let project = self
            .project
            .lock()
            .map_err(|_| "project state lock poisoned".to_owned())?;
        Ok(f(&project))
    }

    pub fn with_project_mut<T>(
        &self,
        f: impl FnOnce(
            &mut open_geotechniek_kernel::GeotechnicalProject,
        ) -> Result<T, open_geotechniek_kernel::KernelError>,
    ) -> Result<T, String> {
        let mut project = self
            .project
            .lock()
            .map_err(|_| "project state lock poisoned".to_owned())?;
        f(&mut project).map_err(|error| error.to_string())
    }
}
