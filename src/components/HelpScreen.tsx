import {
  AudioWaveform,
  Bookmark,
  CircleHelp,
  Columns2,
  Keyboard,
  LayoutDashboard,
  LayoutGrid,
  Maximize2,
  Move,
  Repeat,
  Save,
  SlidersHorizontal,
  Upload,
  ZoomIn,
} from "lucide-react";

const SHORTCUTS = [
  { action: "Save project", key: "Ctrl+S" },
  { action: "Play or pause", key: "Space" },
  { action: "Skip back 10 seconds", key: "←" },
  { action: "Skip forward 10 seconds", key: "→" },
  { action: "Step one frame back (pause first)", key: "," },
  { action: "Step one frame forward (pause first)", key: "." },
];

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}

function Section({ icon, title, children }: SectionProps) {
  return (
    <section className="flex gap-3">
      <div className="shrink-0 w-9 h-9 rounded-md bg-neutral-800 flex items-center justify-center text-blue-400">
        {icon}
      </div>
      <div className="min-w-0">
        <h2 className="font-semibold text-neutral-100">{title}</h2>
        <div className="text-sm text-neutral-400 mt-1 leading-relaxed space-y-2">{children}</div>
      </div>
    </section>
  );
}

// A plain-language walkthrough of what DiscoSync does and how to use it,
// aimed at reviewers who aren't technical. No mention of sync offsets,
// frame rates, or anything else from the implementation. Opens in its own
// small window so it can stay open for reference alongside the main app.
export function HelpScreen() {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">DiscoSync Help</h1>
        <p className="text-sm text-neutral-400 mt-1">
          A quick guide to reviewing multiple videos of the same event, side by side.
        </p>
      </header>

      <div className="space-y-6">
        <Section icon={<Upload size={17} />} title="Getting started">
          <p>
            On the main screen, click <strong>Add Videos</strong> and choose the video files you
            want to review. You can add just one video, or several angles of the same event.
          </p>
          <p>
            If you have more than one video, type in the time of day each one starts (like{" "}
            <span className="text-neutral-300">14:32:05</span>) so DiscoSync can line them up to
            play together automatically. A single video doesn't need a start time. It's ready to
            review right away.
          </p>
        </Section>

        <Section icon={<LayoutGrid size={17} />} title="Reviewing your videos">
          <p>Once you click Start Review, you can watch all your videos in a few different layouts:</p>
          <ul className="list-disc list-inside space-y-1">
            <li className="flex items-start gap-1.5">
              <LayoutGrid size={14} className="mt-0.5 shrink-0" />
              <span><strong>Grid:</strong> every video the same size, side by side.</span>
            </li>
            <li className="flex items-start gap-1.5">
              <Maximize2 size={14} className="mt-0.5 shrink-0" />
              <span><strong>Focus one:</strong> one video large, the rest as small thumbnails you can swap in.</span>
            </li>
            <li className="flex items-start gap-1.5">
              <Columns2 size={14} className="mt-0.5 shrink-0" />
              <span><strong>Focus two:</strong> two videos large at once, side by side.</span>
            </li>
            <li className="flex items-start gap-1.5">
              <LayoutDashboard size={14} className="mt-0.5 shrink-0" />
              <span><strong>Dynamic grid:</strong> drag any videos you want front and center. The rest wait in the sidebar.</span>
            </li>
          </ul>
          <p>
            Every video plays in perfect sync no matter which layout you're in. Press play once
            and everything moves together.
          </p>
        </Section>

        <Section icon={<Move size={17} />} title="Rearranging with drag and drop">
          <p>
            Click and drag any video to rearrange it. In Grid, dragging one video onto another
            swaps their positions. In Focus view, drag a thumbnail onto the large video to bring
            it front and center. In Dynamic grid, drag videos between the main area and the
            sidebar to choose what's showing.
          </p>
          <p>
            Right-click a video and choose <strong>Duplicate</strong> to add a second copy of it
            in its own spot — handy for watching the same footage two ways at once, like one
            zoomed on a detail while the other shows the full frame. Both point at the same file
            on disk (nothing is copied), but play, sync, and zoom independently from then on. To
            remove a copy later, go back to the import screen and remove it like any other video.
          </p>
        </Section>

        <Section icon={<SlidersHorizontal size={17} />} title="Fine-tuning sync by hand">
          <p>
            If a video looks slightly out of step with the others, pause playback first. Under
            each video are nudge buttons and a number box showing its offset in seconds. The
            arrow buttons nudge one frame at a time for exact alignment. The 1h / 1m / 1s buttons
            nudge by a full hour, minute, or second, for quickly correcting a camera whose clock
            was set off by a round amount rather than clicking through frame by frame. You can
            also type an exact offset directly into the number box.
          </p>
        </Section>

        <Section icon={<AudioWaveform size={17} />} title="Syncing by audio">
          <p>
            If two or more videos have audio, the <strong>Sync by audio</strong> button (top
            right, once your videos are roughly synced) asks you to click the videos you want
            compared against each other — click each one (a checkmark appears). Before you hit{" "}
            <strong>Sync</strong>, a dropdown lets you choose how far either side of where the
            clips currently sit to search (5s, 30s, or 5m). A narrower search is less likely to
            lock onto a coincidental match far from where you've placed the clips — pick a wider
            one only if you're not confident they're already close to lined up. It listens just
            before and after wherever those clips are currently synced within that range, so it
            works even when the moment is deep into a long recording. Everything happens on your
            computer — nothing is uploaded anywhere.
          </p>
          <p>
            It only ever suggests an offset. The new alignment is applied right away so you can
            watch and listen to it, but a banner appears letting you <strong>Keep</strong> it or{" "}
            <strong>Revert</strong> back to what you had before. If a video's audio couldn't be
            matched, it's left untouched and called out in the banner.
          </p>
        </Section>

        <Section icon={<ZoomIn size={17} />} title="Slowing down and zooming in">
          <p>
            The speed dropdown lets you slow footage all the way down to a crawl (one frame per
            second) or speed it up to 16x, so you can catch details or skim through quickly.
          </p>
          <p>
            When a single video fills the screen, a small preview appears in a corner
            automatically. In Grid and Dynamic grid, hover over any video and click the zoom icon
            to turn it on for just that one. Drag on the preview to pan, and scroll to zoom in on
            a specific part of the frame, like a face or a license plate.
          </p>
        </Section>

        <Section icon={<Bookmark size={17} />} title="Marking important moments">
          <p>
            Click the bookmark button to mark the moment you're on, and give it a name like
            "Incident starts here." Click a bookmark anytime to jump straight back to it.
          </p>
        </Section>

        <Section icon={<Repeat size={17} />} title="Looping a moment">
          <p>
            Want to watch the same few seconds over and over? Click the loop button, then click
            twice on the timeline to mark a start and end point. DiscoSync will keep replaying
            that stretch automatically until you turn it off.
          </p>
        </Section>

        <Section icon={<Save size={17} />} title="Saving your work">
          <p>
            Click <strong>Save project</strong> anytime. It saves which videos you added, their
            start times, and your bookmarks to a project file you can reopen later. Your{" "}
            <strong>Recent Projects</strong> list makes it easy to pick up where you left off.
          </p>
          <p>
            Saving from the review screen also remembers exactly how you left it: which layout you
            were using, where playback was paused, your speed setting, any zoomed-in video, and a
            loop range if you had one set.
          </p>
        </Section>

        <Section icon={<Keyboard size={17} />} title="Keyboard shortcuts">
          <div className="space-y-1.5">
            {SHORTCUTS.map((s) => (
              <div key={s.action} className="flex items-center justify-between gap-3">
                <span>{s.action}</span>
                <kbd className="px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-neutral-300 text-xs font-mono">
                  {s.key}
                </kbd>
              </div>
            ))}
          </div>
        </Section>

        <Section icon={<CircleHelp size={17} />} title="Troubleshooting">
          <p>
            <strong>A video won't import, or shows a red error message.</strong> DiscoSync plays
            video the same way a web browser does, so it only understands standard video files —
            the kind most phones, body cams, and dash cams produce (MP4, MOV). Older formats like
            AVI, sometimes used by older security DVR systems, aren't supported. Convert the file
            to MP4 with any video converter first, then import the converted copy — your original
            file is never touched either way.
          </p>
          <p>
            <strong>A red error appears next to a video that used to work fine.</strong> This
            usually means the file was moved, renamed, or is on a drive that isn't connected right
            now. Click <strong>Relink…</strong> next to it and point to the file's new location.
          </p>
          <p>
            <strong>Start Review won't turn on.</strong> A single video doesn't need a start time.
            Two or more videos each need a valid start time-of-day (like{" "}
            <span className="text-neutral-300">14:32:05</span>) entered before you can begin.
          </p>
          <p>
            <strong>A video looks faded or see-through, or says it's out of range.</strong> That
            means it hasn't started yet, or has already ended, at the point you're currently
            viewing — expected once clips have different lengths or start times. It clears up on
            its own once playback reaches that clip's actual footage.
          </p>
          <p>
            <strong>The videos still don't look lined up, even though the start times are right.
            </strong>{" "}
            Camera clocks are often a few seconds (sometimes more) off from each other even when
            the recorded start time is correct. Use the nudge buttons to fine-tune by hand, or try{" "}
            <strong>Sync by audio</strong> if the clips share audio.
          </p>
          <p>
            <strong>Sync by audio says low confidence, or couldn't find a match.</strong> That
            doesn't mean anything is broken — it means the audio in the two clips isn't similar
            enough to be confident they're the same moment (each camera's microphone mostly picks
            up its own surroundings). Nudge the offset by hand instead, or try a different pair of
            clips.
          </p>
          <p>
            <strong>Windows says "Windows protected your PC" or Microsoft Defender SmartScreen
            blocked this app.</strong> This shows up because the app isn't yet digitally signed
            with a certificate Microsoft recognizes — it doesn't mean anything is wrong with the
            download. Click <strong>More info</strong>, then <strong>Run anyway</strong>.
          </p>
          <p>
            <strong>macOS says the app is from an unidentified developer, or can't be opened.
            </strong>{" "}
            Same idea as the Windows warning above. Right-click (or Control-click) the app and
            choose <strong>Open</strong>, then confirm — this only needs to be done the first time.
          </p>
        </Section>
      </div>
    </div>
  );
}
