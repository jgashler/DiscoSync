mod audio_sync;
mod video_probe;

use std::collections::HashMap;

use audio_sync::{AudioSyncClipInput, AudioSyncOutcome};
use video_probe::VideoMetadata;

#[tauri::command]
fn probe_video_metadata(path: String) -> Result<VideoMetadata, String> {
    video_probe::probe_file(&path)
}

#[tauri::command]
fn suggest_audio_sync_offsets(
    anchor: AudioSyncClipInput,
    candidates: Vec<AudioSyncClipInput>,
    search_window_seconds: f64,
) -> Result<HashMap<String, AudioSyncOutcome>, String> {
    audio_sync::suggest_offsets(&anchor, &candidates, search_window_seconds)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![probe_video_metadata, suggest_audio_sync_offsets])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
