/**
 * s29 (C1, 2026-04-27) — AnchoredToc.
 *
 * Auto-generated table-of-contents pinned at the top of long
 * assistant bubbles. Triggered by either of:
 *
 *   - body has ≥ 3 markdown h2/h3 headings, OR
 *   - body word count > 300 AND has ≥ 2 h2/h3 headings.
 *
 * The roadmap calls for a "left-rail list inside the bubble"; in
 * practice that breaks on mobile and on chats embedded inside
 * narrow side panels, so we render a collapsible strip at the top
 * of the bubble instead. Each entry is a button that scrolls the
 * matching <h2>/<h3> into view via document.getElementById +
 * scrollIntoView({behavior:"smooth", block:"start"}).
 *
 * Heading anchors are produced by `slugifyHeading` and must match
 * the `id` attribute set on the rendered h2/h3 inside
 * AssistantMessage.tsx (markdownComponents). A drift between the
 * two slugifiers would silently break "click TOC → scroll to
 * heading"; the vitest pin keeps them aligned.
 *
 * The three pure helpers (`slugifyHeading`, `extractTocEntries`,
 * `shouldShowToc`) are exported so vitest can pin the contract
 * without a DOM renderer — same convention as RedactionPill /
 * SourcesDrawer.
 */
import { useState } from "react";
import { ChevronRight, ListOrdered } from "lucide-react";
import { useLang } from "../../LanguageContext";
import { tocEntryAria, tocToggleAria } from "./anchoredTocAria";

export interface TocEntry {
  level: 2 | 3;
  text: string;
  slug: string;
}

/** Pure slugifier — exported for vitest. The same function is also
 *  used by AssistantMessage's markdownComponents so the `id` it
 *  stamps on each <h2>/<h3> matches what AnchoredToc clicks. */
export function slugifyHeading(raw: string): string {
  return (
    (raw || "")
      .toLowerCase()
      // Drop markdown-residue characters that ReactMarkdown might leak
      // into the children string before we slugify.
      .replace(/[`*_~]/g, "")
      .normalize("NFKD")
      // Whitespace → single hyphen.
      .replace(/\s+/g, "-")
      // Strip anything that's not letter/digit/hyphen across the full
      // unicode range — covers Cyrillic/Kazakh letters too. We DO NOT
      // transliterate because the slug is server-invisible (used only
      // for in-page scrolling) and Cyrillic ids work fine in modern
      // browsers.
      .replace(/[^\p{L}\p{N}-]+/gu, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80)
  );
}

/** Pure extractor — walks the raw markdown body for h2/h3 headings
 *  and returns them in document order. Skips fenced code blocks so
 *  comment lines starting with `##` inside a snippet don't leak in. */
export function extractTocEntries(text: string): TocEntry[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const out: TocEntry[] = [];
  let inFence = false;
  for (const line of lines) {
    const fenceMatch = line.match(/^```/);
    if (fenceMatch) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(/^(##|###)\s+(.+?)\s*#*\s*$/);
    if (!m || !m[1] || !m[2]) continue;
    const level = m[1].length === 2 ? 2 : 3;
    const heading = m[2].trim();
    const slug = slugifyHeading(heading);
    if (!heading || !slug) continue;
    out.push({ level: level as 2 | 3, text: heading, slug });
  }
  return out;
}

/** Pure word counter — exported for vitest. Counts whitespace-
 *  delimited tokens; conservative ASCII-aware, but works for
 *  Russian/Kazakh prose because we just split on whitespace. */
export function countWords(text: string): number {
  return (text || "").trim().split(/\s+/).filter(Boolean).length;
}

/** Pure gate — exported for vitest.
 *
 *   - ≥ 3 headings ⇒ always show.
 *   - 300+ words AND ≥ 2 headings ⇒ show.
 *   - otherwise ⇒ hide. */
export function shouldShowToc(text: string, entries: TocEntry[]): boolean {
  if (entries.length >= 3) return true;
  if (entries.length >= 2 && countWords(text) > 300) return true;
  return false;
}

interface Props {
  text: string;
}

export function AnchoredToc({ text }: Props) {
  const { lang } = useLang();
  // Roadmap says "default expanded on long answers" — we open by
  // default because the only reason the gate fired is that the
  // answer is long enough to need navigation.
  const [open, setOpen] = useState(true);

  const entries = extractTocEntries(text);
  if (!shouldShowToc(text, entries)) return null;
  const langSafe = (lang === "kz" ? "kz" : "ru") as "ru" | "kz";

  const heading = langSafe === "kz" ? "Мазмұны" : "Содержание";
  // s35 wave 23b (2026-04-28): toggle now names the entry count
  // so SR users know how big the table is before expanding.
  const toggleAria = tocToggleAria({
    open,
    count: entries.length,
    lang: langSafe,
  });

  function jumpTo(slug: string) {
    if (typeof document === "undefined") return;
    const el = document.getElementById(slug);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <nav
      aria-label={heading}
      className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px]"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={toggleAria}
        className="flex w-full items-center justify-between gap-2 text-left text-[12px] font-semibold text-slate-700 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
      >
        <span className="inline-flex items-center gap-1.5">
          <ListOrdered className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{heading}</span>
        </span>
        {/* s35 wave 35a (2026-04-28): single chevron + CSS rotation
            via parent button's aria-expanded. */}
        <ChevronRight
          className="h-3.5 w-3.5 samga-anim-chevron-target"
          aria-hidden="true"
        />
      </button>
      {open && (
        <ol className="mt-2 flex list-none flex-col gap-1 pl-0 samga-anim-disclosure-expand">
          {entries.map((e, idx) => (
            <li
              key={`${e.slug}-${idx}`}
              className={e.level === 3 ? "pl-4" : "pl-0"}
            >
              <button
                type="button"
                onClick={() => jumpTo(e.slug)}
                // s35 wave 23b (2026-04-28): level-aware aria so
                // SR users hear "Перейти к подразделу: ..." for
                // h3 entries (the visual `pl-4` indent is
                // invisible to AT). Visible chrome unchanged.
                aria-label={tocEntryAria({
                  text: e.text,
                  level: e.level,
                  lang: langSafe,
                })}
                className="block w-full truncate text-left text-slate-700 hover:text-indigo-700 hover:underline focus:outline-none focus:underline"
              >
                {e.text}
              </button>
            </li>
          ))}
        </ol>
      )}
    </nav>
  );
}

export default AnchoredToc;
