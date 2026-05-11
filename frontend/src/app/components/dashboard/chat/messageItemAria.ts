/**
 * s35 wave 38 (2026-04-28) — pure helper for per-message-bubble
 * `role="article"` + `aria-posinset`/`aria-setsize` + count-aware
 * aria-label.
 *
 * Boss roadmap row that's been parked since wave 21+: "MessageList
 * virtualization aria-rowcount/rowindex". This wave ships the
 * spiritual cousin without committing to virtualization yet —
 * `role="article"` inside a `role="log"` region with posinset /
 * setsize is the actual ARIA-recommended pattern for a chat
 * message list, and it works whether or not the list is later
 * virtualized (rowindex/rowcount only make sense for grid/table
 * roles).
 *
 * Pre-wave each `<div key={msg.id}>` in `ChatTranscript.tsx` was
 * a bare `<div>` with no role and no positional metadata. SR users
 * navigating with the article quickkey ('o' in NVDA) couldn't jump
 * between messages, and arrow-key reading just announced
 * undifferentiated text runs. Worse, on long threads (78+ messages
 * in the wild) there was no programmatic way to know where in the
 * conversation a given bubble sat.
 *
 * The helper composes:
 *   1. The `aria-label` so SR users hear the role + position +
 *      author + position-in-thread on first focus.
 *   2. The numeric posinset/setsize values, sanitised against
 *      garbage upstream.
 *
 * Output (RU):
 *   user, 1/5:        "Сообщение 1 из 5, ваше сообщение"
 *   assistant, 2/5:   "Сообщение 2 из 5, ответ Samga"
 *   error, 3/5:       "Сообщение 3 из 5, ошибка"
 *   streaming, 5/5:   "Сообщение 5 из 5, ответ Samga, генерируется"
 *
 * Output (KZ):
 *   user, 1/5:        "1-ден 5-ке дейінгі хабарлама, сіздің хабарламаңыз"
 *   assistant, 2/5:   "1-ден 5-ке дейінгі хабарлама, Samga жауабы"
 *   error, 3/5:       "1-ден 5-ке дейінгі хабарлама, қате"
 *   streaming, 5/5:   "1-ден 5-ке дейінгі хабарлама, Samga жауабы, жасалуда"
 *
 * Pure: no DOM, no React, no Intl. Defensive against unknown
 * lang, unknown role, null/NaN/Infinity/negative/float counts +
 * positions, position > total, position < 1.
 */

export type MessageItemLang = "ru" | "kz";
export type MessageItemRole = "user" | "assistant" | "error";

interface Args {
  /** Author of the bubble. Anything other than "user" / "assistant"
   *  / "error" → defensive default to "assistant". */
  role: unknown;
  /** 1-based position within the thread. */
  position: unknown;
  /** Total messages in the thread. Must be >= position to be
   *  meaningful; otherwise we clamp. */
  total: unknown;
  /** Whether THIS bubble is currently being streamed in. Only
   *  meaningful for assistant-role and only at the tail of the
   *  list — caller is responsible for those checks; the helper
   *  just appends the streaming cue if true. */
  streaming: unknown;
  lang: unknown;
}

interface Result {
  ariaLabel: string;
  /** 1-based position-in-set, sanitised. Always >= 1. */
  posInSet: number;
  /** Total set size, sanitised. Always >= posInSet. */
  setSize: number;
  /** Stable role token for callers that want the resolved value
   *  (e.g. to mirror it into a data-attr for testing). */
  resolvedRole: MessageItemRole;
}

function safeLang(lang: unknown): MessageItemLang {
  return lang === "kz" ? "kz" : "ru";
}

function safeRole(role: unknown): MessageItemRole {
  if (role === "user" || role === "assistant" || role === "error") {
    return role;
  }
  return "assistant";
}

function safePos(p: unknown): number {
  if (typeof p === "number" && Number.isFinite(p)) {
    return Math.max(1, Math.floor(p));
  }
  return 1;
}

function safeTotal(t: unknown, posMin: number): number {
  if (typeof t === "number" && Number.isFinite(t)) {
    return Math.max(posMin, Math.floor(t));
  }
  return posMin;
}

function safeBool(v: unknown): boolean {
  return v === true;
}

const COPY = {
  ru: {
    head: (pos: number, total: number) => `Сообщение ${pos} из ${total}`,
    user: "ваше сообщение",
    assistant: "ответ Samga",
    error: "ошибка",
    streaming: "генерируется",
  },
  kz: {
    head: (pos: number, total: number) =>
      `${pos}-ден ${total}-ке дейінгі хабарлама`,
    user: "сіздің хабарламаңыз",
    assistant: "Samga жауабы",
    error: "қате",
    streaming: "жасалуда",
  },
} as const;

/** Pure helper — one call returns label + sanitised aria numerics
 *  + resolved role. */
export function messageItemAria(args: Args): Result {
  const lang = safeLang(args.lang);
  const role = safeRole(args.role);
  const pos = safePos(args.position);
  const total = safeTotal(args.total, pos);
  const streaming = safeBool(args.streaming);

  const c = COPY[lang];
  const head = c.head(pos, total);
  const tail =
    role === "user" ? c.user : role === "error" ? c.error : c.assistant;
  // Streaming cue only applies to assistant bubbles. (User/error
  // bubbles are immutable at render time — defensive: ignore the
  // flag for non-assistant roles so a stray `streaming=true`
  // upstream doesn't leak the cue into the wrong bubble.)
  const includeStreaming = streaming && role === "assistant";

  const parts = [head, tail];
  if (includeStreaming) parts.push(c.streaming);

  return {
    ariaLabel: parts.join(", "),
    posInSet: pos,
    setSize: total,
    resolvedRole: role,
  };
}
