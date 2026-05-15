import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, ExternalLink } from "lucide-react";
import type { Citation } from "./citations";
import {
  buildLibraryPdfViewerPath,
  buildLibraryThumbnailApiUrl,
} from "../../../lib/libraryPdf";
import {
  trackCitationClicked,
  trackCitationHover,
} from "../../../lib/telemetry";
import { useLang } from "../../LanguageContext";
import {
  citationChipLinkAriaLabel,
  citationChipMissingAriaLabel,
  citationChipPopoverDialogAriaLabel,
} from "./citationChipAria";
import { rafThrottle } from "./rafThrottle";
import { computeHoverDwellMs } from "./citationHoverDwell";
// v3.10 (F2, 2026-04-30): "Attach to next question" affordance
// inside the citation popover. Builds a samga.cite envelope (the
// F6 contract) + RU/KZ prompt prefix and seeds the composer.
// We read the context directly (NOT through useMessages) so that
// rendering a CitationChip outside a MessagesProvider — e.g. in
// storybook or in the existing contract tests that predate F2 —
// does NOT throw. When the provider is absent the attach button
// is hidden entirely.
import { useContext } from "react";
import { MessagesContext } from "./MessagesContext";
import {
  attachButtonAriaLabel,
  attachButtonLabel,
  buildCitationSeed,
} from "./attachCitationToComposer";

interface Props {
  citation: Citation;
  /** Book id resolved against the library catalogue, or null if no match. */
  bookId: number | null;
}

/**
 * Inline, clickable citation chip shown inside assistant messages.
 *
 * When a matching textbook is found in the library, the chip deep-links to the
 * Samga Library viewer route in a new tab. The viewer embeds the protected PDF
 * and keeps the browser URL readable.
 *
 * When no match is found (book name in citation doesn't resolve to any book
 * in the library list) the chip renders as a non-interactive badge so the
 * source attribution is still visible but we don't promise a broken link.
 *
 * Phase A (s20c): on `mouseenter` with 180 ms delay, open a floating popover
 * showing a PNG thumbnail of the exact PDF page, fetched from the new
 * `GET /api/library/books/{id}/pages/{n}/thumbnail` endpoint. Popover is
 * rendered through a React portal so overflow:hidden ancestors can't clip it.
 */
export function CitationChip({ citation, bookId }: Props) {
  const { bookName, pageNumber } = citation;
  const { lang } = useLang();
  const langSafe: "ru" | "kz" = lang === "kz" ? "kz" : "ru";
  // v3.10 (F2, 2026-04-30): seed the composer with a samga.cite
  // envelope + prompt prefix when the user clicks "Attach to next
  // question" inside the popover. seedComposer is reused from
  // F1/B2/C5 so the textarea picks up the value via its existing
  // composerSeed effect. We read the context directly so that
  // rendering CitationChip without a MessagesProvider (storybook,
  // pre-F2 contract tests) doesn't throw — `seedComposer` is null
  // when there's no surrounding provider, and the attach button
  // hides itself.
  const messagesCtx = useContext(MessagesContext);
  const seedComposer = messagesCtx?.seedComposer ?? null;

  const hasLink = bookId !== null;
  const href = hasLink
    ? buildLibraryPdfViewerPath(bookId, pageNumber)
    : undefined;

  const anchorRef = useRef<HTMLAnchorElement | HTMLSpanElement | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedAt = useRef<number | null>(null);
  // s35 wave 61 (2026-04-28): tracks the time the user STARTED
  // hovering (mouseenter), not when the popover opened. Used to
  // compute hover→click dwell on click. Distinct from `openedAt`
  // which is set 180 ms later when the popover actually appears.
  // Cleared on mouseleave so a click after a leave-then-reenter
  // measures from the most recent hover start, not the original.
  const hoverStartedAt = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );

  // Recompute popover placement whenever we open, on scroll, and on resize.
  function place() {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const popW = 260; // matches the popover width below
    const popH = 240; // approximate; clamp at viewport edges
    const margin = 8;
    let left = rect.left + rect.width / 2 - popW / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - popW - margin));
    // Prefer opening ABOVE the chip (message list grows downward, so above
    // is usually free space). Flip below only if we'd clip the top.
    let top = rect.top - popH - 10;
    if (top < margin) top = rect.bottom + 10;
    setCoords({ top, left });
  }

  useEffect(() => {
    if (!open) return;
    place();
    // s35 wave 52 (2026-04-28): coalesce scroll/resize bursts to one
    // `place()` call per animation frame. The popover rect is read
    // and styled fresh on every fire; the browser only paints once
    // per frame, so per-tick reflows during fast trackpad scrolls
    // are wasted work. `capture: true` is preserved so we still
    // catch ancestor-scroll events that the chip's portal target
    // doesn't see directly.
    const throttledPlace = rafThrottle(place);
    window.addEventListener("scroll", throttledPlace, true);
    window.addEventListener("resize", throttledPlace);
    return () => {
      throttledPlace.cancel();
      window.removeEventListener("scroll", throttledPlace, true);
      window.removeEventListener("resize", throttledPlace);
    };
  }, [open]);

  function handleEnter() {
    if (!hasLink) return;
    // s35 wave 61: stamp hover-start at mouseenter so the dwell
    // window measures user intent, not popover-visible time. Set
    // on every enter so leave→re-enter starts a fresh window.
    hoverStartedAt.current = Date.now();
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (openTimer.current) return;
    openTimer.current = setTimeout(() => {
      setOpen(true);
      openedAt.current = Date.now();
      openTimer.current = null;
    }, 180);
  }
  function handleLeave() {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current) return;
    closeTimer.current = setTimeout(() => {
      // On close, emit a hover event with the dwell time so we can
      // measure the "did the receipts land" trust metric
      // (DESIGN_CHAT_FLAGSHIP.md §8).
      if (openedAt.current != null) {
        const dwell = Date.now() - openedAt.current;
        try {
          trackCitationHover({
            book_id: bookId,
            page_number: pageNumber,
            dwell_ms: dwell,
          });
        } catch {
          /* noop */
        }
        openedAt.current = null;
      }
      // s35 wave 61: clear hoverStartedAt on the close completion
      // so a click much later (after the user wandered off and
      // came back) doesn't compute a stale dwell. The next
      // handleEnter will re-stamp it.
      hoverStartedAt.current = null;
      setOpen(false);
      closeTimer.current = null;
    }, 120);
  }
  function popoverEnter() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  const label = (
    <>
      <BookOpen
        size={12}
        className={hasLink ? "text-amber-600" : "text-zinc-500"}
      />
      <span className="truncate max-w-[18rem]">{bookName}</span>
      <span className="opacity-70 shrink-0">· p. {pageNumber}</span>
      {hasLink && <ExternalLink size={11} className="opacity-70 shrink-0" />}
    </>
  );

  if (!hasLink) {
    return (
      <span
        ref={anchorRef as React.RefObject<HTMLSpanElement>}
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-zinc-200 bg-zinc-50 text-zinc-500 align-baseline"
        style={{ fontSize: 11, fontWeight: 500 }}
        title={`Book "${bookName}" not found in the library`}
        // s35 wave 31b (2026-04-28): SR users had no signal that
        // the chip is an unresolved source — the visible chrome
        // looks identical to a live citation save for the missing
        // ExternalLink icon. Helper bakes the "недоступен в
        // библиотеке" hint into the accessible name.
        aria-label={citationChipMissingAriaLabel({
          bookName,
          pageNumber,
          lang: langSafe,
        })}
      >
        {label}
      </span>
    );
  }

  const thumbUrl = buildLibraryThumbnailApiUrl(bookId, pageNumber, 360);

  return (
    <>
      <a
        ref={anchorRef as React.RefObject<HTMLAnchorElement>}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onFocus={handleEnter}
        onBlur={handleLeave}
        onClick={() => {
          try {
            // s35 wave 61: emit hover→click dwell when available.
            // computeHoverDwellMs returns null when hover never
            // happened (keyboard activation, touch tap that
            // skipped mouseenter) — pass that through so the
            // dashboard can split "hovered then clicked" from
            // "clicked cold".
            const dwell = computeHoverDwellMs(
              hoverStartedAt.current,
              Date.now(),
            );
            trackCitationClicked({
              book_id: bookId,
              page_number: pageNumber,
              hover_dwell_ms: dwell,
            });
          } catch {
            /* noop */
          }
        }}
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:border-amber-300 transition-colors align-baseline samga-anim-chip-hover"
        style={{ fontSize: 11, fontWeight: 600 }}
        title={`Open “${bookName}” at page ${pageNumber}`}
        // s35 wave 31b (2026-04-28): bilingual canonical
        // accessible name. Pre-wave the chip was unlabeled so SR
        // users heard only the visible icon-chrome + book name +
        // page number with no "opens in new tab" cue (the
        // ExternalLink icon is decorative-only).
        aria-label={citationChipLinkAriaLabel({
          bookName,
          pageNumber,
          lang: langSafe,
        })}
      >
        {label}
      </a>
      {open && coords
        ? createPortal(
            <div
              onMouseEnter={popoverEnter}
              onMouseLeave={handleLeave}
              style={{
                position: "fixed",
                top: coords.top,
                left: coords.left,
                width: 260,
                zIndex: 50,
              }}
              className="rounded-lg border border-zinc-200 bg-white shadow-lg overflow-hidden samga-anim-popover"
              role="dialog"
              // s35 wave 32a (2026-04-28): popover dialog wrapper
              // accessible name moved off the baked-in English
              // string to a bilingual helper. Visible chrome is
              // unchanged.
              aria-label={citationChipPopoverDialogAriaLabel({
                bookName,
                pageNumber,
                lang: langSafe,
              })}
            >
              {/* Thumbnail image with a graceful broken-state fallback. */}
              <CitationThumbnail
                src={thumbUrl}
                alt={`${bookName} — page ${pageNumber}`}
              />
              <div
                className="flex items-center justify-between px-3 py-2 border-t border-zinc-100"
                style={{ fontSize: 11 }}
              >
                <div className="min-w-0">
                  <div
                    className="text-zinc-800 truncate"
                    style={{ fontWeight: 600 }}
                    title={bookName}
                  >
                    {bookName}
                  </div>
                  <div className="text-zinc-500">page {pageNumber}</div>
                </div>
                <span
                  className="text-amber-700 shrink-0"
                  style={{ fontWeight: 600 }}
                >
                  Open →
                </span>
              </div>
              {/* v3.10 (F2, 2026-04-30): "Attach to next question"
                  row. Disabled when the citation didn't resolve to
                  a real bookId (no envelope possible). State-aware
                  aria-label spells out the consequence in both
                  cases — wave-26-style consequence-aware buttons.
                  Hidden entirely when there is no surrounding
                  MessagesProvider (storybook / contract tests). */}
              {seedComposer ? (
                <div className="border-t border-zinc-100 px-3 py-2">
                  <button
                    type="button"
                    disabled={!hasLink}
                    onClick={() => {
                      const seed = buildCitationSeed({
                        bookId,
                        pageNumber,
                        bookName,
                        lang: langSafe,
                      });
                      if (!seed) return;
                      seedComposer(seed);
                      setOpen(false);
                    }}
                    aria-label={attachButtonAriaLabel({
                      bookName,
                      pageNumber,
                      resolved: hasLink,
                      lang: langSafe,
                    })}
                    className={
                      "w-full text-left rounded-md px-2 py-1.5 transition-colors " +
                      (hasLink
                        ? "text-amber-700 hover:bg-amber-50 cursor-pointer"
                        : "text-zinc-400 cursor-not-allowed")
                    }
                    style={{ fontSize: 11, fontWeight: 600 }}
                  >
                    + {attachButtonLabel(langSafe)}
                  </button>
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function CitationThumbnail({ src, alt }: { src: string; alt: string }) {
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  return (
    <div
      className="w-full bg-zinc-50 flex items-center justify-center"
      style={{ height: 180 }}
    >
      {state === "error" ? (
        <div className="text-zinc-500" style={{ fontSize: 11 }}>
          Preview unavailable
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onLoad={() => setState("loaded")}
          onError={() => setState("error")}
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            objectFit: "contain",
            opacity: state === "loaded" ? 1 : 0.3,
            transition: "opacity 150ms ease",
          }}
        />
      )}
    </div>
  );
}

export default CitationChip;
