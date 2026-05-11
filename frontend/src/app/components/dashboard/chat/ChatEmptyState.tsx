import {
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  GraduationCap,
  Target,
  TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLang } from "../../LanguageContext";
import { Logo } from "../../shared/Logo";
import { trackChatEmptyStateCardClicked } from "../../../lib/telemetry";
import { ChatTemplates } from "./ChatTemplates";
import { apiGet } from "../../../lib/api";
import { subjectLabel } from "../../../lib/subjectLabels";
import {
  DEFAULT_TEMPLATE_CONTEXT,
  coerceTemplateContext,
  type TemplateContext,
} from "./templateContext";
import {
  shouldShowRecommendationsCarousel,
  topRecommendations,
  type Recommendation,
} from "./recommendationsCarousel";
import { OnboardingTour } from "./OnboardingTour";
import { carouselLayoutMode } from "./mobileLayout";
import { useViewportNarrow } from "./useViewportNarrow";
import { Sparkles } from "lucide-react";

/**
 * Flagship empty-state hero for the chat surface.
 *
 * Phase A (s20c) — DESIGN_CHAT_FLAGSHIP.md §4: replaces the legacy 1-tile
 * Sparkles block with
 *   - the shared Samga.ai logo (mark + wordmark)
 *   - a clear tutor-focused headline
 *   - 4 capability cards (textbook / exam review / unis / plan) — the
 *     fourth is a *personalized* card if the student has a recent
 *     exam attempt, else a static plan card.
 *   - a "can do / can't do" strip so students calibrate expectations.
 *
 * Core marketing strings live in `LanguageContext.tsx`; profile-aware
 * prompt/context copy is built locally because it depends on live
 * onboarding data.
 */

export interface StarterPrompt {
  title: string;
  hint: string;
  prompt: string;
  icon: typeof BookOpen;
}

interface Props {
  onPick: (prompt: string) => void;
  /** Optional personalized hook (e.g. "Разбери мои ошибки из ЕНТ от 2026-04-15").
   *  When supplied it replaces the generic plan card so the student sees
   *  something tailored. Pass `null` to fall back to the static card. */
  personalizedCard?: StarterPrompt | null;
}

function getDefaultStarters(
  t: (key: string) => string,
  lang: string,
): StarterPrompt[] {
  return [
    {
      icon: BookOpen,
      title: t("chat.empty.card_textbook_title"),
      hint: t("chat.empty.card_textbook_hint"),
      prompt:
        lang === "kz"
          ? "Дискриминант дегеніміз не және оны қалай қолданады? Мысал келтір."
          : "Объясни дискриминант квадратного уравнения с примером из учебника.",
    },
    {
      icon: TrendingUp,
      title: t("chat.empty.card_exam_title"),
      hint: t("chat.empty.card_exam_hint"),
      prompt:
        lang === "kz"
          ? "Соңғы сынақ ҰБТ нәтижелерімді талдап, әлсіз тақырыптарымды көрсет."
          : "Разбери мои ошибки из последнего пробного ЕНТ и покажи слабые темы.",
    },
    {
      icon: GraduationCap,
      title: t("chat.empty.card_unis_title"),
      hint: t("chat.empty.card_unis_hint"),
      prompt:
        lang === "kz"
          ? "Балдарым мен бейінім бойынша қай ЖОО-ларға түсу мүмкіндігім бар?"
          : "Какие университеты мне подойдут по моим баллам и профилю?",
    },
    {
      icon: Target,
      title: t("chat.empty.card_plan_title"),
      hint: t("chat.empty.card_plan_hint"),
      prompt:
        lang === "kz"
          ? "Нәтижелерімнің негізінде ҰБТ-ға дайындық жоспарын ұсын."
          : "Учитывая мои результаты, предложи план подготовки к ЕНТ.",
    },
  ];
}

function profileSummary(ctx: TemplateContext, lang: "ru" | "kz"): string {
  const weakest = ctx.weakest_subject
    ? subjectLabel(ctx.weakest_subject, lang)
    : "";
  const subjects = ctx.profile_subjects
    .map((subject) => subjectLabel(subject, lang))
    .filter(Boolean)
    .join(lang === "kz" ? " және " : " и ");
  const parts =
    lang === "kz"
      ? [
          subjects ? `бейіндік пәндер: ${subjects}` : "",
          weakest ? `ең әлсіз пән: ${weakest}` : "",
          ctx.target_university_name
            ? `арман ЖОО: ${ctx.target_university_name}`
            : "",
          ctx.last_test_results_count > 0
            ? `соңғы нәтижелер: ${ctx.last_test_results_count} нәтиже`
            : "",
        ]
      : [
          subjects ? `профильные предметы: ${subjects}` : "",
          weakest ? `самый слабый предмет: ${weakest}` : "",
          ctx.target_university_name
            ? `университет мечты: ${ctx.target_university_name}`
            : "",
          ctx.last_test_results_count > 0
            ? `последние результаты: ${ctx.last_test_results_count} записей`
            : "",
        ];
  return parts.filter(Boolean).join("; ");
}

function promptWithProfileContext(
  prompt: string,
  ctx: TemplateContext,
  lang: "ru" | "kz",
): string {
  const summary = profileSummary(ctx, lang);
  if (!summary) {
    return prompt;
  }
  const prefix =
    lang === "kz"
      ? `Samga профилімдегі деректер: ${summary}.`
      : `Мой профиль Samga: ${summary}.`;
  return `${prefix}\n\n${prompt}`;
}

export function ChatEmptyState({ onPick, personalizedCard }: Props) {
  const { t, lang } = useLang();
  const [ctx, setCtx] = useState<TemplateContext>(DEFAULT_TEMPLATE_CONTEXT);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await apiGet<unknown>("/chat/template-context");
        if (!cancelled) {
          setCtx(coerceTemplateContext(data));
        }
      } catch {
        if (!cancelled) {
          setCtx(DEFAULT_TEMPLATE_CONTEXT);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const cards = getDefaultStarters(t, lang).map((card) => ({
    ...card,
    prompt: promptWithProfileContext(card.prompt, ctx, lang),
  }));
  const contextCard = useMemo<StarterPrompt | null>(() => {
    if (
      !ctx.has_onboarding_profile &&
      !ctx.weakest_subject &&
      !ctx.target_university_name
    ) {
      return null;
    }
    const weakest = ctx.weakest_subject
      ? subjectLabel(ctx.weakest_subject, lang)
      : "";
    const summary = profileSummary(ctx, lang);
    return {
      icon: Target,
      title: lang === "kz" ? "Менің Samga жоспарым" : "Мой план Samga",
      hint:
        lang === "kz"
          ? weakest
            ? `${weakest} пәнінен бастау`
            : "Деректер бойынша жоспар"
          : weakest
            ? `Начать с ${weakest}`
            : "План по моему профилю",
      prompt:
        lang === "kz"
          ? `Samga профилімдегі деректер: ${summary}. Осы деректер бойынша нақты 7 күндік дайындық жоспарын құр.`
          : `Мой профиль Samga: ${summary}. Составь по этим данным точный 7-дневный план подготовки.`,
    };
    // We intentionally enumerate only the ctx fields the prompt
    // body reads. `ctx` itself is a fresh object on every render
    // of useChatContext(), so depending on it directly would
    // invalidate this memo every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ctx.has_onboarding_profile,
    ctx.last_test_results_count,
    ctx.profile_subjects,
    ctx.target_university_name,
    ctx.weakest_subject,
    lang,
  ]);

  if (personalizedCard || contextCard) {
    // Swap the static "plan" card (index 3) for the personalized one.
    cards[3] = personalizedCard || contextCard!;
  }

  const tones = [
    {
      rail: "bg-amber-500",
      icon: "bg-amber-50 text-amber-700",
      hover: "hover:border-amber-200 hover:bg-amber-50/35",
    },
    {
      rail: "bg-sky-500",
      icon: "bg-sky-50 text-sky-700",
      hover: "hover:border-sky-200 hover:bg-sky-50/35",
    },
    {
      rail: "bg-emerald-500",
      icon: "bg-emerald-50 text-emerald-700",
      hover: "hover:border-emerald-200 hover:bg-emerald-50/35",
    },
    {
      rail: "bg-violet-500",
      icon: "bg-violet-50 text-violet-700",
      hover: "hover:border-violet-200 hover:bg-violet-50/35",
    },
  ];

  return (
    <div className="min-h-full flex items-start py-4 md:py-6">
      {/* s33 (B3, 2026-04-28): first-time onboarding tour. Lazy-mounts
          here so it only appears when the user lands in the empty
          state — it shouldn't interrupt mid-conversation. The tour
          self-checks `isOnboardingDone()` and noops on returning
          users. */}
      <OnboardingTour />
      <div className="w-full max-w-4xl mx-auto">
        {/* s26 phase 3: hero band — soft amber→white→violet gradient
            with concentric rings behind the logo. Replaces the prior
            flat margin block which felt like a marketing afterthought. */}
        <div className="relative mb-5 overflow-hidden rounded-2xl bg-gradient-to-br from-amber-50/80 via-white to-violet-50/60 px-5 py-6 ring-1 ring-amber-100/60">
          {/* Decorative concentric rings, top-right */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-gradient-to-br from-amber-200/40 to-transparent blur-2xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -left-16 -bottom-20 h-52 w-52 rounded-full bg-gradient-to-tr from-violet-200/30 to-transparent blur-3xl"
          />
          <div className="relative min-w-0">
            <div className="mb-3 flex items-center gap-2">
              <Logo size="sm" asLink={false} />
              <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-amber-700 ring-1 ring-amber-200/70 backdrop-blur-sm">
                {lang === "kz" ? "тұтынушы көмекшісі" : "AI ассистент"}
              </span>
            </div>
            <h2
              className="mb-2 text-zinc-950"
              style={{
                fontSize: 28,
                fontWeight: 760,
                lineHeight: 1.1,
                letterSpacing: "-0.01em",
              }}
            >
              {t("chat.empty.headline")}
            </h2>
            <p
              className="max-w-2xl text-zinc-600"
              style={{ fontSize: 14.5, lineHeight: 1.65 }}
            >
              {t("chat.empty.subheadline")}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full mb-4">
          {cards.map((card, index) => {
            const Icon = card.icon;
            // tones has 4 entries, modulo is always in-bounds; fallback to satisfy noUncheckedIndexedAccess.
            const tone = tones[index % tones.length] ?? tones[0]!;
            return (
              <button
                key={card.title}
                onClick={() => {
                  const hasProfileContext = Boolean(profileSummary(ctx, lang));
                  trackChatEmptyStateCardClicked({
                    card_id: card.title,
                    locale: lang,
                    is_personalized:
                      hasProfileContext ||
                      card === personalizedCard ||
                      card === contextCard,
                  });
                  onPick(card.prompt);
                }}
                className={`group relative flex min-h-[82px] items-start gap-3 overflow-hidden rounded-xl border border-zinc-200/80 bg-white p-4 text-left shadow-[0_1px_2px_rgba(24,24,27,0.04),0_4px_12px_-6px_rgba(24,24,27,0.05)] samga-anim-card-lift ${tone.hover}`}
              >
                <span
                  className={`absolute left-0 top-4 bottom-4 w-1 rounded-r ${tone.rail}`}
                  aria-hidden="true"
                />
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${tone.icon}`}
                >
                  <Icon size={16} />
                </span>
                <span className="min-w-0 flex-1 pr-3">
                  <span
                    className="block text-zinc-900 mb-1"
                    style={{ fontSize: 13, fontWeight: 720, lineHeight: 1.35 }}
                  >
                    {card.title}
                  </span>
                  <span
                    className="block text-zinc-500"
                    style={{ fontSize: 12, lineHeight: 1.45 }}
                  >
                    {card.hint}
                  </span>
                </span>
                <ArrowUpRight
                  size={14}
                  className="mt-1 shrink-0 text-zinc-300 transition-colors group-hover:text-zinc-600"
                />
              </button>
            );
          })}
        </div>

        <RecommendationsCarousel
          ctx={ctx}
          lang={lang === "kz" ? "kz" : "ru"}
          onPick={onPick}
        />

        <ProfileContextStrip ctx={ctx} lang={lang} />

        <ChatTemplates onPick={onPick} />
      </div>
    </div>
  );
}

function ProfileContextStrip({
  ctx,
  lang,
}: {
  ctx: TemplateContext;
  lang: "ru" | "kz";
}) {
  const subjects = ctx.profile_subjects
    .map((subject) => subjectLabel(subject, lang))
    .filter(Boolean);
  const weakest = ctx.weakest_subject
    ? subjectLabel(ctx.weakest_subject, lang)
    : "";
  const hasContext =
    ctx.has_onboarding_profile ||
    subjects.length > 0 ||
    Boolean(weakest) ||
    Boolean(ctx.target_university_name) ||
    ctx.last_test_results_count > 0;

  if (!hasContext) {
    return null;
  }

  const chips = [
    subjects.length > 0
      ? {
          label: lang === "kz" ? "Бейіндік пәндер" : "Предметы",
          value: subjects.join(" + "),
        }
      : null,
    weakest
      ? {
          label: lang === "kz" ? "Әлсіз пән" : "Слабый предмет",
          value: weakest,
        }
      : null,
    ctx.target_university_name
      ? {
          label: lang === "kz" ? "Арман ЖОО" : "Вуз мечты",
          value: ctx.target_university_name,
        }
      : null,
    ctx.last_test_results_count > 0
      ? {
          label: lang === "kz" ? "Соңғы балдар" : "Последние результаты",
          value:
            lang === "kz"
              ? `${ctx.last_test_results_count} нәтиже`
              : `${ctx.last_test_results_count} записей`,
        }
      : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  return (
    <div className="mb-4 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3">
      <div className="mb-3 flex items-center gap-2 text-zinc-700">
        <CheckCircle2 size={15} />
        <span
          style={{ fontSize: 11, fontWeight: 780, textTransform: "uppercase" }}
        >
          {lang === "kz"
            ? "Samga профиль деректерін қолданады"
            : "Samga использует данные профиля"}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <span
            key={`${chip.label}-${chip.value}`}
            className="rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-zinc-900"
          >
            <span
              className="mr-1 text-zinc-500"
              style={{ fontSize: 11, fontWeight: 760 }}
            >
              {chip.label}:
            </span>
            <span style={{ fontSize: 12, fontWeight: 700 }}>{chip.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * s33 (B2, 2026-04-28) — recommendations carousel built off
 * `template-context`. Renders a horizontal row of pill tiles
 * sourced from `topRecommendations`. Hides itself entirely when
 * the helper returns no eligible tiles.
 */
function RecommendationsCarousel({
  ctx,
  lang,
  onPick,
}: {
  ctx: TemplateContext;
  lang: "ru" | "kz";
  onPick: (prompt: string) => void;
}) {
  const recs: Recommendation[] = useMemo(
    () => topRecommendations(ctx, lang, { limit: 3 }),
    [ctx, lang],
  );
  // s33 wave 3 (G3): on viewports < 380px the 260-min cards force
  // horizontal scroll AND get cropped before the user sees the full
  // tile. Switch to a wrapped two-column grid in that range.
  const narrow = useViewportNarrow();
  if (!shouldShowRecommendationsCarousel(recs)) return null;

  const sectionLabel =
    lang === "kz" ? "Сізге арналған ұсыныстар" : "Рекомендации для вас";
  const layoutMode = carouselLayoutMode({
    width: typeof window !== "undefined" ? window.innerWidth : null,
    itemCount: recs.length,
  });
  const useWrappedGrid = layoutMode === "wrapped-grid" || narrow;

  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center gap-1.5 text-zinc-700">
        <Sparkles size={13} className="text-amber-500" />
        <span
          style={{ fontSize: 11, fontWeight: 780, textTransform: "uppercase" }}
        >
          {sectionLabel}
        </span>
      </div>
      <div
        className={
          useWrappedGrid
            ? "flex flex-wrap gap-2.5 pb-1"
            : "flex gap-2.5 overflow-x-auto pb-1"
        }
        // s33 (B2): horizontal scroll on overflow; hide scrollbar
        // visually but keep keyboard reachability via Tab order.
        // s33 wave 3 (G3): wrapped grid mode drops scroll-snap.
        style={useWrappedGrid ? undefined : { scrollSnapType: "x proximity" }}
      >
        {recs.map((rec) => (
          <button
            key={rec.id}
            type="button"
            onClick={() => {
              try {
                trackChatEmptyStateCardClicked({
                  card_id: `recommendation:${rec.id}`,
                  locale: lang,
                  is_personalized: true,
                });
              } catch {
                /* noop */
              }
              onPick(rec.prompt);
            }}
            className={
              useWrappedGrid
                ? // s33 wave 3 (G3): on narrow viewports tiles fill
                  // the row (basis-full) and stack vertically — no
                  // crop, no scroll. min-h-[44px] guarantees AAA
                  // tap target (G5).
                  "group flex basis-full flex-col gap-1 rounded-xl border border-amber-100 bg-amber-50/40 px-3.5 py-3 text-left shadow-[0_1px_2px_rgba(217,119,6,0.05)] samga-anim-card-lift hover:border-amber-200 hover:bg-amber-50 min-h-[44px]"
                : "group flex min-w-[260px] max-w-[320px] shrink-0 flex-col gap-1 rounded-xl border border-amber-100 bg-amber-50/40 px-3.5 py-2.5 text-left shadow-[0_1px_2px_rgba(217,119,6,0.05)] samga-anim-card-lift hover:border-amber-200 hover:bg-amber-50 min-h-[44px]"
            }
            style={useWrappedGrid ? undefined : { scrollSnapAlign: "start" }}
            data-recommendation-id={rec.id}
          >
            <span
              className={
                useWrappedGrid ? "text-zinc-900" : "truncate text-zinc-900"
              }
              style={{ fontSize: 13, fontWeight: 720, lineHeight: 1.3 }}
            >
              {rec.title}
            </span>
            <span
              className={
                useWrappedGrid ? "text-zinc-600" : "truncate text-zinc-600"
              }
              style={{ fontSize: 11.5, lineHeight: 1.45 }}
            >
              {rec.hint}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default ChatEmptyState;
