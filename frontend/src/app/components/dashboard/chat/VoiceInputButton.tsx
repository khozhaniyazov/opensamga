/**
 * v3.9 (F4, 2026-04-30) — voice input button.
 *
 * Mounted inside ChatComposer's footer strip next to the send/stop
 * button. Hidden entirely when:
 *   1. The browser doesn't expose any SpeechRecognition constructor
 *      (Firefox desktop, older Safari) — see voiceInputCapability.
 *   2. The feature flag VITE_FEATURE_VOICE_INPUT isn't truthy.
 *
 * The flag default is OFF so this lands behind a single env switch.
 * Flip to "true" in `.env.local` to enable in dev.
 *
 * Behaviour: tap to start, tap again to stop. Recognized text is
 * appended to the draft via `onTranscript`; we do NOT auto-send so
 * the user can edit before sending (KZ recognition isn't reliable
 * enough to send blindly).
 *
 * No streaming partial results are committed to the draft — only
 * `isFinal` SpeechRecognitionResults land. Partial results would
 * cause the textarea to flicker mid-speech which fights the
 * existing rotating placeholder + IME-composing handlers.
 */

import { useEffect, useMemo, useReducer, useRef } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { useLang } from "../../LanguageContext";
import {
  detectVoiceCapability,
  preferredVoiceLocale,
} from "./voiceInputCapability";
import {
  classifyVoiceError,
  voiceMicAriaLabel,
  voiceReducer,
  type VoiceState,
} from "./voiceInputState";

interface Props {
  /** Called with the recognized transcript (already trimmed).
   *  Caller decides whether to append to the existing draft. */
  onTranscript: (transcript: string) => void;
  /** Hide entirely while the assistant is streaming so the user
   *  can't kick off a recognizer mid-answer (recognizer audio path
   *  competes with the user's audio attention). */
  disabled?: boolean;
}

const FEATURE_FLAG = (() => {
  try {
    const env = (import.meta as unknown as { env?: Record<string, unknown> })
      .env;
    const v = env?.["VITE_FEATURE_VOICE_INPUT"];
    return v === "true" || v === true;
  } catch {
    return false;
  }
})();

const INITIAL_STATE: VoiceState = { kind: "idle" };

export function VoiceInputButton({ onTranscript, disabled = false }: Props) {
  const { lang } = useLang();
  const langSafe: "ru" | "kz" = lang === "kz" ? "kz" : "ru";

  // Capability probe runs once. If the browser has no recognizer
  // at all we render nothing (the button just disappears) — there's
  // no useful UX for "voice input not supported", and the menu
  // already has /voice text input as a fallback path.
  const cap = useMemo(() => detectVoiceCapability(), []);
  const recognitionRef = useRef<unknown>(null);
  const [state, dispatch] = useReducer(voiceReducer, INITIAL_STATE);

  // Stop the recognizer if the component unmounts mid-listen so we
  // don't leak the audio capture across page navigations.
  useEffect(() => {
    return () => {
      const rec = recognitionRef.current as {
        stop?: () => void;
        abort?: () => void;
      } | null;
      try {
        rec?.stop?.();
      } catch {
        /* noop */
      }
      try {
        rec?.abort?.();
      } catch {
        /* noop */
      }
      recognitionRef.current = null;
    };
  }, []);

  // Hide entirely when the flag is off OR the browser can't do this.
  if (!FEATURE_FLAG) return null;
  if (!cap.supported) return null;

  const handleClick = () => {
    if (disabled) return;
    if (state.kind === "listening") {
      const rec = recognitionRef.current as { stop?: () => void } | null;
      try {
        rec?.stop?.();
      } catch {
        /* noop */
      }
      // The recognizer's `onend` will dispatch {type:"stopped"}.
      return;
    }
    if (state.kind === "requesting") {
      // Already asking — ignore double-taps.
      return;
    }
    dispatch({ type: "tap" });
    try {
      const Ctor = cap.Ctor as new () => SpeechRecognitionLike;
      const rec = new Ctor();
      rec.lang = preferredVoiceLocale(langSafe);
      rec.continuous = false;
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onstart = () => dispatch({ type: "started" });
      rec.onend = () => {
        recognitionRef.current = null;
        dispatch({ type: "stopped" });
      };
      rec.onerror = (e: { error?: string }) => {
        const reason = classifyVoiceError(e?.error);
        recognitionRef.current = null;
        dispatch({ type: "error", reason });
      };
      rec.onresult = (event: SpeechRecognitionResultListLike) => {
        // Final-result-only mode (interimResults=false) means each
        // result here is already final, but we double-check to be
        // safe across browser quirks. ArrayLike-not-Iterable so we
        // index-walk explicitly rather than for-of.
        let combined = "";
        const results = event.results;
        const len = results ? results.length : 0;
        for (let i = 0; i < len; i += 1) {
          const r = results[i];
          if (!r) continue;
          if (r.isFinal === false) continue;
          const alt = r[0];
          if (alt && typeof alt.transcript === "string") {
            combined += " " + alt.transcript;
          }
        }
        const trimmed = combined.trim();
        if (trimmed.length > 0) onTranscript(trimmed);
      };
      recognitionRef.current = rec;
      rec.start();
    } catch {
      recognitionRef.current = null;
      dispatch({ type: "error", reason: "generic" });
    }
  };

  const aria = voiceMicAriaLabel({ state, lang: langSafe });

  // Visual style: the mic chip mirrors the send/stop button shape
  // (h-11 w-11 rounded-xl) so the row stays aligned.
  const ringClass =
    state.kind === "listening"
      ? "bg-rose-50 text-rose-600 ring-1 ring-rose-200 hover:bg-rose-100"
      : state.kind === "requesting"
        ? "bg-zinc-50 text-zinc-400"
        : state.kind === "error"
          ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200 hover:bg-amber-100"
          : "bg-white text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-50";

  const Icon =
    state.kind === "listening"
      ? Mic
      : state.kind === "requesting"
        ? Loader2
        : state.kind === "error"
          ? MicOff
          : Mic;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || state.kind === "requesting"}
      aria-label={aria}
      aria-pressed={state.kind === "listening"}
      title={aria}
      className={
        "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-all duration-200 " +
        ringClass +
        " disabled:opacity-50"
      }
    >
      <Icon
        size={16}
        className={state.kind === "requesting" ? "animate-spin" : ""}
        aria-hidden
      />
      {state.kind === "listening" ? (
        <span className="sr-only">{aria}</span>
      ) : null}
    </button>
  );
}

/** Minimal SpeechRecognition shape — the browser's actual type
 *  isn't in lib.dom.d.ts on every TS target, so we structurally
 *  type the bits we use. */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onresult: ((e: SpeechRecognitionResultListLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface SpeechRecognitionResultListLike {
  results: ArrayLike<SpeechRecognitionResultLike | undefined> & {
    [n: number]: SpeechRecognitionResultLike | undefined;
  };
}

interface SpeechRecognitionResultLike {
  isFinal?: boolean;
  [n: number]: { transcript?: string } | undefined;
}

export { FEATURE_FLAG as VOICE_INPUT_FEATURE_FLAG };
