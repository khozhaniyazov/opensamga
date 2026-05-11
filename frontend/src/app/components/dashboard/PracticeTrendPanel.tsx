import { type ReactNode } from "react";
import { Activity, Sparkles, Target, TrendingUp } from "lucide-react";
import { subjectLabel } from "../../lib/subjectLabels";

export interface PracticeSnapshot {
  session_id: number | null;
  subject: string | null;
  score: number | null;
  max_score: number | null;
  updated_at: string | null;
}

export interface PracticeTrendItem {
  subject: string;
  sessions: number;
  answered: number;
  correct: number;
  points_lost: number;
  accuracy_rate: number;
  latest_updated_at: string | null;
}

export interface PracticeTrendSummary {
  latest_practice: PracticeSnapshot | null;
  trends: PracticeTrendItem[];
}

interface PracticeTrendPanelProps {
  summary: PracticeTrendSummary | null | undefined;
  lang: "ru" | "kz";
  title: string;
  subtitle: string;
  emptyMessage: string;
}

export function PracticeTrendPanel({
  summary,
  lang,
  title,
  subtitle,
  emptyMessage,
}: PracticeTrendPanelProps) {
  const latest = summary?.latest_practice ?? null;
  const trends = summary?.trends ?? [];
  const totalLost = trends.reduce((sum, item) => sum + item.points_lost, 0);
  const locale = lang === "kz" ? "kk-KZ" : "ru-RU";

  const copy =
    lang === "kz"
      ? {
          latest: "Соңғы практика",
          recurring: "Қайталанатын аймақтар",
          lost: "Жоғалған ұпай",
          sessions: "Практика",
          accuracy: "Дәлдік",
          pressure: "Қысым",
          latestLead:
            "Samga соңғы практика нәтижесін де, бірнеше практика бойы қайталанған әлсіз аймақтарды да ұстап тұр.",
          latestDate: "Соңғы жаңарту",
          noDate: "Жаңа ғана",
          recurringLead:
            "Бұл тек бір сәттік қате емес, соңғы практикаларда қайта көрінген тақырыптар.",
          sessionsSuffix: "рет",
          lostSuffix: "ұпай жоғалды",
        }
      : {
          latest: "Последняя практика",
          recurring: "Повторяющиеся зоны",
          lost: "Потерянные баллы",
          sessions: "Сессии",
          accuracy: "Точность",
          pressure: "Давление",
          latestLead:
            "Samga держит и последний практический срез, и зоны, которые повторяются в нескольких недавних практиках.",
          latestDate: "Последнее обновление",
          noDate: "Только что",
          recurringLead:
            "Это не разовая просадка, а темы, которые снова всплывают в недавних практиках.",
          sessionsSuffix: "сессии",
          lostSuffix: "баллов потеряно",
        };

  const formatSubject = (value: string | null) =>
    value ? subjectLabel(value, lang) || value : "—";
  const formatDate = (value: string | null) =>
    value
      ? new Date(value).toLocaleDateString(locale, {
          month: "short",
          day: "numeric",
        })
      : copy.noDate;
  const sessionLabel = (count: number) => {
    if (lang === "kz") {
      return `${count} рет`;
    }
    const remainder10 = count % 10;
    const remainder100 = count % 100;
    if (count === 1) return "1 сессия";
    if (
      remainder10 >= 2 &&
      remainder10 <= 4 &&
      (remainder100 < 12 || remainder100 > 14)
    ) {
      return `${count} сессии`;
    }
    return `${count} сессий`;
  };

  if (!latest && trends.length === 0) {
    return (
      <section className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
        <div className="mb-4 flex items-center gap-2">
          <Activity size={18} className="text-amber-700" />
          <h2
            className="text-zinc-950"
            style={{ fontSize: 18, fontWeight: 730 }}
          >
            {title}
          </h2>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-5 py-10 text-center text-zinc-500">
          <p style={{ fontSize: 14, lineHeight: 1.7 }}>{emptyMessage}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
      <div className="mb-4 flex items-center gap-2">
        <Activity size={18} className="text-amber-700" />
        <h2 className="text-zinc-950" style={{ fontSize: 18, fontWeight: 730 }}>
          {title}
        </h2>
      </div>
      <p
        className="mb-4 text-zinc-500"
        style={{ fontSize: 13, lineHeight: 1.65 }}
      >
        {subtitle}
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          icon={<Target size={15} className="text-amber-700" />}
          label={copy.latest}
          value={
            latest?.score != null && latest?.max_score != null
              ? `${latest.score}/${latest.max_score}`
              : "—"
          }
          detail={formatSubject(latest?.subject ?? null)}
        />
        <MetricCard
          icon={<Sparkles size={15} className="text-amber-700" />}
          label={copy.recurring}
          value={String(trends.length)}
          detail={copy.recurringLead}
        />
        <MetricCard
          icon={<TrendingUp size={15} className="text-amber-700" />}
          label={copy.lost}
          value={String(totalLost)}
          detail={
            lang === "kz" ? "Соңғы практика топтарынан" : "Из недавних практик"
          }
        />
      </div>

      {latest ? (
        <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-4">
          <p
            className="text-zinc-950"
            style={{ fontSize: 15, fontWeight: 720 }}
          >
            {copy.latestLead}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Chip>{formatSubject(latest.subject)}</Chip>
            <Chip>
              {copy.latestDate}: {formatDate(latest.updated_at)}
            </Chip>
          </div>
        </div>
      ) : null}

      {trends.length > 0 ? (
        <div className="mt-4 grid gap-3 xl:grid-cols-3">
          {trends.map((trend) => (
            <article
              key={`${trend.subject}-${trend.latest_updated_at ?? "recent"}`}
              className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p
                    className="text-zinc-950"
                    style={{ fontSize: 16, fontWeight: 720 }}
                  >
                    {formatSubject(trend.subject)}
                  </p>
                  <p
                    className="mt-2 text-zinc-500"
                    style={{ fontSize: 12.5, lineHeight: 1.6 }}
                  >
                    {copy.recurringLead}
                  </p>
                </div>
                <span
                  className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-700"
                  style={{ fontSize: 11, fontWeight: 700 }}
                >
                  {trend.points_lost} {copy.lostSuffix}
                </span>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <MiniMetric
                  label={copy.sessions}
                  value={sessionLabel(trend.sessions)}
                />
                <MiniMetric
                  label={copy.accuracy}
                  value={`${Math.round(trend.accuracy_rate * 100)}%`}
                />
                <MiniMetric
                  label={copy.pressure}
                  value={`${trend.points_lost}/${trend.answered}`}
                />
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
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
      <p
        className="mt-2 text-zinc-500"
        style={{ fontSize: 12.5, lineHeight: 1.55 }}
      >
        {detail}
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
        style={{ fontSize: 14, fontWeight: 720, lineHeight: 1.4 }}
      >
        {value}
      </p>
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-flex rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-zinc-600"
      style={{ fontSize: 11.5, fontWeight: 650 }}
    >
      {children}
    </span>
  );
}
