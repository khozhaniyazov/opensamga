import { useEffect, useMemo, useState } from "react";
import { AlertCircle, RotateCcw, Check, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePlan } from "../billing/PlanContext";
import { useLang } from "../LanguageContext";
import { PlanGuard } from "../billing/PlanGuard";
import { apiGet } from "../../lib/api";

interface MistakeItem {
  id: number;
  ai_diagnosis: string;
  is_resolved: boolean;
  topic_tag?: string | null;
  question_type?: string | null;
  points_lost?: number;
  created_at: string;
  library_citation?: {
    book?: string;
    page?: number;
    quote?: string;
  } | null;
}

export function MistakesPage() {
  return (
    <PlanGuard feature="mistakes">
      <MistakesContent />
    </PlanGuard>
  );
}

function MistakesContent() {
  const { billing, refreshStatus } = usePlan();
  const { t } = useLang();
  const { t: tCommon } = useTranslation("common");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [items, setItems] = useState<MistakeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadCounter, setReloadCounter] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const data = await apiGet<MistakeItem[]>("/mistakes/unresolved");
        if (!active) return;
        setItems(Array.isArray(data) ? data : []);
      } catch {
        if (!active) return;
        // v3.77: surface load failure. The pre-v3.77 `setItems([])`
        // swallow rendered the "all-done" success view on every
        // backend hiccup, hiding mistakes the user still needs to fix.
        setItems([]);
        setLoadError(tCommon("load_failed"));
      } finally {
        if (active) {
          setLoading(false);
          await refreshStatus();
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshStatus, reloadCounter, tCommon]);

  const unresolved = useMemo(
    () => items.filter((m) => !m.is_resolved && !dismissed.has(m.id)),
    [items, dismissed],
  );

  const used = billing.usage.mistakeAnalyses;
  const limit = billing.limits.mistakeAnalysesPerDay;

  function handleResolve(id: number) {
    setDismissed((prev) => new Set(prev).add(id));
    if (expanded === id) setExpanded(null);
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1
            className="text-zinc-900 mb-1"
            style={{ fontSize: 22, fontWeight: 700 }}
          >
            {t("mistakes.title")}
          </h1>
          <p className="text-zinc-500" style={{ fontSize: 13 }}>
            {unresolved.length} {t("mistakes.unresolved")} ·{" "}
            {t("mistakes.analysesToday")} {used}/{limit}
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-zinc-500" style={{ fontSize: 13 }}>
          {tCommon("loading")}
        </p>
      ) : loadError ? (
        <div
          role="alert"
          data-testid="mistakes-load-error"
          className="flex flex-col items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-4 text-red-700 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-2">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <span style={{ fontSize: 13 }}>{loadError}</span>
          </div>
          <button
            type="button"
            onClick={() => setReloadCounter((prev) => prev + 1)}
            className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-red-700 hover:bg-red-100"
            style={{ fontSize: 13, fontWeight: 600 }}
          >
            {tCommon("retry")}
          </button>
        </div>
      ) : unresolved.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-12 h-12 rounded-md bg-green-50 border border-green-200 flex items-center justify-center mx-auto mb-4">
            <Check size={24} className="text-green-500" />
          </div>
          <p
            className="text-zinc-700 mb-1"
            style={{ fontSize: 16, fontWeight: 600 }}
          >
            {t("mistakes.allDone.title")}
          </p>
          <p className="text-zinc-500" style={{ fontSize: 13 }}>
            {t("mistakes.allDone.desc")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {unresolved.map((mistake) => {
            const isOpen = expanded === mistake.id;
            return (
              <div
                key={mistake.id}
                className="rounded-lg border border-zinc-200 bg-white overflow-hidden"
              >
                <button
                  onClick={() => setExpanded(isOpen ? null : mistake.id)}
                  className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-zinc-50 transition-colors"
                >
                  <div className="shrink-0 w-8 h-8 rounded-md bg-amber-50 flex items-center justify-center">
                    <RotateCcw size={14} className="text-amber-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-zinc-800 truncate"
                      style={{ fontSize: 14, fontWeight: 600 }}
                    >
                      {mistake.topic_tag || "Mistake"} ·{" "}
                      {mistake.question_type || "practice"}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span
                        className="px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500"
                        style={{ fontSize: 10, fontWeight: 500 }}
                      >
                        -{mistake.points_lost ?? 1} pts
                      </span>
                      <span className="text-zinc-500" style={{ fontSize: 11 }}>
                        {new Date(mistake.created_at).toLocaleDateString(
                          "ru-RU",
                        )}
                      </span>
                    </div>
                  </div>
                  <ChevronRight
                    size={16}
                    className={`transition-transform ${isOpen ? "rotate-90" : ""}`}
                  />
                </button>

                {isOpen && (
                  <div className="px-5 pb-5 border-t border-zinc-200">
                    <div className="pt-4 space-y-4">
                      <div className="p-4 rounded-md border border-zinc-200 bg-zinc-50">
                        <p
                          className="text-zinc-500 mb-2"
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.04em",
                          }}
                        >
                          {t("mistakes.explanation")}
                        </p>
                        <p
                          className="text-zinc-700 mb-3"
                          style={{
                            fontSize: 13,
                            lineHeight: 1.7,
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {mistake.ai_diagnosis || "No diagnosis"}
                        </p>
                        {mistake.library_citation && (
                          <div className="flex flex-wrap gap-1.5">
                            {mistake.library_citation.book && (
                              <span
                                className="px-2 py-0.5 rounded bg-zinc-100 text-zinc-500"
                                style={{ fontSize: 11 }}
                              >
                                {mistake.library_citation.book}
                              </span>
                            )}
                            {mistake.library_citation.page && (
                              <span
                                className="px-2 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200"
                                style={{ fontSize: 11, fontWeight: 600 }}
                              >
                                {t("library.pages")}{" "}
                                {mistake.library_citation.page}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => handleResolve(mistake.id)}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-amber-500 text-white hover:bg-amber-600 transition-colors"
                        style={{ fontSize: 13, fontWeight: 600 }}
                      >
                        <Check size={14} />
                        {t("mistakes.understood")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
