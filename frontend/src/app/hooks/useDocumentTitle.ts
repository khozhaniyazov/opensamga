/**
 * Session 22: set per-route browser tab title. Before this every tab
 * said "Samga.ai — Адаптивная подготовка к ЕНТ и ҰБТ" which meant a
 * user with multiple tabs open couldn't tell them apart.
 *
 * Call at the top of a page component:
 *   useDocumentTitle(t("chat.title"));   // "Чат — Samga.ai"
 *
 * Title reverts to the static index.html title on unmount.
 *
 * F-06 / F-12 / F-23 (polish 2026-04-26): switched from useEffect to
 * useLayoutEffect so the title is mutated *before* the browser paints
 * the first frame of the new route. With useEffect there was a 1-frame
 * window where /dashboard, /dashboard/exams, /dashboard/rag-stats all
 * briefly showed the index.html fallback title before being corrected.
 */
import { useLayoutEffect } from "react";

const BASE = "Samga.ai";
const FALLBACK = "Samga.ai — Адаптивная подготовка к ЕНТ и ҰБТ";

export function useDocumentTitle(pageLabel: string | null | undefined): void {
  useLayoutEffect(() => {
    const prev = document.title;
    const label = (pageLabel || "").trim();
    document.title = label ? `${label} — ${BASE}` : FALLBACK;
    return () => {
      document.title = prev;
    };
  }, [pageLabel]);
}
