// Read-only video metadata probing. Only ever opens the file for reading —
// never writes to, moves, or transcodes the original file. Pure-Rust MP4
// container parsing (no shelling out to ffmpeg/ffprobe), so this works
// fully offline with no external process dependency.
use std::fs::File;
use std::io::{BufReader, Read, Seek};

use mp4::{Mp4Reader, TrackType};
use serde::Serialize;

#[derive(Debug, Serialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoMetadata {
    pub duration_seconds: f64,
    pub frame_rate: f64,
}

fn probe_reader<R: Read + Seek>(reader: R, size: u64) -> Result<VideoMetadata, String> {
    let mp4 = Mp4Reader::read_header(reader, size)
        .map_err(|e| format!("unsupported or corrupt video file: {e}"))?;

    let video_track = mp4
        .tracks()
        .values()
        .find(|t| matches!(t.track_type(), Ok(TrackType::Video)))
        .ok_or_else(|| "no video track found in file".to_string())?;

    Ok(VideoMetadata {
        duration_seconds: video_track.duration().as_secs_f64(),
        frame_rate: video_track.frame_rate(),
    })
}

pub fn probe_file(path: &str) -> Result<VideoMetadata, String> {
    let file = File::open(path).map_err(|e| format!("could not open file: {e}"))?;
    let size = file
        .metadata()
        .map_err(|e| format!("could not read file metadata: {e}"))?
        .len();
    probe_reader(BufReader::new(file), size)
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytes::Bytes;
    use mp4::{AvcConfig, Mp4Config, Mp4Sample, Mp4Writer, TrackConfig};
    use std::io::Cursor;

    /// Builds a minimal valid single-track MP4 in memory with a known
    /// frame count/duration, so probe_reader's math can be checked exactly
    /// without depending on an external sample video file.
    fn synthetic_mp4(sample_count: u32, sample_duration_units: u32) -> Vec<u8> {
        let config = Mp4Config {
            major_brand: "isom".parse().unwrap(),
            minor_version: 512,
            compatible_brands: vec!["isom".parse().unwrap(), "mp41".parse().unwrap()],
            timescale: 1000,
        };

        let mut writer = Mp4Writer::write_start(Cursor::new(Vec::<u8>::new()), &config).unwrap();

        let track_config: TrackConfig = AvcConfig {
            width: 64,
            height: 48,
            // AvcCBox::new indexes sps[1..4] for profile/level bytes, so this
            // needs at least 4 placeholder bytes even though we never decode it.
            seq_param_set: vec![0, 0, 0, 0],
            pic_param_set: vec![0],
        }
        .into();
        writer.add_track(&track_config).unwrap();

        for i in 0..sample_count {
            let sample = Mp4Sample {
                start_time: (i * sample_duration_units) as u64,
                duration: sample_duration_units,
                rendering_offset: 0,
                is_sync: true,
                bytes: Bytes::from(vec![0u8; 4]),
            };
            writer.write_sample(1, &sample).unwrap();
        }

        writer.write_end().unwrap();
        writer.into_writer().into_inner()
    }

    #[test]
    fn reads_duration_and_frame_rate_from_a_synthetic_mp4() {
        // Track timescale is fixed at 1000 by mp4::TrackConfig::from(AvcConfig),
        // so duration_units here are milliseconds: 10 samples * 100ms = 1s @ 10fps.
        let bytes = synthetic_mp4(10, 100);
        let size = bytes.len() as u64;

        let metadata = probe_reader(Cursor::new(bytes), size).expect("should parse synthetic mp4");

        assert!((metadata.duration_seconds - 1.0).abs() < 1e-9);
        assert!((metadata.frame_rate - 10.0).abs() < 1e-9);
    }

    #[test]
    fn rejects_a_file_that_is_not_a_valid_mp4() {
        let garbage = b"this is not an mp4 file".to_vec();
        let size = garbage.len() as u64;

        let result = probe_reader(Cursor::new(garbage), size);

        assert!(result.is_err());
    }
}
