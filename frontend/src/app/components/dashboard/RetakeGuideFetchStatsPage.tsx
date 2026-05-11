import React, { useCallback, useEffect, useState } from "react";

import { apiGet } from "../../lib/api";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { useLang } from "../LanguageContext";
import {
  classifyFetchStats,
  humanizeEpochSeconds,
  validateFetchStatsPayload,
  type FetchStatsTone,
  type RetakeGuideFetchStatsPayload,
} from "./retakeGuideFetchStatsModel";

/**
 * v3.35 (2026-05-01) — admin retake-guide fetch-stats page.
 * Renders the payload published by
 * `GET /api/admin/retake-guide/fetch-stats` (added in v3.34) so an
 * operator can confirm whether the live testing.kz fetch is
 * working, which URL is in play (so the v3.33 env override is
 * observable through the UI), and what the most recent failure
 * mode was.
 *
 * All math + formatting + payload validation lives in
 * `retakeGuideFetchStatsModel.ts` so this component is render-only.
 * Sits at `/dashboard/retake-guide-fetch-stats`, gated by
 * `AdminOnlyRoute` from `routes.tsx` — same pattern as
 * `TrustSignalsPage` and `RagStatsPage`.
 */

export function RetakeGuideFetchStatsPage() {
  const { lang } = useLang();
  const [data, setData] = useState<RetakeGuideFetchStatsPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Capture "now" on each refresh so humanize* readings are consistent
  // across the entire render frame (don't drift between cards).
  const [nowSec, setNowSec] = useState<number>(() =>
    Math.floor(Date.now() / 1000),
  );

  useDocumentTitle(
    lang === "kz" ? "ҰБТ кестесін жүктеу" : "Загрузка расписания ҰБТ",
  );

  // v3.50 (2026-05-02): pulled `t` up above `load` so the catch
  // block can use a localized fallback + prefix. KZ admins were
  // previously seeing raw English (`Failed to load stats`) when
  // a thrown non-Error value hit the catch.
  const t = lang === "kz" ? L_KZ : L_RU;

  // v4.20 (2026-05-08): wrapped in useCallback so the useEffect
  // below can list it as a dependency without re-running on every
  // render. Closes the lone `react-hooks/exhaustive-deps` lint
  // warning that had been tolerated since v3.50. Dependencies
  // are the two localized strings actually read in the catch arm
  // — `t` itself is a freshly-allocated object per render, so
  // depending on `t` would defeat the memoization; we depend
  // only on the fields we use.
  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const raw = await apiGet<unknown>("/admin/retake-guide/fetch-stats");
      setData(validateFetchStatsPayload(raw));
      setNowSec(Math.floor(Date.now() / 1000));
    } catch (e: unknown) {
      // Validation-error messages from validateFetchStatsPayload
      // stay verbose-English by intent — operators want technical
      // detail ("missing schedule_url") more than they want a
      // translated generic "ошибка". The prefix gives them context.
      const detail = e instanceof Error ? e.message : t.errFallback;
      setErr(`${t.errPrefix}: ${detail}`);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [t.errFallback, t.errPrefix]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t.heading}</h1>
          <p className="text-sm text-zinc-500">{t.subhead}</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="px-3 py-1.5 text-sm rounded-md border border-zinc-200 hover:border-zinc-400 disabled:opacity-50"
        >
          {loading ? "…" : t.refresh}
        </button>
      </header>

      {err && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {err}
        </div>
      )}

      {/*
        v3.50 (2026-05-02): empty-state branch. Pre-v3.50 first
        paint between mount and fetch return showed only the
        header + Refresh button — no skeleton, no message.
        After fetch return: data and !err, so we render the
        normal banner + cards. Loading: the button shows "…".
        After err: the alert above renders. The empty branch
        (data === null && !err && !loading) is now an explicit
        "loading-or-just-mounted" placeholder with `data-state`
        attribute for tests.
      */}
      {!data && !err && (
        // No `role="status"` here on purpose — the StatusBanner
        // uses that role and tests reach it via findByRole. We
        // tag this element via `data-testid` instead so it
        // doesn't compete for the same role lookup.
        <div
          data-testid="retake-guide-loading"
          data-state="loading"
          aria-busy={loading || undefined}
          className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600"
        >
          {t.loading}
        </div>
      )}

      {data && (
        <>
          <StatusBanner tone={classifyFetchStats(data.stats, nowSec)} t={t} />

          <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card
              label={t.successCount}
              value={String(data.stats.success_count)}
            />
            <Card
              label={t.failureCount}
              value={String(data.stats.failure_count)}
              tone={data.stats.failure_count > 0 ? "warn" : undefined}
            />
            <Card
              label={t.lastSuccess}
              value={humanizeEpochSeconds(data.stats.last_success_at, nowSec)}
            />
            <Card
              label={t.lastFailure}
              value={humanizeEpochSeconds(data.stats.last_failure_at, nowSec)}
            />
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-4 space-y-3">
            <Row label={t.scheduleUrl} value={data.schedule_url} mono />
            <Row
              label={t.lastFailureReason}
              value={data.stats.last_failure_reason ?? "—"}
              mono
            />
          </section>

          <p className="text-xs text-zinc-500">{t.footer}</p>
        </>
      )}
    </div>
  );
}

function StatusBanner({ tone, t }: { tone: FetchStatsTone; t: typeof L_RU }) {
  const map: Record<
    FetchStatsTone,
    { label: string; bg: string; border: string; fg: string }
  > = {
    ok: {
      label: t.toneOk,
      bg: "bg-emerald-50",
      border: "border-emerald-200",
      fg: "text-emerald-700",
    },
    warn: {
      label: t.toneWarn,
      bg: "bg-amber-50",
      border: "border-amber-200",
      fg: "text-amber-700",
    },
    dead: {
      label: t.toneDead,
      bg: "bg-red-50",
      border: "border-red-200",
      fg: "text-red-700",
    },
    idle: {
      label: t.toneIdle,
      bg: "bg-zinc-50",
      border: "border-zinc-200",
      fg: "text-zinc-700",
    },
  };
  const c = map[tone];
  return (
    <div
      role="status"
      data-tone={tone}
      className={`rounded-md border px-3 py-2 text-sm ${c.bg} ${c.border} ${c.fg}`}
    >
      {c.label}
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

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-3 text-sm">
      <span className="w-44 shrink-0 text-zinc-500">{label}</span>
      <span
        className={mono ? "font-mono text-zinc-900 break-all" : "text-zinc-900"}
      >
        {value}
      </span>
    </div>
  );
}

const L_RU = {
  heading: "Загрузка расписания ҰБТ",
  subhead:
    "Состояние фоновой загрузки расписания с testcenter.kz. Счётчики на воркер; в мульти-воркер деплое каждый показывает свою долю.",
  refresh: "Обновить",
  successCount: "Успехов",
  failureCount: "Ошибок",
  lastSuccess: "Последний успех",
  lastFailure: "Последняя ошибка",
  scheduleUrl: "Активный URL",
  lastFailureReason: "Причина последней ошибки",
  toneOk: "Загрузка работает: последний успех в течение 24 часов.",
  toneWarn:
    "Внимание: давно не было успеха или ошибок больше, чем успехов. Проверьте URL.",
  toneDead:
    "Загрузка не работает: только ошибки. Проверьте TESTING_KZ_SCHEDULE_URL.",
  toneIdle:
    "Воркер ещё не пытался: счётчики пустые. Это нормально для свежего деплоя.",
  footer:
    "Счётчики хранятся в процессе. Перезапуск воркера их обнуляет. URL читается из переменной окружения TESTING_KZ_SCHEDULE_URL при импорте модуля.",
  // v3.50 (2026-05-02): error-banner + empty-state strings.
  loading: "Загрузка статистики…",
  errPrefix: "Не удалось загрузить статистику",
  errFallback: "Неизвестная ошибка",
};

const L_KZ = {
  heading: "ҰБТ кестесін жүктеу",
  subhead:
    "testcenter.kz сайтынан кестені фондық жүктеу күйі. Есепше воркерге қатысты; көп-воркер деплойда әрқайсысы өз үлесін көрсетеді.",
  refresh: "Жаңарту",
  successCount: "Сәттіліктер",
  failureCount: "Қателер",
  lastSuccess: "Соңғы сәттілік",
  lastFailure: "Соңғы қате",
  scheduleUrl: "Белсенді URL",
  lastFailureReason: "Соңғы қатенің себебі",
  toneOk: "Жүктеу жұмыс істейді: соңғы сәттілік 24 сағат ішінде.",
  toneWarn:
    "Назар аударыңыз: ұзақ уақыт сәттілік болмады немесе қателер сәттіліктерден көп. URL тексеріңіз.",
  toneDead:
    "Жүктеу жұмыс істемейді: тек қателер. TESTING_KZ_SCHEDULE_URL тексеріңіз.",
  toneIdle:
    "Воркер әлі әрекет жасаған жоқ: есепше бос. Бұл жаңа деплой үшін қалыпты жағдай.",
  footer:
    "Есепшелер процесте сақталады. Воркер қайта іске қосылғанда нөлге айналады. URL модуль импортында TESTING_KZ_SCHEDULE_URL орта айнымалысынан оқылады.",
  // v3.50 (2026-05-02): error-banner + empty-state strings.
  loading: "Статистика жүктелуде…",
  errPrefix: "Статистиканы жүктеу мүмкін болмады",
  errFallback: "Белгісіз қате",
};

export default RetakeGuideFetchStatsPage;
