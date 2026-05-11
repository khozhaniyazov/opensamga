/**
 * s35 wave 25d (2026-04-28) — pure helper for the composer's
 * SR streaming live-region.
 *
 * Boss bug: there's already a `[role="status"][aria-live="polite"]`
 * slot rendered next to the send button (see ChatComposer end-of-
 * file), but its `<span>` is currently empty. So SR users get NO
 * cue when:
 *   - their message is being submitted,
 *   - the model is generating a reply,
 *   - the reply has finished streaming.
 *
 * The visible chrome shows a spinner + a Stop button, which is
 * great for sighted users — useless for SR users. We fix that by
 * driving the existing live-region with a transition-aware
 * sentence, computed from `(prev, next)` of the `isSending` flag.
 *
 * Transitions:
 *   false → true  : "Сообщение отправлено, ждём ответ"
 *   true  → false : "Ответ получен"
 *   no change     : "" (don't speak)
 *
 * KZ mirrors. Pure: no DOM, no React. Caller is the component.
 *
 * Why a wrapper helper rather than a single function with both
 * states? `nextComposerSendStatus({prev,next,lang})` is the clean
 * one-shot for the component (only fires on edges). The bare
 * `composerSendStatus(state, lang)` exists so wave-22-style copy
 * announcements can be re-used without state diffing.
 */

export type ComposerStatusLang = "ru" | "kz";

export type ComposerStatusEdge = "send" | "complete" | null;

/** Pure helper — full sr-only sentence for a given streaming
 *  state. Returns "" when the state doesn't warrant speaking. */
export function composerSendStatus(
  edge: ComposerStatusEdge,
  lang: ComposerStatusLang,
): string {
  const langSafe: ComposerStatusLang = lang === "kz" ? "kz" : "ru";
  if (edge === null) return "";
  if (edge === "send") {
    return langSafe === "kz"
      ? "Хабарлама жіберілді, жауапты күтудеміз"
      : "Сообщение отправлено, ждём ответ";
  }
  // complete
  return langSafe === "kz" ? "Жауап келді" : "Ответ получен";
}

/** Pure helper — derives the edge from a (prev, next) pair of the
 *  streaming flag. Returns null when nothing meaningful changed. */
export function detectComposerStatusEdge(args: {
  prevSending: boolean;
  nextSending: boolean;
}): ComposerStatusEdge {
  const { prevSending, nextSending } = args;
  if (!prevSending && nextSending) return "send";
  if (prevSending && !nextSending) return "complete";
  return null;
}

/** Convenience — given `(prev, next, lang)`, returns the live
 *  sentence to flush, or "" to stay silent. */
export function nextComposerSendStatus(args: {
  prevSending: boolean;
  nextSending: boolean;
  lang: ComposerStatusLang;
}): string {
  const edge = detectComposerStatusEdge({
    prevSending: !!args.prevSending,
    nextSending: !!args.nextSending,
  });
  return composerSendStatus(edge, args.lang);
}
