/**
 * s35 wave 40 (F6 picker, 2026-04-28) — "Cite a specific page" modal.
 *
 * Closes the F6 PARTIAL row from s33. The contract (`samga.cite`
 * fenced JSON envelope + `injectCiteHint` idempotency) shipped in
 * f1a3b36; this surface lets the user actually pick the (book, page)
 * pair without typing the slash command + JSON by hand.
 *
 * Trigger: `/cite` slash command. ChatComposer sees the slash row
 * is the cite command and opens this modal instead of seeding the
 * textarea with prompt copy. On submit we feed the validated hint
 * to `injectCiteHint(currentInput, hint)` so the user's draft prose
 * survives + the fenced block lands at the top idempotently.
 *
 * Keyboard:
 *   - Esc cancels (focus-trap onEscape).
 *   - Tab/Shift+Tab cycle within the dialog.
 *   - Enter submits when the form validates; on a bad input the SR
 *     announcement from the inline error wakes up.
 *
 * NO new BE wiring — the agent loop's prompt parser already knows
 * the fence label.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useLang } from "../../LanguageContext";
import { useFocusTrap } from "./focusTrap";
import { apiGet } from "../../../lib/api";
import {
  formatBookOptionLabel,
  filterBooksForPicker,
  validateCitePagePicker,
  citePagePickerErrorText,
  CITE_PICKER_MAX_PAGE,
} from "./citePagePickerState";
import { type BookRef } from "./citations";
import { type CitePageHint } from "./citeAPage";

interface Props {
  open: boolean;
  onCancel: () => void;
  onConfirm: (hint: CitePageHint) => void;
}

const TITLE_ID = "cite-page-picker-title";
const ERROR_ID = "cite-page-picker-error";

let booksCache: BookRef[] | null = null;
let booksCachePromise: Promise<BookRef[]> | null = null;
async function loadBooksOnce(): Promise<BookRef[]> {
  if (booksCache) return booksCache;
  if (booksCachePromise) return booksCachePromise;
  booksCachePromise = (async () => {
    try {
      const data = await apiGet<BookRef[]>("/library/books");
      booksCache = Array.isArray(data) ? data : [];
      return booksCache;
    } catch {
      booksCache = [];
      return booksCache;
    } finally {
      booksCachePromise = null;
    }
  })();
  return booksCachePromise;
}

export function CitePagePicker({ open, onCancel, onConfirm }: Props) {
  const { lang } = useLang();
  const langSafe: "ru" | "kz" = lang === "kz" ? "kz" : "ru";
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useFocusTrap(dialogRef, open, { onEscape: onCancel });

  const [books, setBooks] = useState<BookRef[]>(booksCache ?? []);
  const [query, setQuery] = useState("");
  const [bookId, setBookId] = useState<number | null>(null);
  const [pageRaw, setPageRaw] = useState("");
  const [errToken, setErrToken] = useState<
    "no-book" | "book-not-in-library" | "bad-page" | null
  >(null);

  // Hydrate books when the modal opens (or use the cached copy).
  useEffect(() => {
    if (!open) return;
    void loadBooksOnce().then((b) => setBooks(b));
    // Reset transient state every open so the previous selection
    // doesn't bleed through.
    setQuery("");
    setBookId(null);
    setPageRaw("");
    setErrToken(null);
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  const filtered = useMemo(
    () => filterBooksForPicker({ books, query, lang: langSafe }),
    [books, query, langSafe],
  );

  if (!open) return null;

  const submit = () => {
    const result = validateCitePagePicker({
      bookId,
      pageRaw,
      books,
    });
    if (!result.ok || !result.hint) {
      setErrToken(result.error);
      return;
    }
    setErrToken(null);
    onConfirm(result.hint);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 samga-anim-modal-scrim samga-anim-scrim-blur"
      role="dialog"
      aria-modal="true"
      aria-labelledby={TITLE_ID}
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        className="bg-white rounded-lg shadow-xl max-w-md w-full p-5 samga-anim-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3
            id={TITLE_ID}
            className="text-zinc-900"
            style={{ fontSize: 15, fontWeight: 600 }}
          >
            {langSafe === "kz"
              ? "Нақты бетке сілтеме"
              : "Сослаться на страницу"}
          </h3>
          <button
            type="button"
            onClick={onCancel}
            aria-label={langSafe === "kz" ? "Жабу" : "Закрыть"}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"
          >
            <X size={14} />
          </button>
        </div>

        <p
          className="mb-3 text-zinc-600"
          style={{ fontSize: 12, lineHeight: 1.5 }}
        >
          {langSafe === "kz"
            ? "Оқулықты және бетті таңдаңыз — бот сол беттің мазмұнын негіздеме ретінде пайдаланады."
            : "Выберите учебник и страницу — бот будет использовать содержимое этой страницы как опорный материал."}
        </p>

        {/* Book search */}
        <div className="mb-3">
          <label
            className="mb-1 block text-zinc-700"
            style={{ fontSize: 12, fontWeight: 500 }}
          >
            {langSafe === "kz" ? "Оқулық" : "Учебник"}
          </label>
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
              aria-hidden
            />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                langSafe === "kz"
                  ? "Іздеу: атау, пән немесе сынып"
                  : "Поиск: название, предмет или класс"
              }
              className="w-full rounded-md border border-zinc-200 bg-white pl-8 pr-2.5 py-1.5 text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-300 focus:outline-none focus:ring-2 focus:ring-amber-100/60"
              style={{ fontSize: 13 }}
            />
          </div>
          {/* Result list */}
          <div
            role="listbox"
            aria-label={
              langSafe === "kz" ? "Оқулықтар тізімі" : "Список учебников"
            }
            className="mt-1 max-h-48 overflow-auto rounded-md border border-zinc-100 bg-zinc-50/40"
          >
            {filtered.length === 0 ? (
              <div
                className="px-2.5 py-2 text-zinc-500"
                style={{ fontSize: 12 }}
              >
                {langSafe === "kz" ? "Сәйкестік жоқ" : "Нет совпадений"}
              </div>
            ) : (
              <ul>
                {filtered.map((b) => {
                  const isActive = b.id === bookId;
                  return (
                    <li key={b.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        onClick={() => {
                          setBookId(b.id);
                          setErrToken(null);
                        }}
                        className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left ${
                          isActive
                            ? "bg-amber-50 text-zinc-900"
                            : "text-zinc-700 hover:bg-white"
                        }`}
                        style={{ fontSize: 12.5 }}
                      >
                        <span className="truncate">
                          {formatBookOptionLabel(b, langSafe)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Page input */}
        <div className="mb-3">
          <label
            className="mb-1 block text-zinc-700"
            htmlFor="cite-page-input"
            style={{ fontSize: 12, fontWeight: 500 }}
          >
            {langSafe === "kz" ? "Бет" : "Страница"}
          </label>
          <input
            id="cite-page-input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={pageRaw}
            onChange={(e) => {
              setPageRaw(e.target.value);
              if (errToken === "bad-page") setErrToken(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={`1 — ${CITE_PICKER_MAX_PAGE}`}
            aria-invalid={errToken === "bad-page"}
            aria-describedby={errToken ? ERROR_ID : undefined}
            className="w-32 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-300 focus:outline-none focus:ring-2 focus:ring-amber-100/60"
            style={{ fontSize: 13 }}
          />
        </div>

        {/* Inline error */}
        {errToken && (
          <p
            id={ERROR_ID}
            role="alert"
            aria-live="assertive"
            className="mb-2 text-red-600"
            style={{ fontSize: 12 }}
          >
            {citePagePickerErrorText(errToken, langSafe)}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md text-zinc-600 hover:bg-zinc-50"
            style={{ fontSize: 13, fontWeight: 500 }}
          >
            {langSafe === "kz" ? "Болдырмау" : "Отмена"}
          </button>
          <button
            type="button"
            onClick={submit}
            className="px-3 py-1.5 rounded-md bg-zinc-900 text-white hover:bg-zinc-800 transition-colors"
            style={{ fontSize: 13, fontWeight: 600 }}
          >
            {langSafe === "kz" ? "Сілтеме қосу" : "Добавить ссылку"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CitePagePicker;
