import {
  Check,
  Languages,
  Mail,
  Radar,
  Sparkles,
  Target,
  User,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { useLang } from "../LanguageContext";
import { useAuth } from "../auth/AuthContext";
import { apiGet, apiPut } from "../../lib/api";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import {
  getDefaultProfileSubjects,
  getProfileSubjectPair,
  getRequiredUntSubjects,
  getSubjectMaxScore,
  isValidProfileSubjectPair,
  subjectLabel,
  subjectPairLabel,
} from "../../lib/subjectLabels";
import { SubjectCombinationPicker } from "./SubjectCombinationPicker";

interface UniversityOption {
  id: number;
  label: string;
  value: string;
}

const LANGUAGE_OPTIONS = [
  { value: "RU", label: { ru: "Русский", kz: "Орыс тілі" } },
  { value: "KZ", label: { ru: "Казахский", kz: "Қазақ тілі" } },
  { value: "EN", label: { ru: "Английский", kz: "Ағылшын тілі" } },
] as const;

const DEFAULT_PROFILE_SUBJECTS = getDefaultProfileSubjects();

export function ProfilePage() {
  // v4.14 (2026-05-06): also pull setLang so a successful profile save
  // can reconcile the #profile-language dropdown with the running
  // LanguageContext (see handleSave). Previously, saving "KZ" here
  // updated backend + local state but left the UI in RU until the
  // user clicked the header RU/KZ toggle, because LanguageProvider
  // only reads from `samga_lang` in localStorage and the header
  // toggle is the only writer.
  const { lang, setLang, t } = useLang();
  useDocumentTitle(t("dash.nav.profile"));
  const { user, refreshUser } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [universities, setUniversities] = useState<UniversityOption[]>([]);
  const [targetUniId, setTargetUniId] = useState("");
  const [elective1, setElective1] = useState(DEFAULT_PROFILE_SUBJECTS[0]);
  const [elective2, setElective2] = useState(DEFAULT_PROFILE_SUBJECTS[1]);
  const [languagePreference, setLanguagePreference] = useState<
    "KZ" | "RU" | "EN"
  >(localStorage.getItem("samga_lang") === "kz" ? "KZ" : "RU");
  const [targetMajors, setTargetMajors] = useState("");
  const [targetUniversities, setTargetUniversities] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) {
      return;
    }

    setName(user.name || "");
    setEmail(user.email || "");
    setTargetUniId(
      user.target_university_id ? String(user.target_university_id) : "",
    );

    const chosenPair = getProfileSubjectPair(user.chosen_subjects || []);
    if (chosenPair) {
      setElective1(chosenPair.subjects[0]);
      setElective2(chosenPair.subjects[1]);
    }

    const userAny = user as any;
    if (userAny.language_preference) {
      setLanguagePreference(userAny.language_preference);
    }
    if (userAny.target_majors) {
      setTargetMajors(userAny.target_majors.join(", "));
    }
    if (userAny.target_universities) {
      setTargetUniversities(userAny.target_universities.join(", "));
    }
  }, [user]);

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiGet<UniversityOption[]>("/data/universities");
        setUniversities(data || []);
      } catch {
        setUniversities([]);
      }
    })();
  }, []);

  const normalizedSubjects = useMemo(() => {
    const pair = getProfileSubjectPair([elective1, elective2]);
    return pair ? [...pair.subjects] : [];
  }, [elective1, elective2]);

  const pair = useMemo(
    () => getProfileSubjectPair(normalizedSubjects),
    [normalizedSubjects],
  );

  const requiredSubjects = useMemo(
    () => getRequiredUntSubjects(normalizedSubjects),
    [normalizedSubjects],
  );

  const scoreTracks = useMemo(() => {
    const stored = user?.last_test_results || {};
    return requiredSubjects.map((subject) => {
      const scores = Array.isArray(stored[subject])
        ? stored[subject].filter((value): value is number =>
            Number.isFinite(value),
          )
        : [];

      return {
        subject,
        label: subjectLabel(subject, lang),
        scores,
        latest: scores[scores.length - 1],
        max: getSubjectMaxScore(subject),
      };
    });
  }, [lang, requiredSubjects, user?.last_test_results]);

  const coverageCount = scoreTracks.filter(
    (track) => track.scores.length > 0,
  ).length;
  const totalStoredResults = scoreTracks.reduce(
    (sum, track) => sum + track.scores.length,
    0,
  );
  const selectedLanguageLabel =
    LANGUAGE_OPTIONS.find((option) => option.value === languagePreference)
      ?.label[lang] || "—";
  const targetUniversityName =
    universities.find((item) => String(item.id) === targetUniId)?.label ||
    (lang === "kz" ? "Көрсетілмеген" : "Не указан");
  const weakestLabel = user?.weakest_subject
    ? subjectLabel(user.weakest_subject, lang)
    : lang === "kz"
      ? "Көрсетілмеген"
      : "Не указан";
  const additionalTargetsCount = targetUniversities
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean).length;

  function selectSubjectPair(pairSubjects: readonly string[]) {
    if (pairSubjects[0]) setElective1(pairSubjects[0]);
    if (pairSubjects[1]) setElective2(pairSubjects[1]);
  }

  async function handleSave() {
    setSaving(true);
    setError("");

    try {
      if (!isValidProfileSubjectPair(normalizedSubjects)) {
        throw new Error(
          lang === "kz"
            ? "Қолжетімді бейіндік пән жұбын таңдаңыз."
            : "Выберите доступную пару профильных предметов.",
        );
      }

      const majorsArray = targetMajors
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const universitiesArray = targetUniversities
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .map(Number)
        .filter((id) => Number.isFinite(id));

      await apiPut("/users/me", {
        name,
        target_university_id: targetUniId ? Number(targetUniId) : null,
        chosen_subjects: normalizedSubjects,
        language_preference: languagePreference,
        target_majors: majorsArray.length > 0 ? majorsArray : undefined,
        target_universities:
          universitiesArray.length > 0 ? universitiesArray : undefined,
      });

      // v4.14 (2026-05-06): reconcile the LanguageContext with the
      // just-saved language_preference. LanguageProvider only
      // interprets `ru` | `kz` (EN is a future-stage backend value),
      // and the header toggle was the only path that called setLang()
      // / wrote samga_lang in localStorage. Without this dispatch,
      // saving "KZ" on the profile returned success, persisted the
      // field in the DB, but left the running UI in Russian until
      // the next page load or header click. For EN we don't flip the
      // runtime UI — there's no EN locale — but the preference is
      // still persisted for any future translator handoff.
      if (languagePreference === "KZ" && lang !== "kz") {
        setLang("kz");
      } else if (languagePreference === "RU" && lang !== "ru") {
        setLang("ru");
      }

      await refreshUser();
      setSaved(true);
      // F-21: companion toast on top of the inline live-region badge so
      // the success is announced + visible even after the badge fades.
      toast.success(t("profile.saveToast"));
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error.desc"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-2xl border border-zinc-200 bg-white px-5 py-5 sm:px-6">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <HeroPill icon={Sparkles}>Samga Profile</HeroPill>
            <HeroPill icon={Languages}>{selectedLanguageLabel}</HeroPill>
            {pair ? (
              <HeroPill icon={Radar}>
                {lang === "kz" ? pair.kz : pair.ru}
              </HeroPill>
            ) : null}
          </div>

          <h1
            className="text-[24px] text-zinc-950 sm:text-[30px]"
            style={{ fontWeight: 760, lineHeight: 1.08 }}
          >
            {lang === "kz"
              ? "Профильді Samga логикасымен теңшеу."
              : "Профиль, на котором строится Samga."}
          </h1>
          <p
            className="mt-3 max-w-2xl text-[13px] text-zinc-600 sm:text-[14px]"
            style={{ lineHeight: 1.7 }}
          >
            {lang === "kz"
              ? "Чат, жаттығу, талдау және ұсыныстар осы контекстке сүйенеді. Мұнда жұпты, бағытты және мақсатты ЖОО-ны ұстап тұрыңыз."
              : "Чат, практика, аналитика и рекомендации завязаны на этот контекст. Здесь держится профильная пара, направление и целевой вуз."}
          </p>

          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            <HeroStat
              label={lang === "kz" ? "Бейіндік жұп" : "Профильная пара"}
              value={
                normalizedSubjects.length === 2
                  ? subjectPairLabel(normalizedSubjects, lang)
                  : lang === "kz"
                    ? "Таңдалмаған"
                    : "Не выбрана"
              }
            />
            <HeroStat
              label={lang === "kz" ? "Әлсіз пән" : "Слабый предмет"}
              value={weakestLabel}
            />
            <HeroStat
              label={lang === "kz" ? "Нәтиже қамтылуы" : "Покрытие результатов"}
              value={`${coverageCount}/${requiredSubjects.length}`}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-700">
              <User size={24} />
            </div>
            <div className="min-w-0">
              <p
                className="text-zinc-950"
                style={{ fontSize: 17, fontWeight: 740 }}
              >
                {name || "—"}
              </p>
              <p
                className="mt-1 break-all text-zinc-500"
                style={{ fontSize: 12 }}
              >
                {email || "—"}
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <KeyValue
              icon={<Target size={14} className="text-zinc-700" />}
              label={lang === "kz" ? "Мақсатты ЖОО" : "Целевой вуз"}
              value={targetUniversityName}
            />
            <KeyValue
              icon={<Radar size={14} className="text-zinc-500" />}
              label={lang === "kz" ? "Қосымша мақсаттар" : "Доп. цели"}
              value={
                additionalTargetsCount ? String(additionalTargetsCount) : "—"
              }
            />
            <KeyValue
              icon={<Mail size={14} className="text-zinc-500" />}
              label={lang === "kz" ? "Нәтиже жазбалары" : "Записи результатов"}
              value={String(totalStoredResults)}
            />
          </div>

          <Link
            to="/dashboard/onboarding"
            className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50"
            style={{ fontSize: 13, fontWeight: 700 }}
          >
            {lang === "kz"
              ? "Тіркеу деректерін ашу"
              : "Открыть данные регистрации"}
          </Link>
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
          <p style={{ fontSize: 13, fontWeight: 600 }}>{error}</p>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title={lang === "kz" ? "Аккаунт және тіл" : "Аккаунт и язык"}
          subtitle={
            lang === "kz"
              ? "Негізгі идентификация және интерфейс тілі."
              : "Базовая идентичность и язык интерфейса."
          }
        >
          <FieldLabel htmlFor="profile-name">{t("profile.name")}</FieldLabel>
          <input
            id="profile-name"
            type="text"
            value={name}
            // F-19 (s23+): backend caps display name at 80 chars; mirror
            // that on the client so the field cannot accumulate junk
            // (e.g. accidental long pastes) and the user gets immediate
            // feedback instead of a 422 from the server.
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            className="h-12 w-full rounded-lg border border-zinc-200 bg-white px-4 text-zinc-900 outline-none transition-colors focus:border-zinc-400"
            style={{ fontSize: 14, fontWeight: 520 }}
          />

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
            <div>
              <FieldLabel htmlFor="profile-email">
                {t("profile.email")}
              </FieldLabel>
              <input
                id="profile-email"
                type="email"
                value={email}
                readOnly
                className="h-12 w-full cursor-not-allowed rounded-lg border border-zinc-200 bg-zinc-50 px-4 text-zinc-600"
                style={{ fontSize: 14, fontWeight: 520 }}
              />
            </div>
            <div>
              <FieldLabel htmlFor="profile-language">
                {t("profile.lang")}
              </FieldLabel>
              <select
                id="profile-language"
                value={languagePreference}
                onChange={(event) =>
                  setLanguagePreference(
                    event.target.value as "KZ" | "RU" | "EN",
                  )
                }
                className="h-12 w-full rounded-lg border border-zinc-200 bg-white px-4 text-zinc-900 outline-none transition-colors focus:border-zinc-400"
                style={{ fontSize: 14, fontWeight: 520 }}
              >
                {LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label[lang]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title={lang === "kz" ? "Бағыт және мақсаттар" : "Траектория и цели"}
          subtitle={
            lang === "kz"
              ? "Samga қандай ЖОО мен бағыттарға назар аударуын білсін."
              : "Пусть Samga знает, к каким вузам и направлениям вы целитесь."
          }
        >
          <div>
            <FieldLabel htmlFor="profile-target-uni">
              {t("profile.targetUni")}
            </FieldLabel>
            <select
              id="profile-target-uni"
              value={targetUniId}
              onChange={(event) => setTargetUniId(event.target.value)}
              className="h-12 w-full rounded-lg border border-zinc-200 bg-white px-4 text-zinc-900 outline-none transition-colors focus:border-zinc-400"
              style={{ fontSize: 14, fontWeight: 520 }}
            >
              <option value="">{t("profile.selectUni")}</option>
              {universities.map((university) => (
                <option key={university.id} value={university.id}>
                  {university.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <FieldLabel>
              {lang === "kz" ? "Мақсатты мамандықтар" : "Целевые специальности"}
            </FieldLabel>
            <input
              type="text"
              value={targetMajors}
              onChange={(event) => setTargetMajors(event.target.value)}
              placeholder={
                lang === "kz"
                  ? "Мысалы: Информатика, Инженерия"
                  : "Например: Информатика, Инженерия"
              }
              className="h-12 w-full rounded-lg border border-zinc-200 bg-white px-4 text-zinc-900 outline-none transition-colors focus:border-zinc-400"
              style={{ fontSize: 14, fontWeight: 520 }}
            />
          </div>

          <div>
            <FieldLabel>
              {lang === "kz"
                ? "Қосымша мақсатты ЖОО ID-лері"
                : "ID дополнительных целевых вузов"}
            </FieldLabel>
            <input
              type="text"
              value={targetUniversities}
              onChange={(event) => setTargetUniversities(event.target.value)}
              placeholder={
                lang === "kz" ? "Мысалы: 1, 5, 12" : "Например: 1, 5, 12"
              }
              className="h-12 w-full rounded-lg border border-zinc-200 bg-white px-4 text-zinc-900 outline-none transition-colors focus:border-zinc-400"
              style={{ fontSize: 14, fontWeight: 520 }}
            />
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title={lang === "kz" ? "UNT профилі" : "Профиль ЕНТ"}
        subtitle={
          lang === "kz"
            ? "Міндетті пәндер бекітілген, ал профиль жұбы тек рұқсат етілген комбинациялардан алынады."
            : "Обязательные предметы фиксированы, а профильная пара берется только из разрешенных комбинаций."
        }
      >
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <div className="flex flex-wrap gap-2">
            {requiredSubjects.map((subject) => (
              <span
                key={subject}
                className="inline-flex items-center rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-zinc-700"
                style={{ fontSize: 12, fontWeight: 650 }}
              >
                {subjectLabel(subject, lang)}
              </span>
            ))}
          </div>
        </div>

        <div>
          <FieldLabel>{t("profile.elective")} (2)</FieldLabel>
          <SubjectCombinationPicker
            value={normalizedSubjects}
            onChange={selectSubjectPair}
            lang={lang}
            compact
          />
        </div>
      </SectionCard>

      <SectionCard
        title={
          lang === "kz"
            ? "Samga көретін нәтижелер"
            : "Результаты, которые видит Samga"
        }
        subtitle={
          lang === "kz"
            ? "Бұл блок қазір чат пен аналитикаға берілетін контекстті көрсетеді."
            : "Здесь видно, какой контекст сейчас уходит в чат и аналитику."
        }
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {scoreTracks.map((track) => (
            <ScoreTrackCard
              key={track.subject}
              label={track.label}
              latest={track.latest}
              entries={track.scores.length}
              max={track.max}
              lang={lang}
            />
          ))}
        </div>
      </SectionCard>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="inline-flex h-12 items-center gap-2 rounded-lg bg-zinc-950 px-5 text-white transition-colors hover:bg-black disabled:opacity-60"
          style={{ fontSize: 14, fontWeight: 720 }}
        >
          {saved ? (
            <>
              <Check size={16} />
              {t("profile.saved")}
            </>
          ) : saving ? (
            lang === "kz" ? (
              "Сақталып жатыр..."
            ) : (
              "Сохранение..."
            )
          ) : (
            t("profile.save")
          )}
        </button>

        {/* F-21 (s23+): live-region status so screen readers + visually
            distracted users hear/see when the save actually persisted. */}
        <p
          role="status"
          aria-live="polite"
          className={`inline-flex items-center gap-2 text-emerald-700 transition-opacity ${saved ? "opacity-100" : "opacity-0"}`}
          style={{ fontSize: 13, fontWeight: 600 }}
        >
          {saved ? (
            <>
              <Check size={14} />
              {t("profile.saved")}
            </>
          ) : null}
        </p>

        <Link
          to="/dashboard/onboarding"
          className="inline-flex h-12 items-center rounded-lg border border-zinc-200 bg-white px-5 text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50"
          style={{ fontSize: 14, fontWeight: 680 }}
        >
          {lang === "kz"
            ? "Тіркеу контекстін жаңарту"
            : "Обновить контекст регистрации"}
        </Link>
      </div>
    </div>
  );
}

function HeroPill({
  icon: Icon,
  children,
}: {
  icon: typeof Sparkles;
  children: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-zinc-700"
      style={{ fontSize: 11, fontWeight: 700 }}
    >
      <Icon size={13} className="text-zinc-700" />
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
        style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.45 }}
      >
        {value}
      </p>
    </div>
  );
}

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white px-5 py-5 sm:px-6">
      <div className="mb-4">
        <h2 className="text-zinc-950" style={{ fontSize: 18, fontWeight: 740 }}>
          {title}
        </h2>
        <p
          className="mt-1 max-w-3xl text-zinc-500"
          style={{ fontSize: 13, lineHeight: 1.6 }}
        >
          {subtitle}
        </p>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function FieldLabel({
  children,
  htmlFor,
}: {
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-2 block text-zinc-600"
      style={{ fontSize: 12, fontWeight: 650 }}
    >
      {children}
    </label>
  );
}

function KeyValue({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
      <div
        className="flex items-center gap-2 text-zinc-500"
        style={{ fontSize: 11, fontWeight: 760, textTransform: "uppercase" }}
      >
        {icon}
        <span>{label}</span>
      </div>
      <p
        className="mt-2 text-zinc-900"
        style={{ fontSize: 14, fontWeight: 680, lineHeight: 1.5 }}
      >
        {value}
      </p>
    </div>
  );
}

function ScoreTrackCard({
  label,
  latest,
  entries,
  max,
  lang,
}: {
  label: string;
  latest?: number;
  entries: number;
  max: number;
  lang: "ru" | "kz";
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-4">
      <p
        className="text-zinc-500"
        style={{ fontSize: 11, fontWeight: 760, textTransform: "uppercase" }}
      >
        {label}
      </p>
      <p
        className="mt-3 text-zinc-950"
        style={{ fontSize: 22, fontWeight: 760, lineHeight: 1 }}
      >
        {latest != null ? `${latest}/${max}` : "—"}
      </p>
      <div
        className="mt-3 flex items-center justify-between text-zinc-500"
        style={{ fontSize: 12 }}
      >
        <span>
          {lang === "kz" ? "Жазба" : "Записей"}: {entries}
        </span>
        <span>
          {lang === "kz" ? "Макс." : "Макс."} {max}
        </span>
      </div>
    </div>
  );
}
