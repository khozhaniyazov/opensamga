import {
  ClipboardCheck,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Clock,
  GraduationCap,
  Shield,
  Trophy,
  XCircle,
} from "lucide-react";
import { useLang } from "../LanguageContext";
import type { ExamResult } from "./types";
import { SUBJECT_NAMES, MIN_THRESHOLDS, CUMULATIVE_THRESHOLDS } from "./types";

interface ExamResultsProps {
  result: ExamResult;
  onClose: () => void;
}

export function ExamResults({ result, onClose }: ExamResultsProps) {
  const { t, lang } = useLang();

  const pct = Math.round((result.totalEarned / result.totalMax) * 100);
  const timeMin = Math.floor(result.timeUsedSeconds / 60);
  const timeSec = result.timeUsedSeconds % 60;
  const reviewCopy =
    lang === "kz"
      ? {
          title: "Қайта қарау сигналдары",
          subtitle:
            "Samga енді бос қалдырылған, қате жауап берілген және қателер кезегіне түскен сұрақтарды бөлек көрсетеді.",
          wrongAnswered: "Қате жауап берілген",
          skipped: "Өткізіп жіберілген",
          queued: "Қарауға жіберілген",
          note: "Өткізіп кеткен сұрақтар баллды түсіреді, бірақ қателер кезегіне тек нақты жауап берген қате сұрақтар ғана түседі.",
        }
      : {
          title: "Сигналы разбора",
          subtitle:
            "Samga теперь отдельно показывает, что вы пропустили, что ответили неверно и что реально ушло в очередь ошибок.",
          wrongAnswered: "Ошибочно отвечено",
          skipped: "Пропущено",
          queued: "В очереди на разбор",
          note: "Пропущенные вопросы снижают балл, но в очередь ошибок попадают только те, где был дан реальный неверный ответ.",
        };

  const scoreColor =
    pct >= 70
      ? "text-emerald-600"
      : pct >= 50
        ? "text-amber-600"
        : "text-red-600";

  const eligibilityRows = [
    {
      key: "standard",
      label: { ru: "Стандартные программы", kz: "Стандартты бағдарламалар" },
      threshold: CUMULATIVE_THRESHOLDS.standard,
      passed: result.eligibility.standard,
    },
    {
      key: "agriculture",
      label: {
        ru: "Сельское хозяйство / Ветеринария",
        kz: "Ауыл шаруашылығы / Ветеринария",
      },
      threshold: CUMULATIVE_THRESHOLDS.agriculture,
      passed: result.eligibility.agriculture,
    },
    {
      key: "national",
      label: { ru: "Национальные вузы", kz: "Ұлттық ЖОО" },
      threshold: CUMULATIVE_THRESHOLDS.national,
      passed: result.eligibility.national,
    },
    {
      key: "medicine",
      label: { ru: "Медицина", kz: "Медицина" },
      threshold: CUMULATIVE_THRESHOLDS.medicine,
      passed: result.eligibility.medicine,
    },
    {
      key: "pedagogy",
      label: { ru: "Педагогика / Юриспруденция", kz: "Педагогика / Құқықтану" },
      threshold: CUMULATIVE_THRESHOLDS.pedagogy,
      passed: result.eligibility.pedagogy,
    },
  ];

  return (
    <div className="fixed inset-0 z-[200] overflow-y-auto bg-zinc-50">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <button
          type="button"
          onClick={onClose}
          aria-label={t("examResults.backToExams")}
          className="mb-4 inline-flex h-11 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
          style={{ fontSize: 13, fontWeight: 700 }}
        >
          <ArrowLeft size={15} />
          {t("examResults.backToExams")}
        </button>
        <section className="rounded-2xl border border-zinc-200/80 bg-zinc-50 px-6 py-6 sm:px-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div
                className="mb-4 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-zinc-700"
                style={{ fontSize: 11, fontWeight: 700 }}
              >
                <Trophy size={13} className="text-amber-700" />
                Samga Results
              </div>
              <h1
                className="text-[24px] text-zinc-950 sm:text-[32px]"
                style={{ fontWeight: 760, lineHeight: 1.04 }}
              >
                {t("examResults.title")}
              </h1>
              <p
                className="mt-3 text-zinc-500"
                style={{ fontSize: 14, lineHeight: 1.7 }}
              >
                {t("examResults.subtitle")}
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-3 lg:w-[430px]">
              <HeroStat label={t("examResults.percentage")} value={`${pct}%`} />
              <HeroStat
                label={t("examResults.timeUsed")}
                value={`${timeMin}:${String(timeSec).padStart(2, "0")}`}
              />
              <HeroStat
                label={t("examResults.minimums")}
                value={
                  result.passedAllMinimums
                    ? t("examResults.passed")
                    : t("examResults.failed")
                }
              />
            </div>
          </div>
        </section>

        <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_340px]">
          <div className="space-y-4">
            <section className="rounded-2xl border border-zinc-200/80 bg-white px-5 py-5 ">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
                <div>
                  <p
                    className={scoreColor}
                    style={{ fontSize: 64, fontWeight: 800, lineHeight: 0.95 }}
                  >
                    {result.totalEarned}
                  </p>
                  <p className="mt-2 text-zinc-500" style={{ fontSize: 14 }}>
                    {lang === "ru"
                      ? `из ${result.totalMax} баллов`
                      : `${result.totalMax} балдан`}
                  </p>
                </div>

                <div className="grid flex-1 gap-3 sm:grid-cols-3">
                  <MiniStat
                    icon={<BarChart3 size={14} className="text-zinc-500" />}
                    value={`${pct}%`}
                    label={t("examResults.percentage")}
                  />
                  <MiniStat
                    icon={<Clock size={14} className="text-zinc-500" />}
                    value={`${timeMin}:${String(timeSec).padStart(2, "0")}`}
                    label={t("examResults.timeUsed")}
                  />
                  <MiniStat
                    icon={
                      result.passedAllMinimums ? (
                        <CheckCircle2 size={14} className="text-emerald-500" />
                      ) : (
                        <XCircle size={14} className="text-red-500" />
                      )
                    }
                    value={
                      result.passedAllMinimums
                        ? t("examResults.passed")
                        : t("examResults.failed")
                    }
                    label={t("examResults.minimums")}
                  />
                </div>
              </div>

              {!result.passedAllMinimums ? (
                <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                  <p
                    className="text-red-700"
                    style={{ fontSize: 12.5, lineHeight: 1.7 }}
                  >
                    {t("examResults.failWarning")}
                  </p>
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-zinc-200/80 bg-white px-5 py-5 ">
              <div className="flex items-center gap-2">
                <ClipboardCheck size={18} className="text-amber-700" />
                <h2
                  className="text-zinc-950"
                  style={{ fontSize: 18, fontWeight: 730 }}
                >
                  {reviewCopy.title}
                </h2>
              </div>
              <p
                className="mt-2 text-zinc-500"
                style={{ fontSize: 13, lineHeight: 1.65 }}
              >
                {reviewCopy.subtitle}
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <MiniStat
                  icon={<XCircle size={14} className="text-red-500" />}
                  value={String(result.wrongAnsweredQuestions)}
                  label={reviewCopy.wrongAnswered}
                />
                <MiniStat
                  icon={<Clock size={14} className="text-amber-500" />}
                  value={String(result.skippedQuestions)}
                  label={reviewCopy.skipped}
                />
                <MiniStat
                  icon={
                    <ClipboardCheck size={14} className="text-emerald-500" />
                  }
                  value={String(result.mistakesQueued)}
                  label={reviewCopy.queued}
                />
              </div>

              <div className="mt-4 rounded-xl border border-zinc-200/80 bg-zinc-50 px-4 py-3">
                <p
                  className="text-zinc-500"
                  style={{ fontSize: 12.5, lineHeight: 1.7 }}
                >
                  {reviewCopy.note}
                </p>
              </div>
            </section>

            <section className="rounded-2xl border border-zinc-200/80 bg-white px-5 py-5 ">
              <h2
                className="text-zinc-950"
                style={{ fontSize: 18, fontWeight: 730 }}
              >
                {t("examResults.bySubject")}
              </h2>

              <div className="mt-4 space-y-3">
                {result.subjectScores.map((sc, idx) => {
                  const maxPts = sc.max;
                  const earnedPct =
                    maxPts > 0 ? Math.round((sc.earned / maxPts) * 100) : 0;

                  let minReq = 0;
                  if (sc.key === "histKz") minReq = MIN_THRESHOLDS.histKz ?? 0;
                  else if (sc.key === "readLit")
                    minReq = MIN_THRESHOLDS.readLit ?? 0;
                  else if (sc.key === "mathLit")
                    minReq = MIN_THRESHOLDS.mathLit ?? 0;
                  else
                    minReq =
                      idx === 3
                        ? MIN_THRESHOLDS.profile1 ?? 0
                        : MIN_THRESHOLDS.profile2 ?? 0;

                  return (
                    <article
                      key={sc.key}
                      className="rounded-xl border border-zinc-200/80 bg-zinc-50 px-4 py-4"
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className="text-zinc-950"
                              style={{ fontSize: 15, fontWeight: 720 }}
                            >
                              {SUBJECT_NAMES[sc.key][lang]}
                            </span>
                            {!sc.passedMinimum ? (
                              <span
                                className="inline-flex rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-red-700"
                                style={{ fontSize: 10.5, fontWeight: 700 }}
                              >
                                {lang === "ru"
                                  ? `мин. ${minReq}`
                                  : `мин. ${minReq}`}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-200">
                            <div
                              className={`h-full rounded-full ${sc.passedMinimum ? "bg-emerald-500" : "bg-red-400"}`}
                              style={{ width: `${earnedPct}%` }}
                            />
                          </div>
                          <div
                            className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-zinc-500"
                            style={{ fontSize: 12 }}
                          >
                            <span>
                              {sc.answered}/{sc.total}{" "}
                              {t("examResults.questionsAnswered")}
                            </span>
                            <span>{earnedPct}%</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className={
                              sc.passedMinimum
                                ? "text-zinc-900"
                                : "text-red-600"
                            }
                            style={{ fontSize: 16, fontWeight: 760 }}
                          >
                            {sc.earned}/{maxPts}
                          </span>
                          {sc.passedMinimum ? (
                            <CheckCircle2
                              size={16}
                              className="text-emerald-500"
                            />
                          ) : (
                            <XCircle size={16} className="text-red-500" />
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </div>

          <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
            <section className="rounded-2xl border border-zinc-200/80 bg-white px-5 py-5 ">
              <div className="flex items-center gap-2">
                <GraduationCap size={18} className="text-amber-700" />
                <h2
                  className="text-zinc-950"
                  style={{ fontSize: 18, fontWeight: 730 }}
                >
                  {t("examResults.eligibility")}
                </h2>
              </div>

              <div className="mt-4 space-y-2.5">
                {eligibilityRows.map((row) => (
                  <div
                    key={row.key}
                    className={`rounded-xl border px-4 py-3 ${
                      row.passed
                        ? "border-emerald-200 bg-emerald-50/70"
                        : "border-zinc-200/80 bg-zinc-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2">
                        {row.passed ? (
                          <CheckCircle2
                            size={14}
                            className="mt-0.5 text-emerald-500"
                          />
                        ) : (
                          <XCircle size={14} className="mt-0.5 text-zinc-300" />
                        )}
                        <span
                          className={
                            row.passed ? "text-zinc-800" : "text-zinc-500"
                          }
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            lineHeight: 1.5,
                          }}
                        >
                          {row.label[lang]}
                        </span>
                      </div>
                      <span
                        className={
                          row.passed ? "text-emerald-700" : "text-zinc-500"
                        }
                        style={{ fontSize: 12, fontWeight: 700 }}
                      >
                        {">= "} {row.threshold}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {!result.passedAllMinimums ? (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                  <div className="flex items-start gap-2">
                    <Shield
                      size={14}
                      className="mt-0.5 shrink-0 text-red-500"
                    />
                    <p
                      className="text-red-700"
                      style={{ fontSize: 12.5, lineHeight: 1.7 }}
                    >
                      {t("examResults.minimumFail")}
                    </p>
                  </div>
                </div>
              ) : null}
            </section>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-zinc-950 px-5 text-white transition-colors hover:bg-black"
              style={{ fontSize: 14, fontWeight: 720 }}
            >
              <ArrowLeft size={16} />
              {t("examResults.backToExams")}
            </button>
          </aside>
        </div>
      </div>
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200/80 bg-white px-4 py-3">
      <p
        className="text-zinc-500"
        style={{ fontSize: 11, fontWeight: 760, textTransform: "uppercase" }}
      >
        {label}
      </p>
      <p
        className="mt-2 text-zinc-900"
        style={{ fontSize: 18, fontWeight: 760, lineHeight: 1.15 }}
      >
        {value}
      </p>
    </div>
  );
}

function MiniStat({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200/80 bg-zinc-50 px-3 py-3 text-center">
      <div className="flex items-center justify-center gap-1 mb-1">{icon}</div>
      <p className="text-zinc-900" style={{ fontSize: 16, fontWeight: 760 }}>
        {value}
      </p>
      <p className="mt-1 text-zinc-500" style={{ fontSize: 11 }}>
        {label}
      </p>
    </div>
  );
}
