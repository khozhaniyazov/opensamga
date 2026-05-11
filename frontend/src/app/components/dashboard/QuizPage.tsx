import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  CheckCircle2,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  XCircle,
} from "lucide-react";
import { useLocation } from "react-router";
import { useLang } from "../LanguageContext";
import { PlanGuard } from "../billing/PlanGuard";
import { LimitReachedModal } from "../billing/LimitReachedModal";
import { PaywallModal } from "../billing/PaywallModal";
import { usePlan } from "../billing/PlanContext";
import { SamgaLoadingPanel } from "../ui/SamgaLoadingPanel";
import { ApiError, apiPost } from "../../lib/api";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { difficultyLabel, subjectLabel } from "../../lib/subjectLabels";
import {
  practiceConfidenceLabel,
  practiceGapSummary,
  practiceSubtopicLabel,
  practiceTrackLabel,
  type PracticeCoverage,
} from "./practiceCoverageLabels";

interface QuestionOption {
  key: string;
  text: string;
}

interface PracticeQuestionResponse {
  id: number;
  session_id: number;
  question: string;
  options: QuestionOption[];
  subject: string;
  grade: number;
  difficulty: string;
  language: string;
  coverage?: PracticeCoverage | null;
}

interface AnswerResultResponse {
  is_correct: boolean;
  correct_answer: string;
  explanation: string;
  citation?: {
    book?: string;
    page?: number;
    quote?: string;
  } | null;
}

type QuizState = "setup" | "in_progress" | "finished";

const TOTAL_QUESTIONS = 10;
const SUBJECTS = [
  { key: "subject.mathLit", value: "Mathematical Literacy" },
  { key: "subject.readLit", value: "Reading Literacy" },
  { key: "subject.histKz", value: "History of Kazakhstan" },
  { key: "subject.math", value: "Mathematics" },
  { key: "subject.physics", value: "Physics" },
  { key: "subject.chemistry", value: "Chemistry" },
  { key: "subject.biology", value: "Biology" },
] as const;

export function QuizPage() {
  const { t } = useLang();
  useDocumentTitle(t("dash.nav.quiz"));
  return (
    <PlanGuard feature="quiz">
      <QuizContent />
    </PlanGuard>
  );
}

function QuizContent() {
  const location = useLocation();
  const { t, lang } = useLang();
  const { billing, isLimitReached, refreshStatus } = usePlan();
  const autoStartedRef = useRef(false);

  const params = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
  const presetSubject = params.get("subject");
  const shouldAutoStart = params.get("autostart") === "1";

  const [quizState, setQuizState] = useState<QuizState>("setup");
  const [selectedSubject, setSelectedSubject] = useState<string>(
    SUBJECTS.some((subject) => subject.value === presetSubject)
      ? (presetSubject as string)
      : SUBJECTS[0].value,
  );
  const [difficulty, setDifficulty] = useState<"EASY" | "MEDIUM" | "HARD">(
    "MEDIUM",
  );

  const [questionNumber, setQuestionNumber] = useState(0);
  const [score, setScore] = useState(0);
  const [currentQuestion, setCurrentQuestion] =
    useState<PracticeQuestionResponse | null>(null);
  const [practiceSessionId, setPracticeSessionId] = useState<number | null>(
    null,
  );
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [answerResult, setAnswerResult] = useState<AnswerResultResponse | null>(
    null,
  );

  const [isLoadingQuestion, setIsLoadingQuestion] = useState(false);
  const [isCheckingAnswer, setIsCheckingAnswer] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [limitModal, setLimitModal] = useState(false);
  const [paywallModal, setPaywallModal] = useState(false);

  const used = billing.usage.trainingCalls;
  const limit = billing.limits.trainingCallsPerDay;

  const answeredQuestionCount = useMemo(() => {
    if (quizState === "finished") return TOTAL_QUESTIONS;
    if (questionNumber === 0) return 0;
    return Math.max(0, questionNumber - (answerResult ? 0 : 1));
  }, [answerResult, questionNumber, quizState]);

  const percent = useMemo(() => {
    if (answeredQuestionCount === 0) return 0;
    return Math.round((score / answeredQuestionCount) * 100);
  }, [answeredQuestionCount, score]);

  useEffect(() => {
    if (
      presetSubject &&
      SUBJECTS.some((subject) => subject.value === presetSubject)
    ) {
      setSelectedSubject(presetSubject);
    }
  }, [presetSubject]);

  async function loadQuestion(
    nextNumber: number,
    sessionIdOverride?: number | null,
  ) {
    if (isLimitReached("trainingCalls")) {
      setLimitModal(true);
      return false;
    }

    setIsLoadingQuestion(true);
    setErrorMessage(null);

    try {
      const question = await apiPost<PracticeQuestionResponse>(
        "/practice/generate",
        {
          subject: selectedSubject,
          grade: 11,
          difficulty,
          language: lang,
          session_id: sessionIdOverride ?? practiceSessionId ?? undefined,
        },
      );

      setCurrentQuestion(question);
      setPracticeSessionId(question.session_id);
      setQuestionNumber(nextNumber);
      setSelectedOption(null);
      setAnswerResult(null);
      setQuizState("in_progress");
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        setPaywallModal(true);
      } else if (error instanceof ApiError && error.status === 429) {
        setLimitModal(true);
      } else if (error instanceof ApiError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage(t("error.desc"));
      }
      return false;
    } finally {
      setIsLoadingQuestion(false);
      await refreshStatus();
    }
  }

  async function startQuiz() {
    autoStartedRef.current = true;
    setScore(0);
    setPracticeSessionId(null);
    await loadQuestion(1, null);
  }

  async function submitAnswer(optionKey: string) {
    if (!currentQuestion || isCheckingAnswer || answerResult) return;

    setSelectedOption(optionKey);
    setIsCheckingAnswer(true);
    setErrorMessage(null);

    try {
      const result = await apiPost<AnswerResultResponse>(
        `/practice/${currentQuestion.id}/answer`,
        {
          answer: optionKey,
          session_id: practiceSessionId ?? undefined,
        },
      );

      setAnswerResult(result);
      if (result.is_correct) {
        setScore((prev) => prev + 1);
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        setPaywallModal(true);
      } else if (error instanceof ApiError && error.status === 429) {
        setLimitModal(true);
      } else if (error instanceof ApiError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage(t("error.desc"));
      }
    } finally {
      setIsCheckingAnswer(false);
      await refreshStatus();
    }
  }

  async function nextStep() {
    if (questionNumber >= TOTAL_QUESTIONS) {
      setQuizState("finished");
      return;
    }
    await loadQuestion(questionNumber + 1);
  }

  function resetToSetup() {
    setQuizState("setup");
    setQuestionNumber(0);
    setScore(0);
    setCurrentQuestion(null);
    setPracticeSessionId(null);
    setSelectedOption(null);
    setAnswerResult(null);
    setErrorMessage(null);
  }

  useEffect(() => {
    if (
      !shouldAutoStart ||
      autoStartedRef.current ||
      quizState !== "setup" ||
      isLoadingQuestion
    ) {
      return;
    }

    autoStartedRef.current = true;
    void startQuiz();
    // startQuiz is intentionally omitted from the dep array — it's
    // a stable in-component callback that closes over current
    // state, and adding it would re-fire the auto-start guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingQuestion, quizState, shouldAutoStart]);

  const quizCopy = {
    difficulty: lang === "kz" ? "Күрделілік" : "Сложность",
    correct: lang === "kz" ? "Дұрыс" : "Правильно",
    wrongAnswer: (answer: string) =>
      lang === "kz"
        ? `Қате. Дұрыс жауап: ${answer}`
        : `Неверно. Правильный ответ: ${answer}`,
    citation: lang === "kz" ? "Дәйексөз" : "Цитата",
    textbook: lang === "kz" ? "Оқулық" : "Учебник",
    loadingQuestion:
      lang === "kz" ? "Сұрақ дайындалуда..." : "Готовим вопрос...",
    practiceTitle: lang === "kz" ? "Samga Practice" : "Samga Practice",
  };

  if (quizState === "setup" && isLoadingQuestion && !currentQuestion) {
    return (
      <div className="mx-auto max-w-4xl">
        <SamgaLoadingPanel
          lang={lang}
          eyebrow={lang === "kz" ? "Қысқа режим" : "Короткий режим"}
          title={
            lang === "kz"
              ? "Бірінші сұрақты дайындап жатырмыз"
              : "Готовим первый вопрос"
          }
          description={
            lang === "kz"
              ? "Samga тақырыпты, күрделілікті және дереккөз контурын жинақтап, қысқа тест ағынын іске қосып жатыр."
              : "Samga собирает тему, сложность и контур источников перед запуском короткого тестового потока."
          }
          hint={lang === "kz" ? "жылдам серия" : "быстрый режим"}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {quizState === "setup" && (
        <>
          <section className="rounded-2xl border border-zinc-200 bg-white px-6 py-6 sm:px-7">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <HeroPill
                    icon={<Target size={13} className="text-amber-700" />}
                  >
                    {quizCopy.practiceTitle}
                  </HeroPill>
                  <HeroPill
                    icon={<Sparkles size={13} className="text-amber-700" />}
                  >
                    {lang === "kz" ? "Қысқа режим" : "Короткий режим"}
                  </HeroPill>
                </div>
                <h1
                  className="text-[24px] text-zinc-950 sm:text-[30px]"
                  style={{ fontWeight: 760, lineHeight: 1.08 }}
                >
                  {t("quiz.title")}
                </h1>
                <p
                  className="mt-3 text-[13px] text-zinc-600 sm:text-[14px]"
                  style={{ lineHeight: 1.7 }}
                >
                  {t("quiz.subtitle")}
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-3 lg:w-[430px]">
                <HeroStat
                  label={lang === "kz" ? "Бүгін" : "Сегодня"}
                  value={`${used}/${limit}`}
                />
                <HeroStat
                  label={lang === "kz" ? "Сұрақтар" : "Вопросы"}
                  value={String(TOTAL_QUESTIONS)}
                />
                <HeroStat
                  label={quizCopy.difficulty}
                  value={difficultyLabel(difficulty, lang)}
                />
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_320px]">
              <div>
                <h2
                  className="text-zinc-950"
                  style={{ fontSize: 18, fontWeight: 730 }}
                >
                  {t("quiz.selectSubject")}
                </h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {SUBJECTS.map((subject) => {
                    const active = selectedSubject === subject.value;
                    return (
                      <button
                        key={subject.value}
                        type="button"
                        onClick={() => setSelectedSubject(subject.value)}
                        className={`rounded-xl border px-4 py-4 text-left transition-colors ${
                          active
                            ? "border-amber-300 bg-amber-50/70"
                            : "border-zinc-200 bg-zinc-50 hover:border-zinc-300 hover:bg-white"
                        }`}
                      >
                        <p
                          className="text-zinc-950"
                          style={{
                            fontSize: 14,
                            fontWeight: 700,
                            lineHeight: 1.4,
                          }}
                        >
                          {t(subject.key)}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                <p
                  className="text-zinc-950"
                  style={{ fontSize: 17, fontWeight: 720 }}
                >
                  {quizCopy.difficulty}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {(["EASY", "MEDIUM", "HARD"] as const).map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setDifficulty(level)}
                      className={`rounded-full border px-3 py-1.5 transition-colors ${
                        difficulty === level
                          ? "border-amber-300 bg-amber-50 text-amber-700"
                          : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50"
                      }`}
                      style={{ fontSize: 12, fontWeight: 700 }}
                    >
                      {difficultyLabel(level, lang)}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => void startQuiz()}
                  disabled={isLoadingQuestion}
                  className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-zinc-950 px-5 text-white transition-colors hover:bg-black disabled:opacity-60"
                  style={{ fontSize: 14, fontWeight: 720 }}
                >
                  {isLoadingQuestion ? (
                    <RefreshCw size={16} className="animate-spin" />
                  ) : (
                    <Play size={16} />
                  )}
                  {isLoadingQuestion
                    ? quizCopy.loadingQuestion
                    : t("quiz.start")}
                </button>
              </div>
            </div>
          </section>
        </>
      )}

      {quizState === "in_progress" && currentQuestion && (
        <>
          <section className="rounded-2xl border border-zinc-200 bg-white px-6 py-6 sm:px-7">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <HeroPill
                    icon={<BookOpen size={13} className="text-amber-700" />}
                  >
                    {subjectLabel(currentQuestion.subject, lang)}
                  </HeroPill>
                  <HeroPill
                    icon={<Sparkles size={13} className="text-amber-700" />}
                  >
                    {difficultyLabel(difficulty, lang)}
                  </HeroPill>
                  {currentQuestion.coverage ? (
                    <HeroPill
                      icon={
                        <ShieldCheck size={13} className="text-amber-700" />
                      }
                    >
                      {practiceTrackLabel(currentQuestion.coverage.track, lang)}
                    </HeroPill>
                  ) : null}
                </div>
                <h1
                  className="text-[22px] text-zinc-950 sm:text-[28px]"
                  style={{ fontWeight: 760, lineHeight: 1.12 }}
                >
                  {t("quiz.question")} {questionNumber}/{TOTAL_QUESTIONS}
                </h1>
                <p
                  className="mt-3 text-zinc-600"
                  style={{ fontSize: 15, lineHeight: 1.75 }}
                >
                  {currentQuestion.question}
                </p>
                {currentQuestion.coverage ? (
                  <PracticeCoverageStrip
                    coverage={currentQuestion.coverage}
                    lang={lang}
                  />
                ) : null}
              </div>

              <div className="grid gap-2 sm:grid-cols-3 lg:w-[430px]">
                <HeroStat
                  label={lang === "kz" ? "Ұпай" : "Очки"}
                  value={String(score)}
                />
                <HeroStat
                  label={lang === "kz" ? "Прогресс" : "Прогресс"}
                  value={`${questionNumber}/${TOTAL_QUESTIONS}`}
                />
                <HeroStat
                  label={lang === "kz" ? "Дұрыстығы" : "Точность"}
                  value={`${percent}%`}
                />
              </div>
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <section className="space-y-3">
              {currentQuestion.options.map((option) => {
                const isSelected = selectedOption === option.key;
                const isCorrect = answerResult?.correct_answer === option.key;
                const isWrongSelected =
                  !!answerResult &&
                  isSelected &&
                  answerResult.correct_answer !== option.key;

                return (
                  <button
                    key={option.key}
                    type="button"
                    disabled={!!answerResult || isCheckingAnswer}
                    onClick={() => void submitAnswer(option.key)}
                    className={`w-full rounded-xl border px-4 py-4 text-left transition-colors ${
                      isCorrect
                        ? "border-emerald-300 bg-emerald-50/70"
                        : isWrongSelected
                          ? "border-red-300 bg-red-50/70"
                          : isSelected
                            ? "border-amber-300 bg-amber-50/70"
                            : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50"
                    } disabled:cursor-default`}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-zinc-700"
                        style={{ fontSize: 11.5, fontWeight: 700 }}
                      >
                        {option.key}
                      </span>
                      <span
                        className="flex-1 text-zinc-800"
                        style={{ fontSize: 14, lineHeight: 1.7 }}
                      >
                        {option.text}
                      </span>
                      {answerResult && isCorrect ? (
                        <CheckCircle2
                          size={18}
                          className="shrink-0 text-emerald-600"
                        />
                      ) : null}
                      {isWrongSelected ? (
                        <XCircle size={18} className="shrink-0 text-red-600" />
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </section>

            <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
              {answerResult ? (
                <section className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
                  <div className="mb-3 flex items-center gap-2">
                    {answerResult.is_correct ? (
                      <CheckCircle2 size={16} className="text-emerald-600" />
                    ) : (
                      <XCircle size={16} className="text-red-600" />
                    )}
                    <p
                      className={
                        answerResult.is_correct
                          ? "text-emerald-700"
                          : "text-red-700"
                      }
                      style={{ fontSize: 13, fontWeight: 700 }}
                    >
                      {answerResult.is_correct
                        ? quizCopy.correct
                        : quizCopy.wrongAnswer(answerResult.correct_answer)}
                    </p>
                  </div>

                  <p
                    className="text-zinc-700"
                    style={{ fontSize: 13, lineHeight: 1.75 }}
                  >
                    {answerResult.explanation}
                  </p>

                  {answerResult.citation ? (
                    <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-4">
                      <p
                        className="text-zinc-500"
                        style={{
                          fontSize: 11,
                          fontWeight: 760,
                          textTransform: "uppercase",
                        }}
                      >
                        {quizCopy.citation}
                      </p>
                      <p
                        className="mt-2 text-zinc-700"
                        style={{ fontSize: 12.5, lineHeight: 1.6 }}
                      >
                        {answerResult.citation.book || quizCopy.textbook}
                        {answerResult.citation.page
                          ? `, ${t("library.pages")} ${answerResult.citation.page}`
                          : ""}
                      </p>
                      {answerResult.citation.quote ? (
                        <p
                          className="mt-2 text-zinc-500"
                          style={{ fontSize: 12.5, lineHeight: 1.7 }}
                        >
                          "{answerResult.citation.quote}"
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => void nextStep()}
                    disabled={isLoadingQuestion}
                    className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-zinc-950 px-5 text-white transition-colors hover:bg-black disabled:opacity-60"
                    style={{ fontSize: 13, fontWeight: 720 }}
                  >
                    {isLoadingQuestion ? (
                      <>
                        <RefreshCw size={15} className="animate-spin" />
                        {quizCopy.loadingQuestion}
                      </>
                    ) : questionNumber >= TOTAL_QUESTIONS ? (
                      t("quiz.finish")
                    ) : (
                      t("quiz.next")
                    )}
                  </button>
                </section>
              ) : (
                <section className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
                  <p
                    className="text-zinc-500"
                    style={{ fontSize: 13, lineHeight: 1.7 }}
                  >
                    {lang === "kz"
                      ? "Жауапты таңдаңыз. Samga түсіндірме мен дереккөзді келесі панельге шығарады."
                      : "Выберите ответ. Samga покажет объяснение и источник в правой панели."}
                  </p>
                </section>
              )}
            </aside>
          </div>
        </>
      )}

      {quizState === "finished" && (
        <section className="rounded-2xl border border-zinc-200 bg-white px-6 py-10 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-700">
            <Target size={24} />
          </div>
          <p
            className="text-zinc-500"
            style={{
              fontSize: 11,
              fontWeight: 760,
              textTransform: "uppercase",
            }}
          >
            {t("quiz.result")}
          </p>
          <p
            className="mt-3 text-zinc-950"
            style={{ fontSize: 48, fontWeight: 780, lineHeight: 1 }}
          >
            {score}/{TOTAL_QUESTIONS}
          </p>
          <p
            className="mt-3 text-zinc-500"
            style={{ fontSize: 14, lineHeight: 1.7 }}
          >
            {percent}% - {score} {t("quiz.correct")} {TOTAL_QUESTIONS}
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => void startQuiz()}
              className="inline-flex h-12 items-center justify-center rounded-lg bg-zinc-950 px-5 text-white transition-colors hover:bg-black"
              style={{ fontSize: 14, fontWeight: 720 }}
            >
              {t("quiz.tryAgain")}
            </button>
            <button
              type="button"
              onClick={resetToSetup}
              className="inline-flex h-12 items-center justify-center rounded-lg border border-zinc-200 bg-white px-5 text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
              style={{ fontSize: 14, fontWeight: 680 }}
            >
              {t("quiz.backToSubjects")}
            </button>
          </div>
        </section>
      )}

      {errorMessage ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
          <p style={{ fontSize: 12.5, lineHeight: 1.6 }}>{errorMessage}</p>
        </div>
      ) : null}

      <LimitReachedModal
        open={limitModal}
        onClose={() => setLimitModal(false)}
        counter="trainingCalls"
        onUpgrade={() => {
          setLimitModal(false);
          setPaywallModal(true);
        }}
      />
      <PaywallModal
        open={paywallModal}
        onClose={() => setPaywallModal(false)}
        feature="training"
      />
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

function PracticeCoverageStrip({
  coverage,
  lang,
}: {
  coverage: PracticeCoverage;
  lang: "ru" | "kz";
}) {
  const subtopics = coverage.subtopics?.filter(Boolean) ?? [];
  const gap = practiceGapSummary(coverage, lang);

  return (
    <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-800"
          style={{ fontSize: 11, fontWeight: 730 }}
        >
          <ShieldCheck size={13} />
          {practiceTrackLabel(coverage.track, lang)}
        </span>
        <span
          className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-zinc-600"
          style={{ fontSize: 11, fontWeight: 700 }}
        >
          {practiceConfidenceLabel(coverage.confidence, lang)}
        </span>
        {subtopics.slice(0, 3).map((subtopic) => (
          <span
            key={subtopic}
            className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-sky-800"
            style={{ fontSize: 11, fontWeight: 700 }}
          >
            {practiceSubtopicLabel(subtopic, lang)}
          </span>
        ))}
      </div>
      {gap ? (
        <p
          className="mt-2 text-zinc-500"
          style={{ fontSize: 12, lineHeight: 1.6 }}
        >
          {gap}
        </p>
      ) : null}
    </div>
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
        style={{ fontSize: 18, fontWeight: 760, lineHeight: 1.15 }}
      >
        {value}
      </p>
    </div>
  );
}
