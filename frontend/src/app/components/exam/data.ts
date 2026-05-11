import type {
  ExamData,
  ProfileSubjectKey,
  Question,
  SubjectKey,
  SubjectSection,
} from "./types";
import { ApiError, apiGet } from "../../lib/api";

const EXPECTED_SECTION_COUNTS = [20, 10, 10, 40, 40];
const EXPECTED_SECTION_POINTS = [20, 10, 10, 50, 50];
const EXPECTED_TOTAL_QUESTIONS = 120;
const EXPECTED_TOTAL_POINTS = 140;
const DEFAULT_DURATION_SECONDS = 14400;

type ApiExamResponse = Partial<ExamData> & {
  timeLimit?: number;
  subjects?: SubjectSection[];
};

export class ExamGenerationError extends Error {
  detail?: unknown;

  constructor(message: string, detail?: unknown) {
    super(message);
    this.name = "ExamGenerationError";
    this.detail = detail;
  }
}

function isSubjectKey(value: unknown): value is SubjectKey {
  return typeof value === "string" && value.length > 0;
}

function validateQuestion(question: Question, sectionKey: SubjectKey): void {
  if (
    !question ||
    typeof question.id !== "string" ||
    question.id.length === 0
  ) {
    throw new ExamGenerationError(
      `Malformed question in ${sectionKey}: missing id.`,
    );
  }
  if (!["single", "multi", "context"].includes(question.type)) {
    throw new ExamGenerationError(
      `Malformed question ${question.id}: unsupported type ${question.type}.`,
    );
  }
  if (!question.stem?.ru || !question.stem?.kz) {
    throw new ExamGenerationError(
      `Malformed question ${question.id}: missing bilingual stem.`,
    );
  }
  if (!Array.isArray(question.options) || question.options.length < 2) {
    throw new ExamGenerationError(
      `Malformed question ${question.id}: missing options.`,
    );
  }
  if (!Array.isArray(question.correctIds) || question.correctIds.length === 0) {
    throw new ExamGenerationError(
      `Malformed question ${question.id}: missing correct answer.`,
    );
  }
  if (!Number.isFinite(question.maxPoints) || question.maxPoints <= 0) {
    throw new ExamGenerationError(
      `Malformed question ${question.id}: invalid max points.`,
    );
  }
}

function normalizeExamResponse(data: ApiExamResponse): ExamData {
  const subjects = data.subjects ?? [];
  if (subjects.length !== 5) {
    throw new ExamGenerationError(
      "Exam bank returned an incomplete section set.",
      {
        expectedSections: 5,
        actualSections: subjects.length,
      },
    );
  }

  subjects.forEach((section, index) => {
    if (!isSubjectKey(section.key)) {
      throw new ExamGenerationError(
        `Exam section ${index + 1} is missing a valid key.`,
      );
    }
    const questionCount = section.questions?.length ?? 0;
    const expectedCount = EXPECTED_SECTION_COUNTS[index];
    const expectedPoints = EXPECTED_SECTION_POINTS[index];

    if (
      questionCount !== expectedCount ||
      section.maxPoints !== expectedPoints
    ) {
      throw new ExamGenerationError(
        "Exam bank returned an invalid section shape.",
        {
          section: section.key,
          expectedQuestions: expectedCount,
          actualQuestions: questionCount,
          expectedMaxPoints: expectedPoints,
          actualMaxPoints: section.maxPoints,
        },
      );
    }

    section.questions.forEach((question) =>
      validateQuestion(question, section.key),
    );
  });

  const totalQuestions = subjects.reduce(
    (sum, subject) => sum + subject.questions.length,
    0,
  );
  const totalMaxPoints = subjects.reduce(
    (sum, subject) => sum + subject.maxPoints,
    0,
  );

  if (
    totalQuestions !== EXPECTED_TOTAL_QUESTIONS ||
    totalMaxPoints !== EXPECTED_TOTAL_POINTS
  ) {
    throw new ExamGenerationError("Exam bank returned invalid totals.", {
      expectedTotalQuestions: EXPECTED_TOTAL_QUESTIONS,
      actualTotalQuestions: totalQuestions,
      expectedTotalMaxPoints: EXPECTED_TOTAL_POINTS,
      actualTotalMaxPoints: totalMaxPoints,
    });
  }

  return {
    subjects,
    totalQuestions,
    totalMaxPoints,
    durationSeconds:
      data.durationSeconds || data.timeLimit || DEFAULT_DURATION_SECONDS,
  };
}

export async function generateExam(
  profile1: ProfileSubjectKey,
  profile2: ProfileSubjectKey,
): Promise<ExamData> {
  try {
    const data = await apiGet<ApiExamResponse>(
      `/exam/generate?sub1=${encodeURIComponent(profile1)}&sub2=${encodeURIComponent(profile2)}`,
    );
    return normalizeExamResponse(data);
  } catch (error) {
    if (error instanceof ApiError && error.status === 503) {
      throw new ExamGenerationError(
        "Samga exam bank is incomplete for this subject pair.",
        error.detail,
      );
    }
    throw error;
  }
}

export function scoreQuestion(
  question: Question,
  selectedIds: string[],
): number {
  if (selectedIds.length === 0) return 0;

  if (question.type === "single" || question.type === "context") {
    return selectedIds.length === 1 && selectedIds[0] === question.correctIds[0]
      ? 1
      : 0;
  }

  const correctSet = new Set(question.correctIds);
  const selectedSet = new Set(selectedIds);

  let errors = 0;
  for (const correctId of correctSet) {
    if (!selectedSet.has(correctId)) errors++;
  }
  for (const selectedId of selectedSet) {
    if (!correctSet.has(selectedId)) errors++;
  }

  if (errors === 0) return 2;
  if (errors === 1) return 1;
  return 0;
}
