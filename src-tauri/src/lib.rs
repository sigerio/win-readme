// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, Runtime, WindowEvent};
use tauri_plugin_fs::FsExt;
use tokio::sync::Mutex;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenDocumentPayload {
    path: String,
    content: String,
}

/// Documents with unsaved changes, mirrored from the frontend on every edit.
/// The Rust-side close guard reads this so window close never depends on a
/// JS event round-trip.
#[derive(Default)]
struct DirtyState {
    paths: Vec<String>,
}

#[tauri::command]
async fn set_dirty_paths(
    paths: Vec<String>,
    state: tauri::State<'_, Arc<Mutex<DirtyState>>>,
) -> Result<(), String> {
    state.lock().await.paths = paths;
    Ok(())
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| matches!(extension.to_ascii_lowercase().as_str(), "md" | "markdown"))
}

fn allow_document<R: Runtime>(app: &AppHandle<R>, path: &Path) -> Result<(), String> {
    if !path.is_file() || !is_markdown(path) {
        return Err("not a Markdown file".into());
    }
    let parent = path.parent().ok_or("document has no parent directory")?;
    app.fs_scope()
        .allow_directory(parent, true)
        .map_err(|error| error.to_string())?;
    app.asset_protocol_scope()
        .allow_directory(parent, true)
        .map_err(|error| error.to_string())
}

fn load_document<R: Runtime>(
    app: &AppHandle<R>,
    path: &Path,
) -> Result<OpenDocumentPayload, String> {
    allow_document(app, path)?;
    let content = std::fs::read_to_string(path).map_err(|error| error.to_string())?;
    Ok(OpenDocumentPayload {
        path: path.to_string_lossy().into_owned(),
        content,
    })
}

#[tauri::command]
fn scope_document(app: AppHandle, path: String) -> Result<(), String> {
    allow_document(&app, Path::new(&path))
}

#[tauri::command]
fn startup_document(app: AppHandle) -> Option<OpenDocumentPayload> {
    std::env::args_os()
        .skip(1)
        .find_map(|arg| load_document(&app, Path::new(&arg)).ok())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(document) = argv
                .iter()
                .find_map(|arg| load_document(app, Path::new(arg)).ok())
            {
                let _ = app.emit("open-document", document);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::new(Mutex::new(DirtyState::default())))
        .invoke_handler(tauri::generate_handler![scope_document, startup_document, set_dirty_paths])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<Arc<Mutex<DirtyState>>>();
                let dirty = state.blocking_lock().paths.len();
                if dirty == 0 {
                    return;
                }
                api.prevent_close();
                let _ = window.emit("confirm-exit-dirty", dirty);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
