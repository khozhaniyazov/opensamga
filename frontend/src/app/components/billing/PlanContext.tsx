import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiGet, apiPost } from "../../lib/api";
import { SAMGA_FREE_MODEL, toSamgaModelName } from "../../lib/modelBranding";
import { useAuth } from "../auth/AuthContext";

export type PlanTier = "free" | "premium";

export interface UsageCounters {
  chatMessages: number;
  examRuns: number;
  mistakeAnalyses: number;
  trainingCalls: number;
}

export interface PlanLimits {
  chatMessagesPerDay: number;
  examRunsPerDay: number;
  mistakeAnalysesPerDay: number;
  trainingCallsPerDay: number;
}

export interface BillingStatus {
  plan: PlanTier;
  planExpiresAt: string | null;
  provider: string | null;
  chatModel: string;
  usage: UsageCounters;
  limits: PlanLimits;
}

interface BillingStatusApi {
  plan?: string;
  is_premium?: boolean;
  expires_at?: string | null;
  provider?: string | null;
  chat_model?: string | null;
  price_kzt?: number;
  limits?: {
    chat_messages?: number;
    exam_runs?: number;
    mistake_analyses?: number;
    practice_questions?: number;
  };
  usage?: {
    chat_messages?: number;
    exam_runs?: number;
    mistake_analyses?: number;
    practice_questions?: number;
  };
}

interface PlanContextType {
  billing: BillingStatus;
  isPremium: boolean;
  isLoading: boolean;
  priceKzt: number;
  chatModel: string;
  canAccess: (
    feature: "exams" | "mistakes" | "training" | "gap-analysis" | "quiz",
  ) => boolean;
  isLimitReached: (counter: keyof UsageCounters) => boolean;
  incrementUsage: (counter: keyof UsageCounters) => void;
  upgradeToPremium: () => Promise<void>;
  downgradeToFree: () => void;
  resetUsage: () => Promise<void>;
  refreshStatus: () => Promise<void>;
}

const PlanContext = createContext<PlanContextType | null>(null);

function defaultBilling(): BillingStatus {
  return {
    plan: "free",
    planExpiresAt: null,
    provider: null,
    chatModel: SAMGA_FREE_MODEL,
    usage: {
      chatMessages: 0,
      examRuns: 0,
      mistakeAnalyses: 0,
      trainingCalls: 0,
    },
    limits: {
      chatMessagesPerDay: 20,
      examRunsPerDay: 0,
      mistakeAnalysesPerDay: 0,
      trainingCallsPerDay: 0,
    },
  };
}

function mapBillingStatus(payload: BillingStatusApi): BillingStatus {
  const mapped = defaultBilling();

  const isPremium =
    payload.is_premium === true ||
    String(payload.plan || "").toUpperCase() === "PREMIUM";

  mapped.plan = isPremium ? "premium" : "free";
  mapped.planExpiresAt = payload.expires_at || null;
  mapped.provider = payload.provider || null;
  mapped.chatModel = toSamgaModelName(payload.chat_model, isPremium);

  mapped.usage = {
    chatMessages: payload.usage?.chat_messages ?? 0,
    examRuns: payload.usage?.exam_runs ?? 0,
    mistakeAnalyses: payload.usage?.mistake_analyses ?? 0,
    trainingCalls: payload.usage?.practice_questions ?? 0,
  };

  mapped.limits = {
    chatMessagesPerDay: payload.limits?.chat_messages ?? 20,
    examRunsPerDay: payload.limits?.exam_runs ?? 0,
    mistakeAnalysesPerDay: payload.limits?.mistake_analyses ?? 0,
    trainingCallsPerDay: payload.limits?.practice_questions ?? 0,
  };

  return mapped;
}

export function usePlan() {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error("usePlan must be used within PlanProvider");
  return ctx;
}

export function PlanProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [billing, setBilling] = useState<BillingStatus>(defaultBilling());
  const [priceKzt, setPriceKzt] = useState(2000);
  const [isLoading, setIsLoading] = useState(false);

  const refreshStatus = useCallback(async () => {
    if (!isAuthenticated) {
      setBilling(defaultBilling());
      return;
    }

    setIsLoading(true);
    try {
      const data = await apiGet<BillingStatusApi>("/billing/status");
      setBilling(mapBillingStatus(data));
      if (typeof data.price_kzt === "number") {
        setPriceKzt(data.price_kzt);
      }
    } catch {
      setBilling(defaultBilling());
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const isPremium = billing.plan === "premium";
  const chatModel = billing.chatModel;

  const canAccess = useCallback(
    (feature: "exams" | "mistakes" | "training" | "gap-analysis" | "quiz") => {
      if (feature === "exams") return billing.limits.examRunsPerDay > 0;
      if (feature === "mistakes")
        return billing.limits.mistakeAnalysesPerDay > 0;
      if (feature === "training") return billing.limits.trainingCallsPerDay > 0;
      if (feature === "quiz") return billing.limits.trainingCallsPerDay > 0;
      return billing.limits.trainingCallsPerDay > 0;
    },
    [billing.limits],
  );

  const isLimitReached = useCallback(
    (counter: keyof UsageCounters) => {
      if (counter === "chatMessages") {
        return billing.usage.chatMessages >= billing.limits.chatMessagesPerDay;
      }
      if (counter === "examRuns") {
        return billing.usage.examRuns >= billing.limits.examRunsPerDay;
      }
      if (counter === "mistakeAnalyses") {
        return (
          billing.usage.mistakeAnalyses >= billing.limits.mistakeAnalysesPerDay
        );
      }
      return billing.usage.trainingCalls >= billing.limits.trainingCallsPerDay;
    },
    [billing],
  );

  const incrementUsage = useCallback((counter: keyof UsageCounters) => {
    setBilling((prev) => ({
      ...prev,
      usage: {
        ...prev.usage,
        [counter]: prev.usage[counter] + 1,
      },
    }));
  }, []);

  const upgradeToPremium = useCallback(async () => {
    await apiPost("/billing/checkout", {});
    await refreshStatus();
  }, [refreshStatus]);

  const downgradeToFree = useCallback(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const resetUsage = useCallback(async () => {
    await refreshStatus();
  }, [refreshStatus]);

  const value = useMemo<PlanContextType>(
    () => ({
      billing,
      isPremium,
      isLoading,
      priceKzt,
      chatModel,
      canAccess,
      isLimitReached,
      incrementUsage,
      upgradeToPremium,
      downgradeToFree,
      resetUsage,
      refreshStatus,
    }),
    [
      billing,
      isPremium,
      isLoading,
      priceKzt,
      chatModel,
      canAccess,
      isLimitReached,
      incrementUsage,
      upgradeToPremium,
      downgradeToFree,
      resetUsage,
      refreshStatus,
    ],
  );

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}
