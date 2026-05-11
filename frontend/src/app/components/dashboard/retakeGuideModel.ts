/**
 * retakeGuideModel.ts — v3.28
 *
 * Pure helpers + types mirroring the BE service module
 * `app.services.retake_guide`.  No JSX, no fetch, no React.
 */

export type RetakeSessionKind = "main" | "additional" | "supplementary";

export interface RetakeSession {
  id: string;
  kind: RetakeSessionKind;
  starts_on: string;
  ends_on: string;
  registration_deadline: string | null;
  labels: { ru: string; kz: string };
}

export interface RetakeBand {
  low: number;
  mid: number;
  high: number;
}

export interface RetakeGuidePayload {
  language: "ru" | "kz";
  strings: Record<string, string>;
  sessions: RetakeSession[];
  sessions_source: "live" | "fallback";
  policy: {
    max_attempts_per_cycle: number;
    fee_kzt: number;
    cooldown_days_between_attempts: number;
  };
  estimator: {
    current_score: number | null;
    weeks_until_session: number;
    delta: RetakeBand;
  };
}

/** Locale-aware date string for an ISO yyyy-mm-dd. Returns "—" on null. */
export function formatRetakeDate(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return "—";
  }
  return new Date(ms).toLocaleDateString();
}

/** Format the cost in KZT as e.g. "6 500 ₸". Defensive against NaN. */
export function formatRetakeFee(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) {
    return "—";
  }
  // Pure helper — runs in node + jsdom alike, where Intl is available.
  const formatted = new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
  return `${formatted} ₸`;
}

/** Days until a given ISO date. Negative if already past. NaN-safe. */
export function daysUntil(iso: string, now: number = Date.now()): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return Number.NaN;
  }
  return Math.ceil((ms - now) / 86_400_000);
}

/** Map a session kind to its localized label using payload strings. */
export function sessionKindLabel(
  kind: RetakeSessionKind,
  strings: Record<string, string>,
): string {
  const key = `kind_${kind}`;
  return strings[key] ?? kind;
}

/**
 * Build the querystring (sans leading `?`) for
 * `GET /api/strategy/retake-guide`.
 *
 * **Contract pin (v3.31):** the BE handler at
 * `backend/app/routers/strategy.py:get_retake_guide` accepts the
 * param under the name **`language`**, not `lang`. v3.28 shipped a
 * silent mismatch (FE sent `lang=kz`, BE fell back to RU default),
 * so this helper exists as the single source of truth — change the
 * key here only with a coordinated BE change.
 *
 * - `lang` is normalized to `kz` for any value starting with "kz",
 *   else `ru`. Mirrors the BE's `lang.lower().startswith("kz")`.
 * - `weeks_until_session` is clamped to the BE-accepted range 0..52.
 * - `current_score` is omitted when undefined / non-finite (BE
 *   defaults to None and shows the conservative band).
 */
export function buildRetakeGuideQuery(opts: {
  lang: string;
  weeksUntilSession: number;
  currentScore?: number | null;
}): string {
  const params = new URLSearchParams();

  const normalized = String(opts.lang ?? "")
    .toLowerCase()
    .startsWith("kz")
    ? "kz"
    : "ru";
  params.set("language", normalized);

  const weeksRaw = Number(opts.weeksUntilSession);
  const weeks = Number.isFinite(weeksRaw) ? weeksRaw : 0;
  const clamped = Math.max(0, Math.min(52, Math.trunc(weeks)));
  params.set("weeks_until_session", String(clamped));

  if (
    opts.currentScore !== null &&
    opts.currentScore !== undefined &&
    Number.isFinite(opts.currentScore)
  ) {
    params.set("current_score", String(Math.trunc(opts.currentScore)));
  }

  return params.toString();
}
