/**
 * s35 wave 42 (I5, 2026-04-28) — polite SR live-region for
 * assistant turns whose body matches an unverified-score-claim
 * shape (2nd-person pronoun + score-shaped number).
 *
 * Closes the I5 row from Phase I. Sibling of StreamCompleteAnnouncer
 * (wave 32 H1) and NetworkErrorAnnouncer (wave 39); rendered at the
 * same level above the role=log transcript so the cue isn't
 * politely-queued behind chunk updates.
 *
 * Why polite (not assertive): unlike a network failure, the user's
 * read of the answer is still in-flight. We don't want to interrupt
 * the polite log scan; we want the cue audible at the next
 * convenient pause. `aria-live="polite"` is the correct primitive.
 *
 * Detection scope: ONLY assistant turns, ONLY the trailing one.
 * Older replies are scrollback. We also skip the announcement if
 * the assistant ALSO emitted unverifiedScoreClaimsRedacted > 0 —
 * that means the agent loop already redacted the score-shaped
 * sentences AND the visible RedactionPill is on screen, so an
 * additional SR cue would be noise.
 */

import { useEffect, useRef, useState } from "react";
import { useLang } from "../../LanguageContext";
import { useMessages } from "./MessagesContext";
import {
  containsUnverifiedScoreClaim,
  shouldAnnounceUnverifiedScoreClaim,
  unverifiedScoreClaimAnnouncementText,
} from "./unverifiedScoreClaimAnnouncement";

/** TTL after which we clear the announcement text so the live
 *  region doesn't re-announce on remount. */
export const UNVERIFIED_SCORE_CLAIM_TTL_MS = 1500;

interface Props {
  /** Optional override — primarily for tests. */
  ttlMs?: number;
}

export function UnverifiedScoreClaimAnnouncer({
  ttlMs = UNVERIFIED_SCORE_CLAIM_TTL_MS,
}: Props = {}) {
  const { lang } = useLang();
  const { messages } = useMessages();
  const lastAnnouncedRef = useRef<string | null>(null);
  const [message, setMessage] = useState("");

  // Find the trailing assistant turn. Skip:
  //   - error bubbles (NetworkErrorAnnouncer owns those)
  //   - streaming-incomplete bodies are surfaced once they settle —
  //     but checking text shape every chunk is fine; the dedupe
  //     ref guarantees we only announce once per id.
  let candidateId: string | null = null;
  let candidateText = "";
  let alreadyRedacted = false;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m) continue;
    if (m.role !== "assistant") continue;
    if (m.isError === true) continue;
    candidateId = typeof m.id === "string" ? m.id : null;
    candidateText = typeof m.text === "string" ? m.text : "";
    alreadyRedacted =
      typeof m.unverifiedScoreClaimsRedacted === "number" &&
      m.unverifiedScoreClaimsRedacted > 0;
    break;
  }

  useEffect(() => {
    if (alreadyRedacted) return undefined;
    if (!containsUnverifiedScoreClaim(candidateText)) return undefined;
    const announce = shouldAnnounceUnverifiedScoreClaim({
      messageId: candidateId,
      lastAnnouncedId: lastAnnouncedRef.current,
    });
    if (!announce) return undefined;
    setMessage(
      unverifiedScoreClaimAnnouncementText({
        lang: lang === "kz" ? "kz" : "ru",
      }),
    );
    lastAnnouncedRef.current = candidateId;
    const id = window.setTimeout(() => setMessage(""), ttlMs);
    return () => window.clearTimeout(id);
  }, [candidateId, candidateText, alreadyRedacted, lang, ttlMs]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
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
      data-testid="unverified-score-claim-announcer"
    >
      {message}
    </div>
  );
}

export default UnverifiedScoreClaimAnnouncer;
