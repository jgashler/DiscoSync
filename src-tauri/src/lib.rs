mod video_probe;

use video_probe::VideoMetadata;

#[tauri::command]
fn probe_video_metadata(path: String) -> Result<VideoMetadata, String> {
    video_probe::probe_file(&path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![probe_video_metadata])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
