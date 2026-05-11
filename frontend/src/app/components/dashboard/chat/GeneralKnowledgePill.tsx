/**
 * s30 (A6, 2026-04-27) — GeneralKnowledgePill.
 *
 * Slate pill below the assistant bubble that fires when the agent
 * answered without invoking any user-data tool (profile, mistakes,
 * scores, attempts, progress). It tells the user "this answer is not
 * personalised — I didn't read your profile or mistakes".
 *
 * The complement to RedactionPill (A3): RedactionPill says "I tried
 * to be personal but stripped unverified numbers"; GeneralKnowledgePill
 * says "I didn't try to be personal at all". Together they cover the
 * two failure modes the s26 e2e flagged.
 *
 * BE feed: `agent_loop._compute_is_general_knowledge` →
 * `done.is_general_knowledge: bool`. Persisted into
 * `chat_messages.message_metadata.is_general_knowledge` only when
 * true (absence ⇒ false / regular grounded reply).
 *
 * Pure helper `shouldShowGeneralKnowledgePill` exported for vitest.
 */

import { Info } from "lucide-react";
import { useLang } from "../../LanguageContext";

interface Props {
  isGeneralKnowledge?: boolean | null;
}

/** Pure predicate — exported for vitest. Renders only on a true flag. */
export function shouldShowGeneralKnowledgePill(
  isGeneralKnowledge?: boolean | null,
): boolean {
  return isGeneralKnowledge === true;
}

/** Pure label helper — bilingual. Exported for vitest. */
export function generalKnowledgePillLabel(lang: "ru" | "kz"): string {
  return lang === "kz"
    ? "Жалпы білім — сіздің деректеріңіз қолданылмады"
    : "Общие знания — без ваших данных";
}

export function GeneralKnowledgePill({ isGeneralKnowledge }: Props) {
  const { lang } = useLang();
  if (!shouldShowGeneralKnowledgePill(isGeneralKnowledge)) return null;
  const langSafe = (lang === "kz" ? "kz" : "ru") as "ru" | "kz";
  const label = generalKnowledgePillLabel(langSafe);
  return (
    <div
      className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 samga-anim-pill"
      role="note"
    >
      <Info className="h-3 w-3" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export default GeneralKnowledgePill;
