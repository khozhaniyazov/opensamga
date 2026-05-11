import { useEffect } from "react";
import { AlertTriangle, Crown, X } from "lucide-react";
import { usePlan, type UsageCounters } from "./PlanContext";
import { useLang } from "../LanguageContext";

interface LimitReachedModalProps {
  open: boolean;
  onClose: () => void;
  counter: keyof UsageCounters;
  onUpgrade: () => void;
}

export function LimitReachedModal({
  open,
  onClose,
  counter,
  onUpgrade,
}: LimitReachedModalProps) {
  const { billing, isPremium } = usePlan();
  const { t, lang } = useLang();

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const used = billing.usage[counter];
  const limitMap: Record<keyof UsageCounters, string> = {
    chatMessages: "chatMessagesPerDay",
    examRuns: "examRunsPerDay",
    mistakeAnalyses: "mistakeAnalysesPerDay",
    trainingCalls: "trainingCallsPerDay",
  };
  const limit =
    billing.limits[limitMap[counter] as keyof typeof billing.limits];
  const featureTitle = t(`limit.${counter}.title`);
  const featureDescription = t(`limit.${counter}.desc`);

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative w-full max-w-xl overflow-hidden rounded-t-[30px] border border-zinc-200/80 bg-white shadow-xl sm:rounded-2xl">
        <div className="border-b border-zinc-200/80 bg-zinc-50 px-4 py-4 sm:px-6 sm:py-5">
          <button
            type="button"
            onClick={onClose}
            aria-label={t("limit.ok")}
            className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-900 sm:right-6 sm:top-5"
          >
            <X size={18} />
          </button>

          <div className="pr-14">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span
                className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-zinc-700"
                style={{ fontSize: 11, fontWeight: 700 }}
              >
                <AlertTriangle size={13} className="text-amber-700" />
                Samga Limit
              </span>
              <span
                className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-700"
                style={{ fontSize: 11, fontWeight: 700 }}
              >
                {used}/{limit}
              </span>
            </div>

            <h3
              className="text-[24px] text-zinc-950 sm:text-[28px]"
              style={{ fontWeight: 760, lineHeight: 1.08 }}
            >
              {featureTitle}
            </h3>
            <p
              className="mt-3 text-[13px] text-zinc-600 sm:text-[14px]"
              style={{ lineHeight: 1.75 }}
            >
              {featureDescription}
            </p>
          </div>
        </div>

        <div className="px-4 py-4 sm:px-6 sm:py-6">
          <div className="rounded-xl border border-zinc-200/80 bg-zinc-50 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <p
                className="text-zinc-500"
                style={{ fontSize: 12, fontWeight: 650 }}
              >
                {t("limit.usedToday")}
              </p>
              <p
                className="text-zinc-950"
                style={{ fontSize: 13, fontWeight: 760 }}
              >
                {used}/{limit}
              </p>
            </div>

            <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-200">
              <div className="h-full w-full rounded-full bg-amber-500" />
            </div>

            <p
              className="mt-4 text-zinc-500"
              style={{ fontSize: 12.5, lineHeight: 1.7 }}
            >
              {isPremium
                ? lang === "kz"
                  ? "Қазіргі premium лимит бүгін толық жұмсалды. Келесі күндік циклде қайта ашылады."
                  : "Текущий premium-лимит на сегодня полностью исчерпан. Доступ снова откроется в следующем суточном цикле."
                : lang === "kz"
                  ? "Free деңгейі осы контурда бітті. Premium көбірек көлем мен жабық құралдарды ашады."
                  : "На free-уровне этот контур закончился. Premium открывает больший объём и закрытые инструменты."}
            </p>
          </div>
        </div>

        <div className="border-t border-zinc-200/80 bg-white px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-12 items-center justify-center rounded-2xl border border-zinc-200 bg-white px-5 text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
              style={{ fontSize: 14, fontWeight: 700 }}
            >
              {t("limit.ok")}
            </button>
            {!isPremium ? (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onUpgrade();
                }}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-zinc-950 px-5 text-white transition-colors hover:bg-black"
                style={{ fontSize: 14, fontWeight: 720 }}
              >
                <Crown size={16} />
                {t("limit.increase")}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
