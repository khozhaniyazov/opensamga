import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  GraduationCap,
  Languages,
  LogOut,
  Plus,
  Search,
  Sparkles,
  Target,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useNavigate } from "react-router";
import { flushSync } from "react-dom";
import { useAuth, type AuthUser } from "../auth/AuthContext";
import { useLang } from "../LanguageContext";
import { Logo } from "../shared/Logo";
import { apiGet, apiPut } from "../../lib/api";
import {
  getProfileSubjectPair,
  getRequiredUntSubjects,
  getSubjectMaxScore,
  isValidProfileSubjectPair,
  subjectLabel,
} from "../../lib/subjectLabels";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { SubjectCombinationPicker } from "./SubjectCombinationPicker";
import { onboardingScoreCountLabel } from "./onboardingScoreCountLabel";

interface UniversityOption {
  id: number;
  label: string;
  value: string;
}

interface UniversityApiItem {
  id?: number;
  name?: string;
  label?: string;
  value?: string;
  city?: string;
}

type ScoresBySubject = Record<string, string[]>;
type StepId = "subjects" | "results" | "goal" | "review";

interface StepConfig {
  id: StepId;
  icon: LucideIcon;
  title: string;
  hint: string;
}

const MAX_RESULTS = 5;

function normalizeUniversities(data: unknown): UniversityOption[] {
  const list = Array.isArray(data)
    ? data
    : data &&
        typeof data === "object" &&
        Array.isArray((data as { universities?: unknown }).universities)
      ? (data as { universities: unknown[] }).universities
      : [];

  return list
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const university = item as UniversityApiItem;
      const id = Number(university.id);
      const label =
        university.label || university.name || university.value || "";
      if (!Number.isFinite(id) || !label) {
        return null;
      }
      return {
        id,
        label,
        value: university.value || label,
      };
    })
    .filter((item): item is UniversityOption => Boolean(item));
}

/**
 * s26 phase 5 (2026-04-27): Latin-aware match for the university search.
 *
 * Background: backend labels every university in Cyrillic
 * («Назарбаев Университеті», «Қазақстан-Британ техникалық университеті»),
 * but students reflexively type Latin abbreviations (KBTU, NU, KIMEP,
 * SDU, AUES). The previous filter did a Cyrillic substring match on
 * `label.toLocaleLowerCase()` only — Latin queries returned 0 hits.
 *
 * Fix is two-fold:
 *   1. A small alias dictionary for the well-known abbreviations the
 *      students use. Each alias maps to a list of Cyrillic substring
 *      tokens; a label matches if it contains any of them.
 *   2. A general Latin→Cyrillic letter fold (single-char transliteration)
 *      so partial Latin queries like "kazakh" / "ulttyk" / "almaty"
 *      still match labels.
 *
 * Both layers are case-insensitive. The function is exported via the
 * picker but kept module-local to avoid leaking from the onboarding
 * file (it's already long enough).
 */
const UNIVERSITY_ALIASES: Record<string, string[]> = {
  // Latin alias → Cyrillic substring tokens that should match.
  // Tokens are matched case-insensitively against `label`.
  kbtu: ["казахстанско-британск", "қазақстан-британ"],
  "kazakh-british": ["казахстанско-британск", "қазақстан-британ"],
  nu: ["назарбаев"],
  nazarbayev: ["назарбаев"],
  kimep: ["kimep", "кимэп"],
  sdu: ["сду", "сулейман демирель", "сүлейман демирел"],
  "suleyman demirel": ["сулейман демирель", "сүлейман демирел"],
  aues: ["аукэс", "энергетики и связи", "энергетика және байланыс"],
  satbayev: ["сатпаев", "сәтбаев"],
  "satbayev university": ["сатпаев", "сәтбаев"],
  kaznu: ["аль-фараби", "әл-фараби"],
  "al-farabi": ["аль-фараби", "әл-фараби"],
  enu: ["евразийск", "еуразиялық", "гумилев"],
  agrarian: ["аграрн", "аграрл"],
  iitu: [
    "международный университет информационных",
    "халықаралық ақпараттық технологиялар",
  ],
  astana: ["астана", "астаналық"],
  almaty: ["алматы", "алматинск"],
};

/** Crude Latin→Cyrillic single-letter fold for fuzzy-substring matching.
 *  Not a real transliteration — just enough to make "kazakh" match the
 *  Cyrillic stem "казах" inside labels. */
function foldLatinToCyrillic(s: string): string {
  // Order matters: digraphs first.
  const digraphs: Array<[RegExp, string]> = [
    [/sh/g, "ш"],
    [/ch/g, "ч"],
    [/zh/g, "ж"],
    [/kh/g, "х"],
    [/yu/g, "ю"],
    [/ya/g, "я"],
    [/ye/g, "е"],
    [/yo/g, "ё"],
    [/ts/g, "ц"],
  ];
  let out = s.toLowerCase();
  for (const [re, rep] of digraphs) out = out.replace(re, rep);
  const map: Record<string, string> = {
    a: "а",
    b: "б",
    c: "к",
    d: "д",
    e: "е",
    f: "ф",
    g: "г",
    h: "х",
    i: "и",
    j: "ж",
    k: "к",
    l: "л",
    m: "м",
    n: "н",
    o: "о",
    p: "п",
    q: "қ",
    r: "р",
    s: "с",
    t: "т",
    u: "у",
    v: "в",
    w: "в",
    x: "х",
    y: "ы",
    z: "з",
  };
  out = out
    .split("")
    .map((ch) => map[ch] ?? ch)
    .join("");
  return out;
}

/** Returns true if `label` matches the user's query. Tries, in order:
 *   1. plain substring match on the Cyrillic label;
 *   2. alias-dictionary lookup for known Latin abbreviations;
 *   3. Latin→Cyrillic fold on the query, then substring match again.
 *  Empty query matches everything. */
export function matchUniversityLabel(label: string, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return true;
  const labelLower = label.toLocaleLowerCase();
  if (labelLower.includes(q)) return true;

  // Alias hit: exact alias match OR alias substring (so "kbtu uni"
  // still hits the KBTU alias).
  for (const alias of Object.keys(UNIVERSITY_ALIASES)) {
    if (q === alias || q.includes(alias)) {
      const tokens = UNIVERSITY_ALIASES[alias];
      if (tokens && tokens.some((tok) => labelLower.includes(tok))) return true;
    }
  }

  // Latin→Cyrillic fold and re-test.
  const folded = foldLatinToCyrillic(q);
  if (folded && folded !== q && labelLower.includes(folded)) return true;

  return false;
}

function normalizeInitialSubjects(user: AuthUser | null): string[] {
  const stored = user?.chosen_subjects || [];
  const storedPair = getProfileSubjectPair(stored);
  return storedPair ? [...storedPair.subjects] : [];
}

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { user, refreshUser, setUserFromServer, logout } = useAuth();
  const { lang, setLang } = useLang();
  const [universities, setUniversities] = useState<UniversityOption[]>([]);
  const [subjects, setSubjects] = useState<string[]>(() =>
    normalizeInitialSubjects(user),
  );
  const [targetUniversityId, setTargetUniversityId] = useState(
    user?.target_university_id ? String(user.target_university_id) : "",
  );
  // F2 (s26 phase 7): do NOT auto-pick subjects[0] as the weakest. Pre-
  // selecting "Математика" because it sorts first quietly anchored
  // students who hadn't actually thought about which subject was their
  // weakest. They'd skip past the goal step never realising the field
  // was already filled in. Now it stays blank until the user clicks a
  // card; required-field validation (`copy.requiredWeakest`) blocks the
  // submit if they try to ignore it.
  const [weakestSubject, setWeakestSubject] = useState(
    user?.weakest_subject && subjects.includes(user.weakest_subject)
      ? user.weakest_subject
      : "",
  );
  const [scores, setScores] = useState<ScoresBySubject>(() =>
    initialScores(user, subjects),
  );
  // F-02..F-04 (s23+): per-cell flags so the ScoreSubjectCard can render
  // an inline helper when the user types a non-digit (silently stripped
  // before this) or a number above the subject's `maxScore`.
  // Keyed by `${subject}:${index}`.
  const [scoreFlags, setScoreFlags] = useState<
    Record<string, { stripped: boolean; overMax: boolean }>
  >({});
  // s26 phase 7: target major (single string, persisted as
  // target_majors[0]) + competition quota. Both are required to finish
  // onboarding so the chat agent never has to re-ask for them.
  const [targetMajor, setTargetMajor] = useState<string>(
    user?.target_majors && user.target_majors.length > 0
      ? String(user.target_majors[0])
      : "",
  );
  const [competitionQuota, setCompetitionQuota] = useState<string>(
    user?.competition_quota === "GENERAL" || user?.competition_quota === "RURAL"
      ? user.competition_quota
      : "",
  );
  // Per-university major catalog. Loaded lazily when the user picks a
  // university so we never block the goal step on a network call.
  const [universityMajors, setUniversityMajors] = useState<
    Array<{ code: string; name: string }>
  >([]);
  const [loadingMajors, setLoadingMajors] = useState(false);
  const [step, setStep] = useState<StepId>("subjects");
  const [saving, setSaving] = useState(false);
  const [loadingUniversities, setLoadingUniversities] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const copy =
    lang === "kz"
      ? {
          pageTitle: "Тіркеуді аяқтау",
          title: "Оқу профилін реттеу",
          subtitle:
            "Samga.ai пәндеріңізді, соңғы балдарыңызды және мақсатыңызды ескеріп жұмыс істейді.",
          account: "Есептік жазба",
          signOut: "Шығу",
          stepLabel: "Қадам",
          subjects: "Пәндер",
          subjectsHint: "2 бейіндік пән",
          results: "Нәтижелер",
          resultsHint: "5 пән бойынша 1-5 нәтиже",
          goal: "Мақсат",
          goalHint: "ЖОО және әлсіз пән",
          review: "Тексеру",
          reviewHint: "Деректерді растау",
          subjectCounter: "Таңдалған жұп",
          subjectNotSelected: "Таңдалмады",
          resultsTitle: "Соңғы тест нәтижелері",
          resultsSubtitle:
            "Қазақстан тарихы, екі сауаттылық және екі бейіндік пән бойынша балдарды енгізіңіз. + барлық пәнге бір нәтиже қатарын қосады.",
          dreamUniversity: "Арман ЖОО",
          weakest: "Ең әлсіз пән",
          selectUniversity: "ЖОО таңдаңыз",
          score: "Балл",
          addResult: "Нәтиже қосу",
          removeResult: "Нәтижені өшіру",
          average: "Орташа",
          best: "Ең жоғары",
          attempts: "нәтиже",
          searchUniversity: "ЖОО атауын іздеу",
          noUniversity: "ЖОО табылмады",
          weakestHint:
            "Samga алғашқы жаттығулар мен апталық жоспарды осы пәннен бастайды.",
          // s26 phase 7
          major: "Мақсатты мамандық",
          majorHint: "Грант шегі дәл осы мамандық үшін есептеледі.",
          majorPlaceholder: "Алдымен ЖОО таңдаңыз",
          majorEmpty: "Бұл ЖОО үшін мамандық табылмады",
          majorLoading: "Мамандықтар жүктелуде...",
          quota: "Конкурс квотасы",
          quotaHint: "Грантқа қандай негізде үміткерсіз?",
          quotaGeneral: "Жалпы конкурс",
          quotaGeneralDesc: "Қалалар, барлық сыныптағылар",
          quotaRural: "Ауыл квотасы",
          quotaRuralDesc: "Ауылдық тізілімде тіркелгендер",
          requiredMajor: "Мақсатты мамандықты таңдаңыз.",
          requiredQuota: "Конкурс квотасын таңдаңыз.",
          reviewTitle: "Samga профиліңіз дайын",
          reviewSubtitle:
            "Бұл деректер чатта, жоспарларда, қате талдауында және ЖОО ұсыныстарында қолданылады.",
          profileReady: "Дайын",
          samgaWillUse: "Samga осы деректерді қолданады",
          back: "Артқа",
          next: "Жалғастыру",
          save: "Тіркеуді аяқтау",
          saving: "Сақталуда...",
          requiredSubjects:
            "Қолжетімді бейіндік пәндер комбинациясын таңдаңыз.",
          requiredUniversity: "Арман ЖОО таңдаңыз.",
          requiredWeakest:
            "Ең әлсіз пән таңдалған екі пәннің бірі болуы керек.",
          requiredScore: "Әр пән бойынша 1-ден 5-ке дейін нәтиже енгізіңіз.",
          scoreRange: "Балл пән максимумынан аспауы керек.",
          scoreOnlyDigits: "Тек сандар (0–9) қолданылады.",
          scoreOverMax: "Бұл пәннің максимумынан асып кетті:",
          maxScore: "Максимум",
          loadUniversities: "ЖОО тізімін жүктеу мүмкін болмады.",
          loadingUniversities: "ЖОО тізімі жүктеліп жатыр...",
          profileSubjects: "Бейіндік пәндер",
          latestScores: "Соңғы балдар",
          handoffTitle: "Samga жұмыс кеңістігін ашып жатыр",
          handoffHint: "Профиль сақталды. Жеке панельді дайындап жатырмыз...",
        }
      : {
          pageTitle: "Завершение регистрации",
          title: "Настройка учебного профиля",
          subtitle:
            "Samga.ai будет опираться на ваши предметы, последние баллы и цель.",
          account: "Аккаунт",
          signOut: "Выйти",
          stepLabel: "Шаг",
          subjects: "Предметы",
          subjectsHint: "2 профильных предмета",
          results: "Результаты",
          resultsHint: "1-5 результатов по 5 предметам",
          goal: "Цель",
          goalHint: "Вуз и слабый предмет",
          review: "Проверка",
          reviewHint: "Подтвердите данные",
          subjectCounter: "Выбранная комбинация",
          subjectNotSelected: "Не выбрано",
          resultsTitle: "Последние результаты тестов",
          resultsSubtitle:
            "Введите баллы по Истории Казахстана, двум грамотностям и двум профильным предметам. + добавляет один ряд результата сразу для всех предметов.",
          dreamUniversity: "Вуз мечты",
          weakest: "Самый слабый предмет",
          selectUniversity: "Выберите вуз",
          score: "Балл",
          addResult: "Добавить",
          removeResult: "Удалить результат",
          average: "Средний",
          best: "Лучший",
          attempts: "результ.",
          searchUniversity: "Найти вуз по названию",
          noUniversity: "Вуз не найден",
          weakestHint:
            "Samga начнёт первые тренировки и план именно с этого предмета.",
          // s26 phase 7
          major: "Целевая специальность",
          majorHint: "Грантовый порог считается именно по этой специальности.",
          majorPlaceholder: "Сначала выберите вуз",
          majorEmpty: "У этого вуза не нашлось специальностей",
          majorLoading: "Загружаем специальности...",
          quota: "Конкурсная квота",
          quotaHint: "По какой квоте претендуете на грант?",
          quotaGeneral: "Общий конкурс",
          quotaGeneralDesc: "Городская и общая аудитория",
          quotaRural: "Сельская квота",
          quotaRuralDesc: "Зарегистрированы в сельском реестре",
          requiredMajor: "Выберите целевую специальность.",
          requiredQuota: "Выберите тип квоты.",
          reviewTitle: "Профиль Samga готов",
          reviewSubtitle:
            "Эти данные будут использоваться в чате, плане, разборе ошибок и подборе вузов.",
          profileReady: "Профиль готов",
          samgaWillUse: "Samga будет использовать эти данные",
          back: "Назад",
          next: "Продолжить",
          save: "Завершить регистрацию",
          saving: "Сохраняем...",
          requiredSubjects:
            "Выберите доступную комбинацию профильных предметов.",
          requiredUniversity: "Выберите вуз мечты.",
          requiredWeakest:
            "Самый слабый предмет должен быть одним из двух выбранных.",
          requiredScore: "Укажите от 1 до 5 результатов по каждому предмету.",
          scoreRange: "Балл не должен превышать максимум предмета.",
          scoreOnlyDigits: "Допускаются только цифры (0–9).",
          scoreOverMax: "Превышен максимум по предмету:",
          maxScore: "Максимум",
          loadUniversities: "Не удалось загрузить список вузов.",
          loadingUniversities: "Загружаем список вузов...",
          profileSubjects: "Профильные предметы",
          latestScores: "Последние результаты",
          handoffTitle: "Samga открывает рабочее пространство",
          handoffHint: "Профиль сохранён. Готовим персональную панель...",
        };

  useDocumentTitle(copy.pageTitle);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setLoadingUniversities(true);
        const data = await apiGet<unknown>("/data/universities");
        if (!cancelled) {
          setUniversities(normalizeUniversities(data));
        }
      } catch {
        if (!cancelled) {
          setError(copy.loadUniversities);
        }
      } finally {
        if (!cancelled) {
          setLoadingUniversities(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [copy.loadUniversities]);

  // s26 phase 7: load the major catalog scoped to the selected
  // university whenever it changes. Endpoint is /data/universities/{id}
  // which already returns a `majors[]` array sorted by general
  // threshold desc — we only project {code, name}. Clears the picked
  // major if it's not present in the new uni's catalog so the user is
  // re-prompted instead of submitting a stale choice.
  useEffect(() => {
    if (!targetUniversityId) {
      setUniversityMajors([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        setLoadingMajors(true);
        const data = await apiGet<{
          majors?: Array<{ code?: string; name?: string }>;
        }>(`/data/universities/${targetUniversityId}`);
        if (cancelled) return;
        const list = Array.isArray(data?.majors)
          ? data.majors
              .map((m) => ({
                code: String(m.code || "").trim(),
                name: String(m.name || "").trim(),
              }))
              .filter((m) => m.code && m.name)
          : [];
        setUniversityMajors(list);
        // Drop a stale major selection that doesn't belong to this uni.
        if (targetMajor && !list.some((m) => m.code === targetMajor)) {
          setTargetMajor("");
        }
      } catch {
        if (!cancelled) setUniversityMajors([]);
      } finally {
        if (!cancelled) setLoadingMajors(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // targetMajor intentionally omitted — we only re-fetch on uni
    // change. Including it would trigger an extra request whenever the
    // user picks a major from the loaded list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetUniversityId]);

  const steps = useMemo<StepConfig[]>(
    () => [
      {
        id: "subjects",
        icon: BookOpen,
        title: copy.subjects,
        hint: copy.subjectsHint,
      },
      {
        id: "results",
        icon: Target,
        title: copy.results,
        hint: copy.resultsHint,
      },
      {
        id: "goal",
        icon: GraduationCap,
        title: copy.goal,
        hint: copy.goalHint,
      },
      { id: "review", icon: Check, title: copy.review, hint: copy.reviewHint },
    ],
    [
      copy.goal,
      copy.goalHint,
      copy.results,
      copy.resultsHint,
      copy.review,
      copy.reviewHint,
      copy.subjects,
      copy.subjectsHint,
    ],
  );

  const currentIndex = steps.findIndex((item) => item.id === step);
  // `steps` is statically non-empty above; this index/fallback chain
  // satisfies noUncheckedIndexedAccess without changing runtime semantics.
  const activeStep = steps[currentIndex] ?? steps[0]!;
  const isFinalStep = currentIndex === steps.length - 1;
  // v4.13 (2026-05-06): block Continue on the results step while any
  // per-cell overMax flag is set. validateStep() would catch this on
  // click anyway (via copy.scoreRange), but a disabled button removes
  // the "click → silent banner" round-trip for the most common
  // onboarding typo (999 into History of KZ's 20-point field). We do
  // NOT block for missing values — the banner pattern for those
  // matches every other step and is already role="alert".
  const hasOverMaxScore =
    step === "results" &&
    Object.values(scoreFlags).some((flag) => flag?.overMax);
  const selectedSubjects = useMemo(() => new Set(subjects), [subjects]);
  const selectedUniversity = universities.find(
    (item) => String(item.id) === targetUniversityId,
  );
  const testSubjects = useMemo(
    () => getRequiredUntSubjects(subjects),
    [subjects],
  );
  const attemptCount = Math.max(
    1,
    ...testSubjects.map((subject) => scores[subject]?.length || 0),
  );
  const selectedPairLabel =
    subjects.length === 2
      ? subjects.map((subject) => subjectLabel(subject, lang)).join(" + ")
      : copy.subjectNotSelected;
  const weakestSubjectLabel = weakestSubject
    ? subjectLabel(weakestSubject, lang)
    : copy.subjectNotSelected;
  const filledResultCount = testSubjects.reduce(
    (sum, subject) => sum + normalizedScoreValues(subject).length,
    0,
  );
  const totalResultSlots = Math.max(
    testSubjects.length * attemptCount,
    testSubjects.length,
  );
  const progressPercent = ((currentIndex + 1) / steps.length) * 100;
  const ActiveStepIcon = activeStep.icon;

  function applySubjects(nextSubjects: string[]) {
    const pair = getProfileSubjectPair(nextSubjects);
    const uniqueSubjects = pair ? [...pair.subjects] : [];
    const requiredSubjects = getRequiredUntSubjects(uniqueSubjects);

    setSubjects(uniqueSubjects);
    setScores((current) => {
      const next = { ...current };
      for (const subject of requiredSubjects) {
        next[subject] = current[subject]?.length
          ? current[subject].slice(0, MAX_RESULTS)
          : [""];
      }
      return next;
    });
    // F2 (s26 phase 7): preserve current pick if it's still in the new
    // pair, otherwise CLEAR rather than defaulting to uniqueSubjects[0].
    // The user must consciously re-pick when they swap subject pair.
    setWeakestSubject((current) =>
      (uniqueSubjects as string[]).includes(current) ? current : "",
    );
  }

  function selectSubjectPair(pairSubjects: readonly string[]) {
    applySubjects([...pairSubjects]);
  }

  function updateScore(subject: string, index: number, value: string) {
    // F-02..F-04 (s23+): give the user explicit, inline feedback when
    // their typing was rejected or clamped, instead of silently dropping
    // characters / accepting nonsense:
    //   * non-digit characters (`-`, letters, decimal points...) are
    //     stripped here BUT we now flag the field as "stripped" so the
    //     ScoreSubjectCard renders a helper line.
    //   * a numeric value above `maxScore` is held in state so the user
    //     can see what they typed, but flagged as "overMax" with an
    //     inline error.
    const stripped = value.replace(/[^\d]/g, "");
    const wasStripped = stripped.length !== value.length;
    const clean = stripped.slice(0, 3);
    const numeric = clean === "" ? null : Number(clean);
    const subjectMax = getSubjectMaxScore(subject);
    const overMax = numeric !== null && numeric > subjectMax;

    setScores((prev) => {
      const nextScores = [...(prev[subject] || [""])];
      nextScores[index] = clean;
      return { ...prev, [subject]: nextScores };
    });
    setScoreFlags((prev) => {
      const key = `${subject}:${index}`;
      const next = { ...prev };
      if (wasStripped || overMax) {
        next[key] = { stripped: wasStripped, overMax };
      } else {
        delete next[key];
      }
      return next;
    });
  }

  function scoreValues(subject: string): string[] {
    const current = scores[subject] || [];
    return Array.from(
      { length: attemptCount },
      (_, index) => current[index] || "",
    );
  }

  function addScoreRound() {
    setScores((prev) => {
      const currentLength = Math.max(
        1,
        ...testSubjects.map((subject) => prev[subject]?.length || 0),
      );
      if (currentLength >= MAX_RESULTS) return prev;

      const next = { ...prev };
      for (const subject of testSubjects) {
        const current = prev[subject] || [];
        const normalized = Array.from(
          { length: currentLength },
          (_, index) => current[index] || "",
        );
        next[subject] = [...normalized, ""];
      }
      return next;
    });
  }

  function removeLatestScoreRound() {
    setScores((prev) => {
      const currentLength = Math.max(
        1,
        ...testSubjects.map((subject) => prev[subject]?.length || 0),
      );
      if (currentLength <= 1) return prev;

      const next = { ...prev };
      for (const subject of testSubjects) {
        const current = prev[subject] || [];
        const normalized = Array.from(
          { length: currentLength },
          (_, index) => current[index] || "",
        );
        next[subject] = normalized.slice(0, currentLength - 1);
      }
      return next;
    });
  }

  function normalizedScoreValues(subject: string): number[] {
    return scoreValues(subject)
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => Number(value));
  }

  function validateStep(stepToValidate: StepId): string | null {
    if (stepToValidate === "subjects") {
      if (!isValidProfileSubjectPair(subjects)) {
        return copy.requiredSubjects;
      }
      return null;
    }

    if (stepToValidate === "results") {
      if (attemptCount < 1 || attemptCount > MAX_RESULTS) {
        return copy.requiredScore;
      }
      for (const subject of testSubjects) {
        const rawValues = scoreValues(subject);
        const maxScore = getSubjectMaxScore(subject);
        const values = rawValues.map((value) => Number(value));
        if (
          rawValues.some((value) => !value.trim()) ||
          values.length !== attemptCount ||
          values.some((value) => Number.isNaN(value))
        ) {
          return copy.requiredScore;
        }
        if (values.some((value) => value < 0 || value > maxScore)) {
          return `${copy.scoreRange} ${subjectLabel(subject, lang)}: 0-${maxScore}.`;
        }
      }
      return null;
    }

    if (stepToValidate === "goal") {
      if (!targetUniversityId) {
        return copy.requiredUniversity;
      }
      if (!selectedSubjects.has(weakestSubject)) {
        return copy.requiredWeakest;
      }
      // s26 phase 7: hard-require both new fields here so the user
      // can't advance past `goal` without them. Empty string (default)
      // / unloaded catalog still trips this branch.
      if (!targetMajor) {
        return copy.requiredMajor;
      }
      if (competitionQuota !== "GENERAL" && competitionQuota !== "RURAL") {
        return copy.requiredQuota;
      }
      return null;
    }

    return (
      validateStep("subjects") ||
      validateStep("results") ||
      validateStep("goal")
    );
  }

  function buildPayload() {
    const validationError = validateStep("review");
    if (validationError) {
      throw new Error(validationError);
    }

    const lastTestResults: Record<string, number[]> = {};
    for (const subject of testSubjects) {
      lastTestResults[subject] = normalizedScoreValues(subject);
    }

    return {
      chosen_subjects: subjects,
      target_university_id: Number(targetUniversityId),
      weakest_subject: weakestSubject,
      last_test_results: lastTestResults,
      language_preference: lang === "kz" ? "KZ" : "RU",
      // s26 phase 7: persist target major (single-element array — the
      // backend column is String[]) and competition quota so the chat
      // agent can answer "what are my chances?" on a minimal prompt.
      target_majors: targetMajor ? [targetMajor] : [],
      competition_quota: competitionQuota || null,
    };
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const stepError = validateStep(step);
    if (stepError) {
      setError(stepError);
      return;
    }

    if (!isFinalStep) {
      const next = steps[currentIndex + 1];
      if (next) setStep(next.id);
      return;
    }

    setSaving(true);
    let completed = false;
    try {
      const updatedUser = await apiPut<AuthUser>("/users/me", buildPayload());
      completed = true;
      flushSync(() => {
        setUserFromServer(updatedUser);
      });
      await refreshUser();
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.requiredScore);
    } finally {
      if (!completed) {
        setSaving(false);
      }
    }
  }

  function goBack() {
    setError(null);
    if (currentIndex > 0) {
      const prev = steps[currentIndex - 1];
      if (prev) setStep(prev.id);
    }
  }

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      {saving && isFinalStep && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-50/92 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white px-5 py-5 text-center">
            <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-700 ring-1 ring-amber-200">
              <Sparkles size={19} />
            </div>
            <p
              className="text-zinc-950"
              style={{ fontSize: 16, fontWeight: 780 }}
            >
              {copy.handoffTitle}
            </p>
            <p
              className="mx-auto mt-2 max-w-xs text-zinc-500"
              style={{ fontSize: 13, lineHeight: 1.55 }}
            >
              {copy.handoffHint}
            </p>
            <div className="mx-auto mt-4 h-1.5 w-44 overflow-hidden rounded-full bg-zinc-100">
              <div className="h-full w-1/2 rounded-full bg-amber-500 animate-[samga-progress_1.1s_ease-in-out_infinite]" />
            </div>
          </div>
        </div>
      )}
      <header className="border-b border-zinc-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo size="sm" asLink={false} />
          <div className="flex min-w-0 items-center gap-2">
            <div className="hidden min-w-0 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-right sm:block">
              <p
                className="truncate text-zinc-900"
                style={{ fontSize: 13, fontWeight: 600 }}
              >
                {/* F-20: <bdi> isolates mixed-direction names. */}
                <bdi>{user?.name || copy.account}</bdi>
              </p>
              <p className="truncate text-zinc-500" style={{ fontSize: 12 }}>
                {user?.email}
              </p>
            </div>
            <div className="flex items-center rounded-lg border border-zinc-200 bg-white p-0.5">
              <Languages size={14} className="ml-1.5 text-zinc-500" />
              <button
                type="button"
                onClick={() => setLang("ru")}
                className={`rounded-lg px-2 py-1 ${lang === "ru" ? "bg-zinc-100 text-zinc-900" : "text-zinc-500 hover:text-zinc-900"}`}
                style={{ fontSize: 11, fontWeight: 700 }}
              >
                RU
              </button>
              <button
                type="button"
                onClick={() => setLang("kz")}
                className={`rounded-lg px-2 py-1 ${lang === "kz" ? "bg-zinc-100 text-zinc-900" : "text-zinc-500 hover:text-zinc-900"}`}
                style={{ fontSize: 11, fontWeight: 700 }}
              >
                KZ
              </button>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"
              aria-label={copy.signOut}
              title={copy.signOut}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:py-8">
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
            <p
              className="text-amber-700"
              style={{ fontSize: 12, fontWeight: 700 }}
            >
              {copy.pageTitle}
            </p>
            <h1
              className="mt-2 text-zinc-950"
              style={{ fontSize: 28, fontWeight: 750 }}
            >
              {copy.title}
            </h1>
            <p
              className="mt-3 max-w-sm text-zinc-600"
              style={{ fontSize: 14, lineHeight: 1.6 }}
            >
              {copy.subtitle}
            </p>
            <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-zinc-100">
              <div
                className="h-full rounded-full bg-zinc-950 transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="mt-5 grid grid-cols-1 gap-2">
              <OnboardingMeta
                label={copy.subjectCounter}
                value={selectedPairLabel}
              />
              <OnboardingMeta
                label={copy.latestScores}
                value={`${filledResultCount} / ${totalResultSlots}`}
              />
              <OnboardingMeta
                label={copy.weakest}
                value={weakestSubjectLabel}
              />
              <OnboardingMeta
                label={copy.dreamUniversity}
                value={selectedUniversity?.label || copy.selectUniversity}
              />
            </div>
          </div>

          <nav
            className="rounded-2xl border border-zinc-200 bg-white p-3"
            aria-label={copy.pageTitle}
          >
            {steps.map((item, index) => {
              const Icon = item.icon;
              const isActive = item.id === step;
              const isDone = index < currentIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={index > currentIndex}
                  onClick={() => {
                    setError(null);
                    setStep(item.id);
                  }}
                  aria-current={isActive ? "step" : undefined}
                  className={`mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors ${
                    isActive
                      ? "bg-zinc-100 text-zinc-950 ring-1 ring-zinc-200"
                      : isDone
                        ? "text-zinc-800 hover:bg-zinc-50"
                        : "text-zinc-500"
                  }`}
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                      isDone
                        ? "bg-emerald-50 text-emerald-700"
                        : isActive
                          ? "bg-amber-50 text-amber-700"
                          : "bg-zinc-100 text-zinc-500"
                    }`}
                  >
                    {isDone ? <Check size={15} /> : <Icon size={15} />}
                  </span>
                  <span className="min-w-0">
                    <span
                      className="block truncate"
                      style={{ fontSize: 13, fontWeight: 700 }}
                    >
                      {item.title}
                    </span>
                    <span
                      className={`block truncate ${isActive ? "text-zinc-700" : isDone ? "text-zinc-600" : "text-zinc-500"}`}
                      style={{ fontSize: 12 }}
                    >
                      {item.hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="overflow-hidden rounded-2xl border border-zinc-200 bg-white"
        >
          <div className="border-b border-zinc-200/80 px-5 py-5 sm:px-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p
                  className="text-zinc-500"
                  style={{ fontSize: 12, fontWeight: 700 }}
                >
                  {copy.stepLabel} {currentIndex + 1} / {steps.length}
                </p>
                <h2
                  className="mt-1 text-zinc-950"
                  style={{ fontSize: 22, fontWeight: 750 }}
                >
                  {activeStep.title}
                </h2>
                <p
                  className="mt-1 text-zinc-500"
                  style={{ fontSize: 13, lineHeight: 1.6 }}
                >
                  {activeStep.hint}
                </p>
              </div>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-amber-200/80 bg-amber-50/80 text-amber-700">
                <ActiveStepIcon size={19} />
              </span>
            </div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-zinc-100">
              <div
                className="h-full rounded-full bg-zinc-950 transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          <div className="min-h-[460px] px-5 py-6 sm:px-7">
            {error && (
              // v4.13 (2026-05-06): the step-level error banner now
              // carries role="alert" so screen readers announce it
              // when validateStep() refuses to advance. Previously the
              // banner appeared silently — a sighted user saw red
              // copy, a screen-reader user got nothing. `aria-live`
              // isn't set explicitly because role="alert" implies
              // assertive live-region semantics.
              <div
                role="alert"
                className="mb-5 flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-3.5 text-red-700"
              >
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <p style={{ fontSize: 13 }}>{error}</p>
              </div>
            )}

            {step === "subjects" && (
              <SubjectCombinationPicker
                value={subjects}
                onChange={selectSubjectPair}
                lang={lang}
              />
            )}

            {step === "results" && (
              <div>
                <div className="mb-5 flex flex-col gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3
                      className="text-zinc-950"
                      style={{ fontSize: 16, fontWeight: 750 }}
                    >
                      {copy.resultsTitle}
                    </h3>
                    <p
                      className="mt-1 max-w-2xl text-zinc-500"
                      style={{ fontSize: 13, lineHeight: 1.6 }}
                    >
                      {copy.resultsSubtitle}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={addScoreRound}
                      disabled={attemptCount >= MAX_RESULTS}
                      className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
                      style={{ fontSize: 12, fontWeight: 720 }}
                    >
                      <Plus size={14} />
                      {copy.addResult}
                    </button>
                    <button
                      type="button"
                      onClick={removeLatestScoreRound}
                      disabled={attemptCount <= 1}
                      className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 text-zinc-500 transition-colors hover:border-red-200 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                      style={{ fontSize: 12, fontWeight: 720 }}
                    >
                      <Trash2 size={14} />
                      {copy.removeResult}
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  {testSubjects.map((subject) => (
                    <ScoreSubjectCard
                      key={subject}
                      subject={subject}
                      lang={lang}
                      values={scoreValues(subject)}
                      maxScore={getSubjectMaxScore(subject)}
                      copy={copy}
                      onChange={updateScore}
                      normalizedScores={normalizedScoreValues(subject)}
                      flags={scoreFlags}
                    />
                  ))}
                </div>
              </div>
            )}

            {step === "goal" && (
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <UniversityPicker
                  value={targetUniversityId}
                  universities={universities}
                  loading={loadingUniversities}
                  copy={copy}
                  onChange={setTargetUniversityId}
                />

                <div>
                  <span
                    className="mb-1.5 block text-zinc-600"
                    style={{ fontSize: 12, fontWeight: 700 }}
                  >
                    {copy.weakest}
                  </span>
                  <p
                    className="mb-3 text-zinc-500"
                    style={{ fontSize: 12, lineHeight: 1.5 }}
                  >
                    {copy.weakestHint}
                  </p>
                  <div
                    className="grid grid-cols-1 gap-3"
                    role="radiogroup"
                    aria-label={copy.weakest}
                  >
                    {subjects.map((subject) => (
                      <button
                        key={subject}
                        type="button"
                        role="radio"
                        aria-checked={weakestSubject === subject}
                        onClick={() => setWeakestSubject(subject)}
                        className={`min-h-24 rounded-lg border p-4 text-left transition-colors ${
                          weakestSubject === subject
                            ? "border-amber-300 bg-amber-50/80 text-zinc-950 ring-2 ring-amber-100"
                            : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
                        }`}
                      >
                        <span className="flex items-start justify-between gap-3">
                          <span>
                            <span
                              className="block text-zinc-950"
                              style={{ fontSize: 15, fontWeight: 780 }}
                            >
                              {subjectLabel(subject, lang)}
                            </span>
                            <span
                              className="mt-2 flex items-center gap-2 text-zinc-500"
                              style={{ fontSize: 12 }}
                            >
                              <Target size={13} />
                              {lang === "kz"
                                ? "Жеке жаттығу басымдығы"
                                : "Приоритет персональной практики"}
                            </span>
                          </span>
                          <span
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                              weakestSubject === subject
                                ? "bg-amber-500 text-white"
                                : "bg-zinc-100 text-zinc-500"
                            }`}
                          >
                            {weakestSubject === subject ? (
                              <Check size={16} />
                            ) : (
                              <CircleDot size={15} />
                            )}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* s26 phase 7: target major picker — populated lazily
                    from /data/universities/{id}.majors so it always
                    reflects what the chosen uni actually accepts. */}
                <div className="md:col-span-2">
                  <span
                    className="mb-1.5 block text-zinc-600"
                    style={{ fontSize: 12, fontWeight: 700 }}
                  >
                    {copy.major}
                  </span>
                  <p
                    className="mb-3 text-zinc-500"
                    style={{ fontSize: 12, lineHeight: 1.5 }}
                  >
                    {copy.majorHint}
                  </p>
                  <select
                    value={targetMajor}
                    onChange={(e) => setTargetMajor(e.target.value)}
                    disabled={!targetUniversityId || loadingMajors}
                    className="block h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-zinc-800 outline-none transition-colors hover:border-zinc-300 focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400"
                    style={{ fontSize: 14 }}
                    aria-label={copy.major}
                  >
                    <option value="">
                      {!targetUniversityId
                        ? copy.majorPlaceholder
                        : loadingMajors
                          ? copy.majorLoading
                          : universityMajors.length === 0
                            ? copy.majorEmpty
                            : copy.majorPlaceholder}
                    </option>
                    {universityMajors.map((m) => (
                      <option key={m.code} value={m.code}>
                        {m.code} — {m.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* s26 phase 7: competition quota radios — two cards
                    (GENERAL/RURAL). ORPHAN is skipped because the
                    historical_grant_thresholds table never carries
                    that value, so the chance tool would have nothing
                    to compute against. */}
                <div className="md:col-span-2">
                  <span
                    className="mb-1.5 block text-zinc-600"
                    style={{ fontSize: 12, fontWeight: 700 }}
                  >
                    {copy.quota}
                  </span>
                  <p
                    className="mb-3 text-zinc-500"
                    style={{ fontSize: 12, lineHeight: 1.5 }}
                  >
                    {copy.quotaHint}
                  </p>
                  <div
                    className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                    role="radiogroup"
                    aria-label={copy.quota}
                  >
                    {[
                      {
                        id: "GENERAL",
                        title: copy.quotaGeneral,
                        desc: copy.quotaGeneralDesc,
                      },
                      {
                        id: "RURAL",
                        title: copy.quotaRural,
                        desc: copy.quotaRuralDesc,
                      },
                    ].map((q) => {
                      const active = competitionQuota === q.id;
                      return (
                        <button
                          key={q.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => setCompetitionQuota(q.id)}
                          className={`min-h-20 rounded-lg border p-4 text-left transition-colors ${
                            active
                              ? "border-emerald-300 bg-emerald-50/80 text-zinc-950 ring-2 ring-emerald-100"
                              : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
                          }`}
                        >
                          <span className="flex items-start justify-between gap-3">
                            <span>
                              <span
                                className="block text-zinc-950"
                                style={{ fontSize: 14, fontWeight: 780 }}
                              >
                                {q.title}
                              </span>
                              <span
                                className="mt-1.5 block text-zinc-500"
                                style={{ fontSize: 12, lineHeight: 1.5 }}
                              >
                                {q.desc}
                              </span>
                            </span>
                            <span
                              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                                active
                                  ? "bg-emerald-500 text-white"
                                  : "bg-zinc-100 text-zinc-500"
                              }`}
                            >
                              {active ? (
                                <Check size={14} />
                              ) : (
                                <CircleDot size={13} />
                              )}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {step === "review" && (
              <div className="space-y-4">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/90 px-4 py-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                      <Sparkles size={18} />
                    </span>
                    <div>
                      <p
                        className="text-emerald-950"
                        style={{ fontSize: 17, fontWeight: 780 }}
                      >
                        {copy.reviewTitle}
                      </p>
                      <p
                        className="mt-1 max-w-2xl text-emerald-800/80"
                        style={{ fontSize: 13, lineHeight: 1.55 }}
                      >
                        {copy.reviewSubtitle}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <ReviewCard
                    icon={BookOpen}
                    label={copy.profileSubjects}
                    value={subjects
                      .map((subject) => subjectLabel(subject, lang))
                      .join(" + ")}
                  />
                  <ReviewCard
                    icon={GraduationCap}
                    label={copy.dreamUniversity}
                    value={selectedUniversity?.label || copy.selectUniversity}
                  />
                  <ReviewCard
                    icon={Target}
                    label={copy.weakest}
                    value={subjectLabel(weakestSubject, lang)}
                  />
                  <ReviewCard
                    icon={ClipboardCheck}
                    label={copy.latestScores}
                    value={testSubjects
                      .map(
                        (subject) =>
                          `${subjectLabel(subject, lang)}: ${normalizedScoreValues(subject).join(", ")}`,
                      )
                      .join("  |  ")}
                  />
                  {/* s26 phase 7: surface the two new fields on review.
                       Major shows code + name when found in the loaded
                       catalog; quota goes through the lang-aware copy
                       so RU/KZ both read naturally. */}
                  <ReviewCard
                    icon={GraduationCap}
                    label={copy.major}
                    value={
                      universityMajors.find((m) => m.code === targetMajor)
                        ? `${targetMajor} — ${
                            universityMajors.find((m) => m.code === targetMajor)
                              ?.name
                          }`
                        : targetMajor || copy.majorPlaceholder
                    }
                  />
                  <ReviewCard
                    icon={Target}
                    label={copy.quota}
                    value={
                      competitionQuota === "GENERAL"
                        ? copy.quotaGeneral
                        : competitionQuota === "RURAL"
                          ? copy.quotaRural
                          : copy.requiredQuota
                    }
                  />
                </div>

                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3.5">
                  <p
                    className="text-zinc-500"
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      textTransform: "uppercase",
                    }}
                  >
                    {copy.samgaWillUse}
                  </p>
                  <p
                    className="mt-1 text-zinc-700"
                    style={{ fontSize: 13, lineHeight: 1.55 }}
                  >
                    {lang === "kz"
                      ? "Чаттағы жылдам сұраулар, әлсіз пән жаттығулары және ЖОО ұсыныстары осы профильге бейімделеді."
                      : "Быстрые запросы в чате, тренировки слабого предмета и рекомендации вузов будут адаптированы под этот профиль."}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col-reverse justify-between gap-3 border-t border-zinc-200/80 px-5 py-4 sm:flex-row sm:px-7">
            <button
              type="button"
              onClick={goBack}
              disabled={currentIndex === 0 || saving}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
              style={{ fontSize: 13, fontWeight: 700 }}
            >
              <ChevronLeft size={16} />
              {copy.back}
            </button>
            <button
              type="submit"
              disabled={saving || hasOverMaxScore}
              aria-disabled={saving || hasOverMaxScore || undefined}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-zinc-950 px-4 text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
              style={{ fontSize: 13, fontWeight: 750 }}
            >
              {isFinalStep ? (
                <>
                  <Check size={16} />
                  {saving ? copy.saving : copy.save}
                </>
              ) : (
                <>
                  {copy.next}
                  <ChevronRight size={16} />
                </>
              )}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}

function ScoreSubjectCard({
  subject,
  lang,
  values,
  maxScore,
  copy,
  onChange,
  normalizedScores,
  flags,
}: {
  subject: string;
  lang: "ru" | "kz";
  values: string[];
  maxScore: number;
  copy: Record<string, string>;
  onChange: (subject: string, index: number, value: string) => void;
  normalizedScores: number[];
  flags: Record<string, { stripped: boolean; overMax: boolean }>;
}) {
  // v3.63 (2026-05-02): the bug-report's B3 was that entering 999 for a
  // 20-point subject ended up rendering "999/20" in the per-subject
  // Average/Best cards AND counting the entry toward "1 / 1 результ."
  // The flag system already marks the input as overMax in red, but the
  // summary widgets need to ignore values outside [0, maxScore] too.
  // We filter HERE rather than in normalizedScoreValues() because the
  // submit-validation lane wants to *see* the bad values to refuse the
  // step. Keeping the filtering local to the card preserves that.
  const validScores = normalizedScores.filter(
    (value) => Number.isFinite(value) && value >= 0 && value <= maxScore,
  );
  const best = validScores.length ? Math.max(...validScores) : null;
  const average = validScores.length
    ? Math.round(
        validScores.reduce((sum, value) => sum + value, 0) / validScores.length,
      )
    : null;
  const completion = Math.min((validScores.length / values.length) * 100, 100);

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p
            className="text-zinc-950"
            style={{ fontSize: 16, fontWeight: 780 }}
          >
            {subjectLabel(subject, lang)}
          </p>
          <p className="mt-1 text-zinc-500" style={{ fontSize: 12 }}>
            {/* v3.63: count only valid scores. Pre-fix, "1 / 1 результ."
                included a 999 the user typed for a 20-point subject.
                v3.72 (B14, 2026-05-02): the clipped "результ." abbrev
                is replaced with full pluralized "результат /
                результата / результатов" via the pure helper. The
                duplicated "Максимум: N" tail is dropped (B19) — the
                chip on the right of this same row already shows it. */}
            {onboardingScoreCountLabel(validScores.length, values.length, lang)}
          </p>
        </div>
        <span className="inline-flex h-8 items-center rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-zinc-600">
          <span style={{ fontSize: 11, fontWeight: 760 }}>
            {copy.maxScore}: {maxScore}
          </span>
        </span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2">
        <MetricPill
          label={copy.average ?? ""}
          value={average == null ? "-" : `${average}/${maxScore}`}
        />
        <MetricPill
          label={copy.best ?? ""}
          value={best == null ? "-" : `${best}/${maxScore}`}
        />
      </div>

      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-zinc-100">
        <div
          className="h-full rounded-full bg-amber-500 transition-all"
          style={{ width: `${completion}%` }}
        />
      </div>

      <div className="space-y-2">
        {values.map((value, index) => {
          const flagKey = `${subject}:${index}`;
          const flag = flags[flagKey];
          const overMax = !!flag?.overMax;
          const stripped = !!flag?.stripped;
          const helperId = `score-helper-${subject}-${index}`;
          return (
            <div key={`${subject}-${index}`} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-50 text-zinc-600 ring-1 ring-zinc-200"
                  style={{ fontSize: 12, fontWeight: 760 }}
                >
                  {index + 1}
                </span>
                <input
                  value={value}
                  onChange={(event) =>
                    onChange(subject, index, event.target.value)
                  }
                  inputMode="numeric"
                  min={0}
                  max={maxScore}
                  placeholder={`${copy.score} ${index + 1}`}
                  aria-label={`${subjectLabel(subject, lang)} ${copy.score} ${index + 1}`}
                  aria-invalid={overMax || undefined}
                  aria-describedby={overMax || stripped ? helperId : undefined}
                  className={`h-10 min-w-0 flex-1 rounded-xl border bg-white px-3 text-zinc-900 outline-none focus:ring-2 ${
                    overMax
                      ? "border-red-300 focus:border-red-400 focus:ring-red-100"
                      : "border-zinc-200 focus:border-zinc-400 focus:ring-zinc-100"
                  }`}
                  style={{ fontSize: 14 }}
                />
              </div>
              {(overMax || stripped) && (
                // v4.13 (2026-05-06): overMax is a hard error (red),
                // so it gets role="alert" to be announced assertively
                // when the user types 999 into a 20-point field. The
                // `stripped` branch is informational (amber: "only
                // digits allowed") — plain <p>, no announcement,
                // because the character was already silently dropped
                // and the user's expected next keystroke isn't
                // blocking.
                <p
                  id={helperId}
                  role={overMax ? "alert" : undefined}
                  className={overMax ? "text-red-600" : "text-amber-700"}
                  style={{ fontSize: 11, fontWeight: 600 }}
                >
                  {overMax
                    ? `${copy.scoreOverMax} ${maxScore}`
                    : copy.scoreOnlyDigits}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5">
      <p
        className="text-zinc-600"
        style={{ fontSize: 10, fontWeight: 760, textTransform: "uppercase" }}
      >
        {label}
      </p>
      <p
        className="mt-0.5 text-zinc-900"
        style={{ fontSize: 18, fontWeight: 780 }}
      >
        {value}
      </p>
    </div>
  );
}

function UniversityPicker({
  value,
  universities,
  loading,
  copy,
  onChange,
}: {
  value: string;
  universities: UniversityOption[];
  loading: boolean;
  copy: Record<string, string>;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const selectedUniversity = universities.find(
    (item) => String(item.id) === value,
  );
  // s26 phase 5: route through `matchUniversityLabel` so Latin queries
  // (KBTU, NU, KIMEP, SDU, "kazakh national...") match the Cyrillic
  // labels coming back from the API.
  const filtered = universities
    .filter((university) => matchUniversityLabel(university.label, query))
    .slice(0, 8);

  return (
    <section>
      <span
        className="mb-1.5 block text-zinc-600"
        style={{ fontSize: 12, fontWeight: 700 }}
      >
        {copy.dreamUniversity}
      </span>
      <div className="rounded-xl border border-zinc-200 bg-white p-3">
        <label className="relative block">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            disabled={loading}
            placeholder={
              loading ? copy.loadingUniversities : copy.searchUniversity
            }
            className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-3 text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100 disabled:bg-zinc-50 disabled:text-zinc-500"
            style={{ fontSize: 13 }}
          />
        </label>

        {selectedUniversity && (
          <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/80 px-3 py-2.5">
            <p
              className="text-amber-900"
              style={{ fontSize: 13, fontWeight: 760 }}
            >
              {selectedUniversity.label}
            </p>
          </div>
        )}

        <div className="mt-3 max-h-72 space-y-1 overflow-y-auto pr-1">
          {filtered.map((university) => {
            const selected = String(university.id) === value;
            return (
              <button
                key={university.id}
                type="button"
                onClick={() => onChange(String(university.id))}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                  selected
                    ? "bg-zinc-900 text-white"
                    : "bg-white text-zinc-700 hover:bg-zinc-50"
                }`}
                style={{ fontSize: 13, fontWeight: 680 }}
              >
                <span className="min-w-0 truncate">{university.label}</span>
                {selected && <Check size={15} className="shrink-0" />}
              </button>
            );
          })}
          {!loading && filtered.length === 0 && (
            <p
              className="rounded-xl bg-zinc-50 px-3 py-3 text-center text-zinc-500"
              style={{ fontSize: 13 }}
            >
              {copy.noUniversity}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function ReviewCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2 text-zinc-500">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700">
          <Icon size={15} />
        </span>
        <span style={{ fontSize: 12, fontWeight: 760 }}>{label}</span>
      </div>
      <p
        className="text-zinc-950"
        style={{ fontSize: 14, fontWeight: 720, lineHeight: 1.5 }}
      >
        {value || "-"}
      </p>
    </div>
  );
}

function OnboardingMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 py-3">
      <p
        className="text-zinc-600"
        style={{ fontSize: 10, fontWeight: 760, textTransform: "uppercase" }}
      >
        {label}
      </p>
      <p
        className="mt-1 text-zinc-900"
        style={{ fontSize: 13, fontWeight: 720, lineHeight: 1.45 }}
      >
        {value}
      </p>
    </div>
  );
}

function initialScores(
  user: AuthUser | null,
  subjects: string[],
): ScoresBySubject {
  const stored = user?.last_test_results || {};
  return getRequiredUntSubjects(subjects).reduce<ScoresBySubject>(
    (acc, subject) => {
      const existing = stored[subject];
      acc[subject] = existing?.length
        ? existing.slice(0, MAX_RESULTS).map(String)
        : [""];
      return acc;
    },
    {},
  );
}
