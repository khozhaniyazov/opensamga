/**
 * s35 wave 68 (2026-04-28) — telemetry PII / size guard.
 *
 * Until wave 68 the `track()` entry point accepted any
 * Record<string, unknown> and trusted the call sites to never
 * include PII. As we accumulated events through w55–w62
 * (telemetry spree) it became increasingly likely that a future
 * wave would add a payload field that incidentally captures user
 * input — e.g. a "search query" event whose `query` field is
 * literal user text, or a "feedback comment" event whose `text`
 * field is verbatim free-form prose.
 *
 * This helper normalises an event payload BEFORE it lands in the
 * buffer:
 *
 *   - Drops keys that are common PII shapes:
 *       email      → "***"
 *       phone      → "***"
 *       password   → "***" (anything containing "password" or "token")
 *
 *   - Truncates long string values to MAX_STRING_LEN (a tunable
 *     constant).  Long strings in telemetry usually mean a free-
 *     form text field leaked through and we don't want
 *     unbounded-length events on the wire either way.
 *
 *   - Recursively walks nested objects up to MAX_DEPTH so a deeply-
 *     nested payload can't smuggle PII past the surface scan.
 *     Beyond MAX_DEPTH the value is replaced with "[depth-cut]".
 *
 *   - Leaves non-string scalars (numbers, booleans, null) intact —
 *     those are how dashboards count things.
 *
 * Pure helper, fully testable. Wired into `track()` at module
 * scope so every emit goes through it.
 */

export const MAX_STRING_LEN = 256;
export const MAX_DEPTH = 4;
const REDACT = "***";
const DEPTH_CUT = "[depth-cut]";

/**
 * Lower-case substrings — if any of these appear anywhere in the
 * key (case-insensitive) we redact the value. Keep this list
 * conservative; widening it later is easy, narrowing is hard
 * (dashboards may already depend on a column).
 */
const REDACT_KEY_SUBSTRINGS = [
  "email",
  "phone",
  "password",
  "token",
  "secret",
  "ssn",
  "iin", // KZ national id format — common UNT-platform field
];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function shouldRedactKey(key: string): boolean {
  const lower = key.toLowerCase();
  return REDACT_KEY_SUBSTRINGS.some((s) => lower.includes(s));
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return DEPTH_CUT;
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (value.length > MAX_STRING_LEN) {
      return value.slice(0, MAX_STRING_LEN) + "…";
    }
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeValue(v, depth + 1));
  }
  if (isPlainObject(value)) {
    return sanitizeProps(value, depth + 1);
  }
  // Anything else (functions, symbols, class instances) — coerce
  // to a tag so it can't smuggle a toString() that happens to
  // contain PII.
  return `[${typeof value}]`;
}

export function sanitizeProps(
  props: Record<string, unknown>,
  depth = 0,
): Record<string, unknown> {
  if (!isPlainObject(props)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (shouldRedactKey(key)) {
      out[key] = REDACT;
      continue;
    }
    out[key] = sanitizeValue(value, depth);
  }
  return out;
}
