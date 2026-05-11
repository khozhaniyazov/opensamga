import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BookOpen,
  Calendar,
  GraduationCap,
  MessageSquare,
  RotateCcw,
  Target,
} from "lucide-react";
import { Link } from "react-router";
import { ApiError, apiGet } from "../../lib/api";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { subjectLabel } from "../../lib/subjectLabels";
import { useLang, type Lang } from "../LanguageContext";
import { PlanGuard } from "../billing/PlanGuard";
import {
  hasWeakTopics,
  totalWeakPoints,
  weakTopicActionLabel,
  weakTopicPlanDayLabel,
  weakTopicPlanIntentLabel,
  weakTopicPriorityClasses,
  weakTopicPriorityLabel,
  type WeakTopicAction,
  type WeakTopicEntry,
  type WeakTopicModeResponse,
  type WeakTopicPlanDay,
  type WeakTopicSubjectGroup,
} from "./weakTopicModeModel";

export function WeakTopicModePage() {
  const { t } = useLang();
  useDocumentTitle(t("dash.nav.weakTopicMode"));
  return (
    <PlanGuard feature="gap-analysis">
      <WeakTopicModeContent />
    </PlanGuard>
  );
}

export default WeakTopicModePage;

function WeakTopicModeContent() {
  const { lang, t } = useLang();
  const [data, setData] = useState<WeakTopicModeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await apiGet<WeakTopicModeResponse>(
          "/analytics/weak-topic-mode",
        );
        if (cancelled) return;
        setData(response);
      } catch (err) {
        if (cancelled) return;
        setData(null);
        setError(
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : t("error.desc"),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const totalPoints = useMemo(() => (data ? totalWeakPoints(data) : 0), [data]);

  if (loading) {
    return (
      <Shell>
        <Hero
          title={t("weakTopicMode.title")}
          subtitle={t("weakTopicMode.subtitle")}
        />
        <p className="text-sm text-zinc-500">{t("loading")}</p>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell>
        <Hero
          title={t("weakTopicMode.title")}
          subtitle={t("weakTopicMode.subtitle")}
        />
        <section className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
          {error}
        </section>
      </Shell>
    );
  }

  if (!data || !hasWeakTopics(data)) {
    return (
      <Shell>
        <Hero
          title={t("weakTopicMode.title")}
          subtitle={t("weakTopicMode.subtitle")}
        />
        <EmptyState lang={lang} t={t} />
      </Shell>
    );
  }

  return (
    <Shell>
      <Hero
        title={t("weakTopicMode.title")}
        subtitle={t("weakTopicMode.subtitle")}
        chips={[
          {
            icon: <Target className="h-3.5 w-3.5" />,
            label:
              data.gap !== null && data.gap !== undefined
                ? `${t("weakTopicMode.gap")}: ${data.gap}`
                : t("weakTopicMode.gapUnknown"),
          },
          {
            icon: <BookOpen className="h-3.5 w-3.5" />,
            label: `${t("weakTopicMode.recoverable")}: ${data.total_recoverable_points}`,
          },
          {
            icon: <GraduationCap className="h-3.5 w-3.5" />,
            label: `${t("weakTopicMode.totalWeak")}: ${totalPoints}`,
          },
        ]}
      />

      <SubjectGroupsSection groups={data.subject_groups} lang={lang} t={t} />

      <SevenDayPlanSection plan={data.seven_day_plan} lang={lang} t={t} />
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="space-y-6">{children}</div>;
}

interface HeroChip {
  icon: ReactNode;
  label: string;
}

function Hero({
  title,
  subtitle,
  chips,
}: {
  title: string;
  subtitle: string;
  chips?: HeroChip[];
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-gradient-to-br from-white to-zinc-50 px-5 py-6">
      <h1 className="text-2xl font-semibold text-zinc-900">{title}</h1>
      <p className="mt-2 max-w-3xl text-sm text-zinc-600">{subtitle}</p>
      {chips && chips.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {chips.map((chip, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200"
            >
              {chip.icon}
              {chip.label}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function EmptyState({ lang, t }: { lang: Lang; t: (key: string) => string }) {
  return (
    <section className="rounded-xl border border-dashed border-zinc-300 bg-white px-5 py-8 text-center">
      <p className="text-sm font-medium text-zinc-900">
        {t("weakTopicMode.empty.title")}
      </p>
      <p className="mt-2 text-sm text-zinc-600">
        {t("weakTopicMode.empty.subtitle")}
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link
          to="/dashboard/exams"
          className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800"
        >
          {t("weakTopicMode.empty.startExam")}
        </Link>
        <Link
          to="/dashboard/quiz"
          className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-zinc-900 ring-1 ring-zinc-200 hover:bg-zinc-50"
        >
          {t("weakTopicMode.empty.startPractice")}
        </Link>
      </div>
      {lang === "kz" ? null : null}
    </section>
  );
}

function SubjectGroupsSection({
  groups,
  lang,
  t,
}: {
  groups: WeakTopicSubjectGroup[];
  lang: Lang;
  t: (key: string) => string;
}) {
  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold text-zinc-900">
          {t("weakTopicMode.gapMap.title")}
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          {t("weakTopicMode.gapMap.subtitle")}
        </p>
      </header>
      <div className="space-y-3">
        {groups.map((group) => (
          <SubjectCard key={group.subject} group={group} lang={lang} t={t} />
        ))}
      </div>
    </section>
  );
}

function SubjectCard({
  group,
  lang,
  t,
}: {
  group: WeakTopicSubjectGroup;
  lang: Lang;
  t: (key: string) => string;
}) {
  return (
    <article className="rounded-xl border border-zinc-200 bg-white px-4 py-4">
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-900">
          {subjectLabel(group.subject, lang)}
        </h3>
        <span className="text-xs font-medium text-zinc-500">
          {t("weakTopicMode.subjectCard.totalPointsLost")}:{" "}
          {group.total_points_lost}
        </span>
      </header>
      <ul className="mt-3 space-y-2.5">
        {group.topics.map((topic) => (
          <TopicRow
            key={`${group.subject}::${topic.topic}`}
            topic={topic}
            lang={lang}
            t={t}
          />
        ))}
      </ul>
    </article>
  );
}

function TopicRow({
  topic,
  lang,
  t,
}: {
  topic: WeakTopicEntry;
  lang: Lang;
  t: (key: string) => string;
}) {
  return (
    <li className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-900">{topic.topic}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {t("weakTopicMode.topic.pointsLost")}: {topic.points_lost} •{" "}
            {t("weakTopicMode.topic.mistakes")}: {topic.mistake_count} •{" "}
            {t("weakTopicMode.topic.pages")}: {topic.pages_to_read}
          </p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${weakTopicPriorityClasses(topic.priority)}`}
        >
          {weakTopicPriorityLabel(topic.priority, lang)}
        </span>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {topic.actions.map((action) => (
          <ActionChip key={action.kind} action={action} lang={lang} />
        ))}
      </div>
    </li>
  );
}

function ActionChip({ action, lang }: { action: WeakTopicAction; lang: Lang }) {
  const Icon = ACTION_ICON[action.kind] ?? BookOpen;
  return (
    <Link
      to={action.href}
      className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-medium text-zinc-800 ring-1 ring-zinc-200 hover:bg-zinc-100"
    >
      <Icon className="h-3 w-3" />
      {weakTopicActionLabel(action.kind, lang)}
    </Link>
  );
}

const ACTION_ICON: Record<string, typeof BookOpen> = {
  learn: BookOpen,
  tutor: MessageSquare,
  practice: Target,
  retest: RotateCcw,
};

function SevenDayPlanSection({
  plan,
  lang,
  t,
}: {
  plan: WeakTopicPlanDay[];
  lang: Lang;
  t: (key: string) => string;
}) {
  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold text-zinc-900">
          {t("weakTopicMode.plan.title")}
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          {t("weakTopicMode.plan.subtitle")}
        </p>
      </header>
      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
        {plan.map((day) => (
          <PlanDayCard key={day.day} day={day} lang={lang} />
        ))}
      </ol>
    </section>
  );
}

function PlanDayCard({ day, lang }: { day: WeakTopicPlanDay; lang: Lang }) {
  return (
    <li className="rounded-xl border border-zinc-200 bg-white px-3 py-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        <Calendar className="h-3 w-3" />
        {weakTopicPlanDayLabel(day.day, lang)}
      </p>
      <p className="mt-1.5 text-sm font-semibold text-zinc-900">
        {weakTopicPlanIntentLabel(day.intent, lang)}
      </p>
      {day.topic ? (
        <p className="mt-0.5 line-clamp-2 text-xs text-zinc-600">{day.topic}</p>
      ) : null}
      <Link
        to={day.href}
        className="mt-2 inline-flex text-[11px] font-medium text-zinc-700 underline-offset-2 hover:text-zinc-900 hover:underline"
      >
        {lang === "kz" ? "Ашу" : "Открыть"} →
      </Link>
    </li>
  );
}
