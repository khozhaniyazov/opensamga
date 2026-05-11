/**
 * s22 (BUG-S22-sidebar): left-rail thread list for the chat page.
 *
 * Boss brief: "less clicks, less information, less is gold". So this
 * rail is intentionally minimal — a "+ New chat" pill at the top,
 * then a flat list of threads sorted most-recent-first. Each row is
 * a single button with the title; hovering reveals a kebab with
 * Rename / Delete. No timestamps, no message-count badges, no
 * category folders. Users recognise what "Thursday's physics talk"
 * means from the title they typed.
 *
 * The rail is a peer of `max-w-3xl`-capped ChatPage content rather
 * than a global app sidebar so it only appears on /dashboard/chat
 * and doesn't compete with the existing dashboard nav.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  FileJson,
  FileText,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useLang } from "../../LanguageContext";
import { useMessages, type ChatThread } from "./MessagesContext";
import { filterThreadsBySearch } from "./threadSearch";
import {
  isThreadPinned,
  loadPinnedIds,
  savePinnedIds,
  sortThreadsWithPinned,
  togglePinnedId,
} from "./threadPinStorage";
import {
  assignThread,
  folderCounts,
  loadThreadFolders,
  saveThreadFolders,
  type ThreadFoldersState,
} from "./threadFolders";
import { ThreadFolderStrip } from "./ThreadFolderStrip";
import {
  threadFolderMoveAriaLabel,
  threadFolderMoveGroupAriaLabel,
  threadFolderMoveRowText,
} from "./threadFolderMoveAria";
import { Folder, FolderInput, FolderMinus } from "lucide-react";
import {
  MOBILE_SHEET_BACKDROP_OPACITY,
  MOBILE_SHEET_MAX_HEIGHT_VH,
} from "./mobileSheet";
import { useViewportMobile } from "./useViewportMobile";
import { TAP_TARGET_ROW_CLASS, TAP_TARGET_SQUARE_CLASS } from "./tapTarget";
import {
  THREAD_EXPORT_JSON_MIME,
  THREAD_EXPORT_MARKDOWN_MIME,
  buildExportFilename,
  formatThreadAsJson,
  formatThreadAsMarkdown,
  triggerThreadDownload,
} from "./threadExport";
import {
  isThreadManuallyArchived,
  loadArchivedIds,
  loadShowArchived,
  partitionThreadsByArchived,
  saveArchivedIds,
  saveShowArchived,
  toggleArchivedId,
} from "./threadArchiveStorage";
import { apiGet } from "../../../lib/api";
import type { ChatHistoryResponse, Message } from "./types";
import { stripReasoningBlocks } from "./utils";
import { threadRowAriaLabel } from "./threadRowAriaLabel";
import { threadRailKebabAriaLabel } from "./threadRailKebabAriaLabel";
import { threadRailMenuItemAriaLabel } from "./threadRailMenuItemAria";
import { threadSearchAnnouncement } from "./threadSearchAnnouncement";

interface ThreadRailProps {
  /** Controlled open state so ChatPage can collapse the rail on
   *  narrow viewports. Parent manages toggling. */
  open: boolean;
  /** Close handler (mobile drawer). */
  onClose: () => void;
}

export function ThreadRail({ open, onClose }: ThreadRailProps) {
  const { t, lang } = useLang();
  const {
    threads,
    activeThreadId,
    setActiveThreadId,
    createThread,
    renameThread,
    deleteThread,
  } = useMessages();

  // s31 wave 2 (E1, 2026-04-27): client-side search over threads.
  // Substring + diacritic-insensitive match on the title. Empty
  // query is a pass-through, so the input is invisible-to-behaviour
  // when blank. The threshold for "show search input at all" is
  // > 5 threads — fewer rows are easier to scan than to type for.
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // s32 (E2): pinned-on-top via localStorage. We hydrate once on
  // mount; mutations go through `togglePin` below which writes
  // through to storage and updates state in a single shot.
  const [pinnedIds, setPinnedIds] = useState<number[]>([]);
  useEffect(() => {
    setPinnedIds(loadPinnedIds());
  }, []);
  const togglePin = useCallback((threadId: number | null) => {
    if (threadId === null) return; // legacy bucket: not pinnable
    setPinnedIds((prev) => {
      const next = togglePinnedId(prev, threadId);
      savePinnedIds(next);
      return next;
    });
  }, []);

  // s34 wave 10 (E5, 2026-04-28): client-side auto-archive. We
  // hydrate two pieces of localStorage state on mount:
  //   - archivedIds: explicit user-archived thread ids
  //   - showArchived: whether to surface the archived section
  // Mutations write through to storage in a single shot so a
  // refresh keeps the toggle state.
  const [archivedIds, setArchivedIds] = useState<number[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  useEffect(() => {
    setArchivedIds(loadArchivedIds());
    setShowArchived(loadShowArchived());
  }, []);
  const toggleArchive = useCallback((threadId: number | null) => {
    if (threadId === null) return; // legacy bucket: not archivable
    setArchivedIds((prev) => {
      const next = toggleArchivedId(prev, threadId);
      saveArchivedIds(next);
      return next;
    });
  }, []);
  const toggleShowArchived = useCallback(() => {
    setShowArchived((prev) => {
      const next = !prev;
      saveShowArchived(next);
      return next;
    });
  }, []);

  // s34 wave 1 (E3 wave 2, 2026-04-28): folder filter on top of
  // search + pin sort. activeFolderId === null means "all";
  // activeFolderId === "" means "unfiled"; any other string is a
  // real folder id. State is kept here so the strip stays a pure
  // controlled component.
  const [foldersState, setFoldersState] = useState<ThreadFoldersState>(() =>
    loadThreadFolders(),
  );
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);

  // s35 wave 41 (E3 close-out, 2026-04-28): row-level move-to-folder
  // callback. Writes through to localStorage immediately. The
  // ThreadFolderStrip already calls saveThreadFolders on its own
  // mutations; we mirror that contract here so the strip badge
  // counts refresh on next render. assignThread is idempotent
  // against unknown folder ids (returns state unchanged) — the
  // submenu UI guards against that anyway.
  const moveThreadToFolder = useCallback(
    (threadId: number | null, folderId: string | null) => {
      const tidKey = threadId === null ? "legacy" : String(threadId);
      setFoldersState((prev) => {
        const next = assignThread({
          state: prev,
          threadId: tidKey,
          folderId,
        });
        if (next !== prev) saveThreadFolders(next);
        return next;
      });
    },
    [],
  );

  // Order: pinned threads first (in pin order), then the recency-sorted
  // tail from MessagesContext. Search filtering runs OVER the
  // already-pinned-sorted list so the user's pin set is preserved
  // while filtering.
  const orderedThreads = useMemo(
    () => sortThreadsWithPinned(threads, pinnedIds),
    [threads, pinnedIds],
  );
  const folderFilteredThreads = useMemo(() => {
    if (activeFolderId === null) return orderedThreads;
    return orderedThreads.filter((t) => {
      const tid = t.id === null ? "legacy" : String(t.id);
      const assigned = foldersState.assignments[tid] ?? null;
      if (activeFolderId === "") {
        // "Unfiled" bucket — assigned must be null/undefined OR
        // pointing at a folder we no longer have (defensive).
        if (!assigned) return true;
        return !foldersState.folders.some((f) => f.id === assigned);
      }
      return assigned === activeFolderId;
    });
  }, [orderedThreads, activeFolderId, foldersState]);
  const filteredThreads = useMemo(
    () => filterThreadsBySearch(folderFilteredThreads, searchQuery),
    [folderFilteredThreads, searchQuery],
  );

  // Compute folder counts off the FULL thread list (not the
  // filtered one) so chips reflect global truth.
  const counts = useMemo(() => {
    const ids = orderedThreads.map((t) =>
      t.id === null ? "legacy" : String(t.id),
    );
    return folderCounts(foldersState, ids);
  }, [orderedThreads, foldersState]);
  const showSearch = threads.length > 5;
  const isFiltering = searchQuery.trim().length > 0;

  // s34 wave 10 (E5): split the post-filter list into active vs
  // archived. Archived rows only render under the "Show archived"
  // toggle. While the user is mid-search we surface archived hits
  // inline so they can find them — burying them under a hidden
  // toggle would defeat the search.
  const { active: activeThreadList, archived: archivedThreadList } = useMemo(
    () => partitionThreadsByArchived(filteredThreads, archivedIds),
    [filteredThreads, archivedIds],
  );
  const renderArchived = isFiltering || showArchived;

  // s34 wave 2 (G1, 2026-04-28): below 768px, the rail renders as a
  // bottom-sheet overlay (slides up from the bottom of the viewport,
  // dimmed backdrop behind, doesn't push the chat column off-screen).
  // At >=768px it's the same inline aside as before. We read the
  // boolean from a matchMedia hook so device-rotation flips the
  // layout without a re-mount.
  const isMobile = useViewportMobile();

  if (!open) return null;

  const closeIfNarrow = () => {
    try {
      if (!window.matchMedia("(min-width: 768px)").matches) onClose();
    } catch {
      onClose();
    }
  };

  // Shared rail body — the New Chat button, folder strip, search,
  // and thread list. Rendered identically inside the inline aside
  // (>=md) and inside the bottom-sheet wrapper (<md). Extracted to a
  // local function rather than a sub-component so closures over
  // hooks above stay simple (folders state, pin state, etc.).
  const railBody = (
    <>
      <div className="border-b border-zinc-200/80 px-3 pb-3 pt-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <p
            className="text-zinc-700"
            style={{
              fontSize: 11,
              fontWeight: 680,
              letterSpacing: 0,
              textTransform: "uppercase",
            }}
          >
            {t("chat.title")}
          </p>
          {/* s34 wave 2 (G1): close button must be visible on every
              viewport that renders the sheet (<768px), not just the
              old `sm:hidden` (<640px) — otherwise 640-767px users get
              a sheet with no close affordance. */}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 md:hidden"
            aria-label={t("chat.threads.closeRail")}
            title={t("chat.threads.closeRail")}
          >
            <X size={14} />
          </button>
        </div>
        <button
          type="button"
          onClick={async () => {
            try {
              await createThread(null);
              closeIfNarrow();
            } catch {
              /* toast handled elsewhere */
            }
          }}
          className="flex min-h-[42px] w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 transition-colors hover:border-zinc-300 hover:bg-zinc-100 samga-anim-tap-ripple"
          aria-label={t("chat.threads.newChat")}
        >
          <Plus size={14} />
          <span>{t("chat.threads.newChat")}</span>
        </button>
      </div>

      {/* s34 wave 1 (E3 wave 2, 2026-04-28): folder strip sits
          between the New Chat button and the search field. Renders
          a single dashed-outline "Папки" chip when the user has
          no folders yet, expands into the full multi-chip rail
          once they create the first one. */}
      <ThreadFolderStrip
        activeFolderId={activeFolderId}
        onSelect={setActiveFolderId}
        onStateChange={setFoldersState}
        counts={counts}
      />

      {showSearch && (
        // s31 (E1): search box only appears once the user has more
        // than 5 threads — under that threshold the linear list is
        // easier to scan than to type for.
        <div className="border-b border-zinc-200/60 px-3 pb-3 pt-2">
          <div className="relative">
            <Search
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
              aria-hidden
            />
            <input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("chat.threads.searchPlaceholder") || "Поиск..."}
              aria-label={t("chat.threads.searchLabel") || "Поиск по чатам"}
              className="w-full rounded-md border border-zinc-200 bg-white py-1.5 pl-7 pr-7 text-[12.5px] text-zinc-900 placeholder-zinc-400 transition-colors focus:border-zinc-300 focus:outline-none focus:ring-2 focus:ring-amber-100/60"
              onKeyDown={(e) => {
                if (e.key === "Escape" && searchQuery) {
                  e.preventDefault();
                  setSearchQuery("");
                }
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  searchInputRef.current?.focus();
                }}
                aria-label={t("chat.threads.searchClear") || "Очистить поиск"}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-5 w-5 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
              >
                <X size={11} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* s35 wave 21a (2026-04-28): SR-only live-region announcing
          the post-filter result count. Empty when the user isn't
          actively filtering (suppressed via the helper). The
          visible empty-state paragraph below stays put for sighted
          users; this cell is exclusively for AT users so they hear
          "12 чатов найдено" / "Ничего не найдено" without tabbing
          through the remaining rows. */}
      <span role="status" aria-live="polite" className="sr-only">
        {threadSearchAnnouncement({
          count: filteredThreads.length,
          query: searchQuery,
          lang: lang === "kz" ? "kz" : "ru",
        })}
      </span>
      <nav
        className="flex-1 overflow-y-auto px-2.5 py-3"
        aria-label="Chat thread list"
      >
        {threads.length === 0 ? (
          <p className="px-3 py-4 text-xs text-zinc-700">
            {t("chat.threads.empty")}
          </p>
        ) : isFiltering && filteredThreads.length === 0 ? (
          <p className="px-3 py-4 text-xs text-zinc-700">
            {t("chat.threads.searchEmpty") || "Ничего не найдено"}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {activeThreadList.map((thread) => (
              <ThreadRow
                key={thread.id === null ? "legacy" : thread.id}
                thread={thread}
                active={activeThreadId === thread.id}
                pinned={isThreadPinned(pinnedIds, thread.id)}
                archived={isThreadManuallyArchived(archivedIds, thread.id)}
                folders={foldersState.folders}
                currentFolderId={
                  foldersState.assignments[
                    thread.id === null ? "legacy" : String(thread.id)
                  ] ?? null
                }
                onMoveToFolder={(fid) => moveThreadToFolder(thread.id, fid)}
                onSelect={() => {
                  setActiveThreadId(thread.id);
                  closeIfNarrow();
                }}
                onRename={async (title) => {
                  if (thread.id === null) return; // legacy bucket: no rename
                  await renameThread(thread.id, title);
                }}
                onDelete={async () => {
                  if (thread.id === null) return;
                  const ok = window.confirm(t("chat.threads.deleteConfirm"));
                  if (!ok) return;
                  await deleteThread(thread.id);
                }}
                onTogglePin={() => togglePin(thread.id)}
                onToggleArchive={() => toggleArchive(thread.id)}
                onExport={async (format) => {
                  // s34 wave 6 (E4, 2026-04-28): per-thread export.
                  // Fetch fresh history for the thread (the user
                  // may export a thread that isn't currently
                  // active) and pipe it through the pure
                  // formatters in threadExport.ts. Errors swallow
                  // silently — boss policy is "no error toasts in
                  // the rail", so on a network blip the user just
                  // sees no download.
                  try {
                    const path =
                      thread.id === null
                        ? "/chat/history?thread_id=0"
                        : `/chat/history?thread_id=${thread.id}`;
                    const history = await apiGet<ChatHistoryResponse>(path);
                    const messages: Message[] = (history.messages || [])
                      .filter(
                        (m) => m.role === "user" || m.role === "assistant",
                      )
                      .map((m, idx) => ({
                        id: `export-${idx}`,
                        role: m.role as "user" | "assistant",
                        text:
                          m.role === "assistant"
                            ? stripReasoningBlocks(m.content || "")
                            : m.content || "",
                      }));
                    const filename = buildExportFilename(thread, format);
                    if (format === "markdown") {
                      triggerThreadDownload(
                        filename,
                        THREAD_EXPORT_MARKDOWN_MIME,
                        formatThreadAsMarkdown(thread, messages),
                      );
                    } else {
                      triggerThreadDownload(
                        filename,
                        THREAD_EXPORT_JSON_MIME,
                        formatThreadAsJson(thread, messages),
                      );
                    }
                  } catch {
                    /* swallow — see comment above */
                  }
                }}
              />
            ))}
          </ul>
        )}
        {/* s34 wave 10 (E5, 2026-04-28): archived section. Toggle
            sits below the active list. Hidden when there's nothing
            to reveal so a fresh user never sees a hollow control. */}
        {(archivedThreadList.length > 0 || showArchived) && (
          <div className="mt-3 border-t border-zinc-200/60 pt-3">
            <button
              type="button"
              onClick={toggleShowArchived}
              className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-600 transition-colors hover:bg-white hover:text-zinc-900`}
              aria-expanded={renderArchived}
            >
              <span className="inline-flex items-center gap-1.5">
                <Archive size={12} aria-hidden />
                {t("chat.threads.archivedHeading")}
              </span>
              <span className="text-[10.5px] text-zinc-500">
                {archivedThreadList.length}
              </span>
            </button>
            {renderArchived && archivedThreadList.length > 0 && (
              <ul className="mt-1 space-y-0.5 opacity-80">
                {archivedThreadList.map((thread) => (
                  <ThreadRow
                    key={thread.id === null ? "legacy" : thread.id}
                    thread={thread}
                    active={activeThreadId === thread.id}
                    pinned={isThreadPinned(pinnedIds, thread.id)}
                    archived={isThreadManuallyArchived(archivedIds, thread.id)}
                    folders={foldersState.folders}
                    currentFolderId={
                      foldersState.assignments[
                        thread.id === null ? "legacy" : String(thread.id)
                      ] ?? null
                    }
                    onMoveToFolder={(fid) => moveThreadToFolder(thread.id, fid)}
                    onSelect={() => {
                      setActiveThreadId(thread.id);
                      closeIfNarrow();
                    }}
                    onRename={async (title) => {
                      if (thread.id === null) return;
                      await renameThread(thread.id, title);
                    }}
                    onDelete={async () => {
                      if (thread.id === null) return;
                      const ok = window.confirm(
                        t("chat.threads.deleteConfirm"),
                      );
                      if (!ok) return;
                      await deleteThread(thread.id);
                    }}
                    onTogglePin={() => togglePin(thread.id)}
                    onToggleArchive={() => toggleArchive(thread.id)}
                    onExport={async (format) => {
                      try {
                        const path =
                          thread.id === null
                            ? "/chat/history?thread_id=0"
                            : `/chat/history?thread_id=${thread.id}`;
                        const history = await apiGet<ChatHistoryResponse>(path);
                        const messages: Message[] = (history.messages || [])
                          .filter(
                            (m) => m.role === "user" || m.role === "assistant",
                          )
                          .map((m, idx) => ({
                            id: `export-${idx}`,
                            role: m.role as "user" | "assistant",
                            text:
                              m.role === "assistant"
                                ? stripReasoningBlocks(m.content || "")
                                : m.content || "",
                          }));
                        const filename = buildExportFilename(thread, format);
                        if (format === "markdown") {
                          triggerThreadDownload(
                            filename,
                            THREAD_EXPORT_MARKDOWN_MIME,
                            formatThreadAsMarkdown(thread, messages),
                          );
                        } else {
                          triggerThreadDownload(
                            filename,
                            THREAD_EXPORT_JSON_MIME,
                            formatThreadAsJson(thread, messages),
                          );
                        }
                      } catch {
                        /* swallow */
                      }
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </nav>
    </>
  );

  if (isMobile) {
    return (
      <>
        <div
          // Backdrop scrim: tap to dismiss. role="presentation" so
          // SR users skip it (the close button inside the sheet is
          // the canonical close affordance).
          role="presentation"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black transition-opacity duration-200 samga-anim-modal-scrim samga-anim-scrim-blur"
          style={{ opacity: MOBILE_SHEET_BACKDROP_OPACITY }}
          data-testid="threadrail-sheet-backdrop"
        />
        <aside
          className="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl border-t border-zinc-200 bg-zinc-50 shadow-[0_-12px_32px_-8px_rgba(24,24,27,0.18)]"
          style={{ maxHeight: `${MOBILE_SHEET_MAX_HEIGHT_VH}dvh` }}
          aria-label="Chat threads"
          aria-modal="true"
          role="dialog"
        >
          {/* Drag-handle visual affordance (top of sheet) — signals
              the user the surface is dismissible. Not wired to a
              gesture lib in this wave. */}
          <div className="flex justify-center pt-2 pb-1">
            <span
              aria-hidden
              className="block h-1 w-9 rounded-full bg-zinc-300"
            />
          </div>
          {railBody}
        </aside>
      </>
    );
  }

  return (
    <aside
      className="flex h-full w-full flex-shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 sm:w-72"
      aria-label="Chat threads"
    >
      {railBody}
    </aside>
  );
}

interface ThreadRowProps {
  thread: ChatThread;
  active: boolean;
  pinned: boolean;
  /** s34 wave 10 (E5, 2026-04-28): true when the user has manually
   *  archived this thread. Auto-archived-by-age threads also surface
   *  in the archived section but do NOT flip this flag — the menu
   *  copy reads "Archive" for them, "Restore" only after manual
   *  archive (matches Gmail's behaviour). */
  archived: boolean;
  /** s35 wave 41 (E3 close-out, 2026-04-28): user-defined folders.
   *  Empty array hides the "Move to folder" submenu entirely so
   *  fresh users don't see a hollow control. */
  folders: ReadonlyArray<{ id: string; name: string }>;
  /** Currently-assigned folder id for this thread, or null when
   *  unfiled. Used to mark the active row in the submenu. */
  currentFolderId: string | null;
  /** Move-to-folder callback. `null` ⇒ unfile. */
  onMoveToFolder: (folderId: string | null) => void;
  onSelect: () => void;
  onRename: (title: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onTogglePin: () => void;
  /** s34 wave 10 (E5): toggles manual archive. The legacy bucket is
   *  not archivable; the parent guards on threadId === null. */
  onToggleArchive: () => void;
  /** s34 wave 6 (E4, 2026-04-28): per-thread export. The row only
   *  knows the thread metadata; fetching messages + writing the
   *  blob lives at the parent so the row stays presentational. */
  onExport: (format: "markdown" | "json") => Promise<void>;
}

function ThreadRow({
  thread,
  active,
  pinned,
  archived,
  folders,
  currentFolderId,
  onMoveToFolder,
  onSelect,
  onRename,
  onDelete,
  onTogglePin,
  onToggleArchive,
  onExport,
}: ThreadRowProps) {
  const { t, lang } = useLang();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(thread.title || "");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close the menu on outside-click. Rare enough not to warrant a
  // portal; a single document listener is fine.
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const label = thread.isLegacy
    ? t("chat.threads.mainChat")
    : thread.title?.trim() || t("chat.threads.untitled");

  return (
    <li>
      <div
        ref={wrapRef}
        className={`group relative flex items-center gap-1 rounded-lg border px-1.5 transition-colors ${
          active
            ? "border-zinc-300 bg-white"
            : "border-transparent hover:bg-white"
        }`}
      >
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={async () => {
              setEditing(false);
              if (draft !== (thread.title || "")) {
                try {
                  await onRename(draft.trim());
                } catch {
                  /* swallow */
                }
              }
            }}
            onKeyDown={async (e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              } else if (e.key === "Escape") {
                setDraft(thread.title || "");
                setEditing(false);
              }
            }}
            className="flex-1 px-2 py-1.5 text-sm bg-white border border-zinc-200 rounded outline-none focus:border-zinc-400"
          />
        ) : (
          <button
            type="button"
            onClick={onSelect}
            className={`flex min-h-[40px] flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm truncate samga-anim-thread-row ${
              active ? "text-zinc-950" : "text-zinc-600 hover:text-zinc-900"
            }`}
            title={label}
            // s35 wave 15b: per-row aria-label so SR users can
            // distinguish rows without tabbing into each one. Built
            // from the resolved label + message_count + relative
            // updated_at + pinned/archived suffixes via the pure
            // helper. The legacy bucket's title resolves to "Основной
            // чат"; its `updated_at` is null so the label simply
            // reads the title alone, which is the right behaviour.
            aria-label={threadRowAriaLabel({
              title: label,
              messageCount: thread.message_count,
              updatedAt: thread.updated_at,
              pinned,
              archived,
              lang: lang === "kz" ? "kz" : "ru",
            })}
          >
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${active ? "bg-zinc-950 text-white" : "bg-zinc-100 text-zinc-600"}`}
            >
              <MessageSquare size={12} />
            </span>
            <span className="truncate">{label}</span>
            {pinned && !thread.isLegacy && (
              <Pin
                size={11}
                className="ml-auto shrink-0 text-amber-500"
                aria-label={t("chat.threads.pinned") || "Закреплено"}
              />
            )}
          </button>
        )}

        {!editing && !thread.isLegacy && (
          <>
            {/* s34 wave 3 (G5 wave 2): kebab button bumped from
                `p-1` (≈24x24) to TAP_TARGET_SQUARE so it satisfies
                AAA on touch devices. We keep the opacity-0 +
                group-hover:opacity-100 reveal so on desktop hover
                the visual remains a small kebab — but the hit area
                is always 44x44 to avoid the bug where a touch user
                "misses" the button when it's still partly invisible. */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              className={`inline-flex items-center justify-center ${TAP_TARGET_SQUARE_CLASS} rounded-lg text-zinc-600 opacity-0 transition-opacity hover:bg-white hover:text-zinc-900 focus:opacity-100 group-hover:opacity-100 samga-anim-actions-reveal-target`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              // s35 wave 18b (2026-04-28): per-row contextual kebab
              // aria-label so SR users hear which thread the menu
              // operates on. Mirrors wave 15b's row-level aria
              // approach.
              aria-label={threadRailKebabAriaLabel({
                title: label,
                lang: lang === "kz" ? "kz" : "ru",
              })}
            >
              <MoreHorizontal size={14} />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-1 top-9 z-20 w-44 rounded-md border border-zinc-200 bg-white py-1 shadow-md"
              >
                {/* s34 wave 3 (G5 wave 2): each menu row now has a
                    `min-h-[44px]` floor. Padding stays the same so
                    the visual rhythm is unchanged on desktop —
                    only the hit area enlarges. */}
                <button
                  role="menuitem"
                  onClick={() => {
                    onTogglePin();
                    setMenuOpen(false);
                  }}
                  // s35 wave 32a (2026-04-28): per-action aria-label
                  // adds the thread title context + (where relevant)
                  // the consequence cue. Visible label text unchanged.
                  aria-label={threadRailMenuItemAriaLabel({
                    action: pinned ? "unpin" : "pin",
                    title: label,
                    lang: lang === "kz" ? "kz" : "ru",
                  })}
                  className={`flex items-center gap-2 w-full ${TAP_TARGET_ROW_CLASS} px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50`}
                >
                  {pinned ? <PinOff size={12} /> : <Pin size={12} />}
                  {pinned
                    ? t("chat.threads.unpin") || "Открепить"
                    : t("chat.threads.pin") || "Закрепить"}
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setDraft(thread.title || "");
                    setEditing(true);
                    setMenuOpen(false);
                  }}
                  aria-label={threadRailMenuItemAriaLabel({
                    action: "rename",
                    title: label,
                    lang: lang === "kz" ? "kz" : "ru",
                  })}
                  className={`flex items-center gap-2 w-full ${TAP_TARGET_ROW_CLASS} px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50`}
                >
                  <Pencil size={12} />
                  {t("chat.threads.rename")}
                </button>
                {/* s34 wave 10 (E5, 2026-04-28): archive / restore.
                    Manual archive is sticky; auto-archive-by-age
                    flips the row into the archived section based on
                    updated_at. The action label here only reflects
                    the manual-archive state so users understand
                    that "Restore" undoes their explicit click. */}
                <button
                  role="menuitem"
                  onClick={() => {
                    onToggleArchive();
                    setMenuOpen(false);
                  }}
                  aria-label={threadRailMenuItemAriaLabel({
                    action: archived ? "restore" : "archive",
                    title: label,
                    lang: lang === "kz" ? "kz" : "ru",
                  })}
                  className={`flex items-center gap-2 w-full ${TAP_TARGET_ROW_CLASS} px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50`}
                >
                  {archived ? (
                    <ArchiveRestore size={12} />
                  ) : (
                    <Archive size={12} />
                  )}
                  {archived
                    ? t("chat.threads.restore")
                    : t("chat.threads.archive")}
                </button>
                {/* s34 wave 6 (E4, 2026-04-28): two export rows.
                    Markdown for human-readable share-with-tutor flows;
                    JSON for the technical "I want to import this
                    elsewhere" power user. Both close the menu and
                    fire-and-forget — errors swallow at the parent. */}
                <button
                  role="menuitem"
                  onClick={async () => {
                    setMenuOpen(false);
                    await onExport("markdown");
                  }}
                  aria-label={threadRailMenuItemAriaLabel({
                    action: "export-markdown",
                    title: label,
                    lang: lang === "kz" ? "kz" : "ru",
                  })}
                  className={`flex items-center gap-2 w-full ${TAP_TARGET_ROW_CLASS} px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50`}
                >
                  <FileText size={12} />
                  {t("chat.threads.exportMarkdown")}
                </button>
                <button
                  role="menuitem"
                  onClick={async () => {
                    setMenuOpen(false);
                    await onExport("json");
                  }}
                  aria-label={threadRailMenuItemAriaLabel({
                    action: "export-json",
                    title: label,
                    lang: lang === "kz" ? "kz" : "ru",
                  })}
                  className={`flex items-center gap-2 w-full ${TAP_TARGET_ROW_CLASS} px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50`}
                >
                  <FileJson size={12} />
                  {t("chat.threads.exportJson")}
                </button>
                {/* s35 wave 41 (E3 close-out, 2026-04-28):
                    move-to-folder submenu. Hidden when the user has
                    no folders so fresh users don't see hollow controls.
                    Renders one row per folder + a final "Без папки"
                    row when the thread is currently filed (so unfile
                    is reachable). The active folder is rendered
                    disabled with a check-style indicator and its
                    aria-label flips to the "уже в папке X" cue. */}
                {folders.length > 0 && (
                  <div
                    role="group"
                    aria-label={threadFolderMoveGroupAriaLabel(
                      lang === "kz" ? "kz" : "ru",
                    )}
                    className="border-t border-zinc-100 pt-1 mt-1"
                  >
                    <p
                      className="px-3 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-zinc-500"
                      aria-hidden
                    >
                      {lang === "kz"
                        ? "Папкаға жылжыту"
                        : "Переместить в папку"}
                    </p>
                    {folders.map((f) => {
                      const isCurrent = currentFolderId === f.id;
                      return (
                        <button
                          key={f.id}
                          role="menuitem"
                          disabled={isCurrent}
                          onClick={() => {
                            if (isCurrent) return;
                            onMoveToFolder(f.id);
                            setMenuOpen(false);
                          }}
                          aria-label={threadFolderMoveAriaLabel({
                            threadTitle: label,
                            folderName: f.name,
                            isCurrent,
                            lang: lang === "kz" ? "kz" : "ru",
                          })}
                          className={`flex items-center gap-2 w-full ${TAP_TARGET_ROW_CLASS} px-3 py-2 text-left text-sm ${
                            isCurrent
                              ? "text-amber-600 cursor-default"
                              : "text-zinc-700 hover:bg-zinc-50"
                          }`}
                        >
                          {isCurrent ? (
                            <Folder size={12} />
                          ) : (
                            <FolderInput size={12} />
                          )}
                          {threadFolderMoveRowText(
                            f.name,
                            lang === "kz" ? "kz" : "ru",
                          )}
                        </button>
                      );
                    })}
                    {currentFolderId !== null && (
                      <button
                        role="menuitem"
                        onClick={() => {
                          onMoveToFolder(null);
                          setMenuOpen(false);
                        }}
                        aria-label={threadFolderMoveAriaLabel({
                          threadTitle: label,
                          folderName: null,
                          isCurrent: false,
                          lang: lang === "kz" ? "kz" : "ru",
                        })}
                        className={`flex items-center gap-2 w-full ${TAP_TARGET_ROW_CLASS} px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50`}
                      >
                        <FolderMinus size={12} />
                        {threadFolderMoveRowText(
                          "",
                          lang === "kz" ? "kz" : "ru",
                        )}
                      </button>
                    )}
                  </div>
                )}
                <button
                  role="menuitem"
                  onClick={async () => {
                    setMenuOpen(false);
                    await onDelete();
                  }}
                  aria-label={threadRailMenuItemAriaLabel({
                    action: "delete",
                    title: label,
                    lang: lang === "kz" ? "kz" : "ru",
                  })}
                  className={`flex items-center gap-2 w-full ${TAP_TARGET_ROW_CLASS} px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50`}
                >
                  <Trash2 size={12} />
                  {t("chat.threads.delete")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </li>
  );
}
