// Opt-in, human-gated audio sync suggestion (see CLAUDE.md's "Audio Sync
// Suggestion" note). Fully local: audio is decoded from the same read-only
// video files already used for playback (symphonia — 100% pure Rust,
// #![forbid(unsafe_code)], no ffmpeg/system codec libraries) and correlated
// with a local FFT (rustfft). Nothing here ever leaves the machine, and
// nothing here is applied automatically — this only ever computes a
// *suggested* offset. The frontend is responsible for applying it
// provisionally and letting the user accept or revert, same as any other
// manual offset edit.
use std::collections::HashMap;
use std::fs::File;

use rustfft::FftPlanner;
use rustfft::num_complex::Complex;
use serde::{Deserialize, Serialize};
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

// Only the first couple of minutes of each clip's audio are decoded and
// correlated — enough to find a confident alignment without paying the
// decode/FFT cost of a multi-hour body-cam shift. This is a refinement of
// an already-rough-synced offset, not a blind search, so it doesn't need
// the whole file.
const MAX_AUDIO_SECONDS: f64 = 120.0;
// Downsampled working rate for correlation. Far below the source's native
// 44.1/48kHz, but still well above what's needed to resolve timing from
// speech/ambient sound — this keeps the FFT small and correlation fast.
const WORKING_SAMPLE_RATE: u32 = 8000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSyncClipInput {
    pub id: String,
    pub path: String,
    /// The clip's current effective offset (rough sync + manual nudge), in
    /// the same coordinate space as the shared timeline. Used both as the
    /// center of the search window and as the basis for the returned
    /// suggestion.
    pub current_offset_seconds: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum AudioSyncOutcome {
    Suggested {
        offset_seconds: f64,
        /// Roughly how strong the audio match was, in [-1, 1] — a normalized
        /// cross-correlation peak, not a probability. Low values mean the
        /// suggested offset shouldn't be trusted without a manual listen.
        confidence: f64,
    },
    Failed {
        error: String,
    },
}

/// For each clip in `candidates`, suggests an offset (in the same
/// coordinate space as `current_offset_seconds`) that best aligns its audio
/// with `anchor`'s, searched within `search_window_seconds` of the clip's
/// current offset relative to the anchor. A clip whose audio can't be
/// decoded (no audio track, unsupported codec, corrupt file) fails
/// individually rather than aborting the whole batch; failure to decode the
/// anchor itself is fatal, since there's nothing left to correlate against.
pub fn suggest_offsets(
    anchor: &AudioSyncClipInput,
    candidates: &[AudioSyncClipInput],
    search_window_seconds: f64,
) -> Result<HashMap<String, AudioSyncOutcome>, String> {
    let (anchor_raw, anchor_rate) = decode_mono_audio(&anchor.path, MAX_AUDIO_SECONDS)?;
    let anchor_samples = downsample_mono(&anchor_raw, anchor_rate, WORKING_SAMPLE_RATE);
    if anchor_samples.is_empty() {
        return Err("anchor clip's audio track contained no decodable samples".to_string());
    }

    let mut results = HashMap::with_capacity(candidates.len());
    for clip in candidates {
        let outcome = match decode_mono_audio(&clip.path, MAX_AUDIO_SECONDS) {
            Err(e) => AudioSyncOutcome::Failed { error: e },
            Ok((raw, rate)) => {
                let candidate_samples = downsample_mono(&raw, rate, WORKING_SAMPLE_RATE);
                if candidate_samples.is_empty() {
                    AudioSyncOutcome::Failed {
                        error: "audio track contained no decodable samples".to_string(),
                    }
                } else {
                    let expected_offset_seconds = clip.current_offset_seconds - anchor.current_offset_seconds;
                    let expected_lag = (expected_offset_seconds * WORKING_SAMPLE_RATE as f64).round() as i64;
                    let window_samples = (search_window_seconds * WORKING_SAMPLE_RATE as f64).round() as i64;

                    let (best_lag, confidence) =
                        best_lag_samples(&anchor_samples, &candidate_samples, expected_lag, window_samples);
                    let offset_seconds = anchor.current_offset_seconds + best_lag as f64 / WORKING_SAMPLE_RATE as f64;
                    AudioSyncOutcome::Suggested { offset_seconds, confidence }
                }
            }
        };
        results.insert(clip.id.clone(), outcome);
    }

    Ok(results)
}

/// Decodes a video file's audio track to mono f32 PCM, stopping once
/// `max_seconds` of audio has been accumulated. Returns the samples along
/// with their native (pre-downsample) sample rate.
fn decode_mono_audio(path: &str, max_seconds: f64) -> Result<(Vec<f32>, u32), String> {
    let file = File::open(path).map_err(|e| format!("could not open file: {e}"))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let mut format = symphonia::default::get_probe()
        .probe(&hint, mss, FormatOptions::default(), MetadataOptions::default())
        .map_err(|e| format!("could not read audio: {e}"))?;

    let track = format
        .default_track(TrackType::Audio)
        .ok_or_else(|| "no audio track found in file".to_string())?;
    let audio_params = track
        .codec_params
        .as_ref()
        .and_then(|p| p.audio())
        .ok_or_else(|| "no usable audio codec parameters".to_string())?;
    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(audio_params, &AudioDecoderOptions::default())
        .map_err(|e| format!("unsupported audio codec: {e}"))?;
    let track_id = track.id;

    let mut mono: Vec<f32> = Vec::new();
    let mut interleaved: Vec<f32> = Vec::new();
    let mut sample_rate: u32 = 0;

    loop {
        let packet = match format.next_packet() {
            Ok(Some(p)) => p,
            Ok(None) => break,
            Err(SymphoniaError::ResetRequired) => break,
            Err(e) => return Err(format!("error reading audio stream: {e}")),
        };
        if packet.track_id != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(SymphoniaError::IoError(_)) | Err(SymphoniaError::DecodeError(_)) => continue,
            Err(e) => return Err(format!("error decoding audio: {e}")),
        };

        if sample_rate == 0 {
            sample_rate = decoded.spec().rate();
        }
        let channels = decoded.spec().channels().count().max(1);

        interleaved.clear();
        decoded.copy_to_vec_interleaved::<f32>(&mut interleaved);
        for frame in interleaved.chunks_exact(channels) {
            let sum: f32 = frame.iter().sum();
            mono.push(sum / channels as f32);
        }

        if sample_rate > 0 && mono.len() as f64 / sample_rate as f64 >= max_seconds {
            break;
        }
    }

    if sample_rate == 0 || mono.is_empty() {
        return Err("audio track contained no decodable samples".to_string());
    }

    Ok((mono, sample_rate))
}

/// Box-filter (moving average) downsample by simple decimation. Not a
/// proper windowed-sinc resampler, but this audio is being correlated for
/// timing, not reproduced — a rough anti-alias is sufficient, and simpler
/// is safer than a hand-rolled "real" resampler.
fn downsample_mono(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if to_rate == 0 || from_rate <= to_rate {
        return samples.to_vec();
    }
    let factor = ((from_rate as f64 / to_rate as f64).round() as usize).max(1);

    let mut out = Vec::with_capacity(samples.len() / factor + 1);
    let mut i = 0;
    while i < samples.len() {
        let end = (i + factor).min(samples.len());
        let window = &samples[i..end];
        out.push(window.iter().sum::<f32>() / window.len() as f32);
        i += factor;
    }
    out
}

/// Finds the lag (in samples, candidate relative to anchor — see the module
/// doc on `AudioSyncClipInput`) within `expected_lag ± window_samples` that
/// maximizes cross-correlation between `anchor` and `candidate`, computed
/// via FFT rather than a direct O(n*m) search. Returns the lag and a
/// normalized confidence in [-1, 1].
fn best_lag_samples(anchor: &[f32], candidate: &[f32], expected_lag: i64, window_samples: i64) -> (i64, f64) {
    let fft_len = (anchor.len() + candidate.len()).next_power_of_two();

    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(fft_len);
    let ifft = planner.plan_fft_inverse(fft_len);

    let mut a_buf: Vec<Complex<f32>> = anchor.iter().map(|&x| Complex::new(x, 0.0)).collect();
    a_buf.resize(fft_len, Complex::new(0.0, 0.0));
    let mut b_buf: Vec<Complex<f32>> = candidate.iter().map(|&x| Complex::new(x, 0.0)).collect();
    b_buf.resize(fft_len, Complex::new(0.0, 0.0));

    fft.process(&mut a_buf);
    fft.process(&mut b_buf);

    // Cross-correlation via the convolution theorem: IFFT(FFT(a) * conj(FFT(b))).
    // rustfft's inverse doesn't normalize, so the result here is `fft_len`
    // times the true correlation value — divided out below.
    let mut cross: Vec<Complex<f32>> = a_buf.iter().zip(b_buf.iter()).map(|(a, b)| *a * b.conj()).collect();
    ifft.process(&mut cross);

    let energy_a: f64 = anchor.iter().map(|&x| (x as f64) * (x as f64)).sum();
    let energy_b: f64 = candidate.iter().map(|&x| (x as f64) * (x as f64)).sum();
    // Cauchy-Schwarz bound on the correlation sum, so dividing by this keeps
    // confidence within [-1, 1].
    let norm = (energy_a * energy_b).sqrt().max(1e-9);

    // Clamp the search window so index wraparound (lag mod fft_len) can't
    // double-count a lag from the opposite end of the circular result.
    let max_window = fft_len as i64 / 2 - 1;
    let window_samples = window_samples.clamp(0, max_window);

    let mut best_lag = expected_lag;
    let mut best_score = f64::NEG_INFINITY;
    for lag in (expected_lag - window_samples)..=(expected_lag + window_samples) {
        let idx = lag.rem_euclid(fft_len as i64) as usize;
        let score = cross[idx].re as f64 / fft_len as f64;
        if score > best_score {
            best_score = score;
            best_lag = lag;
        }
    }

    let confidence = (best_score / norm).clamp(-1.0, 1.0);
    (best_lag, confidence)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deterministic pseudo-random noise (no external `rand` dependency) —
    /// broadband and non-periodic within the test window, which gives a
    /// sharp, unambiguous cross-correlation peak, unlike a sinusoid. Uses
    /// the top 32 bits of the LCG state (not the top 31) so the result is
    /// genuinely zero-mean over [-1, 1) — a narrower slice previously left
    /// every sample negative, biasing every generated signal the same way.
    fn pseudo_noise(len: usize, seed: u64) -> Vec<f32> {
        let mut state = seed;
        (0..len)
            .map(|_| {
                state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
                let x = (state >> 32) as u32 as f32 / u32::MAX as f32;
                x * 2.0 - 1.0
            })
            .collect()
    }

    /// Builds a signal such that `shifted[m] == anchor[m + d]` (matching
    /// `best_lag_samples`'s convention of a lag `d` meaning
    /// `anchor[u] ≈ candidate[u - d]`, i.e. `candidate[m] ≈ anchor[m + d]`).
    /// Out-of-range positions are zero-padding.
    fn shifted(anchor: &[f32], d: i64) -> Vec<f32> {
        if d >= 0 {
            anchor[d as usize..].to_vec()
        } else {
            let pad = (-d) as usize;
            let mut out = vec![0.0f32; pad];
            out.extend_from_slice(anchor);
            out
        }
    }

    #[test]
    fn best_lag_samples_recovers_a_known_positive_lag() {
        let anchor = pseudo_noise(2000, 42);
        let true_lag = 137i64;
        let candidate = shifted(&anchor, true_lag);

        let (lag, confidence) = best_lag_samples(&anchor, &candidate, 0, 300);

        assert_eq!(lag, true_lag);
        assert!(confidence > 0.5, "expected high confidence, got {confidence}");
    }

    #[test]
    fn best_lag_samples_recovers_a_known_negative_lag() {
        let anchor = pseudo_noise(2000, 7);
        let true_lag = -85i64;
        let candidate = shifted(&anchor, true_lag);

        let (lag, confidence) = best_lag_samples(&anchor, &candidate, 0, 300);

        assert_eq!(lag, true_lag);
        assert!(confidence > 0.5, "expected high confidence, got {confidence}");
    }

    #[test]
    fn best_lag_samples_reports_low_confidence_for_uncorrelated_signals() {
        let a = pseudo_noise(2000, 1);
        let b = pseudo_noise(2000, 2);

        let (_, confidence) = best_lag_samples(&a, &b, 0, 300);

        assert!(confidence.abs() < 0.4, "expected low confidence, got {confidence}");
    }

    #[test]
    fn best_lag_samples_stays_within_the_search_window() {
        let anchor = pseudo_noise(2000, 3);
        // True alignment is far outside the search window, so the best match
        // within the window should not be the (out-of-range) true lag.
        let candidate = shifted(&anchor, 900);

        let (lag, _) = best_lag_samples(&anchor, &candidate, 0, 50);

        assert!((-50..=50).contains(&lag));
    }

    #[test]
    fn downsample_mono_reduces_length_by_the_expected_factor() {
        let samples: Vec<f32> = (0..1000).map(|i| i as f32).collect();

        let result = downsample_mono(&samples, 8000, 4000);

        assert_eq!(result.len(), 500);
        assert!((result[0] - 0.5).abs() < 1e-6); // average of samples[0..2] = avg(0, 1)
    }

    #[test]
    fn downsample_mono_is_a_no_op_when_the_target_rate_is_not_lower() {
        let samples = vec![1.0f32, 2.0, 3.0];

        assert_eq!(downsample_mono(&samples, 4000, 8000), samples);
        assert_eq!(downsample_mono(&samples, 4000, 4000), samples);
    }

    #[test]
    fn decode_mono_audio_rejects_a_missing_file() {
        let result = decode_mono_audio("this/path/does/not/exist.mp4", 10.0);
        assert!(result.is_err());
    }

    #[test]
    fn decode_mono_audio_rejects_a_file_that_is_not_a_valid_media_container() {
        let path = std::env::temp_dir().join("discosync_audio_sync_test_garbage.mp4");
        std::fs::write(&path, b"this is not a media file").unwrap();

        let result = decode_mono_audio(path.to_str().unwrap(), 10.0);
        let _ = std::fs::remove_file(&path);

        assert!(result.is_err());
    }

    #[test]
    fn suggest_offsets_fails_outright_when_the_anchor_cannot_be_decoded() {
        let anchor = AudioSyncClipInput {
            id: "a".to_string(),
            path: "missing-anchor.mp4".to_string(),
            current_offset_seconds: 0.0,
        };
        let candidates = vec![AudioSyncClipInput {
            id: "b".to_string(),
            path: "missing-candidate.mp4".to_string(),
            current_offset_seconds: 5.0,
        }];

        let result = suggest_offsets(&anchor, &candidates, 10.0);

        assert!(result.is_err());
    }
}
