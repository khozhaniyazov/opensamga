/**
 * s31 (B4, 2026-04-27) — rotating placeholder helper for ChatComposer.
 *
 * Pure utilities (no React imports) so vitest can pin the contract
 * without a renderer. Mirrors the s29/s30 trust-pill convention:
 * predicate + label helpers in their own module, the component just
 * reads them.
 *
 * Behaviour:
 *   - Five suggestion strings per language. Index 0 is the historic
 *     `chat.placeholder` copy ("Спросите про тему..." / KZ
 *     equivalent) so the first paint is identical to today's. The
 *     subsequent four mirror the B1 ChatTemplates row but framed as
 *     "ask the model" prompts.
 *   - `pickPlaceholder(list, idx)` is the canonical accessor — wraps
 *     via modulo so the timer can increment forever, and falls back
 *     to the first string on an empty list (defensive).
 *   - `nextPlaceholderIndex(current, length)` is the rotation rule.
 *     Returns 0 on a non-positive length (never throws).
 *   - `ROTATION_INTERVAL_MS = 4500` is the pinned cadence; bumping
 *     the value should be intentional, hence the test that asserts
 *     it.
 *
 * The composer pauses rotation while focused (so the user reading
 * the placeholder isn't visually distracted mid-typing) and while
 * `isSending` (no point rotating a disabled textarea). Both gates
 * live in the consumer; this module only owns the data + math.
 */

/** Rotation cadence in milliseconds. Pinned for the test. */
export const ROTATION_INTERVAL_MS = 4500;

/** All placeholder strings per language. Index 0 must match the
 *  historic `chat.placeholder` copy so the first paint is unchanged. */
export const PLACEHOLDERS_RU: readonly string[] = [
  "Спросите про тему, результат или университет...",
  "Сравнить пороги ЖОО с моими баллами...",
  "Объясни мою последнюю ошибку...",
  "Составь план подготовки на эту неделю...",
  "Прокачай мою слабую тему...",
];

export const PLACEHOLDERS_KZ: readonly string[] = [
  "Тақырып, нәтиже немесе ЖОО туралы сұраңыз...",
  "ЖОО шегі мен менің балдарымды салыстыр...",
  "Соңғы қатемді түсіндір...",
  "Осы аптаға дайындық жоспарын құр...",
  "Әлсіз тақырыбымды күшейт...",
];

/** Returns the placeholders list for a language tag. Defensive
 *  fall-through to RU keeps the consumer safe on unexpected locale
 *  values. */
export function placeholdersFor(lang: "ru" | "kz"): readonly string[] {
  return lang === "kz" ? PLACEHOLDERS_KZ : PLACEHOLDERS_RU;
}

/** Pick the placeholder at `idx`, wrapping modulo length. Empty list
 *  returns the empty string (never throws). */
export function pickPlaceholder(list: readonly string[], idx: number): string {
  if (!Array.isArray(list) || list.length === 0) return "";
  if (!Number.isFinite(idx)) return list[0];
  const wrapped = ((idx % list.length) + list.length) % list.length;
  return list[wrapped];
}

/** Rotation rule: returns the next index in the cycle. Defensive on
 *  non-positive lengths so a zero-length list short-circuits to 0. */
export function nextPlaceholderIndex(current: number, length: number): number {
  if (!Number.isFinite(length) || length <= 0) return 0;
  if (!Number.isFinite(current)) return 0;
  return (current + 1) % length;
}
