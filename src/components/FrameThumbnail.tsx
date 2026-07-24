import { convertFileSrc } from "@tauri-apps/api/core";

interface FrameThumbnailProps {
  filePath: string;
  className: string;
}

// Shows the first frame of a local video, purely as a visual aid for the
// user to read a burned-in timestamp off of — no frame analysis, no
// vision/AI involved. The explicit seek-to-0 on load is a standard trick to
// make sure a frame actually paints rather than leaving the element blank.
export function FrameThumbnail({ filePath, className }: FrameThumbnailProps) {
  return (
    <video
      src={convertFileSrc(filePath)}
      muted
      preload="auto"
      controls={false}
      onLoadedMetadata={(e) => {
        e.currentTarget.currentTime = 0;
      }}
      className={className}
    />
  );
}
