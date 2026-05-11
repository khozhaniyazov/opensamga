/**
 * s33 (B2, 2026-04-28) — recommendation tiles for the chat empty
 * state.
 *
 * Boss brief: the empty state already shows 4 generic capability
 * cards + 6 ChatTemplates pills. Both are static. B2 adds a
 * recommendations carousel built from the live `template-context`
 * payload (weakest subject, target university, exam attempts) so
 * the FIRST thing a logged-in student sees is a tile that says
 * "drill {weakest subject} weak topics" or "compare your scores
 * vs {dream uni}".
 *
 * Design constraints:
 *   - Pure scoring helpers in this module so vitest pins the
 *     ranking contract. The empty state consumer just renders the
 *     resolved list.
 *   - `topRecommendations(ctx, lang, limit=3)` returns 0..N tiles.
 *     0 is fine — the carousel hides itself in that case.
 *   - Recommendations are computed off the `TemplateContext`
 *     contract that already shipped in s22c (see
 *     templateContext.ts). No new BE call.
 *   - When two recommendations would yield the same prompt seed,
 *     dedup at compose time (the user shouldn't see two pills that
 *     fire the same prompt).
 *   - **Never** mention a numeric score that isn't in the context
 *     payload — the BE doesn't actually expose latest score per
 *     subject yet, only a count of exam_attempts, so we phrase
 *     pills around "compare" / "drill weakest" rather than
 *     "you got 67/120".
 *
 * Pill ordering rules (descending priority):
 *   1. Drill weakest subject (when `weakest_subject` is set).
 *   2. Compare to dream university (when `target_university_name`
 *      is set AND `last_test_results_count > 0`).
 *   3. Review unresolved mistakes (when
 *      `unresolved_mistakes_count > 0`).
 *   4. Plan this week (when `has_onboarding_profile === true` and
 *      no other signal is present — fallback "thoughtful" tile).
 */

import type { TemplateContext } from "./templateContext";

/** Stable id used by analytics + dedup. */
export type RecommendationId =
  | "drill_weakest"
  | "compare_to_dream_uni"
  | "review_mistakes"
  | "plan_this_week";

export interface Recommendation {
  id: RecommendationId;
  /** Localized title — surface text on the pill. */
  title: string;
  /** Localized one-line subtitle. */
  hint: string;
  /** The prompt sent to the assistant on click. */
  prompt: string;
  /** Score used for sorting (higher = more prominent). Exposed for
   *  vitest, not for consumers. */
  score: number;
}

interface ResolveOptions {
  /** Maximum recommendations to surface. Default 3 — the carousel
   *  is meant to be a quick glance, not a folder system. */
  limit?: number;
}

/** Returns the top `limit` recommendations for the given context.
 *  Sorted by descending score, dedup'd by id and prompt. */
export function topRecommendations(
  ctx: TemplateContext,
  lang: "ru" | "kz",
  options: ResolveOptions = {},
): Recommendation[] {
  const limit = options.limit ?? 3;
  if (limit <= 0) return [];
  const all = computeRecommendations(ctx, lang);
  // Sort descending; stable sort on equal scores so we keep the
  // declaration order from `computeRecommendations` for ties.
  all.sort((a, b) => b.score - a.score);
  const seenIds = new Set<RecommendationId>();
  const seenPrompts = new Set<string>();
  const out: Recommendation[] = [];
  for (const rec of all) {
    if (seenIds.has(rec.id)) continue;
    if (seenPrompts.has(rec.prompt)) continue;
    seenIds.add(rec.id);
    seenPrompts.add(rec.prompt);
    out.push(rec);
    if (out.length >= limit) break;
  }
  return out;
}

/** Internal — computes the full list of candidate recommendations
 *  with non-zero scores, in declaration order. Exported for tests. */
export function computeRecommendations(
  ctx: TemplateContext,
  lang: "ru" | "kz",
): Recommendation[] {
  const out: Recommendation[] = [];
  if (ctx.weakest_subject) {
    out.push(buildDrillWeakest(ctx, lang));
  }
  if (ctx.target_university_name && ctx.last_test_results_count > 0) {
    out.push(buildCompareToDreamUni(ctx, lang));
  }
  if (ctx.unresolved_mistakes_count > 0) {
    out.push(buildReviewMistakes(ctx, lang));
  }
  if (ctx.has_onboarding_profile && out.length === 0) {
    // Fallback only fires when no harder signal is available; we
    // don't want to surface "plan this week" alongside more
    // specific pills.
    out.push(buildPlanThisWeek(lang));
  }
  return out;
}

function buildDrillWeakest(
  ctx: TemplateContext,
  lang: "ru" | "kz",
): Recommendation {
  // Score: very high — boss directly named "drill weakest" as the
  // canonical example pill. Bump if there are also unresolved
  // mistakes (mistakes are subject-tagged so the pill is even more
  // grounded).
  let score = 100;
  if (ctx.unresolved_mistakes_count > 0) score += 5;
  const subject = ctx.weakest_subject ?? "";
  return {
    id: "drill_weakest",
    score,
    title:
      lang === "kz"
        ? `${subject} бойынша әлсіз тақырыптар`
        : `Слабые темы по «${subject}»`,
    hint:
      lang === "kz"
        ? "Профильге сүйеніп нақты жоспар"
        : "Точечный план по моему профилю",
    prompt:
      lang === "kz"
        ? `«${subject}» пәнінен ең әлсіз 3 тақырыпты атап, әрқайсысы бойынша қысқа жаттығу беріп жіберіңіз.`
        : `Назови три самые слабые темы по предмету «${subject}» и дай по каждой короткое упражнение.`,
  };
}

function buildCompareToDreamUni(
  ctx: TemplateContext,
  lang: "ru" | "kz",
): Recommendation {
  const uni = ctx.target_university_name ?? "";
  return {
    id: "compare_to_dream_uni",
    // Boss directly mentioned "Compare minimum scores vs your scores"
    // as a flagship template ask; weighted just under drill_weakest.
    score: 90,
    title:
      lang === "kz"
        ? `${uni} өту балы менің балыммен`
        : `Минимальные баллы ${uni} vs мои`,
    hint:
      lang === "kz"
        ? "Соңғы нәтижелер бойынша салыстыру"
        : "По моим последним результатам",
    prompt:
      lang === "kz"
        ? `«${uni}» ЖОО-ның соңғы өту балдарын менің Samga профиліміндегі соңғы нәтижелермен салыстыр. Қандай мамандықтарға өтуім ықтимал?`
        : `Сравни проходные баллы «${uni}» с моими последними результатами в профиле Samga. На какие специальности у меня реальные шансы?`,
  };
}

function buildReviewMistakes(
  ctx: TemplateContext,
  lang: "ru" | "kz",
): Recommendation {
  return {
    id: "review_mistakes",
    score: 70,
    title:
      lang === "kz"
        ? "Шешілмеген қателіктерімді талда"
        : "Разбери мои нерешённые ошибки",
    hint:
      lang === "kz"
        ? `${ctx.unresolved_mistakes_count} жазба`
        : `${ctx.unresolved_mistakes_count} записей`,
    prompt:
      lang === "kz"
        ? "Менің шешілмеген қателіктерімді топтап түсіндіріп беріңіз және әрқайсысы бойынша қысқа қайталау сұрағын ұсыныңыз."
        : "Сгруппируй мои нерешённые ошибки по темам, объясни каждую и предложи короткий контрольный вопрос для повторения.",
  };
}

function buildPlanThisWeek(lang: "ru" | "kz"): Recommendation {
  return {
    id: "plan_this_week",
    score: 30,
    title: lang === "kz" ? "Осы аптаға жоспар" : "План на эту неделю",
    hint:
      lang === "kz"
        ? "Профильге сай күнделікті блоктар"
        : "Ежедневные блоки по профилю",
    prompt:
      lang === "kz"
        ? "Менің Samga профилімдегі деректерге сүйеніп, осы аптаға арналған 7 күндік ҰБТ дайындық жоспарын құр."
        : "Опираясь на данные моего профиля Samga, составь 7-дневный план подготовки к ЕНТ на эту неделю.",
  };
}

/** Pure helper — should the carousel render at all? Only when at
 *  least one recommendation is available AND the user has some
 *  profile signal (otherwise the carousel is just noise). */
export function shouldShowRecommendationsCarousel(
  recs: readonly Recommendation[],
): boolean {
  return Array.isArray(recs) && recs.length > 0;
}
