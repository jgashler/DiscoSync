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
use std::panic::{AssertUnwindSafe, catch_unwind};

use rustfft::FftPlanner;
use rustfft::num_complex::Complex;
use serde::{Deserialize, Serialize};
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, SeekMode, SeekTo, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::units::Time;

// How much audio is decoded on each side of the sampled center point (so
// ~2 minutes total per clip per pair). Sampling around where the clips
// currently overlap — rather than from the start of each file — matters:
// clips are often synced far from local time 0 (a body-cam clip an hour
// into a shift, say), so decoding from file-start could compare two
// completely unrelated stretches of audio and "confidently" match on
// coincidental noise. See `overlap_center_seconds`.
const AUDIO_SAMPLE_HALF_WINDOW_SECONDS: f64 = 60.0;
// Downsampled working rate for correlation. Far below the source's native
// 44.1/48kHz, but still well above what's needed to resolve timing from
// speech/ambient sound — this keeps the FFT small and correlation fast.
const WORKING_SAMPLE_RATE: u32 = 8000;
// Below this RMS amplitude (roughly -80dBFS, on the [-1, 1] sample scale) a
// track is treated as silent. Ordinary recorded ambient noise floors sit
// well above this even in a quiet room — this is meant to catch genuine
// digital silence (a disabled/muted mic), not just "quiet."
const SILENCE_RMS_THRESHOLD: f64 = 1e-4;
// Below this normalized cross-correlation confidence, the "match" isn't
// distinguishable from correlating unrelated noise — see the comment where
// this is checked in `suggest_one_offset`. Deliberately low: correlating a
// full ~2-minute window of two different body-cam mics (each dominated by
// its own wearer's breathing/gear/footsteps most of the time, with only a
// fraction of that window being genuinely shared audio) dilutes even a
// correct match's score far more than intuition suggests — a real,
// verified-correct match scored 7-15% in testing, while a genuinely silent
// track scored ~0%. This threshold exists only to catch that degenerate
// "nothing there" case; distinguishing "weak but real" from "no real match"
// beyond that is left to the human reviewing the suggestion (see the
// per-clip confidence shown in the review banner).
const MIN_CONFIDENCE: f64 = 0.03;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSyncClipInput {
    pub id: String,
    pub path: String,
    /// The clip's current effective offset (rough sync + manual nudge), in
    /// the same coordinate space as the shared timeline. Used both to find
    /// where it currently overlaps the anchor and as the basis for the
    /// returned suggestion.
    pub current_offset_seconds: f64,
    /// The clip's duration, if known (metadata probing can fail on exotic
    /// files) — needed to compute the currently-overlapping stretch with
    /// the anchor. A clip with an unknown duration fails individually
    /// rather than falling back to guessing a sample window.
    pub duration_seconds: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum AudioSyncOutcome {
    // `rename_all` on the enum itself only renames the variant tag
    // ("Suggested" -> "suggested") — it does NOT reach into a variant's own
    // fields. Each variant with fields needs its own `rename_all` to get
    // those camelCased too, or (as happened here) the frontend silently
    // reads `undefined` for a field that's really there, just under its
    // Rust snake_case name.
    #[serde(rename_all = "camelCase")]
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
/// with `anchor`'s. Audio is sampled from the stretch where the two clips
/// currently overlap (see `overlap_center_seconds`) rather than from the
/// start of either file, and the suggested offset is searched within
/// `search_window_seconds` of the clip's current offset relative to the
/// anchor. Each clip is handled independently — one clip having no
/// overlap, an unknown duration, or undecodable audio never blocks the
/// others. Also isolated against a panic: media-parsing code (symphonia,
/// this module's own arithmetic) is processing untrusted file bytes, and an
/// unusual/malformed audio track panicking must not be able to take down
/// the whole command (and, since Tauri commands run off the UI thread but
/// an unhandled panic can still leave the frontend's request hanging
/// forever, effectively freeze the app) — see CLAUDE.md's "Codec/format
/// support" risk note, which this is the audio-sync equivalent of.
pub fn suggest_offsets(
    anchor: &AudioSyncClipInput,
    candidates: &[AudioSyncClipInput],
    search_window_seconds: f64,
) -> HashMap<String, AudioSyncOutcome> {
    let mut results = HashMap::with_capacity(candidates.len());

    for clip in candidates {
        let outcome = catch_unwind(AssertUnwindSafe(|| suggest_one_offset(anchor, clip, search_window_seconds)))
            .unwrap_or_else(|_| {
                Err("an internal error occurred while processing this clip's audio — the file may have \
                     an unusual or malformed audio track"
                    .to_string())
            })
            .unwrap_or_else(|error| AudioSyncOutcome::Failed { error });
        results.insert(clip.id.clone(), outcome);
    }

    results
}

fn suggest_one_offset(
    anchor: &AudioSyncClipInput,
    clip: &AudioSyncClipInput,
    search_window_seconds: f64,
) -> Result<AudioSyncOutcome, String> {
    let center_global = overlap_center_seconds(anchor, clip)?;
    let anchor_local_center = center_global - anchor.current_offset_seconds;
    let clip_local_center = center_global - clip.current_offset_seconds;

    let (anchor_raw, anchor_rate, anchor_start) = decode_mono_audio(
        &anchor.path,
        anchor_local_center - AUDIO_SAMPLE_HALF_WINDOW_SECONDS,
        AUDIO_SAMPLE_HALF_WINDOW_SECONDS * 2.0,
    )?;
    let anchor_samples = downsample_mono(&anchor_raw, anchor_rate, WORKING_SAMPLE_RATE);

    let (clip_raw, clip_rate, clip_start) = decode_mono_audio(
        &clip.path,
        clip_local_center - AUDIO_SAMPLE_HALF_WINDOW_SECONDS,
        AUDIO_SAMPLE_HALF_WINDOW_SECONDS * 2.0,
    )?;
    let clip_samples = downsample_mono(&clip_raw, clip_rate, WORKING_SAMPLE_RATE);

    if anchor_samples.is_empty() || clip_samples.is_empty() {
        return Err("audio track contained no decodable samples in the sampled window".to_string());
    }

    // A silent (or near-silent) track — e.g. a disabled/muted mic still
    // encoding an empty audio stream — has no real signal to correlate
    // against. Cross-correlating it anyway doesn't fail outright (see
    // best_lag_samples' all-silence test), it just produces a coincidental
    // match on noise floor that looks like an ordinary suggestion with
    // nothing to distinguish it from a real one. Treated the same as "no
    // audio track" rather than risking that.
    if rms(&anchor_samples) < SILENCE_RMS_THRESHOLD {
        return Err("anchor clip's audio is silent in the sampled window — nothing to match against".to_string());
    }
    if rms(&clip_samples) < SILENCE_RMS_THRESHOLD {
        return Err("clip's audio is silent in the sampled window — nothing to match".to_string());
    }

    // `anchor_start`/`clip_start` are where each decode *actually* landed
    // (see decode_mono_audio) — not necessarily the requested position, so
    // this correction is exact rather than assuming a precise seek.
    let start_correction = anchor_start - clip_start;
    let expected_lag = ((clip.current_offset_seconds - anchor.current_offset_seconds - start_correction)
        * WORKING_SAMPLE_RATE as f64)
        .round() as i64;
    let window_samples = (search_window_seconds * WORKING_SAMPLE_RATE as f64).round() as i64;

    let (best_lag, confidence) = best_lag_samples(&anchor_samples, &clip_samples, expected_lag, window_samples);
    let offset_seconds =
        anchor.current_offset_seconds + best_lag as f64 / WORKING_SAMPLE_RATE as f64 + start_correction;

    // A non-finite result should never reach the frontend — it's applied
    // directly to a clip's playback offset and fed straight into
    // `<video>.currentTime`, which throws (and previously crashed the whole
    // app) on anything but a finite number. Whatever produced it, report it
    // as a failure to match rather than propagate garbage.
    if !offset_seconds.is_finite() || !confidence.is_finite() {
        return Err(format!(
            "computed a non-finite offset (offset={offset_seconds}, confidence={confidence}) — this clip's audio couldn't be reliably matched"
        ));
    }

    // A low-confidence result means the correlation didn't really find
    // anything — e.g. a track with only a faint, uncorrelated noise floor
    // (present enough to clear the silence check above, but with nothing
    // in it that actually matches the anchor). Reporting that as "matched"
    // and applying it to the clip's offset would be worse than not
    // suggesting anything: a wrong-but-plausible-looking offset can go
    // unnoticed, whereas "not matched" can't.
    if confidence < MIN_CONFIDENCE {
        return Err(format!(
            "correlation confidence too low to trust ({:.0}%) — the audio may not actually overlap here, or \
             this track may be too quiet or noisy to match reliably",
            confidence * 100.0
        ));
    }

    Ok(AudioSyncOutcome::Suggested { offset_seconds, confidence })
}

/// The midpoint (in shared-timeline/global seconds) of the stretch where
/// `anchor` and `clip` currently overlap, given their present offsets and
/// durations. This is "where the two clips are currently synced to" — the
/// audio sampled here is guaranteed to be content both clips actually
/// captured, unlike sampling from file-start on clips that may be synced
/// far from their own beginnings.
fn overlap_center_seconds(anchor: &AudioSyncClipInput, clip: &AudioSyncClipInput) -> Result<f64, String> {
    let anchor_duration = anchor.duration_seconds.ok_or_else(|| "anchor clip's duration is unknown".to_string())?;
    let clip_duration = clip.duration_seconds.ok_or_else(|| "clip's duration is unknown".to_string())?;

    let overlap_start = anchor.current_offset_seconds.max(clip.current_offset_seconds);
    let overlap_end =
        (anchor.current_offset_seconds + anchor_duration).min(clip.current_offset_seconds + clip_duration);

    if overlap_end <= overlap_start {
        return Err("clips don't currently overlap enough to sample audio — adjust the rough sync first".to_string());
    }

    Ok((overlap_start + overlap_end) / 2.0)
}

/// Decodes a window of a video file's audio track to mono f32 PCM, seeking
/// first to `start_seconds` (clamped to 0) and stopping once
/// `window_seconds` of audio has been accumulated (or the file ends).
/// Returns the samples, their native (pre-downsample) sample rate, and the
/// position the decoded audio *actually* starts at — seeking is best-effort
/// (container/codec granularity), so this is read back from the first
/// decoded packet's own timestamp rather than assumed to equal
/// `start_seconds` exactly.
fn decode_mono_audio(path: &str, start_seconds: f64, window_seconds: f64) -> Result<(Vec<f32>, u32, f64), String> {
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
    let time_base = track.time_base;

    let clamped_start = start_seconds.max(0.0);
    if clamped_start > 0.0 {
        let seek_time =
            Time::try_from_secs_f64(clamped_start).ok_or_else(|| "invalid audio seek position".to_string())?;
        format
            .seek(SeekMode::Accurate, SeekTo::Time { time: seek_time, track_id: Some(track_id) })
            .map_err(|e| format!("could not seek to the requested audio position: {e}"))?;
        // The decoder must be reset after any seek — its internal state
        // (e.g. AAC overlap-add buffers) no longer matches the stream.
        decoder.reset();
    }

    let mut mono: Vec<f32> = Vec::new();
    let mut interleaved: Vec<f32> = Vec::new();
    let mut sample_rate: u32 = 0;
    let mut actual_start_seconds: Option<f64> = None;

    // Hard cap on packets read, independent of `window_seconds`. Normally
    // the window-duration check below ends the loop quickly, but a
    // pathological file (e.g. a track whose packets never decode, or that
    // never carries the audio track's ID) could otherwise loop through an
    // entire multi-hour recording — this bounds worst-case work so a single
    // unusual file can never hang the app.
    const MAX_PACKETS: u32 = 200_000;
    let mut packet_count: u32 = 0;

    loop {
        packet_count += 1;
        if packet_count > MAX_PACKETS {
            return Err("audio stream is unusually long or malformed — gave up decoding".to_string());
        }

        let packet = match format.next_packet() {
            Ok(Some(p)) => p,
            Ok(None) => break,
            Err(SymphoniaError::ResetRequired) => break,
            Err(e) => return Err(format!("error reading audio stream: {e}")),
        };
        if packet.track_id != track_id {
            continue;
        }

        if actual_start_seconds.is_none() {
            let secs = time_base
                .map(|tb| tb.calc_time_saturating(packet.pts).as_secs_f64())
                .unwrap_or(clamped_start);
            actual_start_seconds = Some(secs);
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

        if sample_rate > 0 && mono.len() as f64 / sample_rate as f64 >= window_seconds {
            break;
        }
    }

    if sample_rate == 0 || mono.is_empty() {
        return Err("no decodable audio found at the requested position".to_string());
    }

    Ok((mono, sample_rate, actual_start_seconds.unwrap_or(clamped_start)))
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

/// Root-mean-square amplitude — used to detect a silent/near-silent track
/// (see `SILENCE_RMS_THRESHOLD`) before bothering to correlate it.
fn rms(samples: &[f32]) -> f64 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_sq: f64 = samples.iter().map(|&x| (x as f64) * (x as f64)).sum();
    (sum_sq / samples.len() as f64).sqrt()
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

    fn clip(id: &str, offset: f64, duration: Option<f64>) -> AudioSyncClipInput {
        AudioSyncClipInput {
            id: id.to_string(),
            path: format!("{id}.mp4"),
            current_offset_seconds: offset,
            duration_seconds: duration,
        }
    }

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
    fn best_lag_samples_does_not_produce_nan_for_all_silent_signals() {
        // A muted/disabled mic still encoding a silent audio track is a
        // realistic real-world case — this must never poison the result
        // with NaN/Infinity (see suggest_one_offset's finite check, which
        // exists as a backstop for exactly this class of issue). Every lag
        // scores identically (0) for pure silence, so which one wins is an
        // arbitrary tie-break, not something worth asserting on — only
        // finiteness and staying in-range matter here.
        let a = vec![0.0f32; 2000];
        let b = vec![0.0f32; 2000];

        let (lag, confidence) = best_lag_samples(&a, &b, 0, 300);

        assert!(confidence.is_finite(), "confidence should be finite, got {confidence}");
        assert!((-300..=300).contains(&lag));
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
    fn rms_of_silence_is_zero() {
        assert_eq!(rms(&vec![0.0f32; 1000]), 0.0);
    }

    #[test]
    fn rms_of_an_empty_slice_is_zero() {
        assert_eq!(rms(&[]), 0.0);
    }

    #[test]
    fn rms_of_a_constant_amplitude_signal_matches_that_amplitude() {
        let samples = vec![0.5f32; 100];
        assert!((rms(&samples) - 0.5).abs() < 1e-9);
    }

    #[test]
    fn rms_below_the_silence_threshold_is_treated_as_silent() {
        // A muted/disabled mic's "silence" isn't always exactly 0.0 in
        // practice (dither, quantization noise) — the threshold should
        // still catch amplitudes far below any real recorded content.
        let near_silent = vec![0.00001f32; 2000];
        assert!(rms(&near_silent) < SILENCE_RMS_THRESHOLD);
    }

    #[test]
    fn decode_mono_audio_rejects_a_missing_file() {
        let result = decode_mono_audio("this/path/does/not/exist.mp4", 0.0, 10.0);
        assert!(result.is_err());
    }

    #[test]
    fn decode_mono_audio_rejects_a_file_that_is_not_a_valid_media_container() {
        let path = std::env::temp_dir().join("discosync_audio_sync_test_garbage.mp4");
        std::fs::write(&path, b"this is not a media file").unwrap();

        let result = decode_mono_audio(path.to_str().unwrap(), 0.0, 10.0);
        let _ = std::fs::remove_file(&path);

        assert!(result.is_err());
    }

    #[test]
    fn overlap_center_seconds_is_the_midpoint_of_the_overlapping_stretch() {
        // anchor plays [0, 100], clip plays [40, 140] (offset 40, duration 100)
        // -> overlap is [40, 100], midpoint 70.
        let anchor = clip("a", 0.0, Some(100.0));
        let candidate = clip("b", 40.0, Some(100.0));

        let center = overlap_center_seconds(&anchor, &candidate).expect("should overlap");

        assert!((center - 70.0).abs() < 1e-9);
    }

    #[test]
    fn overlap_center_seconds_fails_when_the_clips_do_not_currently_overlap() {
        // anchor plays [0, 10], clip plays [500, 510] — nowhere close under
        // their current offsets.
        let anchor = clip("a", 0.0, Some(10.0));
        let candidate = clip("b", 500.0, Some(10.0));

        assert!(overlap_center_seconds(&anchor, &candidate).is_err());
    }

    #[test]
    fn overlap_center_seconds_fails_when_a_duration_is_unknown() {
        let anchor = clip("a", 0.0, Some(100.0));
        let candidate = clip("b", 0.0, None);

        assert!(overlap_center_seconds(&anchor, &candidate).is_err());
        assert!(overlap_center_seconds(&candidate, &anchor).is_err());
    }

    #[test]
    fn suggest_offsets_reports_a_per_clip_failure_without_aborting_the_batch() {
        let anchor = clip("a", 0.0, Some(120.0));
        let candidates =
            vec![clip("b", 5.0, Some(120.0)), clip("c", 10.0, None) /* unknown duration -> can't overlap */];

        let results = suggest_offsets(&anchor, &candidates, 10.0);

        assert_eq!(results.len(), 2);
        // "b" has a real (missing, in this test) file, so decoding fails —
        // but it's reported per-clip, not as an aborted batch.
        assert!(matches!(results.get("b"), Some(AudioSyncOutcome::Failed { .. })));
        assert!(matches!(results.get("c"), Some(AudioSyncOutcome::Failed { .. })));
    }

    // Checks the actual JSON shape sent to the frontend, not just the Rust
    // struct — a `rename_all` on the enum itself doesn't reach into a
    // variant's own fields (see the comment on `AudioSyncOutcome`), so a
    // test that only exercises the Rust-side logic can't catch a field
    // silently staying snake_case and reading as `undefined` in JS. This is
    // exactly the bug that shipped before this test existed.
    #[test]
    fn audio_sync_outcome_serializes_suggested_fields_in_camel_case() {
        let outcome = AudioSyncOutcome::Suggested { offset_seconds: 12.5, confidence: 0.42 };

        let json = serde_json::to_value(&outcome).unwrap();

        assert_eq!(json["status"], "suggested");
        assert_eq!(json["offsetSeconds"], 12.5);
        assert_eq!(json["confidence"], 0.42);
        assert!(json.get("offset_seconds").is_none(), "field should not be present under its Rust name");
    }

    #[test]
    fn audio_sync_outcome_serializes_failed_fields() {
        let outcome = AudioSyncOutcome::Failed { error: "no audio track found in file".to_string() };

        let json = serde_json::to_value(&outcome).unwrap();

        assert_eq!(json["status"], "failed");
        assert_eq!(json["error"], "no audio track found in file");
    }
}
