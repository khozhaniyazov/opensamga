import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Flag,
  Clock,
  Send,
  X,
  AlertTriangle,
  Calculator,
  Table2,
  User,
} from "lucide-react";
import { useLang } from "../LanguageContext";
import type {
  ExamData,
  QuestionState,
  Question,
  ExamResult,
  SubjectScore,
  SubjectKey,
} from "./types";
import {
  SUBJECT_SHORT,
  SUBJECT_NAMES,
  MIN_THRESHOLDS,
  CUMULATIVE_THRESHOLDS,
} from "./types";
import { scoreQuestion } from "./data";
import { apiPost } from "../../lib/api";

interface ExamEngineProps {
  examData: ExamData;
  onFinish: (result: ExamResult) => void;
  onQuit: () => void;
}

/* ── Initialize question states ── */
function initStates(exam: ExamData): QuestionState[][] {
  return exam.subjects.map((sub) =>
    sub.questions.map(() => ({
      selectedIds: [],
      flagged: false,
      viewed: false,
    })),
  );
}

/* ── Persistence: survive accidental reload of in-progress exam ── */
const PERSIST_KEY = "samga_exam_in_progress_v1";

type PersistedExam = {
  version: 1;
  signature: string;
  startedAt: number; // Date.now()
  activeSubject: number;
  activeQuestion: number;
  states: QuestionState[][];
};

type ExamSubmitResponse = {
  score: number;
  max_score: number;
  attempt_id: number;
  mistakes_created?: number;
  answered_count?: number;
  skipped_count?: number;
  wrong_answered_count?: number;
};

function hasMeaningfulSelection(answer: unknown): boolean {
  if (answer == null) return false;
  if (typeof answer === "string") return answer.trim().length > 0;
  if (Array.isArray(answer))
    return answer.some((item) => hasMeaningfulSelection(item));
  if (typeof answer === "object") {
    return Object.values(answer as Record<string, unknown>).some((value) =>
      hasMeaningfulSelection(value),
    );
  }
  return true;
}

function examSignature(exam: ExamData): string {
  const parts = exam.subjects
    .map((s) => `${s.key}:${s.questions.length}`)
    .join("|");
  return `${parts}#${exam.totalQuestions}#${exam.durationSeconds}`;
}

function loadPersisted(exam: ExamData): PersistedExam | null {
  try {
    const raw = sessionStorage.getItem(PERSIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedExam;
    if (parsed.version !== 1) return null;
    if (parsed.signature !== examSignature(exam)) return null;
    // Shape-check states
    if (
      !Array.isArray(parsed.states) ||
      parsed.states.length !== exam.subjects.length
    )
      return null;
    for (let i = 0; i < exam.subjects.length; i++) {
      const stateRow = parsed.states[i];
      const subj = exam.subjects[i];
      if (
        !subj ||
        !Array.isArray(stateRow) ||
        stateRow.length !== subj.questions.length
      )
        return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clearPersisted() {
  try {
    sessionStorage.removeItem(PERSIST_KEY);
  } catch {
    // ignore
  }
}

export function ExamEngine({ examData, onFinish, onQuit }: ExamEngineProps) {
  const { t, lang } = useLang();

  // Restore any in-progress attempt (matched by exam signature) on first render.
  const persisted = useMemo(() => loadPersisted(examData), [examData]);
  const startedAtRef = useRef<number>(persisted?.startedAt ?? Date.now());

  const [activeSubject, setActiveSubject] = useState(
    persisted?.activeSubject ?? 0,
  );
  const [activeQuestion, setActiveQuestion] = useState(
    persisted?.activeQuestion ?? 0,
  );
  const [states, setStates] = useState<QuestionState[][]>(() =>
    persisted ? persisted.states : initStates(examData),
  );
  const initialTimeLeft = useMemo(() => {
    const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
    return Math.max(0, examData.durationSeconds - elapsed);
  }, [examData.durationSeconds]);
  const [timeLeft, setTimeLeft] = useState(initialTimeLeft);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showCalc, setShowCalc] = useState(false);
  const [showPalette, setShowPalette] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.innerWidth >= 640;
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitStartedRef = useRef(false);

  // Persist snapshot whenever meaningful state changes
  useEffect(() => {
    const snapshot: PersistedExam = {
      version: 1,
      signature: examSignature(examData),
      startedAt: startedAtRef.current,
      activeSubject,
      activeQuestion,
      states,
    };
    try {
      sessionStorage.setItem(PERSIST_KEY, JSON.stringify(snapshot));
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  }, [activeSubject, activeQuestion, states, examData]);

  // Polish 2026-04-26: removed the empty-message `beforeunload` handler.
  // Reasoning: this used to show Chrome's generic "Changes you made may
  // not be saved" dialog on *every* exam-page reload, which was actively
  // misleading because the snapshot effect above persists every answer
  // + position to sessionStorage on each state change, and the timer
  // resumes from `startedAt` after reload. We were threatening data
  // loss that doesn't actually happen.

  // Timer — recomputed from startedAt each tick so a closed tab advances time correctly.
  useEffect(() => {
    const tick = () => {
      const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
      const remaining = Math.max(0, examData.durationSeconds - elapsed);
      setTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(iv);
        handleSubmit();
      }
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mark current question as viewed
  useEffect(() => {
    setStates((prev) => {
      const next = prev.map((s) => s.map((q) => ({ ...q })));
      if (next[activeSubject]?.[activeQuestion]) {
        next[activeSubject][activeQuestion].viewed = true;
      }
      return next;
    });
  }, [activeSubject, activeQuestion]);

  const currentSubject = examData.subjects[activeSubject];
  const currentQuestion = currentSubject?.questions?.[activeQuestion];
  const currentState = states[activeSubject]?.[activeQuestion];
  const currentQuestionCount = currentSubject?.questions.length ?? 0;

  // Navigation
  const goPrev = useCallback(() => {
    if (activeQuestion > 0) {
      setActiveQuestion((q) => q - 1);
    }
  }, [activeQuestion]);

  const goNext = useCallback(() => {
    if (activeQuestion < currentQuestionCount - 1) {
      setActiveQuestion((q) => q + 1);
    }
  }, [activeQuestion, currentQuestionCount]);

  // Answer selection
  const handleSelect = useCallback(
    (optionId: string) => {
      setStates((prev) => {
        const next = prev.map((s) => s.map((q) => ({ ...q })));
        const subjStates = next[activeSubject];
        const qState = subjStates?.[activeQuestion];
        const question =
          examData.subjects[activeSubject]?.questions[activeQuestion];
        if (!qState || !question) return prev;

        if (question.type === "single" || question.type === "context") {
          qState.selectedIds = [optionId];
        } else {
          // Multi: toggle
          const idx = qState.selectedIds.indexOf(optionId);
          if (idx >= 0) {
            qState.selectedIds = qState.selectedIds.filter(
              (id) => id !== optionId,
            );
          } else {
            if (qState.selectedIds.length < 3) {
              qState.selectedIds = [...qState.selectedIds, optionId];
            }
            // Max 3 — don't add more
          }
        }
        return next;
      });
    },
    [activeSubject, activeQuestion, examData],
  );

  // Flag toggle
  const toggleFlag = useCallback(() => {
    setStates((prev) => {
      const next = prev.map((s) => s.map((q) => ({ ...q })));
      const qs = next[activeSubject]?.[activeQuestion];
      if (!qs) return prev;
      qs.flagged = !qs.flagged;
      return next;
    });
  }, [activeSubject, activeQuestion]);

  // Calculate totals for confirmation modal
  const examSummary = useMemo(() => {
    let totalAnswered = 0;
    let totalFlagged = 0;
    let totalQuestions = 0;
    const perSubject: {
      key: SubjectKey;
      answered: number;
      flagged: number;
      total: number;
    }[] = [];

    examData.subjects.forEach((sub, si) => {
      let answered = 0;
      let flagged = 0;
      (states[si] ?? []).forEach((qs) => {
        if (qs.selectedIds.length > 0) answered++;
        if (qs.flagged) flagged++;
      });
      totalAnswered += answered;
      totalFlagged += flagged;
      totalQuestions += sub.questions.length;
      perSubject.push({
        key: sub.key,
        answered,
        flagged,
        total: sub.questions.length,
      });
    });

    return { totalAnswered, totalFlagged, totalQuestions, perSubject };
  }, [states, examData]);

  // Submit exam
  const handleSubmit = useCallback(async () => {
    if (submitStartedRef.current) return;
    submitStartedRef.current = true;
    setIsSubmitting(true);

    const timeUsed = examData.durationSeconds - timeLeft;
    const subjectScores: SubjectScore[] = examData.subjects.map((sub, si) => {
      let earned = 0;
      let answered = 0;
      sub.questions.forEach((q, qi) => {
        const qs = states[si]?.[qi];
        if (!qs) return;
        if (qs.selectedIds.length > 0) answered++;
        earned += scoreQuestion(q, qs.selectedIds);
      });

      const isProfile = si >= 3;
      const minKey = isProfile ? (si === 3 ? "profile1" : "profile2") : sub.key;
      const minRequired = MIN_THRESHOLDS[minKey] ?? 0;

      return {
        key: sub.key,
        earned,
        max: sub.maxPoints,
        answered,
        total: sub.questions.length,
        passedMinimum: earned >= minRequired,
      };
    });

    const totalEarned = subjectScores.reduce((s, sc) => s + sc.earned, 0);
    const passedAllMinimums = subjectScores.every((sc) => sc.passedMinimum);
    const totalAnswered = subjectScores.reduce((s, sc) => s + sc.answered, 0);
    const skippedQuestions = examData.totalQuestions - totalAnswered;
    const wrongAnsweredQuestions = examData.subjects.reduce(
      (count, sub, si) => {
        return (
          count +
          sub.questions.reduce((subjectCount, q, qi) => {
            const selectedIds = states[si]?.[qi]?.selectedIds ?? [];
            if (!hasMeaningfulSelection(selectedIds)) {
              return subjectCount;
            }
            return (
              subjectCount +
              (scoreQuestion(q, selectedIds) < q.maxPoints ? 1 : 0)
            );
          }, 0)
        );
      },
      0,
    );

    const result: ExamResult = {
      subjectScores,
      totalEarned,
      totalMax: examData.totalMaxPoints,
      passedAllMinimums,
      eligibility: {
        pedagogy:
          passedAllMinimums && totalEarned >= CUMULATIVE_THRESHOLDS.pedagogy,
        medicine:
          passedAllMinimums && totalEarned >= CUMULATIVE_THRESHOLDS.medicine,
        national:
          passedAllMinimums && totalEarned >= CUMULATIVE_THRESHOLDS.national,
        agriculture:
          passedAllMinimums && totalEarned >= CUMULATIVE_THRESHOLDS.agriculture,
        standard:
          passedAllMinimums && totalEarned >= CUMULATIVE_THRESHOLDS.standard,
      },
      totalAnswered,
      totalQuestions: examData.totalQuestions,
      timeUsedSeconds: timeUsed,
      skippedQuestions,
      wrongAnsweredQuestions,
      mistakesQueued: wrongAnsweredQuestions,
    };

    clearPersisted();
    try {
      const answers: Record<string, string[]> = {};
      const questions = examData.subjects.flatMap((sub, si) =>
        sub.questions.map((q, qi) => {
          const selectedIds = states[si]?.[qi]?.selectedIds ?? [];
          answers[q.id] = selectedIds;
          const optionMap = Object.fromEntries(
            q.options.map((opt, idx) => [
              opt.id,
              `${String.fromCharCode(65 + idx)}. ${opt.text[lang] || opt.text.ru || opt.id}`,
            ]),
          );

          return {
            id: q.id,
            type: q.type,
            format: q.format,
            correct_answer: q.correctIds,
            max_points: q.maxPoints,
            subject: sub.key,
            question_text: q.stem[lang] || q.stem.ru,
            options: optionMap,
          };
        }),
      );

      const persistedResult = await apiPost<ExamSubmitResponse>(
        "/exam/submit",
        {
          subjects: examData.subjects.map((sub) => sub.key),
          total_questions: examData.totalQuestions,
          time_limit_seconds: examData.durationSeconds,
          started_at: new Date(startedAtRef.current).toISOString(),
          time_taken_seconds: timeUsed,
          answers,
          questions,
        },
      );

      if (Number.isFinite(persistedResult.score)) {
        result.totalEarned = persistedResult.score;
        result.totalMax = persistedResult.max_score || result.totalMax;
      }
      if (Number.isFinite(persistedResult.skipped_count)) {
        result.skippedQuestions =
          persistedResult.skipped_count ?? result.skippedQuestions;
      }
      if (Number.isFinite(persistedResult.answered_count)) {
        result.totalAnswered =
          persistedResult.answered_count ?? result.totalAnswered;
      }
      if (Number.isFinite(persistedResult.wrong_answered_count)) {
        result.wrongAnsweredQuestions =
          persistedResult.wrong_answered_count ?? result.wrongAnsweredQuestions;
      }
      if (Number.isFinite(persistedResult.mistakes_created)) {
        result.mistakesQueued =
          persistedResult.mistakes_created ?? result.mistakesQueued;
      }
      result.skippedQuestions = Math.max(
        0,
        result.totalQuestions - result.totalAnswered,
      );
    } catch (error) {
      console.error("Failed to persist exam attempt:", error);
    } finally {
      setIsSubmitting(false);
    }

    onFinish(result);
  }, [examData, states, timeLeft, onFinish, lang]);

  // Timer formatting
  const timerStr = useMemo(() => {
    const h = Math.floor(timeLeft / 3600);
    const m = Math.floor((timeLeft % 3600) / 60);
    const s = timeLeft % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, [timeLeft]);

  const isLowTime = timeLeft < 900; // 15 minutes
  const currentSubjectAnswered = currentSubject
    ? (states[activeSubject] ?? []).filter(
        (questionState) => questionState.selectedIds.length > 0,
      ).length
    : 0;
  const currentSubjectFlagged = currentSubject
    ? (states[activeSubject] ?? []).filter(
        (questionState) => questionState.flagged,
      ).length
    : 0;

  if (!currentSubject || !currentQuestion || !currentState) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-zinc-50 p-6">
        <div className="w-full max-w-md rounded-2xl border border-zinc-200/80 bg-white p-6 ">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-red-200 bg-red-50">
            <AlertTriangle size={18} className="text-red-600" />
          </div>
          <h2
            className="mb-2 text-zinc-900"
            style={{ fontSize: 20, fontWeight: 760 }}
          >
            {t("error.title")}
          </h2>
          <p
            className="mb-5 text-zinc-500"
            style={{ fontSize: 13, lineHeight: 1.75 }}
          >
            {t("error.desc")}
          </p>
          <button
            onClick={onQuit}
            className="inline-flex h-11 items-center justify-center rounded-lg bg-zinc-950 px-4 text-white transition-colors hover:bg-black"
            style={{ fontSize: 13, fontWeight: 700 }}
          >
            {t("guard.back")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[200] overflow-hidden bg-zinc-50 text-zinc-950">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.82),transparent_44%),linear-gradient(180deg,#f5f2ea_0%,#ece8de_100%)]" />

      <div className="relative flex h-full flex-col">
        <header className="shrink-0 border-b border-zinc-200/80 bg-zinc-50 px-4 py-4 backdrop-blur sm:px-6">
          <div className="mx-auto max-w-7xl">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span
                    className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-zinc-700"
                    style={{ fontSize: 11, fontWeight: 700 }}
                  >
                    Samga Focus
                  </span>
                  <span
                    className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-zinc-500"
                    style={{ fontSize: 11, fontWeight: 700 }}
                  >
                    {SUBJECT_NAMES[currentSubject.key][lang]}
                  </span>
                  <span
                    className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-zinc-500"
                    style={{ fontSize: 11, fontWeight: 700 }}
                  >
                    {lang === "ru"
                      ? `Вопрос ${activeQuestion + 1} / ${currentSubject.questions.length}`
                      : `${activeQuestion + 1} / ${currentSubject.questions.length} сұрақ`}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <div className="hidden items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-zinc-600 sm:inline-flex">
                    <User size={14} className="text-zinc-500" />
                    <span style={{ fontSize: 12.5, fontWeight: 700 }}>
                      {t("examEngine.candidate")}
                    </span>
                  </div>
                  <p
                    className="text-zinc-600"
                    style={{ fontSize: 13, lineHeight: 1.7 }}
                  >
                    {lang === "ru"
                      ? `${currentSubjectAnswered}/${currentSubject.questions.length} отвечено • ${currentSubjectFlagged} отмечено`
                      : `${currentSubjectAnswered}/${currentSubject.questions.length} жауап берілді • ${currentSubjectFlagged} белгіленді`}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => setShowCalc(!showCalc)}
                  className={`inline-flex h-11 items-center justify-center gap-2 rounded-lg border px-4 transition-colors ${
                    showCalc
                      ? "border-amber-200 bg-amber-50 text-amber-700"
                      : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-950"
                  }`}
                  title={t("examEngine.calculator")}
                  style={{ fontSize: 12.5, fontWeight: 700 }}
                >
                  <Calculator size={15} />
                  <span className="hidden sm:inline">
                    {t("examEngine.calculator")}
                  </span>
                </button>

                <div
                  className={`rounded-xl border px-4 py-3 ${
                    isLowTime
                      ? "border-red-200 bg-red-50/90 text-red-700"
                      : "border-zinc-200/80 bg-white text-zinc-800"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Clock size={15} />
                    <span
                      className={isLowTime ? "animate-pulse" : ""}
                      style={{
                        fontSize: 20,
                        fontWeight: 760,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {timerStr}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
              {examData.subjects.map((sub, si) => {
                const isActive = si === activeSubject;
                const subStates = states[si] ?? [];
                const answered = subStates.filter(
                  (questionState) => questionState.selectedIds.length > 0,
                ).length;

                return (
                  <button
                    key={si}
                    onClick={() => {
                      setActiveSubject(si);
                      setActiveQuestion(0);
                    }}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 whitespace-nowrap transition-all ${
                      isActive
                        ? "border-zinc-900 bg-zinc-950 text-white "
                        : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900"
                    }`}
                    style={{ fontSize: 11, fontWeight: 700 }}
                  >
                    {SUBJECT_SHORT[sub.key][lang]}
                    <span
                      className={isActive ? "text-white/70" : "text-zinc-500"}
                    >
                      {answered}/{sub.questions.length}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </header>

        <div className="flex flex-1 flex-col overflow-hidden px-4 py-4 sm:px-6">
          <div className="mx-auto flex h-full w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-zinc-200/80 bg-white backdrop-blur">
            <div className="flex-1 overflow-y-auto bg-zinc-50">
              {currentQuestion.type === "context" &&
              currentQuestion.contextStimulus ? (
                <div className="grid h-full gap-4 p-4 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:p-6">
                  <div className="overflow-y-auto rounded-2xl border border-zinc-200/80 bg-white p-5 sm:p-6">
                    <div className="mb-4 flex items-center gap-2">
                      <Table2 size={14} className="text-amber-700" />
                      <span
                        className="text-amber-700"
                        style={{
                          fontSize: 11,
                          fontWeight: 760,
                          textTransform: "uppercase",
                          letterSpacing: "0.12em",
                        }}
                      >
                        {t("examEngine.context")}
                      </span>
                    </div>
                    <p
                      className="whitespace-pre-line text-zinc-700"
                      style={{ fontSize: 14, lineHeight: 1.85 }}
                    >
                      {currentQuestion.contextStimulus[lang]}
                    </p>
                  </div>

                  <div className="overflow-y-auto">
                    <QuestionCanvas
                      question={currentQuestion}
                      state={currentState}
                      questionIndex={activeQuestion}
                      totalQuestions={currentSubject.questions.length}
                      onSelect={handleSelect}
                      lang={lang}
                      t={t}
                    />
                  </div>
                </div>
              ) : (
                <div className="mx-auto max-w-4xl p-4 sm:p-6">
                  <QuestionCanvas
                    question={currentQuestion}
                    state={currentState}
                    questionIndex={activeQuestion}
                    totalQuestions={currentSubject.questions.length}
                    onSelect={handleSelect}
                    lang={lang}
                    t={t}
                  />
                </div>
              )}
            </div>

            <footer className="shrink-0 border-t border-zinc-200/80 bg-zinc-50 px-4 py-4 sm:px-6">
              {showPalette ? (
                <div className="mb-4 flex flex-wrap gap-2">
                  {currentSubject.questions.map((_, qi) => {
                    const qs = states[activeSubject]?.[qi];
                    if (!qs) return null;
                    const isActive = qi === activeQuestion;
                    let tone = "border-zinc-200 bg-white text-zinc-500";
                    if (qs.flagged)
                      tone = "border-amber-200 bg-amber-50 text-amber-700";
                    else if (qs.selectedIds.length > 0)
                      tone =
                        "border-emerald-200 bg-emerald-50 text-emerald-700";
                    else if (qs.viewed)
                      tone = "border-zinc-200 bg-[#f3f0e8] text-zinc-600";

                    return (
                      <button
                        key={qi}
                        onClick={() => setActiveQuestion(qi)}
                        className={`inline-flex h-10 min-w-10 items-center justify-center rounded-2xl border text-center transition-all ${tone} ${
                          isActive
                            ? "ring-2 ring-zinc-900/20 ring-offset-1 ring-offset-zinc-50"
                            : ""
                        }`}
                        style={{ fontSize: 11, fontWeight: 700 }}
                      >
                        {qi + 1}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={goPrev}
                  disabled={activeQuestion === 0}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-4 text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-35"
                  style={{ fontSize: 13, fontWeight: 700 }}
                >
                  <ChevronLeft size={16} />
                  <span className="hidden sm:inline">
                    {t("examEngine.prev")}
                  </span>
                </button>

                <button
                  onClick={toggleFlag}
                  className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border px-4 transition-colors ${
                    currentState.flagged
                      ? "border-amber-200 bg-amber-50 text-amber-700"
                      : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-950"
                  }`}
                  style={{ fontSize: 13, fontWeight: 700 }}
                >
                  <Flag size={14} />
                  <span className="hidden sm:inline">
                    {currentState.flagged
                      ? t("examEngine.flagged")
                      : t("examEngine.flag")}
                  </span>
                </button>

                <button
                  onClick={() => setShowPalette(!showPalette)}
                  className="inline-flex min-h-[44px] items-center rounded-lg border border-zinc-200 bg-white px-4 text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-950 sm:hidden"
                  style={{ fontSize: 13, fontWeight: 700 }}
                >
                  {t("examEngine.palette")}
                </button>

                <div className="flex-1" />

                <span
                  className="hidden text-zinc-500 sm:block"
                  style={{ fontSize: 12.5, fontWeight: 700 }}
                >
                  {lang === "ru"
                    ? `Вопрос ${activeQuestion + 1} из ${currentSubject.questions.length}`
                    : `${activeQuestion + 1} / ${currentSubject.questions.length} сұрақ`}
                </span>

                <button
                  onClick={goNext}
                  disabled={
                    activeQuestion === currentSubject.questions.length - 1
                  }
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-4 text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-35"
                  style={{ fontSize: 13, fontWeight: 700 }}
                >
                  <span className="hidden sm:inline">
                    {t("examEngine.next")}
                  </span>
                  <ChevronRight size={16} />
                </button>

                <button
                  onClick={() => setShowConfirm(true)}
                  disabled={isSubmitting}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-zinc-950 px-4 text-white transition-colors hover:bg-black disabled:cursor-wait disabled:opacity-60"
                  style={{ fontSize: 13, fontWeight: 720 }}
                >
                  <Send size={14} />
                  <span className="hidden sm:inline">
                    {t("examEngine.finish")}
                  </span>
                </button>
              </div>
            </footer>
          </div>
        </div>
      </div>

      {/* ═══ CALCULATOR OVERLAY ═══ */}
      {showCalc && (
        <SimpleCalculator onClose={() => setShowCalc(false)} t={t} />
      )}

      {/* ═══ CONFIRM SUBMISSION MODAL ═══ */}
      {showConfirm && (
        <ConfirmModal
          summary={examSummary}
          onConfirm={() => {
            setShowConfirm(false);
            handleSubmit();
          }}
          onCancel={() => setShowConfirm(false)}
          lang={lang}
          t={t}
        />
      )}
    </div>
  );
}

/* ── Question Canvas ── */
function QuestionCanvas({
  question,
  state,
  questionIndex,
  totalQuestions,
  onSelect,
  lang,
  t,
}: {
  question: Question;
  state: QuestionState;
  questionIndex: number;
  totalQuestions: number;
  onSelect: (optionId: string) => void;
  lang: "ru" | "kz";
  t: (key: string) => string;
}) {
  const isMulti = question.type === "multi";

  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-zinc-200/80 pb-5">
        <span
          className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-zinc-500"
          style={{
            fontSize: 11,
            fontWeight: 760,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
          }}
        >
          {lang === "ru"
            ? `Вопрос ${questionIndex + 1} / ${totalQuestions}`
            : `${questionIndex + 1} / ${totalQuestions} сұрақ`}
        </span>
        {isMulti ? (
          <>
            <span
              className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-violet-700"
              style={{ fontSize: 11, fontWeight: 760 }}
            >
              {t("examEngine.multiAnswer")}
            </span>
            <span
              className="text-zinc-500"
              style={{ fontSize: 12.5, fontWeight: 600 }}
            >
              {t("examEngine.selectUpTo3")}
            </span>
          </>
        ) : null}
      </div>

      <p
        className="mb-6 text-zinc-900"
        style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.5 }}
      >
        {question.stem[lang]}
      </p>

      <div className="space-y-3">
        {question.options.map((opt, idx) => {
          const isSelected = state.selectedIds.includes(opt.id);
          const letter = String.fromCharCode(65 + idx);

          return (
            <button
              key={opt.id}
              onClick={() => onSelect(opt.id)}
              className={`flex min-h-[56px] w-full items-start gap-3 rounded-xl border px-4 py-4 text-left transition-all touch-manipulation ${
                isSelected
                  ? "border-amber-300 bg-amber-50/80 "
                  : "border-zinc-200/80 bg-zinc-50 hover:border-zinc-300 hover:bg-white"
              }`}
            >
              <div
                className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center ${
                  isMulti ? "rounded-2xl" : "rounded-full"
                } border-2 transition-colors ${
                  isSelected
                    ? "border-amber-500 bg-amber-500"
                    : "border-zinc-300 bg-white"
                }`}
              >
                {isSelected ? (
                  <div
                    className={`${
                      isMulti
                        ? "h-2.5 w-3 border-b-2 border-l-2 border-white -translate-y-0.5 -rotate-45"
                        : "h-2.5 w-2.5 rounded-full bg-white"
                    }`}
                  />
                ) : (
                  <span
                    className="text-zinc-500"
                    style={{ fontSize: 11, fontWeight: 800 }}
                  >
                    {letter}
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <span
                  className="text-zinc-700"
                  style={{ fontSize: 14.5, lineHeight: 1.75 }}
                >
                  {opt.text[lang]}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Confirm submission modal ── */
function ConfirmModal({
  summary,
  onConfirm,
  onCancel,
  lang,
  t,
}: {
  summary: {
    totalAnswered: number;
    totalFlagged: number;
    totalQuestions: number;
    perSubject: {
      key: SubjectKey;
      answered: number;
      flagged: number;
      total: number;
    }[];
  };
  onConfirm: () => void;
  onCancel: () => void;
  lang: "ru" | "kz";
  t: (key: string) => string;
}) {
  const unanswered = summary.totalQuestions - summary.totalAnswered;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onCancel} />
      <div className="relative w-full max-w-lg rounded-2xl border border-zinc-200/80 bg-zinc-50 p-6 shadow-xl">
        <button
          onClick={onCancel}
          className="absolute right-4 top-4 text-zinc-500 transition-colors hover:text-zinc-700"
        >
          <X size={18} />
        </button>

        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50">
          <AlertTriangle size={20} className="text-amber-600" />
        </div>

        <h3
          className="mb-1 text-zinc-900"
          style={{ fontSize: 24, fontWeight: 760, lineHeight: 1.08 }}
        >
          {t("examEngine.confirmTitle")}
        </h3>

        {unanswered > 0 && (
          <p
            className="mb-3 text-red-600"
            style={{ fontSize: 13, fontWeight: 600 }}
          >
            {lang === "ru"
              ? `У вас ${unanswered} вопросов без ответов.`
              : `Сізде ${unanswered} жауап берілмеген сұрақ бар.`}
          </p>
        )}

        {summary.totalFlagged > 0 && (
          <p
            className="mb-3 text-amber-700"
            style={{ fontSize: 13, fontWeight: 600 }}
          >
            {lang === "ru"
              ? `${summary.totalFlagged} вопросов отмечены для проверки.`
              : `${summary.totalFlagged} сұрақ тексеру үшін белгіленген.`}
          </p>
        )}

        <div className="mb-5 space-y-2 rounded-xl border border-zinc-200/80 bg-white px-4 py-4">
          {summary.perSubject.map((s) => (
            <div
              key={s.key}
              className="flex items-center justify-between gap-3"
            >
              <span
                className="text-zinc-600"
                style={{ fontSize: 12.5, fontWeight: 600 }}
              >
                {SUBJECT_NAMES[s.key][lang]}
              </span>
              <span
                className={`${
                  s.answered < s.total ? "text-red-500" : "text-emerald-600"
                }`}
                style={{ fontSize: 12.5, fontWeight: 700 }}
              >
                {s.answered}/{s.total}
              </span>
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-zinc-950 py-3 text-white transition-colors hover:bg-black"
            style={{ fontSize: 14, fontWeight: 720 }}
          >
            {t("examEngine.confirmSubmit")}
          </button>
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-zinc-200 bg-white py-3 text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-950"
            style={{ fontSize: 14, fontWeight: 700 }}
          >
            {t("examEngine.continueExam")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Simple Calculator ── */
function SimpleCalculator({
  onClose,
  t,
}: {
  onClose: () => void;
  t: (key: string) => string;
}) {
  const [display, setDisplay] = useState("0");
  const [pending, setPending] = useState<string | null>(null);
  const [op, setOp] = useState<string | null>(null);
  const [fresh, setFresh] = useState(true);

  const input = (val: string) => {
    if (fresh) {
      setDisplay(val);
      setFresh(false);
    } else {
      setDisplay((d) => (d === "0" ? val : d + val));
    }
  };

  const doOp = (nextOp: string) => {
    if (pending && op) {
      const result = calc(Number(pending), Number(display), op);
      setDisplay(String(result));
      setPending(String(result));
    } else {
      setPending(display);
    }
    setOp(nextOp);
    setFresh(true);
  };

  const equals = () => {
    if (pending && op) {
      const result = calc(Number(pending), Number(display), op);
      setDisplay(String(result));
      setPending(null);
      setOp(null);
      setFresh(true);
    }
  };

  const clear = () => {
    setDisplay("0");
    setPending(null);
    setOp(null);
    setFresh(true);
  };

  const calc = (a: number, b: number, o: string) => {
    switch (o) {
      case "+":
        return a + b;
      case "-":
        return a - b;
      case "×":
        return a * b;
      case "÷":
        return b !== 0 ? a / b : 0;
      default:
        return b;
    }
  };

  const buttons = [
    "7",
    "8",
    "9",
    "÷",
    "4",
    "5",
    "6",
    "×",
    "1",
    "2",
    "3",
    "-",
    "0",
    ".",
    "=",
    "+",
  ];

  return (
    <div className="fixed bottom-20 right-4 z-[250] w-64 rounded-xl border border-zinc-200/80 bg-white shadow-lg sm:right-8">
      <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
        <span
          className="text-zinc-700"
          style={{ fontSize: 12.5, fontWeight: 700 }}
        >
          {t("examEngine.calculator")}
        </span>
        <button
          onClick={onClose}
          className="text-zinc-500 transition-colors hover:text-zinc-700"
        >
          <X size={14} />
        </button>
      </div>
      <div className="border-b border-zinc-100 bg-zinc-50 px-4 py-3 text-right">
        <span
          className="text-zinc-800"
          style={{
            fontSize: 24,
            fontWeight: 760,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {display}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2 p-3">
        <button
          onClick={clear}
          className="col-span-4 rounded-lg border border-red-200 bg-red-50 py-2.5 text-red-600 transition-colors hover:bg-red-100"
          style={{ fontSize: 12, fontWeight: 700 }}
        >
          C
        </button>
        {buttons.map((b) => (
          <button
            key={b}
            onClick={() => {
              if (b === "=") equals();
              else if (["+", "-", "×", "÷"].includes(b)) doOp(b);
              else input(b);
            }}
            className={`rounded-lg border py-2.5 transition-colors ${
              ["+", "-", "×", "÷"].includes(b)
                ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                : b === "="
                  ? "border-zinc-950 bg-zinc-950 text-white hover:bg-black"
                  : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
            }`}
            style={{ fontSize: 14, fontWeight: 700 }}
          >
            {b}
          </button>
        ))}
      </div>
    </div>
  );
}
