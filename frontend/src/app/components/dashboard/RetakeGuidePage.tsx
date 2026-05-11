/**
 * RetakeGuidePage.tsx — v3.28
 *
 * UNT/ҰБТ Retake Guide. Mounted at `/dashboard/retake-guide`.
 * Read-only consumer of `GET /api/strategy/retake-guide`.
 *
 * Closes Issue #15 AC#6 (last open Strategy Lab pillar).
 */

import { useEffect, useMemo, useState } from "react";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { apiGet } from "../../lib/api";
import { useLang } from "../LanguageContext";
import {
  buildRetakeGuideQuery,
  daysUntil,
  formatRetakeDate,
  formatRetakeFee,
  sessionKindLabel,
  type RetakeGuidePayload,
} from "./retakeGuideModel";

export default function RetakeGuidePage() {
  const { lang } = useLang();
  const [score, setScore] = useState<number | "">("");
  const [weeks, setWeeks] = useState<number>(8);
  const [data, setData] = useState<RetakeGuidePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useDocumentTitle(
    lang === "kz" ? "ҰБТ-ны қайта тапсыру нұсқаулығы" : "Гид по пересдаче ЕНТ",
  );

  const query = useMemo(
    () =>
      buildRetakeGuideQuery({
        lang,
        weeksUntilSession: weeks,
        currentScore: typeof score === "number" ? score : null,
      }),
    [lang, weeks, score],
  );

  useEffect(() => {
    let cancelled = false;
    setError(null);
    apiGet<RetakeGuidePayload>(`/strategy/retake-guide?${query}`, false)
      .then((p) => {
        if (!cancelled) {
          setData(p);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "load_failed");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  if (error) {
    return <div className="p-6 text-sm text-rose-600">{error}</div>;
  }

  if (!data) {
    return <div className="p-6 text-sm text-zinc-500">…</div>;
  }

  const s = data.strings;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{s.title}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{s.subtitle}</p>
      </header>

      {data.sessions_source === "fallback" && (
        <div className="rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800 p-2 text-xs text-amber-900 dark:text-amber-200">
          {s.fallback_warning}
        </div>
      )}

      <section>
        <h2 className="text-base font-semibold mb-2">{s.sessions_heading}</h2>
        {data.sessions.length === 0 ? (
          // v3.71 (B13, 2026-05-02): the bare "—" placeholder left
          // students staring at a blank card with no follow-on copy
          // when both the live testcenter.kz fetch and the local
          // FALLBACK_SESSIONS_2026 cache returned nothing. We now
          // surface the BE-supplied empty-state strings + a link to
          // the official source so the page is still useful.
          <div
            className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-3 text-sm"
            data-testid="retake-guide-sessions-empty"
            role="status"
          >
            <p className="font-medium text-zinc-700 dark:text-zinc-200">
              {s.sessions_empty_title}
            </p>
            <p className="mt-1 text-zinc-600 dark:text-zinc-400">
              {s.sessions_empty_body}
            </p>
            <a
              className="mt-2 inline-block text-amber-700 dark:text-amber-400 underline"
              href="https://testcenter.kz/"
              target="_blank"
              rel="noopener noreferrer"
            >
              {s.sessions_empty_link_label}
            </a>
          </div>
        ) : (
          <ul className="space-y-2">
            {data.sessions.map((session) => {
              const days = daysUntil(session.starts_on);
              return (
                <li
                  key={session.id}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 text-sm"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <strong>{sessionKindLabel(session.kind, s)}</strong>
                    <span className="text-xs text-zinc-500">
                      {Number.isFinite(days) && days >= 0 ? `+${days}d` : ""}
                    </span>
                  </div>
                  <div className="mt-1 grid grid-cols-1 sm:grid-cols-3 gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                    <div>
                      <span className="text-zinc-400">{s.starts_on}: </span>
                      {formatRetakeDate(session.starts_on)}
                    </div>
                    <div>
                      <span className="text-zinc-400">{s.ends_on}: </span>
                      {formatRetakeDate(session.ends_on)}
                    </div>
                    <div>
                      <span className="text-zinc-400">
                        {s.registration_deadline}:{" "}
                      </span>
                      {formatRetakeDate(session.registration_deadline)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
        <h2 className="text-base font-semibold mb-2">{s.policy_heading}</h2>
        <ul className="text-sm space-y-1">
          <li>
            <strong>{s.policy_max_attempts}:</strong>{" "}
            {data.policy.max_attempts_per_cycle}
          </li>
          <li>
            <strong>{s.policy_fee}:</strong>{" "}
            {formatRetakeFee(data.policy.fee_kzt)}
          </li>
        </ul>
        <p className="mt-2 text-xs text-zinc-500">{s.policy_authoritative}</p>
      </section>

      <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
        <h2 className="text-base font-semibold mb-2">{s.estimator_heading}</h2>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="block">
            <span className="block text-xs text-zinc-500">
              {s.estimator_current}
            </span>
            <input
              type="number"
              min={0}
              max={140}
              value={score}
              onChange={(e) => {
                const v = Number(e.target.value);
                setScore(Number.isFinite(v) && v > 0 ? v : "");
              }}
              className="mt-1 w-24 rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 py-1"
            />
          </label>
          <label className="block">
            <span className="block text-xs text-zinc-500">
              {s.estimator_weeks}
            </span>
            <input
              type="number"
              min={0}
              max={52}
              value={weeks}
              onChange={(e) => {
                const v = Number(e.target.value);
                setWeeks(Number.isFinite(v) && v >= 0 ? v : 0);
              }}
              className="mt-1 w-24 rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 py-1"
            />
          </label>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <div className="rounded bg-zinc-100 dark:bg-zinc-900 p-2 text-center">
            <div className="text-xs text-zinc-500">{s.estimator_band_low}</div>
            <div className="text-lg font-semibold">
              +{data.estimator.delta.low}
            </div>
          </div>
          <div className="rounded bg-emerald-100 dark:bg-emerald-950 p-2 text-center">
            <div className="text-xs text-emerald-700 dark:text-emerald-300">
              {s.estimator_band_mid}
            </div>
            <div className="text-lg font-semibold text-emerald-800 dark:text-emerald-200">
              +{data.estimator.delta.mid}
            </div>
          </div>
          <div className="rounded bg-zinc-100 dark:bg-zinc-900 p-2 text-center">
            <div className="text-xs text-zinc-500">{s.estimator_band_high}</div>
            <div className="text-lg font-semibold">
              +{data.estimator.delta.high}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
