/**
 * v3.9 (F4, 2026-04-30) — voice input state machine.
 *
 * 4-state FSM for the mic button:
 *
 *     idle ──tap──▶ requesting ──onstart──▶ listening
 *      ▲              │  (denied / blocked) │  (tap / onerror / onend)
 *      │              ▼                     │
 *      └─────────  error  ◀─────────────────┘
 *
 * "requesting" exists because Chrome's permission prompt is async —
 * there's a sub-second window where the user has tapped the mic but
 * the recognizer hasn't fired `onstart` yet. We render a "..." state
 * so the user knows the tap registered.
 *
 * Pure: no DOM, no React. The component reduces over this FSM.
 */

export type VoiceState =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "listening" }
  | { kind: "error"; reason: VoiceErrorReason };

/** Map of recognizer error tokens we explicitly handle.
 *  - "denied"          : user blocked mic permission (PermissionDenied)
 *  - "no-mic"          : no audio input device (audio-capture)
 *  - "lang-unsupported": the locale we asked for isn't installed
 *  - "network"         : recognizer needs a network round-trip and lost it
 *  - "generic"         : anything else (`aborted`, `bad-grammar`, etc.) */
export type VoiceErrorReason =
  | "denied"
  | "no-mic"
  | "lang-unsupported"
  | "network"
  | "generic";

/** Map a SpeechRecognition `error` event's `error` field to our
 *  reason taxonomy. Defensive against non-string inputs. */
export function classifyVoiceError(raw: unknown): VoiceErrorReason {
  if (typeof raw !== "string") return "generic";
  switch (raw) {
    case "not-allowed":
    case "service-not-allowed":
      return "denied";
    case "audio-capture":
      return "no-mic";
    case "language-not-supported":
      return "lang-unsupported";
    case "network":
      return "network";
    default:
      return "generic";
  }
}

export type VoiceAction =
  | { type: "tap" }
  | { type: "started" }
  | { type: "stopped" }
  | { type: "error"; reason: VoiceErrorReason };

/** Reducer. Pure. State transitions ONLY — side effects (calling
 *  `recognition.start()` etc.) live in the component. */
export function voiceReducer(
  state: VoiceState,
  action: VoiceAction,
): VoiceState {
  switch (state.kind) {
    case "idle":
      if (action.type === "tap") return { kind: "requesting" };
      if (action.type === "error")
        return { kind: "error", reason: action.reason };
      return state;
    case "requesting":
      if (action.type === "started") return { kind: "listening" };
      if (action.type === "error")
        return { kind: "error", reason: action.reason };
      if (action.type === "stopped") return { kind: "idle" };
      return state;
    case "listening":
      if (action.type === "tap") return { kind: "idle" };
      if (action.type === "stopped") return { kind: "idle" };
      if (action.type === "error")
        return { kind: "error", reason: action.reason };
      return state;
    case "error":
      // Any tap in error state is a user-initiated retry — go back
      // to requesting. Other actions (delayed onerror after the user
      // already retapped) are dropped to avoid losing the new state.
      if (action.type === "tap") return { kind: "requesting" };
      return state;
  }
}

/** Aria-label resolver for the mic button. Consequence-aware so SR
 *  users don't have to guess what tapping does. RU + KZ. */
export function voiceMicAriaLabel({
  state,
  lang,
}: {
  state: VoiceState;
  lang: unknown;
}): string {
  const ru = lang !== "kz";
  switch (state.kind) {
    case "idle":
      return ru
        ? "Голосовой ввод — нажмите, чтобы начать диктовку"
        : "Дауыспен енгізу — диктовканы бастау үшін басыңыз";
    case "requesting":
      return ru
        ? "Запрос доступа к микрофону…"
        : "Микрофонға қол жеткізу сұралуда…";
    case "listening":
      return ru
        ? "Идёт запись — нажмите, чтобы остановить"
        : "Жазу жүріп жатыр — тоқтату үшін басыңыз";
    case "error":
      return ru ? voiceErrorRu(state.reason) : voiceErrorKz(state.reason);
  }
}

function voiceErrorRu(reason: VoiceErrorReason): string {
  switch (reason) {
    case "denied":
      return "Доступ к микрофону запрещён. Разрешите в настройках браузера.";
    case "no-mic":
      return "Микрофон не найден. Подключите устройство и попробуйте снова.";
    case "lang-unsupported":
      return "Голосовой ввод для этого языка недоступен в вашем браузере.";
    case "network":
      return "Нет соединения с сервисом распознавания. Попробуйте позже.";
    case "generic":
    default:
      return "Голосовой ввод не сработал. Попробуйте ещё раз.";
  }
}

function voiceErrorKz(reason: VoiceErrorReason): string {
  switch (reason) {
    case "denied":
      return "Микрофонға қол жеткізу тыйым салынған. Браузер баптауларынан рұқсат беріңіз.";
    case "no-mic":
      return "Микрофон табылмады. Құрылғыны қосып, қайта көріңіз.";
    case "lang-unsupported":
      return "Бұл тілге арналған дауыспен енгізу браузеріңізде қолжетімді емес.";
    case "network":
      return "Тану қызметімен байланыс жоқ. Кейінірек көріңіз.";
    case "generic":
    default:
      return "Дауыспен енгізу істемеді. Қайталап көріңіз.";
  }
}

/** Should the textarea be augmented with the user's transcript on
 *  this update? Filters empty strings + the all-whitespace case so
 *  we don't blow away the existing draft on a recogniser hiccup. */
export function shouldApplyTranscript(
  transcript: unknown,
): transcript is string {
  return typeof transcript === "string" && transcript.trim().length > 0;
}

/** Append `transcript` to `current` separated by a single space,
 *  trimming so we don't double-space when `current` already ends in
 *  whitespace and don't add a leading space when `current` is empty.
 *  Pure. */
export function appendTranscriptToDraft(
  current: unknown,
  transcript: unknown,
): string {
  const cur = typeof current === "string" ? current : "";
  if (!shouldApplyTranscript(transcript)) return cur;
  const t = (transcript as string).trim();
  if (cur.length === 0) return t;
  if (/\s$/.test(cur)) return cur + t;
  return cur + " " + t;
}
