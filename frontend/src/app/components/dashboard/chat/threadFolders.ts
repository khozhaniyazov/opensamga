/**
 * s33 wave 3 (E3, 2026-04-28) — thread folders FE foundation.
 *
 * Boss brief from roadmap row E3: "Thread folders so a student
 * with 80 chats can group by 'Math', 'Physics', 'College apps'
 * etc." Today the rail is a flat reverse-chrono list. By August
 * a power user has 100+ threads; by January, finding "the chemistry
 * one I asked about three weeks ago" is a needle-in-a-haystack.
 *
 * Design: zero new BE wiring. Folders are a CLIENT-SIDE
 * categorization stored in localStorage as
 *   `samga.chat.threadFolders` -> { folders: Folder[], assignments: Record<thread_id, folder_id> }
 *
 * BE column for `folder_id` is deferred behind the alembic 4-heads
 * consolidation (s34 backlog). This module owns the canonical FE
 * shape so when the BE column lands, the migration is just a
 * `localStorage → POST /threads/folders` lift-and-shift.
 *
 * Pure helpers below own the persistence + validation; the React
 * surface (a ThreadRail folder strip + a "Move to folder…" item
 * in the thread context menu) lands in s34.
 */

export const THREAD_FOLDERS_KEY = "samga.chat.threadFolders";
export const THREAD_FOLDERS_VERSION = 1;

/** Cap on user-created folders. Keeps the UI manageable AND
 *  defends against a runaway loop accidentally creating 10k. */
export const MAX_THREAD_FOLDERS = 24;

/** Cap on folder name length. Long enough for "11 кл / физика /
 *  механика" but short enough to fit a rail row at narrow widths. */
export const MAX_FOLDER_NAME_LENGTH = 40;

export interface ThreadFolder {
  /** Stable id: `f_${crypto.randomUUID()}` (or `f_${Date.now()}_${rand}`
   *  fallback). Never reused even after deletion. */
  id: string;
  /** User-supplied name, trimmed + clipped to MAX_FOLDER_NAME_LENGTH. */
  name: string;
  /** Color tag for the rail badge. Frozen palette so theme stays
   *  cohesive — see THREAD_FOLDER_COLORS below. */
  color: ThreadFolderColor;
  /** Wall-clock ms of creation. Used for stable sort fallback when
   *  two folders have the same name (rare but possible if the user
   *  deletes + recreates). */
  createdAt: number;
}

/** Frozen color palette. amber is primary brand, the rest pull from
 *  the existing chat surface chips. */
export const THREAD_FOLDER_COLORS = [
  "amber",
  "rose",
  "violet",
  "sky",
  "emerald",
  "zinc",
] as const;

export type ThreadFolderColor = (typeof THREAD_FOLDER_COLORS)[number];

/** Storage envelope. */
export interface ThreadFoldersState {
  version: number;
  folders: ThreadFolder[];
  /** Map of thread_id (string) -> folder_id (or null = unfiled). */
  assignments: Record<string, string | null>;
}

const EMPTY_STATE: ThreadFoldersState = {
  version: THREAD_FOLDERS_VERSION,
  folders: [],
  assignments: {},
};

/** Pure helper — coerce an arbitrary parsed JSON blob into a valid
 *  state. Returns the empty state on any structural mismatch. */
export function coerceThreadFoldersState(raw: unknown): ThreadFoldersState {
  if (!raw || typeof raw !== "object") return { ...EMPTY_STATE };
  const obj = raw as Partial<ThreadFoldersState> & {
    [k: string]: unknown;
  };
  if (obj.version !== THREAD_FOLDERS_VERSION) {
    // Future migration would live here. For now we bail on
    // unknown versions to avoid corrupted folders surfacing.
    return { ...EMPTY_STATE };
  }
  const foldersRaw = Array.isArray(obj.folders) ? obj.folders : [];
  const folders: ThreadFolder[] = [];
  for (const f of foldersRaw) {
    if (!f || typeof f !== "object") continue;
    const fAny = f as any;
    if (typeof fAny.id !== "string" || fAny.id.length === 0) continue;
    if (typeof fAny.name !== "string") continue;
    const name = fAny.name.trim();
    if (name.length === 0) continue;
    const colorOk = THREAD_FOLDER_COLORS.includes(fAny.color);
    const color: ThreadFolderColor = colorOk ? fAny.color : "amber";
    const createdAt =
      typeof fAny.createdAt === "number" && Number.isFinite(fAny.createdAt)
        ? fAny.createdAt
        : Date.now();
    folders.push({
      id: fAny.id,
      name: name.slice(0, MAX_FOLDER_NAME_LENGTH),
      color,
      createdAt,
    });
    if (folders.length >= MAX_THREAD_FOLDERS) break;
  }
  const assignmentsRaw =
    obj.assignments && typeof obj.assignments === "object"
      ? (obj.assignments as Record<string, unknown>)
      : {};
  const knownIds = new Set(folders.map((f) => f.id));
  const assignments: Record<string, string | null> = {};
  for (const [threadId, folderId] of Object.entries(assignmentsRaw)) {
    if (typeof threadId !== "string" || threadId.length === 0) continue;
    if (folderId == null) {
      assignments[threadId] = null;
      continue;
    }
    if (typeof folderId !== "string") continue;
    if (!knownIds.has(folderId)) continue; // drop dangling assignments
    assignments[threadId] = folderId;
  }
  return { version: THREAD_FOLDERS_VERSION, folders, assignments };
}

/** Pure helper — load state from localStorage. */
export function loadThreadFolders(): ThreadFoldersState {
  try {
    if (typeof localStorage === "undefined") return { ...EMPTY_STATE };
    const raw = localStorage.getItem(THREAD_FOLDERS_KEY);
    if (!raw) return { ...EMPTY_STATE };
    return coerceThreadFoldersState(JSON.parse(raw));
  } catch {
    return { ...EMPTY_STATE };
  }
}

/** Pure helper — persist state. Defends against quota errors. */
export function saveThreadFolders(state: ThreadFoldersState): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(THREAD_FOLDERS_KEY, JSON.stringify(state));
  } catch {
    /* quota / private-mode — silent */
  }
}

/** Pure helper — generate a new folder id. Prefers
 *  crypto.randomUUID, falls back to ms+random for older runtimes. */
export function newFolderId(): string {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof (crypto as any).randomUUID === "function"
    ) {
      return `f_${(crypto as any).randomUUID()}`;
    }
  } catch {
    /* fallthrough */
  }
  const rand = Math.random().toString(36).slice(2, 10);
  return `f_${Date.now()}_${rand}`;
}

/** Pure helper — create a folder. Returns the new state OR null
 *  if the input failed validation (empty/whitespace name OR cap hit). */
export function createFolder(args: {
  state: ThreadFoldersState;
  name: string;
  color?: ThreadFolderColor;
}): ThreadFoldersState | null {
  const { state, name, color } = args;
  const trimmed = (typeof name === "string" ? name : "").trim();
  if (trimmed.length === 0) return null;
  if (state.folders.length >= MAX_THREAD_FOLDERS) return null;
  const safeColor: ThreadFolderColor =
    color && THREAD_FOLDER_COLORS.includes(color) ? color : "amber";
  const folder: ThreadFolder = {
    id: newFolderId(),
    name: trimmed.slice(0, MAX_FOLDER_NAME_LENGTH),
    color: safeColor,
    createdAt: Date.now(),
  };
  return {
    ...state,
    folders: [...state.folders, folder],
  };
}

/** Pure helper — rename a folder. Returns the new state OR the
 *  original state unchanged if the folder is unknown / name is empty. */
export function renameFolder(args: {
  state: ThreadFoldersState;
  folderId: string;
  name: string;
}): ThreadFoldersState {
  const { state, folderId, name } = args;
  const trimmed = (typeof name === "string" ? name : "").trim();
  if (trimmed.length === 0) return state;
  let changed = false;
  const folders = state.folders.map((f) => {
    if (f.id !== folderId) return f;
    changed = true;
    return { ...f, name: trimmed.slice(0, MAX_FOLDER_NAME_LENGTH) };
  });
  if (!changed) return state;
  return { ...state, folders };
}

/** Pure helper — delete a folder. Removes the folder AND nulls out
 *  every assignment that pointed at it (so the threads become
 *  unfiled, not invisible). Returns the new state. */
export function deleteFolder(args: {
  state: ThreadFoldersState;
  folderId: string;
}): ThreadFoldersState {
  const { state, folderId } = args;
  if (!state.folders.some((f) => f.id === folderId)) return state;
  const folders = state.folders.filter((f) => f.id !== folderId);
  const assignments: Record<string, string | null> = {};
  for (const [threadId, fid] of Object.entries(state.assignments)) {
    assignments[threadId] = fid === folderId ? null : fid;
  }
  return { ...state, folders, assignments };
}

/** Pure helper — assign a thread to a folder (or unfile by passing null). */
export function assignThread(args: {
  state: ThreadFoldersState;
  threadId: string;
  folderId: string | null;
}): ThreadFoldersState {
  const { state, threadId, folderId } = args;
  if (typeof threadId !== "string" || threadId.length === 0) return state;
  if (folderId !== null && !state.folders.some((f) => f.id === folderId)) {
    // Unknown folder — refuse to assign, would create dangling
    // pointer. Return state unchanged.
    return state;
  }
  return {
    ...state,
    assignments: { ...state.assignments, [threadId]: folderId },
  };
}

/** Pure helper — get the folder a thread is in (or null). */
export function folderOfThread(
  state: ThreadFoldersState,
  threadId: string,
): ThreadFolder | null {
  const folderId = state.assignments[threadId];
  if (!folderId) return null;
  return state.folders.find((f) => f.id === folderId) ?? null;
}

/** Pure helper — count how many threads are filed in each folder
 *  AND how many are unfiled. Returns a map keyed by folder id;
 *  the empty string key holds the unfiled count. */
export function folderCounts(
  state: ThreadFoldersState,
  threadIds: readonly string[],
): Record<string, number> {
  const out: Record<string, number> = { "": 0 };
  for (const f of state.folders) out[f.id] = 0;
  for (const tid of threadIds) {
    const fid = state.assignments[tid];
    if (fid && out[fid] !== undefined) {
      out[fid] = (out[fid] ?? 0) + 1;
    } else {
      out[""] = (out[""] ?? 0) + 1;
    }
  }
  return out;
}
