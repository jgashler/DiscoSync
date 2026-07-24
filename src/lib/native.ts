// Thin wrappers over Tauri's native dialog/fs plugins. Always use the OS
// picker for file selection — never a browser-style upload widget — and
// only ever read video files, never write/move/copy them.
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile, exists, mkdir, BaseDirectory } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { dirname, documentDir, join } from "@tauri-apps/api/path";
import type { RecentSessionEntry } from "../types/project";

const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v"];

export async function pickVideoFiles(): Promise<string[]> {
  const selected = await open({
    multiple: true,
    filters: [{ name: "Video", extensions: VIDEO_EXTENSIONS }],
  });
  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
}

/** Single-file picker used to relink a clip whose stored path no longer resolves. */
export async function pickReplacementVideoFile(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    filters: [{ name: "Video", extensions: VIDEO_EXTENSIONS }],
  });
  return typeof selected === "string" ? selected : null;
}

/**
 * Best default folder for the save/open dialogs: wherever the most
 * recently used project lives, so consecutive saves and opens land back in
 * whatever case folder is already in use rather than some fixed spot.
 * Falls back to the OS Documents folder the first time there's no recent
 * project yet.
 */
export async function defaultProjectDirectory(recentSessions: RecentSessionEntry[]): Promise<string | undefined> {
  const lastPath = recentSessions[0]?.projectFilePath;
  if (lastPath) {
    try {
      return await dirname(lastPath);
    } catch {
      // Falls through to Documents below if the stored path is malformed.
    }
  }
  try {
    return await documentDir();
  } catch {
    return undefined;
  }
}

export async function pickProjectFileToOpen(defaultDirectory?: string): Promise<string | null> {
  const selected = await open({
    multiple: false,
    defaultPath: defaultDirectory,
    filters: [{ name: "DiscoSync Project", extensions: ["dsync"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function pickProjectSavePath(defaultName: string, defaultDirectory?: string): Promise<string | null> {
  const defaultPath = defaultDirectory ? await join(defaultDirectory, `${defaultName}.dsync`) : `${defaultName}.dsync`;
  return save({
    defaultPath,
    filters: [{ name: "DiscoSync Project", extensions: ["dsync"] }],
  });
}

export async function readProjectFile(path: string): Promise<string> {
  return readTextFile(path);
}

export async function writeProjectFile(path: string, contents: string): Promise<void> {
  await writeTextFile(path, contents);
}

export async function videoFileExists(path: string): Promise<boolean> {
  return exists(path);
}

const RECENT_SESSIONS_FILE = "recent-sessions.json";

/** Reads the local recent-sessions index; missing/unreadable is treated as empty. */
export async function readRecentSessionsIndexFile(): Promise<string | null> {
  try {
    return await readTextFile(RECENT_SESSIONS_FILE, { baseDir: BaseDirectory.AppData });
  } catch {
    return null;
  }
}

export async function writeRecentSessionsIndexFile(contents: string): Promise<void> {
  // The app's $APPDATA directory isn't guaranteed to exist yet on first
  // run — writeTextFile doesn't create missing parent directories itself,
  // so without this the write throws every time and (since callers treat
  // it as best-effort) fails completely silently. mkdir with recursive
  // is a no-op if the directory's already there.
  await mkdir(".", { baseDir: BaseDirectory.AppData, recursive: true });
  await writeTextFile(RECENT_SESSIONS_FILE, contents, { baseDir: BaseDirectory.AppData });
}

/**
 * Opens (or focuses, if already open) a small standalone Help window with
 * plain-language guidance — kept separate from the main window so it can
 * stay open for reference while the user keeps working.
 */
export async function openHelpWindow(): Promise<void> {
  const existing = await WebviewWindow.getByLabel("help");
  if (existing) {
    await existing.setFocus();
    return;
  }
  new WebviewWindow("help", {
    url: "help.html",
    title: "DiscoSync Help",
    width: 480,
    height: 640,
    minWidth: 360,
    minHeight: 400,
    center: true,
  });
}

export interface VideoMetadata {
  durationSeconds: number;
  frameRate: number;
}

/**
 * Read-only probe of a video file's duration and frame rate. Rejects with a
 * message describing why on unsupported/corrupt files — callers should show
 * that to the user rather than crashing or guessing at the values.
 */
export async function probeVideoMetadata(path: string): Promise<VideoMetadata> {
  return invoke<VideoMetadata>("probe_video_metadata", { path });
}
