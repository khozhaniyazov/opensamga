/**
 * s34 wave 1 (E3 wave 2, 2026-04-28) — ThreadRail folder strip.
 *
 * Renders the user's folders as a horizontal chip rail at the top
 * of ThreadRail. Tap a chip to filter the thread list; tap "All"
 * to clear. A trailing "+" chip opens an inline create-folder input.
 *
 * State + persistence live in `threadFolders.ts` (s33 wave 3,
 * caf6b87). This file is the React surface — entirely additive,
 * NO behaviour change when the user has zero folders (the strip
 * doesn't render until the first folder is created).
 */

import { useEffect, useRef, useState } from "react";
import { Plus, Tag, X } from "lucide-react";
import { useLang } from "../../LanguageContext";
import {
  MAX_FOLDER_NAME_LENGTH,
  THREAD_FOLDER_COLORS,
  createFolder,
  deleteFolder,
  loadThreadFolders,
  saveThreadFolders,
  type ThreadFolderColor,
  type ThreadFoldersState,
} from "./threadFolders";

interface Props {
  /** Currently-selected folder id (or null for "All"). Controlled. */
  activeFolderId: string | null;
  onSelect: (folderId: string | null) => void;
  /** Called whenever the persisted state changes — lets ThreadRail
   *  refresh its own copy for the row-level Move-to-folder submenu. */
  onStateChange?: (state: ThreadFoldersState) => void;
  /** Per-folder thread count (keyed by folder id; '' is unfiled). */
  counts?: Record<string, number>;
}

/** Tailwind color recipes per palette entry. */
const COLOR_CLASSES: Record<
  ThreadFolderColor,
  { active: string; idle: string }
> = {
  amber: {
    active: "border-amber-300 bg-amber-100 text-amber-800",
    idle: "border-amber-200/60 bg-amber-50/60 text-amber-700 hover:bg-amber-100/80",
  },
  rose: {
    active: "border-rose-300 bg-rose-100 text-rose-800",
    idle: "border-rose-200/60 bg-rose-50/60 text-rose-700 hover:bg-rose-100/80",
  },
  violet: {
    active: "border-violet-300 bg-violet-100 text-violet-800",
    idle: "border-violet-200/60 bg-violet-50/60 text-violet-700 hover:bg-violet-100/80",
  },
  sky: {
    active: "border-sky-300 bg-sky-100 text-sky-800",
    idle: "border-sky-200/60 bg-sky-50/60 text-sky-700 hover:bg-sky-100/80",
  },
  emerald: {
    active: "border-emerald-300 bg-emerald-100 text-emerald-800",
    idle: "border-emerald-200/60 bg-emerald-50/60 text-emerald-700 hover:bg-emerald-100/80",
  },
  zinc: {
    active: "border-zinc-300 bg-zinc-100 text-zinc-900",
    idle: "border-zinc-200/60 bg-zinc-50/60 text-zinc-700 hover:bg-zinc-100/80",
  },
};

export function ThreadFolderStrip({
  activeFolderId,
  onSelect,
  onStateChange,
  counts,
}: Props) {
  const { lang } = useLang();
  const langSafe = (lang === "kz" ? "kz" : "ru") as "ru" | "kz";

  const [state, setState] = useState<ThreadFoldersState>(() =>
    loadThreadFolders(),
  );
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  const persist = (next: ThreadFoldersState) => {
    setState(next);
    saveThreadFolders(next);
    onStateChange?.(next);
  };

  const handleCreate = (rawName: string) => {
    const next = createFolder({
      state,
      name: rawName,
      color: pickRotatingColor(state.folders.length),
    });
    if (!next) {
      setDraft("");
      setCreating(false);
      return;
    }
    persist(next);
    setDraft("");
    setCreating(false);
    // Auto-select the new folder so the user immediately sees an
    // empty filter (and can drag threads in next).
    const newId = next.folders[next.folders.length - 1]?.id ?? null;
    if (newId) onSelect(newId);
  };

  const handleDelete = (folderId: string) => {
    const ok = window.confirm(
      langSafe === "kz"
        ? "Папканы жою керек пе? Чаттар жоғалмайды."
        : "Удалить папку? Чаты внутри останутся (станут «без папки»).",
    );
    if (!ok) return;
    persist(deleteFolder({ state, folderId }));
    if (activeFolderId === folderId) onSelect(null);
  };

  // Don't render anything until the user has at least one folder
  // OR is actively creating one. Keeps the rail clean for the 80%
  // of users who never bother with folders.
  if (state.folders.length === 0 && !creating) {
    return (
      <div className="border-b border-zinc-200/60 px-3 py-2">
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-zinc-300 px-2.5 py-1 text-zinc-500 hover:border-zinc-400 hover:bg-white hover:text-zinc-700"
          style={{ fontSize: 11, fontWeight: 600, minHeight: 28 }}
          aria-label={langSafe === "kz" ? "Папка қосу" : "Создать папку"}
        >
          <Tag size={11} aria-hidden />
          <span>{langSafe === "kz" ? "Папкалар" : "Папки"}</span>
        </button>
      </div>
    );
  }

  const allLabel = langSafe === "kz" ? "Барлығы" : "Все";
  const newFolderPh = langSafe === "kz" ? "Жаңа папка..." : "Новая папка...";
  const unfiledCount = counts?.[""] ?? 0;

  return (
    <div className="border-b border-zinc-200/60 px-2.5 pb-2 pt-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {/* "All" pill — shows total threads */}
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={
            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 transition-colors " +
            (activeFolderId === null
              ? "border-zinc-400 bg-zinc-900 text-white"
              : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50")
          }
          style={{ fontSize: 11, fontWeight: 700, minHeight: 28 }}
        >
          <span>{allLabel}</span>
          {counts && (
            <span
              className={
                activeFolderId === null ? "text-white/80" : "text-zinc-400"
              }
              style={{ fontSize: 10, fontWeight: 600 }}
            >
              {totalCount(counts)}
            </span>
          )}
        </button>

        {state.folders.map((f) => {
          const c = COLOR_CLASSES[f.color] ?? COLOR_CLASSES.amber;
          const isActive = activeFolderId === f.id;
          const n = counts?.[f.id] ?? 0;
          return (
            <span
              key={f.id}
              className={
                "group inline-flex items-center gap-1 rounded-full border px-2.5 py-1 transition-colors " +
                (isActive ? c.active : c.idle)
              }
              style={{ fontSize: 11, fontWeight: 700, minHeight: 28 }}
            >
              <button
                type="button"
                onClick={() => onSelect(isActive ? null : f.id)}
                className="inline-flex items-center gap-1"
                aria-pressed={isActive}
                aria-label={
                  langSafe === "kz" ? `${f.name} папкасы` : `Папка: ${f.name}`
                }
              >
                <span className="truncate max-w-[120px]">{f.name}</span>
                {counts && (
                  <span style={{ fontSize: 10, fontWeight: 600 }}>{n}</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => handleDelete(f.id)}
                className="opacity-0 transition-opacity group-hover:opacity-100 ml-0.5"
                aria-label={
                  langSafe === "kz"
                    ? `${f.name} папкасын жою`
                    : `Удалить папку «${f.name}»`
                }
                title={langSafe === "kz" ? "Жою" : "Удалить"}
                style={{ minHeight: 18, lineHeight: 1 }}
              >
                <X size={10} aria-hidden />
              </button>
            </span>
          );
        })}

        {/* Unfiled chip — appears only when there are unfiled threads */}
        {counts && unfiledCount > 0 && (
          <button
            type="button"
            onClick={() => onSelect("")}
            className={
              "inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 transition-colors " +
              (activeFolderId === ""
                ? "border-zinc-400 bg-zinc-900 text-white"
                : "border-zinc-300 bg-white text-zinc-500 hover:bg-zinc-50")
            }
            style={{ fontSize: 11, fontWeight: 600, minHeight: 28 }}
            aria-label={langSafe === "kz" ? "Папкасыз" : "Без папки"}
          >
            <span>{langSafe === "kz" ? "Папкасыз" : "Без папки"}</span>
            <span
              className={
                activeFolderId === "" ? "text-white/80" : "text-zinc-400"
              }
              style={{ fontSize: 10, fontWeight: 600 }}
            >
              {unfiledCount}
            </span>
          </button>
        )}

        {/* "+ new folder" affordance */}
        {creating ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) =>
              setDraft(e.target.value.slice(0, MAX_FOLDER_NAME_LENGTH))
            }
            onBlur={() => {
              if (draft.trim()) handleCreate(draft);
              else {
                setCreating(false);
                setDraft("");
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              } else if (e.key === "Escape") {
                setDraft("");
                setCreating(false);
              }
            }}
            placeholder={newFolderPh}
            className="rounded-full border border-zinc-300 bg-white px-2.5 py-1 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-amber-100/60"
            style={{ fontSize: 11, minHeight: 28, width: 140 }}
            maxLength={MAX_FOLDER_NAME_LENGTH}
          />
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center justify-center rounded-full border border-dashed border-zinc-300 px-2 py-1 text-zinc-500 hover:border-zinc-400 hover:bg-white hover:text-zinc-700"
            style={{ minHeight: 28, minWidth: 28 }}
            aria-label={langSafe === "kz" ? "Папка қосу" : "Создать папку"}
          >
            <Plus size={11} />
          </button>
        )}
      </div>
    </div>
  );
}

/** Pure helper — total count summing all folder counts including
 *  unfiled. Pulled out for testability + readability of JSX. */
function totalCount(counts: Record<string, number>): number {
  let total = 0;
  for (const k of Object.keys(counts)) total += counts[k] ?? 0;
  return total;
}

/** Pure helper — pick a palette entry by rotating through the
 *  frozen list. Keeps adjacent folders visually distinct. */
function pickRotatingColor(index: number): ThreadFolderColor {
  // THREAD_FOLDER_COLORS is non-empty; modulo always in-bounds.
  // Fallback to first entry to satisfy noUncheckedIndexedAccess.
  return (
    THREAD_FOLDER_COLORS[index % THREAD_FOLDER_COLORS.length] ??
    THREAD_FOLDER_COLORS[0]!
  );
}

export default ThreadFolderStrip;
