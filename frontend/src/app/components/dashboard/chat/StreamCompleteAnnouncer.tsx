/**
 * s32 (H1, 2026-04-27) — visually-hidden live region that fires a
 * single "assistant finished" announcement when streaming ends.
 *
 * Why a SEPARATE region from the existing `role="log"` aria-live on
 * the transcript? The transcript announces every new chunk as it
 * arrives — useful for short turns, overwhelming for a 2-minute
 * answer with reasoning + tools + citations. Screen-reader users
 * have asked (a11y_report_2026-04-24) for a concise "done"
 * confirmation so they know they can stop listening to the noisy
 * chunk stream and switch to reading the final message at their own
 * pace.
 *
 * Behaviour:
 *   - `politenessFor(isSending, prevIsSending)` returns "polite"
 *     while idle / mid-stream and "assertive" only on the
 *     true→false transition. Pure helper so vitest can pin it.
 *   - We render the live region with `role="status" aria-live=…`
 *     and the message text only in that brief window. After
 *     ANNOUNCEMENT_TTL_MS we clear the text, so reopening a thread
 *     that was already done doesn't double-announce.
 *   - `aria-atomic="true"` so the SR speaks the whole label, not
 *     just the diff (the diff would be empty on clear).
 *
 * What it does NOT do:
 *   - Doesn't replace the transcript's `aria-live="polite"` log —
 *     that's still useful for sighted SR users tracking the stream.
 *   - Doesn't fire on cancel/interrupt; D4's InterruptedPill carries
 *     its own aria-live for that case.
 */

import { useEffect, useRef, useState } from "react";
import { useLang } from "../../LanguageContext";

/** TTL after which we clear the announcement text so the live
 *  region doesn't re-announce on remount. */
export const ANNOUNCEMENT_TTL_MS = 1500;

/** Pure helper — picks the politeness level for the live region
 *  given the current and previous `isSending` values. Only the
 *  true→false transition demands assertive; at all other times we
 *  stay polite so the SR doesn't fight the transcript log. */
export function politenessFor(
  isSending: boolean,
  prevIsSending: boolean | null,
): "polite" | "assertive" {
  if (prevIsSending === true && isSending === false) return "assertive";
  return "polite";
}

/** Pure helper — returns the message to announce, or empty string
 *  to clear. Splitting this out so the component stays a thin
 *  effect wrapper. */
export function announcementMessageFor(
  isSending: boolean,
  prevIsSending: boolean | null,
  doneLabel: string,
): string {
  if (prevIsSending === true && isSending === false) return doneLabel;
  return "";
}

interface Props {
  isSending: boolean;
  /** Optional override — primarily for tests. */
  ttlMs?: number;
}

export function StreamCompleteAnnouncer({
  isSending,
  ttlMs = ANNOUNCEMENT_TTL_MS,
}: Props) {
  const { t, lang } = useLang();
  const prevIsSendingRef = useRef<boolean | null>(null);
  const [message, setMessage] = useState("");
  const [politeness, setPoliteness] = useState<"polite" | "assertive">(
    "polite",
  );

  useEffect(() => {
    const prev = prevIsSendingRef.current;
    const doneLabel =
      t("chat.a11y.streamComplete") ||
      (lang === "kz" ? "Жауап дайын" : "Ответ готов");
    const next = announcementMessageFor(isSending, prev, doneLabel);
    if (next) {
      setPoliteness(politenessFor(isSending, prev));
      setMessage(next);
      const id = window.setTimeout(() => setMessage(""), ttlMs);
      prevIsSendingRef.current = isSending;
      return () => window.clearTimeout(id);
    }
    prevIsSendingRef.current = isSending;
    return undefined;
  }, [isSending, t, lang, ttlMs]);

  return (
    <div
      role="status"
      aria-live={politeness}
      aria-atomic="true"
      // Visually hidden but screen-reader accessible — Tailwind's
      // `sr-only` equivalent without pulling in the utility class
      // (we don't import the tailwind preset here).
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        padding: 0,
        margin: -1,
        overflow: "hidden",
        clip: "rect(0, 0, 0, 0)",
        whiteSpace: "nowrap",
        border: 0,
      }}
    >
      {message}
    </div>
  );
}

export default StreamCompleteAnnouncer;
