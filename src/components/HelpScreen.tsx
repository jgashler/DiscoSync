import {
  Bookmark,
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
      </div>
    </div>
  );
}
