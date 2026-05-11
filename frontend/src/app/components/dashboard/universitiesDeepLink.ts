/**
 * universitiesDeepLink.ts — v3.29
 *
 * Pure helpers for the UniversitiesPage `?major_code=...` deep-link
 * contract. The deep link is minted by Strategy Lab profile-pair
 * simulator entries (`major.deep_link`) and points users from a
 * specific subject-pair major to the list of universities offering it.
 *
 * No React, no fetch, no JSX — just URL parsing + querystring
 * round-tripping so the page tests can assert on the contract.
 */

/** Shape of the parsed deep-link parameters. */
export interface UniversitiesDeepLink {
  /** Trimmed, uppercased major code (e.g. "B057"), or null when absent. */
  majorCode: string | null;
}

const MAX_CODE_LENGTH = 16;

/**
 * Parse a `URLSearchParams` (or anything supporting `.get(name)`) into
 * the deep-link shape. Defensive against:
 *   - missing param            → majorCode === null
 *   - empty / whitespace value → majorCode === null
 *   - garbage (e.g. "<script>") → null (only [A-Za-z0-9-_] allowed)
 *   - >16 chars               → null (sentinel — real codes are ≤6)
 */
export function parseUniversitiesDeepLink(
  params: { get: (name: string) => string | null } | null | undefined,
): UniversitiesDeepLink {
  if (!params) {
    return { majorCode: null };
  }
  const raw = params.get("major_code");
  if (raw === null || raw === undefined) {
    return { majorCode: null };
  }
  const trimmed = String(raw).trim();
  if (!trimmed) {
    return { majorCode: null };
  }
  if (trimmed.length > MAX_CODE_LENGTH) {
    return { majorCode: null };
  }
  // Allow only conservative URL-safe characters. Real major codes are
  // shapes like "B057", "M048" — letters + digits, occasionally a
  // dash. This is a defense-in-depth check: the BE filter is also
  // case-insensitive on a stripped string.
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    return { majorCode: null };
  }
  return { majorCode: trimmed.toUpperCase() };
}

/**
 * Build the querystring (sans leading `?`) for a `/data/universities`
 * GET. Returns "" when no filters are set so callers can safely
 * concatenate.
 */
export function buildUniversitiesQuery(opts: {
  query?: string | null;
  majorCode?: string | null;
}): string {
  const params = new URLSearchParams();
  const q = (opts.query ?? "").trim();
  if (q) {
    params.set("query", q);
  }
  const code = (opts.majorCode ?? "").trim();
  if (code) {
    params.set("major_code", code);
  }
  return params.toString();
}
