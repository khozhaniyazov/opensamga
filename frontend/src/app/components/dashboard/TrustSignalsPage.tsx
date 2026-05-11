import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../../lib/api";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { useLang } from "../LanguageContext";
import {
  DEFAULT_TRUST_SIGNAL_DAYS,
  TRUST_SIGNAL_WINDOWS,
  formatAvg,
  formatCount,
  formatPct,
  redactionTone,
  sortRowsForDisplay,
  validateRollupPayload,
  type TrustSignalRollup,
  type TrustSignalRow,
} from "./trustSignalsModel";

/**
 * v3.15 (chat-UI I2 dashboard, 2026-04-30) — admin trust-signal
 * dashboard. Visualises the per-bucket roll-up published by
 * `GET /api/admin/chat/trust-signal-rollup?days=N`. Closes the
 * Phase I row I2 ("Weekly roll-up dashboard for ops: redactions /
 * hallucinated_citations_dropped / 0-hit consult ratios").
 *
 * All math + formatting lives in `trustSignalsModel.ts` so this
 * component is render-only. Sits at `/dashboard/trust-signals`,
 * gated by `AdminOnlyRoute` from `routes.tsx` — same pattern as
 * `RagStatsPage`.
 */

export function TrustSignalsPage() {
  const { lang } = useLang();
  const [days, setDays] = useState<number>(DEFAULT_TRUST_SIGNAL_DAYS);
  const [data, setData] = useState<TrustSignalRollup | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useDocumentTitle(lang === "kz" ? "Сенім сигналдары" : "Сигналы доверия");

  async function load(d: number) {
    setLoading(true);
    setErr(null);
    try {
      const raw = await apiGet<unknown>(
        `/admin/chat/trust-signal-rollup?days=${d}`,
      );
      setData(validateRollupPayload(raw));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to load rollup";
      setErr(message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(days);
  }, [days]);

  const sortedRows = useMemo(
    () => (data ? sortRowsForDisplay(data.rows) : []),
    [data],
  );

  const t = lang === "kz" ? L_KZ : L_RU;

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t.heading}</h1>
          <p className="text-sm text-zinc-500">{t.subhead}</p>
        </div>
        <div className="flex gap-1">
          {TRUST_SIGNAL_WINDOWS.map((w) => (
            <button
              key={w.days}
              type="button"
              onClick={() => setDays(w.days)}
              className={`px-3 py-1.5 text-sm rounded-md border ${
                days === w.days
                  ? "bg-zinc-900 text-white border-zinc-900"
                  : "bg-white text-zinc-700 border-zinc-200 hover:border-zinc-400"
              }`}
              aria-pressed={days === w.days}
            >
              {w.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void load(days)}
            disabled={loading}
            className="ml-2 px-3 py-1.5 text-sm rounded-md border border-zinc-200 hover:border-zinc-400 disabled:opacity-50"
          >
            {loading ? "…" : t.refresh}
          </button>
        </div>
      </header>

      {err && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {err}
        </div>
      )}

      {data && (
        <>
          <section className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card label={t.totalTurns} value={formatCount(data.totals.turns)} />
            <Card
              label={t.redactionPct}
              value={formatPct(data.totals.redaction_pct)}
              tone={
                redactionTone(data.totals.redaction_pct) === "warn"
                  ? "warn"
                  : undefined
              }
            />
            <Card
              label={t.failedToolPct}
              value={formatPct(data.totals.failed_tool_pct)}
            />
            <Card
              label={t.generalKnowledgePct}
              value={formatPct(data.totals.general_knowledge_pct)}
            />
            <Card
              label={t.sourcedPct}
              value={formatPct(data.totals.sourced_pct)}
            />
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-zinc-600 text-xs uppercase tracking-wide">
                <tr>
                  <Th>{t.colBucket}</Th>
                  <Th align="right">{t.colTurns}</Th>
                  <Th align="right">{t.colRedactPct}</Th>
                  <Th align="right">{t.colAvgRedact}</Th>
                  <Th align="right">{t.colFailedPct}</Th>
                  <Th align="right">{t.colGenKPct}</Th>
                  <Th align="right">{t.colSourcedPct}</Th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="py-6 text-center text-zinc-500 italic"
                    >
                      {t.empty}
                    </td>
                  </tr>
                )}
                {sortedRows.map((row) => (
                  <Row
                    key={row.bucket}
                    row={row}
                    bucketLabel={bucketLabel(row.bucket, lang)}
                  />
                ))}
              </tbody>
            </table>
          </section>

          <p className="text-xs text-zinc-500">
            {t.footer.replace("{days}", String(data.window_days))}
          </p>
        </>
      )}
    </div>
  );
}

function Row({
  row,
  bucketLabel,
}: {
  row: TrustSignalRow;
  bucketLabel: string;
}) {
  const tone = redactionTone(row.redaction_pct);
  return (
    <tr className="border-t border-zinc-100">
      <td className="px-3 py-2 font-medium text-zinc-800">{bucketLabel}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {formatCount(row.turns)}
      </td>
      <td
        className={`px-3 py-2 text-right tabular-nums ${
          tone === "warn" ? "text-red-700 font-medium" : ""
        }`}
      >
        {formatPct(row.redaction_pct)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {formatAvg(row.avg_redactions)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {formatPct(row.failed_tool_pct)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {formatPct(row.general_knowledge_pct)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {formatPct(row.sourced_pct)}
      </td>
    </tr>
  );
}

function Card({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  const toneClass = tone === "warn" ? "text-red-600" : "text-zinc-900";
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3">
      <div className="text-xs uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className={`text-xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={`px-3 py-2 ${align === "right" ? "text-right" : "text-left"}`}
    >
      {children}
    </th>
  );
}

function bucketLabel(bucket: string, lang: "ru" | "kz"): string {
  const label = lang === "kz" ? BUCKET_KZ : BUCKET_RU;
  return label[bucket] ?? bucket;
}

const BUCKET_RU: Record<string, string> = {
  agent: "Агент",
  legacy: "Legacy",
  unknown: "Неизвестно",
};
const BUCKET_KZ: Record<string, string> = {
  agent: "Агент",
  legacy: "Legacy",
  unknown: "Белгісіз",
};

const L_RU = {
  heading: "Сигналы доверия",
  subhead:
    "Сводка по записанной метаданным надёжности ассистента. Обновляется по запросу.",
  refresh: "Обновить",
  totalTurns: "Всего ответов",
  redactionPct: "% с редакциями",
  failedToolPct: "% с ошибками инструментов",
  generalKnowledgePct: "% «общее знание»",
  sourcedPct: "% с источниками",
  colBucket: "Поток",
  colTurns: "Ответы",
  colRedactPct: "% редакций",
  colAvgRedact: "Сред. редакций",
  colFailedPct: "% ошибок tool",
  colGenKPct: "% общ. знания",
  colSourcedPct: "% с источниками",
  empty: "Нет данных за выбранный период.",
  footer:
    "Окно: последние {days} дней. Все доли пересчитаны от ответов в потоке.",
};

const L_KZ = {
  heading: "Сенім сигналдары",
  subhead:
    "Ассистент жауаптарының метадеректері бойынша қысқа есеп. Сұраныс бойынша жаңарады.",
  refresh: "Жаңарту",
  totalTurns: "Барлық жауап",
  redactionPct: "Редакциясы бар %",
  failedToolPct: "Tool қателері бар %",
  generalKnowledgePct: "Жалпы білім %",
  sourcedPct: "Дереккөзбен %",
  colBucket: "Ағын",
  colTurns: "Жауап",
  colRedactPct: "Редакция %",
  colAvgRedact: "Орт. редакция",
  colFailedPct: "Tool қате %",
  colGenKPct: "Жалпы білім %",
  colSourcedPct: "Дереккөз %",
  empty: "Таңдалған кезеңде дерек жоқ.",
  footer:
    "Терезе: соңғы {days} күн. Барлық пайыздар ағын ішіндегі жауаптардан алынады.",
};

export default TrustSignalsPage;
