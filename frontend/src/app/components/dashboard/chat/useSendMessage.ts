/**
 * Phase B (s21, 2026-04-22): hook that owns the "send" flow.
 *
 * Strategy is WS-first with a REST fallback — identical to the
 * previous behaviour inside ChatPage.tsx, but extracted here so the
 * page component can become a thin orchestrator and so a future
 * Phase C streaming redesign can replace this one file without
 * touching the composer or the transcript.
 *
 * Dependencies injected via args (not imported) so this hook stays
 * testable without React context plumbing.
 */

import { useCallback, useRef } from "react";
import { useLang } from "../../LanguageContext";
import { usePlan } from "../../billing/PlanContext";
import { useMessages } from "./MessagesContext";
import { reinjectCitationHint, stripReasoningBlocks } from "./utils";
import { isTransient5xx } from "./RetryPill";
import { balanceMathFences } from "./mathFence";
import type {
  ChatEnvelope,
  ConsultedSource,
  FailedToolCall,
  Message,
  MessagePart,
} from "./types";
import { trackChatMessageSent } from "../../../lib/telemetry";
import { computeTimeToFirstSendMs } from "./firstSendTiming";

// s35 wave 62 (2026-04-28): module-level page-mount timestamp +
// first-send-fired flag. Module scope (not useRef inside the hook)
// because the user can navigate away and back to /chat — we want
// "session start" to mean "user lands on chat the first time in
// this SPA boot", not "this hook instance was constructed". The
// flag flips exactly once per SPA lifetime; ChatPage remount won't
// re-fire it.
const PAGE_MOUNTED_AT = Date.now();
let FIRST_SEND_DONE = false;

// v2.5: services/api + services/chatWebSocket are TypeScript now,
// so the @ts-ignore comments that used to accommodate the .js
// modules are no longer needed.
import { ChatWebSocket } from "../../../../services/chatWebSocket";
import { sendMessage as postChatRest } from "../../../../services/api";

import { API_BASE } from "../../../lib/api";

// s24 agent harness (2026-04-26): when this flag is set the chat
// composer streams from /api/chat/stream via SSE instead of the
// one-shot REST POST. The legacy REST path is retained so we can
// flip back instantly via env var without a code change.
const AGENT_LOOP_ENABLED =
  (import.meta as any).env?.VITE_CHAT_AGENT_LOOP === "true" ||
  (import.meta as any).env?.VITE_CHAT_AGENT_LOOP === true;

interface SendCallbacks {
  /** Fires when the user hits their daily quota. */
  onLimitReached: () => void;
  /** Fires when the server returns 403 (plan gate). */
  onPaywall: () => void;
}

export function useSendMessage(callbacks: SendCallbacks) {
  const { lang, t } = useLang();
  const { isLimitReached, incrementUsage, refreshStatus } = usePlan();
  const {
    messages,
    isSending,
    setIsSending,
    appendMessage,
    replaceAll,
    patchMessage,
    removeMessage,
    activeThreadId,
    createThread,
    reloadThreads,
    renameThread,
    threads,
    patchThreadTitle,
  } = useMessages();

  // Phase C (s22): live references to the in-flight REST AbortController
  // and WS client so the composer can trigger a user-initiated stop.
  // Only one request is ever in-flight at a time (the composer disables
  // Send while `isSending`), so a single ref is sufficient.
  const abortRef = useRef<AbortController | null>(null);
  const wsRef = useRef<InstanceType<typeof ChatWebSocket> | null>(null);
  const stoppedRef = useRef(false);

  // s24 agent harness: SSE streaming consumer of /api/chat/stream.
  // Updates the live assistant bubble as events arrive. Returns true on
  // success, false on a recoverable failure that should fall back to REST.
  const sendViaAgentStream = useCallback(
    async (
      text: string,
      draft: Message[],
      threadIdForSend: number | null,
    ): Promise<boolean> => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const assistantId = `${Date.now()}-assistant-stream`;
      let appendedAssistant = false;
      let accumulatedText = "";
      let thinkingText = "";
      const toolCalls = new Map<
        string,
        Extract<MessagePart, { kind: "tool_call" }>
      >();
      let bookId: number | null = null;
      let pageNumber: number | null = null;
      let ragQueryLogId: number | null = null;
      let serverParts: MessagePart[] | null = null;
      // s27 (C1, 2026-04-27): captured from the `done` SSE event so the
      // RedactionPill renders the moment the stream closes (and again
      // after persistence reconciles via reloadThreads/hydrateFromHistory).
      let unverifiedScoreClaimsRedacted: number = 0;
      // s29 (A2, 2026-04-27): captured from the same `done` envelope.
      // Drives the SourcesDrawer ("Used N sources") affordance below
      // the bubble. Defaults to [] (drawer hidden) until done lands.
      let consultedSources: ConsultedSource[] = [];
      // s30 (A4, 2026-04-27): captured from `done` and surfaced as the
      // FailedToolPill below the bubble. Empty list ⇒ hidden.
      let failedToolCalls: FailedToolCall[] = [];
      // s30 (A6, 2026-04-27): captured from `done`. Drives the
      // GeneralKnowledgePill. Defaults to false (no pill).
      let isGeneralKnowledge: boolean = false;
      // s26: iteration tracking. The agent loop emits an `iteration`
      // SSE event right before each pass. We stamp every subsequent
      // tool_call_started with `currentIteration` so ReasoningPanel
      // can group rows under "Шаг N" separators. `seenIterations`
      // dedupes if the backend ever re-emits.
      let currentIteration = 0;
      const seenIterations = new Set<number>();

      const buildParts = (): MessagePart[] => {
        const parts: MessagePart[] = [];
        if (thinkingText.trim()) {
          parts.push({ kind: "thinking", text: thinkingText });
        }
        // Walk tool_calls in insertion order; whenever we cross an
        // iteration boundary, push an IterationMarker first so the
        // panel can render numbered separators.
        let lastIter = 0;
        for (const tc of toolCalls.values()) {
          const iter = tc.iteration ?? 0;
          if (iter && iter !== lastIter) {
            parts.push({ kind: "iteration", index: iter });
            lastIter = iter;
          }
          parts.push(tc);
        }
        if (serverParts) {
          for (const p of serverParts) {
            if (p.kind === "tool_call" || p.kind === "thinking") continue;
            parts.push(p);
          }
        }
        return parts;
      };

      const flushBubble = (overrides: Partial<Message> = {}) => {
        const finalText =
          bookId != null && pageNumber != null
            ? reinjectCitationHint(accumulatedText, {
                rag_query_log_id: ragQueryLogId,
                book_id: bookId,
                page_number: pageNumber,
              })
            : accumulatedText;
        const patch: Partial<Message> = {
          text: stripReasoningBlocks(finalText),
          ragQueryLogId,
          parts: buildParts(),
          // s27 (C1): always re-broadcast the current count on every
          // flush; until `done` lands it stays 0, then flips to the
          // server-reported number.
          unverifiedScoreClaimsRedacted,
          // s29 (A2): re-broadcast on every flush. Empty until `done`
          // lands and `consultedSources` is populated, at which point
          // the SourcesDrawer becomes visible below the bubble.
          consultedSources,
          // s30 (A4 / A6): same re-broadcast pattern. Both default
          // to "no pill" until `done` lands.
          failedToolCalls,
          isGeneralKnowledge,
          ...overrides,
        };
        if (!appendedAssistant) {
          appendMessage({
            id: assistantId,
            role: "assistant",
            text: patch.text || "",
            ragQueryLogId: patch.ragQueryLogId ?? null,
            parts: patch.parts,
            unverifiedScoreClaimsRedacted:
              patch.unverifiedScoreClaimsRedacted ?? 0,
            consultedSources: patch.consultedSources ?? [],
            failedToolCalls: patch.failedToolCalls ?? [],
            isGeneralKnowledge: patch.isGeneralKnowledge ?? false,
          });
          appendedAssistant = true;
        } else {
          patchMessage(assistantId, patch);
        }
      };

      try {
        incrementUsage("chatMessages");
        const apiMessages = draft.map((m) => ({
          role: m.role,
          content: m.text,
        }));
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "Accept-Language": lang,
        };
        const token =
          localStorage.getItem("access_token") || localStorage.getItem("token");
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const url = `${API_BASE}/chat/stream`;
        // s30 (D5, 2026-04-27): silent single-retry on transient 5xx.
        // We use the FE classifier `isTransient5xx` so the policy
        // (502/503/504 + Cloudflare 520..524) is one source of truth.
        // The bubble surfaces a slate "retrying..." pill while the
        // second attempt is in flight; on success we clear the flag
        // before any normal stream rendering, on second failure we
        // fall through to REST as before. Anything that's not a
        // transient 5xx (4xx, network throw that's not abort, etc.)
        // takes the existing single-shot path.
        const RETRY_DELAY_MS = 800;
        let response: Response;
        let retryAttempted = false;
        const surfaceRetryPill = () => {
          if (!appendedAssistant) {
            appendMessage({
              id: assistantId,
              role: "assistant",
              text: "",
              isRetrying: true,
            });
            appendedAssistant = true;
          } else {
            patchMessage(assistantId, { isRetrying: true });
          }
        };
        while (true) {
          response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({
              messages: apiMessages,
              language: lang,
              user_quota: "GENERAL",
              thread_id: threadIdForSend,
            }),
            signal: ctrl.signal,
          });
          if (
            !response.ok &&
            !retryAttempted &&
            isTransient5xx(response.status)
          ) {
            retryAttempted = true;
            surfaceRetryPill();
            await new Promise<void>((resolve) =>
              setTimeout(resolve, RETRY_DELAY_MS),
            );
            if (stoppedRef.current || ctrl.signal.aborted) {
              // User pressed Stop while we were waiting between
              // attempts — bail out cleanly so the catch handler
              // hits the abort branch.
              throw new DOMException("aborted", "AbortError");
            }
            continue;
          }
          break;
        }
        // Always clear the live retry flag the moment we have a
        // response — independent of `response.ok`. The pill is a
        // mid-flight affordance only.
        if (retryAttempted && appendedAssistant) {
          patchMessage(assistantId, { isRetrying: false });
        }

        if (!response.ok) {
          if (response.status === 429) {
            callbacks.onLimitReached();
            return true;
          }
          if (response.status === 403) {
            callbacks.onPaywall();
            return true;
          }
          // Server-side error — fall back to REST so the user still
          // gets an answer instead of a hard error.
          return false;
        }
        if (!response.body) {
          return false;
        }

        // Render an empty bubble immediately so the user sees the
        // "Думает…" pulse on the first SSE event rather than blank space.
        flushBubble();

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (stoppedRef.current) {
            try {
              await reader.cancel();
            } catch {
              /* noop */
            }
            // s30 (D4, 2026-04-27): preserve whatever already streamed
            // and mark the bubble as user-interrupted so ChatTranscript
            // can show the InterruptedPill instead of treating the cut
            // bubble as a normal complete answer. We only stamp the
            // flag if we already started showing text — empty cancels
            // fall through to the existing isError handling below.
            //
            // s34 wave 5 (C6 integration): also close any open math
            // fence on the user-interrupt path so a Stop pressed
            // mid-LaTeX still renders as KaTeX rather than raw
            // backslash-source.
            if (appendedAssistant) {
              accumulatedText = balanceMathFences(accumulatedText);
              flushBubble({ wasInterrupted: true });
            }
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          // SSE frames are separated by a blank line.
          let sepIdx;
          while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, sepIdx);
            buffer = buffer.slice(sepIdx + 2);
            const dataLines = frame
              .split("\n")
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trim())
              .filter(Boolean);
            if (dataLines.length === 0) continue;
            const payload = dataLines.join("\n");
            let event: any;
            try {
              event = JSON.parse(payload);
            } catch {
              continue;
            }
            const kind = event?.kind;
            if (kind === "thinking") {
              thinkingText += (thinkingText ? "\n\n" : "") + (event.text || "");
              flushBubble();
            } else if (kind === "tool_call_started") {
              const id = String(event.id || `${event.name}-${toolCalls.size}`);
              toolCalls.set(id, {
                kind: "tool_call",
                id,
                tool: event.name,
                args: event.args || {},
                status: "running",
                started_at: Date.now(),
                iteration: currentIteration || undefined,
              });
              flushBubble();
            } else if (kind === "tool_result") {
              const id = String(event.id || "");
              const existing = toolCalls.get(id);
              const updated: Extract<MessagePart, { kind: "tool_call" }> = {
                kind: "tool_call",
                id,
                tool: event.name,
                args: existing?.args || {},
                status: event.is_error ? "error" : "done",
                preview: event.content_preview,
                isError: !!event.is_error,
                started_at: existing?.started_at,
                ended_at: Date.now(),
                iteration: existing?.iteration,
              };
              toolCalls.set(id, updated);
              flushBubble();
            } else if (kind === "tool_part") {
              // Backend's parts_shaper output. The shaped part has a
              // structured `result` payload that the FE renders as a
              // ToolResultCard below the prose. We merge it into the
              // matching entry in `toolCalls` (so the timeline +
              // card share one part) when possible; otherwise we
              // append it as an extra serverPart.
              const part = (event.part || {}) as Extract<
                MessagePart,
                { kind: "tool_call" }
              >;
              if (part && part.tool) {
                let merged = false;
                // Find a running/done timeline entry with the same
                // tool name and no result yet — attach the shaped
                // result there.
                for (const [tcId, tc] of toolCalls) {
                  if (tc.tool === part.tool && !(tc as any).result) {
                    toolCalls.set(tcId, {
                      ...tc,
                      result: (part as any).result,
                    } as any);
                    merged = true;
                    break;
                  }
                }
                if (!merged) {
                  serverParts = [...(serverParts || []), part as MessagePart];
                }
                flushBubble();
              }
            } else if (kind === "text_delta") {
              accumulatedText += event.text || "";
              flushBubble();
            } else if (kind === "thinking_delta") {
              // Streaming-mode thinking: token-level deltas of the
              // <think>...</think> block. Append to the same buffer
              // the bulk-thinking event uses so the FE renders one
              // continuous block.
              thinkingText += event.text || "";
              flushBubble();
            } else if (kind === "text_replace") {
              // Citation validator stripped a hallucinated deep-link
              // hint after streaming completed. Replace the entire
              // visible text with the cleaned version.
              accumulatedText = event.text || accumulatedText;
              flushBubble();
            } else if (kind === "iteration") {
              // s26: track current iteration index so subsequent
              // tool_call_started events can be grouped by it. The
              // backend sends `{kind:"iteration", index, total}` (or
              // `{kind:"iteration", iteration:N}` in earlier
              // builds). We tolerate both shapes.
              const idx = Number(
                event.n ?? event.index ?? event.iteration ?? 0,
              );
              if (idx > 0 && !seenIterations.has(idx)) {
                seenIterations.add(idx);
                currentIteration = idx;
                flushBubble();
              }
            } else if (kind === "done") {
              // s34 wave 5 (C6 integration, 2026-04-28): on stream
              // completion, run the accumulated text through
              // balanceMathFences so any opener that arrived in
              // the last delta but whose closer was eaten by a
              // truncated stream gets closed before the final
              // markdown render. Idempotent on already-balanced
              // input. We deliberately apply this ONLY at done
              // time (not on every text_delta) so mid-stream the
              // math renders progressively and doesn't churn.
              accumulatedText = balanceMathFences(accumulatedText);
              bookId = event.book_id ?? null;
              pageNumber = event.page_number ?? null;
              ragQueryLogId = event.rag_query_log_id ?? null;
              // s27 (C1): the agent loop's done envelope carries the
              // count of redacted unverified score sentences. > 0 ⇒
              // RedactionPill lights up below the bubble.
              unverifiedScoreClaimsRedacted = Number(
                event.unverified_score_claims_redacted ?? 0,
              );
              // s29 (A2): pull the dedup'd source list off the same
              // envelope. Defensive: tolerate either undefined or a
              // non-array (older backends pre-roll-out).
              const rawSources = (event as { consulted_sources?: unknown })
                .consulted_sources;
              consultedSources = Array.isArray(rawSources)
                ? (rawSources as ConsultedSource[])
                : [];
              // s30 (A4): same pull-and-validate for the failure list.
              const rawFailures = (event as { failed_tool_calls?: unknown })
                .failed_tool_calls;
              failedToolCalls = Array.isArray(rawFailures)
                ? (rawFailures as FailedToolCall[])
                : [];
              // s30 (A6): boolean coercion — backend only sets the
              // field when true, so absence ⇒ false.
              isGeneralKnowledge = Boolean(
                (event as { is_general_knowledge?: unknown })
                  .is_general_knowledge,
              );
              if (event.content) {
                accumulatedText = event.content;
              }
              flushBubble();
            } else if (kind === "error") {
              if (!appendedAssistant) {
                // Surfaced before any token landed — bubble up to the
                // catch handler so we can show the error placeholder.
                throw new Error(event.message || "agent_error");
              }
              flushBubble();
            } else if (kind === "thread_renamed") {
              // s26 phase 8: backend auto-renamed the thread after the
              // first turn. Patch local state so the rail flips live;
              // the post-stream reloadThreads() will reconcile timing.
              const tid = event.thread_id;
              const newTitle = event.title;
              if (typeof tid === "number" && typeof newTitle === "string") {
                patchThreadTitle(tid, newTitle);
              }
            } else if (kind === "stream_end") {
              // graceful close — nothing to do, loop will exit naturally.
            }
          }
        }

        await refreshStatus();
        if (threadIdForSend !== null) {
          void reloadThreads();
        }
        return true;
      } catch (error: any) {
        const isAbort =
          error?.name === "AbortError" ||
          error?.code === "ERR_CANCELED" ||
          stoppedRef.current;
        if (isAbort) {
          await refreshStatus();
          return true;
        }
        // Hard failure during the stream — if we already started a
        // bubble, emit a soft error there. Otherwise fall back to REST
        // so the user still gets an answer.
        if (appendedAssistant) {
          patchMessage(assistantId, {
            text:
              accumulatedText ||
              t("chat.errorSend") ||
              (lang === "kz"
                ? "Қате орын алды. Қайталап көріңіз."
                : "Произошла ошибка. Попробуйте ещё раз."),
            isError: !accumulatedText,
            retryPrompt: !accumulatedText ? text : undefined,
          });
          await refreshStatus();
          return true;
        }
        return false;
      } finally {
        abortRef.current = null;
      }
    },
    [
      appendMessage,
      callbacks,
      incrementUsage,
      lang,
      patchMessage,
      patchThreadTitle,
      refreshStatus,
      reloadThreads,
      t,
    ],
  );

  const fallbackToRest = useCallback(
    async (text: string, draft: Message[], threadIdForSend: number | null) => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        incrementUsage("chatMessages");
        const apiMessages = draft.map((m) => ({
          role: m.role,
          content: m.text,
        }));
        const response: ChatEnvelope = await postChatRest(
          apiMessages,
          null,
          "GENERAL",
          lang,
          { signal: ctrl.signal, threadId: threadIdForSend },
        );

        // s34 wave 5 (C6 integration, 2026-04-28): the REST envelope
        // is the final, non-streaming answer — apply balanceMathFences
        // so any payload truncated server-side mid-fence still renders
        // as KaTeX rather than raw LaTeX source. Idempotent on clean
        // input.
        const assistantText = balanceMathFences(
          stripReasoningBlocks(response.message || response.content || ""),
        );
        const ragQueryLogId = response.rag_query_log_id ?? null;
        const bookId = response.book_id ?? null;
        const pageNumber = response.page_number ?? null;

        // Phase A (s20c): when the REST envelope carries structured
        // book_id+page_number, inject the hint comment so the
        // citation parser + deep-link chip pipeline don't rely on
        // the model faithfully echoing the marker.
        const finalText =
          bookId != null && pageNumber != null
            ? reinjectCitationHint(assistantText, {
                rag_query_log_id: ragQueryLogId,
                book_id: bookId,
                page_number: pageNumber,
              })
            : assistantText;

        // Phase C (s22): accept structured tool-result parts from
        // the backend envelope. Defensive: must be a plain array; any
        // other shape is ignored.
        const parts: MessagePart[] | undefined =
          Array.isArray(response.parts) && response.parts.length
            ? (response.parts as MessagePart[])
            : undefined;
        // s27 (C1): forward redaction count from the REST envelope.
        const unverifiedScoreClaimsRedacted =
          Number(response.unverified_score_claims_redacted ?? 0) || 0;
        // s29 (A2): forward consulted-sources list from the REST envelope.
        const restSources = (response as { consulted_sources?: unknown })
          .consulted_sources;
        const consultedSourcesRest: ConsultedSource[] = Array.isArray(
          restSources,
        )
          ? (restSources as ConsultedSource[])
          : [];
        // s30 (A4): forward failure list from REST envelope.
        const restFailures = (response as { failed_tool_calls?: unknown })
          .failed_tool_calls;
        const failedToolCallsRest: FailedToolCall[] = Array.isArray(
          restFailures,
        )
          ? (restFailures as FailedToolCall[])
          : [];
        // s30 (A6): forward general-knowledge flag from REST envelope.
        const isGeneralKnowledgeRest = Boolean(
          (response as { is_general_knowledge?: unknown }).is_general_knowledge,
        );
        appendMessage({
          id: `${Date.now()}-assistant`,
          role: "assistant",
          text: finalText,
          ragQueryLogId,
          parts,
          unverifiedScoreClaimsRedacted,
          consultedSources: consultedSourcesRest,
          failedToolCalls: failedToolCallsRest,
          isGeneralKnowledge: isGeneralKnowledgeRest,
        });
        await refreshStatus();
        // s22 (BUG-S22-sidebar): after a successful send bump the
        // sidebar so the most-recently-updated thread floats to the
        // top. The backend already touched updated_at; we just refetch.
        if (threadIdForSend !== null) {
          void reloadThreads();
        }
      } catch (error: any) {
        // User-initiated cancellation — swallow. Axios raises
        // `CanceledError` / code ERR_CANCELED; native fetch raises
        // AbortError. No toast, no error bubble.
        const isAbort =
          error?.name === "CanceledError" ||
          error?.code === "ERR_CANCELED" ||
          error?.name === "AbortError" ||
          stoppedRef.current;
        if (isAbort) {
          // Quota was already incremented optimistically; leave it —
          // the user did get a partial/discarded response, which is
          // consistent with the WS path where chunks had already flowed.
          await refreshStatus();
          return;
        }
        const status = error?.status ?? error?.response?.status;
        if (status === 429) {
          callbacks.onLimitReached();
        } else if (status === 403) {
          callbacks.onPaywall();
        } else {
          // Phase C (s22): emit a structured error bubble with
          // retry metadata so the transcript can render a "Retry"
          // affordance instead of a plain text blob. The prior
          // user-turn text (`text`) is exactly what we'll re-send
          // when the user clicks it.
          appendMessage({
            id: `${Date.now()}-error`,
            role: "assistant",
            text:
              t("chat.errorSend") ||
              t("error.desc") ||
              "Something went wrong. Please try again.",
            isError: true,
            retryPrompt: text,
          });
        }
        await refreshStatus();
      } finally {
        abortRef.current = null;
        setIsSending(false);
      }
    },
    [
      appendMessage,
      callbacks,
      incrementUsage,
      lang,
      refreshStatus,
      reloadThreads,
      setIsSending,
      t,
    ],
  );

  const handleSend = useCallback(
    async (raw: string) => {
      if (!raw.trim() || isSending) return;

      if (isLimitReached("chatMessages")) {
        callbacks.onLimitReached();
        return;
      }

      const text = raw.trim();
      // Fresh send: clear any stale stop-flag so a previous cancel
      // doesn't immediately swallow this response.
      stoppedRef.current = false;
      setIsSending(true);
      // s35 wave 62 (2026-04-28): mark + measure the first send of
      // this SPA boot. The flag is module-level so subsequent
      // sends — even after thread switches or empty-state remounts
      // — correctly report is_first_send:false and omit the
      // time-to-send field (continued sends are dominated by
      // reading-time, not user latency to first action).
      const isFirstSend = !FIRST_SEND_DONE;
      const ttfsMs = isFirstSend
        ? computeTimeToFirstSendMs(PAGE_MOUNTED_AT, Date.now())
        : null;
      if (isFirstSend) FIRST_SEND_DONE = true;
      trackChatMessageSent({
        locale: lang,
        source: "composer",
        has_text_len: text.length,
        is_first_send: isFirstSend,
        time_to_first_send_ms: ttfsMs,
      });

      // s22 (BUG-S22-sidebar): pick the thread to write into.
      //   - If the user has an explicit active thread → use it.
      //   - Else if there is visible history in the legacy bucket →
      //     keep using it (legacy behaviour).
      //   - Else auto-create a fresh thread so every empty-state send
      //     stays isolated and doesn't accidentally inherit an old
      //     conversation pile that wasn't visible in the transcript.
      let threadIdForSend: number | null = activeThreadId;
      let autoCreatedThreadId: number | null = null;
      const sendingFromEmptyTranscript = messages.length === 0;
      if (activeThreadId === null && sendingFromEmptyTranscript) {
        try {
          // Seed a short title from the user's first turn so the
          // sidebar row isn't "New chat" forever. Trimmed and
          // unescaped — the backend clamps to 120 chars anyway.
          const seedTitle = text.slice(0, 60).trim();
          autoCreatedThreadId = await createThread(seedTitle || null);
          threadIdForSend = autoCreatedThreadId;
        } catch {
          // Thread creation failed — proceed into the legacy bucket so
          // the user's turn isn't lost.
          threadIdForSend = null;
        }
      }

      // Also: if the user is sending the first turn inside a thread
      // created via the "+ New chat" button (still untitled) auto-seed
      // the title from the prompt so the rail row matches the prose.
      if (
        activeThreadId !== null &&
        sendingFromEmptyTranscript &&
        !autoCreatedThreadId
      ) {
        const active = threads.find((th) => th.id === activeThreadId);
        if (active && (!active.title || !active.title.trim())) {
          const seedTitle = text.slice(0, 60).trim();
          if (seedTitle) {
            try {
              await renameThread(activeThreadId, seedTitle);
            } catch {
              /* swallow — non-fatal */
            }
          }
        }
      }

      const userMsg: Message = {
        id: Date.now().toString(),
        role: "user",
        text,
      };
      const draft = [...messages, userMsg];
      if (sendingFromEmptyTranscript) {
        replaceAll([userMsg]);
      } else {
        appendMessage(userMsg);
      }

      // Session 22 (2026-04-22): WS-first was abandoned. The WS path
      // has NO function-calling and NO retrieval, which means it
      // cannot produce verified textbook citations — the whole point
      // of Samga.ai. We tried gating it to "non-library prompts"
      // before, but users (and the boss) correctly flagged that the
      // answers look authoritative without the citation line. Going
      // REST-only ensures every answer has the chance to cite a real
      // book/page (or honestly say the topic isn't in the library).
      // The REST path is slower but the boss mandate is
      // "use the best tier, don't care about cost or runtime".
      const PREFER_WS = false;
      const token =
        localStorage.getItem("access_token") || localStorage.getItem("token");

      // s24: agent-loop SSE first when the env flag is on. The REST
      // path remains the fallback, so a 5xx, a network blip, or a
      // missing /chat/stream route all still produce an answer.
      if (AGENT_LOOP_ENABLED) {
        try {
          const ok = await sendViaAgentStream(text, draft, threadIdForSend);
          if (ok) {
            setIsSending(false);
            return;
          }
        } catch (err) {
          // Hard error escaping sendViaAgentStream — fall through to REST.
          if (process.env.NODE_ENV !== "production") {
            console.warn(
              "[s24] agent stream failed, falling back to REST",
              err,
            );
          }
        }
      }

      if (PREFER_WS && token && typeof WebSocket !== "undefined") {
        try {
          const assistantId = `${Date.now()}-assistant-stream`;
          appendMessage({
            id: assistantId,
            role: "assistant",
            text: "",
          });

          let accumulated = "";
          let completed = false;

          const wsClient = new ChatWebSocket(token, {
            onChunk: (chunk: string) => {
              // Phase C (s22): if the user hit Stop, discard late
              // chunks instead of re-appending to a bubble we've
              // already frozen.
              if (stoppedRef.current) return;
              accumulated += chunk;
              patchMessage(assistantId, {
                text: stripReasoningBlocks(accumulated),
              });
            },
            onComplete: () => {
              if (stoppedRef.current) return;
              completed = true;
              // s34 wave 5 (C6 integration): rebalance math fences
              // on stream completion so a truncated mid-LaTeX final
              // chunk still renders as KaTeX rather than raw source.
              // Idempotent on clean input.
              patchMessage(assistantId, {
                text: balanceMathFences(stripReasoningBlocks(accumulated)),
              });
              wsRef.current = null;
              setIsSending(false);
              incrementUsage("chatMessages");
              void refreshStatus();
            },
            onError: async () => {
              if (stoppedRef.current) {
                wsRef.current = null;
                setIsSending(false);
                return;
              }
              if (!completed) {
                removeMessage(assistantId);
                wsRef.current = null;
                await fallbackToRest(text, draft, threadIdForSend);
              }
            },
          });
          wsRef.current = wsClient;

          await wsClient.connect();
          await wsClient.sendMessage(text, lang);
          return;
        } catch {
          // WS setup blew up synchronously — clean up any placeholder
          // stream bubble and fall through to REST.
          // The guard below is defensive: if we already appended an
          // assistant bubble with an empty text, remove it.
          // (Note: we can't reference the id here directly because it
          // was created inside the try scope; the REST path will
          // synthesize a fresh bubble on success.)
        }
      }

      await fallbackToRest(text, draft, threadIdForSend);
    },
    [
      activeThreadId,
      appendMessage,
      callbacks,
      createThread,
      fallbackToRest,
      sendViaAgentStream,
      incrementUsage,
      isLimitReached,
      isSending,
      lang,
      messages,
      patchMessage,
      replaceAll,
      refreshStatus,
      removeMessage,
      renameThread,
      setIsSending,
      threads,
    ],
  );

  /**
   * Phase C (s22): user-initiated stop. Cancels whichever path is
   * currently in-flight (WS close + REST abort) and flips the
   * `stoppedRef` latch so any late chunks or callbacks are discarded.
   * Safe to call when nothing is in-flight — it's a no-op.
   */
  const stop = useCallback(() => {
    stoppedRef.current = true;
    // REST path
    try {
      abortRef.current?.abort();
    } catch {
      /* noop */
    }
    abortRef.current = null;
    // WS path
    try {
      wsRef.current?.close();
    } catch {
      /* noop */
    }
    wsRef.current = null;
    setIsSending(false);
  }, [setIsSending]);

  return { handleSend, stop };
}
