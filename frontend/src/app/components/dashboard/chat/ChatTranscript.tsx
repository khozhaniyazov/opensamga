/**
 * Phase B (s21, 2026-04-22): transcript = empty-state OR the scrollable
 * message list with typing indicator. Owns the auto-scroll-to-bottom
 * behaviour on new messages.
 */

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Bot, RefreshCw, Square, UserRound } from "lucide-react";
import { AssistantMessageRow } from "./AssistantMessageRow";
import { UserMessageRow } from "./UserMessageRow";
import { ChatEmptyState } from "./ChatEmptyState";
import { ScrollToBottomPill } from "./ScrollToBottomPill";
import { StreamCompleteAnnouncer } from "./StreamCompleteAnnouncer";
import { NetworkErrorAnnouncer } from "./NetworkErrorAnnouncer";
import { UnverifiedScoreClaimAnnouncer } from "./UnverifiedScoreClaimAnnouncer";
import { useMessages } from "./MessagesContext";
import { useLang } from "../../LanguageContext";
import { useReducedMotion } from "./useReducedMotion";
import { motionClass } from "./reducedMotion";
import { transcriptLogAria } from "./transcriptLogAria";
import { messageItemAria } from "./messageItemAria";
import { messageVirtualizationStyle } from "./messageVirtualization";
import { rafThrottle } from "./rafThrottle";
import { errorRetryAriaLabel, errorRetryButtonLabel } from "./errorRetryAria";
import {
  SAMGA_LOADING_FRAMES,
  formatSamgaElapsed,
  getSamgaLoadingLabel,
} from "../../../lib/samgaLoading";

interface ChatTranscriptProps {
  onPickStarter: (prompt: string) => void;
  onStop: () => void;
  /** Called when the user clicks "Regenerate" on the tail assistant
   *  message. Receives the prior user-turn text. */
  onRegenerate: (priorUserText: string) => void;
}

export function ChatTranscript({
  onPickStarter,
  onStop,
  onRegenerate,
}: ChatTranscriptProps) {
  const { messages, isSending, removeMessage, truncateFrom, seedComposer } =
    useMessages();
  const { lang } = useLang();
  // s34 wave 11 (G6): suppress the streaming caret pulse for users
  // who've asked for reduced motion. The caret keeps the same
  // dimensions + color so the visual position-marker stays put,
  // just doesn't pulse.
  const reduce = useReducedMotion();
  // s35 wave 36a (2026-04-28): unify the streaming caret cadence
  // with SkeletonBubble + ReasoningPanel + ThinkingBlock —
  // `samga-anim-caret` (1.4s, 1→0.4) replaces the harsh tailwind
  // `animate-pulse` (1s, 0→0.5). Reduced-motion gate threaded via
  // existing `motionClass(reduce, …)` shim.
  const caretMotionClass = motionClass(reduce, "samga-anim-caret", "");
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Session 22 bug: when a user reopens /dashboard/chat the history
  // hydrator populated `messages` but the scroller was left at top,
  // so users saw month-old turns, not their latest exchange. We only
  // want the "stick to bottom if near bottom" heuristic on updates
  // AFTER the initial hydrate — on the first non-empty render we
  // always jump to the bottom, instantly (no smooth animation; the
  // user hasn't seen the top yet, so there's nothing to preserve).
  const didInitialScrollRef = useRef(false);
  const userDetachedRef = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const syncUserScrollIntent = () => {
      const distance = el.scrollHeight - (el.scrollTop + el.clientHeight);
      userDetachedRef.current = distance > 140;
    };

    syncUserScrollIntent();
    // s35 wave 49 (2026-04-28): coalesce scroll/resize bursts via the
    // shared `rafThrottle` helper. The user-detached state only needs
    // the LATEST reading per paint frame; firing every trackpad tick
    // forced a reflow per call.
    const throttledSync = rafThrottle(syncUserScrollIntent);
    el.addEventListener("scroll", throttledSync, { passive: true });
    window.addEventListener("resize", throttledSync);
    return () => {
      throttledSync.cancel();
      el.removeEventListener("scroll", throttledSync);
      window.removeEventListener("resize", throttledSync);
    };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    // First non-empty render after mount: force to bottom so reopening
    // the tab shows the latest messages rather than the oldest.
    if (!didInitialScrollRef.current && messages.length > 0) {
      didInitialScrollRef.current = true;
      // Two-phase scroll so images/markdown that measure after layout
      // still land us at the true bottom.
      el.scrollTop = el.scrollHeight;
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
      return;
    }
    if (!userDetachedRef.current) {
      el.scrollTop = el.scrollHeight;
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
      return;
    }
    // Subsequent updates (new turn, streaming): only auto-scroll when
    // the user is already near the bottom. If they've scrolled up to
    // read earlier context, the ScrollToBottomPill takes over.
    const distance = el.scrollHeight - (el.scrollTop + el.clientHeight);
    if (distance < 200) {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const isEmpty = messages.length === 0;
  const lastIsUser = messages[messages.length - 1]?.role === "user";

  // s26 phase 7: ScrollToBottomPill USED to be a child of the
  // overflow-y-auto scroll container. With `position: absolute` inside
  // an overflowing parent, the pill is laid out in the SCROLLABLE
  // coordinate system — it scrolls along with the content and pins
  // itself to a fixed point in the transcript (≈96px above
  // scrollHeight) rather than the visible viewport bottom. The boss
  // observed it stuck mid-page, occluding message text.
  // Fix: wrap the scroll div in a non-scrolling `relative` shell and
  // render the pill as a SIBLING of the scroller. It then anchors
  // against the static shell, so `bottom-N` always means "N px above
  // the visible viewport bottom" regardless of scroll position.
  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      {/* s32 (H1, 2026-04-27): single concise "answer ready"
        announcement on stream-complete, in addition to the
        chunk-by-chunk transcript log below. The announcer is a
        sibling, not nested in the log, so the assertive transition
        speaks once instead of being treated as a log update. */}
      <StreamCompleteAnnouncer isSending={isSending} />
      {/* s35 wave 39 (2026-04-28): assertive SR announcer for failed
        sends. Sibling, not nested in the transcript log, so the
        assertive cue speaks once instead of being treated as a log
        update. Mirrors StreamCompleteAnnouncer. Closes the last
        parked bigger-ask from wave 37. */}
      <NetworkErrorAnnouncer />
      {/* s35 wave 42 (I5, 2026-04-28): polite SR cue when an
        assistant turn references a 2nd-person score-shaped claim
        (e.g. "ваш балл 95"). Sibling pattern mirrors network +
        stream announcers. Skipped when the agent loop already
        redacted score sentences (RedactionPill is on screen, no
        need to double-cue). */}
      <UnverifiedScoreClaimAnnouncer />
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 space-y-4 overflow-y-auto pb-5"
        role="log"
        // s35 wave 26b (2026-04-28): name the log region. Was
        // unnamed → SR users heard "log" with no identity. New
        // aria-label is count-aware via transcriptLogAria — RU
        // paucal table ("Беседа: 5 сообщений" / "1 сообщение" /
        // "пока нет сообщений") + KZ uninflected mirror.
        aria-label={transcriptLogAria({
          messageCount: messages.length,
          lang: lang === "kz" ? "kz" : "ru",
        })}
        aria-live="polite"
        aria-relevant="additions text"
        aria-atomic="false"
      >
        {isEmpty ? (
          <ChatEmptyState onPick={onPickStarter} />
        ) : (
          <>
            {messages.map((msg, index) => {
              const isUser = msg.role === "user";
              const priorUserText = !isUser
                ? messages
                    .slice(0, index)
                    .reverse()
                    .find((item) => item.role === "user")?.text
                : undefined;
              // s35 wave 38 (2026-04-28): per-bubble aria + posinset/
              // setsize so SR users can navigate by article quickkey
              // and hear "Сообщение N из M, ответ Samga" (or "ваше
              // сообщение" / "ошибка" / streaming cue) on focus.
              const itemAria = messageItemAria({
                role: msg.isError ? "error" : msg.role,
                position: index + 1,
                total: messages.length,
                streaming:
                  isSending &&
                  index === messages.length - 1 &&
                  msg.role === "assistant" &&
                  !msg.isError,
                lang: lang === "kz" ? "kz" : "ru",
              });
              // s35 wave 47 (2026-04-28): CSS-driven virtualization
              // for off-screen bubbles. `content-visibility: auto`
              // lets the browser skip style/layout/paint for
              // bubbles that aren't on screen, while the DOM nodes
              // stay in the a11y tree (so SR navigation by article
              // quickkey + the polite log live-region keep working).
              // The last 5 messages are exempt so streaming + the
              // visible viewport never get optimization mid-paint.
              const virtStyle = messageVirtualizationStyle({
                index,
                total: messages.length,
              });
              return (
                <div
                  key={msg.id}
                  role="article"
                  aria-label={itemAria.ariaLabel}
                  aria-posinset={itemAria.posInSet}
                  aria-setsize={itemAria.setSize}
                  style={virtStyle}
                  className={`flex w-full gap-2.5 samga-anim-msg-enter ${
                    isUser ? "justify-end" : "justify-start"
                  }`}
                >
                  {!isUser && (
                    <div className="mt-0.5 hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700 sm:flex">
                      <Bot size={16} />
                    </div>
                  )}
                  <div
                    className={`group markdown-content text-[14px] ${
                      isUser
                        ? "max-w-[min(82%,720px)] rounded-2xl rounded-br-md border border-zinc-900 bg-gradient-to-br from-zinc-900 to-zinc-950 px-4 py-3.5 text-white shadow-[0_2px_8px_-2px_rgba(0,0,0,0.18)]"
                        : msg.isError
                          ? "max-w-[min(88%,800px)] rounded-2xl rounded-bl-md border border-rose-200 bg-rose-50 px-4 py-3.5 text-zinc-800 shadow-[0_1px_2px_rgba(159,18,57,0.05)]"
                          : "max-w-[min(88%,800px)] rounded-2xl rounded-bl-md border border-zinc-200/80 bg-white px-5 py-4 text-zinc-800 shadow-[0_1px_2px_rgba(24,24,27,0.04),0_4px_12px_-6px_rgba(24,24,27,0.05)]"
                    } ${
                      !isUser &&
                      !msg.isError &&
                      isSending &&
                      index === messages.length - 1
                        ? "ring-1 ring-amber-100/60"
                        : ""
                    }`}
                  >
                    {msg.role === "user" ? (
                      // s35 wave 50 (2026-04-28): bubble interior
                      // extracted to UserMessageRow so the LaTeX
                      // detector + edit-pencil get their own
                      // unit-test surface. Behaviour byte-identical
                      // to the prior inline JSX.
                      <UserMessageRow
                        text={msg.text}
                        isSending={isSending}
                        followUpCount={messages.length - index - 1}
                        lang={lang === "kz" ? "kz" : "ru"}
                        onEdit={() => {
                          seedComposer(msg.text);
                          truncateFrom(msg.id);
                        }}
                      />
                    ) : msg.isError ? (
                      // Phase C (s22): structured error bubble with a
                      // Retry affordance. Distinct visual treatment (rose
                      // tint + icon) so it doesn't get mistaken for a
                      // legitimate answer; Retry re-sends the original
                      // prompt and removes this bubble.
                      <div className="flex items-start gap-2" role="alert">
                        <AlertCircle
                          size={16}
                          className="mt-0.5 shrink-0 text-rose-500"
                          aria-hidden="true"
                        />
                        <div className="min-w-0">
                          <p
                            className="mb-2 text-zinc-700"
                            style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}
                          >
                            {msg.text}
                          </p>
                          {msg.retryPrompt ? (
                            // s35 wave 38 (2026-04-28): consequence-aware
                            // aria-label so SR users hear "Повторить
                            // запрос — отправить «…» заново" instead of
                            // the bare verb. Visible chrome stays
                            // compact via errorRetryButtonLabel.
                            <button
                              type="button"
                              onClick={() => {
                                removeMessage(msg.id);
                                onRegenerate(msg.retryPrompt as string);
                              }}
                              className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-rose-600 transition-colors hover:border-rose-300 hover:bg-rose-50"
                              style={{ fontSize: 11, fontWeight: 600 }}
                              aria-label={errorRetryAriaLabel({
                                retryPrompt: msg.retryPrompt,
                                lang: lang === "kz" ? "kz" : "ru",
                              })}
                            >
                              <RefreshCw size={11} />
                              <span>
                                {errorRetryButtonLabel(
                                  lang === "kz" ? "kz" : "ru",
                                )}
                              </span>
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      // s35 wave 51 (2026-04-28): assistant-bubble
                      // interior extracted to AssistantMessageRow.
                      // Behaviour byte-identical: the same predicates,
                      // pill order, and tool-card filter live in that
                      // module now. ChatTranscript still owns the
                      // outer <div role="article"> and chrome.
                      <AssistantMessageRow
                        message={msg}
                        priorUserText={priorUserText}
                        isLast={index === messages.length - 1}
                        isSending={isSending}
                        caretMotionClass={caretMotionClass}
                        onAskFollowUp={(prompt) => seedComposer(prompt)}
                        onRegenerate={onRegenerate}
                        onRemoveSelf={() => removeMessage(msg.id)}
                      />
                    )}
                  </div>
                  {isUser && (
                    <div className="mt-0.5 hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-950 text-white sm:flex">
                      <UserRound size={15} />
                    </div>
                  )}
                </div>
              );
            })}
            {isSending && lastIsUser && (
              <div className="flex justify-start gap-3">
                <div className="mt-0.5 hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700 sm:flex">
                  <Bot size={16} />
                </div>
                <ThinkingStatus lang={lang} onStop={onStop} />
              </div>
            )}
          </>
        )}
        <div ref={endRef} />
      </div>
      {!isEmpty && (
        <ScrollToBottomPill
          scrollRef={scrollRef}
          bottomRef={endRef}
          messageCount={messages.length}
          isSending={isSending}
        />
      )}
    </div>
  );
}

function ThinkingStatus({
  lang,
  onStop,
}: {
  lang: string;
  onStop: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
      setFrame((value) => (value + 1) % SAMGA_LOADING_FRAMES.length);
    }, 500);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"],[aria-modal="true"]')) return;
      event.preventDefault();
      onStop();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onStop]);

  const action = getSamgaLoadingLabel(lang, elapsed);
  const cancelHint =
    lang === "kz" ? "Esc басып тоқтату" : "Esc, чтобы остановить";
  const stopLabel = lang === "kz" ? "Тоқтату" : "Остановить";
  const longWaitHint =
    lang === "kz"
      ? "Оқулықтардан дерек іздеу ұзақтау болуы мүмкін."
      : "Поиск по учебникам может занять чуть больше времени.";

  return (
    <div
      className="max-w-[min(88%,800px)] rounded-xl rounded-bl-md border border-amber-200 bg-amber-50 px-4 py-3.5 text-zinc-700"
      style={{ fontSize: 13 }}
      aria-live="polite"
      aria-label={`${action} ${formatSamgaElapsed(elapsed)}. ${cancelHint}`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-amber-200 bg-white text-amber-700 shadow-sm"
          aria-hidden="true"
        >
          <span className="font-mono leading-none">
            {SAMGA_LOADING_FRAMES[frame]}
          </span>
        </span>
        <span className="font-semibold text-zinc-900">Samga</span>
        <span
          className="font-mono text-zinc-700"
          style={{ letterSpacing: "0.08em" }}
        >
          {action}
        </span>
        <span className="text-zinc-500">
          ({formatSamgaElapsed(elapsed)} · {cancelHint})
        </span>
        <button
          type="button"
          onClick={onStop}
          className="ml-0 inline-flex h-7 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-900 sm:ml-1"
          style={{ fontSize: 11, fontWeight: 700 }}
          aria-label={stopLabel}
          title={stopLabel}
        >
          <Square size={10} fill="currentColor" />
          <span>{stopLabel}</span>
        </button>
      </div>
      {elapsed >= 30 ? (
        <p
          className="mt-2 text-zinc-500"
          style={{ fontSize: 12, lineHeight: 1.6 }}
        >
          {longWaitHint}
        </p>
      ) : null}
    </div>
  );
}
