import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  BookOpen,
  ClipboardCheck,
  Clock,
  Play,
  Sparkles,
  Trophy,
} from "lucide-react";
import { usePlan } from "../billing/PlanContext";
import { useLang } from "../LanguageContext";
import { LimitReachedModal } from "../billing/LimitReachedModal";
import { PaywallModal } from "../billing/PaywallModal";
import { PlanGuard } from "../billing/PlanGuard";
import { ExamSetup } from "../exam/ExamSetup";
import { ExamEngine } from "../exam/ExamEngine";
import { ExamResults } from "../exam/ExamResults";
import { ExamGenerationError, generateExam } from "../exam/data";
import { Skeleton } from "../ui/skeleton";
import { SamgaLoadingPanel } from "../ui/SamgaLoadingPanel";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { ApiError, getExamHistory } from "../../lib/api";
import { SUBJECT_NAMES } from "../exam/types";
import type {
  ProfileSubjectKey,
  ExamData,
  ExamResult,
  SubjectKey,
} from "../exam/types";

type Phase = "idle" | "setup" | "exam" | "results";

const EXAM_DATA_KEY = "samga_exam_data_v1";

function loadExamData(): ExamData | null {
  try {
    const raw = sessionStorage.getItem(EXAM_DATA_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ExamData;
    if (!parsed || !Array.isArray(parsed.subjects)) return null;
    return parsed;
  } catch {
    return null;
  }
}

type ExamHistoryRow = {
  id: number;
  score: number;
  max_score: number;
  total_questions: number;
  subjects: string[];
  submitted_at: string;
  time_taken_seconds: number;
};

function formatSubject(subject: string, lang: "ru" | "kz") {
  if (subject in SUBJECT_NAMES) {
    return SUBJECT_NAMES[subject as SubjectKey][lang];
  }
  return subject;
}

function formatDuration(seconds: number, lang: "ru" | "kz") {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return lang === "kz" ? `${minutes} мин` : `${minutes} мин`;
  }
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return lang === "kz"
    ? `${hours} сағ ${restMinutes} мин`
    : `${hours} ч ${restMinutes} мин`;
}

export function ExamsPage() {
  return (
    <PlanGuard feature="exams">
      <ExamsContent />
    </PlanGuard>
  );
}

function ExamsContent() {
  const { billing, isLimitReached, incrementUsage, refreshStatus } = usePlan();
  const { t, lang } = useLang();
  useDocumentTitle(t("dash.nav.exams"));

  const [limitModal, setLimitModal] = useState(false);
  const [paywallModal, setPaywallModal] = useState(false);
  const rehydratedExam = useMemo(() => loadExamData(), []);
  const [phase, setPhase] = useState<Phase>(rehydratedExam ? "exam" : "idle");
  const [examData, setExamData] = useState<ExamData | null>(rehydratedExam);
  const [lastResult, setLastResult] = useState<ExamResult | null>(null);
  const [examHistory, setExamHistory] = useState<ExamHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const used = billing.usage.examRuns;
  const limit = billing.limits.examRunsPerDay;

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 300);
    return () => clearTimeout(timer);
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      setExamHistory(await getExamHistory());
    } catch {
      setExamHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (phase === "idle") {
      void loadHistory();
    }
  }, [phase, loadHistory]);

  function handleStartSetup() {
    if (isLimitReached("examRuns")) {
      setLimitModal(true);
      return;
    }
    setStartError(null);
    setPhase("setup");
  }

  const handleStartExam = useCallback(
    async (sub1: ProfileSubjectKey, sub2: ProfileSubjectKey) => {
      setIsGenerating(true);
      setStartError(null);
      try {
        const data = await generateExam(sub1, sub2);
        setExamData(data);
        try {
          sessionStorage.setItem(EXAM_DATA_KEY, JSON.stringify(data));
        } catch {
          // ignore storage errors
        }
        incrementUsage("examRuns");
        setPhase("exam");
      } catch (error) {
        console.error("Failed to generate exam:", error);
        if (error instanceof ApiError && error.status === 429) {
          setLimitModal(true);
          return;
        }
        setStartError(getExamStartError(error, lang));
      } finally {
        setIsGenerating(false);
      }
    },
    [incrementUsage, lang],
  );

  const handleFinish = useCallback(
    (result: ExamResult) => {
      setLastResult(result);
      setPhase("results");
      void refreshStatus();
      try {
        sessionStorage.removeItem(EXAM_DATA_KEY);
      } catch {
        // ignore
      }
    },
    [refreshStatus],
  );

  const handleBack = useCallback(() => {
    setPhase("idle");
    setExamData(null);
    setLastResult(null);
    try {
      sessionStorage.removeItem(EXAM_DATA_KEY);
    } catch {
      // ignore
    }
  }, []);

  const averageScore = examHistory.length
    ? Math.round(
        examHistory.reduce((sum, exam) => sum + exam.score, 0) /
          examHistory.length,
      )
    : 0;
  const bestScore = examHistory.length
    ? Math.max(...examHistory.map((exam) => exam.score))
    : 0;

  if (phase === "setup") {
    if (isGenerating) {
      return (
        <div className="mx-auto max-w-4xl">
          <SamgaLoadingPanel
            lang={lang}
            eyebrow={lang === "kz" ? "Сынақ режимі" : "Пробный режим"}
            title={
              lang === "ru" ? "Собираем пробный ЕНТ" : "Сынақ ҰБТ жиналып жатыр"
            }
            description={
              lang === "ru"
                ? "Samga подбирает структуру, профильную пару и последовательность вопросов перед запуском полной симуляции."
                : "Samga толық симуляцияны бастамас бұрын құрылымды, бейіндік жұпты және сұрақ ағынын дайындап жатыр."
            }
            hint={lang === "kz" ? "емтихан контуры" : "экзаменационный контур"}
          />
        </div>
      );
    }
    return (
      <div className="space-y-4">
        {startError ? <ExamStartError message={startError} /> : null}
        <ExamSetup
          onStart={handleStartExam}
          onCancel={() => setPhase("idle")}
        />
      </div>
    );
  }

  if (phase === "exam" && examData) {
    return (
      <ExamEngine
        examData={examData}
        onFinish={handleFinish}
        onQuit={handleBack}
      />
    );
  }

  if (phase === "results" && lastResult) {
    return <ExamResults result={lastResult} onClose={handleBack} />;
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <Skeleton className="h-64 w-full rounded-2xl" />
        <div className="grid gap-3 sm:grid-cols-3">
          {[...Array(3)].map((_, index) => (
            <Skeleton key={index} className="h-28 w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-44 w-full rounded-2xl" />
        <div className="space-y-3">
          {[...Array(3)].map((_, index) => (
            <Skeleton key={index} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="rounded-2xl border border-zinc-200 bg-white px-6 py-6 sm:px-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <HeroPill
                icon={<ClipboardCheck size={13} className="text-amber-700" />}
              >
                Samga Exam
              </HeroPill>
              <HeroPill
                icon={<Sparkles size={13} className="text-amber-700" />}
              >
                {lang === "kz" ? "Толық симуляция" : "Полная симуляция"}
              </HeroPill>
            </div>
            <h1
              className="text-[24px] text-zinc-950 sm:text-[30px]"
              style={{ fontWeight: 760, lineHeight: 1.08 }}
            >
              {t("exams.title")}
            </h1>
            <p
              className="mt-3 text-[13px] text-zinc-600 sm:text-[14px]"
              style={{ lineHeight: 1.7 }}
            >
              {lang === "kz"
                ? "Samga толық сынақ режимінде уақыт, құрылым және бейіндік жұп логикасын бірге ұстайды."
                : "Samga держит полный режим пробного экзамена: время, структуру и профильную пару в одной симуляции."}
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-3 lg:w-[430px]">
            <HeroStat
              label={lang === "kz" ? "Бүгін" : "Сегодня"}
              value={`${used}/${limit}`}
            />
            <HeroStat
              label={lang === "kz" ? "Үздік балл" : "Лучший балл"}
              value={examHistory.length ? String(bestScore) : "—"}
            />
            <HeroStat
              label={lang === "kz" ? "Орташа" : "Средний"}
              value={examHistory.length ? String(averageScore) : "—"}
            />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 text-amber-700">
              <Trophy size={22} />
            </div>
            <div>
              <h2
                className="text-zinc-950"
                style={{ fontSize: 18, fontWeight: 730 }}
              >
                {t("exams.startTitle")}
              </h2>
              <p
                className="mt-2 text-zinc-500"
                style={{ fontSize: 13, lineHeight: 1.65 }}
              >
                {lang === "kz"
                  ? "240 минут, 120 сұрақ, 5 пән. Нәтиже емтихан тарихына, қателерге және талдауға түсуі керек."
                  : "240 минут, 120 вопросов, 5 предметов. Результат должен замкнуть цикл: история, ошибки и аналитика."}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <SoftTag
                  icon={<Clock size={12} className="text-zinc-500" />}
                  label={t("exams.startDesc.time")}
                />
                <SoftTag
                  icon={<BookOpen size={12} className="text-zinc-500" />}
                  label={t("exams.startDesc.questions")}
                />
                <SoftTag
                  icon={<ClipboardCheck size={12} className="text-zinc-500" />}
                  label={t("exams.startDesc.subjects")}
                />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleStartSetup}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-5 text-white transition-colors hover:bg-black"
            style={{ fontSize: 14, fontWeight: 720 }}
          >
            <Play size={16} />
            {t("exams.start")}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2
              className="text-zinc-950"
              style={{ fontSize: 18, fontWeight: 730 }}
            >
              {t("exams.history")}
            </h2>
            <p
              className="mt-1 text-zinc-500"
              style={{ fontSize: 13, lineHeight: 1.6 }}
            >
              {lang === "kz"
                ? "Әрбір толық әрекет осы жерде отыруы керек."
                : "Здесь должна собираться каждая завершённая полная попытка."}
            </p>
          </div>
          {examHistory.length > 0 ? (
            <span
              className="text-zinc-500"
              style={{ fontSize: 12, fontWeight: 650 }}
            >
              {examHistory.length}
            </span>
          ) : null}
        </div>

        {historyLoading ? (
          <div className="space-y-3">
            {[...Array(2)].map((_, index) => (
              <Skeleton key={index} className="h-28 w-full rounded-xl" />
            ))}
          </div>
        ) : examHistory.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-5 py-10 text-center text-zinc-500">
            <p style={{ fontSize: 14, lineHeight: 1.7 }}>
              {lang === "kz"
                ? "Әзірге тарих жоқ. Жоғарыдағы бастау батырмасы бірінші сынақ ҰБТ-ны іске қосады."
                : "История пока пуста. Кнопка выше запускает ваш первый полный пробный ЕНТ."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {examHistory.map((exam) => {
              const pct = Math.round((exam.score / exam.max_score) * 100);
              return (
                <article
                  key={exam.id}
                  className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-4"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="text-zinc-950"
                          style={{ fontSize: 20, fontWeight: 760 }}
                        >
                          {exam.score}/{exam.max_score}
                        </span>
                        <span
                          className={`inline-flex rounded-full border px-3 py-1 ${
                            pct >= 70
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : pct >= 50
                                ? "border-amber-200 bg-amber-50 text-amber-700"
                                : "border-red-200 bg-red-50 text-red-700"
                          }`}
                          style={{ fontSize: 11, fontWeight: 700 }}
                        >
                          {pct}%
                        </span>
                      </div>
                      <p
                        className="mt-2 text-zinc-500"
                        style={{ fontSize: 13, lineHeight: 1.65 }}
                      >
                        {exam.subjects
                          .map((subject) => formatSubject(subject, lang))
                          .join(", ")}
                      </p>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-3 lg:w-[360px]">
                      <MiniStat
                        label={lang === "kz" ? "Сұрақ" : "Вопросы"}
                        value={String(exam.total_questions)}
                      />
                      <MiniStat
                        label={lang === "kz" ? "Уақыт" : "Время"}
                        value={formatDuration(exam.time_taken_seconds, lang)}
                      />
                      <MiniStat
                        label={lang === "kz" ? "Күні" : "Дата"}
                        value={new Date(exam.submitted_at).toLocaleDateString(
                          lang === "kz" ? "kk-KZ" : "ru-RU",
                        )}
                      />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <LimitReachedModal
        open={limitModal}
        onClose={() => setLimitModal(false)}
        counter="examRuns"
        onUpgrade={() => {
          setLimitModal(false);
          setPaywallModal(true);
        }}
      />
      <PaywallModal
        open={paywallModal}
        onClose={() => setPaywallModal(false)}
        feature="exams"
      />
    </div>
  );
}

function getExamStartError(error: unknown, lang: "ru" | "kz"): string {
  if (error instanceof ExamGenerationError) {
    return lang === "kz"
      ? "Samga бұл пәндер жұбы үшін толық ресми емтиханды жинай алмады. Басқа жұпты таңдаңыз немесе кейінірек қайталап көріңіз."
      : "Samga не смогла собрать полный официальный экзамен для этой пары. Выберите другую пару или попробуйте позже.";
  }

  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return lang === "kz"
        ? "Бұл емтиханды бастау үшін аккаунт пен тарифті қайта тексеру керек."
        : "Нужно заново проверить аккаунт и тариф перед запуском экзамена.";
    }
  }

  return lang === "kz"
    ? "Емтиханды бастау мүмкін болмады. Байланысты тексеріп, қайта көріңіз."
    : "Не удалось запустить экзамен. Проверьте соединение и попробуйте снова.";
}

function ExamStartError({ message }: { message: string }) {
  return (
    <div className="mx-auto flex max-w-6xl gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-red-800">
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600" />
      <p style={{ fontSize: 13, fontWeight: 650, lineHeight: 1.65 }}>
        {message}
      </p>
    </div>
  );
}

function HeroPill({ icon, children }: { icon: ReactNode; children: string }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-zinc-700"
      style={{ fontSize: 11, fontWeight: 700 }}
    >
      {icon}
      {children}
    </span>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
      <p
        className="text-zinc-500"
        style={{ fontSize: 11, fontWeight: 760, textTransform: "uppercase" }}
      >
        {label}
      </p>
      <p
        className="mt-2 text-zinc-900"
        style={{ fontSize: 20, fontWeight: 760, lineHeight: 1 }}
      >
        {value}
      </p>
    </div>
  );
}

function SoftTag({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-zinc-600"
      style={{ fontSize: 12, fontWeight: 650 }}
    >
      {icon}
      {label}
    </span>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
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
        style={{ fontSize: 14, fontWeight: 700 }}
      >
        {value}
      </p>
    </div>
  );
}
