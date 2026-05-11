/**
 * s35 wave 18a (2026-04-28) — pure helper for the composer's
 * visible counter pill `title` tooltip + complete SR-readable
 * status string.
 *
 * Today the visible counter renders bare digits ("4123 / 8000") and
 * a hidden "over" hint that only fires once you cross the hard cap.
 * For sighted hover users + AT users that surface the `title`
 * attribute, we want a one-shot phrase that explains what those
 * numbers actually mean. This helper delivers:
 *
 *   below soft cap : "4123 из 8000 символов"
 *   between caps   : "5400 из 8000 символов · приближаемся к лимиту"
 *   over hard cap  : "8200 из 8000 символов · превышен лимит на 200"
 *
 * The "over by N" delta surfaces the **exact** amount the user has
 * to delete — pleasant complement to the wave-17b send-button
 * over-limit aria, which already names the cap. No bucket logic is
 * duplicated; the helper accepts an explicit `state` argument
 * derived elsewhere (typically by `composerSendButtonState` from
 * wave 17b for the over-limit/sending branches, plus the soft-cap
 * comparison the visible pill already does locally).
 *
 * Pure: no DOM, no React, no Intl*. Defensive against null /
 * non-finite numbers. RU + KZ; unknown lang falls back to RU.
 */

export type ComposerCounterLang = "ru" | "kz";

export type ComposerCounterStatus = "below" | "near" | "over";

export interface ComposerCounterStatusArgs {
  /** Current character count of the textarea (typically
   *  `input.length`). Coerced to non-negative integer. */
  len: number | null | undefined;
  /** Soft warning threshold (used to derive `near` when the helper
   *  is invoked without an explicit status). Coerced to positive
   *  integer; falls back to `Math.floor(hard * 0.8)` when null /
   *  non-finite — same shape as `composerCounterAnnounce.warn`. */
  soft?: number | null;
  /** Hard cap (block-submit). Coerced to positive integer. */
  hard: number | null | undefined;
  lang: ComposerCounterLang;
}

function safeInt(n: unknown, fallback: number): number {
  if (typeof n === "number" && Number.isFinite(n)) {
    return Math.max(0, Math.floor(n));
  }
  return fallback;
}

/** Pure predicate — derives the bucket. Exported so callers can
 *  align other UI signals (red color, send button state) with the
 *  same boundaries. */
export function composerCounterStatus(
  args: ComposerCounterStatusArgs,
): ComposerCounterStatus {
  const len = safeInt(args.len, 0);
  const hard = safeInt(args.hard, Number.MAX_SAFE_INTEGER);
  const softRaw = args.soft;
  const soft =
    typeof softRaw === "number" && Number.isFinite(softRaw)
      ? Math.max(0, Math.floor(softRaw))
      : Math.floor(hard * 0.8);
  if (len > hard) return "over";
  if (len >= soft) return "near";
  return "below";
}

/** Pure helper — full SR-readable status phrase. */
export function composerCounterStatusLabel(
  args: ComposerCounterStatusArgs,
): string {
  const langSafe: ComposerCounterLang = args.lang === "kz" ? "kz" : "ru";
  const len = safeInt(args.len, 0);
  const hard = safeInt(args.hard, Number.MAX_SAFE_INTEGER);
  const status = composerCounterStatus(args);
  const charsWord = langSafe === "kz" ? "таңба" : "символов";
  const ofWord = langSafe === "kz" ? "/" : "из";
  // Base "N <of> M <chars>" phrase, identical for all three buckets
  // so SR users hear a stable lead-in regardless of state.
  const head =
    langSafe === "kz"
      ? `${len} ${ofWord} ${hard} ${charsWord}`
      : `${len} ${ofWord} ${hard} ${charsWord}`;
  if (status === "below") return head;
  if (status === "near") {
    const tail = langSafe === "kz" ? "лимитке жақын" : "приближаемся к лимиту";
    return `${head} · ${tail}`;
  }
  // over
  const over = Math.max(1, len - hard);
  const tail =
    langSafe === "kz"
      ? `лимит ${over} таңбаға асып кетті`
      : `превышен лимит на ${over}`;
  return `${head} · ${tail}`;
}
