import {
  AlertCircle,
  BookOpen,
  Building2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Search,
  Shield,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { useLang } from "../LanguageContext";
import { apiGet } from "../../lib/api";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import {
  buildUniversitiesQuery,
  parseUniversitiesDeepLink,
} from "./universitiesDeepLink";

type PopularityTier = "very_high" | "high" | "medium" | "niche";
type PrestigeTier = "elite" | "strong" | "established" | "regional";

interface UniversityOption {
  id: number;
  label: string;
  value: string;
  city?: string | null;
  university_code?: string | null;
  total_students?: number | null;
  majors_count?: number;
  median_grant_threshold?: number | null;
  max_grant_threshold?: number | null;
  popularity_score?: number;
  popularity_rank?: number | null;
  popularity_tier?: PopularityTier;
  prestige_score?: number;
  prestige_tier?: PrestigeTier;
  prestige_note?: string | null;
}

interface UniversityMajor {
  code: string;
  name: string;
  thresholds?: {
    general?: number | null;
    rural?: number | null;
    year?: number | null;
  };
  tuition_per_year?: number | null;
}

interface UniversityDetail extends UniversityOption {
  full_name: string;
  website?: string | null;
  grant_students?: number | null;
  paid_students?: number | null;
  military_chair?: string | null;
  has_dorm?: string | null;
  majors?: UniversityMajor[];
}

const ALL_VALUE = "all";
const UNIVERSITY_PAGE_SIZE = 30;

const UNIVERSITY_SEARCH_ALIASES = [
  {
    aliases: ["kbtu", "кбту", "қбту"],
    terms: [
      "казахстанско британский",
      "казакстанско британский",
      "kazakhstan british",
      "kazakh british",
      "kbt",
    ],
  },
  {
    aliases: ["aitu", "аиту", "astana it"],
    terms: ["astana it", "астана айти", "астана it"],
  },
  {
    aliases: ["enu", "ену", "лну"],
    terms: ["гумилев", "gumilyov", "eurasian national"],
  },
  {
    aliases: ["kaznu", "казну", "қазұу"],
    terms: ["аль фараби", "al farabi", "әл фараби"],
  },
  {
    aliases: ["iitu", "мут", "муит", "muit"],
    terms: [
      "international information technology",
      "международный университет информационных технологий",
    ],
  },
  {
    aliases: ["sdu", "сду", "сдю"],
    terms: ["suleyman demirel", "сулейман демирель"],
  },
  {
    aliases: ["satbayev", "сатбаев", "сатпаев"],
    terms: ["satbayev", "сатбаев", "сатпаев"],
  },
  {
    aliases: ["narxoz", "нархоз"],
    terms: ["narxoz", "нархоз"],
  },
] as const;

function normalizeUniversitySearchValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-яәғқңөұүһі0-9]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function universityQueryTerms(query: string): string[] {
  const normalized = normalizeUniversitySearchValue(query);
  if (!normalized) return [];

  const terms = new Set([normalized]);
  for (const group of UNIVERSITY_SEARCH_ALIASES) {
    const aliases = group.aliases.map(normalizeUniversitySearchValue);
    if (aliases.includes(normalized)) {
      group.terms.forEach((term) =>
        terms.add(normalizeUniversitySearchValue(term)),
      );
    }
  }
  return Array.from(terms).filter(Boolean);
}

export function UniversitiesPage() {
  const { lang, t } = useLang();
  useDocumentTitle(t("dash.nav.universities"));

  const copy =
    lang === "kz"
      ? {
          loaded: "Жүктелген ЖОО",
          matching: "Таңдалғаны",
          elite: "Элиталы",
          detailsHint:
            "Сүзгілерді тарылтып, карточканы ашып өту балдары мен оқу ақысын салыстырыңыз.",
          loading: "ЖОО тізімі жүктеліп жатыр...",
          loadingDetails: "Деректер жүктелуде...",
          loadError: "Университеттер тізімін жүктеу мүмкін болмады.",
          noResults: "Сүзгілерге сай ЖОО табылмады.",
          tryDifferent: "Іздеуді немесе сүзгілерді өзгертіп көріңіз.",
          code: "Код",
          city: "Қала",
          students: "Студенттер",
          grantStudents: "Грантта",
          paidStudents: "Ақылы бөлім",
          dorm: "Жатақхана",
          military: "Әскери кафедра",
          website: "Сайт",
          majors: "Мамандықтар",
          majorsCount: "Мамандық саны",
          noMajors: "Бұл ЖОО үшін мамандық деректері әлі табылмады.",
          minGeneral: "Жалпы грант",
          minRural: "Ауыл квотасы",
          thresholdYear: "Жыл",
          tuition: "Оқу ақысы / жыл",
          tuitionUnknown: "Баға көрсетілмеген",
          medianScore: "Орташа шек",
          popularity: "Сұраныс",
          prestige: "Бедел",
          prestigeTitle: "Бедел деңгейі",
          popularityTitle: "Танымалдық",
          unknown: "Белгісіз",
          filterAll: "Барлығы",
          popularityVeryHigh: "Өте жоғары сұраныс",
          popularityHigh: "Жоғары сұраныс",
          popularityMedium: "Тұрақты сұраныс",
          popularityNiche: "Нишалық сұраныс",
          prestigeElite: "Элиталы",
          prestigeStrong: "Күшті бренд",
          prestigeEstablished: "Қалыптасқан",
          prestigeRegional: "Өңірлік",
          prestigeHint: "Ұлттық статус пен бедел сигналдары",
          popularityHint: "Өту балдары, ауқым және студент саны",
          shellTitle: "ЖОО атласы",
          shellBody:
            "Samga үшін вектор тек атаумен бітпейді. Қай жерде бәсеке жоғары, грант шегі қайда өсіп тұр, қандай бағыттар бар - осының бәрі бір картада.",
          openProfile: "Профильді ашу",
          available: "Бар",
          notAvailable: "Жоқ",
          showing: "Көрсетілуде",
          showMore: "Тағы көрсету",
          clearFilters: "Сүзгілерді тазалау",
        }
      : {
          loaded: "Загружено вузов",
          matching: "Под фильтрами",
          elite: "Элитных",
          detailsHint:
            "Сузьте выдачу фильтрами и раскрывайте карточки, чтобы сравнивать проходные баллы, стоимость и набор специальностей.",
          loading: "Загружаем список университетов...",
          loadingDetails: "Загружаем детали...",
          loadError: "Не удалось загрузить список университетов.",
          noResults: "Под эти фильтры университеты не найдены.",
          tryDifferent: "Измените поиск или сбросьте фильтры.",
          code: "Код",
          city: "Город",
          students: "Студентов",
          grantStudents: "На гранте",
          paidStudents: "Платное обучение",
          dorm: "Общежитие",
          military: "Военная кафедра",
          website: "Сайт",
          majors: "Специальности",
          majorsCount: "Количество специальностей",
          noMajors: "Для этого вуза пока не найдены данные по специальностям.",
          minGeneral: "Общий грант",
          minRural: "Сельская квота",
          thresholdYear: "Год",
          tuition: "Стоимость / год",
          tuitionUnknown: "Стоимость не указана",
          medianScore: "Медианный балл",
          popularity: "Спрос",
          prestige: "Статус",
          prestigeTitle: "Элитность",
          popularityTitle: "Популярность",
          unknown: "Неизвестно",
          filterAll: "Все",
          popularityVeryHigh: "Очень высокий спрос",
          popularityHigh: "Высокий спрос",
          popularityMedium: "Стабильный спрос",
          popularityNiche: "Нишевый спрос",
          prestigeElite: "Элитный",
          prestigeStrong: "Сильный бренд",
          prestigeEstablished: "Устойчивый",
          prestigeRegional: "Региональный",
          prestigeHint: "Национальный статус и сигналы престижа",
          popularityHint: "Проходные баллы, ширина выбора и размер вуза",
          shellTitle: "Атлас вузов",
          shellBody:
            "Samga смотрит не только на название. Здесь видно, где реально высокая конкуренция, какие у вуза сигналы силы и какие специальности доступны.",
          openProfile: "Открыть профиль",
          available: "Есть",
          notAvailable: "Нет",
          showing: "Показано",
          showMore: "Показать еще",
          clearFilters: "Сбросить фильтры",
        };

  const prestigeOptions = [
    { value: ALL_VALUE, label: copy.filterAll },
    { value: "elite", label: copy.prestigeElite },
    { value: "strong", label: copy.prestigeStrong },
    { value: "established", label: copy.prestigeEstablished },
    { value: "regional", label: copy.prestigeRegional },
  ] as const;

  const popularityOptions = [
    { value: ALL_VALUE, label: copy.filterAll },
    { value: "very_high", label: copy.popularityVeryHigh },
    { value: "high", label: copy.popularityHigh },
    { value: "medium", label: copy.popularityMedium },
    { value: "niche", label: copy.popularityNiche },
  ] as const;

  const [searchParams, setSearchParams] = useSearchParams();
  const initialDeepLink = useMemo(
    () => parseUniversitiesDeepLink(searchParams),
    // Read once at mount; subsequent state lives in component state so
    // user clicks on "clear" win over the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [query, setQuery] = useState("");
  const [prestigeFilter, setPrestigeFilter] = useState<string>(ALL_VALUE);
  const [popularityFilter, setPopularityFilter] = useState<string>(ALL_VALUE);
  const [majorCodeFilter, setMajorCodeFilter] = useState<string | null>(
    initialDeepLink.majorCode,
  );
  const [universities, setUniversities] = useState<UniversityOption[]>([]);
  const [details, setDetails] = useState<Record<number, UniversityDetail>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loadingDetails, setLoadingDetails] = useState<Record<number, boolean>>(
    {},
  );
  const [visibleCount, setVisibleCount] = useState(UNIVERSITY_PAGE_SIZE);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        setLoading(true);
        setError(null);
        const qs = buildUniversitiesQuery({ majorCode: majorCodeFilter });
        const path = qs ? `/data/universities?${qs}` : "/data/universities";
        const data = await apiGet<UniversityOption[]>(path);
        if (active) {
          setUniversities(Array.isArray(data) ? data : []);
        }
      } catch {
        if (active) {
          setError(copy.loadError);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [copy.loadError, majorCodeFilter]);

  function clearMajorCodeFilter() {
    setMajorCodeFilter(null);
    // Drop the URL param so a refresh stops re-applying the filter.
    const next = new URLSearchParams(searchParams);
    next.delete("major_code");
    setSearchParams(next, { replace: true });
  }

  const eliteCount = useMemo(
    () => universities.filter((uni) => uni.prestige_tier === "elite").length,
    [universities],
  );

  const filtered = useMemo(() => {
    const searchTerms = universityQueryTerms(query);

    return universities
      .filter((uni) => {
        if (
          prestigeFilter !== ALL_VALUE &&
          uni.prestige_tier !== prestigeFilter
        ) {
          return false;
        }
        if (
          popularityFilter !== ALL_VALUE &&
          uni.popularity_tier !== popularityFilter
        ) {
          return false;
        }
        if (searchTerms.length === 0) {
          return true;
        }

        const haystack = normalizeUniversitySearchValue(
          `${uni.label} ${uni.value} ${uni.city ?? ""} ${uni.university_code ?? ""}`,
        );
        return searchTerms.some((term) => haystack.includes(term));
      })
      .sort((left, right) => {
        const prestigeDelta =
          (right.prestige_score ?? 0) - (left.prestige_score ?? 0);
        if (prestigeDelta !== 0) return prestigeDelta;

        const popularityDelta =
          (right.popularity_score ?? 0) - (left.popularity_score ?? 0);
        if (popularityDelta !== 0) return popularityDelta;

        return left.label.localeCompare(
          right.label,
          lang === "kz" ? "kk" : "ru",
        );
      });
  }, [lang, popularityFilter, prestigeFilter, query, universities]);

  useEffect(() => {
    setVisibleCount(UNIVERSITY_PAGE_SIZE);
  }, [popularityFilter, prestigeFilter, query]);

  const visibleUniversities = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount],
  );
  const hasMoreUniversities = visibleUniversities.length < filtered.length;

  const demandCount = useMemo(
    () =>
      filtered.filter(
        (uni) =>
          uni.popularity_tier === "very_high" || uni.popularity_tier === "high",
      ).length,
    [filtered],
  );

  async function loadDetails(id: number) {
    if (details[id] || loadingDetails[id]) return;

    setLoadingDetails((prev) => ({ ...prev, [id]: true }));
    try {
      const data = await apiGet<UniversityDetail>(`/data/universities/${id}`);
      setDetails((prev) => ({ ...prev, [id]: data }));
    } finally {
      setLoadingDetails((prev) => ({ ...prev, [id]: false }));
    }
  }

  function toggleCard(id: number) {
    const nextExpanded = expandedId === id ? null : id;
    setExpandedId(nextExpanded);
    if (nextExpanded === id) {
      void loadDetails(id);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="rounded-2xl border border-zinc-200 bg-white px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <HeroPill icon={<Sparkles size={13} className="text-zinc-700" />}>
                Samga Atlas
              </HeroPill>
              <HeroPill
                icon={<Building2 size={13} className="text-zinc-700" />}
              >
                {copy.shellTitle}
              </HeroPill>
            </div>
            <h1
              className="text-[24px] text-zinc-950 sm:text-[30px]"
              style={{ fontWeight: 760, lineHeight: 1.08 }}
            >
              {t("uni.title")}
            </h1>
            <p
              className="mt-3 text-[13px] text-zinc-600 sm:text-[14px]"
              style={{ lineHeight: 1.7 }}
            >
              {copy.shellBody}
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-3 lg:w-[430px]">
            <HeroStat label={copy.loaded} value={String(universities.length)} />
            <HeroStat label={copy.matching} value={String(filtered.length)} />
            <HeroStat label={copy.elite} value={String(eliteCount)} />
          </div>
        </div>

        <div className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,0.8fr)]">
          <div className="relative">
            <span className="pointer-events-none absolute left-0 top-0 flex h-[52px] w-11 items-center justify-center text-zinc-600">
              <Search size={16} aria-hidden="true" />
            </span>
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("uni.search")}
              className="h-[52px] w-full rounded-lg border border-zinc-200 bg-white py-3 pl-11 pr-4 text-zinc-800 outline-none transition-colors focus:border-zinc-400"
              style={{ fontSize: 14, fontWeight: 520 }}
            />
          </div>

          <FilterSelect
            label={copy.prestigeTitle}
            hint={copy.prestigeHint}
            value={prestigeFilter}
            options={prestigeOptions}
            onChange={setPrestigeFilter}
          />

          <FilterSelect
            label={copy.popularityTitle}
            hint={copy.popularityHint}
            value={popularityFilter}
            options={popularityOptions}
            onChange={setPopularityFilter}
          />
        </div>
      </section>

      {majorCodeFilter ? (
        <div
          data-testid="major-code-filter-banner"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900"
        >
          <p style={{ fontSize: 13, lineHeight: 1.6 }}>
            {lang === "kz"
              ? "Мамандық коды бойынша сүзу: "
              : "Фильтр по коду специальности: "}
            <span className="font-semibold">{majorCodeFilter}</span>
          </p>
          <button
            type="button"
            onClick={clearMajorCodeFilter}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-emerald-300 bg-white px-3 text-emerald-800 transition-colors hover:bg-emerald-100"
            style={{ fontSize: 12, fontWeight: 700 }}
          >
            {lang === "kz" ? "Сүзгіні алып тастау" : "Сбросить"}
          </button>
        </div>
      ) : null}

      {!loading && !error ? (
        <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-zinc-600">
          <p style={{ fontSize: 13, lineHeight: 1.6 }}>
            {copy.detailsHint}{" "}
            <span className="font-semibold text-zinc-900">
              {lang === "kz" ? "Жоғары сұраныстағысы" : "Высокий спрос"}:{" "}
              {demandCount}
            </span>
          </p>
        </div>
      ) : null}

      {loading ? (
        <div
          className="rounded-2xl border border-zinc-200 bg-white px-4 py-12 text-center text-zinc-500"
          style={{ fontSize: 14 }}
        >
          {copy.loading}
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
          <AlertCircle size={16} className="shrink-0" />
          <span style={{ fontSize: 13 }}>{error}</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-12 text-center">
          <p
            className="mb-1 text-zinc-700"
            style={{ fontSize: 15, fontWeight: 700 }}
          >
            {copy.noResults}
          </p>
          <p className="text-zinc-600" style={{ fontSize: 13 }}>
            {copy.tryDifferent}
          </p>
          {(query ||
            prestigeFilter !== ALL_VALUE ||
            popularityFilter !== ALL_VALUE) && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setPrestigeFilter(ALL_VALUE);
                setPopularityFilter(ALL_VALUE);
              }}
              className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50"
              style={{ fontSize: 12.5, fontWeight: 700 }}
            >
              {copy.clearFilters}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {visibleUniversities.map((uni) => (
            <UniversityCard
              key={uni.id}
              summary={uni}
              detail={details[uni.id]}
              loadingDetails={Boolean(loadingDetails[uni.id])}
              expanded={expandedId === uni.id}
              onToggle={() => toggleCard(uni.id)}
              labels={copy}
            />
          ))}
          {hasMoreUniversities ? (
            <div className="flex flex-col items-center gap-2 pt-2">
              <p className="text-zinc-500" style={{ fontSize: 12.5 }}>
                {copy.showing}: {visibleUniversities.length}/{filtered.length}
              </p>
              <button
                type="button"
                onClick={() =>
                  setVisibleCount((count) => count + UNIVERSITY_PAGE_SIZE)
                }
                className="inline-flex h-11 items-center justify-center rounded-lg border border-zinc-200 bg-white px-5 text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50"
                style={{ fontSize: 13, fontWeight: 700 }}
              >
                {copy.showMore}
              </button>
            </div>
          ) : null}
        </div>
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

function FilterSelect({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
      <span
        className="block text-zinc-700"
        style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}
      >
        {label}
      </span>
      <span
        className="mt-1 block text-zinc-600"
        style={{ fontSize: 11, lineHeight: 1.45 }}
      >
        {hint}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-3 w-full bg-transparent text-zinc-900 outline-none"
        style={{ fontSize: 14, fontWeight: 550 }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function MiniStat({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-3 py-3">
      <div
        className="flex items-center gap-2 text-zinc-500"
        style={{ fontSize: 11, fontWeight: 760, textTransform: "uppercase" }}
      >
        {icon}
        <span>{label}</span>
      </div>
      <p
        className="mt-2 text-zinc-900"
        style={{ fontSize: 15, fontWeight: 700 }}
      >
        {value}
      </p>
    </div>
  );
}

function tierBadgeClass(kind: "prestige" | "popularity", value?: string) {
  if (kind === "prestige") {
    if (value === "elite") return "border-amber-200 bg-amber-50 text-amber-700";
    if (value === "strong") return "border-sky-200 bg-sky-50 text-sky-700";
    if (value === "established")
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    return "border-zinc-200 bg-zinc-50 text-zinc-600";
  }

  if (value === "very_high")
    return "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700";
  if (value === "high") return "border-violet-200 bg-violet-50 text-violet-700";
  if (value === "medium") return "border-cyan-200 bg-cyan-50 text-cyan-700";
  return "border-zinc-200 bg-zinc-50 text-zinc-600";
}

function formatPrestigeLabel(
  labels: UniversityCardLabels,
  tier?: PrestigeTier,
) {
  if (tier === "elite") return labels.prestigeElite;
  if (tier === "strong") return labels.prestigeStrong;
  if (tier === "established") return labels.prestigeEstablished;
  return labels.prestigeRegional;
}

function formatPopularityLabel(
  labels: UniversityCardLabels,
  tier?: PopularityTier,
) {
  if (tier === "very_high") return labels.popularityVeryHigh;
  if (tier === "high") return labels.popularityHigh;
  if (tier === "medium") return labels.popularityMedium;
  return labels.popularityNiche;
}

type UniversityCardLabels = {
  code: string;
  city: string;
  students: string;
  grantStudents: string;
  paidStudents: string;
  dorm: string;
  military: string;
  website: string;
  majors: string;
  majorsCount: string;
  noMajors: string;
  minGeneral: string;
  minRural: string;
  thresholdYear: string;
  tuition: string;
  tuitionUnknown: string;
  medianScore: string;
  popularity: string;
  prestige: string;
  loadingDetails: string;
  prestigeElite: string;
  prestigeStrong: string;
  prestigeEstablished: string;
  prestigeRegional: string;
  popularityVeryHigh: string;
  popularityHigh: string;
  popularityMedium: string;
  popularityNiche: string;
  unknown: string;
  openProfile: string;
  available: string;
  notAvailable: string;
};

function formatAvailability(
  value: unknown,
  labels: Pick<UniversityCardLabels, "available" | "notAvailable" | "unknown">,
) {
  if (typeof value === "boolean") {
    return value ? labels.available : labels.notAvailable;
  }

  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (
    !normalized ||
    normalized === "null" ||
    normalized === "none" ||
    normalized === "unknown"
  ) {
    return labels.unknown;
  }
  if (["true", "yes", "да", "есть", "имеется", "бар"].includes(normalized)) {
    return labels.available;
  }
  if (["false", "no", "нет", "отсутствует", "жоқ"].includes(normalized)) {
    return labels.notAvailable;
  }
  return String(value);
}

function UniversityCard({
  summary,
  detail,
  loadingDetails,
  expanded,
  onToggle,
  labels,
}: {
  summary: UniversityOption;
  detail?: UniversityDetail;
  loadingDetails: boolean;
  expanded: boolean;
  onToggle: () => void;
  labels: UniversityCardLabels;
}) {
  const current = detail ?? summary;
  const code = current.university_code || summary.value || labels.unknown;
  const majors = detail?.majors ?? [];
  const prestigeLabel = formatPrestigeLabel(labels, current.prestige_tier);
  const popularityLabel = formatPopularityLabel(
    labels,
    current.popularity_tier,
  );

  return (
    <article
      className={`overflow-hidden rounded-xl border bg-white transition-colors ${
        expanded ? "border-zinc-300" : "border-zinc-200/80"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-5 py-5 text-left transition-colors hover:bg-zinc-50"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="mb-3 flex flex-wrap gap-2">
              <Badge
                className={tierBadgeClass("prestige", current.prestige_tier)}
                icon={<Shield size={12} />}
                text={`${labels.prestige}: ${prestigeLabel}`}
              />
              <Badge
                className={tierBadgeClass(
                  "popularity",
                  current.popularity_tier,
                )}
                icon={<TrendingUp size={12} />}
                text={`${labels.popularity}: ${popularityLabel}`}
              />
              <Badge
                className="border-zinc-200 bg-zinc-50 text-zinc-600"
                icon={<Building2 size={12} />}
                text={`${labels.code}: ${code}`}
              />
            </div>

            <h2
              className="text-zinc-950"
              style={{ fontSize: 18, fontWeight: 740, lineHeight: 1.25 }}
            >
              {summary.label}
            </h2>

            <div
              className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-zinc-500"
              style={{ fontSize: 12.5 }}
            >
              {current.city ? <span>{current.city}</span> : null}
              {current.median_grant_threshold ? (
                <span>
                  {labels.medianScore}: {current.median_grant_threshold}/140
                </span>
              ) : null}
              {current.majors_count ? (
                <span>
                  {current.majors_count} {labels.majors.toLowerCase()}
                </span>
              ) : null}
            </div>

            {current.prestige_note ? (
              <p
                className="mt-3 max-w-3xl text-zinc-600"
                style={{ fontSize: 13, lineHeight: 1.6 }}
              >
                {current.prestige_note}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-3 self-start">
            <span
              className="inline-flex h-11 items-center rounded-lg border border-zinc-200 bg-zinc-50 px-4 text-zinc-700"
              style={{ fontSize: 13, fontWeight: 700 }}
            >
              {labels.openProfile}
            </span>
            {expanded ? (
              <ChevronUp size={18} className="text-zinc-600" />
            ) : (
              <ChevronDown size={18} className="text-zinc-600" />
            )}
          </div>
        </div>
      </button>

      {expanded ? (
        <div className="border-t border-zinc-200 bg-zinc-50 px-5 py-5">
          {loadingDetails ? (
            <p className="text-zinc-500" style={{ fontSize: 13 }}>
              {labels.loadingDetails}
            </p>
          ) : detail ? (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MiniStat
                  icon={<Users size={13} className="text-zinc-500" />}
                  label={labels.students}
                  value={
                    detail.total_students?.toLocaleString() ?? labels.unknown
                  }
                />
                <MiniStat
                  icon={<Sparkles size={13} className="text-amber-700" />}
                  label={labels.grantStudents}
                  value={
                    detail.grant_students?.toLocaleString() ?? labels.unknown
                  }
                />
                <MiniStat
                  icon={<Building2 size={13} className="text-zinc-500" />}
                  label={labels.paidStudents}
                  value={
                    detail.paid_students?.toLocaleString() ?? labels.unknown
                  }
                />
                <MiniStat
                  icon={<BookOpen size={13} className="text-zinc-500" />}
                  label={labels.majorsCount}
                  value={String(detail.majors_count ?? majors.length)}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <SoftTag
                  label={`${labels.dorm}: ${formatAvailability(detail.has_dorm, labels)}`}
                />
                <SoftTag
                  label={`${labels.military}: ${formatAvailability(detail.military_chair, labels)}`}
                />
                {detail.city ? (
                  <SoftTag label={`${labels.city}: ${detail.city}`} />
                ) : null}
                {detail.website ? (
                  <a
                    href={detail.website}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
                    style={{ fontSize: 12, fontWeight: 650 }}
                  >
                    <ExternalLink size={13} className="text-zinc-700" />
                    {labels.website}
                  </a>
                ) : null}
              </div>

              <div>
                <p
                  className="mb-3 text-zinc-900"
                  style={{ fontSize: 14, fontWeight: 720 }}
                >
                  {labels.majors}
                </p>
                {majors.length === 0 ? (
                  <div
                    className="rounded-xl border border-zinc-200 bg-white px-4 py-4 text-zinc-500"
                    style={{ fontSize: 13 }}
                  >
                    {labels.noMajors}
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {majors.map((major) => (
                      <div
                        key={major.code}
                        className="rounded-xl border border-zinc-200 bg-white px-4 py-4"
                      >
                        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                          <div className="min-w-0">
                            <p
                              className="text-zinc-900"
                              style={{ fontSize: 14, fontWeight: 700 }}
                            >
                              {major.name}
                            </p>
                            <p
                              className="mt-1 text-zinc-600"
                              style={{ fontSize: 11, fontWeight: 650 }}
                            >
                              {major.code}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <SoftTag
                              label={`${labels.minGeneral}: ${major.thresholds?.general ?? "—"}`}
                            />
                            <SoftTag
                              label={`${labels.minRural}: ${major.thresholds?.rural ?? "—"}`}
                            />
                            <SoftTag
                              label={
                                major.tuition_per_year != null
                                  ? `${labels.tuition}: ${Number(major.tuition_per_year).toLocaleString("ru-RU")} ₸`
                                  : `${labels.tuition}: ${labels.tuitionUnknown}`
                              }
                            />
                            {major.thresholds?.year ? (
                              <SoftTag
                                label={`${labels.thresholdYear}: ${major.thresholds.year}`}
                              />
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-zinc-500" style={{ fontSize: 13 }}>
              {labels.unknown}
            </p>
          )}
        </div>
      ) : null}
    </article>
  );
}

function Badge({
  className,
  icon,
  text,
}: {
  className: string;
  icon: ReactNode;
  text: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 ${className}`}
      style={{ fontSize: 11, fontWeight: 650 }}
    >
      {icon}
      {text}
    </span>
  );
}

function SoftTag({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-zinc-600"
      style={{ fontSize: 12, fontWeight: 600 }}
    >
      {label}
    </span>
  );
}
