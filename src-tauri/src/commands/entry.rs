use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use base64::Engine;
use serde::Serialize;
use tauri::command;

use crate::services::path_service;

#[derive(Serialize)]
pub struct DirEntry {
    name: String,
    is_dir: bool,
    mtime_ms: u64,
}

#[command]
pub async fn get_default_entries_dir() -> Result<String, String> {
    let data_dir = path_service::get_user_data_dir().map_err(|e| e.to_string())?;
    let entries_dir = data_dir.join("journal");
    fs::create_dir_all(&entries_dir)
        .map_err(|e| format!("Failed to create entries directory: {}", e))?;
    Ok(entries_dir.to_string_lossy().to_string())
}

#[command]
pub async fn list_directory(path: String) -> Result<Vec<DirEntry>, String> {
    let dir = Path::new(&path);
    if !dir.exists() {
        fs::create_dir_all(dir)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
        return Ok(vec![]);
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| format!("Failed to read directory: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let metadata = entry
            .metadata()
            .map_err(|e| format!("Failed to read metadata: {}", e))?;
        let mtime_ms = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        entries.push(DirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            mtime_ms,
        });
    }
    Ok(entries)
}

#[command]
pub async fn delete_directory(path: String) -> Result<(), String> {
    fs::remove_dir_all(&path).map_err(|e| format!("Failed to delete directory: {}", e))
}

#[command]
pub async fn rename_path(old_path: String, new_path: String) -> Result<(), String> {
    fs::rename(&old_path, &new_path).map_err(|e| format!("Failed to rename: {}", e))
}

#[command]
pub async fn copy_file(source: String, destination: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&destination).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    fs::copy(&source, &destination).map_err(|e| format!("Failed to copy file: {}", e))?;
    Ok(())
}

#[command]
pub async fn write_file_base64(path: String, base64_data: String) -> Result<(), String> {
    let data = if let Some(pos) = base64_data.find(',') {
        &base64_data[pos + 1..]
    } else {
        &base64_data
    };

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    fs::write(&path, bytes).map_err(|e| format!("Failed to write file: {}", e))
}
