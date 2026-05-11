import {
  ArrowUpRight,
  ClipboardCheck,
  Crown,
  Dumbbell,
  History,
  Library,
  Lock,
  MessageSquareText,
  RotateCcw,
  Sparkles,
  Target,
} from "lucide-react";
import { useNavigate } from "react-router";
import { usePlan } from "../billing/PlanContext";
import { useLang } from "../LanguageContext";
import { useAuth } from "../auth/AuthContext";
import { useState, useEffect } from "react";
import { PaywallModal } from "../billing/PaywallModal";
import { Skeleton } from "../ui/skeleton";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { subjectLabel } from "../../lib/subjectLabels";
import { apiGet } from "../../lib/api";
import type { ChatThread } from "./chat/MessagesContext";
import {
  buildTeaserHref,
  formatLastActiveLabel,
  resolveTeaserTitle,
  selectMostRecentThread,
} from "./chat/continueThread";

type GatedFeature = "exams" | "mistakes" | "training" | "gap-analysis";

export function DashboardHome() {
  const { billing, isPremium, canAccess, chatModel } = usePlan();
  const { t, lang } = useLang();
  const { user } = useAuth();
  useDocumentTitle(t("dash.nav.overview"));
  const navigate = useNavigate();
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [paywallFeature, setPaywallFeature] = useState<
    GatedFeature | undefined
  >();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 300);
    return () => clearTimeout(timer);
  }, []);

  // s34 wave 8 (E6, 2026-04-28): "Continue this conversation" teaser.
  // We fetch /chat/threads once on mount (cheap, already cached
  // server-side per user) and pick the most-recently-updated row.
  // Errors swallow silently — the teaser is purely additive, so a
  // network blip just means the home page loads without it.
  const [recentTeaser, setRecentTeaser] = useState<ReturnType<
    typeof selectMostRecentThread
  > | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await apiGet<{
          threads: Array<{
            id: number;
            title: string | null;
            created_at: string;
            updated_at: string;
            message_count: number;
          }>;
        }>("/chat/threads");
        if (cancelled) return;
        const list: ChatThread[] = (resp.threads || []).map((th) => ({
          id: th.id,
          title: th.title,
          created_at: th.created_at,
          updated_at: th.updated_at,
          message_count: th.message_count,
        }));
        setRecentTeaser(selectMostRecentThread(list));
      } catch {
        if (!cancelled) setRecentTeaser(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function go(href: string, gated?: GatedFeature) {
    if (gated && !canAccess(gated)) {
      setPaywallFeature(gated);
      setPaywallOpen(true);
      return;
    }
    navigate(href);
  }

  interface QuickAction {
    labelKey: string;
    icon: typeof MessageSquareText;
    href: string;
    descKey: string;
    descSuffix?: string;
    gated?: GatedFeature;
    tone: "amber" | "sky" | "emerald" | "violet" | "rose" | "zinc";
  }

  const quickActions: QuickAction[] = [
    {
      labelKey: "home.quickChat",
      icon: MessageSquareText,
      href: "/dashboard/chat",
      descKey: "home.quickChatDesc",
      descSuffix: chatModel,
      tone: "amber",
    },
    {
      labelKey: "home.quickExam",
      icon: ClipboardCheck,
      href: "/dashboard/exams",
      gated: "exams",
      descKey: "home.quickExamDesc",
      tone: "sky",
    },
    {
      labelKey: "home.quickMistakes",
      icon: RotateCcw,
      href: "/dashboard/mistakes",
      gated: "mistakes",
      descKey: "home.quickMistakesDesc",
      tone: "emerald",
    },
    {
      labelKey: "home.quickTraining",
      icon: Dumbbell,
      href: "/dashboard/training",
      gated: "training",
      descKey: "home.quickTrainingDesc",
      tone: "violet",
    },
    {
      labelKey: "home.quickGap",
      icon: Target,
      href: "/dashboard/gap-analysis",
      gated: "gap-analysis",
      descKey: "home.quickGapDesc",
      tone: "rose",
    },
    {
      labelKey: "home.quickLibrary",
      icon: Library,
      href: "/dashboard/library",
      descKey: "home.quickLibraryDesc",
      tone: "zinc",
    },
  ];

  const { usage, limits } = billing;

  const usageRows = [
    {
      label: t("home.usage.chat"),
      used: usage.chatMessages,
      limit: limits.chatMessagesPerDay,
    },
    {
      label: t("home.usage.exams"),
      used: usage.examRuns,
      limit: limits.examRunsPerDay,
    },
    {
      label: t("home.usage.mistakes"),
      used: usage.mistakeAnalyses,
      limit: limits.mistakeAnalysesPerDay,
    },
    {
      label: t("home.usage.training"),
      used: usage.trainingCalls,
      limit: limits.trainingCallsPerDay,
    },
  ];

  const profileSubjects = (user?.chosen_subjects || [])
    .slice(0, 2)
    .map((subject) => subjectLabel(subject, lang))
    .filter(Boolean);
  const weakestSubject = user?.weakest_subject
    ? subjectLabel(user.weakest_subject, lang)
    : null;
  const trackedResultsCount = Object.values(
    user?.last_test_results || {},
  ).reduce(
    (sum, values) => sum + (Array.isArray(values) ? values.length : 0),
    0,
  );
  const usageAvailable = usageRows.filter((row) => row.limit > 0).length;
  const usageNearLimit = usageRows.filter(
    (row) => row.limit > 0 && row.used >= row.limit * 0.8,
  ).length;

  // F-20: wrap the user-supplied name in <bdi> so a name with mixed
  // RTL+LTR characters (e.g. "Айгерим محمد") doesn't reorder the
  // surrounding Russian/Kazakh greeting text.
  const userName = user?.name || (lang === "kz" ? "Студент" : "Студент");
  const studentGreeting =
    lang === "kz" ? (
      <>
        <bdi>{userName}</bdi>, Samga кеңістігі дайын.
      </>
    ) : (
      <>
        <bdi>{userName}</bdi>, рабочее пространство Samga готово.
      </>
    );
  const profileSummary =
    profileSubjects.length === 2
      ? profileSubjects.join(" + ")
      : lang === "kz"
        ? "Бейіндік пәндер көрсетілмеген"
        : "Профильные предметы не указаны";

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <Skeleton className="h-64 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <section className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="rounded-2xl border border-zinc-200 bg-white px-5 py-5 sm:px-6 lg:col-start-1 lg:row-start-1">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Pill tone="amber" icon={Sparkles}>
              Samga
            </Pill>
            <Pill tone="zinc" icon={MessageSquareText}>
              {chatModel}
            </Pill>
            <Pill
              tone={isPremium ? "amber" : "zinc"}
              icon={isPremium ? Crown : undefined}
            >
              {isPremium ? t("dash.plan.premium") : t("dash.plan.free")}
            </Pill>
          </div>

          <h1
            className="text-zinc-950 text-[24px] sm:text-[30px]"
            style={{ fontWeight: 760, lineHeight: 1.08 }}
          >
            {studentGreeting}
          </h1>
          <p
            className="mt-3 max-w-2xl text-zinc-600 text-[13px] sm:text-[14px]"
            style={{ lineHeight: 1.7 }}
          >
            {t("home.plan")}{" "}
            {lang === "kz"
              ? "Чат, жаттығу және талдау осы профильге бейімделеді."
              : "Чат, практика и разбор результатов уже завязаны на этот профиль."}
          </p>

          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            <InfoChip
              label={lang === "kz" ? "Бейіндік жұп" : "Профильная пара"}
              value={profileSummary}
            />
            <InfoChip
              label={lang === "kz" ? "Әлсіз пән" : "Слабый предмет"}
              value={
                weakestSubject ||
                (lang === "kz" ? "Көрсетілмеген" : "Не указан")
              }
            />
            <InfoChip
              label={lang === "kz" ? "Соңғы нәтижелер" : "Последние результаты"}
              value={String(trackedResultsCount)}
            />
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => go("/dashboard/chat")}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-zinc-950 px-4 text-white transition-colors hover:bg-black"
              style={{ fontSize: 13, fontWeight: 750 }}
            >
              <MessageSquareText size={16} />
              {t("home.quickChat")}
            </button>
            <button
              type="button"
              onClick={() =>
                go(
                  isPremium ? "/dashboard/training" : "/dashboard/library",
                  isPremium ? "training" : undefined,
                )
              }
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
              style={{ fontSize: 13, fontWeight: 700 }}
            >
              {isPremium ? <Dumbbell size={16} /> : <Library size={16} />}
              {isPremium ? t("home.quickTraining") : t("home.quickLibrary")}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white px-5 py-5 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p
                className="text-zinc-500"
                style={{
                  fontSize: 11,
                  fontWeight: 760,
                  textTransform: "uppercase",
                }}
              >
                {lang === "kz" ? "Бүгінгі күй" : "Сегодня"}
              </p>
              <p
                className="mt-1 text-zinc-950"
                style={{ fontSize: 22, fontWeight: 760, lineHeight: 1.1 }}
              >
                {usageAvailable}/{usageRows.length}
              </p>
              <p
                className="mt-1 text-zinc-500"
                style={{ fontSize: 13, lineHeight: 1.55 }}
              >
                {lang === "kz"
                  ? "Белсенді лимит трекері"
                  : "Активных счётчиков под контролем"}
              </p>
            </div>
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-700">
              <Sparkles size={18} />
            </span>
          </div>

          <div className="mt-5 space-y-3">
            <MiniStat
              label={
                lang === "kz" ? "Пайдалануға қолжетімді" : "Доступно сегодня"
              }
              value={`${usageAvailable}`}
              hint={lang === "kz" ? "4 трекердің ішінен" : "из 4 трекеров"}
            />
            <MiniStat
              label={lang === "kz" ? "Назар аудару керек" : "Требуют внимания"}
              value={`${usageNearLimit}`}
              hint={
                usageNearLimit > 0
                  ? lang === "kz"
                    ? "Лимитке жақын"
                    : "Близко к лимиту"
                  : lang === "kz"
                    ? "Бәрі тыныш"
                    : "Пока спокойно"
              }
            />
          </div>

          {!isPremium && (
            <div className="mt-5 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-4">
              <div className="flex items-start gap-2.5">
                <Crown size={16} className="mt-0.5 shrink-0 text-zinc-700" />
                <div>
                  <p
                    className="text-zinc-900"
                    style={{ fontSize: 13, fontWeight: 760 }}
                  >
                    {t("home.upgradeBanner.title")}
                  </p>
                  <p
                    className="mt-1 text-zinc-600"
                    style={{ fontSize: 12, lineHeight: 1.6 }}
                  >
                    {t("home.upgradeBanner.desc")}
                  </p>
                  <button
                    onClick={() => {
                      setPaywallFeature(undefined);
                      setPaywallOpen(true);
                    }}
                    className="mt-3 inline-flex h-9 items-center rounded-lg bg-zinc-950 px-3.5 text-white transition-colors hover:bg-black"
                    style={{ fontSize: 12, fontWeight: 760 }}
                  >
                    {t("dash.upgrade")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        <section className="lg:col-start-1 lg:row-start-2">
          {/* s34 wave 8 (E6, 2026-04-28): "Continue this conversation"
            teaser. Renders only when there's a recent non-legacy
            thread (selectMostRecentThread returns null otherwise),
            so a fresh account never sees a hollow tile. The fallback
            label uses the localized "Open chat" copy when a thread
            has no title — this matches the rail's untitled-thread
            handling. */}
          {recentTeaser ? (
            <ContinueThreadTile
              title={resolveTeaserTitle(
                recentTeaser.thread,
                t("home.quickChat"),
              )}
              messageCount={recentTeaser.messageCount}
              lastActive={formatLastActiveLabel(recentTeaser.updatedAt, lang)}
              href={buildTeaserHref(recentTeaser.thread)}
              lang={lang}
              t={t}
              onNavigate={(href) => navigate(href)}
            />
          ) : null}
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <p
                className="text-zinc-500"
                style={{
                  fontSize: 11,
                  fontWeight: 760,
                  textTransform: "uppercase",
                }}
              >
                {lang === "kz" ? "Жылдам кіру" : "Быстрый вход"}
              </p>
              <h2
                className="mt-1 text-zinc-950"
                style={{ fontSize: 22, fontWeight: 740, lineHeight: 1.15 }}
              >
                {lang === "kz"
                  ? "Негізгі Samga беттері"
                  : "Основные поверхности Samga"}
              </h2>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {quickActions.map((action) => {
              const locked = action.gated && !canAccess(action.gated);
              return (
                <ActionTile
                  key={action.href}
                  title={t(action.labelKey)}
                  description={
                    locked
                      ? t("home.premiumOnly")
                      : `${t(action.descKey)}${action.descSuffix ? action.descSuffix : ""}`
                  }
                  locked={Boolean(locked)}
                  tone={action.tone}
                  icon={action.icon}
                  onClick={() => go(action.href, action.gated)}
                />
              );
            })}
          </div>
        </section>
      </section>

      <section>
        <div className="mb-3">
          <p
            className="text-zinc-500"
            style={{
              fontSize: 11,
              fontWeight: 760,
              textTransform: "uppercase",
            }}
          >
            {t("home.usage.title")}
          </p>
          <h2
            className="mt-1 text-zinc-950"
            style={{ fontSize: 22, fontWeight: 740, lineHeight: 1.15 }}
          >
            {lang === "kz" ? "Күндік лимиттер" : "Дневные лимиты"}
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {usageRows.map((row) => (
            <UsageTile
              key={row.label}
              label={row.label}
              used={row.used}
              limit={row.limit}
              lang={lang}
            />
          ))}
        </div>
      </section>

      <PaywallModal
        open={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        feature={paywallFeature}
      />
    </div>
  );
}

function Pill({
  children,
  icon: Icon,
  tone,
}: {
  children: string;
  icon?: typeof Sparkles;
  tone: "amber" | "zinc";
}) {
  const toneClass =
    tone === "amber"
      ? "border-zinc-300 bg-zinc-50 text-zinc-900"
      : "border-zinc-200 bg-white text-zinc-600";

  return (
    <span
      className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 ${toneClass}`}
      style={{ fontSize: 11, fontWeight: 760 }}
    >
      {Icon ? <Icon size={13} /> : null}
      {children}
    </span>
  );
}

function InfoChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5">
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

function MiniStat({
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
      <p
        className="text-zinc-500"
        style={{ fontSize: 11, fontWeight: 740, textTransform: "uppercase" }}
      >
        {label}
      </p>
      <p
        className="mt-1 text-zinc-950"
        style={{ fontSize: 20, fontWeight: 760 }}
      >
        {value}
      </p>
      <p
        className="mt-1 text-zinc-500"
        style={{ fontSize: 12, lineHeight: 1.5 }}
      >
        {hint}
      </p>
    </div>
  );
}

function ActionTile({
  title,
  description,
  locked,
  tone,
  icon: Icon,
  onClick,
}: {
  title: string;
  description: string;
  locked: boolean;
  tone: "amber" | "sky" | "emerald" | "violet" | "rose" | "zinc";
  icon: typeof MessageSquareText;
  onClick: () => void;
}) {
  const toneMap: Record<string, string> = {
    amber: "bg-amber-50 text-amber-700",
    sky: "bg-sky-50 text-sky-700",
    emerald: "bg-emerald-50 text-emerald-700",
    violet: "bg-violet-50 text-violet-700",
    rose: "bg-rose-50 text-rose-700",
    zinc: "bg-zinc-100 text-zinc-700",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group rounded-xl border px-4 py-4 text-left transition-colors ${
        locked
          ? "border-zinc-200 bg-white hover:bg-zinc-50"
          : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={`flex h-10 w-10 items-center justify-center rounded-lg ${
            locked ? "bg-zinc-100 text-zinc-600" : toneMap[tone]
          }`}
        >
          <Icon size={18} />
        </span>
        {locked ? (
          <span className="inline-flex h-7 items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2 text-zinc-600">
            <Lock size={12} />
          </span>
        ) : (
          <ArrowUpRight
            size={15}
            className="text-zinc-300 transition-colors group-hover:text-zinc-600"
          />
        )}
      </div>

      <p
        className="mt-4 text-zinc-950"
        style={{ fontSize: 15, fontWeight: 740 }}
      >
        {title}
      </p>
      <p
        className={`mt-1.5 ${locked ? "text-zinc-600" : "text-zinc-500"}`}
        style={{ fontSize: 12.5, lineHeight: 1.65 }}
      >
        {description}
      </p>
    </button>
  );
}

function ContinueThreadTile({
  title,
  messageCount,
  lastActive,
  href,
  lang: _lang,
  t,
  onNavigate,
}: {
  title: string;
  messageCount: number;
  lastActive: string;
  href: string;
  lang: "ru" | "kz";
  t: (k: string) => string;
  onNavigate: (href: string) => void;
}) {
  // s34 wave 8 (E6): full-width pill above the quick-actions grid.
  // Single-row layout on >=sm: icon, title+meta on the left, CTA
  // button on the right. On narrow viewports it stacks: icon+title
  // top, CTA full-width bottom.
  return (
    <button
      type="button"
      onClick={() => onNavigate(href)}
      className="group mb-3 flex w-full items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50 sm:gap-4"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
        <History size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p
          className="text-zinc-500"
          style={{
            fontSize: 10.5,
            fontWeight: 760,
            textTransform: "uppercase",
          }}
        >
          {t("home.continue.eyebrow")}
        </p>
        <p
          className="mt-0.5 truncate text-zinc-950"
          style={{ fontSize: 14.5, fontWeight: 740 }}
        >
          {title}
        </p>
        <p
          className="mt-0.5 truncate text-zinc-500"
          style={{ fontSize: 12, lineHeight: 1.4 }}
        >
          {messageCount} {t("home.continue.messages")}
          {lastActive ? ` · ${lastActive}` : ""}
        </p>
      </div>
      <span
        className="hidden items-center gap-1.5 rounded-lg bg-zinc-950 px-3 py-1.5 text-white transition-colors group-hover:bg-black sm:inline-flex"
        style={{ fontSize: 12, fontWeight: 700 }}
      >
        {t("home.continue.cta")}
        <ArrowUpRight size={13} />
      </span>
    </button>
  );
}

function UsageTile({
  label,
  used,
  limit,
  lang,
}: {
  label: string;
  used: number;
  limit: number;
  lang: "ru" | "kz";
}) {
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const status =
    limit === 0
      ? lang === "kz"
        ? "Қолжетімсіз"
        : "Недоступно"
      : pct >= 100
        ? lang === "kz"
          ? "Лимит бітті"
          : "Лимит исчерпан"
        : pct >= 80
          ? lang === "kz"
            ? "Лимитке жақын"
            : "Близко к лимиту"
          : lang === "kz"
            ? "Қалыпты"
            : "Норма";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-4">
      <p
        className="text-zinc-500"
        style={{ fontSize: 11, fontWeight: 740, textTransform: "uppercase" }}
      >
        {label}
      </p>
      <p
        className="mt-2 text-zinc-950"
        style={{ fontSize: 24, fontWeight: 760, lineHeight: 1 }}
      >
        {limit > 0 ? `${used}/${limit}` : "—"}
      </p>
      <p
        className="mt-2 text-zinc-500"
        style={{ fontSize: 12, lineHeight: 1.5 }}
      >
        {status}
      </p>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-zinc-100">
        <div
          className={`h-full rounded-full transition-all ${
            pct >= 100
              ? "bg-red-500"
              : pct >= 80
                ? "bg-amber-500"
                : "bg-zinc-900"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
