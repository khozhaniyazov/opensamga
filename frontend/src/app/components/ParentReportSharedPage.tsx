/**
 * ParentReportSharedPage.tsx
 * --------------------------
 *
 * v3.27 — public, no-auth landing for the parent-facing share URL
 * (`/parent-report/:token`). Fetches the sanitized JSON payload from
 * `GET /api/parent-report/view/:token` and renders it inline.
 *
 * The same data is also served as printable HTML at
 * `GET /api/parent-report/view/:token.html` and PDF at
 * `GET /api/parent-report/view/:token.pdf`. We expose both as
 * "Print / Download PDF" buttons.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { API_BASE, apiGet } from "../lib/api";
import type { ParentReportPayload } from "./dashboard/parentReportModel";

export default function ParentReportSharedPage() {
  const { token = "" } = useParams<{ token: string }>();
  const [search] = useSearchParams();
  const lang = search.get("lang") === "kz" ? "kz" : "ru";

  const [payload, setPayload] = useState<ParentReportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setPayload(null);
    apiGet<ParentReportPayload>(
      `/parent-report/view/${encodeURIComponent(token)}?lang=${lang}`,
      false,
    )
      .then((p) => {
        if (!cancelled) {
          setPayload(p);
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
  }, [token, lang]);

  const htmlUrl = useMemo(
    () =>
      `${API_BASE}/parent-report/view/${encodeURIComponent(token)}.html?lang=${lang}`,
    [token, lang],
  );
  const pdfUrl = useMemo(
    () =>
      `${API_BASE}/parent-report/view/${encodeURIComponent(token)}.pdf?lang=${lang}`,
    [token, lang],
  );

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold mb-2">
            {lang === "kz" ? "Сілтеме қолжетімсіз" : "Ссылка недоступна"}
          </h1>
          <p className="text-sm text-zinc-600">
            {lang === "kz"
              ? "Сілтеменің мерзімі өтіп кеткен немесе қолжетімсіз."
              : "Срок ссылки истёк или ссылка отозвана."}
          </p>
        </div>
      </main>
    );
  }

  if (!payload) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-zinc-500">…</p>
      </main>
    );
  }

  const s = payload.strings;

  return (
    <main className="min-h-screen bg-white text-zinc-900 px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="border-b border-zinc-200 pb-3">
          <h1 className="text-2xl font-semibold">{s.title}</h1>
          <p className="text-sm text-zinc-500">{s.subtitle}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <a
              href={htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded border border-zinc-300 px-2 py-1"
            >
              {lang === "kz" ? "Басып шығаруға дайын" : "Версия для печати"}
            </a>
            <a
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded border border-zinc-300 px-2 py-1"
            >
              PDF
            </a>
          </div>
        </header>

        <section>
          <p className="text-sm">
            <strong>{s.student}:</strong> {payload.student.first_name}
            {payload.student.grade
              ? ` · ${payload.student.grade} ${s.grade}`
              : ""}
          </p>
          {payload.current_score !== null ? (
            <p className="text-sm mt-1">
              <strong>{s.current_score}:</strong> {payload.current_score}
            </p>
          ) : (
            <p className="text-sm mt-1 italic text-zinc-500">
              {s.score_unknown}
            </p>
          )}
        </section>

        <section>
          <h2 className="text-base font-semibold mb-2">{s.recent_exams}</h2>
          {payload.exam_attempts.length === 0 ? (
            <p className="text-sm italic text-zinc-500">{s.exam_no_history}</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left">
                  <th className="border-b py-1 pr-2">{s.subjects}</th>
                  <th className="border-b py-1 pr-2">{s.score}</th>
                  <th className="border-b py-1">{s.date}</th>
                </tr>
              </thead>
              <tbody>
                {payload.exam_attempts.map((row, idx) => (
                  <tr key={idx}>
                    <td className="py-1 pr-2">{row.subjects.join(", ")}</td>
                    <td className="py-1 pr-2">
                      {row.score} / {row.max_score}
                    </td>
                    <td className="py-1">
                      {row.submitted_at?.slice(0, 10) ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h2 className="text-base font-semibold mb-2">
            {s.target_universities}
          </h2>
          {payload.target_universities.length === 0 ? (
            <p className="text-sm italic text-zinc-500">{s.no_targets}</p>
          ) : (
            <ul className="text-sm list-disc pl-5">
              {payload.target_universities.map((u) => (
                <li key={u.id}>
                  <strong>{u.name}</strong>
                  {u.city ? ` — ${u.city}` : ""}
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="text-xs text-zinc-500 border-t border-zinc-200 pt-3">
          {s.footer_disclaimer}
        </footer>
      </div>
    </main>
  );
}
