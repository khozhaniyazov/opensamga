/**
 * s33 (D6, 2026-04-28) — backpressure pill UI.
 *
 * Renders a subtle "Сеть медленная — догоняем…" chip when the
 * streaming has been sending for >= LAG_THRESHOLD_MS without a
 * delta landing. Hides itself otherwise.
 *
 * Lives next to ChatTranscript's streaming cursor so it sits in
 * the user's eye-line during a stuck stream.
 */

import { useEffect, useRef, useState } from "react";
import { Wifi } from "lucide-react";
import { useLang } from "../../LanguageContext";
import {
  BACKPRESSURE_POLL_MS,
  backpressureLabel,
  isRealDelta,
  shouldShowBackpressure,
} from "./backpressure";
import { backpressureAriaLabel } from "./backpressureAria";

interface Props {
  /** Are we currently streaming? Source: useMessages().isSending. */
  isSending: boolean;
  /** Live text of the streaming assistant turn. We watch its length
   *  growth to decide when the last "real" delta landed. */
  streamingText: string;
}

export function BackpressureIndicator({ isSending, streamingText }: Props) {
  const { lang } = useLang();
  const langSafe = (lang === "kz" ? "kz" : "ru") as "ru" | "kz";

  // The wall-clock ms of the last real text growth. Set on a real
  // delta; reset to "now" each time we start a new send so the
  // first ~3.5s after Send don't trigger a false-positive pill.
  const [lastDeltaAt, setLastDeltaAt] = useState<number | null>(null);
  const prevTextRef = useRef<string>("");
  const prevSendingRef = useRef<boolean>(false);
  const [now, setNow] = useState<number>(() => Date.now());

  // Track text growth → lastDeltaAt.
  useEffect(() => {
    if (isRealDelta(prevTextRef.current, streamingText)) {
      setLastDeltaAt(Date.now());
    }
    prevTextRef.current = streamingText;
  }, [streamingText]);

  // On send-start (false → true transition), prime lastDeltaAt to
  // the current time so the first 3.5s aren't classified as lag.
  useEffect(() => {
    if (isSending && !prevSendingRef.current) {
      setLastDeltaAt(Date.now());
      prevTextRef.current = "";
    }
    if (!isSending && prevSendingRef.current) {
      // Send finished — clear so the pill doesn't linger after
      // stream-complete.
      setLastDeltaAt(null);
    }
    prevSendingRef.current = isSending;
  }, [isSending]);

  // Drive a poll so the pill flips ON without waiting for the next
  // delta. Only runs while sending — quiet at rest.
  useEffect(() => {
    if (!isSending) return;
    const t = setInterval(() => setNow(Date.now()), BACKPRESSURE_POLL_MS);
    return () => clearInterval(t);
  }, [isSending]);

  const visible = shouldShowBackpressure({
    isSending,
    lastDeltaAt,
    now,
  });
  if (!visible) return null;

  const label = backpressureLabel(langSafe);
  // s35 wave 25e (2026-04-28): consequence-aware aria-label so SR
  // users get parity with sighted users plus an extra hint that
  // the request is still alive and Esc cancels.
  const aria = backpressureAriaLabel(langSafe);
  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={aria}
      className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-700 align-middle"
      style={{ fontSize: 11, fontWeight: 600 }}
    >
      <Wifi size={12} className="opacity-80" aria-hidden />
      <span aria-hidden="true">{label}</span>
    </span>
  );
}

export default BackpressureIndicator;
