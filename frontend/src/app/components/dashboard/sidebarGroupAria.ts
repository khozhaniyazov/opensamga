/**
 * s35 wave 28b (2026-04-28) — pure helpers for the
 * DashboardLayout sidebar group-button aria semantics.
 *
 * Pre-wave the collapsible nav group buttons (Практика /
 * Вузы / Аккаунт) carried `aria-expanded` but no
 * `aria-haspopup`. Per WAI-ARIA, `aria-expanded` alone is
 * fine for a disclosure widget BUT screen readers gain
 * stronger affordance when the popup type is hinted. Since
 * these buttons reveal a child *list* of nav links rather
 * than a true menu (`role="menu"` + arrow-key navigation
 * isn't implemented, so we avoid claiming menu semantics
 * we don't actually offer), the cleanest fix is to leave
 * them as a disclosure — but provide a verbose, count-aware
 * aria-label so SR users hear "Практика, раздел из 4
 * пунктов, развёрнут" instead of just "Практика".
 *
 * `sidebarGroupButtonAriaLabel({label, childCount, open,
 *  lang})` produces that label.
 *
 *   - lang ∈ "ru" | "kz". Defaults to "ru" if unrecognized.
 *   - childCount full RU paucal: 1 "пункт" / 2-4 "пункта" /
 *     5-20 + teens "пунктов" / 21 "пункт" again.
 *   - KZ uninflected — "пункт" doesn't have a Kazakh
 *     equivalent in this UI; fall back to "ішінде N сілтеме"
 *     ("contains N links") which mirrors how the rest of the
 *     dashboard speaks.
 *   - Verb agreement: open → "развёрнут / жайылған",
 *     closed → "свёрнут / жиналған".
 *
 * Pure: no DOM, no React, no Intl.
 */

type Lang = "ru" | "kz";

interface Args {
  label: unknown;
  childCount: unknown;
  open: unknown;
  lang: unknown;
}

function safeLang(lang: unknown): Lang {
  return lang === "kz" ? "kz" : "ru";
}

function safeCount(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  return Math.floor(n);
}

function safeLabel(label: unknown): string {
  if (typeof label !== "string") return "";
  return label.trim();
}

/** RU paucal noun selection for "пункт" in the genitive
 *  context. Follows the canonical 2026-04 chat-UX rule:
 *  1, 21, 31… → singular; 2-4, 22-24… → paucal; everything
 *  else → genitive plural. Teens 11-14 always genitive plural. */
function ruPunktForm(count: number): string {
  if (count < 0) return "пунктов";
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return "пунктов";
  if (mod10 === 1) return "пункт";
  if (mod10 >= 2 && mod10 <= 4) return "пункта";
  return "пунктов";
}

export function sidebarGroupButtonAriaLabel({
  label,
  childCount,
  open,
  lang,
}: Args): string {
  const safeL = safeLang(lang);
  const text = safeLabel(label);
  const count = safeCount(childCount);
  const isOpen = open === true;

  if (safeL === "kz") {
    const stateKz = isOpen ? "жайылған" : "жиналған";
    if (text.length === 0) {
      return count === 0
        ? `Бөлім, ${stateKz}`
        : `Бөлім, ішінде ${count} сілтеме, ${stateKz}`;
    }
    if (count === 0) {
      return `${text}, бөлім, ${stateKz}`;
    }
    return `${text}, бөлім, ішінде ${count} сілтеме, ${stateKz}`;
  }

  // ru
  const stateRu = isOpen ? "развёрнут" : "свёрнут";
  if (text.length === 0) {
    return count === 0
      ? `Раздел, ${stateRu}`
      : `Раздел из ${count} ${ruPunktForm(count)}, ${stateRu}`;
  }
  if (count === 0) {
    return `${text}, раздел, ${stateRu}`;
  }
  return `${text}, раздел из ${count} ${ruPunktForm(count)}, ${stateRu}`;
}
