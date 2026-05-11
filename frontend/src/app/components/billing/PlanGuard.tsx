import { useState } from "react";
import {
  ArrowLeft,
  Crown,
  Lock,
  Sparkles,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useNavigate } from "react-router";
import { usePlan } from "./PlanContext";
import { PaywallModal } from "./PaywallModal";
import { useLang } from "../LanguageContext";
import { planGuardChipLabel, planGuardCopy } from "./planGuardCopy";

interface PlanGuardProps {
  feature: "exams" | "mistakes" | "training" | "gap-analysis" | "quiz";
  children: React.ReactNode;
}

const featureIcons: Record<PlanGuardProps["feature"], LucideIcon> = {
  exams: Crown,
  mistakes: Lock,
  training: Sparkles,
  "gap-analysis": Sparkles,
  quiz: Zap,
};

export function PlanGuard({ feature, children }: PlanGuardProps) {
  const { canAccess } = usePlan();
  const navigate = useNavigate();
  const { t, lang } = useLang();
  const [paywallOpen, setPaywallOpen] = useState(false);

  if (canAccess(feature)) {
    return <>{children}</>;
  }

  const featureNameMap: Record<PlanGuardProps["feature"], string> = {
    exams: "paywall.feature.exams",
    mistakes: "paywall.feature.mistakes",
    training: "paywall.feature.training",
    "gap-analysis": "paywall.feature.gap",
    quiz: "paywall.feature.quiz",
  };
  const featureName = t(featureNameMap[feature]);
  const FeatureIcon = featureIcons[feature];
  // v3.74 (B17, 2026-05-02): the locked-page used to look like four
  // different copies because three nested ternaries diverged the
  // title/description/hero per gated feature. We now resolve all
  // three from a single pure helper. Strings are unchanged; the
  // shape is now one object per feature × language, so a future
  // translator can't accidentally fork the structure.
  const guardLang: "ru" | "kz" = lang === "kz" ? "kz" : "ru";
  const copy = planGuardCopy(feature, guardLang, t);
  const lockedTitle = copy.title;
  const lockedDescription = copy.description;
  const heroDescription = copy.hero;
  const chipLabel = planGuardChipLabel(feature, guardLang, featureName);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <section className="rounded-2xl border border-zinc-200/80 bg-zinc-50 px-6 py-6 sm:px-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <GuardPill icon={<Lock size={13} className="text-amber-700" />}>
                Samga Premium
              </GuardPill>
              <GuardPill
                icon={<FeatureIcon size={13} className="text-amber-700" />}
              >
                {chipLabel}
              </GuardPill>
            </div>
            <h1
              className="text-[24px] text-zinc-950 sm:text-[30px]"
              style={{ fontWeight: 760, lineHeight: 1.08 }}
            >
              {featureName}
            </h1>
            <p
              className="mt-3 text-[13px] text-zinc-600 sm:text-[14px]"
              style={{ lineHeight: 1.75 }}
            >
              {heroDescription}
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:w-[320px]">
            <GuardStat
              label={lang === "kz" ? "Қолжетімділік" : "Доступ"}
              value="Premium"
            />
            <GuardStat
              label={lang === "kz" ? "Модель" : "Модель"}
              value="Samga-S1.1-thinking"
            />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200/80 bg-white px-5 py-5 ">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-center">
          <div>
            <h2
              className="text-zinc-950"
              style={{ fontSize: 18, fontWeight: 730 }}
            >
              {lockedTitle}
            </h2>
            <p
              className="mt-2 text-zinc-500"
              style={{ fontSize: 13, lineHeight: 1.7 }}
            >
              {lockedDescription}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
            <button
              type="button"
              onClick={() => setPaywallOpen(true)}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-zinc-950 px-5 text-white transition-colors hover:bg-black"
              style={{ fontSize: 14, fontWeight: 720 }}
            >
              <Crown size={16} />
              {t("dash.upgrade")}
            </button>
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-5 text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
              style={{ fontSize: 14, fontWeight: 700 }}
            >
              <ArrowLeft size={16} />
              {t("guard.back")}
            </button>
          </div>
        </div>
      </section>

      <PaywallModal
        open={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        feature={feature}
      />
    </div>
  );
}

function GuardPill({
  icon,
  children,
}: {
  icon: React.ReactNode;
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

function GuardStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200/80 bg-white px-4 py-3">
      <p
        className="text-zinc-500"
        style={{ fontSize: 11, fontWeight: 760, textTransform: "uppercase" }}
      >
        {label}
      </p>
      <p
        className="mt-2 break-words text-zinc-900"
        style={{ fontSize: 18, fontWeight: 760, lineHeight: 1.2 }}
      >
        {value}
      </p>
    </div>
  );
}
