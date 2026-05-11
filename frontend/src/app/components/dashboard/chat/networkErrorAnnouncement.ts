/**
 * s35 wave 39 (2026-04-28) — pure helpers for the network-error
 * SR live-region (the last parked bigger-ask from the wave-37
 * sweep).
 *
 * Pre-wave when a send fails the user gets either:
 *   1. A structured error bubble inside the transcript (role="log"
 *      aria-live="polite") — SR users hear it eventually but
 *      politely-queued behind every other chunk that may still be
 *      flowing.
 *   2. A modal popping (429 limit / 403 paywall) — SR users may
 *      not catch it immediately because the modal-mount
 *      announcement is implicit, not a direct aria-live update.
 * Either way there's no concise, ASSERTIVE "send failed" cue
 * analogous to `StreamCompleteAnnouncer`'s "Ответ готов" ping.
 *
 * This wave ships the SR-only counterpart: a separate live-region
 * outside the transcript, fed by these pure helpers.
 *
 * Design constraints:
 *   - Must dedupe so re-render of the same error doesn't
 *     re-announce. Stable predicate via incoming "lastErrorId".
 *   - Must be assertive (SR interrupts whatever's being read so
 *     the user knows their send went nowhere).
 *   - Must clear after a TTL so a re-mount of the same thread
 *     doesn't re-announce the historical error.
 *   - Defensive: unknown lang → ru, non-string id → null,
 *     non-finite status → "generic" branch.
 *
 * Output (RU):
 *   429:        "Достигнут дневной лимит сообщений"
 *   403:        "Нужна подписка для этой возможности"
 *   network:    "Не удалось отправить сообщение. Проверьте соединение и попробуйте ещё раз"
 *   generic:    same network message (deliberate — most "other"
 *               failures are connectivity / 5xx and the user can
 *               just retry)
 *
 * Output (KZ): full uninflected mirror.
 *
 * Pure: no DOM, no React, no Intl. All defensive coercion via
 * strict-equality checks.
 */

export type NetworkErrorLang = "ru" | "kz";

/** Reason taxonomy. Caller maps HTTP status / error class to one
 *  of these tokens; keeping the helper away from raw status codes
 *  means we can extend the taxonomy (e.g. 504 timeout, 502 bad
 *  gateway, native `TypeError` from offline fetch) without
 *  growing the helper signature. */
export type NetworkErrorReason = "limit" | "paywall" | "network" | "generic";

interface AnnouncementArgs {
  reason: unknown;
  lang: unknown;
}

interface DedupeArgs {
  /** id of the last error bubble in the transcript (or any stable
   *  per-error key). null/undefined when there's no error. */
  errorId: unknown;
  /** id of the last error we ALREADY announced. */
  lastAnnouncedId: unknown;
}

function safeLang(lang: unknown): NetworkErrorLang {
  return lang === "kz" ? "kz" : "ru";
}

function safeReason(reason: unknown): NetworkErrorReason {
  if (
    reason === "limit" ||
    reason === "paywall" ||
    reason === "network" ||
    reason === "generic"
  ) {
    return reason;
  }
  return "generic";
}

const COPY = {
  ru: {
    limit: "Достигнут дневной лимит сообщений",
    paywall: "Нужна подписка для этой возможности",
    network:
      "Не удалось отправить сообщение. Проверьте соединение и попробуйте ещё раз",
    generic:
      "Не удалось отправить сообщение. Проверьте соединение и попробуйте ещё раз",
  },
  kz: {
    limit: "Күндік хабарлама шегіне жетті",
    paywall: "Бұл мүмкіндік үшін жазылым қажет",
    network: "Хабарлама жіберілмеді. Желіні тексеріп, қайталап көріңіз",
    generic: "Хабарлама жіберілмеді. Желіні тексеріп, қайталап көріңіз",
  },
} as const;

/** Pure helper — concise SR sentence for the assertive
 *  live-region. */
export function networkErrorAnnouncementText({
  reason,
  lang,
}: AnnouncementArgs): string {
  return COPY[safeLang(lang)][safeReason(reason)];
}

/** Pure helper — translate an HTTP-ish status code to the canon
 *  reason taxonomy. Keeping this here (rather than scattering
 *  status-code switches at call sites) so future status mappings
 *  stay one-place. */
export function networkErrorReasonForStatus(
  status: unknown,
): NetworkErrorReason {
  if (typeof status !== "number" || !Number.isFinite(status)) {
    return "generic";
  }
  if (status === 429) return "limit";
  if (status === 403) return "paywall";
  if (status === 0 || status === 408 || status === 504 || status === 502) {
    // 0 = aborted/native-fetch-no-network, 408 = request timeout,
    // 504 = gateway timeout, 502 = bad gateway. All connectivity-
    // shaped failures.
    return "network";
  }
  return "generic";
}

/** Pure helper — should we re-announce given the current error
 *  id and the last id we already announced? Strict-equality
 *  checks; null/undefined ids never re-announce; non-string ids
 *  (e.g. accidental object) don't re-announce either. */
export function shouldAnnounceNetworkError({
  errorId,
  lastAnnouncedId,
}: DedupeArgs): boolean {
  if (typeof errorId !== "string" || errorId === "") return false;
  if (typeof lastAnnouncedId === "string" && lastAnnouncedId === errorId) {
    return false;
  }
  return true;
}
