import type { Lang } from "../components/LanguageContext";

export const COMPULSORY_SUBJECTS = [
  "History of Kazakhstan",
  "Mathematical Literacy",
  "Reading Literacy",
] as const;

export const PROFILE_SUBJECTS = [
  "Mathematics",
  "Physics",
  "Chemistry",
  "Biology",
  "Geography",
  "Informatics",
  "World History",
  "Foreign Language",
  "Fundamentals of Law",
  "Kazakh Language",
  "Kazakh Literature",
  "Russian Language",
  "Russian Literature",
] as const;

export type ProfileSubject = (typeof PROFILE_SUBJECTS)[number];

export const PROFILE_SUBJECT_COMBINATIONS = [
  {
    subjects: ["Mathematics", "Physics"],
    ru: "Инженерия, техника, строительство",
    kz: "Инженерия, техника, құрылыс",
  },
  {
    subjects: ["Biology", "Chemistry"],
    ru: "Медицина, биология, химия",
    kz: "Медицина, биология, химия",
  },
  {
    subjects: ["Mathematics", "Informatics"],
    ru: "IT, информатика, программирование",
    kz: "IT, информатика, бағдарламалау",
  },
  {
    subjects: ["Kazakh Language", "Kazakh Literature"],
    ru: "Казахский язык и литература",
    kz: "Қазақ тілі мен әдебиеті",
  },
  {
    subjects: ["Russian Language", "Russian Literature"],
    ru: "Русский язык и литература",
    kz: "Орыс тілі мен әдебиеті",
  },
  {
    subjects: ["Foreign Language", "World History"],
    ru: "Языки, международные отношения",
    kz: "Тілдер, халықаралық қатынастар",
  },
  {
    subjects: ["Biology", "Geography"],
    ru: "Экология, агро, география",
    kz: "Экология, агро, география",
  },
  {
    subjects: ["Mathematics", "Geography"],
    ru: "Экономика, финансы, менеджмент",
    kz: "Экономика, қаржы, менеджмент",
  },
  {
    subjects: ["World History", "Fundamentals of Law"],
    ru: "Право, гуманитарные направления",
    kz: "Құқық, гуманитарлық бағыттар",
  },
  {
    subjects: ["World History", "Geography"],
    ru: "История, регионоведение, география",
    kz: "Тарих, аймақтану, география",
  },
  {
    subjects: ["Geography", "Foreign Language"],
    ru: "Туризм, языки, география",
    kz: "Туризм, тілдер, география",
  },
  {
    subjects: ["Chemistry", "Physics"],
    ru: "Химическая инженерия, физика",
    kz: "Химиялық инженерия, физика",
  },
] as const;

export type ProfileSubjectPair = (typeof PROFILE_SUBJECT_COMBINATIONS)[number];
type CanonicalSubject = ProfileSubject | (typeof COMPULSORY_SUBJECTS)[number];

const SUBJECT_ALIASES: Record<string, CanonicalSubject> = {
  English: "Foreign Language",
  "English Language": "Foreign Language",
  "Иностранный язык": "Foreign Language",
  "Шет тілі": "Foreign Language",
  Law: "Fundamentals of Law",
  "Основы права": "Fundamentals of Law",
  "Құқық негіздері": "Fundamentals of Law",
  "Computer Science": "Informatics",
  Информатика: "Informatics",
  Математика: "Mathematics",
  Физика: "Physics",
  Химия: "Chemistry",
  Биология: "Biology",
  География: "Geography",
  "Всемирная история": "World History",
  "Дүниежүзі тарихы": "World History",
  "Казахский язык": "Kazakh Language",
  "Қазақ тілі": "Kazakh Language",
  "Казахская литература": "Kazakh Literature",
  "Қазақ әдебиеті": "Kazakh Literature",
  "Русский язык": "Russian Language",
  "Орыс тілі": "Russian Language",
  "Русская литература": "Russian Literature",
  "Орыс әдебиеті": "Russian Literature",
  "История Казахстана": "History of Kazakhstan",
  "Қазақстан тарихы": "History of Kazakhstan",
  "Математическая грамотность": "Mathematical Literacy",
  "Математикалық сауаттылық": "Mathematical Literacy",
  "Грамотность чтения": "Reading Literacy",
  "Оқу сауаттылығы": "Reading Literacy",

  // Backend slug aliases (exam.py SUBJECT_NAME_MAP, ExamAttempt.subjects[]).
  // Used by chat memory tools that surface raw slugs in the FE cards.
  math: "Mathematics",
  physics: "Physics",
  chemistry: "Chemistry",
  biology: "Biology",
  geography: "Geography",
  informatics: "Informatics",
  worldHistory: "World History",
  foreignLanguage: "Foreign Language",
  english: "Foreign Language",
  law: "Fundamentals of Law",
  kazLang: "Kazakh Language",
  kazLit: "Kazakh Literature",
  rusLang: "Russian Language",
  rusLit: "Russian Literature",
  histKz: "History of Kazakhstan",
  mathLit: "Mathematical Literacy",
  readLit: "Reading Literacy",
};

const SUBJECT_ALIAS_LOOKUP = new Map<string, CanonicalSubject>([
  ...PROFILE_SUBJECTS.map(
    (subject) => [subject.toLocaleLowerCase(), subject] as const,
  ),
  ...COMPULSORY_SUBJECTS.map(
    (subject) => [subject.toLocaleLowerCase(), subject] as const,
  ),
  ...Object.entries(SUBJECT_ALIASES).map(
    ([alias, subject]) => [alias.toLocaleLowerCase(), subject] as const,
  ),
]);

const SUBJECT_LABELS: Record<string, { ru: string; kz: string }> = {
  Mathematics: { ru: "Математика", kz: "Математика" },
  Physics: { ru: "Физика", kz: "Физика" },
  Chemistry: { ru: "Химия", kz: "Химия" },
  Biology: { ru: "Биология", kz: "Биология" },
  Geography: { ru: "География", kz: "География" },
  Informatics: { ru: "Информатика", kz: "Информатика" },
  "World History": { ru: "Всемирная история", kz: "Дүниежүзі тарихы" },
  "Foreign Language": { ru: "Иностранный язык", kz: "Шет тілі" },
  "Fundamentals of Law": { ru: "Основы права", kz: "Құқық негіздері" },
  "Kazakh Language": { ru: "Казахский язык", kz: "Қазақ тілі" },
  "Kazakh Literature": { ru: "Казахская литература", kz: "Қазақ әдебиеті" },
  "Russian Language": { ru: "Русский язык", kz: "Орыс тілі" },
  "Russian Literature": { ru: "Русская литература", kz: "Орыс әдебиеті" },
  English: { ru: "Иностранный язык", kz: "Шет тілі" },
  Law: { ru: "Основы права", kz: "Құқық негіздері" },
  "History of Kazakhstan": { ru: "История Казахстана", kz: "Қазақстан тарихы" },
  "Mathematical Literacy": {
    ru: "Математическая грамотность",
    kz: "Математикалық сауаттылық",
  },
  "Reading Literacy": { ru: "Грамотность чтения", kz: "Оқу сауаттылығы" },
};

function pairKey(subjects: readonly string[]): string {
  return subjects.map(normalizeSubjectName).sort().join("::");
}

const VALID_PAIR_KEYS = new Set(
  PROFILE_SUBJECT_COMBINATIONS.map((pair) => pairKey(pair.subjects)),
);

export function normalizeSubjectName(
  subject: string | null | undefined,
): string {
  if (!subject) return "";
  const trimmed = subject.trim();
  return (
    SUBJECT_ALIASES[trimmed] ??
    SUBJECT_ALIAS_LOOKUP.get(trimmed.toLocaleLowerCase()) ??
    trimmed
  );
}

export function isProfileSubject(
  subject: string | null | undefined,
): subject is ProfileSubject {
  const normalized = normalizeSubjectName(subject);
  return PROFILE_SUBJECTS.includes(normalized as ProfileSubject);
}

export function isValidProfileSubjectPair(
  subjects: readonly string[] | null | undefined,
): boolean {
  if (!subjects || subjects.length !== 2) return false;
  const normalized = subjects.map(normalizeSubjectName);
  if (
    normalized[0] === normalized[1] ||
    normalized.some((subject) => !isProfileSubject(subject))
  ) {
    return false;
  }
  return VALID_PAIR_KEYS.has(pairKey(normalized));
}

export function getProfileSubjectPair(
  subjects: readonly string[] | null | undefined,
): ProfileSubjectPair | null {
  if (!subjects || subjects.length !== 2) return null;
  const key = pairKey(subjects);
  return (
    PROFILE_SUBJECT_COMBINATIONS.find(
      (pair) => pairKey(pair.subjects) === key,
    ) ?? null
  );
}

export function getDefaultProfileSubjects(): readonly [string, string] {
  return ["Mathematics", "Informatics"] as const;
}

export function subjectLabel(
  subject: string | null | undefined,
  lang: Lang,
): string {
  if (!subject) return "";
  const normalized = normalizeSubjectName(subject);
  return (
    SUBJECT_LABELS[normalized]?.[lang] ??
    SUBJECT_LABELS[subject]?.[lang] ??
    subject
  );
}

export function subjectPairLabel(
  subjects: readonly string[],
  lang: Lang,
): string {
  return subjects.map((subject) => subjectLabel(subject, lang)).join(" + ");
}

export function getSubjectMaxScore(subject: string | null | undefined): number {
  const normalized = normalizeSubjectName(subject);
  if (normalized === "History of Kazakhstan") return 20;
  if (normalized === "Mathematical Literacy") return 10;
  if (normalized === "Reading Literacy") return 10;
  return 50;
}

export function getRequiredUntSubjects(
  profileSubjects: readonly string[] | null | undefined,
): string[] {
  const seen = new Set<string>();
  const required: string[] = [];

  for (const subject of COMPULSORY_SUBJECTS) {
    seen.add(subject);
    required.push(subject);
  }

  for (const subject of profileSubjects || []) {
    const normalized = normalizeSubjectName(subject);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      required.push(normalized);
    }
  }

  return required;
}

export function difficultyLabel(level: string, lang: Lang): string {
  const labels: Record<string, { ru: string; kz: string }> = {
    EASY: { ru: "Легко", kz: "Жеңіл" },
    MEDIUM: { ru: "Средне", kz: "Орташа" },
    HARD: { ru: "Сложно", kz: "Күрделі" },
  };
  return labels[level]?.[lang] ?? level;
}
