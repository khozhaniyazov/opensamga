/**
 * s34 wave 6 (E4, 2026-04-28): pure helpers to format a single chat
 * thread as Markdown or JSON for user-initiated download.
 *
 * Boss ask (chat UI/UX roadmap §E4): give the user a one-click
 * "Export this conversation" affordance from the thread rail. We do
 * NOT round-trip through the backend — the FE already loaded the
 * thread's messages from /chat/history, so the export is local and
 * works offline once the thread is open.
 *
 * Keep this module pure (no React, no DOM, no fetch) so it can be
 * unit-tested as a golden via vitest. The calling site (ThreadRail)
 * is responsible for the network fetch (so it can export threads
 * other than the currently-active one) and for invoking the
 * `triggerDownload` helper, which is the only function in this file
 * that touches the DOM.
 *
 * Format conventions:
 *   - Markdown: human-readable. One H1 with the thread title, then
 *     each message as `### {Speaker}` heading + body. We strip the
 *     internal `<think>...</think>` blocks (those leaked once before
 *     in the history response and the user shouldn't see raw chain-
 *     of-thought in their export). We do NOT include tool-call parts
 *     or thinking parts — they're internal scaffolding.
 *   - JSON: a stable schema with `version: 1` so we can extend later
 *     without breaking older parsers. Includes the metadata blob
 *     verbatim so a future "import" feature is possible.
 */

import type { ChatThread } from "./MessagesContext";
import type { Message } from "./types";
import { stripReasoningBlocks } from "./utils";

/** Wire-format version. Bump when we make a breaking schema change. */
export const THREAD_EXPORT_JSON_VERSION = 1 as const;

/** ISO-8601 produced via toISOString(); kept as a constant so tests can assert. */
export const THREAD_EXPORT_DATE_FORMAT = "iso8601" as const;

/** Markdown MIME for the Blob download. */
export const THREAD_EXPORT_MARKDOWN_MIME =
  "text/markdown;charset=utf-8" as const;

/** JSON MIME for the Blob download. */
export const THREAD_EXPORT_JSON_MIME =
  "application/json;charset=utf-8" as const;

export type ThreadExportFormat = "markdown" | "json";

/** Default thread title fallback when the row has neither title nor messages. */
export const THREAD_EXPORT_FALLBACK_TITLE = "Untitled thread" as const;

/** Resolve a human-readable title for a thread. Used by both formats. */
export function resolveThreadTitle(thread: Pick<ChatThread, "title">): string {
  const t = (thread.title || "").trim();
  return t.length > 0 ? t : THREAD_EXPORT_FALLBACK_TITLE;
}

/** Sanitize a string so it's safe as a filename across Windows/macOS/Linux.
 *  - replaces forbidden chars (`<>:"/\|?*` and ASCII control) with `_`
 *  - collapses runs of whitespace/underscore to a single underscore
 *  - trims leading/trailing dots+spaces (Windows hates those)
 *  - clamps to 80 chars (most filesystems are fine but 255 invites trouble)
 */
export function sanitizeFilenameSegment(raw: string): string {
  const cleaned = raw
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._\s]+|[._\s]+$/g, "");
  const trimmed = cleaned.length > 80 ? cleaned.slice(0, 80) : cleaned;
  return trimmed.length > 0 ? trimmed : "thread";
}

/** Build a deterministic filename like `samga-chat-{slug}-{yyyymmdd}.md`.
 *  Pure; takes a Date so tests can pin the timestamp. */
export function buildExportFilename(
  thread: Pick<ChatThread, "title">,
  format: ThreadExportFormat,
  now: Date = new Date(),
): string {
  const slug = sanitizeFilenameSegment(resolveThreadTitle(thread));
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const ext = format === "markdown" ? "md" : "json";
  return `samga-chat-${slug}-${yyyy}${mm}${dd}.${ext}`;
}

/** Speaker label used in the markdown export. We deliberately use
 *  English here — the export is a portable artefact a user might
 *  share with a tutor whose UI language differs. */
function speakerLabel(role: Message["role"]): string {
  return role === "assistant" ? "Assistant" : "You";
}

/** Format a single message as a markdown section. Internal helper. */
function messageToMarkdownSection(msg: Message): string {
  const heading = `### ${speakerLabel(msg.role)}`;
  // stripReasoningBlocks is idempotent on already-clean text but is
  // load-bearing for legacy persisted messages whose content still
  // carries `<think>...</think>` envelopes.
  const body = stripReasoningBlocks(msg.text || "").trim();
  if (body.length === 0) {
    return `${heading}\n\n_(empty)_`;
  }
  return `${heading}\n\n${body}`;
}

/** Convert a thread + its messages into a single Markdown document.
 *  Pure; safe to test as a golden. */
export function formatThreadAsMarkdown(
  thread: Pick<ChatThread, "title" | "id" | "created_at" | "updated_at">,
  messages: Message[],
  now: Date = new Date(),
): string {
  const title = resolveThreadTitle(thread);
  const headerLines: string[] = [`# ${title}`, ""];
  if (thread.created_at) {
    headerLines.push(`- Created: ${thread.created_at}`);
  }
  if (thread.updated_at) {
    headerLines.push(`- Updated: ${thread.updated_at}`);
  }
  headerLines.push(`- Exported: ${now.toISOString()}`);
  headerLines.push(`- Messages: ${messages.length}`);
  headerLines.push("");
  const body = messages.map(messageToMarkdownSection).join("\n\n---\n\n");
  return `${headerLines.join("\n")}\n${body}\n`;
}

/** Stable JSON envelope. Bump THREAD_EXPORT_JSON_VERSION before
 *  changing existing fields; additive changes don't need a bump. */
export interface ThreadExportEnvelope {
  version: typeof THREAD_EXPORT_JSON_VERSION;
  exported_at: string;
  thread: {
    id: number | null;
    title: string;
    created_at: string | null;
    updated_at: string | null;
  };
  messages: Array<{
    role: Message["role"];
    text: string;
    rag_query_log_id?: number | null;
    parts?: Message["parts"];
  }>;
}

/** Build the JSON envelope. Pure. */
export function formatThreadAsJsonEnvelope(
  thread: Pick<ChatThread, "title" | "id" | "created_at" | "updated_at">,
  messages: Message[],
  now: Date = new Date(),
): ThreadExportEnvelope {
  return {
    version: THREAD_EXPORT_JSON_VERSION,
    exported_at: now.toISOString(),
    thread: {
      id: thread.id ?? null,
      title: resolveThreadTitle(thread),
      created_at: thread.created_at ?? null,
      updated_at: thread.updated_at ?? null,
    },
    messages: messages.map((m) => ({
      role: m.role,
      text: stripReasoningBlocks(m.text || ""),
      rag_query_log_id: m.ragQueryLogId ?? null,
      parts: m.parts,
    })),
  };
}

/** Pretty-print the JSON envelope as a string for download. */
export function formatThreadAsJson(
  thread: Pick<ChatThread, "title" | "id" | "created_at" | "updated_at">,
  messages: Message[],
  now: Date = new Date(),
): string {
  return JSON.stringify(
    formatThreadAsJsonEnvelope(thread, messages, now),
    null,
    2,
  );
}

/** DOM-touching helper. Triggers a browser download of `body` as
 *  `filename` with `mime`. Kept separate from the formatters so the
 *  pure logic above is testable in jsdom-free contexts.
 *
 *  The implementation creates an anchor, clicks it, and revokes the
 *  blob URL after a tick so Safari/Firefox don't tear down the URL
 *  before the download is initiated. */
export function triggerThreadDownload(
  filename: string,
  mime: string,
  body: string,
): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  // Defer revoke so the click handler in some browsers has a chance
  // to enqueue the download before the URL is torn down. Magic
  // number lifted from the same pattern in services/api.js.
  setTimeout(() => {
    URL.revokeObjectURL(url);
    if (a.parentNode) a.parentNode.removeChild(a);
  }, 0);
}
