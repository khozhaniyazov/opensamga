import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  BookOpen,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import { useNavigate } from "react-router";
import { useLang } from "../LanguageContext";
import { PlanGuard } from "../billing/PlanGuard";
import { apiGet } from "../../lib/api";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { subjectLabel } from "../../lib/subjectLabels";
import {
  PracticeTrendPanel,
  type PracticeTrendSummary,
} from "./PracticeTrendPanel";

interface GapRecommendation {
  topic: string;
  points_lost: number;
  pages_to_read: number;
  efficiency: number;
  action: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  message: string;
}

interface GapAnalysisResponse {
  target_university: string | null;
  grant_threshold: number | null;
  current_score: number | null;
  current_score_source?: string | null;
  gap: number | null;
  total_recoverable_points: number;
  recommendations: GapRecommendation[];
  practice_summary?: PracticeTrendSummary | null;
}

export function GapAnalysisPage() {
  const { t } = useLang();
  useDocumentTitle(t("dash.nav.gap"));
  return (
    <PlanGuard feature="gap-analysis">
      <GapAnalysisContent />
    </PlanGuard>
  );
}

function GapAnalysisContent() {
  const navigate = useNavigate();
  const { t, lang } = useLang();

  const [analysis, setAnalysis] = useState<GapAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await apiGet<GapAnalysisResponse>(
          "/analytics/gap-analysis",
        );
        setAnalysis(data);
      } catch (err) {
        setAnalysis(null);
        setError(err instanceof Error ? err.message : t("error.desc"));
      } finally {
        setLoading(false);
      }
    })();
  }, [t]);

  const progressPercent = useMemo(() => {
    if (
      !analysis?.current_score ||
      !analysis?.grant_threshold ||
      analysis.grant_threshold <= 0
    ) {
      return 0;
    }

    return Math.max(
      0,
      Math.min(
        100,
        Math.round((analysis.current_score / analysis.grant_threshold) * 100),
      ),
    );
  }, [analysis]);

  const localizedTopic = (topic: string) => subjectLabel(topic, lang) || topic;
  const currentScoreContext = useMemo(() => {
    if (!analysis?.current_score_source) return null;
    if (analysis.current_score_source === "profile_results") {
      return lang === "kz"
        ? "Ағымдағы база профильдегі соңғы 5 пән нәтижесінен алынды, себебі тарихта сенімді толық пробник табылмады."
        : "Текущая база взята из последних 5 предметов профиля, потому что в истории не нашлось надёжного полного пробника.";
    }
    if (analysis.current_score_source === "mock_exam") {
      return lang === "kz"
        ? "Ағымдағы база соңғы мағыналы толық пробник нәтижесінен алынды."
        : "Текущая база взята из последнего осмысленного полного пробника.";
    }
    return null;
  }, [analysis?.current_score_source, lang]);

  const localizedRecommendationMessage = (
    recommendation: GapRecommendation,
  ) => {
    const topic = localizedTopic(recommendation.topic);
    if (recommendation.action === "READ") {
      return lang === "kz"
        ? `${topic}: ${recommendation.pages_to_read} бет оқып, ${recommendation.points_lost} ұпайды қайтарыңыз`
        : `${topic}: прочитайте ${recommendation.pages_to_read} страниц и верните ${recommendation.points_lost} баллов`;
    }
    if (recommendation.action === "QUIZ") {
      return lang === "kz"
        ? `${topic}: қысқа тест арқылы ${recommendation.points_lost} ұпайды бекітіңіз`
        : `${topic}: закрепите коротким тестом, доступно ${recommendation.points_lost} баллов`;
    }
    return lang === "kz"
      ? `${topic}: көлемі үлкен, алдымен жоғары қайтарымды тақырыптарды жабыңыз`
      : `${topic}: большой объём, сначала закройте темы с лучшей отдачей`;
  };

  const hasRealData =
    analysis &&
    (analysis.current_score !== null ||
      analysis.grant_threshold !== null ||
      analysis.recommendations.length > 0);

  if (loading) {
    return (
      <Shell>
        <HeroHeader
          title={t("gap.title")}
          subtitle={t("gap.subtitle")}
          body={
            lang === "kz"
              ? "Нақты талдау жүктеліп жатыр..."
              : "Загружаем реальный анализ..."
          }
        />
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell>
        <HeroHeader title={t("gap.title")} subtitle={t("gap.subtitle")} />
        <section className="rounded-xl border border-red-200 bg-red-50 px-5 py-5 text-red-700">
          <p style={{ fontSize: 13, lineHeight: 1.6 }}>{error}</p>
        </section>
      </Shell>
    );
  }

  if (!analysis || !hasRealData) {
    return (
      <Shell>
        <HeroHeader title={t("gap.title")} subtitle={t("gap.subtitle")} />
        <section className="rounded-2xl border border-zinc-200 bg-white px-6 py-10 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500">
            <BookOpen size={24} />
          </div>
          <p
            className="text-zinc-900"
            style={{ fontSize: 18, fontWeight: 720 }}
          >
            {lang === "kz"
              ? "Дерек әлі жеткіліксіз"
              : "Пока недостаточно данных"}
          </p>
          <p
            className="mx-auto mt-3 max-w-2xl text-zinc-500"
            style={{ fontSize: 13, lineHeight: 1.7 }}
          >
            {lang === "kz"
              ? "Gap analysis енді жалған болжам көрсетпейді. Алдымен сынақ емтиханын немесе практиканы аяқтаңыз."
              : "Gap analysis больше не показывает вымышленные прогнозы. Сначала завершите пробный экзамен или практику."}
          </p>
        </section>
      </Shell>
    );
  }

  return (
    <Shell>
      <section className="rounded-2xl border border-zinc-200 bg-white px-6 py-6 sm:px-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <HeroPill icon={<Target size={13} className="text-amber-700" />}>
                Samga Gap
              </HeroPill>
              <HeroPill
                icon={<Sparkles size={13} className="text-amber-700" />}
              >
                {lang === "kz"
                  ? "Қалпына келтіру картасы"
                  : "Карта восстановления"}
              </HeroPill>
            </div>
            <h1
              className="text-[24px] text-zinc-950 sm:text-[30px]"
              style={{ fontWeight: 760, lineHeight: 1.08 }}
            >
              {t("gap.title")}
            </h1>
            <p
              className="mt-3 text-[13px] text-zinc-600 sm:text-[14px]"
              style={{ lineHeight: 1.7 }}
            >
              {analysis.target_university
                ? lang === "kz"
                  ? `${analysis.target_university} мақсатына жету үшін Samga қай жерден ұпай қайтаруға болатынын көрсетеді.`
                  : `Samga показывает, откуда реально вернуть баллы на пути к цели ${analysis.target_university}.`
                : lang === "kz"
                  ? "Samga нәтижелерден қай жерде ең үлкен қайтарым барын бөліп көрсетеді."
                  : "Samga выделяет, где по результатам лежит лучший возврат баллов."}
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-3 lg:w-[430px]">
            <HeroStat
              label={lang === "kz" ? "Нысаналы шек" : "Целевой порог"}
              value={
                analysis.grant_threshold != null
                  ? String(analysis.grant_threshold)
                  : "—"
              }
            />
            <HeroStat
              label={lang === "kz" ? "Ағымдағы балл" : "Текущий балл"}
              value={
                analysis.current_score != null
                  ? String(analysis.current_score)
                  : "—"
              }
            />
            <HeroStat
              label={lang === "kz" ? "Прогресс" : "Прогресс"}
              value={`${progressPercent}%`}
            />
          </div>
        </div>

        {currentScoreContext ? (
          <p
            className="mt-4 text-zinc-500 lg:ml-auto lg:max-w-[430px]"
            style={{ fontSize: 12.5, lineHeight: 1.65 }}
          >
            {currentScoreContext}
          </p>
        ) : null}

        <div className="mt-5 h-2 rounded-full bg-zinc-200/70 overflow-hidden">
          <div
            className="h-full rounded-full bg-amber-500 transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <InfoCard
          icon={<Target size={15} className="text-amber-700" />}
          label={lang === "kz" ? "Қалған ұпай" : "Оставшийся разрыв"}
          value={String(Math.max(0, analysis.gap ?? 0))}
        />
        <InfoCard
          icon={<TrendingUp size={15} className="text-amber-700" />}
          label={
            lang === "kz" ? "Қалпына келетін ұпай" : "Восстанавливаемые баллы"
          }
          value={String(analysis.total_recoverable_points)}
        />
        <InfoCard
          icon={<BookOpen size={15} className="text-amber-700" />}
          label={lang === "kz" ? "Ұсыныстар" : "Рекомендации"}
          value={String(analysis.recommendations.length)}
        />
      </div>

      <PracticeTrendPanel
        summary={analysis.practice_summary}
        lang={lang === "kz" ? "kz" : "ru"}
        title={lang === "kz" ? "Практика қысымы" : "Практическое давление"}
        subtitle={
          lang === "kz"
            ? "Gap analysis енді тек қателерді емес, соңғы практикаларда қайта-қайта қысым беріп тұрған пәндерді де көрсетеді."
            : "Gap analysis теперь показывает не только ошибки, но и предметы, которые повторно давят в последних практиках."
        }
        emptyMessage={
          lang === "kz"
            ? "Практикалық трендтер әлі жиналмаған. Бірнеше практикадан кейін Samga бұл жерде қайталанатын қысымды көрсетеді."
            : "Практические тренды ещё не накопились. После нескольких практик Samga покажет здесь повторяющееся давление."
        }
      />

      <section className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
        <div className="mb-4">
          <h2
            className="text-zinc-950"
            style={{ fontSize: 18, fontWeight: 740 }}
          >
            {lang === "kz" ? "Нақты ұсыныстар" : "Реальные рекомендации"}
          </h2>
          <p
            className="mt-1 text-zinc-500"
            style={{ fontSize: 13, lineHeight: 1.6 }}
          >
            {lang === "kz"
              ? "Мұнда Samga бірінші қай жерден ұпай қайтаруға болатынын реттеп береді."
              : "Здесь Samga раскладывает, откуда в первую очередь можно вернуть баллы."}
          </p>
        </div>

        {analysis.recommendations.length === 0 ? (
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-5 py-8 text-center">
            <p
              className="text-zinc-500"
              style={{ fontSize: 14, lineHeight: 1.7 }}
            >
              {lang === "kz"
                ? "Әзірге нақты ұсыныстар жоқ. Қосымша қателер немесе тәжірибе нәтижелері қажет."
                : "Пока нет конкретных рекомендаций. Нужны дополнительные ошибки или результаты практики."}
            </p>
          </div>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {analysis.recommendations.map((recommendation) => (
              <article
                key={`${recommendation.topic}-${recommendation.action}`}
                className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p
                      className="text-zinc-950"
                      style={{ fontSize: 16, fontWeight: 720 }}
                    >
                      {localizedTopic(recommendation.topic)}
                    </p>
                    <p
                      className="mt-2 text-zinc-600"
                      style={{ fontSize: 13, lineHeight: 1.65 }}
                    >
                      {localizedRecommendationMessage(recommendation)}
                    </p>
                  </div>
                  <PriorityBadge
                    priority={recommendation.priority}
                    lang={lang}
                  />
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  <MiniMetric
                    label={lang === "kz" ? "Ұпай" : "Баллы"}
                    value={`+${recommendation.points_lost}`}
                  />
                  <MiniMetric
                    label={lang === "kz" ? "Беттер" : "Страницы"}
                    value={String(recommendation.pages_to_read)}
                  />
                  <MiniMetric
                    label={lang === "kz" ? "Тиімділік" : "Эффективность"}
                    value={String(recommendation.efficiency)}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => navigate("/dashboard/mistakes")}
                  className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
                  style={{ fontSize: 13, fontWeight: 680 }}
                >
                  {t("gap.review")}
                  <ArrowRight size={14} />
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-6xl space-y-6">{children}</div>;
}

function HeroHeader({
  title,
  subtitle,
  body,
}: {
  title: string;
  subtitle: string;
  body?: string;
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white px-6 py-6 sm:px-7">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <HeroPill icon={<Target size={13} className="text-amber-700" />}>
          Samga Gap
        </HeroPill>
      </div>
      <h1
        className="text-[24px] text-zinc-950 sm:text-[30px]"
        style={{ fontWeight: 760, lineHeight: 1.08 }}
      >
        {title}
      </h1>
      <p
        className="mt-3 text-zinc-500"
        style={{ fontSize: 13, lineHeight: 1.7 }}
      >
        {body || subtitle}
      </p>
    </section>
  );
}

function HeroPill({ icon, children }: { icon: ReactNode; children: string }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-zinc-700"
      style={{ fontSize: 11, fontWeight: 700 }}
    >
      {icon}
      {children}
    </span>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
      <p
        className="text-zinc-500"
        style={{ fontSize: 11, fontWeight: 760, textTransform: "uppercase" }}
      >
        {label}
      </p>
      <p
        className="mt-2 text-zinc-900"
        style={{ fontSize: 20, fontWeight: 760, lineHeight: 1 }}
      >
        {value}
      </p>
    </div>
  );
}

function InfoCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-4">
      <div
        className="flex items-center gap-2 text-zinc-500"
        style={{ fontSize: 11, fontWeight: 760, textTransform: "uppercase" }}
      >
        {icon}
        <span>{label}</span>
      </div>
      <p
        className="mt-2 text-zinc-950"
        style={{ fontSize: 24, fontWeight: 760, lineHeight: 1 }}
      >
        {value}
      </p>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-3">
      <p
        className="text-zinc-500"
        style={{ fontSize: 10.5, fontWeight: 760, textTransform: "uppercase" }}
      >
        {label}
      </p>
      <p
        className="mt-2 text-zinc-900"
        style={{ fontSize: 15, fontWeight: 720 }}
      >
        {value}
      </p>
    </div>
  );
}

function PriorityBadge({
  priority,
  lang,
}: {
  priority: "HIGH" | "MEDIUM" | "LOW";
  lang: "ru" | "kz";
}) {
  const map = {
    HIGH: {
      className: "border-red-200 bg-red-50 text-red-700",
      label: lang === "kz" ? "Жоғары" : "Высокий",
    },
    MEDIUM: {
      className: "border-amber-200 bg-amber-50 text-amber-700",
      label: lang === "kz" ? "Орташа" : "Средний",
    },
    LOW: {
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      label: lang === "kz" ? "Төмен" : "Низкий",
    },
  }[priority];

  return (
    <span
      className={`inline-flex rounded-full border px-3 py-1.5 ${map.className}`}
      style={{ fontSize: 11, fontWeight: 700 }}
    >
      {map.label}
    </span>
  );
}
