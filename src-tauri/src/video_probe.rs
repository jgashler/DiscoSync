// Read-only video metadata probing. Only ever opens the file for reading —
// never writes to, moves, or transcodes the original file. Pure-Rust MP4/MOV
// container parsing (no shelling out to ffmpeg/ffprobe), so this works fully
// offline with no external process dependency.
//
// This is a small, purpose-built box walker rather than a general-purpose
// MP4 parser. It only follows the exact path needed to read one video
// track's duration and frame rate (moov > trak > mdia > hdlr/mdhd/minf >
// stbl > stts), and skips every other box — including all audio boxes — by
// its declared size, without attempting to understand its contents. This
// matters because QuickTime .mov files commonly use a "Version 1" audio
// sample description with extra fields before any child boxes; a general
// parser that insists on deep-parsing the audio track (like the `mp4` crate
// this replaced) misreads that as a corrupt child box and rejects the whole
// file, even though the audio track is never needed here.
use std::fs::File;
use std::io::{self, BufReader, Read, Seek, SeekFrom};

use serde::Serialize;

#[derive(Debug, Serialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoMetadata {
    pub duration_seconds: f64,
    pub frame_rate: f64,
}

/// Reads one big-endian box header at the reader's current position.
/// Returns `(box_type, content_start, content_end)`, or `None` at EOF.
/// `range_end` bounds a `size == 0` box ("extends to end of containing
/// range"), which is rare for the container boxes this module cares about
/// but handled rather than treated as an error.
fn read_box_header<R: Read + Seek>(
    reader: &mut R,
    range_end: u64,
) -> io::Result<Option<([u8; 4], u64, u64)>> {
    let box_start = reader.stream_position()?;
    let mut size_buf = [0u8; 4];
    match reader.read_exact(&mut size_buf) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let mut type_buf = [0u8; 4];
    reader.read_exact(&mut type_buf)?;

    let mut size = u32::from_be_bytes(size_buf) as u64;
    let mut header_len = 8u64;
    if size == 1 {
        let mut large_buf = [0u8; 8];
        reader.read_exact(&mut large_buf)?;
        size = u64::from_be_bytes(large_buf);
        header_len = 16;
    }

    let content_start = box_start + header_len;
    let content_end = if size == 0 {
        range_end
    } else {
        box_start + size
    };

    if content_end < content_start {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "box declares a size smaller than its own header",
        ));
    }

    Ok(Some((type_buf, content_start, content_end)))
}

/// Finds the first direct child box of `target` type within `[range_start, range_end)`.
fn find_child<R: Read + Seek>(
    reader: &mut R,
    range_start: u64,
    range_end: u64,
    target: &[u8; 4],
) -> io::Result<Option<(u64, u64)>> {
    reader.seek(SeekFrom::Start(range_start))?;
    loop {
        let pos = reader.stream_position()?;
        if pos >= range_end {
            return Ok(None);
        }
        match read_box_header(reader, range_end)? {
            None => return Ok(None),
            Some((box_type, content_start, content_end)) => {
                let clamped_end = content_end.min(range_end);
                if &box_type == target {
                    return Ok(Some((content_start, clamped_end)));
                }
                reader.seek(SeekFrom::Start(clamped_end))?;
            }
        }
    }
}

/// Finds every direct child box of `target` type within `[range_start, range_end)`.
fn find_all_children<R: Read + Seek>(
    reader: &mut R,
    range_start: u64,
    range_end: u64,
    target: &[u8; 4],
) -> io::Result<Vec<(u64, u64)>> {
    let mut result = Vec::new();
    reader.seek(SeekFrom::Start(range_start))?;
    loop {
        let pos = reader.stream_position()?;
        if pos >= range_end {
            break;
        }
        match read_box_header(reader, range_end)? {
            None => break,
            Some((box_type, content_start, content_end)) => {
                let clamped_end = content_end.min(range_end);
                if &box_type == target {
                    result.push((content_start, clamped_end));
                }
                reader.seek(SeekFrom::Start(clamped_end))?;
            }
        }
    }
    Ok(result)
}

/// Reads a `hdlr` box's handler_type and reports whether it's `"vide"`.
fn is_video_handler<R: Read + Seek>(reader: &mut R, start: u64, end: u64) -> io::Result<bool> {
    // full-box header (4) + pre_defined (4) + handler_type (4)
    if end.saturating_sub(start) < 12 {
        return Ok(false);
    }
    reader.seek(SeekFrom::Start(start + 8))?;
    let mut handler_type = [0u8; 4];
    reader.read_exact(&mut handler_type)?;
    Ok(&handler_type == b"vide")
}

/// Reads a `mdhd` box's timescale and duration (in timescale units),
/// handling both Version 0 (32-bit fields) and Version 1 (64-bit fields).
fn read_mdhd<R: Read + Seek>(reader: &mut R, start: u64, end: u64) -> io::Result<(u32, u64)> {
    reader.seek(SeekFrom::Start(start))?;
    let mut version_flags = [0u8; 4];
    reader.read_exact(&mut version_flags)?;
    let version = version_flags[0];

    if version == 1 {
        if end.saturating_sub(start) < 4 + 8 + 8 + 4 + 8 {
            return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "mdhd (v1) too short"));
        }
        let mut buf = [0u8; 8 + 8 + 4 + 8];
        reader.read_exact(&mut buf)?;
        let timescale = u32::from_be_bytes(buf[16..20].try_into().unwrap());
        let duration = u64::from_be_bytes(buf[20..28].try_into().unwrap());
        Ok((timescale, duration))
    } else {
        if end.saturating_sub(start) < 4 + 4 + 4 + 4 + 4 {
            return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "mdhd (v0) too short"));
        }
        let mut buf = [0u8; 4 + 4 + 4 + 4];
        reader.read_exact(&mut buf)?;
        let timescale = u32::from_be_bytes(buf[8..12].try_into().unwrap());
        let duration = u32::from_be_bytes(buf[12..16].try_into().unwrap()) as u64;
        Ok((timescale, duration))
    }
}

/// Reads a `stts` (decoding time-to-sample) box and sums its sample counts
/// to get the video track's total frame count.
fn read_stts_sample_count<R: Read + Seek>(reader: &mut R, start: u64, end: u64) -> io::Result<u64> {
    if end.saturating_sub(start) < 8 {
        return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "stts too short"));
    }
    reader.seek(SeekFrom::Start(start))?;
    let mut header = [0u8; 8]; // version+flags(4) + entry_count(4)
    reader.read_exact(&mut header)?;
    let entry_count = u32::from_be_bytes(header[4..8].try_into().unwrap());

    let mut total: u64 = 0;
    for _ in 0..entry_count {
        if reader.stream_position()? + 8 > end {
            break;
        }
        let mut entry = [0u8; 8];
        reader.read_exact(&mut entry)?;
        let sample_count = u32::from_be_bytes(entry[0..4].try_into().unwrap());
        total += sample_count as u64;
    }
    Ok(total)
}

fn probe_reader<R: Read + Seek>(mut reader: R, size: u64) -> Result<VideoMetadata, String> {
    let wrap = |msg: String| format!("unsupported or corrupt video file: {msg}");
    let io_err = |e: io::Error| wrap(e.to_string());

    let (moov_start, moov_end) = find_child(&mut reader, 0, size, b"moov")
        .map_err(io_err)?
        .ok_or_else(|| wrap("no moov box found".to_string()))?;

    let traks = find_all_children(&mut reader, moov_start, moov_end, b"trak").map_err(io_err)?;

    for (trak_start, trak_end) in &traks {
        let result = (|| -> io::Result<Option<VideoMetadata>> {
            let Some((mdia_start, mdia_end)) = find_child(&mut reader, *trak_start, *trak_end, b"mdia")? else {
                return Ok(None);
            };
            let Some((hdlr_start, hdlr_end)) = find_child(&mut reader, mdia_start, mdia_end, b"hdlr")? else {
                return Ok(None);
            };
            if !is_video_handler(&mut reader, hdlr_start, hdlr_end)? {
                return Ok(None);
            }

            let Some((mdhd_start, mdhd_end)) = find_child(&mut reader, mdia_start, mdia_end, b"mdhd")? else {
                return Ok(None);
            };
            let (timescale, duration_units) = read_mdhd(&mut reader, mdhd_start, mdhd_end)?;
            if timescale == 0 {
                return Ok(None);
            }
            let duration_seconds = duration_units as f64 / timescale as f64;

            let Some((minf_start, minf_end)) = find_child(&mut reader, mdia_start, mdia_end, b"minf")? else {
                return Ok(None);
            };
            let Some((stbl_start, stbl_end)) = find_child(&mut reader, minf_start, minf_end, b"stbl")? else {
                return Ok(None);
            };
            let Some((stts_start, stts_end)) = find_child(&mut reader, stbl_start, stbl_end, b"stts")? else {
                return Ok(None);
            };
            let sample_count = read_stts_sample_count(&mut reader, stts_start, stts_end)?;

            let frame_rate = if duration_seconds > 0.0 {
                sample_count as f64 / duration_seconds
            } else {
                0.0
            };

            Ok(Some(VideoMetadata { duration_seconds, frame_rate }))
        })()
        .map_err(io_err)?;

        if let Some(metadata) = result {
            return Ok(metadata);
        }
    }

    Err(wrap("no video track found in file".to_string()))
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
    /// without depending on an external sample video file. Uses the `mp4`
    /// crate purely as a writer here (dev-only) — probe_reader itself no
    /// longer depends on it.
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

    // --- hand-built box fixtures, for cases the `mp4` crate's writer can't produce ---

    fn write_box(out: &mut Vec<u8>, box_type: &[u8; 4], body: &[u8]) {
        let size = (8 + body.len()) as u32;
        out.extend_from_slice(&size.to_be_bytes());
        out.extend_from_slice(box_type);
        out.extend_from_slice(body);
    }

    fn hdlr(handler_type: &[u8; 4]) -> Vec<u8> {
        let mut body = Vec::new();
        body.extend_from_slice(&[0, 0, 0, 0]); // version+flags
        body.extend_from_slice(&[0, 0, 0, 0]); // pre_defined
        body.extend_from_slice(handler_type);
        body.extend_from_slice(&[0u8; 12]); // reserved
        body.push(0); // empty name
        let mut out = Vec::new();
        write_box(&mut out, b"hdlr", &body);
        out
    }

    fn mdhd_v0(timescale: u32, duration: u32) -> Vec<u8> {
        let mut body = Vec::new();
        body.extend_from_slice(&[0, 0, 0, 0]); // version 0 + flags
        body.extend_from_slice(&0u32.to_be_bytes()); // creation_time
        body.extend_from_slice(&0u32.to_be_bytes()); // modification_time
        body.extend_from_slice(&timescale.to_be_bytes());
        body.extend_from_slice(&duration.to_be_bytes());
        body.extend_from_slice(&[0, 0, 0, 0]); // language + pre_defined
        let mut out = Vec::new();
        write_box(&mut out, b"mdhd", &body);
        out
    }

    fn stts(entries: &[(u32, u32)]) -> Vec<u8> {
        let mut body = Vec::new();
        body.extend_from_slice(&[0, 0, 0, 0]); // version+flags
        body.extend_from_slice(&(entries.len() as u32).to_be_bytes());
        for (count, delta) in entries {
            body.extend_from_slice(&count.to_be_bytes());
            body.extend_from_slice(&delta.to_be_bytes());
        }
        let mut out = Vec::new();
        write_box(&mut out, b"stts", &body);
        out
    }

    /// A minimal `mp4a` box using a Version 1 QuickTime sound sample
    /// description: the same shape that made the previous `mp4` crate-based
    /// parser misread real .mov files and reject them entirely. Version 1
    /// inserts 16 extra bytes (four u32 fields) after the base 20-byte
    /// sample entry header and before where any child boxes would start,
    /// with no child boxes here. A parser that assumes Version 0's fixed
    /// 28-byte layout and tries to read a child box immediately after would
    /// misinterpret these extra bytes as a bogus, oversized box header.
    fn mp4a_version1() -> Vec<u8> {
        let mut body = Vec::new();
        body.extend_from_slice(&[0u8; 6]); // reserved
        body.extend_from_slice(&1u16.to_be_bytes()); // data_reference_index
        body.extend_from_slice(&1u16.to_be_bytes()); // version = 1
        body.extend_from_slice(&0u16.to_be_bytes()); // revision_level
        body.extend_from_slice(&0u32.to_be_bytes()); // vendor
        body.extend_from_slice(&2u16.to_be_bytes()); // channel_count
        body.extend_from_slice(&16u16.to_be_bytes()); // sample_size
        body.extend_from_slice(&0u16.to_be_bytes()); // compression_id
        body.extend_from_slice(&0u16.to_be_bytes()); // packet_size
        body.extend_from_slice(&(44100u32 << 16).to_be_bytes()); // sample_rate (16.16 fixed)
        // Version 1 extra fields — the part a Version-0-only parser doesn't expect:
        body.extend_from_slice(&1024u32.to_be_bytes()); // samples_per_packet
        body.extend_from_slice(&4u32.to_be_bytes()); // bytes_per_packet
        body.extend_from_slice(&2u32.to_be_bytes()); // bytes_per_frame
        body.extend_from_slice(&2u32.to_be_bytes()); // bytes_per_sample
        let mut out = Vec::new();
        write_box(&mut out, b"mp4a", &body);
        out
    }

    fn stsd_with_mp4a() -> Vec<u8> {
        let mp4a = mp4a_version1();
        let mut body = Vec::new();
        body.extend_from_slice(&[0, 0, 0, 0]); // version+flags
        body.extend_from_slice(&1u32.to_be_bytes()); // entry_count
        body.extend_from_slice(&mp4a);
        let mut out = Vec::new();
        write_box(&mut out, b"stsd", &body);
        out
    }

    fn minf_video(stts_box: &[u8]) -> Vec<u8> {
        let mut stbl_body = Vec::new();
        stbl_body.extend_from_slice(stts_box);
        let mut stbl_box = Vec::new();
        write_box(&mut stbl_box, b"stbl", &stbl_body);

        let mut body = Vec::new();
        body.extend_from_slice(&stbl_box);
        let mut out = Vec::new();
        write_box(&mut out, b"minf", &body);
        out
    }

    fn minf_audio() -> Vec<u8> {
        let mut stbl_body = Vec::new();
        stbl_body.extend_from_slice(&stsd_with_mp4a());
        let mut stbl_box = Vec::new();
        write_box(&mut stbl_box, b"stbl", &stbl_body);

        let mut body = Vec::new();
        body.extend_from_slice(&stbl_box);
        let mut out = Vec::new();
        write_box(&mut out, b"minf", &body);
        out
    }

    fn mdia(hdlr_box: &[u8], mdhd_box: &[u8], minf_box: &[u8]) -> Vec<u8> {
        let mut body = Vec::new();
        body.extend_from_slice(mdhd_box);
        body.extend_from_slice(hdlr_box);
        body.extend_from_slice(minf_box);
        let mut out = Vec::new();
        write_box(&mut out, b"mdia", &body);
        out
    }

    fn trak(mdia_box: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        write_box(&mut out, b"trak", mdia_box);
        out
    }

    fn moov(traks: &[Vec<u8>]) -> Vec<u8> {
        let mut body = Vec::new();
        for t in traks {
            body.extend_from_slice(t);
        }
        let mut out = Vec::new();
        write_box(&mut out, b"moov", &body);
        out
    }

    /// Reproduces the reported bug at the box level: a moov with an audio
    /// track using a Version 1 mp4a sound description (common in real .mov
    /// files) alongside a normal video track. The old `mp4`-crate-based
    /// parser choked on the audio track's layout before ever reaching the
    /// video track's data. This parser must skip the audio track's stsd/mp4a
    /// entirely (never parsing its contents) and still recover the video
    /// track's duration and frame rate.
    #[test]
    fn reads_video_track_metadata_when_a_sibling_audio_track_uses_a_version1_sound_description() {
        let video_trak = trak(&mdia(&hdlr(b"vide"), &mdhd_v0(1000, 1000), &minf_video(&stts(&[(10, 100)]))));
        let audio_trak = trak(&mdia(&hdlr(b"soun"), &mdhd_v0(44100, 44100), &minf_audio()));

        let moov_box = moov(&[video_trak, audio_trak]);
        let size = moov_box.len() as u64;
        let metadata = probe_reader(Cursor::new(moov_box), size)
            .expect("should parse video track despite Version 1 audio sample description");

        assert!((metadata.duration_seconds - 1.0).abs() < 1e-9);
        assert!((metadata.frame_rate - 10.0).abs() < 1e-9);
    }

    #[test]
    fn reads_mdhd_version1_with_64_bit_duration() {
        let mut mdhd_body = Vec::new();
        mdhd_body.extend_from_slice(&[1, 0, 0, 0]); // version 1 + flags
        mdhd_body.extend_from_slice(&0u64.to_be_bytes()); // creation_time
        mdhd_body.extend_from_slice(&0u64.to_be_bytes()); // modification_time
        mdhd_body.extend_from_slice(&1000u32.to_be_bytes()); // timescale
        mdhd_body.extend_from_slice(&2000u64.to_be_bytes()); // duration
        mdhd_body.extend_from_slice(&[0, 0, 0, 0]); // language + pre_defined
        let mut mdhd_box = Vec::new();
        write_box(&mut mdhd_box, b"mdhd", &mdhd_body);

        let video_trak = trak(&mdia(&hdlr(b"vide"), &mdhd_box, &minf_video(&stts(&[(20, 100)]))));
        let moov_box = moov(&[video_trak]);
        let size = moov_box.len() as u64;
        let metadata = probe_reader(Cursor::new(moov_box), size).expect("should parse version 1 mdhd");

        assert!((metadata.duration_seconds - 2.0).abs() < 1e-9);
        assert!((metadata.frame_rate - 10.0).abs() < 1e-9);
    }
}
