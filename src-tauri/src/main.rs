// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{WebviewUrl, WebviewWindowBuilder};

/// Report platform names using Node's vocabulary (darwin/win32, arm64/x64),
/// which is what the renderer's header expects.
fn os_name() -> &'static str {
    match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    }
}

fn arch_name() -> &'static str {
    match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        other => other,
    }
}

/// Exposes a frozen `window.platform` object before any page script runs.
fn platform_script() -> String {
    format!(
        r#"Object.defineProperty(window, 'platform', {{
             value: Object.freeze({{ os: {os:?}, arch: {arch:?}, runtime: {runtime:?} }}),
             writable: false,
             configurable: false
           }});"#,
        os = os_name(),
        arch = arch_name(),
        runtime = format!("Tauri {}", env!("CARGO_PKG_VERSION")),
    )
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Mouse Click Test")
                .inner_size(1180.0, 780.0)
                .min_inner_size(900.0, 620.0)
                .initialization_script(platform_script())
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
