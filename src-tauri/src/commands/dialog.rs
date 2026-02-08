use tauri::command;
use tauri_plugin_dialog::DialogExt;
use tokio::sync::oneshot;

#[derive(serde::Deserialize)]
pub struct DialogFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

#[command]
pub async fn open_file_dialog(
    app: tauri::AppHandle,
    title: Option<String>,
    filters: Option<Vec<DialogFilter>>,
    multiple: Option<bool>,
) -> Result<Option<Vec<String>>, String> {
    let (tx, rx) = oneshot::channel();
    let mut builder = app.dialog().file();
    if let Some(t) = title { builder = builder.set_title(t); }
    if let Some(filter_list) = filters {
        for filter in filter_list {
            let extensions: Vec<&str> = filter.extensions.iter().map(|s| s.as_str()).collect();
            builder = builder.add_filter(&filter.name, &extensions);
        }
    }
    if multiple.unwrap_or(false) {
        builder.pick_files(move |paths| {
            let result = paths.map(|p| p.iter().map(|path| path.to_string()).collect());
            let _ = tx.send(result);
        });
    } else {
        builder.pick_file(move |path| {
            let result = path.map(|p| vec![p.to_string()]);
            let _ = tx.send(result);
        });
    }
    rx.await.map_err(|e| format!("Dialog error: {}", e))
}

#[command]
pub async fn save_file_dialog(
    app: tauri::AppHandle,
    title: Option<String>,
    default_name: Option<String>,
    filters: Option<Vec<DialogFilter>>,
) -> Result<Option<String>, String> {
    let (tx, rx) = oneshot::channel();
    let mut builder = app.dialog().file();
    if let Some(t) = title { builder = builder.set_title(t); }
    if let Some(name) = default_name { builder = builder.set_file_name(&name); }
    if let Some(filter_list) = filters {
        for filter in filter_list {
            let extensions: Vec<&str> = filter.extensions.iter().map(|s| s.as_str()).collect();
            builder = builder.add_filter(&filter.name, &extensions);
        }
    }
    builder.save_file(move |path| {
        let result = path.map(|p| p.to_string());
        let _ = tx.send(result);
    });
    rx.await.map_err(|e| format!("Dialog error: {}", e))
}

#[command]
pub async fn choose_directory(
    app: tauri::AppHandle,
    title: Option<String>,
) -> Result<Option<String>, String> {
    let (tx, rx) = oneshot::channel();
    let mut builder = app.dialog().file();
    if let Some(t) = title { builder = builder.set_title(t); }
    builder.pick_folder(move |path| {
        let result = path.map(|p| p.to_string());
        let _ = tx.send(result);
    });
    rx.await.map_err(|e| format!("Dialog error: {}", e))
}
