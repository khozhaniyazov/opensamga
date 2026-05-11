/**
 * s27 (C1, 2026-04-27) — RedactionPill.
 *
 * Sibling to NoLibraryPill (s26 phase 5). Surfaces the agent loop's
 * post-pass `_redact_unverified_score_claims` action: when the model
 * produced a sentence pairing a 2nd-person pronoun ("Ты", "сенің
 * нәтижең", etc.) with a UNT-shaped score number ("101 из 140",
 * "75%", "85 ұпай") AND no user-data tool fired, the backend strips
 * the offending sentence and bumps `done.unverified_score_claims_redacted`.
 *
 * The user MUST notice this — otherwise they'd think the redacted
 * answer is still trustworthy. The pill:
 *   - amber, sits below the bubble in the same slot as NoLibraryPill,
 *   - role="status" + aria-live="polite" so screen readers announce it,
 *   - bilingual copy mirroring the redactor's notice line.
 *
 * It is rendered iff `count > 0`. The count is forwarded via:
 *   agent_loop.py        → SSE `done.unverified_score_claims_redacted`
 *   chat.py              → REST envelope + assistant_metadata
 *   useSendMessage.ts    → Message.unverifiedScoreClaimsRedacted
 *   MessagesContext.tsx  → re-hydrated from metadata on reload
 *   ChatTranscript.tsx   → reads Message and renders this pill
 */

import { useLang } from "../../LanguageContext";

interface Props {
  /** How many unverified score sentences the backend stripped from this
   *  reply. The pill renders only when this is > 0; the parent should
   *  short-circuit but we re-check defensively. */
  count?: number | null;
}

/** Pure predicate — exported so vitest can pin the contract without
 *  needing a React renderer. Matches the `count > 0` guard inside the
 *  component itself. */
export function shouldShowRedactionPill(count?: number | null): boolean {
  const n = Number(count ?? 0);
  return Number.isFinite(n) && n > 0;
}

/** Pure label helper, also exported for vitest. Bilingual copy mirrors
 *  the redactor's notice line in agent_loop._redact_unverified_score_claims.
 *
 *  s35 wave B2 (2026-04-28): when `count` is provided, prefix the label
 *  with the number of redacted sentences ("2 утверждения удалены — …").
 *  Plurality is hand-rolled to match RU/KZ rules (1 / 2-4 / 5+).
 */
export function redactionPillLabel(
  lang: "ru" | "kz",
  count?: number | null,
): string {
  const ruBody =
    "не подтверждённые числа удалены — спросите про конкретные результаты прошлых тестов";
  const kzBody =
    "тексерілмеген сандар алынып тасталды — нақты балыңды өткен тестілерден ал";
  const n = Number(count ?? 0);
  if (!Number.isFinite(n) || n <= 0) {
    // Original copy, capitalised.
    return lang === "kz"
      ? "Тексерілмеген сандар алынып тасталды — нақты балыңды өткен тестілерден ал"
      : "Не подтверждённые числа удалены — спросите про конкретные результаты прошлых тестов";
  }
  if (lang === "kz") {
    return `${n} тексерілмеген сан — ${kzBody}`;
  }
  // RU plural: 1 → "утверждение", 2-4 → "утверждения", 5+ → "утверждений".
  // We use the simpler "число / числа / чисел" since the redactor strips
  // numeric claims, not whole utterances. Edge cases 11-14 → "чисел".
  const mod10 = n % 10;
  const mod100 = n % 100;
  let word = "чисел";
  if (mod10 === 1 && mod100 !== 11) word = "число";
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14))
    word = "числа";
  return `${n} ${word} удалено — ${ruBody}`;
}

export function RedactionPill({ count }: Props) {
  const { lang } = useLang();
  if (!shouldShowRedactionPill(count)) return null;
  const label = redactionPillLabel(lang as "ru" | "kz", count);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-900 samga-anim-pill"
    >
      <span aria-hidden="true">🔒</span>
      <span className="truncate">{label}</span>
    </div>
  );
}

export default RedactionPill;
