use crate::services::path_service;
use tauri::command;

#[command]
pub async fn get_user_data_path() -> Result<String, String> {
    path_service::get_user_data_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}
