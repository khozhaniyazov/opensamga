/**
 * Phase B (s21, 2026-04-22): sticky composer at the bottom of the
 * chat scroll container. Owns only local input state + the textarea
 * auto-grow; submission delegates to the `useSendMessage` hook via
 * the `onSend` prop.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Send, Square } from "lucide-react";
import { useLang } from "../../LanguageContext";
import { useMessages } from "./MessagesContext";
import { clearDraft, loadDraft, saveDraft } from "./draftStorage";
import {
  ROTATION_INTERVAL_MS,
  nextPlaceholderIndex,
  pickPlaceholder,
  placeholdersFor,
} from "./rotatingPlaceholder";
import { SlashMenuPopover } from "./SlashMenuPopover";
import {
  SLASH_COMMANDS,
  clampMenuIndex,
  filterSlashCommands,
  shouldShowSlashMenu,
  slashMenuQuery,
  type SlashCommand,
} from "./slashMenu";
import { CitePagePicker } from "./CitePagePicker";
import { injectCiteHint, type CitePageHint } from "./citeAPage";
import { composerPaddingBottomCss } from "./keyboardInset";
import { useKeyboardInset } from "./useKeyboardInset";
import {
  composerCounterMilestone,
  composerCounterAnnouncement,
  type ComposerCounterMilestone,
} from "./composerCounterAnnounce";
import { matchSlashShortcut, applySlashShortcut } from "./slashShortcutMatch";
import {
  trackSlashCommandSelected,
  trackSlashMenuOpened,
} from "../../../lib/telemetry";
import {
  composerSendButtonAriaLabel,
  composerSendButtonTitle,
} from "./composerSendButtonAria";
import { composerCounterStatusLabel } from "./composerCounterStatusLabel";
import { nextComposerSendStatus } from "./composerSendStatus";
import {
  COMPOSER_HINT_DESCRIPTION_ID,
  composerHintAriaText,
} from "./composerHintAria";
import {
  nextImeComposing,
  shouldSuppressEnterForIme,
} from "./imeCompositionState";
import { chatAnimationClass } from "./chatAnimationClasses";
import { useReducedMotion } from "./useReducedMotion";
// v3.9 (F4, 2026-04-30): voice input — feature-flagged + capability-gated.
// Renders nothing in unsupported browsers / when VITE_FEATURE_VOICE_INPUT
// is off, so the import is safe even if you never see the button.
import { VoiceInputButton } from "./VoiceInputButton";
import { appendTranscriptToDraft } from "./voiceInputState";
import { ImageUploadButton } from "./ImageUploadButton";

interface ChatComposerProps {
  onSend: (text: string) => void | Promise<void>;
  /** Phase C (s22): user-initiated stop for an in-flight response.
   *  Optional so this component stays backwards-compatible with
   *  callers that don't wire cancellation (tests / storybook). */
  onStop?: () => void;
}

// F-09 (polish): soft limit (display warning) + hard cap (block submit).
// Numbers chosen empirically — Samga's longest legitimate prompt observed
// in QA was ~3500 chars (a multi-step word problem). 4000 = soft warning,
// 8000 = hard block; matches what the backend chat router treats as
// reasonable single-turn context.
const COMPOSER_SOFT_LIMIT = 4000;
const COMPOSER_HARD_LIMIT = 8000;

export function ChatComposer({ onSend, onStop }: ChatComposerProps) {
  const { t, lang } = useLang();
  // s35 wave 33b (2026-04-28): resolved reduced-motion flag, fed to
  // chatAnimationClass() for the send/stop press transitions.
  const composerReduceMotion = useReducedMotion();
  const { isSending, composerSeed, activeThreadId } = useMessages();
  // s31 (B4, 2026-04-27): rotating placeholder cycles through five
  // language-specific suggestions so users learn what they can ask
  // without the static "ask about a topic..." text. Index 0 matches
  // the historic `chat.placeholder` copy, so the first paint is
  // identical to before B4.
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  // Pause rotation while the textarea is focused (so we don't yank
  // the visual context out from under a typing user) and while
  // sending (the textarea is disabled anyway). `isFocused` flips on
  // focus/blur of the textarea below.
  const [isFocused, setIsFocused] = useState(false);
  // s35 wave 37 (2026-04-28): tracked IME composition flag. Updated
  // by `onCompositionStart` / `onCompositionEnd` via `nextImeComposing`
  // so the SR keyboard-shortcut hint can suppress its "Enter — отправить"
  // cue while a composition is mid-flight (Enter commits the IME glyph
  // rather than sending the message). Pre-wave the helper accepted a
  // `composing` arg but the composer hard-coded it to `false`.
  const [imeComposing, setImeComposing] = useState(false);
  // s31 (F1, 2026-04-27): slash-command menu state. Active index is
  // clamped against the *filtered* list length so backspacing the
  // query never points past the visible items.
  const [slashIdx, setSlashIdx] = useState(0);

  // Phase C (s22): hydrate any draft from the previous session so a
  // user who accidentally closed the tab mid-thought doesn't lose
  // their typing. Synchronous (not via useEffect) so the first render
  // already shows the restored text — avoids a 1-frame flash of an
  // empty textarea before the draft appears.
  //
  // s31 (F3): drafts are scoped per-thread. The initial render uses
  // whatever `activeThreadId` is at mount time; the effect below
  // re-loads when the user switches threads.
  const [input, setInput] = useState<string>(() => loadDraft(activeThreadId));
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Phase C (s22): edit-and-resubmit plumbing — whenever the parent
  // bumps `composerSeed.nonce`, overwrite the current textarea with
  // the seeded text and focus the textarea so the user can tweak it.
  // We key on `nonce` instead of `text` so re-sending the same prompt
  // twice in a row still fires the effect.
  useEffect(() => {
    if (composerSeed.nonce === 0) return;
    setInput(composerSeed.text);
    // Focus + move caret to end on the next frame so the autoGrow
    // effect has a chance to size the textarea first.
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const len = composerSeed.text.length;
      try {
        el.setSelectionRange(len, len);
      } catch {
        /* noop */
      }
    });
  }, [composerSeed.nonce, composerSeed.text]);

  // s31 (F3): when the user switches threads, swap the textarea
  // content for that thread's draft. Skip if the seed effect is
  // active (composerSeed.nonce > 0) so an in-flight edit-and-resubmit
  // isn't clobbered. We track the "current" thread in a ref so we
  // can detect a true thread-switch (not a render with the same id).
  const lastThreadIdRef = useRef<number | null | undefined>(activeThreadId);
  useEffect(() => {
    if (lastThreadIdRef.current === activeThreadId) return;
    lastThreadIdRef.current = activeThreadId;
    setInput(loadDraft(activeThreadId));
  }, [activeThreadId]);

  // Debounced localStorage persistence of the current draft —
  // scoped to whichever thread is currently active.
  useEffect(() => {
    const handle = setTimeout(() => {
      saveDraft(input, activeThreadId);
    }, 250);
    return () => clearTimeout(handle);
  }, [input, activeThreadId]);

  // Auto-grow up to ~6 lines, then scroll internally.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, 160);
    el.style.height = `${next}px`;
  }, [input]);

  // s31 (B4): rotation timer. Only runs while the textarea is empty,
  // unfocused, and not sending — typing/focused/sending users get a
  // stable placeholder. The interval is cleared on every gate flip
  // and on unmount so we never leak a timer.
  const rotationActive = !isFocused && !isSending && input.length === 0;
  useEffect(() => {
    if (!rotationActive) return;
    const list = placeholdersFor(lang === "kz" ? "kz" : "ru");
    const handle = setInterval(() => {
      setPlaceholderIdx((prev) => nextPlaceholderIndex(prev, list.length));
    }, ROTATION_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [rotationActive, lang]);

  // Phase C (s22): refocus the textarea on first mount and whenever a
  // response finishes so keyboard users can keep typing follow-ups.
  useEffect(() => {
    if (!isSending) {
      // Small guard: do not steal focus from any focused element with
      // an aria-modal ancestor (open modal), which would trap the
      // user's focus in a surprising place.
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest?.('[role="dialog"],[aria-modal="true"]')) return;
      textareaRef.current?.focus();
    }
  }, [isSending]);

  async function submit() {
    if (!input.trim() || isSending) return;
    if (input.length > COMPOSER_HARD_LIMIT) return; // F-09: hard cap
    const value = input;
    setInput("");
    // Clear immediately (don't wait for the 250ms debounce tick) so a
    // quick tab close after send doesn't restore the just-sent prompt.
    clearDraft(activeThreadId);
    await onSend(value);
  }

  // F-09: only show the counter once we're meaningfully into the budget;
  // showing "0 / 8000" on every render is just noise.
  const len = input.length;
  const showCounter = len >= COMPOSER_SOFT_LIMIT;
  const overLimit = len > COMPOSER_HARD_LIMIT;

  // s35 wave 13: throttle the SR announcement of the counter so screen
  // readers only speak when the user crosses a milestone (entered the
  // warn zone, hit 80% of the cap, went over). The visible counter
  // still updates every keystroke; only the aria-live cell is gated.
  const milestoneRef = useRef<ComposerCounterMilestone>("below");
  const [counterAnnouncement, setCounterAnnouncement] = useState("");
  // s35 wave 25d (2026-04-28): SR-only streaming status. Drives the
  // existing aria-live cell next to the send button so SRs hear
  // "Сообщение отправлено, ждём ответ" / "Ответ получен" on send /
  // complete edges (transition-aware, no chatter mid-stream).
  const [sendStatusAnnounce, setSendStatusAnnounce] = useState("");
  const prevSendingRef = useRef(false);
  useEffect(() => {
    const next = composerCounterMilestone({
      len,
      soft: COMPOSER_SOFT_LIMIT,
      hard: COMPOSER_HARD_LIMIT,
    });
    const speak = composerCounterAnnouncement(
      milestoneRef.current,
      next,
      { len, soft: COMPOSER_SOFT_LIMIT, hard: COMPOSER_HARD_LIMIT },
      lang === "kz" ? "kz" : "ru",
    );
    if (speak) setCounterAnnouncement(speak);
    milestoneRef.current = next;
  }, [len, lang]);

  // s35 wave 25d: send/complete edge announcements.
  useEffect(() => {
    const sentence = nextComposerSendStatus({
      prevSending: prevSendingRef.current,
      nextSending: isSending,
      lang: lang === "kz" ? "kz" : "ru",
    });
    if (sentence) setSendStatusAnnounce(sentence);
    prevSendingRef.current = isSending;
  }, [isSending, lang]);

  // s31 (F1): slash-menu visibility + filtered list. Keyboard nav is
  // wired in onKeyDown below; selection is wired via `selectSlash()`.
  const slashOpen = shouldShowSlashMenu(input);
  const slashQuery = slashMenuQuery(input);
  const slashFiltered = slashOpen
    ? filterSlashCommands(slashQuery, SLASH_COMMANDS, (cmd) => t(cmd.titleKey))
    : [];

  // Reset the active row whenever the visible list shrinks below the
  // current pointer (e.g. user backspaced the query and the filter
  // grew, or typed a more specific query and the filter narrowed).
  useEffect(() => {
    if (!slashOpen) {
      setSlashIdx(0);
      return;
    }
    setSlashIdx((prev) => clampMenuIndex(prev, slashFiltered.length || 1));
  }, [slashOpen, slashFiltered.length]);

  // s35 wave 59 (2026-04-28): emit `chat_slash_menu_opened` exactly
  // once per closed→open transition. Tracking false→true with a ref
  // (not state) avoids one event per re-render while the menu is
  // open. The match_count we report is the filtered list size at
  // open time — usually SLASH_COMMANDS.length on the bare `/` but
  // could be smaller if the user typed `/cit` straight in.
  const prevSlashOpenRef = useRef<boolean>(false);
  useEffect(() => {
    if (slashOpen && !prevSlashOpenRef.current) {
      trackSlashMenuOpened({ match_count: slashFiltered.length });
    }
    prevSlashOpenRef.current = slashOpen;
    // We intentionally do NOT depend on slashFiltered.length so a
    // narrowing filter doesn't fire a second open event mid-typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slashOpen]);

  // s35 wave 40 (F6 picker, 2026-04-28): cite-a-page modal state.
  // Triggered from the slash menu when the row's `kind === "picker"`
  // (currently only `/cite`). Confirming injects a fenced
  // `samga.cite` envelope at the top of the current draft via
  // `injectCiteHint` (idempotent — re-running with an existing hint
  // is a no-op).
  const [citePickerOpen, setCitePickerOpen] = useState(false);

  function selectSlash(cmd: SlashCommand, via: "mouse" | "keyboard" = "mouse") {
    // s35 wave 59 (2026-04-28): emit the picked-command event so we
    // can see uptake per command_id + uptake by activation path.
    // We compute rank_position from the current filtered list — the
    // same list the user sees at click time. SlashCommand carries a
    // stable `id` which is the canonical telemetry key.
    const idx = slashFiltered.findIndex((c) => c.id === cmd.id);
    trackSlashCommandSelected({
      command_id: cmd.id,
      rank_position: idx >= 0 ? idx : 0,
      match_count: slashFiltered.length,
      via,
    });
    // s35 wave 40: picker rows open a modal instead of seeding the
    // composer. Strip the leading `/cite` query from the textarea
    // so the user is left with whatever prose they had typed before
    // the slash, then open the picker.
    if (cmd.kind === "picker" && cmd.id === "cite") {
      const cleaned = input.startsWith("/")
        ? input.replace(/^\/\S*\s?/, "")
        : input;
      setInput(cleaned);
      setCitePickerOpen(true);
      return;
    }
    const prompt = t(cmd.promptKey);
    setInput(prompt);
    // Re-focus and put the caret at the end so the user can edit
    // the prompt in place before sending.
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      try {
        el.setSelectionRange(prompt.length, prompt.length);
      } catch {
        /* noop */
      }
    });
  }

  // s34 wave 2 (G2, 2026-04-28): lift the composer above the soft
  // keyboard on mobile. `useKeyboardInset` returns the difference
  // between the layout viewport and the visual viewport (i.e. how
  // many px the keyboard is occluding). We layer that on top of the
  // existing safe-area-inset so hardware home-bars + soft keyboards
  // both clear the textarea. On desktop the inset is always 0 so
  // visuals are unchanged.
  const keyboardInset = useKeyboardInset();

  return (
    <div
      className="flex-shrink-0 pt-3 md:pb-5 transition-[padding] duration-150"
      style={{ paddingBottom: composerPaddingBottomCss(keyboardInset) }}
    >
      {/* s35 wave 40 (F6 picker, 2026-04-28): cite-a-page modal.
          Mounted at the composer-root level so its focus trap
          doesn't fight with the slash menu (which dismisses as soon
          as the textarea blurs). Confirm path injects the envelope
          at the top of the current draft. */}
      <CitePagePicker
        open={citePickerOpen}
        onCancel={() => setCitePickerOpen(false)}
        onConfirm={(hint: CitePageHint) => {
          setCitePickerOpen(false);
          setInput((prev) => injectCiteHint(prev, hint));
          requestAnimationFrame(() => {
            textareaRef.current?.focus();
          });
        }}
      />
      <div className="group relative rounded-2xl border border-zinc-200/80 bg-white shadow-[0_1px_2px_rgba(24,24,27,0.04),0_8px_24px_-12px_rgba(24,24,27,0.08)] transition-all duration-200 focus-within:border-zinc-300 focus-within:shadow-[0_2px_4px_rgba(24,24,27,0.05),0_12px_32px_-12px_rgba(24,24,27,0.12)] focus-within:ring-2 focus-within:ring-amber-100/60 samga-anim-composer-glow">
        {/* s31 (F1): slash-command popover. Anchored to this wrapper
            via absolute/bottom-full so it sits just above the
            textarea. Visibility owned by `slashOpen`. */}
        <SlashMenuPopover
          isOpen={slashOpen}
          query={slashQuery}
          activeIndex={slashIdx}
          onSelect={selectSlash}
          onHover={(i) => setSlashIdx(i)}
        />
        <textarea
          ref={textareaRef}
          // s33 (H6, 2026-04-28): stable id is the skip-link target.
          // ChatPage's <SkipLink /> jumps focus here on Enter/Space.
          id="chat-composer-textarea"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // s35 wave 17a (2026-04-28): Cmd/Ctrl+/ recall — opens
            // the slash menu without forcing the user to clear the
            // textarea first. We don't open the menu directly;
            // instead we prepend "/" to the input so the existing
            // `shouldShowSlashMenu` flow fires on the next render
            // (single source of truth for menu open state).
            if (matchSlashShortcut(e as unknown as KeyboardEvent)) {
              e.preventDefault();
              const ta = textareaRef.current;
              const selStart =
                ta && typeof ta.selectionStart === "number"
                  ? ta.selectionStart
                  : input.length;
              const next = applySlashShortcut(input, selStart);
              setInput(next.value);
              // Defer caret placement until React has flushed the
              // value change, otherwise selectionStart still points
              // at the old (pre-slash) string and the caret jumps
              // mid-word.
              requestAnimationFrame(() => {
                const t2 = textareaRef.current;
                if (t2) {
                  t2.focus();
                  try {
                    t2.setSelectionRange(next.caret, next.caret);
                  } catch {
                    /* noop — IE fallback path, never hit */
                  }
                }
              });
              return;
            }
            // s31 (F1): when the slash menu is open, intercept arrow
            // keys + Enter/Tab so navigation/select happens IN the
            // popover instead of the textarea. The textarea doesn't
            // care about Up/Down/Tab in single-line content anyway.
            if (slashOpen && slashFiltered.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSlashIdx((prev) =>
                  clampMenuIndex(prev + 1, slashFiltered.length),
                );
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSlashIdx((prev) =>
                  clampMenuIndex(prev - 1, slashFiltered.length),
                );
                return;
              }
              if (e.key === "Home") {
                e.preventDefault();
                setSlashIdx(0);
                return;
              }
              if (e.key === "End") {
                e.preventDefault();
                setSlashIdx(slashFiltered.length - 1);
                return;
              }
              if (
                (e.key === "Enter" &&
                  !e.shiftKey &&
                  !shouldSuppressEnterForIme({
                    reactIsComposing: e.nativeEvent.isComposing,
                    trackedComposing: imeComposing,
                  })) ||
                e.key === "Tab"
              ) {
                e.preventDefault();
                const cmd = slashFiltered[slashIdx];
                if (cmd) selectSlash(cmd, "keyboard");
                return;
              }
              if (e.key === "Escape") {
                // Soft-dismiss: clear the slash query so the menu
                // closes without disturbing an in-flight response
                // (Escape's stop semantics still fire below).
                e.preventDefault();
                setInput("");
                return;
              }
            }
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !shouldSuppressEnterForIme({
                reactIsComposing: e.nativeEvent.isComposing,
                trackedComposing: imeComposing,
              })
            ) {
              e.preventDefault();
              void submit();
              return;
            }
            // Phase C (s22): Escape stops an in-flight response.
            // Only fires when
            // we're actually mid-send and a stop handler is wired —
            // otherwise Escape does nothing (so the user's textarea
            // focus state isn't surprising outside of a send).
            if (e.key === "Escape" && isSending && onStop) {
              e.preventDefault();
              onStop();
            }
          }}
          placeholder={pickPlaceholder(
            placeholdersFor(lang === "kz" ? "kz" : "ru"),
            placeholderIdx,
          )}
          aria-label={t("chat.composer.label") || t("chat.placeholder")}
          // s35 wave 33a (2026-04-28): bind keyboard-shortcut hint
          // sibling so SR users hear available shortcuts on focus.
          aria-describedby={COMPOSER_HINT_DESCRIPTION_ID}
          rows={1}
          className="block w-full resize-none bg-transparent px-5 pb-3 pt-4 text-[15px] text-zinc-900 placeholder-zinc-400 focus:outline-none disabled:cursor-wait disabled:text-zinc-500"
          style={{ maxHeight: 160, lineHeight: 1.75 }}
          disabled={isSending}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          // s35 wave 37 (2026-04-28): IME composition tracking. The
          // pure FSM in `imeCompositionState` decides the next flag
          // value; React events feed it event.type and prev state.
          // Defence-in-depth alongside `nativeEvent.isComposing` —
          // Safari can drop the latter on the trailing keydown.
          onCompositionStart={(e) =>
            setImeComposing((prev) =>
              nextImeComposing({ eventType: e.type, prev }),
            )
          }
          onCompositionUpdate={(e) =>
            setImeComposing((prev) =>
              nextImeComposing({ eventType: e.type, prev }),
            )
          }
          onCompositionEnd={(e) =>
            setImeComposing((prev) =>
              nextImeComposing({ eventType: e.type, prev }),
            )
          }
        />
        {/* s35 wave 33a (2026-04-28): sr-only keyboard-shortcut hint
            paired with the textarea via `aria-describedby`. State-aware
            (sending / slash-menu-open) so SR users hear the right
            shortcuts for the current mode. Visible chrome unchanged
            — sighted users continue to discover shortcuts via the
            existing footer strip. */}
        <span id={COMPOSER_HINT_DESCRIPTION_ID} className="sr-only">
          {composerHintAriaText({
            isSending,
            composing: imeComposing,
            slashMenuOpen: slashOpen,
            lang: lang === "kz" ? "kz" : "ru",
          })}
        </span>
        <div className="flex items-center justify-end gap-3 border-t border-zinc-100/80 px-3.5 py-2.5">
          {/* F-09: length indicator. Hidden under the soft limit, then shows
           * `len / hard`. Turns red once over the hard cap and the send
           * button is also disabled (see below). */}
          {showCounter ? (
            <span
              className={`mr-auto text-[12px] tabular-nums ${
                overLimit ? "text-rose-600" : "text-zinc-500"
              }`}
              // s35 wave 18a (2026-04-28): hover/SR title — explains
              // what the bare digits mean. The visible text stays
              // numeric to keep the chrome tight; the helper-driven
              // string surfaces only on hover (sighted) or via AT.
              title={composerCounterStatusLabel({
                len,
                soft: COMPOSER_SOFT_LIMIT,
                hard: COMPOSER_HARD_LIMIT,
                lang: lang === "kz" ? "kz" : "ru",
              })}
              aria-label={composerCounterStatusLabel({
                len,
                soft: COMPOSER_SOFT_LIMIT,
                hard: COMPOSER_HARD_LIMIT,
                lang: lang === "kz" ? "kz" : "ru",
              })}
            >
              {len.toLocaleString()} / {COMPOSER_HARD_LIMIT.toLocaleString()}
              {overLimit ? (
                <span className="ml-2 hidden sm:inline">
                  {t("chat.length.over")}
                </span>
              ) : null}
            </span>
          ) : null}
          {/* s35 wave 13: SR-only aria-live cell, sibling of the
              visible counter. Throttled by composerCounterAnnounce
              so it speaks at most three times per typing session
              (entered warn zone / 80% / over cap) instead of every
              keystroke. */}
          <span role="status" aria-live="polite" className="sr-only">
            {counterAnnouncement}
          </span>
          {/* s35 wave 25d (2026-04-28): second sr-only live-region
              for streaming send/complete edges. Separate cell so
              the counter announcement and the send-state
              announcement don't overwrite each other in the same
              tick. */}
          <span role="status" aria-live="polite" className="sr-only">
            {sendStatusAnnounce}
          </span>
          {/* v3.9 (F4, 2026-04-30): mic button. Hidden when feature
              flag VITE_FEATURE_VOICE_INPUT is off OR the browser
              has no SpeechRecognition. Disabled while sending so it
              can't fire mid-stream. Recognized text is appended to
              the existing draft via `appendTranscriptToDraft` —
              never auto-sent, the user always hits Send. */}
          <VoiceInputButton
            onTranscript={(transcript) => {
              setInput((prev) => appendTranscriptToDraft(prev, transcript));
              requestAnimationFrame(() => {
                textareaRef.current?.focus();
              });
            }}
            disabled={isSending}
          />
          {/* v3.12 (F5, 2026-04-30): image-upload button. Hidden
              when feature flag VITE_FEATURE_IMAGE_OCR is off OR the
              browser lacks FormData/File/fetch. On success the
              composer is *seeded* (not appended) with the OCR'd
              prompt so the user can edit before sending. Errors
              route through the existing aria-live status cell. */}
          <ImageUploadButton
            onSeed={(seedText) => {
              setInput(seedText);
              requestAnimationFrame(() => {
                textareaRef.current?.focus();
              });
            }}
            onError={(message) => {
              setSendStatusAnnounce(message);
            }}
            disabled={isSending}
          />
          {/* s34 wave 1 (G5, 2026-04-28): bump send/stop primary
              actions from h-10 w-10 (40px) to h-11 w-11 (44px) so
              they pass WCAG 2.5.5 AAA / Apple HIG without needing
              a hidden hit-area overlay. These are the most-tapped
              controls in the entire app — getting them to 44 native
              feels obviously right. */}
          {isSending && onStop ? (
            <button
              type="button"
              onClick={() => onStop()}
              className={
                "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-500 text-white shadow-[0_4px_12px_-4px_rgba(244,63,94,0.5)] transition-all hover:bg-rose-600 hover:scale-[1.03] active:scale-[0.97] " +
                // s35 wave 33b (2026-04-28): modern press feedback —
                // smooth scale-down on :active gated by reduce-motion.
                chatAnimationClass({
                  token: "sendPress",
                  reduce: composerReduceMotion,
                })
              }
              aria-label={t("chat.stop") || "Stop"}
              title={t("chat.stop") || "Stop"}
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={isSending || !input.trim() || overLimit}
              className={
                "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-all duration-200 " +
                (isSending || !input.trim() || overLimit
                  ? "bg-zinc-100 text-zinc-300 cursor-not-allowed"
                  : "bg-gradient-to-br from-zinc-900 to-zinc-950 text-white shadow-[0_4px_12px_-4px_rgba(24,24,27,0.4)] hover:shadow-[0_6px_16px_-4px_rgba(24,24,27,0.5)] hover:scale-[1.03] active:scale-[0.97]") +
                " " +
                chatAnimationClass({
                  token: "sendPress",
                  reduce: composerReduceMotion,
                })
              }
              aria-label={composerSendButtonAriaLabel({
                input,
                hardLimit: COMPOSER_HARD_LIMIT,
                isSending,
                sendLabel: t("chat.send") || null,
                lang: lang === "kz" ? "kz" : "ru",
              })}
              title={composerSendButtonTitle({
                input,
                hardLimit: COMPOSER_HARD_LIMIT,
                isSending,
                sendLabel: t("chat.send") || null,
                lang: lang === "kz" ? "kz" : "ru",
              })}
            >
              <Send
                size={16}
                className={input.trim() ? "translate-x-[1px]" : ""}
              />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
