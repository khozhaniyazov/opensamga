import { useEffect, useState } from "react";
import { apiGet } from "../../lib/api";

/**
 * Session 17 (2026-04-21) — lightweight operational dashboard reading
 * `GET /api/analytics/rag-stats`. No PII: the raw query text is never
 * returned by the backend; this page only shows aggregates (counts,
 * percentiles, subject/book histograms, feedback rollup).
 *
 * Sits at `/dashboard/rag-stats`. Premium-only is not enforced yet — we
 * rely on the backend rate-limit middleware until an explicit admin
 * role lands. Intentional: boss asked for "smoke-test it, ship it".
 */

type Stats = {
  window_hours: number;
  totals: {
    n: number;
    empty_rate: number;
    error_rate: number;
    rerank_rate: number;
    avg_query_len: number;
  };
  latency_ms: Record<string, number | null>;
  subjects: Array<{ subject: string; n: number }>;
  top_books: Array<{ book_id: number; n: number }>;
  feedback: { n: number; up: number; down: number; cleared: number };
};

const WINDOWS: Array<{ label: string; hours: number }> = [
  { label: "1h", hours: 1 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
  { label: "30d", hours: 720 },
];

function fmtMs(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  if (v < 1) return v.toFixed(2);
  return `${Math.round(v)} ms`;
}

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

export function RagStatsPage() {
  const [hours, setHours] = useState<number>(168);
  const [data, setData] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(h: number) {
    setLoading(true);
    setErr(null);
    try {
      const s = await apiGet<Stats>(`/analytics/rag-stats?window_hours=${h}`);
      setData(s);
    } catch (e: any) {
      setErr(e?.message || "Failed to load stats");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(hours);
  }, [hours]);

  const lat = data?.latency_ms || {};

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">RAG observability</h1>
          <p className="text-sm text-zinc-500">
            Rolling stats from <code>rag_query_log</code> +{" "}
            <code>chat_feedback</code>. No query text is exposed.
          </p>
        </div>
        <div className="flex gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w.hours}
              type="button"
              onClick={() => setHours(w.hours)}
              className={`px-3 py-1.5 text-sm rounded-md border ${
                hours === w.hours
                  ? "bg-zinc-900 text-white border-zinc-900"
                  : "bg-white text-zinc-700 border-zinc-200 hover:border-zinc-400"
              }`}
            >
              {w.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void load(hours)}
            disabled={loading}
            className="ml-2 px-3 py-1.5 text-sm rounded-md border border-zinc-200 hover:border-zinc-400 disabled:opacity-50"
          >
            {loading ? "…" : "Refresh"}
          </button>
        </div>
      </header>

      {err && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      {data && (
        <>
          <section className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card label="Queries" value={String(data.totals.n)} />
            <Card label="Empty rate" value={fmtPct(data.totals.empty_rate)} />
            <Card label="Error rate" value={fmtPct(data.totals.error_rate)} />
            <Card label="Rerank rate" value={fmtPct(data.totals.rerank_rate)} />
            <Card
              label="Avg query len"
              value={`${Math.round(data.totals.avg_query_len)} ch`}
            />
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <h2 className="font-medium mb-3">Latency (ms)</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <LatCell label="Total p50" v={lat.total_p50} />
              <LatCell label="Total p95" v={lat.total_p95} />
              <LatCell label="Embed p50" v={lat.emb_p50} />
              <LatCell label="Embed p95" v={lat.emb_p95} />
              <LatCell label="Search p50" v={lat.search_p50} />
              <LatCell label="Search p95" v={lat.search_p95} />
              <LatCell label="Rerank p50" v={lat.rerank_p50} />
              <LatCell label="Rerank p95" v={lat.rerank_p95} />
            </div>
          </section>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-lg border border-zinc-200 bg-white p-4">
              <h2 className="font-medium mb-3">Subjects</h2>
              <Histogram
                rows={data.subjects.map((s) => ({ k: s.subject, v: s.n }))}
              />
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white p-4">
              <h2 className="font-medium mb-3">Top books (top-1 wins)</h2>
              <Histogram
                rows={data.top_books.map((b) => ({
                  k: `#${b.book_id}`,
                  v: b.n,
                }))}
              />
            </div>
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <h2 className="font-medium mb-3">User feedback</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Card label="Total" value={String(data.feedback.n)} />
              <Card label="Up" value={String(data.feedback.up)} tone="up" />
              <Card
                label="Down"
                value={String(data.feedback.down)}
                tone="down"
              />
              <Card label="Cleared" value={String(data.feedback.cleared)} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Card({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
}) {
  const toneClass =
    tone === "up"
      ? "text-emerald-600"
      : tone === "down"
        ? "text-red-600"
        : "text-zinc-900";
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3">
      <div className="text-xs uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className={`text-xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function LatCell({
  label,
  v,
}: {
  label: string;
  v: number | null | undefined;
}) {
  return (
    <div>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-base font-medium">{fmtMs(v)}</div>
    </div>
  );
}

function Histogram({ rows }: { rows: Array<{ k: string; v: number }> }) {
  if (!rows.length) {
    return (
      <div className="text-sm text-zinc-500 italic">No data in window.</div>
    );
  }
  const max = Math.max(...rows.map((r) => r.v));
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.k} className="flex items-center gap-2 text-sm">
          <div className="w-32 truncate text-zinc-700">{r.k}</div>
          <div className="flex-1 bg-zinc-100 rounded-sm h-4 relative overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-zinc-700"
              style={{ width: `${(100 * r.v) / Math.max(max, 1)}%` }}
            />
          </div>
          <div className="w-10 text-right tabular-nums text-zinc-600">
            {r.v}
          </div>
        </div>
      ))}
    </div>
  );
}

export default RagStatsPage;
