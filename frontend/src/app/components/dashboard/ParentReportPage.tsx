/**
 * ParentReportPage.tsx
 * --------------------
 *
 * v3.27 — Student-side mint / list / revoke UI for parent-report
 * share tokens. Mounted at `/dashboard/parent-report`.
 *
 * The parent never lands here. They get a `${origin}/parent-report/<token>`
 * URL out-of-band (copy-paste, WhatsApp, etc.) and that route is
 * served by `ParentReportSharedPage.tsx`.
 */

import { useCallback, useEffect, useState } from "react";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { apiDelete, apiGet, apiPost } from "../../lib/api";
import { useLang } from "../LanguageContext";
import {
  PARENT_REPORT_DEFAULT_TTL_DAYS,
  PARENT_REPORT_MAX_TTL_DAYS,
  clampTtlDays,
  formatTokenDate,
  isTokenStillActive,
  parentReportShareUrl,
  type ParentReportTokenSummary,
} from "./parentReportModel";

type CopyState = Record<number, "idle" | "copied">;

const STR = {
  ru: {
    title: "Отчёт для родителей",
    intro:
      "Создайте ссылку, по которой родитель сможет открыть короткий отчёт о вашей подготовке к ЕНТ. Имя в отчёте — только имя, без фамилии и контактов.",
    create: "Создать новую ссылку",
    ttl_label: "Срок действия (дней)",
    creating: "Создаём...",
    no_tokens: "Активных ссылок пока нет.",
    expires: "Действует до",
    revoked: "Отозвано",
    copy: "Скопировать ссылку",
    copied: "Скопировано!",
    revoke: "Отозвать",
    accesses: "Открытий",
    open: "Открыть отчёт",
    errLoadPrefix: "Не удалось загрузить ссылки",
    errCreatePrefix: "Не удалось создать ссылку",
    errRevokePrefix: "Не удалось отозвать ссылку",
    errFallback: "повторите попытку позже",
  },
  kz: {
    title: "Ата-аналарға арналған есеп",
    intro:
      "Сілтеме жасаңыз — ата-анаңыз қысқа есепті аша алады. Есепте тек атыңыз көрсетіледі, тегі мен байланыс деректері жоқ.",
    create: "Жаңа сілтеме жасау",
    ttl_label: "Мерзімі (күн)",
    creating: "Жасалуда...",
    no_tokens: "Әзірге белсенді сілтеме жоқ.",
    expires: "Дейін жарамды",
    revoked: "Жойылды",
    copy: "Сілтемені көшіру",
    copied: "Көшірілді!",
    revoke: "Жою",
    accesses: "Ашылған саны",
    open: "Есепті ашу",
    errLoadPrefix: "Сілтемелерді жүктеу мүмкін болмады",
    errCreatePrefix: "Сілтеме жасау мүмкін болмады",
    errRevokePrefix: "Сілтемені жою мүмкін болмады",
    errFallback: "сәлден кейін қайталап көріңіз",
  },
} as const;

/**
 * v3.59 — keep server-error detail off the page when it isn't safe
 * to surface (raw HTML/long stack/empty body). The status code is
 * always shown; everything else is best-effort.
 */
export function describeApiError(
  err: unknown,
  fallback: string,
): { code: string; detail: string } {
  if (err && typeof err === "object" && "status" in err) {
    const status = Number((err as { status?: unknown }).status) || 0;
    const message =
      (err as { message?: unknown }).message instanceof String ||
      typeof (err as { message?: unknown }).message === "string"
        ? String((err as { message?: string }).message ?? "")
        : "";
    // Filter unhelpful HTTP-status echoes ("Internal Server Error",
    // "Request failed with status 500"). We already show the code.
    const looksLikeStatusEcho =
      /^(internal\s+server\s+error|bad\s+gateway|service\s+unavailable|gateway\s+timeout|request\s+failed\s+with\s+status\b)/i.test(
        message.trim(),
      );
    const safeDetail =
      message && !looksLikeStatusEcho && message.length <= 200
        ? message
        : fallback;
    return { code: status > 0 ? `HTTP ${status}` : "—", detail: safeDetail };
  }
  if (err instanceof Error && err.message && err.message.length <= 200) {
    return { code: "—", detail: err.message };
  }
  return { code: "—", detail: fallback };
}

export default function ParentReportPage() {
  const { lang } = useLang();
  const s = STR[lang === "kz" ? "kz" : "ru"];
  useDocumentTitle(s.title);

  const [tokens, setTokens] = useState<ParentReportTokenSummary[]>([]);
  const [ttl, setTtl] = useState<number>(PARENT_REPORT_DEFAULT_TTL_DAYS);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copy, setCopy] = useState<CopyState>({});

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const out = await apiGet<{ items: ParentReportTokenSummary[] }>(
        "/parent-report/tokens",
      );
      setTokens(out.items);
    } catch (e) {
      const { code, detail } = describeApiError(e, s.errFallback);
      setError(`${s.errLoadPrefix} (${code}): ${detail}`);
    }
  }, [s]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function onCreate() {
    setCreating(true);
    setError(null);
    try {
      const ttlDays = clampTtlDays(ttl);
      const created = await apiPost<ParentReportTokenSummary>(
        "/parent-report/tokens",
        { ttl_days: ttlDays },
      );
      setTokens((prev) => [created, ...prev]);
    } catch (e) {
      const { code, detail } = describeApiError(e, s.errFallback);
      setError(`${s.errCreatePrefix} (${code}): ${detail}`);
    } finally {
      setCreating(false);
    }
  }

  async function onRevoke(id: number) {
    setError(null);
    try {
      await apiDelete(`/parent-report/tokens/${id}`);
      await refresh();
    } catch (e) {
      const { code, detail } = describeApiError(e, s.errFallback);
      setError(`${s.errRevokePrefix} (${code}): ${detail}`);
    }
  }

  async function onCopy(row: ParentReportTokenSummary) {
    const url = parentReportShareUrl(row.token);
    try {
      await navigator.clipboard.writeText(url);
      setCopy((prev) => ({ ...prev, [row.id]: "copied" }));
      window.setTimeout(() => {
        setCopy((prev) => ({ ...prev, [row.id]: "idle" }));
      }, 2000);
    } catch {
      // Older browsers — silently fall back to a manual select.
      window.prompt(s.copy, url);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{s.title}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{s.intro}</p>
      </header>

      <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="block text-xs text-zinc-500">{s.ttl_label}</span>
            <input
              type="number"
              min={1}
              max={PARENT_REPORT_MAX_TTL_DAYS}
              value={ttl}
              onChange={(e) => setTtl(Number(e.target.value))}
              className="mt-1 w-24 rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 py-1 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={onCreate}
            disabled={creating}
            className="rounded-md bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {creating ? s.creating : s.create}
          </button>
        </div>
        {error && (
          <p
            role="alert"
            className="mt-2 text-xs text-rose-600 dark:text-rose-400"
          >
            {error}
          </p>
        )}
      </section>

      <section>
        {tokens.length === 0 ? (
          <p className="text-sm text-zinc-500">{s.no_tokens}</p>
        ) : (
          <ul className="space-y-3">
            {tokens.map((row) => {
              const active = isTokenStillActive(row);
              return (
                <li
                  key={row.id}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3"
                >
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <code className="rounded bg-zinc-100 dark:bg-zinc-900 px-2 py-1 text-xs">
                      {parentReportShareUrl(row.token)}
                    </code>
                    {active ? (
                      <span className="text-xs text-zinc-500">
                        {s.expires}: {formatTokenDate(row.expires_at)}
                      </span>
                    ) : (
                      <span className="text-xs text-rose-600">{s.revoked}</span>
                    )}
                    <span className="text-xs text-zinc-500">
                      {s.accesses}: {row.access_count}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => onCopy(row)}
                      className="rounded border border-zinc-300 dark:border-zinc-700 px-2 py-1"
                    >
                      {copy[row.id] === "copied" ? s.copied : s.copy}
                    </button>
                    <a
                      href={parentReportShareUrl(row.token)}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded border border-zinc-300 dark:border-zinc-700 px-2 py-1"
                    >
                      {s.open}
                    </a>
                    {active && (
                      <button
                        type="button"
                        onClick={() => onRevoke(row.id)}
                        className="rounded border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-400 px-2 py-1"
                      >
                        {s.revoke}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
