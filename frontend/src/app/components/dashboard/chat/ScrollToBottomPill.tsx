/**
 * Phase B (s21, 2026-04-22): floating "scroll to bottom" pill.
 *
 * Appears when the user scrolls the transcript up by more than ~120px
 * from the bottom AND there is at least one message not currently in
 * view. Carries an unread-counter when new messages arrive while the
 * pill is visible (i.e. the user has scrolled up mid-generation and
 * doesn't see the answer coming in).
 *
 * The transcript owns the scroll container; this pill gets refs to
 * both the scroll container and the tail sentinel so it can
 *   (a) compute its own visibility (distance from bottom), and
 *   (b) smooth-scroll to the sentinel on click.
 *
 * Accessibility: role="button" + aria-label that reads the unread
 * count so screen readers announce "3 new messages — scroll to
 * bottom".
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useLang } from "../../LanguageContext";
import { scrollToBottomPillLabel } from "./scrollToBottomPillLabel";
import { nextScrollPillAnnouncement } from "./scrollToBottomPillAnnouncement";
import { rafThrottle } from "./rafThrottle";

interface Props {
  /** The scrollable transcript <div>. */
  scrollRef: React.RefObject<HTMLDivElement>;
  /** The sentinel at the bottom to scroll to. */
  bottomRef: React.RefObject<HTMLDivElement>;
  /** Current message count. Used to increment unread while pill is
   *  visible. */
  messageCount: number;
  /** True while the send flow is awaiting a reply. If the user scrolls
   *  up during streaming and a new assistant bubble appears, we count
   *  that as unread. */
  isSending: boolean;
}

const NEAR_BOTTOM_PX = 120;

export function ScrollToBottomPill({
  scrollRef,
  bottomRef,
  messageCount,
  isSending: _isSending,
}: Props) {
  const { lang, t } = useLang();
  const [visible, setVisible] = useState(false);
  const [unread, setUnread] = useState(0);
  // s35 wave 25c (2026-04-28): SR live-region text. Driven by the
  // pure helper `nextScrollPillAnnouncement` on the rising edge of
  // `unread` so SRs hear "3 новых сообщения ниже" exactly when new
  // turns arrive while pill is visible — no chatter on every delta.
  const [unreadAnnounce, setUnreadAnnounce] = useState("");
  const lastAnnouncedRef = useRef(0);

  // Track the message count we had last time the pill transitioned
  // to visible. Every message that arrives while visible counts as
  // unread until the user scrolls back down.
  const baselineCount = useRef(messageCount);
  const wasVisible = useRef(false);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setUnread(0);
  }, [bottomRef]);

  // Watch scroll position.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => {
      const distance = el.scrollHeight - (el.scrollTop + el.clientHeight);
      const shouldShow = distance > NEAR_BOTTOM_PX;
      setVisible((prev) => {
        if (prev !== shouldShow) {
          if (shouldShow) {
            baselineCount.current = messageCount;
            setUnread(0);
          }
          wasVisible.current = shouldShow;
        }
        return shouldShow;
      });
    };
    check();
    const rafId = window.requestAnimationFrame(check);
    // s35 wave 49 (2026-04-28): coalesce scroll/resize bursts to one
    // tick per animation frame. Trackpad scrolls fire at 60-120Hz on
    // modern browsers and each invocation reads layout (forced
    // reflow) + setState; we only need the latest reading per paint.
    const throttledCheck = rafThrottle(check);
    el.addEventListener("scroll", throttledCheck, { passive: true });
    window.addEventListener("resize", throttledCheck);
    return () => {
      window.cancelAnimationFrame(rafId);
      throttledCheck.cancel();
      el.removeEventListener("scroll", throttledCheck);
      window.removeEventListener("resize", throttledCheck);
    };
  }, [scrollRef, messageCount]);

  // Increment unread while visible + new message comes in.
  useEffect(() => {
    if (!visible) {
      baselineCount.current = messageCount;
      // Pill hidden → reset the live-region. Suppresses an
      // announce when the user scrolls back down on their own.
      lastAnnouncedRef.current = 0;
      setUnreadAnnounce("");
      return;
    }
    const delta = Math.max(0, messageCount - baselineCount.current);
    setUnread(delta);
  }, [messageCount, visible]);

  // s35 wave 25c: drive the SR live-region on rising edges only.
  useEffect(() => {
    if (!visible) return;
    const speak = nextScrollPillAnnouncement({
      prevCount: lastAnnouncedRef.current,
      nextCount: unread,
      lang: lang === "kz" ? "kz" : "ru",
    });
    if (speak) {
      lastAnnouncedRef.current = unread;
      setUnreadAnnounce(speak);
    }
  }, [unread, visible, lang]);

  if (!visible) return null;

  const label =
    t("chat.scrollToBottom") ||
    (lang === "kz" ? "Соңғы хабарламаға" : "К последнему сообщению");
  // s35 wave 14b: aria-label now reads "3 новых сообщения · К
  // последнему сообщению" (RU plural-aware) / "3 жаңа хабарлама · ..."
  // (KZ single form) instead of the bare "3 · К последнему сообщению"
  // mid-dot count. Helper is pure + vitest-pinned.
  const aria = scrollToBottomPillLabel(unread, lang === "kz" ? "kz" : "ru");

  return (
    <button
      type="button"
      onClick={scrollToBottom}
      aria-label={aria}
      title={label}
      /*
       * s26 phase 7: pill now lives as a sibling of the scrollable
       * transcript (inside ChatTranscript's static `.relative` shell)
       * instead of inside the scroller itself. That means `bottom-3`
       * measures from the viewport bottom of the transcript pane —
       * i.e. just above the composer — not from the bottom of
       * accumulated scrollHeight. Boss bug: previously it stuck mid-
       * page on top of message prose. `pointer-events-auto` so the
       * surrounding flex shell doesn't swallow clicks.
       */
      className="pointer-events-auto absolute left-1/2 -translate-x-1/2 bottom-3 z-20 inline-flex items-center gap-1.5 px-3 h-8 rounded-full border border-zinc-200 bg-white/95 backdrop-blur shadow-md hover:bg-zinc-50 transition-colors samga-anim-pill"
      style={{ fontSize: 12, fontWeight: 500 }}
    >
      <ChevronDown size={14} className="text-zinc-500" />
      <span className="text-zinc-700">{label}</span>
      {unread > 0 && (
        <span
          className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white"
          style={{ fontSize: 10, fontWeight: 700 }}
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
      {/* s35 wave 25c (2026-04-28): SR-only live-region. Speaks the
          rising-edge announcement so SR users hear new turns landing
          while they're scrolled up, instead of a silent badge tick. */}
      <span role="status" aria-live="polite" className="sr-only">
        {unreadAnnounce}
      </span>
    </button>
  );
}

export default ScrollToBottomPill;
