/**
 * s30 (D5, 2026-04-27) — RetryPill.
 *
 * Slate spinner pill that fires while `useSendMessage` is silently
 * retrying a transient 5xx on `/api/chat/stream`. Sibling to the
 * other s29/s30 trust-signal chips (RedactionPill, SourcesDrawer,
 * FailedToolPill, GeneralKnowledgePill, InterruptedPill) — same
 * placement language, same bilingual copy convention.
 *
 * Why it exists: today, when the SSE endpoint returns 502/503/504,
 * the FE silently falls back to REST. The user sees an extra-long
 * "Думает…" with no signal that something went wrong. The pill
 * tells them "we hit a transient hiccup, retrying" so a slow first
 * answer reads as deliberate, not as a frozen UI.
 *
 * Pure helpers `shouldShowRetryPill`, `retryPillLabel`, and
 * `isTransient5xx` are exported for vitest. The classifier is the
 * single point of truth for which HTTP statuses warrant the
 * silent-retry branch — change it here, the call site in
 * useSendMessage picks it up.
 */

import { Loader2 } from "lucide-react";
import { useLang } from "../../LanguageContext";
import { useReducedMotion } from "./useReducedMotion";
import { motionClass } from "./reducedMotion";

interface Props {
  isRetrying?: boolean | null;
}

/** Pure predicate — exported for vitest. */
export function shouldShowRetryPill(isRetrying?: boolean | null): boolean {
  return isRetrying === true;
}

/** Pure label helper — bilingual. Exported for vitest. */
export function retryPillLabel(lang: "ru" | "kz"): string {
  return lang === "kz" ? "Қайта тырысу..." : "Повторная попытка...";
}

/** Classifier for "is this status worth a silent retry?" — exported
 *  so vitest pins the policy and so the call site in useSendMessage
 *  has one canonical helper to import. We deliberately scope the
 *  retry to canonical 5xx + Cloudflare 52x: 4xx is a client error
 *  (don't retry), 1xx/2xx aren't errors, 3xx are redirects fetch
 *  follows automatically. */
export function isTransient5xx(status: number): boolean {
  if (!Number.isFinite(status)) return false;
  if (status === 502 || status === 503 || status === 504) return true;
  // Cloudflare/edge transients — 520..524 (origin unreachable, timeout,
  // SSL handshake fail). Same intent: try once more before giving up.
  if (status >= 520 && status <= 524) return true;
  return false;
}

export function RetryPill({ isRetrying }: Props) {
  const { lang } = useLang();
  // s34 wave 11 (G6): the spinner is decorative for this pill —
  // copy + slate styling already convey "retrying soon". Suppress
  // the spin when the user has asked for reduced motion.
  const reduce = useReducedMotion();
  if (!shouldShowRetryPill(isRetrying)) return null;
  const langSafe = (lang === "kz" ? "kz" : "ru") as "ru" | "kz";
  return (
    <div
      className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 samga-anim-pill"
      role="status"
      aria-live="polite"
    >
      <Loader2
        className={`h-3 w-3 ${motionClass(reduce, "animate-spin", "")}`.trim()}
        aria-hidden="true"
      />
      <span>{retryPillLabel(langSafe)}</span>
    </div>
  );
}

export default RetryPill;
