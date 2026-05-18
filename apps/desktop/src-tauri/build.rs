fn main() {
    tauri_build::build();

    // ── Copy WebView2Loader.dll next to the built .exe ──────────
    // Tauri 2.x's `bundle.resources` won't place a file directly at
    // `$INSTDIR\` root — it always pushes through `resources/`. The
    // open-geo-studio.exe needs `WebView2Loader.dll` in the SAME
    // directory it lives in to start. Easiest reliable fix: copy
    // the vendored DLL into `target/{profile}/` during every build
    // so the NSIS bundler picks it up via its standard "everything
    // next to the .exe" file-collection logic.
    //
    // Skipped on non-Windows (no Edge WebView2 there).
    #[cfg(target_os = "windows")]
    {
        use std::path::PathBuf;

        let profile = std::env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        // Default target dir is `<workspace>/target/`; respect a custom
        // CARGO_TARGET_DIR override if the env var is set.
        let target_dir = std::env::var("CARGO_TARGET_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| manifest_dir.join("target"));

        let src = manifest_dir.join("vendor").join("WebView2Loader.dll");
        let dst = target_dir.join(&profile).join("WebView2Loader.dll");

        if src.exists() {
            if let Some(parent) = dst.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            match std::fs::copy(&src, &dst) {
                Ok(_) => {
                    println!("cargo:rerun-if-changed={}", src.display());
                    println!(
                        "cargo:warning=WebView2Loader.dll copied to {}",
                        dst.display()
                    );
                }
                Err(e) => println!("cargo:warning=WebView2Loader.dll copy failed: {e}"),
            }
        } else {
            println!(
                "cargo:warning=vendor/WebView2Loader.dll not found at {}",
                src.display()
            );
        }
    }
}
