/**
 * Phase B (s21, 2026-04-22): `MessagesContext` owns the conversation
 * state that was previously scattered across ChatPage.tsx.
 *
 * Why a context, not a hook: the send flow (`useSendMessage`), the
 * transcript (`ChatTranscript`), and the header (`ChatHeader`) all need
 * concurrent read/write access, and prop-drilling through 4 layers was
 * the main reason ChatPage.tsx ballooned to 515 lines. With this
 * context in place, Phase B children can grab what they need without
 * the page re-rendering everything on every token.
 *
 * Scope this context covers:
 *   - `messages` list + setter (append / replace / clear)
 *   - `loading` flag while /api/chat/history is being fetched
 *   - `isSending` flag shared between composer + transcript spinner
 *   - helpers to append, patch-by-id (for streaming), and clear
 *
 * What it intentionally does NOT cover:
 *   - Plan/billing state (stays in PlanContext)
 *   - Language preference (stays in LanguageContext)
 *   - Modal state (LimitReachedModal / PaywallModal / ClearConfirm
 *     remain local to ChatPage for now)
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { apiDelete, apiGet, apiPatch, apiPost } from "../../../lib/api";
import type {
  AssistantMetadata,
  ChatHistoryResponse,
  ConsultedSource,
  FailedToolCall,
  Message,
  MessagePart,
} from "./types";
import { reinjectCitationHint, stripReasoningBlocks } from "./utils";

/**
 * s22 (BUG-S22-sidebar): a single "thread" row as returned by
 * /api/chat/threads. `id=null` represents the synthetic legacy
 * "Main chat" bucket (chat_messages.thread_id IS NULL) and is only
 * surfaced when its message_count > 0.
 */
export interface ChatThread {
  id: number | null;
  title: string | null;
  created_at: string | null;
  updated_at: string | null;
  message_count: number;
  /** True only for the pinned legacy bucket. */
  isLegacy?: boolean;
}

interface ThreadsListResponse {
  threads: Array<{
    id: number;
    title: string | null;
    created_at: string;
    updated_at: string;
    message_count: number;
  }>;
  legacy_bucket_message_count: number;
}

interface MessagesContextValue {
  messages: Message[];
  loading: boolean;
  isSending: boolean;
  setIsSending: (v: boolean) => void;
  appendMessage: (msg: Message) => void;
  patchMessage: (id: string, patch: Partial<Message>) => void;
  removeMessage: (id: string) => void;
  replaceAll: (next: Message[]) => void;
  /** Clears the currently-active thread (or all history if no active thread). */
  clear: () => Promise<void>;
  /** Re-loads from /api/chat/history (respects active thread). */
  reload: () => Promise<void>;
  /** Phase C (s22): drop the message with `id` AND every message after
   *  it. Used by edit-and-resubmit to rewind the thread back to the
   *  point the user wants to change. No network call — the backend's
   *  chat history is the persistence of truth and will be reconciled
   *  lazily on the next clear() or reload(). */
  truncateFrom: (id: string) => void;
  /** Phase C (s22): transient "seed" for the composer. Bumps on each
   *  call (even with identical text) so ChatComposer's effect always
   *  fires and replaces whatever the user currently has. Parent
   *  components do NOT read this directly — only ChatComposer does. */
  composerSeed: { text: string; nonce: number };
  seedComposer: (text: string) => void;

  // ── s22 (BUG-S22-sidebar): thread rail ──────────────────────────
  /** All threads the user owns, plus the legacy bucket if non-empty,
   *  sorted most-recently-updated first. */
  threads: ChatThread[];
  /** The currently-selected thread id. `null` means the legacy
   *  "Main chat" bucket (or pre-s22 single-thread behaviour).
   *  `undefined` before first mount — FE treats as null. */
  activeThreadId: number | null;
  /** Switch the active thread. Triggers a reload of /chat/history. */
  setActiveThreadId: (id: number | null) => void;
  /** Create a fresh thread, select it, clear the transcript.
   *  Returns the new id. */
  createThread: (title?: string | null) => Promise<number>;
  /** Rename a thread by id. Empty string → reset title to NULL. */
  renameThread: (id: number, title: string) => Promise<void>;
  /** Delete a thread (and all its messages). If it was active, the
   *  active thread resets to legacy/null. */
  deleteThread: (id: number) => Promise<void>;
  /** Manually refetch the threads list (e.g. after a send auto-bumps
   *  the updated_at on the active thread). */
  reloadThreads: () => Promise<void>;
  /** s26 phase 8: optimistic in-place patch of a thread's title.
   *  Used by the SSE `thread_renamed` event so the rail flips live
   *  without waiting for the post-stream `/chat/threads` refetch. */
  patchThreadTitle: (id: number, title: string) => void;
}

// v3.10 (F2, 2026-04-30): exported so CitationChip can read it via
// useContext directly (graceful no-provider mount in storybook /
// vitest contract tests where the chip is rendered in isolation
// without a chat surface around it).
export const MessagesContext = createContext<MessagesContextValue | null>(null);

export function MessagesProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [composerSeed, setComposerSeed] = useState<{
    text: string;
    nonce: number;
  }>({
    text: "",
    nonce: 0,
  });
  // s22 (BUG-S22-sidebar): thread rail state.
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadIdState] = useState<number | null>(
    null,
  );
  /** Guard against duplicate initial loads in strict-mode / HMR. */
  const loadedRef = useRef(false);
  /** Reject stale history responses so old loads cannot overwrite a newer thread selection. */
  const historyRequestRef = useRef(0);

  const hydrateFromHistory = useCallback(async (threadId?: number | null) => {
    const requestId = ++historyRequestRef.current;
    // When threadId is undefined (first load) we pass no scope and
    // the backend returns the full history; once the sidebar picks
    // a specific thread we start scoping. `null` = explicit legacy
    // bucket (?thread_id=0 on the wire).
    setLoading(true);
    try {
      let path = "/chat/history";
      if (threadId === null) path = "/chat/history?thread_id=0";
      else if (typeof threadId === "number")
        path = `/chat/history?thread_id=${threadId}`;
      const history = await apiGet<ChatHistoryResponse>(path);
      const loaded: Message[] = (history.messages || [])
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m, idx) => {
          const isAssistant = m.role === "assistant";
          const meta: AssistantMetadata | null = isAssistant
            ? (m.metadata ?? null)
            : null;
          const baseText = isAssistant
            ? stripReasoningBlocks(m.content || "")
            : m.content || "";
          const parts: MessagePart[] | undefined =
            isAssistant &&
            Array.isArray(meta?.parts) &&
            (meta?.parts?.length ?? 0) > 0
              ? (meta!.parts as MessagePart[])
              : undefined;
          // s27 (C1, 2026-04-27): the redaction count lives on the
          // persisted message_metadata blob. Re-hydrating it here so
          // the RedactionPill survives reload — without this, refresh
          // would silently drop the warning the user saw live.
          const unverifiedScoreClaimsRedacted = isAssistant
            ? Number(meta?.unverified_score_claims_redacted ?? 0) || 0
            : undefined;
          // s29 (A2, 2026-04-27): same story for the consulted-sources
          // list driving the SourcesDrawer. Defensive: tolerate both
          // missing key (legacy rows) and non-array values.
          const rawSources = (meta as { consulted_sources?: unknown } | null)
            ?.consulted_sources;
          const consultedSources =
            isAssistant && Array.isArray(rawSources)
              ? (rawSources as ConsultedSource[])
              : undefined;
          // s30 (A4, 2026-04-27): same defensive rehydrate for the
          // failed_tool_calls list. Persisted only when non-empty,
          // so absence ⇒ no FailedToolPill on reload.
          const rawFailures = (meta as { failed_tool_calls?: unknown } | null)
            ?.failed_tool_calls;
          const failedToolCalls =
            isAssistant && Array.isArray(rawFailures)
              ? (rawFailures as FailedToolCall[])
              : undefined;
          // s30 (A6, 2026-04-27): boolean rehydrate. Persisted only
          // when true, so absence ⇒ undefined ⇒ no pill.
          const isGeneralKnowledge =
            isAssistant &&
            Boolean(
              (meta as { is_general_knowledge?: unknown } | null)
                ?.is_general_knowledge,
            )
              ? true
              : undefined;
          // s30 (D4, 2026-04-27): forward-compat rehydrate for the
          // user-interrupted flag. Today the BE doesn't persist this
          // (the partial save runs without knowing the client cut
          // the stream), but if a future commit lands the signal,
          // this hydrator will pick it up automatically.
          const wasInterrupted =
            isAssistant &&
            Boolean(
              (meta as { was_interrupted?: unknown } | null)?.was_interrupted,
            )
              ? true
              : undefined;
          return {
            id: `${Date.now()}-${idx}-${m.role}`,
            role: m.role as "user" | "assistant",
            text: isAssistant ? reinjectCitationHint(baseText, meta) : baseText,
            ragQueryLogId: isAssistant
              ? (meta?.rag_query_log_id ?? null)
              : undefined,
            parts,
            unverifiedScoreClaimsRedacted,
            consultedSources,
            failedToolCalls,
            isGeneralKnowledge,
            wasInterrupted,
          };
        });
      if (historyRequestRef.current !== requestId) return;
      setMessages(loaded);
    } catch {
      if (historyRequestRef.current !== requestId) return;
      setMessages([]);
    } finally {
      // v2.7 lint: avoid `return` inside finally (no-unsafe-finally).
      // Same intent as before — only flip loading off if this is
      // still the most recent request.
      if (historyRequestRef.current === requestId) {
        setLoading(false);
      }
    }
  }, []);

  // s22: load thread list. Fires once on mount, again after create /
  // rename / delete / explicit reload.
  const reloadThreads = useCallback(async () => {
    try {
      const resp = await apiGet<ThreadsListResponse>("/chat/threads");
      const explicit: ChatThread[] = (resp.threads || []).map((t) => ({
        id: t.id,
        title: t.title,
        created_at: t.created_at,
        updated_at: t.updated_at,
        message_count: t.message_count,
      }));
      const list: ChatThread[] = [...explicit];
      if ((resp.legacy_bucket_message_count || 0) > 0) {
        // Pin the legacy bucket at the bottom of the rail — explicit
        // threads are newer/active, legacy is the pre-s22 single pile.
        list.push({
          id: null,
          title: null,
          created_at: null,
          updated_at: null,
          message_count: resp.legacy_bucket_message_count,
          isLegacy: true,
        });
      }
      setThreads(list);
    } catch {
      setThreads([]);
    }
  }, []);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void hydrateFromHistory();
    void reloadThreads();
  }, [hydrateFromHistory, reloadThreads]);

  const setActiveThreadId = useCallback(
    (id: number | null) => {
      setActiveThreadIdState(id);
      void hydrateFromHistory(id);
    },
    [hydrateFromHistory],
  );

  const createThread = useCallback(
    async (title?: string | null) => {
      const created = await apiPost<{ id: number }>("/chat/threads", {
        title: title ?? null,
      });
      historyRequestRef.current += 1;
      setActiveThreadIdState(created.id);
      setMessages([]);
      setLoading(false);
      await reloadThreads();
      return created.id;
    },
    [reloadThreads],
  );

  const renameThread = useCallback(
    async (id: number, title: string) => {
      await apiPatch(`/chat/threads/${id}`, { title });
      await reloadThreads();
    },
    [reloadThreads],
  );

  // s26 phase 8: optimistic patch for the SSE `thread_renamed` event.
  // We don't reload — the backend already wrote the title, and the
  // post-stream `reloadThreads()` in useSendMessage will reconcile.
  const patchThreadTitle = useCallback((id: number, title: string) => {
    setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
  }, []);

  const deleteThread = useCallback(
    async (id: number) => {
      await apiDelete(`/chat/threads/${id}`);
      // If the thread we just nuked was active, fall back to "Main chat".
      setActiveThreadIdState((prev) => (prev === id ? null : prev));
      await reloadThreads();
      // Re-hydrate so the transcript reflects whatever is active now.
      const nextActive = activeThreadId === id ? null : activeThreadId;
      await hydrateFromHistory(nextActive);
    },
    [activeThreadId, hydrateFromHistory, reloadThreads],
  );

  const appendMessage = useCallback((msg: Message) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const patchMessage = useCallback((id: string, patch: Partial<Message>) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    );
  }, []);

  const removeMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const replaceAll = useCallback((next: Message[]) => {
    setMessages(next);
  }, []);

  const truncateFrom = useCallback((id: string) => {
    // Compute in-place on the current list so we know how many rows
    // to tell the backend to drop. We pair the UI truncation with a
    // backend truncate so reloading the tab after edit-and-resubmit
    // doesn't re-hydrate the stale tail. Failure to reach the backend
    // is non-fatal — the optimistic UI is still correct locally, and
    // a future reload will simply show the un-truncated tail.
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === id);
      if (idx < 0) return prev;
      const dropCount = prev.length - idx;
      if (dropCount > 0) {
        void apiPost("/chat/history/truncate", { drop_last: dropCount }).catch(
          () => {
            /* swallow: optimistic UI stays; reconcile on next reload */
          },
        );
      }
      return prev.slice(0, idx);
    });
  }, []);

  const seedComposer = useCallback((text: string) => {
    setComposerSeed((prev) => ({ text, nonce: prev.nonce + 1 }));
  }, []);

  const clear = useCallback(async () => {
    try {
      // s22: scope clear to the active thread when one is selected so
      // the user only nukes the conversation they're looking at.
      // `activeThreadId=null` + threads rail present means "legacy
      // Main chat", so pass ?thread_id=0 in that case; else delete
      // everything (pre-s22 single-thread semantics).
      if (activeThreadId !== null) {
        await apiDelete(`/chat/history?thread_id=${activeThreadId}`);
      } else if (threads.some((t) => t.isLegacy)) {
        await apiDelete("/chat/history?thread_id=0");
      } else {
        await apiDelete("/chat/history");
      }
      setMessages([]);
      await reloadThreads();
    } catch {
      // Silent fail — keep current thread so user's draft isn't lost
      // on a flaky backend. DeleteHistory is idempotent anyway.
    }
  }, [activeThreadId, reloadThreads, threads]);

  const reload = useCallback(
    () => hydrateFromHistory(activeThreadId),
    [activeThreadId, hydrateFromHistory],
  );

  const value = useMemo<MessagesContextValue>(
    () => ({
      messages,
      loading,
      isSending,
      setIsSending,
      appendMessage,
      patchMessage,
      removeMessage,
      replaceAll,
      clear,
      reload,
      truncateFrom,
      composerSeed,
      seedComposer,
      threads,
      activeThreadId,
      setActiveThreadId,
      createThread,
      renameThread,
      deleteThread,
      reloadThreads,
      patchThreadTitle,
    }),
    [
      messages,
      loading,
      isSending,
      appendMessage,
      patchMessage,
      removeMessage,
      replaceAll,
      clear,
      reload,
      truncateFrom,
      composerSeed,
      seedComposer,
      threads,
      activeThreadId,
      setActiveThreadId,
      createThread,
      renameThread,
      deleteThread,
      reloadThreads,
      patchThreadTitle,
    ],
  );

  return (
    <MessagesContext.Provider value={value}>
      {children}
    </MessagesContext.Provider>
  );
}

export function useMessages(): MessagesContextValue {
  const ctx = useContext(MessagesContext);
  if (!ctx) {
    throw new Error(
      "useMessages must be used inside <MessagesProvider>. Wrap the subtree with it in ChatPage.tsx.",
    );
  }
  return ctx;
}
