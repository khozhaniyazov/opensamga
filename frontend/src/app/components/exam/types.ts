/* ── ЕНТ/ҰБТ Exam Engine Types ── */

export type Lang = "ru" | "kz";
export type Bilingual = { ru: string; kz: string };

/* ── Subject Keys ── */
// Mandatory (core) subjects
export type MandatorySubjectKey = "histKz" | "readLit" | "mathLit";

// Profile (elective) subjects
export type ProfileSubjectKey =
  | "math"
  | "physics"
  | "chemistry"
  | "biology"
  | "geography"
  | "worldHist"
  | "compSci"
  | "law"
  | "foreignLang"
  | "langLit";

export type SubjectKey = MandatorySubjectKey | ProfileSubjectKey;

/* ── Question Types ── */
export type QuestionType = "single" | "multi" | "context";

export interface Option {
  id: string;
  text: Bilingual;
}

export interface Question {
  id: string;
  type: QuestionType;
  format?: string;
  stem: Bilingual;
  options: Option[];
  correctIds: string[]; // ids of correct options
  maxPoints: number; // 1 for single/context, 2 for multi
  contextStimulus?: Bilingual; // shared stimulus for context questions
  contextGroupId?: string; // groups context questions
}

/* ── Per-question runtime state ── */
export interface QuestionState {
  selectedIds: string[];
  flagged: boolean;
  viewed: boolean;
}

/* ── Subject section ── */
export interface SubjectSection {
  key: SubjectKey;
  questions: Question[];
  maxPoints: number; // sum of all question maxPoints
}

/* ── Full exam data ── */
export interface ExamData {
  subjects: SubjectSection[];
  totalQuestions: number; // 120
  totalMaxPoints: number; // 140
  durationSeconds: number; // 14400 (240 min)
}

/* ── Scoring result per subject ── */
export interface SubjectScore {
  key: SubjectKey;
  earned: number;
  max: number;
  answered: number;
  total: number;
  passedMinimum: boolean;
}

/* ── Full exam result ── */
export interface ExamResult {
  subjectScores: SubjectScore[];
  totalEarned: number;
  totalMax: number; // 140
  passedAllMinimums: boolean;
  eligibility: {
    pedagogy: boolean; // ≥75
    medicine: boolean; // ≥70
    national: boolean; // ≥65
    agriculture: boolean; // ≥60
    standard: boolean; // ≥50
  };
  totalAnswered: number;
  totalQuestions: number;
  timeUsedSeconds: number;
  skippedQuestions: number;
  wrongAnsweredQuestions: number;
  mistakesQueued: number;
}

/* ── Valid profile subject pairings ── */
export interface SubjectPairing {
  sub1: ProfileSubjectKey;
  sub2: ProfileSubjectKey;
  trajectory: Bilingual;
}

export const VALID_PAIRINGS: SubjectPairing[] = [
  {
    sub1: "math",
    sub2: "physics",
    trajectory: {
      ru: "Инженерия, архитектура, авиация",
      kz: "Инженерия, сәулет, авиация",
    },
  },
  {
    sub1: "math",
    sub2: "compSci",
    trajectory: {
      ru: "IT, программная инженерия, кибербезопасность",
      kz: "IT, бағдарламалық инженерия, киберқауіпсіздік",
    },
  },
  {
    sub1: "math",
    sub2: "geography",
    trajectory: {
      ru: "Экономика, финансы, менеджмент",
      kz: "Экономика, қаржы, менеджмент",
    },
  },
  {
    sub1: "biology",
    sub2: "chemistry",
    trajectory: {
      ru: "Медицина, фармация, ветеринария",
      kz: "Медицина, фармация, ветеринария",
    },
  },
  {
    sub1: "biology",
    sub2: "geography",
    trajectory: {
      ru: "Экология, агрономия, лесное хозяйство",
      kz: "Экология, агрономия, орман шаруашылығы",
    },
  },
  {
    sub1: "worldHist",
    sub2: "geography",
    trajectory: {
      ru: "Международные отношения, регионоведение",
      kz: "Халықаралық қатынастар, аймақтану",
    },
  },
  {
    sub1: "worldHist",
    sub2: "law",
    trajectory: {
      ru: "Юриспруденция, международное право",
      kz: "Құқықтану, халықаралық құқық",
    },
  },
  {
    sub1: "foreignLang",
    sub2: "worldHist",
    trajectory: {
      ru: "Переводоведение, филология, дипломатия",
      kz: "Аударматану, филология, дипломатия",
    },
  },
  {
    sub1: "chemistry",
    sub2: "physics",
    trajectory: {
      ru: "Химическая инженерия, нефтехимия",
      kz: "Химиялық инженерия, мұнай химиясы",
    },
  },
];

/* ── Subject display names ── */
export const SUBJECT_NAMES: Record<SubjectKey, Bilingual> = {
  histKz: { ru: "История Казахстана", kz: "Қазақстан тарихы" },
  readLit: { ru: "Грамотность чтения", kz: "Оқу сауаттылығы" },
  mathLit: { ru: "Математическая грамотность", kz: "Математикалық сауаттылық" },
  math: { ru: "Математика", kz: "Математика" },
  physics: { ru: "Физика", kz: "Физика" },
  chemistry: { ru: "Химия", kz: "Химия" },
  biology: { ru: "Биология", kz: "Биология" },
  geography: { ru: "География", kz: "География" },
  worldHist: { ru: "Всемирная история", kz: "Дүниежүзі тарихы" },
  compSci: { ru: "Информатика", kz: "Информатика" },
  law: { ru: "Основы права", kz: "Құқық негіздері" },
  foreignLang: { ru: "Иностранный язык", kz: "Шет тілі" },
  langLit: { ru: "Язык и литература", kz: "Тіл және әдебиет" },
};

/* ── Short subject names for tabs ── */
export const SUBJECT_SHORT: Record<SubjectKey, Bilingual> = {
  histKz: { ru: "Ист. КЗ", kz: "ҚР тар." },
  readLit: { ru: "Гр. чтения", kz: "Оқу сау." },
  mathLit: { ru: "Мат. гр.", kz: "Мат. сау." },
  math: { ru: "Математика", kz: "Математика" },
  physics: { ru: "Физика", kz: "Физика" },
  chemistry: { ru: "Химия", kz: "Химия" },
  biology: { ru: "Биология", kz: "Биология" },
  geography: { ru: "География", kz: "География" },
  worldHist: { ru: "Всем. ист.", kz: "Дүниеж. тар." },
  compSci: { ru: "Информ.", kz: "Информ." },
  law: { ru: "Осн. права", kz: "Құқ. нег." },
  foreignLang: { ru: "Ин. язык", kz: "Шет тілі" },
  langLit: { ru: "Язык и лит.", kz: "Тіл, әдеб." },
};

/* ── Minimum score thresholds ── */
export const MIN_THRESHOLDS: Record<string, number> = {
  histKz: 5,
  readLit: 3,
  mathLit: 3,
  profile1: 5,
  profile2: 5,
};

export const CUMULATIVE_THRESHOLDS = {
  pedagogy: 75,
  medicine: 70,
  national: 65,
  agriculture: 60,
  standard: 50,
};
