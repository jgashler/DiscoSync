// Feature 7 (recent sessions): a small local index — not the project files
// themselves, which live wherever the user saved them — so launch can offer
// a quick-reopen list alongside the normal Open… picker.
import type { RecentSessionEntry } from "../types/project";

const MAX_ENTRIES = 10;

export function serializeRecentSessionsIndex(entries: RecentSessionEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

export function parseRecentSessionsIndex(raw: string): RecentSessionEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data.filter(isRecentSessionEntry);
}

function isRecentSessionEntry(value: unknown): value is RecentSessionEntry {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.projectFilePath === "string" &&
    typeof e.name === "string" &&
    typeof e.lastOpened === "string"
  );
}

/**
 * Moves (or inserts) an entry to the front, deduping by file path, and caps
 * the list at MAX_ENTRIES so the index doesn't grow forever.
 */
export function recordSessionOpened(
  entries: RecentSessionEntry[],
  opened: RecentSessionEntry,
): RecentSessionEntry[] {
  const withoutDuplicate = entries.filter((e) => e.projectFilePath !== opened.projectFilePath);
  return [opened, ...withoutDuplicate].slice(0, MAX_ENTRIES);
}
