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

#[derive(Serialize)]
pub struct EntryMetadata {
    dirname: String,
    path: String,
    mtime_ms: u64,
    title: String,
    date: String,
    tags: Vec<String>,
    excerpt: String,
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

/// List all journal entries with their frontmatter metadata in a single call.
/// Scans the entries directory for subdirectories containing index.md,
/// reads each file, and parses YAML frontmatter.
#[command]
pub async fn list_entries_with_metadata(path: String) -> Result<Vec<EntryMetadata>, String> {
    let dir = Path::new(&path);
    if !dir.exists() {
        fs::create_dir_all(dir)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
        return Ok(vec![]);
    }

    let mut entries = Vec::new();
    let read_dir = fs::read_dir(dir).map_err(|e| format!("Failed to read directory: {}", e))?;

    for item in read_dir {
        let item = match item {
            Ok(i) => i,
            Err(_) => continue,
        };
        let metadata = match item.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !metadata.is_dir() {
            continue;
        }

        let dirname = item.file_name().to_string_lossy().to_string();
        let index_path = item.path().join("index.md");

        if !index_path.exists() {
            continue;
        }

        let content = match fs::read_to_string(&index_path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let mtime_ms = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        // Parse YAML frontmatter
        let (title, date, tags, excerpt) = parse_frontmatter(&content);

        entries.push(EntryMetadata {
            dirname,
            path: index_path.to_string_lossy().to_string(),
            mtime_ms,
            title,
            date,
            tags,
            excerpt,
        });
    }

    // Sort by mtime descending (newest first)
    entries.sort_by(|a, b| b.mtime_ms.cmp(&a.mtime_ms));
    Ok(entries)
}

fn parse_frontmatter(content: &str) -> (String, String, Vec<String>, String) {
    let mut title = String::new();
    let mut date = String::new();
    let mut tags: Vec<String> = Vec::new();
    let mut body = content;

    if content.starts_with("---") {
        if let Some(end) = content[3..].find("\n---") {
            let yaml_block = &content[4..3 + end];
            body = content[3 + end + 4..].trim_start();

            for line in yaml_block.lines() {
                let line = line.trim();
                if let Some(pos) = line.find(':') {
                    let key = line[..pos].trim();
                    let val = line[pos + 1..].trim();
                    match key {
                        "title" => {
                            title = strip_quotes(val).to_string();
                        }
                        "date" => {
                            date = strip_quotes(val).to_string();
                        }
                        "tags" => {
                            if val.starts_with('[') && val.ends_with(']') {
                                tags = val[1..val.len() - 1]
                                    .split(',')
                                    .map(|t| strip_quotes(t.trim()).to_string())
                                    .filter(|t| !t.is_empty())
                                    .collect();
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    // Excerpt: first 300 chars of body (skip markdown heading on first line)
    let excerpt_src = if body.starts_with('#') {
        body.find('\n').map(|i| &body[i + 1..]).unwrap_or("")
    } else {
        body
    };
    let excerpt: String = excerpt_src.chars().take(300).collect();

    (title, date, tags, excerpt.trim().to_string())
}

fn strip_quotes(s: &str) -> &str {
    if (s.starts_with('"') && s.ends_with('"')) || (s.starts_with('\'') && s.ends_with('\'')) {
        &s[1..s.len() - 1]
    } else {
        s
    }
}
