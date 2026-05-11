import { useMemo, useState } from "react";
import { Check, Filter, Search, Sparkles } from "lucide-react";
import type { Lang } from "../LanguageContext";
import {
  PROFILE_SUBJECT_COMBINATIONS,
  getProfileSubjectPair,
  subjectLabel,
  subjectPairLabel,
} from "../../lib/subjectLabels";

interface SubjectCombinationPickerProps {
  value: readonly string[];
  onChange: (subjects: readonly string[]) => void;
  lang: Lang;
  compact?: boolean;
}

const POPULAR_PAIR_KEYS = new Set([
  pairKey(["Biology", "Chemistry"]),
  pairKey(["Mathematics", "Physics"]),
  pairKey(["Mathematics", "Informatics"]),
  pairKey(["Foreign Language", "World History"]),
]);

const copy = {
  ru: {
    title: "Выберите профильную пару",
    subtitle:
      "Samga показывает только доступные комбинации профильных предметов.",
    selected: "Выбрано",
    notSelected: "Пара не выбрана",
    all: "Все пары",
    filterBy: "Фильтр по предмету",
    popular: "популярно",
    empty: "Подходящих комбинаций не найдено.",
    searchPlaceholder: "Найти предмет или направление",
  },
  kz: {
    title: "Бейіндік пән жұбын таңдаңыз",
    subtitle: "Samga тек қолжетімді бейіндік пән жұптарын көрсетеді.",
    selected: "Таңдалған жұп",
    notSelected: "Жұп таңдалмады",
    all: "Барлық жұптар",
    filterBy: "Пән бойынша сүзу",
    popular: "танымал",
    empty: "Сәйкес комбинациялар табылмады.",
    searchPlaceholder: "Пән немесе бағыт іздеу",
  },
} as const;

function pairKey(subjects: readonly string[]): string {
  return [...subjects].sort().join("::");
}

function getUniqueSubjects(): string[] {
  const seen = new Set<string>();
  for (const pair of PROFILE_SUBJECT_COMBINATIONS) {
    for (const subject of pair.subjects) {
      seen.add(subject);
    }
  }
  return [...seen];
}

function subjectAccent(subject: string): string {
  if (subject === "Mathematics" || subject === "Informatics") {
    return "border-sky-200 bg-sky-50 text-sky-800";
  }
  if (subject === "Physics" || subject === "Chemistry") {
    return "border-violet-200 bg-violet-50 text-violet-800";
  }
  if (subject === "Biology" || subject === "Geography") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (
    subject === "World History" ||
    subject === "Fundamentals of Law" ||
    subject.includes("Language") ||
    subject.includes("Literature")
  ) {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }
  return "border-zinc-200 bg-zinc-50 text-zinc-700";
}

export function SubjectCombinationPicker({
  value,
  onChange,
  lang,
  compact = false,
}: SubjectCombinationPickerProps) {
  const strings = copy[lang];
  const [activeSubject, setActiveSubject] = useState<string>("all");
  const [query, setQuery] = useState("");

  const selectedPair = getProfileSubjectPair(value);
  const selectedKey = selectedPair ? pairKey(selectedPair.subjects) : "";
  const subjects = useMemo(
    () =>
      getUniqueSubjects().sort((a, b) =>
        subjectLabel(a, lang).localeCompare(subjectLabel(b, lang), lang),
      ),
    [lang],
  );

  const filteredPairs = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return PROFILE_SUBJECT_COMBINATIONS.filter((pair) => {
      const matchesSubject =
        activeSubject === "all" ||
        (pair.subjects as readonly string[]).includes(activeSubject);
      if (!matchesSubject) return false;
      if (!q) return true;

      const haystack = [
        subjectPairLabel(pair.subjects, lang),
        pair.ru,
        pair.kz,
        ...pair.subjects.map((subject) => subjectLabel(subject, lang)),
      ]
        .join(" ")
        .toLocaleLowerCase();

      return haystack.includes(q);
    });
  }, [activeSubject, lang, query]);

  return (
    <section data-testid="subject-combo-picker" className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p
            className="text-zinc-950"
            style={{ fontSize: compact ? 14 : 16, fontWeight: 760 }}
          >
            {strings.title}
          </p>
          <p
            className="mt-1 text-zinc-500"
            style={{ fontSize: 12, lineHeight: 1.5 }}
          >
            {strings.subtitle}
          </p>
        </div>
        <div className="shrink-0 rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 py-2.5">
          <p
            className="text-zinc-600"
            style={{
              fontSize: 10,
              fontWeight: 750,
              textTransform: "uppercase",
            }}
          >
            {strings.selected}
          </p>
          <p
            className="mt-0.5 max-w-72 truncate text-zinc-900"
            style={{ fontSize: 13, fontWeight: 760 }}
          >
            {selectedPair
              ? subjectPairLabel(selectedPair.subjects, lang)
              : strings.notSelected}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <label className="relative block">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={strings.searchPlaceholder}
            className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-3 text-zinc-900 outline-none transition-colors focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
            style={{ fontSize: 13 }}
          />
        </label>

        <div className="flex flex-wrap gap-1.5" aria-label={strings.filterBy}>
          <button
            type="button"
            onClick={() => setActiveSubject("all")}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 transition-colors ${
              activeSubject === "all"
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300"
            }`}
            style={{ fontSize: 12, fontWeight: 720 }}
          >
            <Filter size={13} />
            {strings.all}
          </button>
          {subjects.map((subject) => {
            const active = activeSubject === subject;
            return (
              <button
                key={subject}
                type="button"
                onClick={() => setActiveSubject(subject)}
                className={`h-8 rounded-lg border px-2.5 transition-colors ${
                  active
                    ? "border-zinc-300 bg-zinc-100 text-zinc-900 ring-2 ring-zinc-100"
                    : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300"
                }`}
                style={{ fontSize: 12, fontWeight: 700 }}
              >
                {subjectLabel(subject, lang)}
              </button>
            );
          })}
        </div>
      </div>

      <div
        className={`grid grid-cols-1 gap-2 ${compact ? "" : "xl:grid-cols-2"}`}
      >
        {filteredPairs.map((pair) => {
          const key = pairKey(pair.subjects);
          const selected = key === selectedKey;
          const popular = POPULAR_PAIR_KEYS.has(key);
          return (
            <button
              key={key}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(pair.subjects)}
              className={`group min-h-24 rounded-xl border px-3.5 py-3.5 text-left transition-colors ${
                selected
                  ? "border-amber-300 bg-amber-50/80 text-zinc-950 ring-2 ring-amber-100"
                  : "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-zinc-50"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {pair.subjects.map((subject) => (
                      <span
                        key={subject}
                        className={`rounded-lg border px-2.5 py-1 ${subjectAccent(subject)}`}
                        style={{
                          fontSize: 12,
                          fontWeight: 760,
                          lineHeight: 1.2,
                        }}
                      >
                        {subjectLabel(subject, lang)}
                      </span>
                    ))}
                  </div>
                  <p
                    className="mt-2 text-zinc-500"
                    style={{ fontSize: 12, lineHeight: 1.45 }}
                  >
                    {pair[lang]}
                  </p>
                </div>
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                    selected
                      ? "bg-amber-500 text-white"
                      : "bg-zinc-100 text-zinc-500 group-hover:bg-zinc-200 group-hover:text-zinc-600"
                  }`}
                >
                  {selected ? <Check size={15} /> : <Sparkles size={13} />}
                </span>
              </div>
              {popular && (
                <span
                  className="mt-2 inline-flex rounded-lg bg-white px-2.5 py-1 text-amber-700 ring-1 ring-amber-200"
                  style={{
                    fontSize: 10,
                    fontWeight: 760,
                    textTransform: "uppercase",
                  }}
                >
                  {strings.popular}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {filteredPairs.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-200 bg-white px-4 py-6 text-center text-zinc-500">
          <p style={{ fontSize: 13 }}>{strings.empty}</p>
        </div>
      )}
    </section>
  );
}
