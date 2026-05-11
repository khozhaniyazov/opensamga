import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Check,
  Crown,
  CreditCard,
  RefreshCw,
  Shield,
  Sparkles,
} from "lucide-react";
import { usePlan } from "../billing/PlanContext";
import { useLang } from "../LanguageContext";
import { PaywallModal } from "../billing/PaywallModal";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";

export function BillingPage() {
  const { billing, isPremium, isLoading, priceKzt, resetUsage, chatModel } =
    usePlan();
  const { t, lang } = useLang();
  useDocumentTitle(t("dash.nav.billing"));

  const [paywallOpen, setPaywallOpen] = useState(false);
  const [cancelInfoOpen, setCancelInfoOpen] = useState(false);

  const usageRows = useMemo(
    () => [
      {
        label: t("home.usage.chat"),
        used: billing.usage.chatMessages,
        limit: billing.limits.chatMessagesPerDay,
      },
      {
        label: t("home.usage.exams"),
        used: billing.usage.examRuns,
        limit: billing.limits.examRunsPerDay,
      },
      {
        label: t("home.usage.mistakes"),
        used: billing.usage.mistakeAnalyses,
        limit: billing.limits.mistakeAnalysesPerDay,
      },
      {
        label: t("home.usage.training"),
        used: billing.usage.trainingCalls,
        limit: billing.limits.trainingCallsPerDay,
      },
    ],
    [billing, t],
  );

  const premiumIncluded = [
    "paywall.prem.1",
    "paywall.prem.2",
    "paywall.prem.3",
    "paywall.prem.4",
    "paywall.prem.5",
    "paywall.prem.6",
    "paywall.free.1",
    "paywall.free.2",
  ];
  const freeIncluded = ["paywall.free.3", "paywall.free.1", "paywall.free.2"];
  const priceLabel = `${priceKzt.toLocaleString("ru-RU")} ${t("billing.perMonth")}`;
  const activeTo = billing.planExpiresAt
    ? new Date(billing.planExpiresAt).toLocaleDateString(
        lang === "kz" ? "kk-KZ" : "ru-RU",
      )
    : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="rounded-2xl border border-zinc-200 bg-white px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <HeroPill
                icon={<CreditCard size={13} className="text-zinc-700" />}
              >
                Samga Access
              </HeroPill>
              <HeroPill icon={<Sparkles size={13} className="text-zinc-700" />}>
                {chatModel}
              </HeroPill>
            </div>
            <h1
              className="text-[24px] text-zinc-950 sm:text-[30px]"
              style={{ fontWeight: 760, lineHeight: 1.08 }}
            >
              {t("billing.title")}
            </h1>
            <p
              className="mt-3 text-[13px] text-zinc-600 sm:text-[14px]"
              style={{ lineHeight: 1.75 }}
            >
              {lang === "kz"
                ? "Samga жоспары, модель қабаты және тәуліктік лимиттер осы жерден көрінеді. Қолмен төлем режимі бар екені интерфейсте ашық айтылуы керек."
                : "Здесь видно план Samga, активную модель и суточные лимиты. Ручной режим оплаты должен быть описан честно, без ложного checkout-ощущения."}
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:w-[460px]">
            <HeroStat
              label={lang === "kz" ? "Тариф" : "Тариф"}
              value={isPremium ? t("dash.plan.premium") : t("dash.plan.free")}
            />
            <HeroStat
              label={
                isLoading ? "SYNCING..." : lang === "kz" ? "Күйі" : "Статус"
              }
              value={isPremium ? t("billing.active") : t("billing.freePlan")}
            />
            <HeroStat
              label={lang === "kz" ? "Модель" : "Модель"}
              value={chatModel}
              className="sm:col-span-2"
            />
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2
                className="text-zinc-950"
                style={{ fontSize: 18, fontWeight: 730 }}
              >
                {t("billing.usageTitle")}
              </h2>
              <p
                className="mt-1 text-zinc-500"
                style={{ fontSize: 13, lineHeight: 1.65 }}
              >
                {lang === "kz"
                  ? "Әр арна бойынша нақты жұмсалған көлем. Нөл лимиттер premium деңгейінде ашылады."
                  : "Фактическое использование по каждому контуру. Нулевые лимиты открываются только на premium-уровне."}
              </p>
            </div>

            <button
              type="button"
              onClick={() => void resetUsage()}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-zinc-600 transition-colors hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-900"
              style={{ fontSize: 12, fontWeight: 700 }}
            >
              <RefreshCw
                size={14}
                className={isLoading ? "animate-spin" : ""}
              />
              {lang === "kz" ? "Жаңарту" : "Обновить"}
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {usageRows.map((row) => (
              <UsageCard
                key={row.label}
                label={row.label}
                used={row.used}
                limit={row.limit}
                premiumOnlyText={t("billing.premiumOnly")}
              />
            ))}
          </div>
        </section>

        <div className="rounded-2xl border border-zinc-200 bg-white px-5 py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-xl border ${
                  isPremium
                    ? "border-zinc-300 bg-zinc-50 text-zinc-900"
                    : "border-zinc-200 bg-zinc-50 text-zinc-600"
                }`}
              >
                {isPremium ? <Crown size={20} /> : <CreditCard size={20} />}
              </div>
              <div>
                <p
                  className="text-zinc-950"
                  style={{ fontSize: 18, fontWeight: 730 }}
                >
                  {isPremium ? t("dash.plan.premium") : t("dash.plan.free")}
                </p>
                <p
                  className="mt-1 text-zinc-500"
                  style={{ fontSize: 13, lineHeight: 1.65 }}
                >
                  {isPremium
                    ? activeTo
                      ? `${priceLabel} · ${t("billing.activeTo")} ${activeTo}`
                      : priceLabel
                    : t("billing.freePlan")}
                </p>
              </div>
            </div>

            <span
              className={`inline-flex rounded-full border px-3 py-1 ${
                isPremium
                  ? "border-zinc-300 bg-zinc-50 text-zinc-900"
                  : "border-zinc-200 bg-zinc-50 text-zinc-500"
              }`}
              style={{ fontSize: 11, fontWeight: 700 }}
            >
              {chatModel}
            </span>
          </div>

          <div className="mt-5 space-y-3">
            <InfoRow
              label={lang === "kz" ? "Төлем күйі" : "Состояние оплаты"}
              value={
                isPremium
                  ? lang === "kz"
                    ? "Қолмен белсендірілген"
                    : "Активирован вручную"
                  : lang === "kz"
                    ? "Әлі checkout жоқ"
                    : "Checkout пока не подключён"
              }
            />
            <InfoRow
              label={lang === "kz" ? "Төлем арнасы" : "Провайдер"}
              value={
                billing.provider ||
                (lang === "kz" ? "Қолмен режим" : "Ручной режим")
              }
            />
            <InfoRow
              label={lang === "kz" ? "Негізгі модель" : "Основная модель"}
              value={chatModel}
            />
          </div>

          <div className="mt-5 flex flex-col gap-3">
            {isPremium ? (
              <button
                type="button"
                onClick={() => setCancelInfoOpen((value) => !value)}
                className="inline-flex h-12 items-center justify-center rounded-lg border border-zinc-200 bg-white px-5 text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50"
                style={{ fontSize: 14, fontWeight: 700 }}
              >
                {lang === "kz" ? "Жазылым күйін түсіну" : "Как работает отмена"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setPaywallOpen(true)}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-5 text-white transition-colors hover:bg-black"
                style={{ fontSize: 14, fontWeight: 720 }}
              >
                <Crown size={16} />
                {t("billing.upgradeTo")} - {priceLabel}
              </button>
            )}

            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-4">
              <p
                className="text-zinc-950"
                style={{ fontSize: 13, fontWeight: 700 }}
              >
                {lang === "kz" ? "Samga note" : "Samga note"}
              </p>
              <p
                className="mt-2 text-zinc-500"
                style={{ fontSize: 12.5, lineHeight: 1.7 }}
              >
                {lang === "kz"
                  ? "Premium әлі автоматты төлеммен сатылмайды. Сондықтан интерфейс сұранысты тіркейді, ал белсендіруді әкімші орындайды."
                  : "Premium пока не продаётся через автоматическую оплату. Интерфейс только фиксирует запрос, а активация идёт через администратора."}
              </p>
            </div>
          </div>

          {cancelInfoOpen ? (
            <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-4 text-zinc-700">
              <p style={{ fontSize: 12.5, lineHeight: 1.7 }}>
                {lang === "kz"
                  ? "Жазылымды тоқтату да қазір қолмен реттеледі. Жоспар күйі тек серверден алынады, сондықтан UI енді жалған түрде free-ге ауыспайды."
                  : "Отмена подписки сейчас тоже проходит вручную. Состояние плана берётся только с сервера, поэтому интерфейс больше не притворяется, будто уже откатился на free."}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <PlanCard
          active={!isPremium}
          tone="neutral"
          label={t("paywall.free")}
          price={`0 ${t("billing.perMonth")}`}
          model="Samga-S1.1"
          activeLabel={lang === "kz" ? "Белсенді" : "Активен"}
          items={freeIncluded.map((key) => t(key))}
        />
        <PlanCard
          active={isPremium}
          tone="premium"
          label={t("paywall.premiumLabel")}
          price={priceLabel}
          model="Samga-S1.1-thinking"
          activeLabel={lang === "kz" ? "Белсенді" : "Активен"}
          items={premiumIncluded.map((key) => t(key))}
        />
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-white px-5 py-4">
        <Shield size={16} className="mt-0.5 shrink-0 text-zinc-600" />
        <p
          className="text-zinc-500"
          style={{ fontSize: 12.5, lineHeight: 1.75 }}
        >
          {t("billing.mvp")}
        </p>
      </div>

      <PaywallModal open={paywallOpen} onClose={() => setPaywallOpen(false)} />
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

function HeroStat({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 ${className}`}
    >
      <p
        className="text-zinc-500"
        style={{ fontSize: 11, fontWeight: 760, textTransform: "uppercase" }}
      >
        {label}
      </p>
      <p
        className="mt-2 break-words text-zinc-900"
        style={{ fontSize: 16, fontWeight: 760, lineHeight: 1.2 }}
      >
        {value}
      </p>
    </div>
  );
}

function UsageCard({
  label,
  used,
  limit,
  premiumOnlyText,
}: {
  label: string;
  used: number;
  limit: number;
  premiumOnlyText: string;
}) {
  const gated = limit === 0;
  const pct = gated ? 0 : Math.min((used / limit) * 100, 100);

  return (
    <article className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p
            className="text-zinc-950"
            style={{ fontSize: 14, fontWeight: 700 }}
          >
            {label}
          </p>
          <p
            className="mt-1 text-zinc-500"
            style={{ fontSize: 12.5, lineHeight: 1.6 }}
          >
            {gated ? premiumOnlyText : `${used}/${limit}`}
          </p>
        </div>
        {!gated ? (
          <span
            className={`inline-flex rounded-full border px-3 py-1 ${
              pct >= 100
                ? "border-red-200 bg-red-50 text-red-700"
                : pct >= 80
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-zinc-200 bg-white text-zinc-600"
            }`}
            style={{ fontSize: 11, fontWeight: 700 }}
          >
            {Math.round(pct)}%
          </span>
        ) : null}
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-200">
        <div
          className={`h-full rounded-full ${
            gated
              ? "bg-zinc-300"
              : pct >= 100
                ? "bg-red-500"
                : pct >= 80
                  ? "bg-amber-500"
                  : "bg-zinc-500"
          }`}
          style={{ width: `${gated ? 22 : Math.max(pct, 8)}%` }}
        />
      </div>
    </article>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3">
      <p className="text-zinc-500" style={{ fontSize: 12, fontWeight: 650 }}>
        {label}
      </p>
      <p
        className="text-right text-zinc-900"
        style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.5 }}
      >
        {value}
      </p>
    </div>
  );
}

function PlanCard({
  active,
  tone,
  label,
  price,
  model,
  activeLabel,
  items,
}: {
  active: boolean;
  tone: "neutral" | "premium";
  label: string;
  price: string;
  model: string;
  activeLabel: string;
  items: string[];
}) {
  const premium = tone === "premium";

  return (
    <section
      className={`rounded-2xl border px-5 py-5 ${
        premium ? "border-zinc-300 bg-zinc-50" : "border-zinc-200 bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p
            className={premium ? "text-amber-700" : "text-zinc-500"}
            style={{
              fontSize: 11,
              fontWeight: 760,
              textTransform: "uppercase",
            }}
          >
            {label}
          </p>
          <p
            className="mt-2 text-zinc-950"
            style={{ fontSize: 24, fontWeight: 760, lineHeight: 1.1 }}
          >
            {price}
          </p>
          <p className="mt-2 text-zinc-500" style={{ fontSize: 13 }}>
            {model}
          </p>
        </div>

        {active ? (
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 ${
              premium
                ? "border-zinc-300 bg-white text-zinc-900"
                : "border-zinc-200 bg-zinc-50 text-zinc-600"
            }`}
            style={{ fontSize: 11, fontWeight: 700 }}
          >
            {activeLabel}
            <ArrowUpRight size={12} />
          </span>
        ) : null}
      </div>

      <div className="mt-5 space-y-2.5">
        {items.map((item) => (
          <div key={item} className="flex items-start gap-2">
            <Check
              size={14}
              className={
                premium
                  ? "mt-0.5 shrink-0 text-zinc-900"
                  : "mt-0.5 shrink-0 text-zinc-500"
              }
            />
            <span
              className="text-zinc-700"
              style={{ fontSize: 13, lineHeight: 1.65 }}
            >
              {item}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
