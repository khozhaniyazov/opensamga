/**
 * Phase B (s21, 2026-04-22): shared types for the chat feature.
 *
 * Extracted from ChatPage.tsx so MessagesContext, hooks, and the
 * split sub-components can import them without going through the
 * page-level orchestrator. Shape is intentionally forward-compatible
 * with Phase C:
 *
 *   - `Message.parts` is already reserved (§5 of DESIGN_CHAT_FLAGSHIP.md)
 *     so Phase B/C can add tool-result parts without breaking the
 *     current text-only renderer. For now we keep the legacy `text`
 *     string too; the renderer reads `text` and ignores `parts`.
 *   - `AssistantMetadata` matches what the backend writes to
 *     `chat_messages.message_metadata` AND what /api/chat returns on
 *     the top-level envelope (`book_id`, `page_number`,
 *     `rag_query_log_id`).
 */

export type ChatRole = "user" | "assistant";

/** Metadata the backend attaches to assistant replies — mirrors the
 *  top-level envelope fields on `/api/chat` and the `metadata` column
 *  echoed by `/api/chat/history`. All fields are nullable.
 *
 *  Phase C (s22): `parts` mirrors the shaped tool-result envelope the
 *  backend persists into `chat_messages.message_metadata.parts` so
 *  tool-result cards survive a hard reload (they were dropping before
 *  because the hydrator only read the three legacy fields). */
export interface AssistantMetadata {
  rag_query_log_id?: number | null;
  book_id?: number | null;
  page_number?: number | null;
  parts?: MessagePart[] | null;
  /** s27 (2026-04-27): how many sentences the agent loop's
   *  `_redact_unverified_score_claims` post-pass stripped from the
   *  reply because they paired a 2nd-person pronoun with a UNT-ish
   *  score number AND no user-data tool fired this turn. > 0 ⇒ the
   *  FE renders a RedactionPill so the user knows we suppressed
   *  unverified numbers and can ask for a tool-grounded answer. */
  unverified_score_claims_redacted?: number | null;
  /** s29 (A2, 2026-04-27): dedup'd list of (book_id, page_number)
   *  citations the agent actually consulted this turn. Populated only
   *  when the agent invoked `consult_library` and got hits. The FE
   *  renders this as the "Used N sources" SourcesDrawer below the
   *  bubble — clicking a row deep-links into the existing CitationChip
   *  flow. Persists across reload via message_metadata. */
  consulted_sources?: ConsultedSource[] | null;
  /** s30 (A4, 2026-04-27): per-tool failures from this turn. Drives
   *  the FailedToolPill below the bubble: "data fetch failed; answer
   *  is from general knowledge". Only persisted when non-empty. */
  failed_tool_calls?: FailedToolCall[] | null;
  /** s30 (A6, 2026-04-27): true iff the agent answered without firing
   *  any user-data tool (profile / mistakes / scores). Drives the
   *  GeneralKnowledgePill so the user knows the reply is not
   *  personalised. Persisted only when true (absence ⇒ false). */
  is_general_knowledge?: boolean | null;
}

/** s30 (A4, 2026-04-27): one row in the FailedToolPill feed. */
export interface FailedToolCall {
  name: string;
  error_preview: string;
}

/** s29 (A2, 2026-04-27): one row in the "Used N sources" drawer.
 *  Mirrors what `_harvest_consulted_sources` returns from the agent
 *  loop. `book_name`, `snippet`, and `score` are best-effort —
 *  defensive null-handling because legacy persisted rows from the
 *  pre-s29 envelope may only carry `book_id` + `page_number`. */
export interface ConsultedSource {
  book_id: number;
  page_number: number;
  book_name?: string | null;
  snippet?: string | null;
  score?: number | null;
  /** s32 (A5, 2026-04-27): ISO-8601 timestamp from
   *  `textbooks.updated_at`. Null on legacy snapshots whose row
   *  pre-dates the column being added or when the harvester couldn't
   *  coerce the upstream value. The FE OutdatedDataPill parses this
   *  via `Date()` and compares against the staleness threshold. */
  updated_at?: string | null;
}

/** Shape the backend returns from `/api/chat/history`. */
export interface ChatHistoryResponse {
  messages?: Array<{
    role: string;
    content: string;
    metadata?: AssistantMetadata | null;
  }>;
}

/** Shape the client sees from `sendMessage()` — the REST /api/chat
 *  envelope. `message` is the legacy alias for `content` that the
 *  `services/api.js` helper still returns. */
export interface ChatEnvelope {
  role?: string;
  content?: string;
  message?: string;
  rag_query_log_id?: number | null;
  book_id?: number | null;
  page_number?: number | null;
  /** Phase C (s22): structured tool-result parts from the backend.
   *  Not all envelopes have them — only turns that produced a
   *  recognised (grant_chance/historical_thresholds/
   *  recommend_universities/compare_universities) tool call whose
   *  shaper succeeded. */
  parts?: MessagePart[] | null;
  /** s27 (2026-04-27): mirrors AssistantMetadata.unverified_score_claims_redacted
   *  — also surfaced on the live `done` SSE envelope so the FE can
   *  light up RedactionPill before the message is persisted. */
  unverified_score_claims_redacted?: number | null;
  /** s29 (A2, 2026-04-27): mirrors AssistantMetadata.consulted_sources.
   *  Surfaces on both the SSE `done` frame and the REST envelope so
   *  the SourcesDrawer can render live and on reload. */
  consulted_sources?: ConsultedSource[] | null;
  /** s30 (A4, 2026-04-27): per-tool failures envelope feed. Same
   *  shape as AssistantMetadata.failed_tool_calls; mirrored on both
   *  REST + SSE done so the FailedToolPill renders live and on
   *  reload. */
  failed_tool_calls?: FailedToolCall[] | null;
  /** s30 (A6, 2026-04-27): mirrors AssistantMetadata.is_general_knowledge.
   *  Drives the GeneralKnowledgePill on the live SSE done frame and
   *  the REST envelope. */
  is_general_knowledge?: boolean | null;
}

/** Reserved for Phase C: structured message parts for tool results.
 *  Phase B does not emit these yet. Declared here so MessagesContext
 *  can type-check the `parts` accessor without a follow-up migration.
 *
 *  s24 agent harness (2026-04-26) extends this union with `thinking`
 *  (routed <think>...</think> from Qwen-family models) and adds a
 *  `status` field to `tool_call` so the renderer can show running /
 *  done / error states as the SSE stream lands. The persisted-history
 *  shape is unchanged for back-compat: server only ever stores
 *  `tool_call` parts in `done` state. */
export type ToolCallStatus = "running" | "done" | "error";

export type MessagePart =
  | { kind: "text"; text: string }
  | {
      kind: "tool_call";
      /** Stable id per call — matches the backend's `tool_call_started.id`. */
      id?: string;
      tool: string;
      args: Record<string, unknown>;
      result?: unknown;
      status?: ToolCallStatus;
      /** Truncated preview of the tool's raw response, for debug rows. */
      preview?: string;
      /** True if the tool errored. Renderer uses this for the red badge. */
      isError?: boolean;
      /** Wall-clock ms since `useSendMessage` saw `tool_call_started`. */
      started_at?: number;
      /** Wall-clock ms since `useSendMessage` saw `tool_result`. */
      ended_at?: number;
      /** Server-recorded duration in ms. Survives reload (the streaming
       *  client uses `started_at`/`ended_at` instead). */
      duration_ms?: number;
      /** Iteration index (1-based) the call belongs to — set by the
       *  agent loop's `iteration` SSE event. */
      iteration?: number;
    }
  | { kind: "thinking"; text: string }
  | {
      /** s26 (2026-04-26): synthetic part emitted by the FE on every
       *  `iteration` SSE event from the agent loop. ReasoningPanel
       *  renders these as numbered separators between tool-call rows
       *  so multi-pass agent runs read as `Шаг 1 → Шаг 2`. The
       *  backend does NOT emit these directly; persistence on reload
       *  reconstructs them from the `iteration` field on tool_call
       *  parts. */
      kind: "iteration";
      index: number;
    }
  | { kind: "citation"; bookId: number; pageNumber: number };

export interface Message {
  id: string;
  role: ChatRole;
  /** Rendered/text form — this is what AssistantMessage receives today. */
  text: string;
  /** Session 16: forwarded to FeedbackButtons so ratings attribute
   *  to the correct rag_query_log row. Absent on user messages and
   *  on assistant messages that did NOT consult the library. */
  ragQueryLogId?: number | null;
  /** Phase C slot — currently unused by the renderer. */
  parts?: MessagePart[];
  /** Phase C (s22): marks an assistant "error bubble" that failed to
   *  get a real response. When present, ChatTranscript renders a
   *  dedicated Retry affordance instead of FeedbackButtons +
   *  MessageActions (rating a "Something went wrong" message is
   *  meaningless and the old `error` copy looked identical to a
   *  normal answer). `retryPrompt` carries the exact user-turn text
   *  we should re-send on click. */
  isError?: boolean;
  retryPrompt?: string;
  /** s27 (C1, 2026-04-27): non-zero ⇒ the agent loop stripped at
   *  least one unverified score sentence from this reply. Drives
   *  the RedactionPill underneath AssistantMessage. Persists across
   *  reload because MessagesContext re-hydrates it from the message
   *  metadata blob. */
  unverifiedScoreClaimsRedacted?: number | null;
  /** s29 (A2, 2026-04-27): dedup'd list of citations the agent
   *  consulted this turn. Drives the "Used N sources" SourcesDrawer
   *  beneath the bubble. Empty/undefined ⇒ no drawer. Persists via
   *  MessagesContext rehydration from message_metadata. */
  consultedSources?: ConsultedSource[] | null;
  /** s30 (A4, 2026-04-27): tool failures the agent encountered this
   *  turn. Empty/undefined ⇒ no FailedToolPill. */
  failedToolCalls?: FailedToolCall[] | null;
  /** s30 (A6, 2026-04-27): true iff the answer relied on no user-data
   *  tool. Drives GeneralKnowledgePill. */
  isGeneralKnowledge?: boolean | null;
  /** s30 (D4, 2026-04-27): true iff the user pressed "stop" mid-stream
   *  AND we kept the partial text. Drives the InterruptedPill below
   *  the bubble so the user knows the answer was cut short on their
   *  request, not because the model errored. Persisted via
   *  message_metadata so reload preserves the state. */
  wasInterrupted?: boolean | null;
  /** s30 (D5, 2026-04-27): live transient flag flipped by
   *  useSendMessage while we silently retry a 5xx on /chat/stream.
   *  Drives the RetryPill spinner. NOT persisted — the pill is a
   *  pure runtime affordance, so on reload the bubble looks like a
   *  normal completed answer. */
  isRetrying?: boolean | null;
}
