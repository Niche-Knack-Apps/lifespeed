pub mod commands;
pub mod services;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::settings::get_user_data_path,
            commands::file::read_file,
            commands::file::write_file,
            commands::file::file_exists,
            commands::entry::get_default_entries_dir,
            commands::entry::list_directory,
            commands::entry::delete_directory,
            commands::entry::rename_path,
            commands::entry::copy_file,
            commands::entry::write_file_base64,
            commands::entry::list_entries_with_metadata,
            commands::dialog::open_file_dialog,
            commands::dialog::save_file_dialog,
            commands::dialog::choose_directory,
        ])
        .setup(|app| {
            log::info!("Lifespeed starting up...");
            let app_handle = app.handle().clone();
            services::path_service::init(&app_handle)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
