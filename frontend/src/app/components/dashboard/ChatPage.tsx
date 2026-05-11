/**
 * Phase B (s21, 2026-04-22): ChatPage is now a thin orchestrator.
 *
 * Previously this file was 515 lines carrying transcript rendering,
 * composer logic, WebSocket + REST send flow, history hydration,
 * clear-history modal, paywall gating, and a bunch of copy. Phase A
 * (s20c) already lifted the empty state + citation hint handling;
 * Phase B finishes the job by promoting:
 *
 *   - `MessagesContext` / `useMessages`  — state ownership
 *   - `useSendMessage`                   — WS-first + REST-fallback flow
 *   - `ChatHeader`                       — title / model / usage
 *   - `ChatTranscript`                   — scroll container + messages
 *   - `ChatComposer`                     — textarea + send button
 *   - `ClearConfirmModal`                — destructive confirm
 *
 * What stays here: the `/free-plan notice`, modal-state booleans for
 * quota / paywall / confirm-clear, and the loading skeleton. These
 * are page-level chrome, not chat-domain primitives.
 *
 * WS stays the default attempt but still has no tool-calling / no
 * citations (see DESIGN_CHAT_FLAGSHIP.md §9.1). Phase C is where WS
 * becomes citation-aware; Phase B explicitly does NOT touch that path.
 */

import { Suspense, lazy, useEffect, useState } from "react";
import { Crown, PanelLeft, PanelLeftClose } from "lucide-react";
import "katex/dist/katex.min.css";

import { usePlan } from "../billing/PlanContext";
import { useLang } from "../LanguageContext";
import { Skeleton } from "../ui/skeleton";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";

import { ChatComposer } from "./chat/ChatComposer";
import { ChatHeader } from "./chat/ChatHeader";
import { ChatTranscript } from "./chat/ChatTranscript";
import { MessagesProvider, useMessages } from "./chat/MessagesContext";
import { useSendMessage } from "./chat/useSendMessage";
import { shouldOpenShortcutsHelp } from "./chat/shortcutGate";
import { SkipLink } from "./chat/SkipLink";
import { ThreadRail } from "./chat/ThreadRail";
import { threadRailToggleAria } from "./chat/threadRailToggleAria";
import {
  parseChatDeepLinkParams,
  renderChatPrefill,
} from "./weakTopicLinkParams";
import { loadDraft } from "./chat/draftStorage";

// s35 wave 45 (2026-04-28): code-split four user-triggered modals
// out of the ChatPage chunk. None of these render on first paint;
// all four are gated on user action (clear-history button, "?"
// shortcut, hitting daily limit, hitting paywall). Lazy-loading
// them shaves ~25 kB off the ChatPage chunk and keeps first paint
// snappier.
//
// `null` Suspense fallback is correct: each modal is invisible
// until its own `open` prop flips to true, so a fallback would
// only ever render during the brief network/parse window between
// user click and modal mount. A flash-of-fallback would be worse
// than the modal appearing 50ms later than the click.
const LimitReachedModalLazy = lazy(() =>
  import("../billing/LimitReachedModal").then((m) => ({
    default: m.LimitReachedModal,
  })),
);
const PaywallModalLazy = lazy(() =>
  import("../billing/PaywallModal").then((m) => ({
    default: m.PaywallModal,
  })),
);
const ClearConfirmModalLazy = lazy(() =>
  import("./chat/ClearConfirmModal").then((m) => ({
    default: m.ClearConfirmModal,
  })),
);
const ShortcutsHelpLazy = lazy(() => import("./chat/ShortcutsHelp"));

/**
 * Inner shell — rendered under `<MessagesProvider>` so it can call
 * `useMessages()`. The public export below is the provider + shell
 * combo.
 */
function ChatPageShell() {
  const { t, lang } = useLang();
  const { isPremium, chatModel } = usePlan();
  const { loading, threads, activeThreadId, setActiveThreadId, seedComposer } =
    useMessages();
  useDocumentTitle(t("dash.nav.chat"));

  // s34 wave 8 (E6, 2026-04-28): deep-link the active thread from
  // the URL ?thread=<id> param. Used by the home-page "Continue
  // this conversation" tile so the user lands directly inside the
  // right thread instead of the most-recent default. We apply it
  // exactly once per id-change and only when the id appears in
  // the user's threads list (so a stale/old link can't put the
  // rail into a "selected unknown thread" state).
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = new URLSearchParams(window.location.search).get("thread");
    } catch {
      raw = null;
    }
    if (!raw) return;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return;
    if (activeThreadId === parsed) return;
    if (!threads.some((th) => th.id === parsed)) return;
    setActiveThreadId(parsed);
    // Strip the param so a refresh doesn't force the same thread
    // again after the user has navigated elsewhere within chat.
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("thread");
      window.history.replaceState({}, "", url.toString());
    } catch {
      /* swallow — non-critical */
    }
  }, [threads, activeThreadId, setActiveThreadId]);

  // v3.24 (2026-05-01) + v3.68 (B10, 2026-05-02): Weak Topic Mode
  // deep-link prefill. The /dashboard/chat?topic=...&subject=... URL
  // is emitted by the v3.23 weak-topic action chip and is also a
  // copy-link share surface. Seed the composer once on mount.
  //
  // v3.68: keep the params in the URL so the link stays shareable
  // and a refresh still seeds. To avoid clobbering a typing user on
  // refresh, skip the seed when the active thread already has a
  // non-empty saved draft — the user has been working, the draft
  // is the source of truth, the deep-link is just a hint.
  useEffect(() => {
    let params: ReturnType<typeof parseChatDeepLinkParams> = {
      topic: null,
      subject: null,
    };
    try {
      params = parseChatDeepLinkParams(window.location.search);
    } catch {
      /* swallow — non-critical */
    }
    if (!params.topic) return;
    // v3.68: protect in-progress drafts (per-thread, see draftStorage).
    // saveDraft skips whitespace, so a non-empty draft means the user
    // has actually typed something they want to keep.
    let existingDraft = "";
    try {
      existingDraft = loadDraft(activeThreadId);
    } catch {
      /* swallow — treat as no draft */
    }
    if (existingDraft.trim().length > 0) return;
    const seeded = renderChatPrefill(t("chat.weakTopic.prefill"), params);
    if (seeded) seedComposer(seeded);
    // v3.68: do NOT strip params from the URL — that broke shareable
    // links (B10). Refresh will re-seed only when the draft is empty.
    // Run exactly once on mount; subsequent edits belong to the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [limitModal, setLimitModal] = useState(false);
  const [paywallModal, setPaywallModal] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // s22 (BUG-S22-sidebar): thread rail open/closed. Default open on
  // ≥sm viewports (inline rail), closed on narrow (mobile drawer). We
  // read window.matchMedia once so the first paint doesn't flash.
  const [railOpen, setRailOpen] = useState<boolean>(() => {
    try {
      return window.matchMedia("(min-width: 768px)").matches;
    } catch {
      return true;
    }
  });

  const { handleSend, stop } = useSendMessage({
    onLimitReached: () => setLimitModal(true),
    onPaywall: () => setPaywallModal(true),
  });

  // Phase C (s22): global "?" shortcut opens the help overlay. Gated
  // so it does NOT fire while the user is typing (input/textarea/
  // contenteditable) or while any other modal is open — see
  // `shouldOpenShortcutsHelp` in shortcutGate.ts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // shortcutGate's ShortcutEventLike is a structurally-narrower
      // interface than DOM KeyboardEvent (EventTarget vs MinimalTarget).
      // The runtime shape matches; cast through unknown for strict TS.
      if (
        !shouldOpenShortcutsHelp(
          e as unknown as Parameters<typeof shouldOpenShortcutsHelp>[0],
        )
      )
        return;
      e.preventDefault();
      setShortcutsOpen(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia("(min-width: 768px)");
    } catch {
      return;
    }
    const onResize = () => {
      if (!mq?.matches) setRailOpen(false);
    };
    onResize();
    mq.addEventListener?.("change", onResize);
    return () => mq?.removeEventListener?.("change", onResize);
  }, []);

  if (loading) {
    return (
      <div className="flex h-full min-h-0 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        <div className="hidden md:block w-72 shrink-0 border-r border-zinc-200 bg-zinc-50 px-3 py-4">
          <Skeleton className="h-9 w-full mb-4" />
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-8 w-full mb-2" />
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col px-4 sm:px-6">
          <div className="flex-shrink-0 flex items-center justify-between py-4 border-b border-zinc-200">
            <div>
              <Skeleton className="h-5 w-32 mb-2" />
              <Skeleton className="h-3 w-48" />
            </div>
            <div className="flex items-center gap-3">
              <Skeleton className="h-6 w-16" />
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-4 w-12" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto space-y-4 py-5">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className={`flex ${
                  i % 2 === 0 ? "justify-start" : "justify-end"
                }`}
              >
                <Skeleton
                  className={`h-16 ${i % 2 === 0 ? "w-3/4" : "w-2/3"}`}
                />
              </div>
            ))}
          </div>
          <Skeleton className="h-20 w-full mb-4 rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
      {/* s33 (H6, 2026-04-28): skip-link to composer. Visually hidden
          until focused so sighted users don't see it; reveals on
          first Tab from page top so keyboard users can skip the
          rail/header chrome and go straight to typing. */}
      <SkipLink />
      <ThreadRail open={railOpen} onClose={() => setRailOpen(false)} />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">
        <div className="shrink-0 border-b border-zinc-200 bg-white/95 backdrop-blur">
          <div className="flex items-center gap-3 max-w-5xl w-full mx-auto px-4 sm:px-6 py-3.5">
            <button
              type="button"
              onClick={() => setRailOpen((v) => !v)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900"
              // s35 wave 25a (2026-04-28): aria-label is now
              // count-aware via threadRailToggleAria — closed state
              // appends "N бесед" with full RU paucal table; open
              // state stays the bare close verb (count is already
              // visible in the open rail).
              aria-label={threadRailToggleAria({
                threadCount: threads.length,
                open: railOpen,
                lang: lang === "kz" ? "kz" : "ru",
              })}
              aria-pressed={railOpen}
            >
              {railOpen ? (
                <PanelLeftClose size={16} />
              ) : (
                <PanelLeft size={16} />
              )}
            </button>
            <div className="flex-1 min-w-0">
              <ChatHeader
                onClearRequest={() => setConfirmClear(true)}
                onShortcutsRequest={() => setShortcutsOpen(true)}
              />
            </div>
          </div>
        </div>

        {!isPremium && (
          <div className="my-4 flex w-[calc(100%-2rem)] shrink-0 items-center gap-2.5 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 max-w-5xl mx-auto">
            <Crown size={14} className="text-zinc-600 shrink-0" />
            <p
              className="text-zinc-600 flex-1"
              style={{ fontSize: 12, lineHeight: 1.5 }}
            >
              {t("chat.freeNotice")} ({chatModel}){" "}
              <button
                onClick={() => setPaywallModal(true)}
                className="text-zinc-900 underline-offset-2 hover:underline"
                style={{ fontWeight: 600 }}
              >
                {t("chat.upgradeLink")}
              </button>{" "}
              {t("chat.upgradeFor")}.
            </p>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col max-w-5xl w-full mx-auto px-4 sm:px-6 pt-5">
          <ChatTranscript
            onPickStarter={(p) => void handleSend(p)}
            onStop={stop}
            onRegenerate={(priorUserText) => void handleSend(priorUserText)}
          />
          <ChatComposer onSend={handleSend} onStop={stop} />
        </div>

        <ConfirmClearController
          open={confirmClear}
          onCancel={() => setConfirmClear(false)}
        />

        {/* s35 wave 45 (2026-04-28): each lazy modal is wrapped in
            its own Suspense boundary AND gated on its own open
            flag, so the chunk import is only triggered when the
            modal is actually about to appear. Suspense fallback is
            null because the modal is itself off-screen until its
            internal `open` animation runs. */}
        {limitModal && (
          <Suspense fallback={null}>
            <LimitReachedModalLazy
              open={limitModal}
              onClose={() => setLimitModal(false)}
              counter="chatMessages"
              onUpgrade={() => setPaywallModal(true)}
            />
          </Suspense>
        )}
        {paywallModal && (
          <Suspense fallback={null}>
            <PaywallModalLazy
              open={paywallModal}
              onClose={() => setPaywallModal(false)}
              feature="chat"
            />
          </Suspense>
        )}
        {shortcutsOpen && (
          <Suspense fallback={null}>
            <ShortcutsHelpLazy
              open={shortcutsOpen}
              onClose={() => setShortcutsOpen(false)}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}

/**
 * The clear-confirm needs access to `useMessages().clear`, so we
 * colocate the controller inside the shell subtree. This avoids
 * bloating `ChatPageShell` with the one-shot destructive action.
 */
function ConfirmClearController({
  open,
  onCancel,
}: {
  open: boolean;
  onCancel: () => void;
}) {
  const { clear } = useMessages();
  // s35 wave 45 (2026-04-28): only mount the lazy modal once the
  // user has actually requested the clear-history flow. Avoids
  // pulling the ClearConfirmModal chunk on first paint.
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <ClearConfirmModalLazy
        open={open}
        onCancel={onCancel}
        onConfirm={async () => {
          await clear();
          onCancel();
        }}
      />
    </Suspense>
  );
}

export function ChatPage() {
  return (
    <MessagesProvider>
      <ChatPageShell />
    </MessagesProvider>
  );
}

export default ChatPage;
