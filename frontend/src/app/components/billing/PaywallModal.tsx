import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  Check,
  CheckCheck,
  ClipboardCheck,
  Copy,
  Crown,
  Dumbbell,
  RotateCcw,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { usePlan } from "./PlanContext";
import { useLang } from "../LanguageContext";
import { useAuth } from "../auth/AuthContext";

interface PaywallModalProps {
  open: boolean;
  onClose: () => void;
  feature?:
    | "exams"
    | "mistakes"
    | "training"
    | "gap-analysis"
    | "chat"
    | "library"
    | "quiz";
}

const featureIcons: Record<string, typeof ClipboardCheck> = {
  exams: ClipboardCheck,
  mistakes: RotateCcw,
  training: Dumbbell,
  "gap-analysis": Target,
  chat: Crown,
  library: ClipboardCheck,
  quiz: Target,
};

export function PaywallModal({ open, onClose, feature }: PaywallModalProps) {
  const { priceKzt, upgradeToPremium, isPremium, chatModel } = usePlan();
  const { user } = useAuth();
  const { t, lang } = useLang();
  const [checkoutState, setCheckoutState] = useState<
    "idle" | "loading" | "manual" | "error"
  >("idle");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCheckoutState("idle");
    setCopied(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (!open) return null;

  const featureKeyMap: Partial<
    Record<NonNullable<PaywallModalProps["feature"]>, string>
  > = {
    exams: "exams",
    mistakes: "mistakes",
    training: "training",
    "gap-analysis": "gap",
    quiz: "quiz",
  };

  const featureFallback =
    lang === "kz"
      ? {
          title: "Samga Premium",
          description: "Бұл мүмкіндік Samga Premium контурында ашылады.",
        }
      : {
          title: "Samga Premium",
          description: "Эта возможность открывается в контуре Samga Premium.",
        };

  const fKey = feature ? featureKeyMap[feature] : null;
  const FeatureIcon = feature ? (featureIcons[feature] ?? Crown) : Crown;
  const priceText = priceKzt.toLocaleString("ru-RU");
  const premiumKeys = [
    "paywall.prem.1",
    "paywall.prem.2",
    "paywall.prem.3",
    "paywall.prem.4",
    "paywall.prem.5",
    "paywall.prem.6",
  ];
  const freeKeys = ["paywall.free.1", "paywall.free.2", "paywall.free.3"];
  const accountEmail = user?.email || "current account";
  const title = fKey ? t(`paywall.feature.${fKey}`) : featureFallback.title;
  const description = fKey
    ? t(`paywall.feature.${fKey}.desc`)
    : featureFallback.description;

  async function handleUpgrade() {
    setCheckoutState("loading");

    try {
      await upgradeToPremium();
      setCheckoutState("manual");
      // F-17: companion toast so the success is visible even after the
      // user closes the modal.
      toast.success(t("paywall.checkoutToast.title"), {
        description: t("paywall.checkoutToast.body"),
      });
    } catch {
      setCheckoutState("error");
    }
  }

  async function handleCopyEmail() {
    try {
      await navigator.clipboard.writeText(accountEmail);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const primaryLabel = isPremium
    ? lang === "kz"
      ? "Premium белсенді"
      : "Premium активен"
    : checkoutState === "loading"
      ? lang === "kz"
        ? "Сұраныс тіркеліп жатыр..."
        : "Фиксируем запрос..."
      : checkoutState === "manual"
        ? lang === "kz"
          ? "Сұраныс тіркелді"
          : "Запрос зафиксирован"
        : t("paywall.upgrade");

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0" onClick={onClose} />

      <div
        className="relative flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-[30px] border border-zinc-200/80 bg-white shadow-xl sm:max-h-[calc(100vh-2rem)] sm:max-w-5xl sm:rounded-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="paywall-title"
        aria-describedby="paywall-description"
      >
        <div className="sticky top-0 z-10 border-b border-zinc-200/80 bg-white px-4 py-4 backdrop-blur sm:px-6 sm:py-5">
          <button
            type="button"
            onClick={onClose}
            aria-label={t("guard.back")}
            className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-900 sm:right-6 sm:top-5"
          >
            <X size={18} />
          </button>

          <div className="pr-14">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <ModalPill
                icon={<FeatureIcon size={13} className="text-amber-700" />}
              >
                Samga Premium
              </ModalPill>
              <ModalPill
                icon={<Sparkles size={13} className="text-amber-700" />}
              >
                Samga-S1.1-thinking
              </ModalPill>
              {feature ? <ModalPill>{title}</ModalPill> : null}
            </div>

            <h2
              id="paywall-title"
              className="text-[24px] text-zinc-950 sm:text-[30px]"
              style={{ fontWeight: 760, lineHeight: 1.08 }}
            >
              {isPremium
                ? lang === "kz"
                  ? "Premium қазірдің өзінде белсенді"
                  : "Premium уже активен"
                : title}
            </h2>
            <p
              id="paywall-description"
              className="mt-3 max-w-3xl text-[13px] text-zinc-600 sm:text-[14px]"
              style={{ lineHeight: 1.75 }}
            >
              {isPremium
                ? lang === "kz"
                  ? `Samga қазір ${chatModel} қабатында жұмыс істеп тұр. Бұл бет тек мәртебені көрсетеді.`
                  : `Samga уже работает на слое ${chatModel}. Это окно теперь просто подтверждает состояние доступа.`
                : description}
            </p>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="grid gap-4 sm:grid-cols-2">
              <PlanSurface
                tone="neutral"
                title={t("paywall.free")}
                price={`0 ${t("billing.perMonth")}`}
                model="Samga-S1.1"
                items={freeKeys.map((key) => t(key))}
              />
              <PlanSurface
                tone="premium"
                title={t("paywall.premiumLabel")}
                price={`${priceText} ${t("billing.perMonth")}`}
                model="Samga-S1.1-thinking"
                items={premiumKeys.map((key) => t(key))}
              />
            </div>

            <aside className="rounded-xl border border-zinc-200/80 bg-zinc-50 px-5 py-5 ">
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 text-amber-700">
                  <Crown size={20} />
                </div>
                <div>
                  <p
                    className="text-zinc-950"
                    style={{ fontSize: 18, fontWeight: 730 }}
                  >
                    {lang === "kz" ? "Қол жеткізу контуры" : "Контур доступа"}
                  </p>
                  <p
                    className="mt-2 text-zinc-500"
                    style={{ fontSize: 13, lineHeight: 1.7 }}
                  >
                    {lang === "kz"
                      ? "Қазір checkout интерфейсі тек сұранысты тіркейді. Белсендіру әлі Samga әкімшісі арқылы қолмен жүреді."
                      : "Сейчас checkout-интерфейс только фиксирует запрос. Активация всё ещё проходит вручную через администратора Samga."}
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                <FactRow
                  label={lang === "kz" ? "Айлық жоспар" : "Месячный план"}
                  value={`${priceText} ${t("billing.perMonth")}`}
                />
                <FactRow
                  label={lang === "kz" ? "Модель" : "Модель"}
                  value="Samga-S1.1-thinking"
                />
                <FactRow
                  label={lang === "kz" ? "Аккаунт" : "Аккаунт"}
                  value={accountEmail}
                />
              </div>

              {checkoutState === "manual" ? (
                <div className="mt-5 rounded-xl border border-amber-200 bg-white px-4 py-4 text-amber-900 ">
                  <div className="flex items-center gap-2">
                    <AlertCircle
                      size={15}
                      className="shrink-0 text-amber-700"
                    />
                    <p style={{ fontSize: 12.5, fontWeight: 760 }}>
                      {lang === "kz"
                        ? "Онлайн төлем әлі жоқ"
                        : "Онлайн-оплаты пока нет"}
                    </p>
                  </div>
                  <p
                    className="mt-2"
                    style={{ fontSize: 12.5, lineHeight: 1.7 }}
                  >
                    {lang === "kz"
                      ? "Осы email-ді Samga әкімшісіне жіберіңіз. Бұл тіркелгі premium белсендіру үшін белгіленді."
                      : "Передайте этот email администратору Samga. Этот аккаунт уже помечен как запрос на premium-активацию."}
                  </p>
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => void handleCopyEmail()}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
                      style={{ fontSize: 13, fontWeight: 700 }}
                    >
                      {copied ? <CheckCheck size={15} /> : <Copy size={15} />}
                      {copied
                        ? lang === "kz"
                          ? "Көшірілді"
                          : "Скопировано"
                        : lang === "kz"
                          ? "Email көшіру"
                          : "Скопировать email"}
                    </button>
                    <button
                      type="button"
                      onClick={onClose}
                      className="inline-flex h-11 items-center justify-center rounded-2xl bg-zinc-950 px-4 text-white transition-colors hover:bg-black"
                      style={{ fontSize: 13, fontWeight: 720 }}
                    >
                      {lang === "kz" ? "Жабу" : "Закрыть"}
                    </button>
                  </div>
                </div>
              ) : null}

              {checkoutState === "error" ? (
                <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-red-700">
                  <p style={{ fontSize: 12.5, lineHeight: 1.7 }}>
                    {lang === "kz"
                      ? "Сұранысты тіркеу мүмкін болмады. Premium әлі әкімші арқылы қолмен қосылады."
                      : "Не удалось зафиксировать запрос. Premium пока по-прежнему включается вручную через администратора."}
                  </p>
                </div>
              ) : null}
            </aside>
          </div>

          {/* F-11: sample preview so users see *what* they get, not just
           * a feature list. Only shown for non-premium users. */}
          {!isPremium ? (
            <div className="mt-4 rounded-xl border border-zinc-200/80 bg-white px-5 py-5">
              <p
                className="text-zinc-950"
                style={{ fontSize: 14, fontWeight: 720 }}
              >
                {t("paywall.preview.title")}
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {/* Sample exam question */}
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-4">
                  <p
                    className="text-amber-700"
                    style={{
                      fontSize: 10.5,
                      fontWeight: 720,
                      letterSpacing: "0.05em",
                      textTransform: "uppercase",
                    }}
                  >
                    {t("paywall.preview.examLabel")}
                  </p>
                  <p
                    className="mt-2 text-zinc-900"
                    style={{ fontSize: 13, lineHeight: 1.65 }}
                  >
                    {t("paywall.preview.examQ")}
                  </p>
                  <p
                    className="mt-3 text-zinc-500"
                    style={{ fontSize: 11.5, lineHeight: 1.5 }}
                  >
                    {t("paywall.preview.examFooter")}
                  </p>
                </div>

                {/* Sample mistake-analysis quote */}
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-4">
                  <p
                    className="text-amber-700"
                    style={{
                      fontSize: 10.5,
                      fontWeight: 720,
                      letterSpacing: "0.05em",
                      textTransform: "uppercase",
                    }}
                  >
                    {t("paywall.preview.mistakeLabel")}
                  </p>
                  <p
                    className="mt-2 text-zinc-700"
                    style={{
                      fontSize: 13,
                      lineHeight: 1.65,
                      fontStyle: "italic",
                    }}
                  >
                    {t("paywall.preview.mistakeBody")}
                  </p>
                  <p
                    className="mt-3 text-zinc-500"
                    style={{ fontSize: 11.5, lineHeight: 1.5 }}
                  >
                    {t("paywall.preview.mistakeFooter")}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          <div className="mt-4 rounded-xl border border-zinc-200/80 bg-white px-5 py-4 text-zinc-500 ">
            <p style={{ fontSize: 12.5, lineHeight: 1.75 }}>
              {t("paywall.payment")}
              <br />
              {t("paywall.mvp")}
            </p>
          </div>
        </div>

        <div className="sticky bottom-0 z-10 border-t border-zinc-200/80 bg-white/95 px-4 py-4 backdrop-blur sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-12 items-center justify-center rounded-2xl border border-zinc-200 bg-white px-5 text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
              style={{ fontSize: 14, fontWeight: 700 }}
            >
              {lang === "kz" ? "Артқа" : "Назад"}
            </button>
            <button
              type="button"
              onClick={() => void handleUpgrade()}
              disabled={
                isPremium ||
                checkoutState === "loading" ||
                checkoutState === "manual"
              }
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-zinc-950 px-5 text-white transition-colors hover:bg-black disabled:cursor-default disabled:bg-zinc-300"
              style={{ fontSize: 14, fontWeight: 720 }}
            >
              <Crown size={16} />
              <span>{primaryLabel}</span>
              {!isPremium && checkoutState === "idle" ? (
                <span className="tabular-nums text-white/75">
                  - {priceText} {t("billing.perMonth")}
                </span>
              ) : null}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModalPill({
  icon,
  children,
}: {
  icon?: React.ReactNode;
  children: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-zinc-700"
      style={{ fontSize: 11, fontWeight: 700 }}
    >
      {icon}
      {children}
    </span>
  );
}

function PlanSurface({
  tone,
  title,
  price,
  model,
  items,
}: {
  tone: "neutral" | "premium";
  title: string;
  price: string;
  model: string;
  items: string[];
}) {
  const premium = tone === "premium";

  return (
    <section
      className={`rounded-xl border px-5 py-5 ${
        premium
          ? "border-amber-200 bg-amber-50/70"
          : "border-zinc-200/80 bg-white"
      }`}
    >
      <p
        className={premium ? "text-amber-700" : "text-zinc-500"}
        style={{ fontSize: 11, fontWeight: 760, textTransform: "uppercase" }}
      >
        {title}
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

      <div className="mt-5 space-y-2.5">
        {items.map((item) => (
          <div key={item} className="flex items-start gap-2">
            <Check
              size={14}
              className={
                premium
                  ? "mt-0.5 shrink-0 text-amber-700"
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

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200/80 bg-white px-4 py-3">
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
