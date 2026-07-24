import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ImportScreen } from "./components/ImportScreen";
import { ReviewScreen } from "./components/ReviewScreen";
import { UnsavedChangesDialog } from "./components/UnsavedChangesDialog";
import { computeRoughSyncOffsets } from "./lib/roughSync";
import { parseTimeOfDay } from "./lib/timeOfDay";
import { parseProjectSession, serializeProjectSession } from "./lib/session";
import {
  parseRecentSessionsIndex,
  recordSessionOpened,
  serializeRecentSessionsIndex,
} from "./lib/recentSessions";
import {
  defaultProjectDirectory,
  pickProjectFileToOpen,
  pickProjectSavePath,
  readProjectFile,
  readRecentSessionsIndexFile,
  videoFileExists,
  writeProjectFile,
  writeRecentSessionsIndexFile,
} from "./lib/native";
import type { Bookmark, PlaybackSnapshot, RecentSessionEntry, ViewMode, VideoClip } from "./types/project";

type Screen = "import" | "review";

const BLANK_PROJECT_NAME = "Untitled session";

// "Where you left off" for a session with nothing saved yet: the start,
// default speed, no loop, nothing zoomed.
const EMPTY_PLAYBACK_STATE: PlaybackSnapshot = {
  lastPositionSeconds: 0,
  playbackSpeed: 1,
  loopRegion: null,
  loopEnabled: false,
  zoomByClip: {},
};

function App() {
  const [clips, setClips] = useState<VideoClip[]>([]);
  const [screen, setScreen] = useState<Screen>("import");
  const [projectName, setProjectName] = useState(BLANK_PROJECT_NAME);
  const [projectFilePath, setProjectFilePath] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [recentSessions, setRecentSessions] = useState<RecentSessionEntry[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [focusedClipIds, setFocusedClipIds] = useState<string[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  // "Exactly where you left off" — position, speed, loop, zoom. Reported
  // up from ReviewScreen only when Save is clicked (see handleSave), and
  // deliberately excluded from the isDirty comparison below: playing or
  // scrubbing shouldn't make the app think you have unsaved changes to
  // nag about, the way editing a clip or a bookmark does.
  const [playbackState, setPlaybackState] = useState<PlaybackSnapshot>(EMPTY_PLAYBACK_STATE);

  // Baseline to diff the current session against, so we know when there's
  // something worth prompting to save. Reset to the current content right
  // after every successful save or load. Never includes playbackState —
  // see the comment above.
  const [savedSnapshot, setSavedSnapshot] = useState(() => serializeProjectSession(BLANK_PROJECT_NAME, []));
  const isDirty = useMemo(
    () => serializeProjectSession(projectName, clips, viewMode, focusedClipIds, bookmarks) !== savedSnapshot,
    [projectName, clips, viewMode, focusedClipIds, bookmarks, savedSnapshot],
  );

  // Generic guard for anything that would discard the current session
  // (closing the window, starting a new project, opening a different one):
  // if there are unsaved changes, ask first; otherwise just do it. The
  // action itself is stashed in a ref rather than state since we don't
  // need it to drive any rendering, only unsavedDialogOpen does.
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const [unsavedActionLabel, setUnsavedActionLabel] = useState("");
  const [unsavedSaving, setUnsavedSaving] = useState(false);
  const [unsavedError, setUnsavedError] = useState<string | null>(null);
  const pendingActionRef = useRef<() => void | Promise<void>>(() => {});

  function requestWithUnsavedCheck(actionLabel: string, action: () => void | Promise<void>) {
    if (isDirty) {
      pendingActionRef.current = action;
      setUnsavedActionLabel(actionLabel);
      setUnsavedError(null);
      setUnsavedDialogOpen(true);
    } else {
      void action();
    }
  }

  useEffect(() => {
    readRecentSessionsIndexFile().then((raw) => {
      if (raw !== null) setRecentSessions(parseRecentSessionsIndex(raw));
    });
  }, []);

  const syncOffsets = useMemo(
    () =>
      computeRoughSyncOffsets(
        clips.map((c) => ({ id: c.id, startTimeSeconds: parseTimeOfDay(c.startTimeOfDay) })),
      ),
    [clips],
  );

  const readyClipCount = clips.filter(
    (c) => parseTimeOfDay(c.startTimeOfDay) !== null && c.durationSeconds !== null && !c.metadataError,
  ).length;
  // A single clip has nothing to sync against, so its start time-of-day
  // isn't required — just valid metadata so it can actually play.
  const singleClipReady = clips.length === 1 && clips[0].durationSeconds !== null && !clips[0].metadataError;
  const canStartReview = readyClipCount >= 2 || singleClipReady;

  function rememberRecentSession(path: string, name: string) {
    const updated = recordSessionOpened(recentSessions, {
      projectFilePath: path,
      name,
      lastOpened: new Date().toISOString(),
    });
    setRecentSessions(updated);
    writeRecentSessionsIndexFile(serializeRecentSessionsIndex(updated)).catch(() => {
      // Best-effort — losing the recent-sessions index doesn't affect the
      // project file itself, so a write failure here isn't user-facing.
    });
  }

  /**
   * Returns whether the save actually completed (false = cancelled or
   * failed). `reportedPlaybackState` comes from ReviewScreen's Save button,
   * which is the only place that actually knows the current position/
   * speed/loop/zoom — omitted when saving from the Import screen, which
   * just keeps whatever was last known.
   */
  async function handleSave(reportedPlaybackState?: PlaybackSnapshot): Promise<boolean> {
    setSessionError(null);
    try {
      let path = projectFilePath;
      if (!path) {
        path = await pickProjectSavePath(projectName || "session", await defaultProjectDirectory(recentSessions));
        if (!path) return false;
      }
      const effectivePlaybackState = reportedPlaybackState ?? playbackState;
      // Deliberately two different serializations: the dirty-check baseline
      // never includes playback state (see its declaration above), but the
      // file actually written to disk does.
      const dirtyCheckSnapshot = serializeProjectSession(projectName, clips, viewMode, focusedClipIds, bookmarks);
      const fileContents = serializeProjectSession(
        projectName,
        clips,
        viewMode,
        focusedClipIds,
        bookmarks,
        effectivePlaybackState,
      );
      await writeProjectFile(path, fileContents);
      setProjectFilePath(path);
      setSavedSnapshot(dirtyCheckSnapshot);
      setPlaybackState(effectivePlaybackState);
      rememberRecentSession(path, projectName);
      return true;
    } catch (error) {
      setSessionError(`Could not save project: ${String(error)}`);
      return false;
    }
  }

  async function loadSessionFromPath(path: string) {
    setSessionError(null);

    let raw: string;
    try {
      raw = await readProjectFile(path);
    } catch (error) {
      setSessionError(`Could not read project file: ${String(error)}`);
      return;
    }

    const session = parseProjectSession(raw);
    if (!session) {
      setSessionError("This file isn't a valid DiscoSync project.");
      return;
    }

    try {
      const checkedClips = await Promise.all(
        session.clips.map(async (clip) => {
          // Older project files predate the description field.
          const withDescription = { ...clip, description: clip.description ?? "" };
          const stillExists = await videoFileExists(withDescription.filePath);
          return stillExists
            ? withDescription
            : { ...withDescription, metadataError: `File not found at ${withDescription.filePath} — relink it` };
        }),
      );

      const loadedViewMode = session.viewMode ?? "grid";
      const loadedFocusedClipIds = session.focusedClipIds ?? [];
      const loadedBookmarks = session.bookmarks ?? [];
      const loadedPlaybackState = session.playback ?? EMPTY_PLAYBACK_STATE;

      setClips(checkedClips);
      setProjectName(session.name);
      setProjectFilePath(path);
      setViewMode(loadedViewMode);
      setFocusedClipIds(loadedFocusedClipIds);
      setBookmarks(loadedBookmarks);
      setPlaybackState(loadedPlaybackState);
      setSavedSnapshot(
        serializeProjectSession(
          session.name,
          checkedClips,
          loadedViewMode,
          loadedFocusedClipIds,
          loadedBookmarks,
        ),
      );
      setScreen("import");
      rememberRecentSession(path, session.name);
    } catch (error) {
      setSessionError(`Could not finish loading the project: ${String(error)}`);
    }
  }

  function handleLoad() {
    requestWithUnsavedCheck("opening another project", async () => {
      setSessionError(null);
      try {
        const path = await pickProjectFileToOpen(await defaultProjectDirectory(recentSessions));
        if (!path) return;
        await loadSessionFromPath(path);
      } catch (error) {
        setSessionError(`Could not open the file picker: ${String(error)}`);
      }
    });
  }

  function handleOpenRecentSession(path: string) {
    requestWithUnsavedCheck("opening another project", () => loadSessionFromPath(path));
  }

  function handleRemoveRecentSession(path: string) {
    const updated = recentSessions.filter((e) => e.projectFilePath !== path);
    setRecentSessions(updated);
    writeRecentSessionsIndexFile(serializeRecentSessionsIndex(updated)).catch(() => {
      // Best-effort, same as rememberRecentSession — the index is a
      // convenience list, not the source of truth for any project.
    });
  }

  function handleNewProject() {
    requestWithUnsavedCheck("starting a new project", () => {
      setClips([]);
      setProjectName(BLANK_PROJECT_NAME);
      setProjectFilePath(null);
      setViewMode("grid");
      setFocusedClipIds([]);
      setBookmarks([]);
      setPlaybackState(EMPTY_PLAYBACK_STATE);
      setSavedSnapshot(serializeProjectSession(BLANK_PROJECT_NAME, []));
      setSessionError(null);
      setScreen("import");
    });
  }

  // Never let a failed close silently do nothing — that's how a user ends
  // up unable to quit the app at all and has to kill it from Task Manager.
  // Any destroy() failure (e.g. a missing permission) surfaces here instead.
  async function closeWindow() {
    try {
      await getCurrentWindow().destroy();
    } catch (error) {
      setUnsavedError(`Could not close the window: ${String(error)}`);
      setUnsavedActionLabel("closing");
      setUnsavedDialogOpen(true);
    }
  }

  // Intercept the window close button when there are unsaved changes.
  // Registered once; reads through a ref so it always sees current state
  // without re-subscribing to the Tauri event on every render.
  const closeHandlerRef = useRef<() => void>(() => {});
  closeHandlerRef.current = () => requestWithUnsavedCheck("closing", closeWindow);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    getCurrentWindow()
      .onCloseRequested((event) => {
        event.preventDefault();
        closeHandlerRef.current();
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  async function handleSaveAndProceed() {
    setUnsavedSaving(true);
    setUnsavedError(null);
    const saved = await handleSave();
    setUnsavedSaving(false);
    if (saved) {
      setUnsavedDialogOpen(false);
      await pendingActionRef.current();
    } else {
      setUnsavedError(sessionError ?? "Save was cancelled — changes are still unsaved.");
    }
  }

  async function handleDiscardAndProceed() {
    setUnsavedDialogOpen(false);
    await pendingActionRef.current();
  }

  function handleCancelUnsavedDialog() {
    setUnsavedDialogOpen(false);
  }

  const unsavedDialog = unsavedDialogOpen && (
    <UnsavedChangesDialog
      actionLabel={unsavedActionLabel}
      saving={unsavedSaving}
      error={unsavedError}
      onSaveAndProceed={handleSaveAndProceed}
      onDiscardAndProceed={handleDiscardAndProceed}
      onCancel={handleCancelUnsavedDialog}
    />
  );

  if (screen === "review") {
    return (
      <>
        <ReviewScreen
          clips={clips}
          setClips={setClips}
          syncOffsets={syncOffsets}
          onBack={() => setScreen("import")}
          onSave={handleSave}
          isDirty={isDirty}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          focusedClipIds={focusedClipIds}
          onFocusedClipIdsChange={setFocusedClipIds}
          bookmarks={bookmarks}
          onBookmarksChange={setBookmarks}
          initialPlaybackState={playbackState}
        />
        {unsavedDialog}
      </>
    );
  }

  return (
    <>
      <ImportScreen
        clips={clips}
        setClips={setClips}
        syncOffsets={syncOffsets}
        canStartReview={canStartReview}
        onStartReview={() => setScreen("review")}
        projectName={projectName}
        onProjectNameChange={setProjectName}
        onSave={handleSave}
        onLoad={handleLoad}
        onNewProject={handleNewProject}
        sessionError={sessionError}
        recentSessions={recentSessions}
        onOpenRecentSession={handleOpenRecentSession}
        onRemoveRecentSession={handleRemoveRecentSession}
        isDirty={isDirty}
      />
      {unsavedDialog}
    </>
  );
}

export default App;
