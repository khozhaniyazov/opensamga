export type PracticeTrack =
  | "standard_unt"
  | "tipo_shortened"
  | "creative_exam"
  | "unknown";

export type PracticeCoverageConfidence = "high" | "medium" | "low";

export interface PracticeCoverage {
  track?: PracticeTrack | string | null;
  confidence?: PracticeCoverageConfidence | string | null;
  source_kind?: string | null;
  subtopics?: string[] | null;
  gaps?: string[] | null;
  reasons?: string[] | null;
}

export function practiceTrackLabel(
  track: string | null | undefined,
  lang: "ru" | "kz",
): string {
  const ru: Record<string, string> = {
    standard_unt: "Стандарт ЕНТ",
    tipo_shortened: "TiPO / сокращённый трек",
    creative_exam: "Творческий экзамен",
    unknown: "Покрытие неизвестно",
  };
  const kz: Record<string, string> = {
    standard_unt: "ҰБТ стандарты",
    tipo_shortened: "TiPO / қысқартылған трек",
    creative_exam: "Шығармашылық емтихан",
    unknown: "Қамту белгісіз",
  };
  const dict = lang === "kz" ? kz : ru;
  return dict[track || "unknown"] ?? dict.unknown ?? "Coverage unknown";
}

export function practiceConfidenceLabel(
  confidence: string | null | undefined,
  lang: "ru" | "kz",
): string {
  const ru: Record<string, string> = {
    high: "высокая уверенность",
    medium: "средняя уверенность",
    low: "низкая уверенность",
  };
  const kz: Record<string, string> = {
    high: "сенім жоғары",
    medium: "сенім орташа",
    low: "сенім төмен",
  };
  const dict = lang === "kz" ? kz : ru;
  return dict[confidence || "low"] ?? dict.low ?? "low confidence";
}

export function practiceSubtopicLabel(
  subtopic: string,
  lang: "ru" | "kz",
): string {
  const ru: Record<string, string> = {
    python: "Python",
    sql: "SQL",
    excel: "Excel",
    html: "HTML",
    algorithms: "Алгоритмы",
    theory: "Теория",
  };
  const kz: Record<string, string> = {
    python: "Python",
    sql: "SQL",
    excel: "Excel",
    html: "HTML",
    algorithms: "Алгоритмдер",
    theory: "Теория",
  };
  const dict = lang === "kz" ? kz : ru;
  return dict[subtopic] ?? subtopic;
}

export function practiceGapSummary(
  coverage: PracticeCoverage | null | undefined,
  lang: "ru" | "kz",
): string | null {
  const gaps = coverage?.gaps?.filter(Boolean) ?? [];
  if (gaps.length === 0) {
    return null;
  }
  if (gaps.includes("informatics_subtopic_unknown")) {
    return lang === "kz"
      ? "Информатика тақырыпшасы әлі белгісіз."
      : "Подтема информатики пока не определена.";
  }
  if (gaps.includes("missing_grade")) {
    return lang === "kz"
      ? "Сынып дерегі жоқ, трек орташа сеніммен белгіленді."
      : "Класс не указан, трек отмечен со средней уверенностью.";
  }
  return lang === "kz"
    ? "Бұл сұрақта қамту дерегін қосымша тексеру керек."
    : "Для этого вопроса нужно дополнительно проверить покрытие.";
}
