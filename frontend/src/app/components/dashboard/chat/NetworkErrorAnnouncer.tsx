/**
 * s35 wave 39 (2026-04-28) — assertive SR live-region for failed
 * sends. Mirror of `StreamCompleteAnnouncer` (wave 32 H1) but for
 * the inverse signal: when a send fails, SR users hear a concise
 * "Не удалось отправить сообщение…" / "Хабарлама жіберілмеді…"
 * cue immediately, instead of having to wait for the polite
 * `role="log"` chunk-stream to catch up to the error bubble.
 *
 * Closes the last parked bigger-ask from the wave-37 sweep
 * ("network-error toast SR live-region"). Note: 429 (limit) /
 * 403 (paywall) failures don't reach the error-bubble branch —
 * they pop modals via the `onLimitReached` / `onPaywall`
 * callbacks. Modal-mount focus already covers SR awareness for
 * those, so this announcer focuses on the connectivity-shaped
 * failures that emit an error bubble (network / generic 5xx).
 *
 * Design:
 *   - Reads the latest `isError === true` message id from the
 *     transcript via `MessagesContext`. Pure helpers in
 *     `networkErrorAnnouncement.ts` do the dedupe + copy.
 *   - Strict `aria-live="assertive"` because the user needs to
 *     know their send went nowhere RIGHT NOW; politely-queued
 *     would lose to the still-flowing-or-just-finished transcript
 *     log.
 *   - `aria-atomic="true"` so the SR speaks the whole sentence
 *     instead of a diff (the diff would be empty after TTL clear).
 *   - Renders only inside a TTL window so re-mount of an
 *     already-errored thread doesn't re-announce the historical
 *     error.
 *
 * What it does NOT do:
 *   - Doesn't replicate the visible error bubble copy — that's the
 *     transcript's job; this is the SR-only complement.
 *   - Doesn't fire on user-initiated cancel (those don't appear
 *     in the messages list as `isError`).
 */

import { useEffect, useRef, useState } from "react";
import { useLang } from "../../LanguageContext";
import { useMessages } from "./MessagesContext";
import {
  networkErrorAnnouncementText,
  shouldAnnounceNetworkError,
} from "./networkErrorAnnouncement";

/** TTL after which we clear the announcement text so the live
 *  region doesn't re-announce on remount. */
export const NETWORK_ERROR_TTL_MS = 1500;

interface Props {
  /** Optional override — primarily for tests. */
  ttlMs?: number;
}

export function NetworkErrorAnnouncer({
  ttlMs = NETWORK_ERROR_TTL_MS,
}: Props = {}) {
  const { lang } = useLang();
  const { messages } = useMessages();
  const lastAnnouncedRef = useRef<string | null>(null);
  const [message, setMessage] = useState("");

  // Scan from tail — the most recent error bubble is the only
  // one we care about; older errors are scrollback, not new
  // signals. Pre-wave the transcript was the SR users' only
  // signal, so this announcer ONLY runs on the trailing error.
  let latestErrorId: string | null = null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m && m.isError === true) {
      latestErrorId = typeof m.id === "string" ? m.id : null;
      break;
    }
  }

  useEffect(() => {
    const announce = shouldAnnounceNetworkError({
      errorId: latestErrorId,
      lastAnnouncedId: lastAnnouncedRef.current,
    });
    if (!announce) return undefined;

    // useSendMessage already classifies 429/403 → callbacks, so
    // any error bubble we encounter here is connectivity-shaped.
    // Reason="network" gives the user the actionable retry hint.
    setMessage(
      networkErrorAnnouncementText({
        reason: "network",
        lang: lang === "kz" ? "kz" : "ru",
      }),
    );
    lastAnnouncedRef.current = latestErrorId;
    const id = window.setTimeout(() => setMessage(""), ttlMs);
    return () => window.clearTimeout(id);
  }, [latestErrorId, lang, ttlMs]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      // Visually hidden but screen-reader accessible — same
      // technique as StreamCompleteAnnouncer.
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
      data-testid="network-error-announcer"
    >
      {message}
    </div>
  );
}

export default NetworkErrorAnnouncer;
