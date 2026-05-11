/**
 * s29 (A2, 2026-04-27) — SourcesDrawer.
 *
 * "Used N sources" affordance below an assistant bubble. Sibling to
 * NoLibraryPill (s26 phase 5) and RedactionPill (s27 C1 / s28 A3).
 *
 * Today the agent loop already exposes the *top* citation as
 * `book_id`/`page_number` on the envelope, but the model often
 * consults 3-5 distinct (book, page) tuples per turn — and the user
 * has no way to see the full set without scraping the bubble for
 * inline citation chips. The drawer:
 *
 *   - renders only when `sources.length > 0`,
 *   - shows a chip with the count + a chevron toggle,
 *   - expands to a vertical list of source rows (book name • p. N),
 *   - each row deep-links into the existing CitationChip viewer flow
 *     via `buildLibraryPdfViewerPath`.
 *
 * BE feed: `agent_loop._harvest_consulted_sources` →
 *   SSE `done.consulted_sources` + REST envelope + persisted
 *   `chat_messages.message_metadata.consulted_sources`.
 *
 * The pure helpers `shouldShowSourcesDrawer` and `sourcesDrawerLabel`
 * are exported so vitest can pin the contract without a DOM renderer
 * (mirroring RedactionPill's testable shape).
 */

import { useRef, useState } from "react";
import { ChevronRight, BookOpen, ExternalLink } from "lucide-react";
import type { ConsultedSource } from "./types";
import { useLang } from "../../LanguageContext";
import { buildLibraryPdfViewerPath } from "../../../lib/libraryPdf";
import {
  isCitationActivateKey,
  isCitationNavKey,
  nextCitationIndex,
  rowTabIndex,
} from "./citationListNav";
import { sourcesDrawerRowAriaLabel } from "./sourcesDrawerRowAriaLabel";
import { sourcesDrawerToggleAria } from "./sourcesDrawerToggleAria";
import {
  trackSourcesDrawerRowClicked,
  trackSourcesDrawerToggled,
} from "../../../lib/telemetry";

interface Props {
  /** The dedup'd citation list emitted by the agent loop. Undefined /
   *  empty ⇒ no drawer. */
  sources?: ConsultedSource[] | null;
}

/** Pure predicate — exported for vitest. Mirrors the `> 0` guard
 *  inside the component itself. */
export function shouldShowSourcesDrawer(
  sources?: ConsultedSource[] | null,
): boolean {
  return Array.isArray(sources) && sources.length > 0;
}

/** Pure label helper — exported for vitest. Bilingual copy mirrors
 *  the rest of the chat trust-signal pills. */
export function sourcesDrawerLabel(count: number, lang: "ru" | "kz"): string {
  if (lang === "kz") {
    return `Қолданылған дереккөздер: ${count}`;
  }
  return `Использовано источников: ${count}`;
}

/** Pure helper — fall back to a generic "Source #N" if the backend
 *  didn't carry a book_name (legacy persisted rows). Exported so
 *  vitest can pin the fallback. */
export function sourceRowTitle(
  source: ConsultedSource,
  index: number,
  lang: "ru" | "kz",
): string {
  if (source.book_name && source.book_name.trim().length > 0) {
    return source.book_name.trim();
  }
  return lang === "kz" ? `Дереккөз №${index + 1}` : `Источник №${index + 1}`;
}

export function SourcesDrawer({ sources }: Props) {
  const { lang } = useLang();
  const [open, setOpen] = useState(false);
  // s33 (H3, 2026-04-28): roving tabindex over the citation rows.
  // Tab from outside lands on `activeIdx`; ArrowUp/Down step within;
  // Home/End jump to ends; Enter/Space activates the focused row's
  // anchor (browser default for <a> with focus).
  const [activeIdx, setActiveIdx] = useState(0);
  const rowRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  if (!shouldShowSourcesDrawer(sources)) return null;
  const list = sources as ConsultedSource[];
  const langSafe = (lang === "kz" ? "kz" : "ru") as "ru" | "kz";
  const summary = sourcesDrawerLabel(list.length, langSafe);
  const pageLabel = langSafe === "kz" ? "бет" : "стр.";
  // s35 wave 27c (2026-04-28): count-aware aria-label. The
  // visible chrome shows the count via `summary`; SR users
  // previously got only the bare verb because the inner span
  // wasn't part of `aria-label`. New helper folds the count
  // into the SR string with full RU paucal table + KZ
  // uninflected mirror.
  const expandAria = sourcesDrawerToggleAria({
    count: list.length,
    open,
    lang: langSafe,
  });

  return (
    <div className="mt-2 w-full max-w-full">
      <button
        type="button"
        onClick={() => {
          // s35 wave 55 (2026-04-28): emit the toggle event with the
          // POST-toggle is_open. The state setter callback gives us
          // the right ordering — we read the new value and emit
          // before React commits, so the buffered event reflects
          // what the user just did.
          setOpen((v) => {
            const next = !v;
            trackSourcesDrawerToggled({
              source_count: list.length,
              is_open: next,
            });
            return next;
          });
        }}
        aria-expanded={open}
        aria-label={expandAria}
        className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-400"
      >
        <BookOpen className="h-3 w-3" aria-hidden="true" />
        <span>{summary}</span>
        {/* s35 wave 35a (2026-04-28): single chevron + CSS rotation. */}
        <ChevronRight
          className="h-3 w-3 samga-anim-chevron-target"
          aria-hidden="true"
        />
      </button>

      {open && (
        <ul
          role="list"
          className="mt-2 flex flex-col gap-1 rounded-lg border border-slate-200 bg-slate-50 p-2 samga-anim-disclosure-expand"
          onKeyDown={(e) => {
            // s33 (H3): roving tabindex. ArrowUp/Down/Home/End move
            // focus within the list; Enter/Space defers to the
            // anchor's native click. Tab is NOT intercepted —
            // pressing Tab inside the list moves focus to the next
            // page-level focusable, exactly the pattern WAI-ARIA
            // documents for Listbox-as-link-list.
            if (isCitationNavKey(e.key)) {
              e.preventDefault();
              const next = nextCitationIndex(e.key, activeIdx, list.length);
              setActiveIdx(next);
              const node = rowRefs.current[next];
              if (node) node.focus();
              return;
            }
            if (isCitationActivateKey(e.key)) {
              const node = rowRefs.current[activeIdx];
              if (node) {
                e.preventDefault();
                node.click();
              }
            }
          }}
        >
          {list.map((src, idx) => {
            const title = sourceRowTitle(src, idx, langSafe);
            const href = buildLibraryPdfViewerPath(
              src.book_id,
              src.page_number,
            );
            const rowAria = sourcesDrawerRowAriaLabel({
              title: src.book_name ?? null,
              index: idx,
              pageNumber: src.page_number,
              snippet: src.snippet ?? null,
              lang: langSafe,
            });
            return (
              <li key={`${src.book_id}-${src.page_number}-${idx}`}>
                <a
                  ref={(el) => {
                    rowRefs.current[idx] = el;
                  }}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  tabIndex={rowTabIndex(idx, activeIdx)}
                  onFocus={() => setActiveIdx(idx)}
                  onClick={() => {
                    // s35 wave 55 (2026-04-28): emit the row-click
                    // event. We DON'T preventDefault — the anchor's
                    // native target=_blank navigation owns the
                    // user-visible action; telemetry just observes.
                    trackSourcesDrawerRowClicked({
                      book_id: src.book_id ?? null,
                      page_number: src.page_number,
                      row_index: idx,
                      source_count: list.length,
                    });
                  }}
                  aria-label={rowAria}
                  className="flex items-start gap-2 rounded-md px-2 py-1.5 text-[12px] text-slate-800 hover:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  <ExternalLink
                    className="mt-0.5 h-3 w-3 shrink-0 text-slate-500"
                    aria-hidden="true"
                  />
                  <span className="flex flex-col min-w-0">
                    <span className="truncate font-medium">{title}</span>
                    <span className="text-[11px] text-slate-500">
                      {pageLabel} {src.page_number}
                      {src.snippet ? (
                        <span className="ml-1 italic text-slate-600">
                          — {src.snippet}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default SourcesDrawer;
