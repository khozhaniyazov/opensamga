import {
  AlertCircle,
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  FileText,
  Filter,
  Library,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { useLang } from "../LanguageContext";
import { apiGet } from "../../lib/api";
import { parseLibraryDeepLinkParams } from "./weakTopicLinkParams";
import {
  buildLibraryPdfViewerPath,
  buildLibraryThumbnailApiUrl,
} from "../../lib/libraryPdf";
import { Skeleton } from "../ui/skeleton";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { useIsMobile } from "../ui/use-mobile";

interface LibraryBook {
  id: number;
  title: string;
  subject: string;
  grade: number;
  file_name: string;
  total_pages: number;
}

const subjectColors: Record<
  string,
  {
    bg: string;
    border: string;
    text: string;
    spine: string;
    badge: string;
  }
> = {
  math: {
    bg: "bg-blue-50",
    border: "border-blue-200",
    text: "text-blue-700",
    spine: "bg-blue-500",
    badge: "bg-blue-50 text-blue-700 border-blue-200",
  },
  physics: {
    bg: "bg-violet-50",
    border: "border-violet-200",
    text: "text-violet-700",
    spine: "bg-violet-500",
    badge: "bg-violet-50 text-violet-700 border-violet-200",
  },
  chemistry: {
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    text: "text-emerald-700",
    spine: "bg-emerald-500",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  biology: {
    bg: "bg-green-50",
    border: "border-green-200",
    text: "text-green-700",
    spine: "bg-green-500",
    badge: "bg-green-50 text-green-700 border-green-200",
  },
  history: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-700",
    spine: "bg-amber-500",
    badge: "bg-amber-50 text-amber-700 border-amber-200",
  },
  readLit: {
    bg: "bg-rose-50",
    border: "border-rose-200",
    text: "text-rose-700",
    spine: "bg-rose-500",
    badge: "bg-rose-50 text-rose-700 border-rose-200",
  },
  mathLit: {
    bg: "bg-sky-50",
    border: "border-sky-200",
    text: "text-sky-700",
    spine: "bg-sky-500",
    badge: "bg-sky-50 text-sky-700 border-sky-200",
  },
  geography: {
    bg: "bg-teal-50",
    border: "border-teal-200",
    text: "text-teal-700",
    spine: "bg-teal-500",
    badge: "bg-teal-50 text-teal-700 border-teal-200",
  },
  worldHistory: {
    bg: "bg-orange-50",
    border: "border-orange-200",
    text: "text-orange-700",
    spine: "bg-orange-500",
    badge: "bg-orange-50 text-orange-700 border-orange-200",
  },
  informatics: {
    bg: "bg-cyan-50",
    border: "border-cyan-200",
    text: "text-cyan-700",
    spine: "bg-cyan-500",
    badge: "bg-cyan-50 text-cyan-700 border-cyan-200",
  },
  language: {
    bg: "bg-fuchsia-50",
    border: "border-fuchsia-200",
    text: "text-fuchsia-700",
    spine: "bg-fuchsia-500",
    badge: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200",
  },
  other: {
    bg: "bg-zinc-50",
    border: "border-zinc-200",
    text: "text-zinc-700",
    spine: "bg-zinc-500",
    badge: "bg-zinc-50 text-zinc-700 border-zinc-200",
  },
};

// `subjectColors.other` is statically defined above; the non-null
// assertion is safe and required under noUncheckedIndexedAccess.
const defaultColor = subjectColors.other!;

const subjectFilters = [
  { key: "all", labelKey: "lib.filter.all" },
  { key: "math", labelKey: "subject.math" },
  { key: "physics", labelKey: "subject.physics" },
  { key: "chemistry", labelKey: "subject.chemistry" },
  { key: "biology", labelKey: "subject.biology" },
  { key: "informatics", labelKey: "lib.subject.informatics" },
  { key: "history", labelKey: "subject.histKz" },
  { key: "worldHistory", labelKey: "lib.subject.worldHistory" },
  { key: "readLit", labelKey: "subject.readLit" },
  { key: "mathLit", labelKey: "subject.mathLit" },
  { key: "geography", labelKey: "lib.subject.geography" },
  { key: "language", labelKey: "lib.subject.language" },
];

const gradeOptions = [0, 7, 8, 9, 10, 11];
const LIBRARY_PAGE_SIZE = 48;

const subjectMapping: Record<string, string[]> = {
  math: ["Математика", "Алгебра", "Геометрия", "Math"],
  physics: ["Физика", "Physics"],
  chemistry: ["Химия", "Chemistry"],
  biology: ["Биология", "Biology"],
  history: ["История Казахстана", "Қазақстан тарихы", "History"],
  readLit: [
    "Русская литература",
    "Орыс әдебиеті",
    "Казахская литература",
    "Қазақ әдебиеті",
    "Грамотность чтения",
  ],
  mathLit: ["Математическая грамотность", "Математикалық сауаттылық"],
  geography: ["География", "Geography"],
  worldHistory: ["Всемирная история", "World History", "Дүниежүзі тарихы"],
  informatics: ["Информатика", "Informatics", "Computer Science"],
  language: [
    "Английский язык",
    "English",
    "Foreign Language",
    "Иностранный язык",
    "Немецкий язык",
    "German",
    "Французский язык",
    "French",
    "Казахский язык",
    "Қазақ тілі",
    "Русский язык",
    "Орыс тілі",
  ],
};

function getColorKeyForSubject(subjectName: string): string {
  if (!subjectName) return "other";
  const lower = subjectName.toLowerCase();
  for (const [key, values] of Object.entries(subjectMapping)) {
    if (values.some((value) => lower.includes(value.toLowerCase()))) {
      return key;
    }
  }
  return "other";
}

function getSubjectLabel(
  subjectName: string,
  t: (key: string) => string,
): string {
  const labels: Record<string, string> = {
    math: t("subject.math"),
    physics: t("subject.physics"),
    chemistry: t("subject.chemistry"),
    biology: t("subject.biology"),
    informatics: t("lib.subject.informatics"),
    history: t("subject.histKz"),
    worldHistory: t("lib.subject.worldHistory"),
    readLit: t("subject.readLit"),
    mathLit: t("subject.mathLit"),
    geography: t("lib.subject.geography"),
    language: t("lib.subject.language"),
  };

  return labels[getColorKeyForSubject(subjectName)] || subjectName;
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

function matchesLocalizedQuery(book: LibraryBook, queryText: string): boolean {
  if (!queryText) return true;

  const q = normalizeSearchText(queryText);
  const subjectKey = getColorKeyForSubject(book.subject);
  const aliasText = subjectMapping[subjectKey] || [];
  const searchable = [
    book.title,
    book.subject,
    book.file_name,
    String(book.grade),
    subjectKey,
    ...aliasText,
  ]
    .map(normalizeSearchText)
    .join(" ");

  if (searchable.includes(q)) return true;

  const words = q.split(" ").filter(Boolean);
  return words.length > 1 && words.every((word) => searchable.includes(word));
}

export function LibraryPage() {
  const { t, lang } = useLang();
  const { t: tCommon } = useTranslation("common");
  const isMobile = useIsMobile();
  useDocumentTitle(t("dash.nav.library"));

  const [searchParams] = useSearchParams();
  const initialDeepLink = useMemo(
    () => parseLibraryDeepLinkParams(searchParams),
    // Read once at mount; user edits should win after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const initialSubjectFilter = useMemo(() => {
    if (!initialDeepLink.subject) return "all";
    const key = getColorKeyForSubject(initialDeepLink.subject);
    return key === "other" ? "all" : key;
  }, [initialDeepLink.subject]);

  const [query, setQuery] = useState(initialDeepLink.q ?? "");
  const [subjectFilter, setSubjectFilter] = useState(initialSubjectFilter);
  const [gradeFilter, setGradeFilter] = useState(0);
  const [showGradeDropdown, setShowGradeDropdown] = useState(false);
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadCounter, setReloadCounter] = useState(0);
  const [visibleCount, setVisibleCount] = useState(LIBRARY_PAGE_SIZE);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const data = await apiGet<LibraryBook[]>("/library/books");
        if (!active) return;
        setBooks(Array.isArray(data) ? data : []);
      } catch {
        if (!active) return;
        // v3.77: surface load failure to the user instead of pretending
        // the library is empty. The pre-v3.77 `setBooks([])` swallow
        // hid every backend / network outage behind the same UI state
        // as a freshly-empty catalog.
        setBooks([]);
        setLoadError(tCommon("load_failed"));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadCounter, tCommon]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return books.filter((book) => {
      if (subjectFilter !== "all") {
        const key = getColorKeyForSubject(book.subject);
        if (key !== subjectFilter) return false;
      }
      if (gradeFilter !== 0 && book.grade !== gradeFilter) return false;
      if (q && !matchesLocalizedQuery(book, q)) {
        return false;
      }
      return true;
    });
  }, [books, gradeFilter, query, subjectFilter]);

  useEffect(() => {
    setVisibleCount(LIBRARY_PAGE_SIZE);
  }, [gradeFilter, query, subjectFilter]);

  const visibleBooks = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount],
  );
  const hasMoreBooks = visibleBooks.length < filtered.length;

  const gradeLabel =
    gradeFilter === 0
      ? t("lib.filter.allGrades")
      : `${gradeFilter} ${t("library.grade")}`;
  const totalGrades = new Set(books.map((book) => book.grade)).size;
  const totalSubjects = new Set(
    books.map((book) => getColorKeyForSubject(book.subject)),
  ).size;
  const activeFilters =
    Number(Boolean(query)) +
    Number(subjectFilter !== "all") +
    Number(gradeFilter !== 0);
  const searchPlaceholder = isMobile
    ? lang === "kz"
      ? "Оқулық іздеу..."
      : "Поиск учебника..."
    : t("library.search");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="rounded-2xl border border-zinc-200 bg-white px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <HeroPill icon={<Library size={13} className="text-zinc-700" />}>
                Samga Library
              </HeroPill>
              <HeroPill icon={<BookOpen size={13} className="text-zinc-700" />}>
                {t("library.title")}
              </HeroPill>
            </div>
            <h1
              className="text-[24px] text-zinc-950 sm:text-[30px]"
              style={{ fontWeight: 760, lineHeight: 1.08 }}
            >
              {t("library.title")}
            </h1>
            <p
              className="mt-3 text-[13px] text-zinc-600 sm:text-[14px]"
              style={{ lineHeight: 1.7 }}
            >
              {lang === "kz"
                ? "Оқулықтарды тақырып, сынып және тілдік сұраныс бойынша тез табуға арналған Samga сөресі."
                : "Полка Samga, где учебники быстро находятся по предмету, классу и языковому запросу."}
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-3 lg:w-[430px]">
            <HeroStat label={t("lib.bookCount")} value={String(books.length)} />
            <HeroStat label={t("lib.found")} value={String(filtered.length)} />
            <HeroStat
              label={lang === "kz" ? "Сыныптар" : "Классы"}
              value={String(totalGrades)}
            />
          </div>
        </div>

        <div className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px]">
          <div className="relative">
            <span className="pointer-events-none absolute left-0 top-0 flex h-[52px] w-11 items-center justify-center text-zinc-600">
              <Search size={16} aria-hidden="true" />
            </span>
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={t("library.search")}
              className="h-[52px] w-full rounded-lg border border-zinc-200 bg-white py-3 pl-11 pr-4 text-zinc-800 outline-none transition-colors focus:border-zinc-400"
              style={{ fontSize: 14, fontWeight: 520 }}
            />
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowGradeDropdown((value) => !value)}
              onBlur={() => setTimeout(() => setShowGradeDropdown(false), 150)}
              className="flex h-[52px] w-full items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50"
              style={{ fontSize: 14, fontWeight: 600 }}
            >
              <span className="inline-flex items-center gap-2">
                <Filter size={14} className="text-zinc-600" />
                {gradeLabel}
              </span>
              <ChevronDown size={14} className="text-zinc-600" />
            </button>

            {showGradeDropdown ? (
              <div className="absolute right-0 top-full z-20 mt-2 min-w-[180px] rounded-xl border border-zinc-200 bg-white py-2 shadow-lg">
                {gradeOptions.map((grade) => (
                  <button
                    key={grade}
                    type="button"
                    onClick={() => {
                      setGradeFilter(grade);
                      setShowGradeDropdown(false);
                    }}
                    className={`w-full px-4 py-2 text-left transition-colors hover:bg-zinc-50 ${
                      gradeFilter === grade ? "text-zinc-950" : "text-zinc-600"
                    }`}
                    style={{
                      fontSize: 13,
                      fontWeight: gradeFilter === grade ? 700 : 520,
                    }}
                  >
                    {grade === 0
                      ? t("lib.filter.allGrades")
                      : `${grade} ${t("library.grade")}`}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-5 flex gap-2 overflow-x-auto pb-1 scrollbar-hide sm:flex-wrap sm:overflow-visible">
          {subjectFilters.map((filterItem) => {
            const active = subjectFilter === filterItem.key;
            const colors =
              filterItem.key !== "all"
                ? subjectColors[filterItem.key] || defaultColor
                : null;
            const count =
              filterItem.key === "all"
                ? books.length
                : books.filter(
                    (book) =>
                      getColorKeyForSubject(book.subject) === filterItem.key,
                  ).length;

            return (
              <button
                key={filterItem.key}
                type="button"
                onClick={() => setSubjectFilter(filterItem.key)}
                className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-2 transition-colors ${
                  active
                    ? filterItem.key === "all"
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : `${colors?.badge} border`
                    : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50"
                }`}
                style={{ fontSize: 12, fontWeight: active ? 700 : 600 }}
              >
                <span>{t(filterItem.labelKey)}</span>
                <span
                  className={
                    active && filterItem.key === "all"
                      ? "text-white/80"
                      : "text-zinc-600"
                  }
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {query || subjectFilter !== "all" || gradeFilter !== 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-zinc-600">
          <p style={{ fontSize: 13, lineHeight: 1.6 }}>
            {t("lib.found")}:{" "}
            <span className="font-semibold text-zinc-950">
              {filtered.length}
            </span>{" "}
            {t("lib.bookCount")}
            <span className="ml-3 text-zinc-600">
              {lang === "kz" ? "Белсенді сүзгі" : "Активных фильтров"}:{" "}
              {activeFilters}
            </span>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setSubjectFilter("all");
                setGradeFilter(0);
              }}
              className="ml-3 text-zinc-900 underline-offset-2 transition-colors hover:underline"
              style={{ fontSize: 12, fontWeight: 700 }}
            >
              {t("lib.clearFilters")}
            </button>
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <InfoCard
            label={lang === "kz" ? "Пәндер" : "Предметы"}
            value={String(totalSubjects)}
          />
          <InfoCard
            label={lang === "kz" ? "Сыныптар" : "Классы"}
            value={String(totalGrades)}
          />
          <InfoCard
            label={lang === "kz" ? "Тілдік іздеу" : "Локализованный поиск"}
            value={lang === "kz" ? "KZ / RU / EN" : "RU / KZ / EN"}
          />
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[...Array(6)].map((_, index) => (
            <div
              key={index}
              className="rounded-xl border border-zinc-200 bg-white p-4"
            >
              <Skeleton className="h-36 w-full rounded-lg" />
              <div className="mt-4 space-y-2">
                <Skeleton className="h-4 w-3/4 rounded-full" />
                <Skeleton className="h-4 w-1/2 rounded-full" />
                <Skeleton className="h-10 w-full rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div
          role="alert"
          data-testid="library-load-error"
          className="flex flex-col items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-6 text-red-700 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="mt-0.5 shrink-0" />
            <span style={{ fontSize: 14 }}>{loadError}</span>
          </div>
          <button
            type="button"
            onClick={() => setReloadCounter((prev) => prev + 1)}
            className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-red-700 transition-colors hover:bg-red-100"
            style={{ fontSize: 13, fontWeight: 600 }}
          >
            {tCommon("retry")}
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-14 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600">
            <BookOpen size={26} />
          </div>
          <p
            className="text-zinc-700"
            style={{ fontSize: 15, fontWeight: 700 }}
          >
            {t("lib.noResults")}
          </p>
          <p className="mt-1 text-zinc-600" style={{ fontSize: 13 }}>
            {t("lib.tryDifferent")}
          </p>
          {/* v3.64 (B4, 2026-05-02): when the user typed a free-text
              query and got 0 hits, explicitly say what the search bar
              looks at (titles + subjects, not chapter content) and
              suggest the chat as the right tool for content search.
              Don't show this for filter-only empty states (subject /
              grade picker) since those don't have the same illusion. */}
          {query.trim().length > 0 ? (
            <p
              className="mx-auto mt-3 max-w-md text-zinc-500"
              style={{ fontSize: 12, lineHeight: 1.5 }}
              data-testid="lib-search-scope-hint"
            >
              {t("lib.searchScope")}
            </p>
          ) : null}
          {activeFilters > 0 ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setSubjectFilter("all");
                setGradeFilter(0);
              }}
              className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50"
              style={{ fontSize: 12.5, fontWeight: 700 }}
            >
              {t("lib.clearFilters")}
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleBooks.map((book) => (
              <BookCard key={book.id} book={book} />
            ))}
          </div>
          {hasMoreBooks ? (
            <div className="flex flex-col items-center gap-2">
              <p className="text-zinc-500" style={{ fontSize: 12.5 }}>
                {lang === "kz" ? "Көрсетілуде" : "Показано"}:{" "}
                {visibleBooks.length}/{filtered.length}
              </p>
              <button
                type="button"
                onClick={() =>
                  setVisibleCount((count) => count + LIBRARY_PAGE_SIZE)
                }
                className="inline-flex h-11 items-center justify-center rounded-lg border border-zinc-200 bg-white px-5 text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50"
                style={{ fontSize: 13, fontWeight: 700 }}
              >
                {lang === "kz" ? "Тағы көрсету" : "Показать еще"}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function HeroPill({ icon, children }: { icon: ReactNode; children: string }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-zinc-700"
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

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-4">
      <p
        className="text-zinc-500"
        style={{ fontSize: 11, fontWeight: 760, textTransform: "uppercase" }}
      >
        {label}
      </p>
      <p
        className="mt-2 text-zinc-950"
        style={{ fontSize: 15, fontWeight: 700 }}
      >
        {value}
      </p>
    </div>
  );
}

function BookCard({ book }: { book: LibraryBook }) {
  const { t, lang } = useLang();
  const colorKey = getColorKeyForSubject(book.subject);
  const colors = subjectColors[colorKey] ?? defaultColor;
  const displaySubject = getSubjectLabel(book.subject, t);
  const [thumbFailed, setThumbFailed] = useState(false);
  const thumbUrl = buildLibraryThumbnailApiUrl(book.id, 1, 240);

  // v3.67 (B9, 2026-05-02): every card is wrapped in a single
  // <a href=…/library/books/N> link, and a screen reader concatenates
  // the entire descendant tree as the link's accessible name. That
  // produced "Физика208 стр.Physics 7physics_7.pdfSamga SourceЗащищенный
  // просмотр PDF" — a wall of run-together text. We replace the
  // computed accessible name with a clean bilingual label that names
  // the book + grade + page count.
  const cardAriaLabel =
    lang === "kz"
      ? `${book.title} — ${displaySubject}, ${book.grade} сынып, ${book.total_pages} бет`
      : `${book.title} — ${displaySubject}, ${book.grade} класс, ${book.total_pages} страниц`;

  return (
    <Link
      to={buildLibraryPdfViewerPath(book.id)}
      aria-label={cardAriaLabel}
      className="group flex h-full flex-col justify-between rounded-xl border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-400 hover:bg-zinc-50"
    >
      <div className="flex gap-4">
        <div
          className={`relative flex w-24 shrink-0 flex-col items-center justify-center overflow-hidden rounded-lg border ${colors.border} ${colors.bg} ${thumbFailed ? "px-3 py-4" : "p-0"}`}
        >
          <div
            className={`absolute left-0 top-0 z-10 h-full w-1.5 rounded-l-lg ${colors.spine}`}
          />
          {thumbFailed ? (
            <>
              <FileText size={22} className={colors.text} />
              <span
                className={`mt-3 ${colors.text}`}
                style={{ fontSize: 10, fontWeight: 700 }}
              >
                {book.grade} {lang === "ru" ? "кл." : "сын."}
              </span>
            </>
          ) : (
            <img
              src={thumbUrl}
              alt=""
              loading="lazy"
              onError={() => setThumbFailed(true)}
              className="h-full w-full object-cover"
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-2">
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-1 ${colors.badge}`}
              style={{ fontSize: 10.5, fontWeight: 700 }}
            >
              {displaySubject}
            </span>
            <span
              className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-zinc-700"
              style={{ fontSize: 10.5, fontWeight: 650 }}
            >
              {book.total_pages} {t("library.pages")}
            </span>
          </div>

          <h2
            className="mt-3 break-words text-zinc-950"
            style={{ fontSize: 16, fontWeight: 720, lineHeight: 1.35 }}
          >
            {book.title}
          </h2>

          <p
            className="mt-2 break-all text-zinc-600"
            style={{ fontSize: 11.5, lineHeight: 1.55 }}
          >
            {book.file_name}
          </p>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-zinc-100 pt-4">
        <div>
          <p
            className="text-zinc-500"
            style={{
              fontSize: 11,
              fontWeight: 760,
              textTransform: "uppercase",
            }}
          >
            Samga Source
          </p>
          <p
            className="mt-1 text-zinc-700"
            style={{ fontSize: 12.5, fontWeight: 650 }}
          >
            {lang === "kz" ? "Қорғалған PDF қарауы" : "Защищенный просмотр PDF"}
          </p>
        </div>

        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-600 transition-colors group-hover:border-zinc-300 group-hover:bg-white">
          <ArrowUpRight size={16} />
        </div>
      </div>
    </Link>
  );
}
