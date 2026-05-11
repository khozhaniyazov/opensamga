import { useEffect, useMemo, useRef, useState } from "react";
import {
  Scale,
  AlertTriangle,
  CalendarClock,
  ClipboardList,
  GitCompare,
  Crosshair,
  FileText,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLang } from "../../LanguageContext";
import { trackChatTemplateClicked } from "../../../lib/telemetry";
import { computeDwellMs } from "./templateDwell";
import { apiGet } from "../../../lib/api";
import { subjectLabel } from "../../../lib/subjectLabels";
import {
  DEFAULT_TEMPLATE_CONTEXT,
  coerceTemplateContext,
  type TemplateContext,
} from "./templateContext";
import { chatTemplateTileAriaLabel } from "./chatTemplateTileAriaLabel";

/**
 * Session 22c: one-click prompt templates ("Compare min scores vs
 * your scores", "Explain my last mistake", ...).
 *
 * Second-pass (smart ordering) polish, same session:
 *   - Fetch `/api/chat/template-context` on mount. Four signals:
 *     unresolved_mistakes_count, exam_attempts_count, weakness_topic_tag,
 *     has_library_activity. The endpoint silent-fails so the worst
 *     case we ever see here is "all signals zero" → static fallback
 *     order (== the order the templates were shipped in).
 *   - Rank templates by a small priority-score table. Mistakes present
 *     → `explain_mistake` first; exam history → `compare_scores`
 *     next; etc. Telemetry records rank_position + was_personalized
 *     so we can measure uplift later.
 *   - Hide `summarize_pdf` if the user has no recent library
 *     activity (prompt is nonsense for a brand-new signup). Others
 *     always render — they degrade to "generic advice" gracefully.
 *   - A11y: pill row is a role=toolbar with left/right (+ home/end)
 *     arrow-key navigation, matching the pattern used by
 *     MessageActions. First pill is the only one in the tab order.
 *
 * Gating (whether this component renders at all) stays the caller's
 * job — we assume the empty state has no messages.
 */

export interface ChatTemplate {
  /** Stable identifier for telemetry — never translate. */
  id: string;
  icon: LucideIcon;
  /** i18n key for the short pill label. */
  titleKey: string;
  /** i18n key for the prompt that gets sent to the LLM. */
  promptKey: string;
}

type TemplateTone = { icon: string; hover: string };
const DEFAULT_TEMPLATE_TONE: TemplateTone = {
  icon: "bg-zinc-50 text-zinc-700",
  hover: "hover:border-zinc-200 hover:bg-zinc-50/35",
};
const TEMPLATE_TONES: Record<string, TemplateTone> = {
  compare_scores: {
    icon: "bg-sky-50 text-sky-700",
    hover: "hover:border-sky-200 hover:bg-sky-50/35",
  },
  explain_mistake: {
    icon: "bg-rose-50 text-rose-700",
    hover: "hover:border-rose-200 hover:bg-rose-50/35",
  },
  plan_week: {
    icon: "bg-emerald-50 text-emerald-700",
    hover: "hover:border-emerald-200 hover:bg-emerald-50/35",
  },
  prep_plan: {
    icon: "bg-teal-50 text-teal-700",
    hover: "hover:border-teal-200 hover:bg-teal-50/35",
  },
  compare_unis: {
    icon: "bg-indigo-50 text-indigo-700",
    hover: "hover:border-indigo-200 hover:bg-indigo-50/35",
  },
  drill_weak: {
    icon: "bg-amber-50 text-amber-700",
    hover: "hover:border-amber-200 hover:bg-amber-50/35",
  },
  summarize_pdf: {
    icon: "bg-zinc-100 text-zinc-700",
    hover: "hover:border-zinc-300 hover:bg-zinc-50",
  },
};

const TEMPLATES: ChatTemplate[] = [
  {
    id: "compare_scores",
    icon: Scale,
    titleKey: "chat.templates.compare_scores.title",
    promptKey: "chat.templates.compare_scores.prompt",
  },
  {
    id: "explain_mistake",
    icon: AlertTriangle,
    titleKey: "chat.templates.explain_mistake.title",
    promptKey: "chat.templates.explain_mistake.prompt",
  },
  {
    id: "plan_week",
    icon: CalendarClock,
    titleKey: "chat.templates.plan_week.title",
    promptKey: "chat.templates.plan_week.prompt",
  },
  {
    id: "prep_plan",
    icon: ClipboardList,
    titleKey: "chat.templates.prep_plan.title",
    promptKey: "chat.templates.prep_plan.prompt",
  },
  {
    id: "compare_unis",
    icon: GitCompare,
    titleKey: "chat.templates.compare_unis.title",
    promptKey: "chat.templates.compare_unis.prompt",
  },
  {
    id: "drill_weak",
    icon: Crosshair,
    titleKey: "chat.templates.drill_weak.title",
    promptKey: "chat.templates.drill_weak.prompt",
  },
  {
    id: "summarize_pdf",
    icon: FileText,
    titleKey: "chat.templates.summarize_pdf.title",
    promptKey: "chat.templates.summarize_pdf.prompt",
  },
];

/** Return `TEMPLATES` ordered best-first given the student's signals.
 *
 * Scoring is additive: the template with the highest score wins the
 * first slot, ties break in the order they were declared (stable).
 * The reward weights are intentionally tiny and not configurable —
 * one click per tile per session, not a bandit problem. If the
 * context is all-zero (fresh signup or /template-context failed),
 * every score is zero so we return the declared order.
 */
export function rankTemplates(
  ctx: TemplateContext,
  allTemplates: ChatTemplate[] = TEMPLATES,
): ChatTemplate[] {
  const M = ctx.unresolved_mistakes_count > 0;
  const W = !!ctx.weakness_topic_tag || !!ctx.weakest_subject;
  const E = ctx.exam_attempts_count > 0 || ctx.last_test_results_count > 0;
  const L = ctx.has_library_activity;
  const U = !!ctx.target_university_name;

  const score = (id: string): number => {
    switch (id) {
      case "explain_mistake":
        // Strongest signal — if the user has a pending mistake, it's
        // ~always the most useful thing to drill into.
        return M ? 100 : 0;
      case "drill_weak":
        return W ? 80 : 0;
      case "compare_scores":
        return E ? 70 : 0;
      case "plan_week":
        // Plan is slightly useful even without exam history — there's
        // still a profile target date — but bumps up once a student
        // has taken at least one mock.
        return E || ctx.has_onboarding_profile ? 55 : 15;
      case "prep_plan":
        return E || W || U || ctx.has_onboarding_profile ? 85 : 25;
      case "compare_unis":
        return U ? 60 : E ? 30 : 10;
      case "summarize_pdf":
        return L ? 20 : 0;
      default:
        return 0;
    }
  };

  // Filter out `summarize_pdf` entirely when the student has no
  // recent library activity — the prompt refers to "the last PDF you
  // opened", so if they haven't opened one it makes zero sense.
  const filtered = allTemplates.filter(
    (t) => !(t.id === "summarize_pdf" && !L),
  );

  // Decorate-sort-undecorate with the original index as a tiebreaker
  // so the static fallback is truly stable.
  return filtered
    .map((t, i) => ({ t, s: score(t.id), i }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((row) => row.t);
}

function formatSubjects(ctx: TemplateContext, lang: "ru" | "kz"): string {
  return ctx.profile_subjects
    .map((subject) => subjectLabel(subject, lang))
    .filter(Boolean)
    .join(lang === "kz" ? " және " : " и ");
}

function formatProfileContext(ctx: TemplateContext, lang: "ru" | "kz"): string {
  const subjects = formatSubjects(ctx, lang);
  const weakest = ctx.weakest_subject
    ? subjectLabel(ctx.weakest_subject, lang)
    : "";
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

  const summary = parts.filter(Boolean).join("; ");
  if (!summary) {
    return "";
  }
  return lang === "kz"
    ? `Samga профилімдегі деректер: ${summary}.`
    : `Мой профиль Samga: ${summary}.`;
}

export function buildUntPrepPlanPrompt(
  ctx: TemplateContext,
  lang: "ru" | "kz",
): string {
  const profileContext = formatProfileContext(ctx, lang);
  const instruction =
    lang === "kz"
      ? "Маған ҰБТ-ға дайындықтың жеке жоспарын құр. Міндетті түрде мыналарды қолдан: бейіндік пәндер, ағымдағы балл, мақсатты балл, әлсіз тақырыптар, дайындық тілі, аптасына бөлетін сағат және келесі пробник күні. Профильде бір дерек жоқ болса, алдымен қысқа нақты сұрақтар қой. Дерек жеткілікті болса, жауапты мына құрылыммен бер: 1) балл мақсаты, 2) апталық кесте, 3) практика -> қате талдау -> қайталау циклі, 4) келесі пробникке дейінгі бақылау нүктесі."
      : "Составь мне персональный план подготовки к ЕНТ. Обязательно используй: профильные предметы, текущий балл, целевой балл, слабые темы, язык подготовки, доступные часы в неделю и дату следующего пробника. Если чего-то нет в профиле, сначала задай короткие конкретные вопросы. Если данных хватает, ответь структурой: 1) цель по баллам, 2) недельный график, 3) цикл практика -> разбор ошибок -> повтор, 4) контрольная точка до следующего пробника.";

  return profileContext ? `${profileContext}\n\n${instruction}` : instruction;
}

function buildPersonalizedPrompt(
  tpl: ChatTemplate,
  fallbackPrompt: string,
  ctx: TemplateContext,
  lang: "ru" | "kz",
): string {
  const weakest = ctx.weakest_subject
    ? subjectLabel(ctx.weakest_subject, lang)
    : "";
  const subjects = formatSubjects(ctx, lang);
  const target = ctx.target_university_name;
  const profileContext = formatProfileContext(ctx, lang);
  const withContext = (instruction: string) =>
    profileContext ? `${profileContext}\n\n${instruction}` : instruction;

  if (tpl.id === "drill_weak" && weakest) {
    return withContext(
      lang === "kz"
        ? `Осы деректерге сүйеніп, ${weakest} бойынша 5 түрлі деңгейдегі тапсырма бер, әрқайсысына қысқа түсіндірме қос және соңында бүгін не қайталау керегін айт.`
        : `Опираясь на этот профиль, дай 5 задач разного уровня по предмету ${weakest}, добавь короткое объяснение к каждой и в конце скажи, что повторить сегодня.`,
    );
  }

  if (tpl.id === "compare_scores" && ctx.last_test_results_count > 0) {
    // s26 phase 3+: deterministic tool routing. Naming
    // get_dream_university_progress in the prompt forces the agent
    // loop's tool-selection step to fire it instead of speaking
    // generally — and its DreamUniProgressCard renders inline.
    const subjectPhrase = subjects
      ? lang === "kz"
        ? ` (${subjects})`
        : ` (${subjects})`
      : "";
    return withContext(
      lang === "kz"
        ? `get_dream_university_progress құралын шақыр. Содан кейін соңғы тест нәтижелерімді${subjectPhrase} талда: қай пән мықты, қайсысы әлсіз, ${target ? `${target} мақсатына және ` : ""}грантқа жақындау үшін қанша балл көтеру керек, және 3 нақты қадам ұсын.`
        : `Вызови инструмент get_dream_university_progress, затем проанализируй мои последние результаты${subjectPhrase}: какой предмет сильнее, какой слабее, сколько баллов нужно добрать ${target ? `для цели ${target} и ` : ""}для гранта, и какие 3 шага сделать дальше.`,
    );
  }

  if (tpl.id === "compare_unis" && target) {
    return withContext(
      lang === "kz"
        ? `Профиль пәндерім мен соңғы нәтижелерімді ескеріп, ${target} бойынша түсу мүмкіндігін, тәуекелдерді және ұқсас 3 балама ЖОО-ны салыстыр.`
        : `С учётом моих профильных предметов и последних результатов оцени шанс поступления в ${target}, риски и сравни с 3 похожими альтернативами.`,
    );
  }

  if (
    tpl.id === "plan_week" &&
    (ctx.has_onboarding_profile || weakest || subjects)
  ) {
    return withContext(
      lang === "kz"
        ? `Осы аптаға нақты дайындық жоспарын құр: күндер, уақыт, тапсырма түрлері және бақылау нүктелері. Жоспарды әлсіз пәннен бастап, мақсатты ЖОО-ға сәйкестендір.`
        : `Составь точный план подготовки на эту неделю: дни, время, типы заданий и контрольные точки. Начни со слабого предмета и привяжи план к университету мечты.`,
    );
  }

  if (tpl.id === "prep_plan") {
    return buildUntPrepPlanPrompt(ctx, lang);
  }

  return withContext(fallbackPrompt);
}

interface Props {
  onPick: (prompt: string) => void;
}

export function ChatTemplates({ onPick }: Props) {
  const { t, lang } = useLang();
  const [ctx, setCtx] = useState<TemplateContext>(DEFAULT_TEMPLATE_CONTEXT);
  const [personalized, setPersonalized] = useState(false);
  // s35 wave 54 (2026-04-28): wall-clock ms when ChatTemplates first
  // committed. Stored in a ref so a re-render doesn't reset it
  // (which would zero-out the dwell for any tile click after the
  // template-context fetch lands and re-renders the row). Set in
  // the bootstrap effect below — first paint is a no-op for this.
  const mountedAtRef = useRef<number | null>(null);

  // Fetch context on mount. Silent-fail → static fallback order.
  useEffect(() => {
    if (mountedAtRef.current === null) {
      mountedAtRef.current = Date.now();
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await apiGet<unknown>("/chat/template-context");
        if (cancelled) return;
        const nextCtx = coerceTemplateContext(data);
        setCtx(nextCtx);
        setPersonalized(
          nextCtx.unresolved_mistakes_count > 0 ||
            nextCtx.exam_attempts_count > 0 ||
            !!nextCtx.weakness_topic_tag ||
            nextCtx.has_library_activity ||
            nextCtx.has_onboarding_profile ||
            nextCtx.last_test_results_count > 0 ||
            !!nextCtx.weakest_subject ||
            !!nextCtx.target_university_name,
        );
      } catch {
        // Keep DEFAULT_CONTEXT; we're not going to surface a fetch
        // error on an empty-state decoration.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const ordered = useMemo(() => rankTemplates(ctx), [ctx]);

  // Toolbar a11y: arrow / home / end navigation across pills. Only
  // the "active" index is tabbable at any time (roving tabindex) so
  // Tab escapes the group cleanly.
  const [activeIdx, setActiveIdx] = useState(0);
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const n = ordered.length;
    if (n === 0) return;
    let next = activeIdx;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (activeIdx + 1) % n;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (activeIdx - 1 + n) % n;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = n - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    setActiveIdx(next);
    btnRefs.current[next]?.focus();
  };

  return (
    <div className="w-full">
      <div className="mb-2.5 flex items-center justify-between gap-3 text-left">
        <span
          className="text-zinc-500"
          style={{
            fontSize: 11,
            fontWeight: 760,
            letterSpacing: 0,
            textTransform: "uppercase",
          }}
        >
          {t("chat.templates.heading")}
        </span>
      </div>
      <div
        role="toolbar"
        aria-label={t("chat.templates.heading")}
        onKeyDown={onKeyDown}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2"
      >
        {ordered.map((tpl, idx) => {
          const Icon = tpl.icon;
          const label = t(tpl.titleKey);
          const prompt = buildPersonalizedPrompt(
            tpl,
            t(tpl.promptKey),
            ctx,
            lang,
          );
          const tone =
            TEMPLATE_TONES[tpl.id] ??
            TEMPLATE_TONES.summarize_pdf ??
            DEFAULT_TEMPLATE_TONE;
          return (
            <button
              key={tpl.id}
              ref={(el) => {
                btnRefs.current[idx] = el;
              }}
              type="button"
              tabIndex={idx === activeIdx ? 0 : -1}
              onFocus={() => setActiveIdx(idx)}
              onClick={() => {
                trackChatTemplateClicked({
                  template_id: tpl.id,
                  locale: lang,
                  rank_position: idx,
                  was_personalized: personalized,
                  dwell_ms_since_mount: computeDwellMs(
                    mountedAtRef.current,
                    Date.now(),
                  ),
                });
                onPick(prompt);
              }}
              className={`group flex min-h-[48px] items-center gap-2.5 rounded-md border border-zinc-200 bg-white px-3 py-2.5 text-left shadow-[0_1px_2px_rgba(24,24,27,0.035)] transition-colors focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-100 ${tone.hover}`}
              title={prompt}
              aria-label={chatTemplateTileAriaLabel({
                title: label,
                prompt,
                lang,
              })}
              data-template-id={tpl.id}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${tone.icon}`}
              >
                <Icon size={14} />
              </span>
              <span
                className="min-w-0 text-zinc-800"
                style={{ fontSize: 12, fontWeight: 680, lineHeight: 1.35 }}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default ChatTemplates;
