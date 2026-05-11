/**
 * planGuardCopy.ts — v3.74 (B17, 2026-05-02)
 *
 * Pure copy table for the locked-page surface rendered by
 * `PlanGuard.tsx`. Pre-v3.74 the title + description + hero copy
 * lived in three sprawling `feature === "quiz" ? ...` ternaries
 * inside the component, which made it visually look like there
 * were "4 different copies" of the locked page (per the boss
 * 2026-05-02 E2E report B17).
 *
 * The component is unchanged in shape — we just lift the copy
 * decisions into a pure helper so:
 *   - Adding a new gated feature = one-line edit to the COPY table
 *     (no JSX branch growth).
 *   - The copy logic is fully unit-testable without dragging
 *     react-router + LanguageProvider + PlanContext into vitest.
 *   - The "convergence" the boss asked for is materialized: every
 *     feature reads from the same shape `{ title, description, hero }`,
 *     so a future translator can't accidentally fork the structure.
 *
 * No string is changed by v3.74 — this is a pure refactor + new
 * test surface.
 */

export type PlanGuardFeature =
  | "exams"
  | "mistakes"
  | "training"
  | "gap-analysis"
  | "quiz";

export type PlanGuardLang = "ru" | "kz";

export interface PlanGuardCopy {
  /** Locked-card heading (the H2, "Эта страница пока закрыта" / etc.). */
  title: string;
  /** One-paragraph body under the heading. */
  description: string;
  /** Hero paragraph above the locked card. */
  hero: string;
}

const QUIZ_TITLE: Record<PlanGuardLang, string> = {
  ru: "Быстрый тест внутри Premium",
  kz: "Жылдам тест Premium ішінде",
};

const GENERIC_TITLE: Record<PlanGuardLang, string> = {
  ru: "Эта страница пока закрыта",
  kz: "Бұл бет әзірге жабық",
};

const QUIZ_DESCRIPTION: Record<PlanGuardLang, string> = {
  ru: "Быстрый тест работает в лимитах Premium-тренировки: 10 коротких вопросов, один предмет и мгновенное объяснение.",
  kz: "Жылдам тест Premium жаттығу лимиттерімен жұмыс істейді: 10 қысқа сұрақ, бір пән және бірден түсіндірме.",
};

const QUIZ_HERO: Record<PlanGuardLang, string> = {
  ru: "Быстрый тест открывается в лимите Premium-тренировки: один предмет, 10 коротких вопросов и объяснение Samga после ответа.",
  kz: "Жылдам тест Premium жаттығу лимитімен ашылады: бір пән, 10 қысқа сұрақ және әр жауаптан кейін Samga түсіндірмесі.",
};

const GENERIC_HERO: Record<PlanGuardLang, string> = {
  ru: "Эта возможность открывается вместе с подпиской Samga Premium: полный AI-ассистент, разборы ошибок и персональные тренировки под ваш ЕНТ.",
  kz: "Бұл мүмкіндік Samga Premium жазылымымен бірге ашылады: толық AI-ассистент, қателерді талдау және ҰБТ-ға арналған жеке жаттығулар.",
};

/**
 * Resolve the title / description / hero copy for a given gated
 * feature + language. The "quiz" feature has its own variant; every
 * other feature falls back to the shared "generic" copy.
 *
 * `description` for non-quiz features is sourced from the i18n key
 * `guard.locked` (resolved at the call site by `useLang().t`); we
 * surface that intent here as a sentinel value the caller substitutes.
 */
export function planGuardCopy(
  feature: PlanGuardFeature,
  lang: PlanGuardLang,
  /** Resolves the i18n key the caller would otherwise inline. */
  resolveI18n: (key: string) => string,
): PlanGuardCopy {
  if (feature === "quiz") {
    return {
      title: QUIZ_TITLE[lang],
      description: QUIZ_DESCRIPTION[lang],
      hero: QUIZ_HERO[lang],
    };
  }
  return {
    title: GENERIC_TITLE[lang],
    description: resolveI18n("guard.locked"),
    hero: GENERIC_HERO[lang],
  };
}

/**
 * Map gated features to the chip label that decorates the hero
 * pill row. v3.74: factored out so the same convergence applies
 * here. Pre-v3.74 the chip was inlined as another ternary in the
 * JSX. Quiz still gets its own chip ("Premium-тренировка"); every
 * other feature reuses the i18n-resolved feature name.
 */
export function planGuardChipLabel(
  feature: PlanGuardFeature,
  lang: PlanGuardLang,
  fallbackFeatureName: string,
): string {
  if (feature !== "quiz") return fallbackFeatureName;
  return lang === "kz" ? "Premium жаттығу" : "Premium-тренировка";
}
