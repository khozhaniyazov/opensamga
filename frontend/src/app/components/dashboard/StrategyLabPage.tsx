import {
  AlertTriangle,
  BarChart3,
  BookOpenCheck,
  Brain,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Compass,
  GraduationCap,
  Library,
  Route,
  ShieldCheck,
  Target,
  Users,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { apiGet } from "../../lib/api";
import { useLang } from "../LanguageContext";
import {
  buildGrantPlanningSummary,
  buildFourChoiceStrategy,
  countMissingThresholds,
  countPlaceholderThresholds,
  type GrantPlanningAction,
  type GrantPlanningSummary,
  type StrategyBand,
  type StrategyChoice,
  type StrategyUniversityOption,
} from "./strategyLabModel";
import {
  PROFILE_PAIR_FIRST_WAVE,
  profilePairQueryString,
  profilePairRiskLabel,
  profilePairSeverityClasses,
  profilePairSeverityLabel,
  resolveProfilePairId,
  type ProfilePair,
  type ProfilePairSimulatorResponse,
} from "./profilePairSimulatorModel";
import { useAuth } from "../auth/AuthContext";

interface ExamHistoryItem {
  id: number;
  subjects: string[];
  score: number;
  max_score: number;
  submitted_at: string;
}

type BudgetBand = "unknown" | "under700" | "mid" | "high";

const SUBJECT_PAIRS = [
  {
    id: "math-it",
    ru: {
      title: "Математика + Информатика",
      majors: "IT, Computer Science, аналитика, инженерные программы",
      pressure: "Высокая конкуренция на сильные IT-направления.",
      next: "Проверить математику, алгоритмы и лимиты по грантам.",
    },
    kz: {
      title: "Математика + Информатика",
      majors: "IT, Computer Science, аналитика, инженерлік бағыттар",
      pressure: "Күшті IT бағыттарында бәсеке жоғары.",
      next: "Математика, алгоритм және грант шектерін тексеру.",
    },
  },
  {
    id: "bio-chem",
    ru: {
      title: "Биология + Химия",
      majors: "Медицина, биология, фармация, health science",
      pressure: "Порог часто высокий, платное обучение может быть дорогим.",
      next: "Сравнить грант-риск и бюджет до выбора города.",
    },
    kz: {
      title: "Биология + Химия",
      majors: "Медицина, биология, фармация, health science",
      pressure: "Шек жиі жоғары, ақылы оқу қымбат болуы мүмкін.",
      next: "Қала таңдауға дейін грант тәуекелі мен бюджетті салыстыру.",
    },
  },
  {
    id: "phys-math",
    ru: {
      title: "Физика + Математика",
      majors: "Инженерия, энергетика, архитектура, прикладная математика",
      pressure: "Сильный вариант, если база по формулам стабильная.",
      next: "Закрыть пробелы по механике, электричеству и функциям.",
    },
    kz: {
      title: "Физика + Математика",
      majors: "Инженерия, энергетика, архитектура, қолданбалы математика",
      pressure: "Формула базасы тұрақты болса, мықты бағыт.",
      next: "Механика, электр және функциялар бойынша олқылықты жабу.",
    },
  },
  {
    id: "geo-math",
    ru: {
      title: "География + Математика",
      majors: "Экономика, логистика, география, менеджмент",
      pressure: "Направления широкие, но качество вузов сильно различается.",
      next: "Смотреть не только грант, но и город, практику и трудоустройство.",
    },
    kz: {
      title: "География + Математика",
      majors: "Экономика, логистика, география, менеджмент",
      pressure: "Бағыт кең, бірақ ЖОО сапасы қатты өзгереді.",
      next: "Грантпен бірге қала, практика және жұмысқа шығуды қарау.",
    },
  },
  {
    id: "history-law",
    ru: {
      title: "Всемирная история + Право",
      majors: "Право, госуправление, международные отношения",
      pressure: "Важно заранее оценить конкурс и реальные карьерные маршруты.",
      next: "Сравнить проходные данные и альтернативные гуманитарные траектории.",
    },
    kz: {
      title: "Дүниежүзі тарихы + Құқық",
      majors: "Құқық, мемлекеттік басқару, халықаралық қатынастар",
      pressure: "Конкурс пен нақты карьера жолдарын ерте бағалау керек.",
      next: "Өту деректерін және гуманитарлық балама жолдарды салыстыру.",
    },
  },
] as const;

type SubjectPairId = (typeof SUBJECT_PAIRS)[number]["id"];

const BUDGET_OPTIONS: Record<
  BudgetBand,
  { ru: string; kz: string; riskRu: string; riskKz: string }
> = {
  unknown: {
    ru: "Бюджет не указан",
    kz: "Бюджет көрсетілмеген",
    riskRu: "Риск нельзя оценить без бюджета и проверенной стоимости.",
    riskKz: "Бюджет пен тексерілген баға болмаса, тәуекел анық емес.",
  },
  under700: {
    ru: "До 700 000 ₸ / год",
    kz: "700 000 ₸ дейін / жыл",
    riskRu: "Нужен сильный упор на грант или недорогие региональные варианты.",
    riskKz: "Грантқа немесе қолжетімді өңірлік нұсқаға басымдық керек.",
  },
  mid: {
    ru: "700 000 - 1 200 000 ₸ / год",
    kz: "700 000 - 1 200 000 ₸ / жыл",
    riskRu: "Можно держать платный backup, но стоимость нужно подтвердить.",
    riskKz: "Ақылы backup ұстауға болады, бірақ бағаны растау керек.",
  },
  high: {
    ru: "1 200 000 ₸+ / год",
    kz: "1 200 000 ₸+ / жыл",
    riskRu: "Больше свободы по backup-вариантам, но грант всё равно важен.",
    riskKz: "Backup таңдауы кеңірек, бірақ грант бәрібір маңызды.",
  },
};

function clampScore(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(140, Math.round(value)));
}

function uniqueCities(universities: StrategyUniversityOption[]): string[] {
  return Array.from(
    new Set(
      universities
        .map((university) => university.city?.trim())
        .filter((city): city is string => Boolean(city)),
    ),
  ).sort((a, b) => a.localeCompare(b, "ru"));
}

function scoreBandCopy(score: number, lang: "ru" | "kz") {
  if (score >= 110) {
    return lang === "kz"
      ? "Күшті позиция: енді тәуекелі төмен таңдау мен амбицияны теңестіру."
      : "Сильная позиция: пора балансировать безопасный выбор и амбицию.";
  }
  if (score >= 90) {
    return lang === "kz"
      ? "Жұмыс істеуге болатын позиция: 4 таңдауды тәуекел деңгейімен бөлу."
      : "Рабочая позиция: четыре выбора нужно разделить по уровню риска.";
  }
  if (score >= 70) {
    return lang === "kz"
      ? "Қалпына келтіру режимі: алдымен жеңіл ұпайлар мен әлсіз тақырыптар."
      : "Режим восстановления: сначала лёгкие баллы и слабые темы.";
  }
  return lang === "kz"
    ? "База режимі: грант стратегиясына дейін пәндік негізді көтеру."
    : "Базовый режим: до грант-стратегии нужно поднять предметную основу.";
}

function bandCopy(band: StrategyBand, lang: "ru" | "kz") {
  const ru = {
    safe: {
      title: "Безопасный выбор",
      detail: "Запас по баллам есть. Подходит для снижения риска.",
    },
    balanced: {
      title: "Реалистичный выбор",
      detail: "Близко к текущему уровню. Нужна точная проверка программы.",
    },
    ambitious: {
      title: "Амбициозный выбор",
      detail: "Порог выше текущего балла. Нужен план добора.",
    },
    backup: {
      title: "Backup",
      detail: "Держит запасной маршрут. Стоимость надо подтвердить.",
    },
  };
  const kz = {
    safe: {
      title: "Қауіпі төмен таңдау",
      detail: "Балл қоры бар. Тәуекелді азайтуға жарайды.",
    },
    balanced: {
      title: "Реалистік таңдау",
      detail: "Қазіргі деңгейге жақын. Бағдарламаны нақты тексеру керек.",
    },
    ambitious: {
      title: "Амбициялық таңдау",
      detail: "Шек қазіргі балдан жоғары. Ұпай қосу жоспары керек.",
    },
    backup: {
      title: "Backup",
      detail: "Қосымша маршрут береді. Ақысын растау керек.",
    },
  };
  return (lang === "kz" ? kz : ru)[band];
}

function marginText(choice: StrategyChoice, lang: "ru" | "kz") {
  if (choice.margin == null) {
    return lang === "kz" ? "Дерек жеткіліксіз" : "Недостаточно данных";
  }
  if (choice.margin >= 0) {
    return lang === "kz"
      ? `+${choice.margin} балл қор`
      : `+${choice.margin} баллов запас`;
  }
  return lang === "kz"
    ? `${choice.margin} балл жетпейді`
    : `${choice.margin} баллов до порога`;
}

function grantSummaryCopy(summary: GrantPlanningSummary, lang: "ru" | "kz") {
  if (summary.status === "ready") {
    return lang === "kz"
      ? {
          title: "Тексерілетін нұсқалар бар",
          detail:
            "Грант таңдауы расталған шектерге сүйенеді. Енді қала, бюджет және мамандық сапасын салыстыру керек.",
        }
      : {
          title: "Есть проверяемые варианты",
          detail:
            "Грант-выбор опирается на подтверждаемые пороги. Теперь нужно сравнить город, бюджет и качество программы.",
        };
  }

  if (summary.status === "uncertain") {
    return lang === "kz"
      ? {
          title: "Белгісіздік бар",
          detail:
            "Бір бөлігі расталған, бірақ placeholder немесе бос шек бар. Мұндай ЖОО-ны ресми дерекпен тексеру керек.",
        }
      : {
          title: "Есть неопределённость",
          detail:
            "Часть вариантов проверяема, но есть placeholder или пустые пороги. Такие вузы нужно сверить с официальным источником.",
        };
  }

  return lang === "kz"
    ? {
        title: "Тексерілген дерек аз",
        detail:
          "Бұл фильтр бойынша сенімді есеп жасауға дерек жетпейді. Қаланы кеңейту немесе ресми деректі жинау керек.",
      }
    : {
        title: "Мало проверенных данных",
        detail:
          "По этому фильтру недостаточно данных для уверенного расчёта. Нужно расширить город или собрать официальный источник.",
      };
}

function grantActionCopy(action: GrantPlanningAction, lang: "ru" | "kz") {
  const ru: Record<GrantPlanningAction, string> = {
    compare_verified:
      "Сравните реалистичные варианты и держите один backup по стоимости.",
    verify_data:
      "Сначала проверьте варианты без порога и записи с placeholder-данными.",
    expand_city:
      "Расширьте город или добавьте региональные вузы, чтобы найти backup.",
    raise_score:
      "Нужен план добора баллов: ближайшие reach-варианты уже видны.",
  };
  const kz: Record<GrantPlanningAction, string> = {
    compare_verified:
      "Реалистік нұсқаларды салыстырып, бағасы қолжетімді бір backup ұстаңыз.",
    verify_data:
      "Алдымен шегі жоқ және placeholder дерегі бар нұсқаларды тексеріңіз.",
    expand_city:
      "Backup табу үшін қаланы кеңейтіңіз немесе өңірлік ЖОО қосыңыз.",
    raise_score:
      "Ұпай қосу жоспары керек: ең жақын reach-нұсқалар көрініп тұр.",
  };
  return (lang === "kz" ? kz : ru)[action];
}

export default function StrategyLabPage() {
  const { lang, t } = useLang();
  const isKz = lang === "kz";
  useDocumentTitle(t("dash.nav.strategyLab"));
  // v3.61 (2026-05-02): respect the user's actual chosen pair when
  // initialising the simulator. Without this the page always defaulted
  // to SUBJECT_PAIRS[0] (Math+IT) regardless of profile, so the
  // "ВЫБРАННАЯ ПАРА" preview lied for everyone whose profile wasn't
  // Math+IT. Fixes E2E B7.
  const { user } = useAuth();

  const [universities, setUniversities] = useState<StrategyUniversityOption[]>(
    [],
  );
  const [history, setHistory] = useState<ExamHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [scoreTouched, setScoreTouched] = useState(false);
  const [currentScore, setCurrentScore] = useState(90);
  const [preferredCity, setPreferredCity] = useState("all");
  const [budget, setBudget] = useState<BudgetBand>("unknown");
  // Lazy initializer so the very first paint already shows the user's
  // pair if the AuthContext has hydrated synchronously (happy path —
  // localStorage token + cached `user`). The async fallback below
  // covers the slow-network case.
  const [selectedPairId, setSelectedPairId] = useState<SubjectPairId>(() => {
    const resolved = resolveProfilePairId(user?.chosen_subjects);
    if (resolved) {
      const match = SUBJECT_PAIRS.find((pair) => pair.id === resolved);
      if (match) return match.id;
    }
    return SUBJECT_PAIRS[0].id;
  });
  const [pairAutoInitFromProfile, setPairAutoInitFromProfile] = useState(false);

  // v3.61: profile may load AFTER initial render (auth context fetches
  // /auth/me asynchronously). When it lands and the user hasn't manually
  // touched the picker yet, snap the selection to the resolved pair
  // exactly once. Subsequent profile updates won't override the user's
  // picks.
  useEffect(() => {
    if (pairAutoInitFromProfile) return;
    const resolved = resolveProfilePairId(user?.chosen_subjects);
    if (!resolved) return;
    const match = SUBJECT_PAIRS.find((pair) => pair.id === resolved);
    if (!match) return;
    setSelectedPairId(match.id);
    setPairAutoInitFromProfile(true);
  }, [user?.chosen_subjects, pairAutoInitFromProfile]);
  // v3.25 (2026-05-01): Live profile-pair simulator data. Fetched lazily
  // when the user selects a pair; cached per pair so re-clicking is free.
  const [pairSimulatorByPair, setPairSimulatorByPair] = useState<
    Record<string, ProfilePairSimulatorResponse | null>
  >({});
  const [pairSimulatorLoading, setPairSimulatorLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(false);
      const [universityResult, historyResult] = await Promise.allSettled([
        apiGet<StrategyUniversityOption[]>("/data/universities"),
        apiGet<ExamHistoryItem[]>("/exam/history"),
      ]);

      if (cancelled) return;

      if (universityResult.status === "fulfilled") {
        setUniversities(universityResult.value);
      } else {
        setLoadError(true);
      }

      if (historyResult.status === "fulfilled") {
        setHistory(historyResult.value);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const sortedHistory = useMemo(
    () =>
      [...history].sort(
        (a, b) =>
          new Date(b.submitted_at).getTime() -
          new Date(a.submitted_at).getTime(),
      ),
    [history],
  );
  const latestExam = sortedHistory[0] ?? null;
  const previousExam = sortedHistory[1] ?? null;

  useEffect(() => {
    if (!scoreTouched && latestExam?.score != null) {
      setCurrentScore(clampScore(latestExam.score));
    }
  }, [latestExam, scoreTouched]);

  const cities = useMemo(() => uniqueCities(universities), [universities]);
  const strategyChoices = useMemo(
    () => buildFourChoiceStrategy(universities, currentScore, preferredCity),
    [universities, currentScore, preferredCity],
  );
  const grantSummary = useMemo(
    () => buildGrantPlanningSummary(universities, currentScore, preferredCity),
    [universities, currentScore, preferredCity],
  );
  const missingThresholds = useMemo(
    () => countMissingThresholds(universities),
    [universities],
  );
  const placeholderThresholds = useMemo(
    () => countPlaceholderThresholds(universities),
    [universities],
  );
  const selectedPair =
    SUBJECT_PAIRS.find((pair) => pair.id === selectedPairId) ??
    SUBJECT_PAIRS[0];
  const pairCopy = selectedPair[lang];

  // v3.25: pair the static SUBJECT_PAIRS ids 1:1 with the BE-driven first
  // wave (Math+IT, Bio+Chem, Phys+Math, Geo+Math, History+Law). The id
  // strings match by intent so we can resolve the BE pair from the
  // current selection without a second source of truth.
  const liveProfilePair: ProfilePair | undefined = PROFILE_PAIR_FIRST_WAVE.find(
    (p) => p.id === selectedPairId,
  );
  const liveSimulator =
    liveProfilePair != null
      ? (pairSimulatorByPair[liveProfilePair.id] ?? null)
      : null;

  useEffect(() => {
    if (!liveProfilePair) return;
    if (pairSimulatorByPair[liveProfilePair.id] !== undefined) return;
    let cancelled = false;
    (async () => {
      setPairSimulatorLoading(true);
      try {
        const data = await apiGet<ProfilePairSimulatorResponse>(
          `/strategy/profile-pair?${profilePairQueryString(liveProfilePair)}`,
        );
        if (cancelled) return;
        setPairSimulatorByPair((prev) => ({
          ...prev,
          [liveProfilePair.id]: data,
        }));
      } catch {
        if (cancelled) return;
        setPairSimulatorByPair((prev) => ({
          ...prev,
          [liveProfilePair.id]: null,
        }));
      } finally {
        if (!cancelled) setPairSimulatorLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [liveProfilePair, pairSimulatorByPair]);
  const trend =
    latestExam && previousExam ? latestExam.score - previousExam.score : null;
  const verifiedChoiceCount = strategyChoices.filter(
    (choice) => choice.university,
  ).length;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <section className="rounded-2xl border border-zinc-200 bg-white px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <StatusPill icon={Compass} label="Strategy Lab" />
              <StatusPill
                icon={ShieldCheck}
                label={
                  isKz
                    ? "Тексеру керек дерек белгіленеді"
                    : "Неполные данные помечаются"
                }
              />
            </div>
            <h1
              className="text-zinc-950 text-[24px] sm:text-[30px]"
              style={{ fontWeight: 760, lineHeight: 1.08 }}
            >
              {isKz
                ? "ҰБТ таңдауы: балл, пән, ЖОО және бюджет бір жерде"
                : "ЕНТ-стратегия: балл, предметы, вуз и бюджет в одном месте"}
            </h1>
            <p
              className="mt-3 max-w-3xl text-zinc-600 text-[13px] sm:text-[14px]"
              style={{ lineHeight: 1.7 }}
            >
              {isKz
                ? "Бұл бет ағымдағы баллды, әлсіз тақырыптарды және ЖОО деректерін бір шешім картасына жинайды. Қабылдау ережесі өзгерсе, соңғы тексеру ресми дереккөзде жасалады."
                : "Этот экран собирает текущий балл, слабые темы и вузовские данные в одну карту решений. Если правила приёма меняются, финальная проверка остаётся за официальным источником."}
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[420px]">
            <MetricTile
              label={isKz ? "Ағымдағы балл" : "Текущий балл"}
              value={`${currentScore}/140`}
              hint={scoreBandCopy(currentScore, lang)}
            />
            <MetricTile
              label={isKz ? "ЖОО дерегі" : "Данные вузов"}
              value={loading ? "..." : String(universities.length)}
              hint={
                isKz
                  ? `${missingThresholds} жазбада шек белгісіз`
                  : `${missingThresholds} записей без порога`
              }
            />
            <MetricTile
              label={isKz ? "4 таңдау" : "4 выбора"}
              value={`${verifiedChoiceCount}/4`}
              hint={
                isKz
                  ? "Тек расталған сандық шектермен"
                  : "Только по проверяемым числовым порогам"
              }
            />
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
          <SectionHeader
            icon={Target}
            label={isKz ? "Кіріс деректері" : "Входные данные"}
            title={isKz ? "Қазіргі позиция" : "Текущая позиция"}
          />

          <label className="mt-5 block">
            <span className="text-[12px] font-semibold text-zinc-700">
              {isKz ? "ҰБТ балы" : "Балл ЕНТ"}
            </span>
            <div className="mt-2 flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={140}
                value={currentScore}
                onChange={(event) => {
                  setScoreTouched(true);
                  setCurrentScore(clampScore(Number(event.target.value)));
                }}
                className="w-full accent-zinc-950"
              />
              <input
                type="number"
                min={0}
                max={140}
                value={currentScore}
                onChange={(event) => {
                  setScoreTouched(true);
                  setCurrentScore(clampScore(Number(event.target.value)));
                }}
                className="h-10 w-20 rounded-lg border border-zinc-200 px-3 text-sm font-semibold text-zinc-900 outline-none focus:border-zinc-400"
              />
            </div>
          </label>

          <label className="mt-4 block">
            <span className="text-[12px] font-semibold text-zinc-700">
              {isKz ? "Қала" : "Город"}
            </span>
            <select
              value={preferredCity}
              onChange={(event) => setPreferredCity(event.target.value)}
              className="mt-2 h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400"
            >
              <option value="all">
                {isKz ? "Барлық қалалар" : "Все города"}
              </option>
              {cities.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </select>
          </label>

          <label className="mt-4 block">
            <span className="text-[12px] font-semibold text-zinc-700">
              {isKz ? "Отбасы бюджеті" : "Семейный бюджет"}
            </span>
            <select
              value={budget}
              onChange={(event) => setBudget(event.target.value as BudgetBand)}
              className="mt-2 h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400"
            >
              {Object.entries(BUDGET_OPTIONS).map(([value, option]) => (
                <option key={value} value={value}>
                  {isKz ? option.kz : option.ru}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <div className="flex items-start gap-2">
              <AlertTriangle
                size={16}
                className="mt-0.5 shrink-0 text-amber-700"
              />
              <p className="text-[12px] leading-6 text-amber-900">
                {isKz
                  ? "0 мәндері белгісіз дерек ретінде саналады. Баға, грант және ереже бойынша соңғы шешім ресми дерекпен тексеріледі."
                  : "Значения 0 считаются неизвестными. Стоимость, грант и правила нужно подтвердить официальным источником перед решением."}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
          <SectionHeader
            icon={Route}
            label={isKz ? "4 таңдау" : "4 выбора"}
            title={
              isKz
                ? "Грант стратегиясының черновигі"
                : "Черновик грант-стратегии"
            }
            action={
              <Link
                to="/dashboard/universities"
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-200 px-3 text-[12px] font-semibold text-zinc-700 transition-colors hover:bg-zinc-50"
              >
                <GraduationCap size={14} />
                {isKz ? "ЖОО атласы" : "Атлас вузов"}
              </Link>
            }
          />

          {loadError ? (
            <EmptyPanel
              title={
                isKz ? "ЖОО дерегі жүктелмеді" : "Данные вузов не загрузились"
              }
              detail={
                isKz
                  ? "API қолжетімді болғанда стратегия автоматты түрде есептеледі."
                  : "Когда API станет доступен, стратегия пересчитается автоматически."
              }
            />
          ) : (
            <div className="mt-5 space-y-4">
              <GrantUncertaintyPanel summary={grantSummary} lang={lang} />
              <div className="grid gap-3 xl:grid-cols-2">
                {strategyChoices.map((choice) => (
                  <StrategyChoiceTile
                    key={choice.band}
                    choice={choice}
                    lang={lang}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
          <SectionHeader
            icon={Brain}
            label={isKz ? "Әлсіз тақырыптар" : "Слабые темы"}
            title={isKz ? "Қалпына келтіру циклі" : "Цикл восстановления"}
          />
          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <ActionStep
              icon={ClipboardCheck}
              step="01"
              title={isKz ? "Пробник" : "Пробник"}
              detail={
                latestExam
                  ? isKz
                    ? `Соңғы нәтиже: ${latestExam.score}/${latestExam.max_score}`
                    : `Последний результат: ${latestExam.score}/${latestExam.max_score}`
                  : isKz
                    ? "Жаңа бақылау нүктесін жасаңыз"
                    : "Создать новую контрольную точку"
              }
              href="/dashboard/exams"
            />
            <ActionStep
              icon={BarChart3}
              step="02"
              title={isKz ? "Gap map" : "Gap map"}
              detail={
                isKz
                  ? "Тақырып бойынша нақты олқылықты көру"
                  : "Посмотреть точные пробелы по темам"
              }
              href="/dashboard/gap-analysis"
            />
            <ActionStep
              icon={Library}
              step="03"
              title={isKz ? "Кітап" : "Книга"}
              detail={
                isKz
                  ? "Түсіндірме мен дәлелді дерекке өту"
                  : "Перейти к объяснению и источнику"
              }
              href="/dashboard/library"
            />
            <ActionStep
              icon={BookOpenCheck}
              step="04"
              title={isKz ? "Ретест" : "Ретест"}
              detail={
                isKz
                  ? "Жабылған тақырыпты қайта тексеру"
                  : "Проверить закрытую тему повторно"
              }
              href="/dashboard/training"
            />
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
          <SectionHeader
            icon={Users}
            label={isKz ? "Ата-ана есебі" : "Родительский отчёт"}
            title={isKz ? "Қысқа статус" : "Короткий статус"}
          />
          <div className="mt-5 space-y-3">
            <ReportRow
              label={isKz ? "Балл бағыты" : "Динамика балла"}
              value={
                trend == null
                  ? isKz
                    ? "Әзірге салыстыру жоқ"
                    : "Пока нет сравнения"
                  : trend >= 0
                    ? `+${trend}`
                    : String(trend)
              }
            />
            <ReportRow
              label={isKz ? "Грант бағыты" : "Грант-направление"}
              value={scoreBandCopy(currentScore, lang)}
            />
            <ReportRow
              label={isKz ? "Бюджет тәуекелі" : "Бюджетный риск"}
              value={
                isKz
                  ? BUDGET_OPTIONS[budget].riskKz
                  : BUDGET_OPTIONS[budget].riskRu
              }
            />
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
          <SectionHeader
            icon={GraduationCap}
            label={isKz ? "Пән таңдауы" : "Выбор предметов"}
            title={isKz ? "Бағыт симуляторы" : "Симулятор траектории"}
          />
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {SUBJECT_PAIRS.map((pair) => {
              const active = pair.id === selectedPairId;
              const copy = pair[lang];
              return (
                <button
                  key={pair.id}
                  type="button"
                  onClick={() => {
                    setSelectedPairId(pair.id);
                    // v3.61: any manual selection wins over a late
                    // profile snap. Setting the flag here is harmless
                    // even if it's already true.
                    setPairAutoInitFromProfile(true);
                  }}
                  className={`rounded-xl border px-4 py-4 text-left transition-colors ${
                    active
                      ? "border-zinc-950 bg-zinc-950 text-white"
                      : "border-zinc-200 bg-white text-zinc-900 hover:border-zinc-300 hover:bg-zinc-50"
                  }`}
                >
                  <p className="text-[14px] font-bold leading-5">
                    {copy.title}
                  </p>
                  <p
                    className={`mt-2 text-[12px] leading-6 ${
                      active ? "text-zinc-200" : "text-zinc-500"
                    }`}
                  >
                    {copy.majors}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
          <SectionHeader
            icon={Wallet}
            label={isKz ? "Таңдалған жұп" : "Выбранная пара"}
            title={pairCopy.title}
          />
          <div className="mt-5 space-y-3">
            <ReportRow
              label={isKz ? "Ашатын бағыттар" : "Открывает"}
              value={pairCopy.majors}
            />
            <ReportRow
              label={isKz ? "Назар" : "Риск"}
              value={pairCopy.pressure}
            />
            <ReportRow
              label={isKz ? "Келесі қадам" : "Следующий шаг"}
              value={pairCopy.next}
            />
          </div>
        </div>
      </section>

      {liveProfilePair ? (
        <ProfilePairLiveSection
          isKz={isKz}
          loading={pairSimulatorLoading && liveSimulator == null}
          data={liveSimulator}
          pair={liveProfilePair}
        />
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
          <SectionHeader
            icon={CalendarDays}
            label={isKz ? "Ережеге сезімтал" : "Зависит от правил"}
            title={
              isKz
                ? "Қайта тапсыру және бос грант жолдары"
                : "Повторная сдача и вакантные гранты"
            }
          />
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <GuideTile
              title={isKz ? "Қайта тапсыру" : "Пересдача"}
              detail={
                isKz
                  ? "Күнтізбе, лимит және өтініш мерзімін ресми дерекпен тексеру."
                  : "Проверить календарь, лимиты и сроки заявлений по официальному источнику."
              }
            />
            <GuideTile
              title={isKz ? "Ақылыдан грантқа" : "С платного на грант"}
              detail={
                isKz
                  ? "GPA, бос орын, құжат және ішкі конкурс бөлек тексеріледі."
                  : "GPA, вакантные места, документы и внутренний конкурс проверяются отдельно."
              }
            />
            <GuideTile
              title={isKz ? "Backup ЖОО" : "Backup вуз"}
              detail={
                isKz
                  ? "Баға, жатақхана, қала және мамандық лицензиясын бірге қарау."
                  : "Смотреть стоимость, общежитие, город и лицензию программы вместе."
              }
            />
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
          <SectionHeader
            icon={CheckCircle2}
            label={isKz ? "Дерек сапасы" : "Качество данных"}
            title={isKz ? "Қолданылған шектеулер" : "Ограничения расчёта"}
          />
          <div className="mt-5 space-y-3">
            {/* v3.73 (B18, 2026-05-02): the placeholder row used to
                always render — even when placeholderThresholds === 0,
                producing the visually weird "0 placeholder · 0 записей
                посчитаны неизвестными" line. Hide the row entirely when
                there's nothing to flag; the rest of the data-quality
                box (Trust + Decision rows) stands on its own. */}
            {placeholderThresholds > 0 ? (
              <ReportRow
                label="0 placeholder"
                value={
                  isKz
                    ? `${placeholderThresholds} жазба белгісіз деп саналды`
                    : `${placeholderThresholds} записей посчитаны неизвестными`
                }
              />
            ) : null}
            <ReportRow
              label={isKz ? "Сенімділік" : "Доверие"}
              value={
                isKz
                  ? "Порог бар болса - орташа. Порог жоқ болса - төмен."
                  : "Если порог есть - среднее. Если порога нет - низкое."
              }
            />
            <ReportRow
              label={isKz ? "Шешім" : "Решение"}
              value={
                isKz
                  ? "Соңғы өтініш алдында ресми дереккөзді тексеру керек."
                  : "Перед финальной подачей нужен официальный источник."
              }
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function GrantUncertaintyPanel({
  summary,
  lang,
}: {
  summary: GrantPlanningSummary;
  lang: "ru" | "kz";
}) {
  const isKz = lang === "kz";
  const copy = grantSummaryCopy(summary, lang);
  const tone =
    summary.status === "ready"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : summary.status === "uncertain"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-rose-200 bg-rose-50 text-rose-900";

  return (
    <div className={`rounded-xl border px-4 py-4 ${tone}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-[11px] font-bold uppercase opacity-75">
            {isKz ? "Грант белгісіздігі" : "Грант-неопределённость"}
          </p>
          <h3 className="mt-1 text-[17px] font-bold leading-6">{copy.title}</h3>
          <p className="mt-2 text-[12px] leading-6 opacity-85">{copy.detail}</p>
        </div>
        <span className="inline-flex h-8 shrink-0 items-center rounded-lg border border-current px-3 text-[11px] font-bold uppercase opacity-80">
          {summary.coverageRatio}% {isKz ? "қамту" : "coverage"}
        </span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <SummaryFact
          label={isKz ? "Реалистік" : "Реалистичные"}
          value={String(summary.realisticOptions)}
        />
        <SummaryFact
          label={isKz ? "Reach" : "Reach"}
          value={String(summary.reachOptions)}
        />
        <SummaryFact
          label={isKz ? "Дерек жоқ" : "Нет данных"}
          value={String(summary.missingDataOptions)}
        />
        <SummaryFact
          label={isKz ? "Backup тәуекел" : "Backup риск"}
          value={String(summary.backupOptions)}
        />
      </div>

      <div className="mt-3 flex items-start gap-2 text-[12px] leading-6">
        <AlertTriangle size={15} className="mt-0.5 shrink-0" />
        <p>{grantActionCopy(summary.primaryAction, lang)}</p>
      </div>
    </div>
  );
}

function StatusPill({
  icon: Icon,
  label,
}: {
  icon: typeof Compass;
  label: string;
}) {
  return (
    <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-[11px] font-bold text-zinc-700">
      <Icon size={13} />
      {label}
    </span>
  );
}

function SummaryFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-current bg-white/55 px-3 py-2">
      <p className="text-[10px] font-bold uppercase opacity-65">{label}</p>
      <p className="mt-1 text-[15px] font-bold leading-none">{value}</p>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  label,
  title,
  action,
}: {
  icon: typeof Compass;
  label: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700">
          <Icon size={18} />
        </span>
        <div>
          <p className="text-[11px] font-bold uppercase text-zinc-500">
            {label}
          </p>
          <h2 className="mt-1 text-[20px] font-bold leading-tight text-zinc-950">
            {title}
          </h2>
        </div>
      </div>
      {action}
    </div>
  );
}

function MetricTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
      <p className="text-[11px] font-bold uppercase text-zinc-500">{label}</p>
      <p className="mt-1 text-[22px] font-bold leading-none text-zinc-950">
        {value}
      </p>
      <p className="mt-2 text-[12px] leading-5 text-zinc-600">{hint}</p>
    </div>
  );
}

function StrategyChoiceTile({
  choice,
  lang,
}: {
  choice: StrategyChoice;
  lang: "ru" | "kz";
}) {
  const copy = bandCopy(choice.band, lang);
  const isKz = lang === "kz";
  const tone =
    choice.band === "safe"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : choice.band === "balanced"
        ? "border-sky-200 bg-sky-50 text-sky-800"
        : choice.band === "ambitious"
          ? "border-violet-200 bg-violet-50 text-violet-800"
          : "border-zinc-200 bg-zinc-50 text-zinc-800";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span
            className={`inline-flex rounded-lg border px-2.5 py-1 text-[11px] font-bold ${tone}`}
          >
            {copy.title}
          </span>
          <p className="mt-3 text-[15px] font-bold leading-5 text-zinc-950">
            {choice.university?.label ??
              (isKz ? "Әзірге нұсқа жоқ" : "Пока нет варианта")}
          </p>
        </div>
        <span className="rounded-lg border border-zinc-200 px-2 py-1 text-[11px] font-bold text-zinc-600">
          {choice.confidence === "medium"
            ? isKz
              ? "орташа"
              : "medium"
            : isKz
              ? "төмен"
              : "low"}
        </span>
      </div>
      <p className="mt-2 text-[12px] leading-5 text-zinc-500">{copy.detail}</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <SmallFact
          label={isKz ? "Шек" : "Порог"}
          value={choice.threshold ? `${choice.threshold}/140` : "n/a"}
        />
        <SmallFact
          label={isKz ? "Қор" : "Запас"}
          value={marginText(choice, lang)}
        />
      </div>
      {choice.university ? (
        <p className="mt-3 text-[12px] leading-5 text-zinc-500">
          {choice.university.city ||
            (isKz ? "Қала белгісіз" : "Город неизвестен")}
          {choice.university.majors_count
            ? `, ${choice.university.majors_count} ${
                isKz ? "бағыт" : "направлений"
              }`
            : ""}
        </p>
      ) : null}
    </div>
  );
}

function SmallFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
      <p className="text-[10px] font-bold uppercase text-zinc-500">{label}</p>
      <p className="mt-1 text-[12px] font-semibold leading-5 text-zinc-900">
        {value}
      </p>
    </div>
  );
}

function ActionStep({
  icon: Icon,
  step,
  title,
  detail,
  href,
}: {
  icon: typeof Compass;
  step: string;
  title: string;
  detail: string;
  href: string;
}) {
  return (
    <Link
      to={href}
      className="group rounded-xl border border-zinc-200 bg-white px-4 py-4 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700">
          <Icon size={18} />
        </span>
        <span className="text-[11px] font-bold text-zinc-400">{step}</span>
      </div>
      <p className="mt-4 text-[15px] font-bold text-zinc-950">{title}</p>
      <p className="mt-2 text-[12px] leading-5 text-zinc-500">{detail}</p>
    </Link>
  );
}

function ReportRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
      <p className="text-[11px] font-bold uppercase text-zinc-500">{label}</p>
      <p className="mt-1 text-[13px] font-semibold leading-6 text-zinc-900">
        {value}
      </p>
    </div>
  );
}

function GuideTile({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-4">
      <p className="text-[15px] font-bold text-zinc-950">{title}</p>
      <p className="mt-2 text-[12px] leading-6 text-zinc-600">{detail}</p>
    </div>
  );
}

function EmptyPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mt-5 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-8 text-center">
      <p className="text-[15px] font-bold text-zinc-950">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-[12px] leading-6 text-zinc-600">
        {detail}
      </p>
    </div>
  );
}

// v3.25 (2026-05-01): Live data-driven profile pair simulator panel.
// Renders the BE-aggregated reachable majors + risk badges next to the
// curator-authored career copy that already lives above. Curated copy
// from the BE (career_copy.ru/kz) wins over the FE static SUBJECT_PAIRS
// strings when present, so future pair additions can ship purely from
// the backend without a FE change.
function ProfilePairLiveSection({
  isKz,
  loading,
  data,
  pair,
}: {
  isKz: boolean;
  loading: boolean;
  data: ProfilePairSimulatorResponse | null;
  pair: ProfilePair;
}) {
  const lang: "ru" | "kz" = isKz ? "kz" : "ru";
  const titleLabel = isKz
    ? "Деректерге негізделген сурет"
    : "Картина по данным";
  const headingTitle = isKz
    ? `${pair.subjects[0]} + ${pair.subjects[1]}`
    : `${pair.subjects[0]} + ${pair.subjects[1]}`;

  if (loading) {
    return (
      <section className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
        <SectionHeader
          icon={BarChart3}
          label={titleLabel}
          title={headingTitle}
        />
        <p
          className="mt-5 text-[13px] text-zinc-500"
          data-testid="profile-pair-loading"
        >
          {isKz ? "Жүктелуде..." : "Загружаем..."}
        </p>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
        <SectionHeader
          icon={BarChart3}
          label={titleLabel}
          title={headingTitle}
        />
        <EmptyPanel
          title={isKz ? "Дерек әзірге жоқ" : "Данных пока нет"}
          detail={
            isKz
              ? "Бұл жұп үшін деректерді көрсету мүмкін болмады. Кейінірек қайталап көріңіз."
              : "Для этой пары не удалось получить данные. Попробуйте позже."
          }
        />
      </section>
    );
  }

  const career = data.career_copy ? data.career_copy[lang] : null;
  const topMajors = data.majors.slice(0, 8);
  const summary = data.summary;
  const risks = data.risks;

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
      <SectionHeader icon={BarChart3} label={titleLabel} title={headingTitle} />

      {career ? (
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <ReportRow
            label={isKz ? "Бағыттар" : "Направления"}
            value={career.majors}
          />
          <ReportRow
            label={isKz ? "Бәсеке" : "Конкуренция"}
            value={career.pressure}
          />
          <ReportRow
            label={isKz ? "Келесі қадам" : "Следующий шаг"}
            value={career.next}
          />
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <ReportRow
          label={isKz ? "Бағыттар саны" : "Кол-во направлений"}
          value={String(summary.major_count)}
        />
        <ReportRow
          label={isKz ? "Грантқа орташа балл" : "Средний порог гранта"}
          value={
            summary.median_grant_threshold != null
              ? String(summary.median_grant_threshold)
              : isKz
                ? "Дерек жоқ"
                : "Нет данных"
          }
        />
        <ReportRow
          label={isKz ? "Берілген грант" : "Грантов выдано"}
          value={String(summary.total_grants_awarded)}
        />
      </div>

      <div
        className={`mt-5 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-bold ${profilePairSeverityClasses(
          risks.severity,
        )}`}
        data-testid="profile-pair-severity"
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        {profilePairSeverityLabel(risks.severity, lang)}
        {risks.flags.length > 0 ? (
          <span className="ml-1 font-semibold">
            {risks.flags.map((f) => profilePairRiskLabel(f, lang)).join(" · ")}
          </span>
        ) : null}
      </div>

      {topMajors.length > 0 ? (
        <div className="mt-5">
          <p className="text-[12px] font-bold uppercase text-zinc-500">
            {isKz ? "Қол жетімді бағыттар" : "Доступные направления"}
          </p>
          <ul className="mt-2 divide-y divide-zinc-200 rounded-xl border border-zinc-200">
            {topMajors.map((m) => (
              <li
                key={m.code ?? m.name ?? Math.random().toString(36)}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                data-testid="profile-pair-major-row"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-zinc-900">
                    {m.name ?? m.code ?? "—"}
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    {(isKz ? "ЖОО: " : "Вузов: ") + m.university_count}
                    {m.median_grant_threshold != null ? (
                      <>
                        {" · "}
                        {(isKz ? "Орташа балл: " : "Средний балл: ") +
                          m.median_grant_threshold}
                      </>
                    ) : null}
                  </p>
                </div>
                {m.deep_link ? (
                  <Link
                    to={m.deep_link}
                    className="rounded-lg border border-zinc-300 px-3 py-1 text-[11px] font-bold text-zinc-700 hover:bg-zinc-50"
                  >
                    {isKz ? "ЖОО ашу" : "Открыть"}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
