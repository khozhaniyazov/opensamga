/**
 * Memory tool cards — premium redesign for s26 phase 3.
 *
 * Six cards (UserProfile, RecentMistakes, RecentTestAttempts,
 * PracticeSummary, DreamUniProgress, ChatSummary) re-themed under the
 * new ToolCardShell so they share a single design language with the
 * rest of the chat surface (rounded-2xl, layered shadow, accent
 * header band, semantic tone palette).
 *
 * Key visual upgrades over s25:
 *   - PracticeSummary: per-row accuracy bar instead of just colored
 *     percent text. Bars are tone-graded.
 *   - DreamUniProgress: header shifts from cryptic `Δ` column to
 *     a properly labeled "Запас" with a +/− chip. Mini-bar visualises
 *     `score vs threshold` per row.
 *   - RecentMistakes: per-subject color tag, lucide Check icon
 *     replaces the inline emoji.
 *   - UserProfile: avatar + chip cluster instead of stacked Rows.
 *   - ChatSummary: each row is a button — clicking opens that thread
 *     via the global `samga:open-thread` event (ThreadRail listens).
 *   - RecentTestAttempts: emerald/amber/rose color band per row by %.
 */

import {
  AlertTriangle,
  Check,
  ListChecks,
  MessagesSquare,
  Sparkles,
  Target,
  TrendingDown,
  User2,
} from "lucide-react";
import { ToolCardShell, ProgressBar } from "./CardShell";
import type {
  UserProfileData,
  RecentMistakesData,
  RecentTestAttemptsData,
  PracticeSummaryData,
  DreamUniProgressData,
  ChatSummaryData,
} from "./types";
import { useLang } from "../../../LanguageContext";
import { subjectLabel } from "../../../../lib/subjectLabels";
import { chatSummaryThreadAriaLabel } from "../chatSummaryThreadAria";

// ---- shared helpers --------------------------------------------------

function Chip({
  children,
  tone = "zinc",
}: {
  children: React.ReactNode;
  tone?: "zinc" | "amber" | "emerald" | "rose" | "sky" | "violet";
}) {
  const c = {
    zinc: "bg-zinc-100 text-zinc-700",
    amber: "bg-amber-50 text-amber-700",
    emerald: "bg-emerald-50 text-emerald-700",
    rose: "bg-rose-50 text-rose-700",
    sky: "bg-sky-50 text-sky-700",
    violet: "bg-violet-50 text-violet-700",
  }[tone];
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium " +
        c
      }
    >
      {children}
    </span>
  );
}

function pctTone(p: number): "emerald" | "amber" | "rose" {
  if (p >= 70) return "emerald";
  if (p >= 50) return "amber";
  return "rose";
}

// ---- 1. user profile -------------------------------------------------

export function UserProfileCard({ data }: { data: UserProfileData }) {
  const { lang } = useLang();
  const subjects = data.chosen_subjects ?? [];
  const majors = data.target_majors ?? [];
  const unis = data.target_universities ?? [];
  const initials =
    (data.name || "?")
      .split(/\s+/)
      .map((s) => s.charAt(0))
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";

  return (
    <ToolCardShell
      title="Профиль ученика"
      icon={<User2 size={14} />}
      tone="sky"
    >
      <div className="flex items-start gap-3">
        <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-100 to-sky-200/70 text-sky-800 ring-1 ring-sky-200/60 text-[13px] font-bold">
          {initials}
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[14px] font-semibold text-zinc-900">
              {data.name ?? "—"}
            </span>
            {data.current_grade != null && (
              <span className="text-[12px] text-zinc-500">
                {data.current_grade} класс
              </span>
            )}
            {data.subscription_tier && (
              <Chip tone="amber">{data.subscription_tier}</Chip>
            )}
          </div>
          {subjects.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[10.5px] uppercase tracking-wide text-zinc-400">
                {lang === "kz" ? "бейін:" : "профиль:"}
              </span>
              {subjects.map((s) => (
                <Chip key={s} tone="sky">
                  {subjectLabel(s, lang) || s}
                </Chip>
              ))}
            </div>
          )}
          {majors.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[10.5px] uppercase tracking-wide text-zinc-400">
                {lang === "kz" ? "мамандықтар:" : "майоры:"}
              </span>
              {majors.map((m) => (
                <Chip key={m} tone="violet">
                  {m}
                </Chip>
              ))}
            </div>
          )}
          {unis.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[10.5px] uppercase tracking-wide text-zinc-400">
                {lang === "kz" ? "мақсат:" : "цели:"}
              </span>
              {unis.map((u) => (
                <Chip key={u} tone="emerald">
                  {u}
                </Chip>
              ))}
            </div>
          )}
        </div>
      </div>
    </ToolCardShell>
  );
}

// ---- 2. recent mistakes ---------------------------------------------

export function RecentMistakesCard({ data }: { data: RecentMistakesData }) {
  const { lang } = useLang();
  // s26 phase 6 (E4): hide "Pending analysis" placeholder — backend writes it
  // on every new MistakeReview row but only updates it on-demand via
  // POST /mistakes/analyze. Until that lands, dropping the literal makes the
  // card less noisy; a real diagnosis still renders unchanged.
  return (
    <ToolCardShell
      title={lang === "kz" ? "Соңғы қателер" : "Недавние ошибки"}
      meta={`${data.count}`}
      icon={<AlertTriangle size={14} />}
      tone="rose"
    >
      {data.items.length === 0 ? (
        <div className="text-[12.5px] italic text-zinc-500">
          {lang === "kz"
            ? "Қателер тіркелмеген — тамаша!"
            : "Ошибок не зафиксировано — отлично!"}
        </div>
      ) : (
        <ul className="space-y-1.5">
          {data.items.map((m) => (
            <li
              key={m.id}
              className="rounded-lg border border-zinc-200/70 bg-zinc-50/50 px-3 py-2"
            >
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                {m.subject && (
                  <Chip tone="sky">
                    {subjectLabel(m.subject, lang) || m.subject}
                  </Chip>
                )}
                {m.topic_tag && m.topic_tag !== m.subject && (
                  <Chip tone="zinc">
                    {subjectLabel(m.topic_tag, lang) || m.topic_tag}
                  </Chip>
                )}
                {m.is_resolved && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                    <Check size={11} />
                    {lang === "kz" ? "талданды" : "разобрано"}
                  </span>
                )}
              </div>
              <div className="text-[13px]">
                <span className="rounded bg-rose-50 px-1 text-rose-600 line-through">
                  {m.user_answer}
                </span>
                <span className="mx-1 text-zinc-400">→</span>
                <span className="rounded bg-emerald-50 px-1 text-emerald-700 font-semibold">
                  {m.correct_answer}
                </span>
              </div>
              {m.diagnosis && m.diagnosis !== "Pending analysis" && (
                <div className="mt-1 text-[11.5px] italic text-zinc-500">
                  {m.diagnosis}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </ToolCardShell>
  );
}

// ---- 3. recent test attempts ----------------------------------------

export function RecentTestAttemptsCard({
  data,
}: {
  data: RecentTestAttemptsData;
}) {
  const { lang } = useLang();
  return (
    <ToolCardShell
      title={lang === "kz" ? "Соңғы сынақтар" : "Последние пробники"}
      meta={`${data.count}`}
      icon={<ListChecks size={14} />}
      tone="violet"
    >
      {data.attempts.length === 0 ? (
        <div className="text-[12.5px] italic text-zinc-500">
          {lang === "kz" ? "Әзірге сынақтар жоқ." : "Пока нет пробников."}
        </div>
      ) : (
        <ul className="space-y-1.5">
          {data.attempts.map((a) => {
            const pct = a.percent ?? null;
            const tone = pct != null ? pctTone(pct) : null;
            const ringTone =
              tone === "emerald"
                ? "ring-emerald-200/70 bg-emerald-50/40"
                : tone === "amber"
                  ? "ring-amber-200/70 bg-amber-50/40"
                  : tone === "rose"
                    ? "ring-rose-200/70 bg-rose-50/40"
                    : "ring-zinc-200/60 bg-zinc-50/40";
            return (
              <li
                key={a.id}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 ring-1 ${ringTone}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium text-zinc-800 truncate">
                    {(a.subjects ?? [])
                      .map((s) => subjectLabel(s, lang) || s)
                      .join(" · ") || "—"}
                  </div>
                  <div className="text-[10.5px] text-zinc-500 tabular-nums">
                    {a.submitted_at ? a.submitted_at.slice(0, 10) : "—"}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[13.5px] font-semibold tabular-nums text-zinc-900">
                    {a.score ?? "—"}
                    {a.max_score ? (
                      <span className="text-zinc-400 font-normal">
                        /{a.max_score}
                      </span>
                    ) : null}
                  </div>
                  {pct != null && (
                    <div
                      className={
                        "text-[11px] font-medium tabular-nums " +
                        (tone === "emerald"
                          ? "text-emerald-600"
                          : tone === "amber"
                            ? "text-amber-600"
                            : "text-rose-600")
                      }
                    >
                      {pct}%
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </ToolCardShell>
  );
}

// ---- 4. practice summary --------------------------------------------

export function PracticeSummaryCard({ data }: { data: PracticeSummaryData }) {
  const { lang } = useLang();
  const titleRu = `Слабые темы · ${data.window_days ?? "—"} дн`;
  const titleKz = `Әлсіз тақырыптар · ${data.window_days ?? "—"} күн`;
  const metaRu = `сессий: ${data.session_count ?? 0}`;
  const metaKz = `сессия: ${data.session_count ?? 0}`;
  return (
    <ToolCardShell
      title={lang === "kz" ? titleKz : titleRu}
      meta={lang === "kz" ? metaKz : metaRu}
      icon={<TrendingDown size={14} />}
      tone="amber"
    >
      {data.weakest.length === 0 ? (
        <div className="text-[12.5px] italic text-zinc-500">
          {lang === "kz"
            ? "Әзірге деректер жеткіліксіз. 2–3 жаттығудан өтсеңіз — әлсіз тақырыптарды көрсетем."
            : "Пока недостаточно данных. Пройдите 2–3 практики и я смогу подсветить слабые темы."}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {data.weakest.map((w) => {
            const pct = w.accuracy_pct ?? 0;
            const tone = pctTone(pct);
            const toneText =
              tone === "emerald"
                ? "text-emerald-600"
                : tone === "amber"
                  ? "text-amber-600"
                  : "text-rose-600";
            return (
              <li key={w.subject ?? Math.random()} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] font-medium text-zinc-900 truncate">
                    {w.subject
                      ? subjectLabel(w.subject, lang) || w.subject
                      : "—"}
                  </span>
                  <span className="flex items-baseline gap-2">
                    <span className="text-[10.5px] text-zinc-400 tabular-nums">
                      {lang === "kz"
                        ? `${w.answered ?? 0} сұр · ${w.sessions ?? 0} сессия`
                        : `${w.answered ?? 0} вопр · ${w.sessions ?? 0} сессий`}
                    </span>
                    <span
                      className={`text-[13px] font-semibold tabular-nums ${toneText}`}
                    >
                      {pct}%
                    </span>
                  </span>
                </div>
                <ProgressBar pct={pct} tone={tone} />
              </li>
            );
          })}
        </ul>
      )}
    </ToolCardShell>
  );
}

// ---- 5. dream university progress ----------------------------------

export function DreamUniProgressCard({ data }: { data: DreamUniProgressData }) {
  const score = data.current_score ?? null;
  const rows = data.rows ?? [];
  const subtitle =
    score != null
      ? `Балл ${score} · квота ${data.quota_type ?? "GENERAL"}`
      : `Квота ${data.quota_type ?? "GENERAL"}`;
  return (
    <ToolCardShell
      title="Цели поступления"
      meta={subtitle}
      icon={<Target size={14} />}
      tone="emerald"
    >
      {rows.length === 0 ? (
        <div className="text-[12.5px] italic text-zinc-500">
          Не нашли пороги для целевых вузов. Проверьте список в профиле.
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r, i) => {
            const gap = r.gap ?? null;
            const yourScore = score ?? 0;
            const threshold = r.threshold ?? 0;
            const max = Math.max(yourScore, threshold) || 1;
            const yourPct = Math.min(100, (yourScore / max) * 100);
            const threshPct = Math.min(100, (threshold / max) * 100);
            const tone = gap == null ? "zinc" : gap >= 0 ? "emerald" : "rose";
            return (
              <li key={i} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div
                      className="truncate text-[13px] font-medium text-zinc-900"
                      title={r.uni_name ?? ""}
                    >
                      {r.uni_name ?? "—"}
                    </div>
                    <div className="truncate text-[11px] text-zinc-500">
                      {r.major_code ?? "—"}
                      {r.year ? <> · {r.year}</> : null}
                    </div>
                  </div>
                  <Chip tone={tone}>
                    {gap != null ? `${gap >= 0 ? "+" : ""}${gap} запас` : "—"}
                  </Chip>
                </div>
                {/* Mini side-by-side bar */}
                <div className="relative h-1.5 overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className="absolute left-0 top-0 h-full rounded-full bg-zinc-300/80"
                    style={{ width: `${threshPct}%` }}
                  />
                  <div
                    className={
                      "absolute left-0 top-0 h-full rounded-full " +
                      (tone === "emerald"
                        ? "bg-emerald-500"
                        : tone === "rose"
                          ? "bg-rose-500"
                          : "bg-zinc-500")
                    }
                    style={{ width: `${yourPct}%`, opacity: 0.85 }}
                  />
                </div>
                <div className="flex justify-between text-[10px] tabular-nums text-zinc-400">
                  <span>ваш {yourScore}</span>
                  <span>порог {threshold}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </ToolCardShell>
  );
}

// ---- 6. chat summary ------------------------------------------------

export function ChatSummaryCard({ data }: { data: ChatSummaryData }) {
  const { lang } = useLang();
  const langSafe: "ru" | "kz" = lang === "kz" ? "kz" : "ru";
  function open(threadId: number | null | undefined) {
    if (threadId == null) return;
    try {
      window.dispatchEvent(
        new CustomEvent("samga:open-thread", {
          detail: { thread_id: threadId },
        }),
      );
    } catch {
      /* noop */
    }
  }
  return (
    <ToolCardShell
      title="Недавние диалоги"
      meta={`${data.count}`}
      icon={<MessagesSquare size={14} />}
      tone="indigo"
    >
      {data.threads.length === 0 ? (
        <div className="text-[12.5px] italic text-zinc-500">
          Пока нет других диалогов.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {data.threads.map((t) => (
            <li key={t.thread_id ?? Math.random()}>
              <button
                type="button"
                onClick={() => open(t.thread_id)}
                // s35 wave 27a (2026-04-28): consequence-aware
                // aria-label naming the action ("Открыть диалог")
                // and embedding title + last-updated date in a
                // sentence form so SR users know what clicking
                // does. KZ uninflected mirror.
                aria-label={chatSummaryThreadAriaLabel({
                  title: t.title,
                  updatedAt: t.updated_at,
                  lang: langSafe,
                })}
                className="group block w-full rounded-lg border border-zinc-200/70 bg-white px-3 py-2 text-left transition-colors hover:border-indigo-200 hover:bg-indigo-50/40"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13px] font-medium text-zinc-900 group-hover:text-indigo-700">
                    {t.title || "Без названия"}
                  </span>
                  <span className="shrink-0 text-[10.5px] tabular-nums text-zinc-400">
                    {t.updated_at ? t.updated_at.slice(0, 10) : ""}
                  </span>
                </div>
                {t.last_user_preview && (
                  <div className="mt-0.5 truncate text-[11.5px] italic text-zinc-500">
                    <Sparkles size={9} className="mr-1 inline opacity-60" />
                    {t.last_user_preview}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </ToolCardShell>
  );
}
