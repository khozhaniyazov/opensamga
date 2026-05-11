import { useEffect, useState, type ReactNode } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useTranslation } from "react-i18next";
import { TrendingUp, Award, Target, BarChart3, ArrowLeft } from "lucide-react";
import apiClient from "../../../api/client";

interface TrendPoint {
  date: string;
  percentage: number;
}

interface SubjectPerformance {
  subject: string;
  avg_score: number;
  avg_max: number;
}

interface AnalyticsResponse {
  total_attempts: number;
  avg_score: number;
  avg_percentage: number;
  best_score: number;
  best_percentage: number;
  score_trend?: TrendPoint[];
  subject_performance?: SubjectPerformance[];
}

interface TooltipPayloadEntry {
  name?: string;
  value?: number | string;
  color?: string;
}

interface LightTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string | number;
}

const LightTooltip = ({ active, payload, label }: LightTooltipProps) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 shadow-sm">
      <p className="mb-1 text-xs text-zinc-500">{label}</p>
      {payload.map((entry, idx) => (
        <p
          key={idx}
          className="text-sm font-medium"
          style={{ color: entry.color }}
        >
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  );
};

const Shell = ({ children }: { children: ReactNode }) => (
  <div className="mx-auto max-w-6xl space-y-6">{children}</div>
);

interface CenterStateProps {
  icon: ReactNode;
  title: string;
  body: string;
  tone?: "neutral" | "danger";
}

const CenterState = ({
  icon,
  title,
  body,
  tone = "neutral",
}: CenterStateProps) => (
  <Shell>
    <section
      className={`rounded-2xl border px-6 py-12 text-center ${
        tone === "danger"
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-zinc-200 bg-white text-zinc-700"
      }`}
    >
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-500">
        {icon}
      </div>
      <h1
        className={`text-xl font-semibold ${tone === "danger" ? "text-red-700" : "text-zinc-950"}`}
      >
        {title}
      </h1>
      <p
        className={`mx-auto mt-2 max-w-xl text-sm leading-6 ${tone === "danger" ? "text-red-700" : "text-zinc-500"}`}
      >
        {body}
      </p>
    </section>
  </Shell>
);

interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}

const StatCard = ({ icon, label, value, detail }: StatCardProps) => (
  <div className="rounded-xl border border-zinc-200 bg-white p-4">
    <div className="mb-3 flex items-center gap-2 text-zinc-500">
      {icon}
      <p className="text-sm">{label}</p>
    </div>
    <p className="text-2xl font-semibold text-zinc-950">{value}</p>
    {detail ? <p className="mt-1 text-xs text-zinc-500">{detail}</p> : null}
  </div>
);

const ChartPanel = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <section className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6">
    <h2 className="mb-4 text-lg font-semibold text-zinc-950">{title}</h2>
    {children}
  </section>
);

const ExamAnalytics = () => {
  const { t } = useTranslation(["exam", "common"]);
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        setLoading(true);
        setError(null);
        const response =
          await apiClient.get<AnalyticsResponse>("/exam/analytics");
        setData(response.data);
      } catch (err: unknown) {
        const e = err as {
          response?: { data?: { detail?: string } };
          message?: string;
        } | null;
        setError(
          e?.response?.data?.detail || e?.message || "Failed to load analytics",
        );
      } finally {
        setLoading(false);
      }
    };
    fetchAnalytics();
  }, []);

  if (loading) {
    return (
      <CenterState
        icon={
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
        }
        title={t("exam:loading_analytics", {
          defaultValue: "Loading analytics...",
        })}
        body={t("exam:analytics_subtitle", {
          defaultValue:
            "Track your progress and identify areas for improvement",
        })}
      />
    );
  }

  if (error) {
    return (
      <CenterState
        icon={<BarChart3 className="h-6 w-6" />}
        title={t("exam:analytics_error", {
          defaultValue: "Error loading analytics",
        })}
        body={error}
        tone="danger"
      />
    );
  }

  if (!data || data.total_attempts === 0) {
    return (
      <CenterState
        icon={<BarChart3 className="h-6 w-6" />}
        title={t("exam:no_analytics_title", { defaultValue: "No data yet" })}
        body={t("exam:no_analytics_desc", {
          defaultValue:
            "Complete your first exam to see performance analytics.",
        })}
      />
    );
  }

  const {
    score_trend = [],
    subject_performance = [],
    total_attempts,
    avg_score,
    avg_percentage,
    best_score,
    best_percentage,
  } = data;

  return (
    <Shell>
      <section className="rounded-2xl border border-zinc-200 bg-white px-5 py-5 sm:px-6">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="mb-4 inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-600 transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-950"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("common:back", { defaultValue: "Back" })}
        </button>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-semibold text-zinc-700">
              <BarChart3 className="h-3.5 w-3.5 text-amber-700" />
              Samga Exams
            </div>
            <h1 className="text-2xl font-semibold leading-tight text-zinc-950 sm:text-3xl">
              {t("exam:analytics_title", {
                defaultValue: "Performance Analytics",
              })}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-600">
              {t("exam:analytics_subtitle", {
                defaultValue:
                  "Track your progress and identify areas for improvement",
              })}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:w-[420px]">
            <StatCard
              icon={<Target className="h-4 w-4 text-amber-700" />}
              label={t("exam:total_attempts", {
                defaultValue: "Total Attempts",
              })}
              value={total_attempts}
            />
            <StatCard
              icon={<TrendingUp className="h-4 w-4 text-emerald-700" />}
              label={t("exam:avg_percentage", {
                defaultValue: "Avg Percentage",
              })}
              value={`${avg_percentage}%`}
            />
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Target className="h-4 w-4 text-amber-700" />}
          label={t("exam:total_attempts", { defaultValue: "Total Attempts" })}
          value={total_attempts}
        />
        <StatCard
          icon={<TrendingUp className="h-4 w-4 text-emerald-700" />}
          label={t("exam:avg_score", { defaultValue: "Average Score" })}
          value={avg_score}
        />
        <StatCard
          icon={<Award className="h-4 w-4 text-sky-700" />}
          label={t("exam:best_score", { defaultValue: "Best Score" })}
          value={best_score}
          detail={`${best_percentage}%`}
        />
        <StatCard
          icon={<BarChart3 className="h-4 w-4 text-violet-700" />}
          label={t("exam:avg_percentage", { defaultValue: "Avg Percentage" })}
          value={`${avg_percentage}%`}
        />
      </div>

      <ChartPanel
        title={t("exam:score_trend_title", {
          defaultValue: "Score Trend Over Time",
        })}
      >
        {score_trend.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart
              data={score_trend}
              margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
              <XAxis
                dataKey="date"
                stroke="#71717a"
                tick={{ fill: "#71717a", fontSize: 12 }}
              />
              <YAxis
                domain={[0, 100]}
                stroke="#71717a"
                tick={{ fill: "#71717a", fontSize: 12 }}
                tickFormatter={(v: number) => `${v}%`}
              />
              <Tooltip content={<LightTooltip />} />
              <Legend wrapperStyle={{ color: "#52525b", fontSize: 12 }} />
              <Line
                type="monotone"
                dataKey="percentage"
                name={t("exam:score_percent", { defaultValue: "Score %" })}
                stroke="#d97706"
                strokeWidth={2}
                dot={{ fill: "#d97706", r: 4 }}
                activeDot={{ r: 6, fill: "#f59e0b" }}
              />
              <Line
                type="monotone"
                dataKey={() => 100}
                name={t("exam:max_possible", { defaultValue: "Max Possible" })}
                stroke="#a1a1aa"
                strokeWidth={1}
                strokeDasharray="5 5"
                dot={false}
                activeDot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="py-8 text-center text-sm text-zinc-500">
            {t("exam:no_trend_data", {
              defaultValue: "Not enough data for trend chart",
            })}
          </p>
        )}
      </ChartPanel>

      <ChartPanel
        title={t("exam:subject_perf_title", {
          defaultValue: "Performance by Subject",
        })}
      >
        {subject_performance.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={subject_performance}
              margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
              <XAxis
                dataKey="subject"
                stroke="#71717a"
                tick={{ fill: "#71717a", fontSize: 11 }}
                interval={0}
                angle={-15}
                textAnchor="end"
                height={60}
              />
              <YAxis
                stroke="#71717a"
                tick={{ fill: "#71717a", fontSize: 12 }}
              />
              <Tooltip content={<LightTooltip />} />
              <Legend wrapperStyle={{ color: "#52525b", fontSize: 12 }} />
              <Bar
                dataKey="avg_score"
                name={t("exam:avg_score_label", { defaultValue: "Avg Score" })}
                fill="#d97706"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="avg_max"
                name={t("exam:avg_max_label", {
                  defaultValue: "Avg Max Score",
                })}
                fill="#94a3b8"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="py-8 text-center text-sm text-zinc-500">
            {t("exam:no_subject_data", {
              defaultValue: "No subject performance data available",
            })}
          </p>
        )}
      </ChartPanel>
    </Shell>
  );
};

export default ExamAnalytics;
