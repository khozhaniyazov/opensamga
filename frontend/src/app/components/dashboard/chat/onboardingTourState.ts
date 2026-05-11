/**
 * s33 (B3, 2026-04-28) — first-time onboarding tour state.
 *
 * Boss brief from roadmap row B3: "Onboarding tour (first-time-only):
 * point at composer, thread rail, sources drawer". The empty state
 * already shows capability cards + recommendations + templates, but
 * a brand-new user doesn't know where the thread rail toggle is, or
 * that sources drawers exist on every assistant turn, or that there's
 * a slash menu in the composer.
 *
 * Pattern: 3-step coach-mark tour. Each step has a target selector,
 * a localized title + body, and an optional "next" hint. The tour
 * advances on click. After completion (or explicit "skip") we set
 * `samga.chat.onboardingDone=v1` so it never reappears.
 *
 * Pure helpers below own the persistence + step shape; the React
 * component (`OnboardingTour.tsx`) consumes them.
 *
 * Decision: tour fires on FIRST visit only — not on first message.
 * Reason: showing the tour on first message would interrupt the
 * "I just want to ask my question" flow. The empty state is the
 * right place to introduce affordances the user hasn't touched yet.
 */

export const ONBOARDING_DONE_KEY = "samga.chat.onboardingDone";
export const ONBOARDING_DONE_VALUE = "v1";

/** A single coach-mark step. */
export interface OnboardingStep {
  /** Stable step id — used for analytics + the "skip from here"
   *  affordance + dedup. */
  id: "rail_toggle" | "composer" | "sources_drawer";
  /** CSS selector for the spotlight target. The component picks
   *  bounds from getBoundingClientRect(). */
  targetSelector: string;
  /** Localized title (short — fits in a chip). */
  title: string;
  /** Localized body (1-2 sentences). */
  body: string;
}

/** Returns true if the tour has already been completed by this user.
 *  Defends against quota/private-mode/missing-localStorage. */
export function isOnboardingDone(): boolean {
  try {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem(ONBOARDING_DONE_KEY) === ONBOARDING_DONE_VALUE;
  } catch {
    return true;
  }
}

/** Mark the tour as done. Called on completion AND on explicit skip. */
export function markOnboardingDone(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(ONBOARDING_DONE_KEY, ONBOARDING_DONE_VALUE);
  } catch {
    /* silent */
  }
}

/** Reset the tour — exposed for the future "show me the tour again"
 *  affordance + tests. */
export function resetOnboarding(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(ONBOARDING_DONE_KEY);
  } catch {
    /* silent */
  }
}

/** Build the localized step list. Pure — no DOM, no storage. */
export function buildOnboardingSteps(lang: "ru" | "kz"): OnboardingStep[] {
  if (lang === "kz") {
    return [
      {
        id: "rail_toggle",
        targetSelector: '[aria-label*="чат"]',
        title: "Чаттар тізімі",
        body: "Бұл түйме сол жақтағы чаттар панелін ашады. Әр сұрағыңыз жеке чатта сақталады.",
      },
      {
        id: "composer",
        targetSelector: "#chat-composer-textarea",
        title: "Сұрақты осы жерге жазыңыз",
        body: 'Кез келген тілде жазуға болады. "/" пернесін басып, шаблондар мен пәрмендерді көріңіз.',
      },
      {
        id: "sources_drawer",
        targetSelector: '[data-onboarding="sources-drawer-anchor"]',
        title: "Жауаптың дереккөздері",
        body: "Жауаптың астында «Дереккөздер» батырмасы болады — оқулықтан қандай беттер пайдаланылғанын тексеріп шығыңыз.",
      },
    ];
  }
  return [
    {
      id: "rail_toggle",
      targetSelector: '[aria-label*="чат"]',
      title: "Список чатов",
      body: "Эта кнопка открывает панель ваших чатов. Каждая беседа сохраняется отдельно — можно вернуться позже.",
    },
    {
      id: "composer",
      targetSelector: "#chat-composer-textarea",
      title: "Спрашивайте здесь",
      body: 'Можно писать на любом языке. Нажмите "/", чтобы открыть меню шаблонов и команд.',
    },
    {
      id: "sources_drawer",
      targetSelector: '[data-onboarding="sources-drawer-anchor"]',
      title: "Источники под ответом",
      body: "Под каждым ответом есть кнопка «Источники» — можно проверить, какие страницы учебников использовал ассистент.",
    },
  ];
}

/** Pure helper — given the current step index and the step count,
 *  return the next step index, or -1 if the tour should close. */
export function nextOnboardingStep(current: number, total: number): number {
  if (total <= 0) return -1;
  if (current < 0) return 0;
  if (current + 1 >= total) return -1;
  return current + 1;
}

/** Pure helper — localized control labels. */
export function onboardingControlLabels(lang: "ru" | "kz"): {
  next: string;
  finish: string;
  skip: string;
  step: (current: number, total: number) => string;
} {
  if (lang === "kz") {
    return {
      next: "Әрі қарай",
      finish: "Бастау",
      skip: "Өткізіп жіберу",
      step: (c, t) => `${c} / ${t}`,
    };
  }
  return {
    next: "Дальше",
    finish: "Поехали",
    skip: "Пропустить",
    step: (c, t) => `${c} / ${t}`,
  };
}
