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
async fn suggest_audio_sync_offsets(
    anchor: AudioSyncClipInput,
    candidates: Vec<AudioSyncClipInput>,
    search_window_seconds: f64,
) -> Result<HashMap<String, AudioSyncOutcome>, String> {
    // Audio decoding + FFT correlation is CPU-heavy enough — especially
    // with several candidate clips, each decoding ~2 minutes of audio twice
    // and running a few FFTs of a couple million points — to visibly stall
    // the window if it runs on Tauri's shared async worker pool. That pool
    // also carries other IPC traffic and window events, so a long
    // synchronous call parked there (a plain, non-async `fn` command still
    // runs to completion on one of those workers, not off on its own)
    // reads to the OS as the whole window hanging. spawn_blocking moves the
    // actual work onto Tokio's dedicated blocking-task pool instead, so the
    // async pool — and the window — stay responsive the whole time.
    tauri::async_runtime::spawn_blocking(move || {
        audio_sync::suggest_offsets(&anchor, &candidates, search_window_seconds)
    })
    .await
    .map_err(|e| format!("internal error running audio sync: {e}"))
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
