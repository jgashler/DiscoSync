import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { ArrowRight, ChevronDown, FilePlus, HelpCircle, History, Trash2, X } from "lucide-react";
import logoUrl from "../assets/DiscoSync_logo_noBG.png";
import { openHelpWindow, pickReplacementVideoFile, pickVideoFiles, probeVideoMetadata } from "../lib/native";
import { parseTimeOfDay } from "../lib/timeOfDay";
import { FrameThumbnail } from "./FrameThumbnail";
import { TimeInput } from "./TimeInput";
import { ConfirmDialog } from "./ConfirmDialog";
import { formatSecondsShort } from "../lib/formatSeconds";
import type { RecentSessionEntry, VideoClip } from "../types/project";

function formatRelativeTime(isoTimestamp: string): string {
  const then = new Date(isoTimestamp).getTime();
  if (Number.isNaN(then)) return "";
  const diffMinutes = Math.round((Date.now() - then) / 60000);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

interface ImportScreenProps {
  clips: VideoClip[];
  setClips: Dispatch<SetStateAction<VideoClip[]>>;
  syncOffsets: Record<string, number>;
  canStartReview: boolean;
  onStartReview: () => void;
  projectName: string;
  onProjectNameChange: (name: string) => void;
  onSave: () => Promise<boolean>;
  onLoad: () => void;
  onNewProject: () => void;
  sessionError: string | null;
  recentSessions: RecentSessionEntry[];
  onOpenRecentSession: (path: string) => void;
  onRemoveRecentSession: (path: string) => void;
  isDirty: boolean;
}

export function ImportScreen({
  clips,
  setClips,
  syncOffsets,
  canStartReview,
  onStartReview,
  projectName,
  onProjectNameChange,
  onSave,
  onLoad,
  onNewProject,
  sessionError,
  recentSessions,
  onOpenRecentSession,
  onRemoveRecentSession,
  isDirty,
}: ImportScreenProps) {
  const [zoomedClipId, setZoomedClipId] = useState<string | null>(null);
  const zoomedClip = clips.find((c) => c.id === zoomedClipId) ?? null;
  const [recentMenuOpen, setRecentMenuOpen] = useState(false);
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null);
  const [pendingRemoveClipId, setPendingRemoveClipId] = useState<string | null>(null);
  const pendingRemoveClip = clips.find((c) => c.id === pendingRemoveClipId) ?? null;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void onSave();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onSave]);

  function probeAndApply(clipId: string, filePath: string) {
    probeVideoMetadata(filePath)
      .then(({ durationSeconds, frameRate }) => {
        setClips((prev) =>
          prev.map((c) =>
            c.id === clipId ? { ...c, durationSeconds, frameRate, metadataError: null } : c,
          ),
        );
      })
      .catch((error: unknown) => {
        setClips((prev) =>
          prev.map((c) => (c.id === clipId ? { ...c, metadataError: String(error) } : c)),
        );
      });
  }

  async function handleAddVideos() {
    const paths = await pickVideoFiles();
    if (paths.length === 0) return;

    // Skip anything already in this session (by path) — both against what's
    // already loaded and against duplicates within this same picker
    // selection, since nothing else guards against picking a file twice.
    const existingPaths = new Set(clips.map((c) => c.filePath.toLowerCase()));
    const uniquePaths: string[] = [];
    for (const path of paths) {
      const key = path.toLowerCase();
      if (existingPaths.has(key)) continue;
      existingPaths.add(key);
      uniquePaths.push(path);
    }

    const skippedCount = paths.length - uniquePaths.length;
    setDuplicateNotice(
      skippedCount > 0
        ? `Skipped ${skippedCount} file${skippedCount === 1 ? "" : "s"} already in this session.`
        : null,
    );
    if (uniquePaths.length === 0) return;

    const newClips: VideoClip[] = uniquePaths.map((filePath, i) => ({
      id: crypto.randomUUID(),
      filePath,
      fileName: fileNameFromPath(filePath),
      description: "",
      startTimeOfDay: "",
      durationSeconds: null,
      frameRate: null,
      metadataError: null,
      syncOffsetSeconds: 0,
      manualOffsetSeconds: 0,
      muted: false,
      volume: 1,
      gridPosition: clips.length + i,
    }));

    setClips((prev) => [...prev, ...newClips]);
    for (const clip of newClips) probeAndApply(clip.id, clip.filePath);
  }

  async function handleRelink(clipId: string) {
    const newPath = await pickReplacementVideoFile();
    if (!newPath) return;

    setClips((prev) =>
      prev.map((c) =>
        c.id === clipId
          ? {
              ...c,
              filePath: newPath,
              fileName: fileNameFromPath(newPath),
              metadataError: null,
              durationSeconds: null,
              frameRate: null,
            }
          : c,
      ),
    );
    probeAndApply(clipId, newPath);
  }

  function updateStartTime(id: string, value: string) {
    setClips((prev) => prev.map((c) => (c.id === id ? { ...c, startTimeOfDay: value } : c)));
  }

  function updateDescription(id: string, value: string) {
    setClips((prev) => prev.map((c) => (c.id === id ? { ...c, description: value } : c)));
  }

  function handleConfirmRemoveClip() {
    if (!pendingRemoveClipId) return;
    // Only ever drops the clip from this session's list — the original
    // video file on disk is never touched.
    setClips((prev) => prev.filter((c) => c.id !== pendingRemoveClipId));
    if (zoomedClipId === pendingRemoveClipId) setZoomedClipId(null);
    setPendingRemoveClipId(null);
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-8">
      <header className="mb-6 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <img src={logoUrl} alt="" className="w-[72px] h-[72px] shrink-0" />
          <h1 className="text-4xl font-semibold">DiscoSync</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void openHelpWindow()}
            title="Help"
            className="w-9 h-9 flex items-center justify-center rounded-md bg-neutral-800 hover:bg-neutral-700 transition-colors"
          >
            <HelpCircle size={16} />
          </button>
          <button
            onClick={onStartReview}
            disabled={!canStartReview}
            title={
              canStartReview
                ? undefined
                : clips.length <= 1
                  ? "Add a video with valid metadata to start review"
                  : "Add at least 2 clips with valid start times to start review"
            }
            className="rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-800 disabled:text-neutral-500 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium transition-colors flex items-center gap-1.5"
          >
            Start review
            <ArrowRight size={14} />
          </button>
        </div>
      </header>

      <div className="mb-6 flex items-center gap-3">
        <input
          value={projectName}
          onChange={(e) => onProjectNameChange(e.target.value)}
          className="bg-neutral-900 rounded px-2 py-1.5 text-sm outline-none border border-neutral-800 focus:border-blue-500 w-64"
          placeholder="Session name"
        />
        <button
          onClick={() => void onSave()}
          className="rounded-md bg-neutral-800 hover:bg-neutral-700 px-3 py-1.5 text-sm transition-colors flex items-center gap-1.5"
        >
          Save project
          {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" title="Unsaved changes" />}
        </button>
        <button
          onClick={onLoad}
          className="rounded-md bg-neutral-800 hover:bg-neutral-700 px-3 py-1.5 text-sm transition-colors"
        >
          Open project…
        </button>
        <button
          onClick={onNewProject}
          className="rounded-md bg-neutral-800 hover:bg-neutral-700 px-3 py-1.5 text-sm transition-colors flex items-center gap-1.5"
        >
          <FilePlus size={14} />
          New project
        </button>

        {recentSessions.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setRecentMenuOpen((open) => !open)}
              className="rounded-md bg-neutral-800 hover:bg-neutral-700 px-3 py-1.5 text-sm transition-colors flex items-center gap-1.5"
            >
              <History size={14} />
              Recent
              <ChevronDown size={14} />
            </button>
            {recentMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setRecentMenuOpen(false)} />
                <div className="absolute left-0 top-full mt-1 w-72 bg-neutral-900 border border-neutral-800 rounded-md shadow-xl z-50 p-1 max-h-80 overflow-y-auto">
                  {recentSessions.map((entry) => (
                    <div key={entry.projectFilePath} className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setRecentMenuOpen(false);
                          onOpenRecentSession(entry.projectFilePath);
                        }}
                        className="flex-1 min-w-0 flex items-center justify-between gap-3 rounded px-2 py-1.5 text-sm hover:bg-neutral-800 transition-colors text-left"
                      >
                        <span className="truncate" title={entry.projectFilePath}>
                          {entry.name}
                        </span>
                        <span className="text-neutral-500 text-xs shrink-0">
                          {formatRelativeTime(entry.lastOpened)}
                        </span>
                      </button>
                      <button
                        onClick={() => onRemoveRecentSession(entry.projectFilePath)}
                        title="Remove from recent sessions"
                        className="w-6 h-6 shrink-0 flex items-center justify-center rounded text-neutral-500 hover:text-red-400 hover:bg-red-950 transition-colors"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {sessionError && (
        <div className="mb-6 px-3 py-2 rounded-md bg-red-950 border border-red-800 text-red-300 text-sm">
          {sessionError}
        </div>
      )}

      {duplicateNotice && (
        <div className="mb-6 flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-neutral-900 border border-neutral-800 text-neutral-300 text-sm">
          {duplicateNotice}
          <button
            onClick={() => setDuplicateNotice(null)}
            className="text-neutral-500 hover:text-neutral-200 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <button
        onClick={handleAddVideos}
        className="rounded-md bg-blue-600 hover:bg-blue-500 px-4 py-2 text-sm font-medium transition-colors"
      >
        Add videos…
      </button>

      {clips.length === 0 && recentSessions.length > 0 && (
        <div className="mt-10 max-w-xl">
          <h2 className="text-xs uppercase tracking-wide text-neutral-500 mb-2">Recent sessions</h2>
          <ul className="flex flex-col gap-1">
            {recentSessions.map((entry) => (
              <li key={entry.projectFilePath} className="flex items-center gap-1">
                <button
                  onClick={() => onOpenRecentSession(entry.projectFilePath)}
                  className="flex-1 min-w-0 flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm bg-neutral-900 hover:bg-neutral-800 transition-colors text-left"
                >
                  <span className="truncate" title={entry.projectFilePath}>
                    {entry.name}
                  </span>
                  <span className="text-neutral-500 text-xs shrink-0">
                    {formatRelativeTime(entry.lastOpened)}
                  </span>
                </button>
                <button
                  onClick={() => onRemoveRecentSession(entry.projectFilePath)}
                  title="Remove from recent sessions"
                  className="w-8 h-8 shrink-0 flex items-center justify-center rounded-md text-neutral-500 hover:text-red-400 hover:bg-red-950 transition-colors"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {clips.length > 0 && (
        <table className="mt-8 w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-neutral-400 border-b border-neutral-800">
              <th className="py-2 pr-4 font-medium">First frame</th>
              <th className="py-2 pr-4 font-medium">File</th>
              <th className="py-2 pr-4 font-medium">Description</th>
              <th className="py-2 pr-4 font-medium">Start time (HH:MM:SS)</th>
              <th className="py-2 pr-4 font-medium">Duration</th>
              <th className="py-2 pr-4 font-medium">Frame rate</th>
              <th className="py-2 pr-4 font-medium">Sync offset</th>
              <th className="py-2 pr-4 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {clips.map((clip) => {
              const isValid = clip.startTimeOfDay === "" || parseTimeOfDay(clip.startTimeOfDay) !== null;
              const offset = syncOffsets[clip.id];
              return (
                <tr key={clip.id} className="border-b border-neutral-900">
                  <td className="py-2 pr-4">
                    {clip.metadataError ? (
                      <div className="w-32 h-[4.5rem] rounded bg-neutral-900 flex items-center justify-center text-neutral-600 text-xs">
                        No preview
                      </div>
                    ) : (
                      <button
                        onClick={() => setZoomedClipId(clip.id)}
                        title="Click to enlarge"
                        className="block w-32 h-[4.5rem] rounded overflow-hidden hover:ring-2 hover:ring-blue-500 transition-shadow"
                      >
                        <FrameThumbnail filePath={clip.filePath} className="w-full h-full object-cover pointer-events-none" />
                      </button>
                    )}
                  </td>
                  <td className="py-2 pr-4 truncate max-w-xs" title={clip.filePath}>
                    {clip.fileName}
                  </td>
                  <td className="py-2 pr-4">
                    <input
                      value={clip.description}
                      onChange={(e) => updateDescription(clip.id, e.target.value)}
                      placeholder="e.g. Front door camera"
                      className="w-40 bg-neutral-900 rounded px-2 py-1.5 text-sm outline-none border border-neutral-800 focus:border-blue-500"
                    />
                  </td>
                  <td className="py-2 pr-4">
                    <TimeInput
                      value={clip.startTimeOfDay}
                      onChange={(value) => updateStartTime(clip.id, value)}
                      invalid={!isValid}
                    />
                  </td>
                  <td className="py-2 pr-4 text-neutral-300">
                    {clip.metadataError ? (
                      <span className="flex items-center gap-2">
                        <span className="text-red-500" title={clip.metadataError}>
                          {clip.metadataError}
                        </span>
                        <button
                          onClick={() => handleRelink(clip.id)}
                          className="rounded bg-neutral-800 hover:bg-neutral-700 px-2 py-0.5 text-xs shrink-0"
                        >
                          Relink…
                        </button>
                      </span>
                    ) : clip.durationSeconds !== null ? (
                      formatSecondsShort(clip.durationSeconds)
                    ) : (
                      <span className="text-neutral-500">Reading…</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-neutral-300">
                    {clip.metadataError
                      ? "—"
                      : clip.frameRate !== null
                        ? `${clip.frameRate.toFixed(2)} fps`
                        : ""}
                  </td>
                  <td className="py-2 pr-4 text-neutral-300">
                    {offset !== undefined ? `+${offset.toFixed(1)}s` : ""}
                  </td>
                  <td className="py-2 pr-4">
                    <button
                      onClick={() => setPendingRemoveClipId(clip.id)}
                      title="Remove from this session"
                      className="w-7 h-7 flex items-center justify-center rounded text-neutral-500 hover:text-red-400 hover:bg-red-950 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {zoomedClip && (
        <div
          onClick={() => setZoomedClipId(null)}
          className="fixed inset-0 bg-black/80 flex items-center justify-center p-8 z-50"
        >
          <div className="max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-neutral-300 truncate" title={zoomedClip.filePath}>
                {zoomedClip.fileName} — first frame
              </span>
              <button
                onClick={() => setZoomedClipId(null)}
                className="rounded-md bg-neutral-800 hover:bg-neutral-700 px-3 py-1 text-sm"
              >
                Close
              </button>
            </div>
            <FrameThumbnail filePath={zoomedClip.filePath} className="w-full rounded bg-black" />
          </div>
        </div>
      )}

      {pendingRemoveClip && (
        <ConfirmDialog
          title="Remove video?"
          message={`"${pendingRemoveClip.fileName}" will be removed from this session — any entered timestamp and sync adjustments for it will be lost. The original video file on disk is untouched.`}
          confirmLabel="Remove"
          onConfirm={handleConfirmRemoveClip}
          onCancel={() => setPendingRemoveClipId(null)}
        />
      )}
    </div>
  );
}
