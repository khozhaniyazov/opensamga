import { useState, useEffect, useCallback, type ReactNode } from "react";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Filter,
  Sparkles,
  Target,
  TrendingUp,
  XCircle,
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiGet } from "../../lib/api";
import { useLang } from "../LanguageContext";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { subjectLabel } from "../../lib/subjectLabels";
import { PlanGuard } from "../billing/PlanGuard";
import {
  PracticeTrendPanel,
  type PracticeTrendSummary,
} from "./PracticeTrendPanel";

interface TrendPoint {
  date: string;
  total: number;
  resolved: number;
  unresolved: number;
}

interface TrendsData {
  daily_trends: TrendPoint[];
  total_mistakes: number;
  total_resolved: number;
  total_unresolved: number;
  resolution_rate: number;
}

interface Recommendation {
  topic: string;
  subject: string | null;
  mistake_count: number;
  unresolved_count: number;
  priority: "high" | "medium" | "low";
  recommendation: string;
  last_mistake_date: string | null;
}

interface RecommendationsData {
  recommendations: Recommendation[];
  total_weak_areas: number;
  practice_summary?: PracticeTrendSummary | null;
}

interface MistakeItem {
  id: number;
  question_text: string;
  subject: string | null;
  topic_tag: string | null;
  question_type: string | null;
  user_answer: string;
  correct_answer: string;
  is_resolved: boolean;
  points_lost: number;
  created_at: string;
  ai_diagnosis: string | null;
}

interface MistakeListData {
  mistakes: MistakeItem[];
  total: number;
  page: number;
  page_size: number;
  subjects: string[];
  topics: string[];
}

interface Filters {
  subject: string;
  topic: string;
  resolved: string;
  page: number;
}

function LightTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload || !payload.length) return null;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 shadow-sm">
      <p className="mb-1 text-zinc-500" style={{ fontSize: 11 }}>
        {label}
      </p>
      {payload.map((entry, idx) => (
        <p
          key={idx}
          style={{ color: entry.color, fontSize: 12.5, fontWeight: 650 }}
        >
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  );
}

function SectionSpinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="h-6 w-6 rounded-full border-[3px] border-amber-500 border-t-transparent animate-spin" />
    </div>
  );
}

function SectionError({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
      <div className="flex items-start gap-2">
        <AlertCircle size={16} className="mt-0.5 shrink-0" />
        <p style={{ fontSize: 13, lineHeight: 1.6 }}>{message}</p>
      </div>
    </div>
  );
}

function getQuestionTypeLabel(
  value: string | null,
  lang: "ru" | "kz",
): string | null {
  if (!value) return null;

  const labels: Record<string, { ru: string; kz: string }> = {
    exam: { ru: "Экзамен", kz: "Емтихан" },
    practice: { ru: "Практика", kz: "Практика" },
    chat: { ru: "Чат", kz: "Чат" },
  };

  return labels[value]?.[lang] ?? value;
}

// v3.66 (B8, 2026-05-02): wrap the inner page in PlanGuard so free-tier
// users see the same upgrade splash that /dashboard/exams,
// /dashboard/training, /dashboard/gap-analysis already render. Pre-fix,
// the bare MistakeReviewPage fired three /mistakes/* requests on mount
// and surfaced 403 console errors before falling back to a generic
// "Не удалось загрузить" message — inconsistent with the rest of the
// gated pages. Wrapping kicks in BEFORE the fetches mount, so 403 noise
// disappears too.
export function MistakeReviewPage() {
  return (
    <PlanGuard feature="mistakes">
      <MistakeReviewContent />
    </PlanGuard>
  );
}

function MistakeReviewContent() {
  const { lang, t } = useLang();
  useDocumentTitle(t("dash.nav.mistakes"));

  const copy =
    lang === "kz"
      ? {
          pageTitle: "Қателерді талдау",
          progressTitle: "Шешілу барысы",
          recommendationsTitle: "Ұсынылған оқу бағыты",
          listTitle: "Қателер тізімі",
          loadTrendError: "Қате динамикасын жүктеу мүмкін болмады",
          loadRecommendationsError: "Ұсыныстарды жүктеу мүмкін болмады",
          loadMistakesError: "Қателер тізімін жүктеу мүмкін болмады",
          totalMistakes: "Барлық қате",
          resolved: "Шешілген",
          unresolved: "Шешілмеген",
          resolutionRate: "Шешілу пайызы",
          chartTitle: "Соңғы 30 күндегі қателер динамикасы",
          chartEmpty: "График пайда болуы үшін бірнеше емтихан тапсырыңыз.",
          subjectAll: "Барлық пән",
          topicAll: "Барлық тақырып",
          filterAll: "Барлығы",
          clear: "Тазалау",
          totalSuffix: "қате",
          priority: {
            high: "Жоғары",
            medium: "Орташа",
            low: "Төмен",
          },
          totalCount: "барлығы",
          unresolvedCount: "шешілмеген",
          lastMistake: "Соңғысы",
          noRecommendations:
            "Ұсыныстар әлі жоқ. Алдымен бірнеше емтихан тапсырыңыз.",
          yourAnswer: "Сіздің жауабыңыз",
          correctAnswer: "Дұрыс жауап",
          pointsLost: "Жоғалған ұпай",
          aiDiagnosis: "Samga түсіндірмесі",
          pendingDiagnosis: "Талдау күтілуде",
          noQuestionText: "Сұрақ мәтіні қолжетімсіз",
          previous: "Артқа",
          next: "Келесі",
          page: "Бет",
          of: "ішінен",
          emptyFiltered:
            "Сүзгілерге сай қателер табылмады. Сүзгілерді өзгертіп көріңіз.",
          emptyDefault:
            "Қате әлі тіркелмеген. Прогресті бақылау үшін емтихан тапсырыңыз.",
          recommendationText: (
            topic: string,
            subject: string | null,
            unresolved: number,
          ) =>
            `${topic} тақырыбына назар аударыңыз${subject ? ` (${subject})` : ""}: ${unresolved} шешілмеген қате.`,
          practiceTitle: "Практика сигналы",
          practiceSubtitle:
            "Чат көретін соңғы практика қысымы енді осы бетте де көрінеді.",
          practiceEmpty:
            "Әзірге практика сигналы жоқ. Бірнеше практика сериясын аяқтағанда Samga қайталанатын әлсіз аймақтарды осында шығарады.",
        }
      : {
          pageTitle: "Разбор ошибок",
          progressTitle: "Прогресс разбора",
          recommendationsTitle: "Рекомендации для обучения",
          listTitle: "Список ошибок",
          loadTrendError: "Не удалось загрузить динамику ошибок",
          loadRecommendationsError: "Не удалось загрузить рекомендации",
          loadMistakesError: "Не удалось загрузить список ошибок",
          totalMistakes: "Всего ошибок",
          resolved: "Разобрано",
          unresolved: "Неразобрано",
          resolutionRate: "Доля разбора",
          chartTitle: "Динамика ошибок за последние 30 дней",
          chartEmpty:
            "Пройдите несколько экзаменов, чтобы увидеть график прогресса.",
          subjectAll: "Все предметы",
          topicAll: "Все темы",
          filterAll: "Все",
          clear: "Сбросить",
          totalSuffix: "ошибок",
          priority: {
            high: "Высокий",
            medium: "Средний",
            low: "Низкий",
          },
          totalCount: "всего",
          unresolvedCount: "не разобрано",
          lastMistake: "Последняя",
          noRecommendations:
            "Рекомендаций пока нет. Сначала пройдите несколько экзаменов.",
          yourAnswer: "Ваш ответ",
          correctAnswer: "Правильный ответ",
          pointsLost: "Потеряно баллов",
          aiDiagnosis: "Объяснение AI",
          pendingDiagnosis: "Анализ ещё выполняется",
          noQuestionText: "Текст вопроса недоступен",
          previous: "Назад",
          next: "Далее",
          page: "Страница",
          of: "из",
          emptyFiltered:
            "По текущим фильтрам ошибки не найдены. Попробуйте изменить фильтры.",
          emptyDefault:
            "Ошибок пока нет. Пройдите экзамен, чтобы начать отслеживать прогресс.",
          recommendationText: (
            topic: string,
            subject: string | null,
            unresolved: number,
          ) =>
            `Сфокусируйтесь на теме «${topic}»${subject ? ` по предмету ${subject}` : ""}: ${unresolved} нерешённых ошибок.`,
          practiceTitle: "Практические сигналы",
          practiceSubtitle:
            "Здесь теперь видно тот же недавний практический нажим, который Samga использует в чате.",
          practiceEmpty:
            "Пока нет практических сигналов. Завершите несколько практических сессий, и Samga покажет повторяющиеся слабые зоны прямо здесь.",
        };

  const locale = lang === "kz" ? "kk-KZ" : "ru-RU";

  const [trends, setTrends] = useState<TrendsData | null>(null);
  const [trendsLoading, setTrendsLoading] = useState(true);
  const [trendsError, setTrendsError] = useState<string | null>(null);

  const [recommendations, setRecommendations] =
    useState<RecommendationsData | null>(null);
  const [recsLoading, setRecsLoading] = useState(true);
  const [recsError, setRecsError] = useState<string | null>(null);

  const [listData, setListData] = useState<MistakeListData | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [filters, setFilters] = useState<Filters>({
    subject: "",
    topic: "",
    resolved: "",
    page: 1,
  });

  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setTrendsLoading(true);
        setTrendsError(null);
        const data = await apiGet<Partial<TrendsData>>(
          "/mistakes/trends?days=30",
        );
        setTrends({
          daily_trends: Array.isArray(data?.daily_trends)
            ? data.daily_trends
            : [],
          total_mistakes: Number(data?.total_mistakes ?? 0),
          total_resolved: Number(data?.total_resolved ?? 0),
          total_unresolved: Number(data?.total_unresolved ?? 0),
          resolution_rate: Number(data?.resolution_rate ?? 0),
        });
      } catch {
        setTrendsError(copy.loadTrendError);
      } finally {
        setTrendsLoading(false);
      }
    })();
  }, [copy.loadTrendError]);

  useEffect(() => {
    void (async () => {
      try {
        setRecsLoading(true);
        setRecsError(null);
        const data = await apiGet<Partial<RecommendationsData>>(
          "/mistakes/recommendations",
        );
        setRecommendations({
          recommendations: Array.isArray(data?.recommendations)
            ? data.recommendations
            : [],
          total_weak_areas: Number(data?.total_weak_areas ?? 0),
          practice_summary: data?.practice_summary ?? null,
        });
      } catch {
        setRecsError(copy.loadRecommendationsError);
      } finally {
        setRecsLoading(false);
      }
    })();
  }, [copy.loadRecommendationsError]);

  const fetchList = useCallback(
    async (nextFilters: Filters) => {
      try {
        setListLoading(true);
        setListError(null);

        const params = new URLSearchParams();
        if (nextFilters.subject) params.set("subject", nextFilters.subject);
        if (nextFilters.topic) params.set("topic", nextFilters.topic);
        if (nextFilters.resolved === "true") params.set("resolved", "true");
        if (nextFilters.resolved === "false") params.set("resolved", "false");
        params.set("page", String(nextFilters.page));
        params.set("page_size", "20");

        const data = await apiGet<Partial<MistakeListData>>(
          `/mistakes/list?${params.toString()}`,
        );
        setListData({
          mistakes: Array.isArray(data?.mistakes) ? data.mistakes : [],
          total: Number(data?.total ?? 0),
          page: Number(data?.page ?? nextFilters.page),
          page_size: Number(data?.page_size ?? 20),
          subjects: Array.isArray(data?.subjects) ? data.subjects : [],
          topics: Array.isArray(data?.topics) ? data.topics : [],
        });
      } catch {
        setListError(copy.loadMistakesError);
      } finally {
        setListLoading(false);
      }
    },
    [copy.loadMistakesError],
  );

  useEffect(() => {
    void fetchList(filters);
  }, [filters, fetchList]);

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value, page: 1 }));
  };

  const clearFilters = () => {
    setFilters({ subject: "", topic: "", resolved: "", page: 1 });
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
    });

  const formatFullDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  const truncateText = (text: string, max: number) => {
    if (text.length <= max) return text;
    return `${text.slice(0, max)}...`;
  };

  const localizeSubject = (value: string | null) =>
    value ? subjectLabel(value, lang) || value : "";

  const priorityClasses: Record<string, string> = {
    high: "border-red-200 bg-red-50 text-red-700",
    medium: "border-amber-200 bg-amber-50 text-amber-700",
    low: "border-green-200 bg-green-50 text-green-700",
  };

  const hasActiveFilters = Boolean(
    filters.subject || filters.topic || filters.resolved,
  );
  const totalPages = listData
    ? Math.ceil(listData.total / listData.page_size)
    : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="rounded-2xl border border-zinc-200 bg-white px-6 py-6 sm:px-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <HeroPill
                icon={<TrendingUp size={13} className="text-amber-700" />}
              >
                Samga Review
              </HeroPill>
              <HeroPill
                icon={<Sparkles size={13} className="text-amber-700" />}
              >
                {lang === "kz" ? "Қателер циклі" : "Цикл ошибок"}
              </HeroPill>
            </div>
            <h1
              className="text-[24px] text-zinc-950 sm:text-[30px]"
              style={{ fontWeight: 760, lineHeight: 1.08 }}
            >
              {copy.pageTitle}
            </h1>
            <p
              className="mt-3 text-zinc-600"
              style={{ fontSize: 14, lineHeight: 1.7 }}
            >
              {lang === "kz"
                ? "Samga қателерді тек сақтамайды, оларды қайдан жабуға болатынын көрсетеді."
                : "Samga не просто хранит ошибки, а показывает, откуда их реально закрывать."}
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-4 lg:w-[560px]">
            <HeroStat
              label={copy.totalMistakes}
              value={String(trends?.total_mistakes ?? 0)}
            />
            <HeroStat
              label={copy.resolved}
              value={String(trends?.total_resolved ?? 0)}
            />
            <HeroStat
              label={copy.unresolved}
              value={String(trends?.total_unresolved ?? 0)}
            />
            <HeroStat
              label={copy.resolutionRate}
              value={
                trends ? `${Math.round(trends.resolution_rate * 100)}%` : "0%"
              }
            />
          </div>
        </div>
      </section>

      <PracticeTrendPanel
        summary={recommendations?.practice_summary}
        lang={lang === "kz" ? "kz" : "ru"}
        title={copy.practiceTitle}
        subtitle={copy.practiceSubtitle}
        emptyMessage={copy.practiceEmpty}
      />

      <section className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
        <div className="mb-4 flex items-center gap-2">
          <TrendingUp size={18} className="text-amber-700" />
          <h2
            className="text-zinc-950"
            style={{ fontSize: 18, fontWeight: 730 }}
          >
            {copy.progressTitle}
          </h2>
        </div>

        {trendsLoading ? (
          <SectionSpinner />
        ) : trendsError ? (
          <SectionError message={trendsError} />
        ) : trends ? (
          trends.daily_trends.length > 1 ? (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <p
                className="mb-4 text-zinc-700"
                style={{ fontSize: 14, fontWeight: 650 }}
              >
                {copy.chartTitle}
              </p>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart
                  data={trends.daily_trends.map((point) => ({
                    ...point,
                    dateLabel: formatDate(point.date),
                  }))}
                  margin={{ top: 5, right: 16, bottom: 5, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                  <XAxis
                    dataKey="dateLabel"
                    stroke="#a1a1aa"
                    tick={{ fill: "#71717a", fontSize: 11 }}
                  />
                  <YAxis
                    stroke="#a1a1aa"
                    tick={{ fill: "#71717a", fontSize: 12 }}
                    allowDecimals={false}
                  />
                  <Tooltip content={<LightTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12, color: "#71717a" }} />
                  <Line
                    type="monotone"
                    dataKey="total"
                    name={copy.totalMistakes}
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={{ fill: "#f59e0b", r: 3 }}
                    activeDot={{ r: 5, fill: "#d97706" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="resolved"
                    name={copy.resolved}
                    stroke="#22c55e"
                    strokeWidth={2}
                    dot={{ fill: "#22c55e", r: 3 }}
                    activeDot={{ r: 5, fill: "#16a34a" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="unresolved"
                    name={copy.unresolved}
                    stroke="#ef4444"
                    strokeWidth={1.5}
                    strokeDasharray="5 3"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-5 py-10 text-center text-zinc-500">
              <p style={{ fontSize: 14, lineHeight: 1.7 }}>{copy.chartEmpty}</p>
            </div>
          )
        ) : null}
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
        <div className="mb-4 flex items-center gap-2">
          <Target size={18} className="text-amber-700" />
          <h2
            className="text-zinc-950"
            style={{ fontSize: 18, fontWeight: 730 }}
          >
            {copy.recommendationsTitle}
          </h2>
        </div>

        {recsLoading ? (
          <SectionSpinner />
        ) : recsError ? (
          <SectionError message={recsError} />
        ) : recommendations && recommendations.recommendations.length > 0 ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {recommendations.recommendations.map((rec, idx) => (
              <article
                key={idx}
                className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p
                      className="text-zinc-950"
                      style={{ fontSize: 16, fontWeight: 720 }}
                    >
                      {localizeSubject(rec.topic)}
                    </p>
                    {rec.subject ? (
                      <span
                        className="mt-2 inline-flex rounded-full border border-zinc-200 bg-white px-3 py-1 text-zinc-600"
                        style={{ fontSize: 11, fontWeight: 650 }}
                      >
                        {localizeSubject(rec.subject)}
                      </span>
                    ) : null}
                  </div>
                  <span
                    className={`inline-flex rounded-full border px-3 py-1.5 ${priorityClasses[rec.priority] || priorityClasses.low}`}
                    style={{ fontSize: 11, fontWeight: 700 }}
                  >
                    {copy.priority[rec.priority]}
                  </span>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  <SmallStat
                    label={copy.totalCount}
                    value={String(rec.mistake_count)}
                  />
                  <SmallStat
                    label={copy.unresolvedCount}
                    value={String(rec.unresolved_count)}
                  />
                  <SmallStat
                    label={copy.lastMistake}
                    value={
                      rec.last_mistake_date
                        ? formatFullDate(rec.last_mistake_date)
                        : "—"
                    }
                  />
                </div>

                <p
                  className="mt-4 text-zinc-600"
                  style={{ fontSize: 13, lineHeight: 1.7 }}
                >
                  {copy.recommendationText(
                    localizeSubject(rec.topic),
                    rec.subject ? localizeSubject(rec.subject) : null,
                    rec.unresolved_count,
                  )}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-5 py-10 text-center">
            <BookOpen size={24} className="mx-auto mb-3 text-zinc-500" />
            <p
              className="text-zinc-500"
              style={{ fontSize: 14, lineHeight: 1.7 }}
            >
              {copy.noRecommendations}
            </p>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <Filter size={18} className="text-amber-700" />
            <h2
              className="text-zinc-950"
              style={{ fontSize: 18, fontWeight: 730 }}
            >
              {copy.listTitle}
            </h2>
          </div>
          {listData ? (
            <span
              className="text-zinc-500 ml-auto"
              style={{ fontSize: 12, fontWeight: 650 }}
            >
              {listData.total} {copy.totalSuffix}
            </span>
          ) : null}
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <SelectWrap>
            <select
              value={filters.subject}
              onChange={(e) => updateFilter("subject", e.target.value)}
              aria-label={copy.subjectAll}
              className="w-full appearance-none bg-transparent pr-7 text-zinc-700 outline-none"
              style={{ fontSize: 12.5, fontWeight: 600 }}
            >
              <option value="">{copy.subjectAll}</option>
              {listData?.subjects.map((subject) => (
                <option key={subject} value={subject}>
                  {localizeSubject(subject)}
                </option>
              ))}
            </select>
            <ChevronDown
              size={12}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500"
            />
          </SelectWrap>

          <SelectWrap>
            <select
              value={filters.topic}
              onChange={(e) => updateFilter("topic", e.target.value)}
              aria-label={copy.topicAll}
              className="w-full appearance-none bg-transparent pr-7 text-zinc-700 outline-none"
              style={{ fontSize: 12.5, fontWeight: 600 }}
            >
              <option value="">{copy.topicAll}</option>
              {listData?.topics.map((topic) => (
                <option key={topic} value={topic}>
                  {localizeSubject(topic)}
                </option>
              ))}
            </select>
            <ChevronDown
              size={12}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500"
            />
          </SelectWrap>

          <div className="flex flex-wrap gap-2">
            {[
              { label: copy.filterAll, value: "" },
              { label: copy.unresolved, value: "false" },
              { label: copy.resolved, value: "true" },
            ].map((option) => (
              <button
                key={option.value || option.label}
                type="button"
                onClick={() => updateFilter("resolved", option.value)}
                className={`rounded-full border px-3 py-1.5 transition-colors ${
                  filters.resolved === option.value
                    ? "border-amber-300 bg-amber-50 text-amber-700"
                    : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50"
                }`}
                style={{ fontSize: 12, fontWeight: 700 }}
              >
                {option.label}
              </button>
            ))}
          </div>

          {hasActiveFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className="text-zinc-500 transition-colors hover:text-zinc-700"
              style={{ fontSize: 12, fontWeight: 650 }}
            >
              {copy.clear}
            </button>
          ) : null}
        </div>

        {listLoading ? (
          <SectionSpinner />
        ) : listError ? (
          <SectionError message={listError} />
        ) : listData && listData.mistakes.length > 0 ? (
          <div className="space-y-3">
            {listData.mistakes.map((mistake) => {
              const isExpanded = expandedId === mistake.id;
              const questionType = getQuestionTypeLabel(
                mistake.question_type,
                lang,
              );

              return (
                <article
                  key={mistake.id}
                  className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedId(isExpanded ? null : mistake.id)
                    }
                    className="w-full px-4 py-4 text-left"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p
                          className="text-zinc-900"
                          style={{
                            fontSize: 13.5,
                            fontWeight: 650,
                            lineHeight: 1.65,
                          }}
                        >
                          {truncateText(
                            mistake.question_text || copy.noQuestionText,
                            120,
                          )}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {mistake.subject ? (
                            <Tag
                              tone="neutral"
                              label={localizeSubject(mistake.subject)}
                            />
                          ) : null}
                          {mistake.topic_tag ? (
                            <Tag
                              tone="amber"
                              label={localizeSubject(mistake.topic_tag)}
                            />
                          ) : null}
                          {questionType ? (
                            <Tag tone="neutral" label={questionType} />
                          ) : null}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        {mistake.is_resolved ? (
                          <CheckCircle2
                            size={16}
                            className="text-emerald-500"
                          />
                        ) : (
                          <XCircle size={16} className="text-red-400" />
                        )}
                        <span
                          className="text-zinc-500"
                          style={{ fontSize: 11.5 }}
                        >
                          {formatFullDate(mistake.created_at)}
                        </span>
                        {isExpanded ? (
                          <ChevronUp size={14} className="text-zinc-500" />
                        ) : (
                          <ChevronDown size={14} className="text-zinc-500" />
                        )}
                      </div>
                    </div>
                  </button>

                  {isExpanded ? (
                    <div className="border-t border-zinc-200/70 bg-white px-4 py-4">
                      <div className="grid gap-3 sm:grid-cols-3">
                        <SmallStat
                          label={copy.yourAnswer}
                          value={mistake.user_answer}
                          tone="bad"
                        />
                        <SmallStat
                          label={copy.correctAnswer}
                          value={mistake.correct_answer}
                          tone="good"
                        />
                        <SmallStat
                          label={copy.pointsLost}
                          value={String(mistake.points_lost)}
                        />
                      </div>

                      <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-4">
                        <p
                          className="text-zinc-500"
                          style={{
                            fontSize: 11,
                            fontWeight: 760,
                            textTransform: "uppercase",
                          }}
                        >
                          {copy.aiDiagnosis}
                        </p>
                        <p
                          className="mt-2 text-zinc-700"
                          style={{ fontSize: 13, lineHeight: 1.7 }}
                        >
                          {mistake.ai_diagnosis
                            ? mistake.ai_diagnosis === "Pending analysis"
                              ? copy.pendingDiagnosis
                              : mistake.ai_diagnosis
                            : copy.pendingDiagnosis}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}

            {totalPages > 1 ? (
              <div className="flex items-center justify-center gap-2 pt-3">
                <button
                  type="button"
                  onClick={() =>
                    setFilters((prev) => ({
                      ...prev,
                      page: Math.max(1, prev.page - 1),
                    }))
                  }
                  disabled={filters.page <= 1}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-40"
                  style={{ fontSize: 12, fontWeight: 650 }}
                >
                  {copy.previous}
                </button>
                <span className="text-zinc-500" style={{ fontSize: 12.5 }}>
                  {copy.page} {filters.page} {copy.of} {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setFilters((prev) => ({
                      ...prev,
                      page: Math.min(totalPages, prev.page + 1),
                    }))
                  }
                  disabled={filters.page >= totalPages}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-40"
                  style={{ fontSize: 12, fontWeight: 650 }}
                >
                  {copy.next}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-5 py-10 text-center">
            <p
              className="text-zinc-500"
              style={{ fontSize: 14, lineHeight: 1.7 }}
            >
              {hasActiveFilters ? copy.emptyFiltered : copy.emptyDefault}
            </p>
          </div>
        )}
      </section>
    </div>
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

function SelectWrap({ children }: { children: ReactNode }) {
  return (
    <div className="relative rounded-full border border-zinc-200 bg-white px-3 py-2">
      {children}
    </div>
  );
}

function Tag({ tone, label }: { tone: "neutral" | "amber"; label: string }) {
  const classes =
    tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-zinc-200 bg-white text-zinc-600";
  return (
    <span
      className={`inline-flex rounded-full border px-3 py-1 ${classes}`}
      style={{ fontSize: 11.5, fontWeight: 650 }}
    >
      {label}
    </span>
  );
}

function SmallStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-700"
      : tone === "bad"
        ? "text-red-700"
        : "text-zinc-900";

  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-3">
      <p
        className="text-zinc-500"
        style={{ fontSize: 10.5, fontWeight: 760, textTransform: "uppercase" }}
      >
        {label}
      </p>
      <p
        className={`mt-2 break-words ${toneClass}`}
        style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.5 }}
      >
        {value}
      </p>
    </div>
  );
}
