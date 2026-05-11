/**
 * Pure helpers for v3.24 deep-link wiring.
 *
 * v3.23 Weak Topic Mode emits URLs like:
 *   /dashboard/library?q={topic}&subject={subject}
 *   /dashboard/chat?topic={topic}&subject={subject}
 *
 * The library and chat pages call these to seed their UI. Param shape is
 * intentionally tolerant: subject may be missing, blank, or a backend
 * canonical string ("Mathematics", "History of Kazakhstan", ...). Topic may
 * also carry the raw cluster string from gap_analyzer (e.g. "Algebra > Equations").
 */

export interface WeakTopicLibraryParams {
  q: string | null;
  subject: string | null;
}

export interface WeakTopicChatParams {
  topic: string | null;
  subject: string | null;
}

/**
 * Read v3.23 library deep-link params from a URLSearchParams instance
 * (or a plain query string). Returns trimmed values or null when missing.
 */
export function parseLibraryDeepLinkParams(
  source: URLSearchParams | string | null | undefined,
): WeakTopicLibraryParams {
  const sp = toSearchParams(source);
  return {
    q: nonEmpty(sp?.get("q")),
    subject: nonEmpty(sp?.get("subject")),
  };
}

/**
 * Read v3.23 chat deep-link params. Returns trimmed values or null when missing.
 * Topic may be null even if subject is present; in that case the caller should
 * skip prefill (subject alone is not enough context).
 */
export function parseChatDeepLinkParams(
  source: URLSearchParams | string | null | undefined,
): WeakTopicChatParams {
  const sp = toSearchParams(source);
  return {
    topic: nonEmpty(sp?.get("topic")),
    subject: nonEmpty(sp?.get("subject")),
  };
}

/**
 * Render the chat composer prefill. Template should contain "{topic}" and
 * optionally "{subject}". Subject placeholder collapses cleanly if no subject
 * was supplied, so callers don't have to branch on the template shape.
 */
export function renderChatPrefill(
  template: string,
  params: WeakTopicChatParams,
): string {
  if (!params.topic) return "";
  const filled = template
    .replace("{topic}", params.topic)
    .replace("{subject}", params.subject ?? "");
  // Collapse stray empty parens / brackets left by a missing {subject}.
  return filled
    .replace(/\(\s*\)/g, "")
    .replace(/\[\s*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toSearchParams(
  source: URLSearchParams | string | null | undefined,
): URLSearchParams | null {
  if (!source) return null;
  if (source instanceof URLSearchParams) return source;
  try {
    return new URLSearchParams(source);
  } catch {
    return null;
  }
}

function nonEmpty(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}
