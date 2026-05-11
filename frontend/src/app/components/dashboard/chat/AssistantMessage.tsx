import { useEffect, useState } from "react";
import { useLang } from "../../LanguageContext";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { HelpCircle } from "lucide-react";
import { apiGet } from "../../../lib/api";
import {
  parseCitationSegments,
  resolveBookId,
  stripCitationDebris,
  type BookRef,
  type Citation,
} from "./citations";
import { looksLikeMathSolution, stepPrefix } from "./mathSolution";
import {
  buildExplainFurtherPrompt,
  explainFurtherLabel,
  isExplainFurtherEligible,
} from "./explainFurther";
import { CitationChip } from "./CitationChip";
import { AnchoredToc, slugifyHeading } from "./AnchoredToc";
import { CodeBlock } from "./CodeBlock";
import { chatMarkdownHeadingLevel } from "./markdownHeadingLevel";
import { markdownTableAriaLabel } from "./markdownTableAria";
import { Children, isValidElement, type ReactNode } from "react";

/** s35 wave 29a (2026-04-28): walk a markdown <table>'s React
 *  children produced by react-markdown to count its visual
 *  shape (rows × columns). The shape feeds `markdownTableAriaLabel`.
 *  Pure within the React tree — does not commit DOM, does not
 *  hold state.
 *
 *  Note: react-markdown passes already-decorated React elements
 *  to the table override, so cell children are function
 *  components (the th/td overrides), not raw "th"/"td" strings.
 *  We count any element child of a `tr` as a cell instead of
 *  trying to match the type — markdown tables only ever contain
 *  th/td as direct tr children anyway. */
function countMarkdownTableShape(children: ReactNode): {
  columnCount: number;
  rowCount: number;
} {
  let rowCount = 0;
  let columnCount = 0;
  let firstRowSeen = false;
  const visit = (node: ReactNode) => {
    Children.forEach(node, (child) => {
      if (!isValidElement(child)) return;
      const t = (child as { type?: unknown }).type;
      if (t === "tr") {
        rowCount += 1;
        if (!firstRowSeen) {
          let cellCount = 0;
          Children.forEach(
            (child as { props: { children?: ReactNode } }).props.children,
            (c) => {
              if (isValidElement(c)) cellCount += 1;
            },
          );
          columnCount = cellCount;
          firstRowSeen = true;
        }
      } else {
        visit((child as { props: { children?: ReactNode } }).props.children);
      }
    });
  };
  visit(children);
  return { columnCount, rowCount };
}

interface Props {
  text: string;
  priorUserText?: string;
  /** s33 (C5): callback fired when the user clicks "Explain
   *  further" on a paragraph. Receives the composed RU/KZ prompt
   *  ready to seed the composer. Optional — when omitted, the
   *  affordance is hidden. */
  onAskFollowUp?: (prompt: string) => void;
}

// s26 phase 5 (2026-04-27): the backend appends `*(Не найдено в
// библиотеке)*` / `*(Кітапханада табылмады)*` as a literal markdown
// italic line when `consult_library` returned 0 hits and the model
// fell back to general knowledge. Rendered raw, it looks like throw-
// away grey italics easy to miss — but it is THE signal that the
// answer is not citation-backed. Detect it, strip it from the prose,
// and surface it as a styled amber pill at the bottom of the bubble
// so the user notices.
//
// Bilingual marker; case-sensitive emoji-free since the backend writes
// it with a fixed string.
const NO_LIBRARY_RU = "*(Не найдено в библиотеке)*";
const NO_LIBRARY_KZ = "*(Кітапханада табылмады)*";

interface NoLibraryExtract {
  cleaned: string;
  match: "ru" | "kz" | null;
}

function extractNoLibraryMarker(text: string): NoLibraryExtract {
  if (!text) return { cleaned: text ?? "", match: null };
  if (text.includes(NO_LIBRARY_RU)) {
    const cleaned = text
      .split(NO_LIBRARY_RU)
      .join("")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return { cleaned, match: "ru" };
  }
  if (text.includes(NO_LIBRARY_KZ)) {
    const cleaned = text
      .split(NO_LIBRARY_KZ)
      .join("")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return { cleaned, match: "kz" };
  }
  return { cleaned: text, match: null };
}

function NoLibraryPill({ lang }: { lang: "ru" | "kz" }) {
  const label =
    lang === "kz"
      ? "Оқулықтарда табылмады — жалпы біліммен жауап"
      : "Не нашёл в учебниках — отвечаю по общим знаниям";
  return (
    <div
      role="note"
      aria-label={label}
      className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-900 samga-anim-pill"
    >
      <span aria-hidden="true">⚠️</span>
      <span>{label}</span>
    </div>
  );
}

// Module-scoped cache — fetched once per tab, reused across every chip.
let booksCache: BookRef[] | null = null;
let booksCachePromise: Promise<BookRef[]> | null = null;

// s26 phase 2 (2026-04-26 evening): bumped base prose to 15px / 1.7
// line-height with zinc-800 body for a more confident, modern read.
// Heading delta is now 3–4px (h2=18, h3=16, body=15) instead of the
// prior 1–2px so hierarchy is actually visible at a glance. Strong
// promotes to zinc-950 for contrast against the body.
// s29 (C1, 2026-04-27): flatten arbitrary react children — passed in
// by react-markdown for headings — into a plain string so we can run
// the same `slugifyHeading` over it and stamp an anchor id matching
// what AnchoredToc clicks. Defensive: tolerates null / nested arrays
// / inline code spans.
function flattenChildren(node: any): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenChildren).join("");
  if (node?.props?.children) return flattenChildren(node.props.children);
  return "";
}

// s35 wave 26c (2026-04-28): all assistant-side markdown headings
// are routed through chatMarkdownHeadingLevel so the page outline
// stays sane (only ChatPage's <h1> is top-level). `# Title` →
// <h2>, `## Sub` → <h3>, …, `###### x` → <h6>.
function makeAssistantHeading(mdLevel: number, className: string) {
  const Tag = ("h" + chatMarkdownHeadingLevel(mdLevel)) as
    | "h2"
    | "h3"
    | "h4"
    | "h5"
    | "h6";
  // The functional component name is stable, fine for React tree.
  return ({ children, ...props }: any) => {
    const id = slugifyHeading(flattenChildren(children));
    return (
      <Tag id={id || undefined} className={className} {...props}>
        {children}
      </Tag>
    );
  };
}

const markdownComponents = {
  // md `#` (level 1) → DOM <h2>, same visual as the previous H2
  // override so the bubble looks identical to a user that always
  // writes `## Section`.
  h1: makeAssistantHeading(
    1,
    "mb-2 mt-1 scroll-mt-16 text-[18px] font-semibold leading-snug tracking-[-0.005em] text-zinc-950 first:mt-0",
  ),
  h2: makeAssistantHeading(
    2,
    "mb-2 mt-1 scroll-mt-16 text-[18px] font-semibold leading-snug tracking-[-0.005em] text-zinc-950 first:mt-0",
  ),
  h3: makeAssistantHeading(
    3,
    "mb-2 mt-1 scroll-mt-16 text-[16px] font-semibold leading-snug text-zinc-900 first:mt-0",
  ),
  h4: makeAssistantHeading(
    4,
    "mb-2 mt-1 scroll-mt-16 text-[15px] font-semibold leading-snug text-zinc-900 first:mt-0",
  ),
  h5: makeAssistantHeading(
    5,
    "mb-2 mt-1 scroll-mt-16 text-[14px] font-semibold leading-snug text-zinc-700 first:mt-0",
  ),
  h6: makeAssistantHeading(
    6,
    "mb-2 mt-1 scroll-mt-16 text-[13px] font-semibold leading-snug text-zinc-600 first:mt-0",
  ),
  p: ({ children, ...props }: any) => (
    <p
      className="my-1.5 leading-[1.7] text-zinc-800 first:mt-0 last:mb-0"
      {...props}
    >
      {children}
    </p>
  ),
  ul: ({ children, ...props }: any) => (
    <ul
      className="my-2 list-disc space-y-1.5 pl-5 text-zinc-800 marker:text-zinc-400"
      {...props}
    >
      {children}
    </ul>
  ),
  ol: ({ children, ...props }: any) => (
    <ol
      className="my-2 list-decimal space-y-1.5 pl-5 text-zinc-800 marker:text-zinc-400"
      {...props}
    >
      {children}
    </ol>
  ),
  li: ({ children, ...props }: any) => (
    <li className="pl-0.5 leading-[1.7]" {...props}>
      {children}
    </li>
  ),
  strong: ({ children, ...props }: any) => (
    <strong className="font-semibold text-zinc-950" {...props}>
      {children}
    </strong>
  ),
  a: ({ children, ...props }: any) => (
    <a
      className="font-medium text-amber-700 underline decoration-amber-300 underline-offset-2 transition-colors hover:text-amber-800"
      target="_blank"
      rel="noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
  pre: ({ children, ...props }: any) => {
    // s33 wave 3 (C3, 2026-04-28): collapse long code blocks.
    // Extract the raw text from the inner <code> node so
    // countCodeLines / previewLines can decide if we fold.
    const rawCode = (() => {
      const childArray = Array.isArray(children) ? children : [children];
      for (const child of childArray) {
        if (child && typeof child === "object" && "props" in child) {
          const inner = (child as any).props?.children;
          if (typeof inner === "string") return inner;
          if (Array.isArray(inner)) {
            return inner.map((c) => (typeof c === "string" ? c : "")).join("");
          }
        }
        if (typeof child === "string") return child;
      }
      return "";
    })();
    return (
      <CodeBlock rawCode={rawCode} preProps={props}>
        {children}
      </CodeBlock>
    );
  },
  code: ({ inline, children, className, ...props }: any) =>
    inline ? (
      <code
        className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[12px] font-medium text-zinc-900"
        {...props}
      >
        {children}
      </code>
    ) : (
      <code className={className} {...props}>
        {children}
      </code>
    ),
  table: ({ children, ...props }: any) => (
    <div className="my-2 overflow-x-auto rounded-xl border border-zinc-200/90 bg-white/95 shadow-[0_1px_2px_rgba(24,24,27,0.04)]">
      <table
        className="w-full border-collapse text-left text-[13px]"
        {...props}
      >
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }: any) => (
    <thead className="bg-zinc-50/90 text-zinc-600" {...props}>
      {children}
    </thead>
  ),
  th: ({ children, ...props }: any) => (
    <th
      className="px-3 py-2.5 font-semibold first:rounded-tl-xl last:rounded-tr-xl"
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }: any) => (
    <td
      className="border-t border-zinc-100 px-3 py-2.5 align-top text-zinc-700"
      {...props}
    >
      {children}
    </td>
  ),
  blockquote: ({ children, ...props }: any) => (
    <blockquote
      className="my-2 rounded-xl border-l-2 border-amber-400 bg-amber-50/60 px-3 py-2.5 text-zinc-700"
      {...props}
    >
      {children}
    </blockquote>
  ),
  hr: (props: any) => <hr className="my-2 border-zinc-100" {...props} />,
};

async function getBooksCache(): Promise<BookRef[]> {
  if (booksCache) return booksCache;
  if (booksCachePromise) return booksCachePromise;
  booksCachePromise = (async () => {
    try {
      const data = await apiGet<BookRef[]>("/library/books");
      booksCache = Array.isArray(data) ? data : [];
      return booksCache;
    } catch {
      booksCache = [];
      return booksCache;
    } finally {
      booksCachePromise = null;
    }
  })();
  return booksCachePromise;
}

function hasCitationIntent(text?: string): boolean {
  const normalized = (text ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return false;

  return (
    /\b(source|sources|citation|citations|quote|quotes|book|books|textbook|textbooks|page|pages)\b/i.test(
      normalized,
    ) ||
    /(источник|источники|цитат|учебник|учебники|книг|страниц|ссылк|дәйексөз|дереккөз|оқулық|кітап|бет|бетте|беттен)/i.test(
      normalized,
    )
  );
}

function getBookId(citation: Citation, books: BookRef[] | null): number | null {
  return (
    citation.bookId ?? (books ? resolveBookId(citation.bookName, books) : null)
  );
}

function joinTextSegments(
  segments: ReturnType<typeof parseCitationSegments>,
): string {
  const textOnly = segments
    .filter((segment) => segment.kind === "text")
    .map((segment) => segment.text)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return textOnly || "...";
}

/**
 * Render an assistant message as a sequence of markdown blocks with inline
 * clickable citation chips spliced in at the positions where the `📚 …` marker
 * appeared in the stream.
 */
export function AssistantMessage({
  text: rawText,
  priorUserText,
  onAskFollowUp,
}: Props) {
  // F-10: scrub trailing citation debris (`– 72*`) that the LLM
  // sometimes leaves when it half-emits a citation marker.
  const debrisStripped = stripCitationDebris(rawText);
  // s26 phase 5: pull the "*(Не найдено в библиотеке)*" / KZ marker
  // out of the prose so it can be promoted to the styled pill below.
  // If the marker is absent this is a no-op (cleaned === text).
  const { cleaned: text, match: noLibraryLang } =
    extractNoLibraryMarker(debrisStripped);
  const [books, setBooks] = useState<BookRef[] | null>(booksCache);
  const { lang } = useLang();
  const segments = parseCitationSegments(text);
  const hasCitation = segments.some((segment) => segment.kind === "citation");
  const promoteCitations = hasCitationIntent(priorUserText);
  // s32 (C4, 2026-04-27): step-numbering on math-solution lists.
  // Detection runs over the raw text (cheaper than walking the
  // markdown AST) — wrapping div gets a data attr the CSS picks up
  // to inject "Шаг N:" / "Қадам N:" labels.
  const isMathSolution = looksLikeMathSolution(text);
  const mathSolutionPrefix = isMathSolution ? stepPrefix(lang) : null;

  useEffect(() => {
    if (!hasCitation || !promoteCitations) return;
    if (books !== null) return;
    let mounted = true;
    void getBooksCache().then((b) => {
      if (mounted) setBooks(b);
    });
    return () => {
      mounted = false;
    };
  }, [books, hasCitation, promoteCitations]);

  // s26 phase 2: prose root bumped to 15px so the assistant feels
  // confident, not ant-sized. zinc-800 body, headings hit zinc-900/950.
  // s35 wave 33b (2026-04-28): modern entrance animation — slide-up
  // + fade on first paint. Gated via the `samga-anim-msg-enter`
  // class which the `prefers-reduced-motion` rule in styles/index.css
  // neutralises for users who request reduced motion. We add the
  // class unconditionally because (a) it's a `both` animation (final
  // state = static), so re-renders don't re-trigger after the first
  // paint, and (b) the OS-level CSS gate is sufficient — no need to
  // route through useReducedMotion() in the assistant render hot
  // path.
  const proseClass =
    "max-w-none text-[15px] leading-[1.7] text-zinc-800 samga-anim-msg-enter" +
    (isMathSolution ? " samga-math-solution" : "");
  const mathSolutionDataAttrs = mathSolutionPrefix
    ? { "data-step-prefix": mathSolutionPrefix }
    : {};

  // s33 (C5, 2026-04-28): per-paragraph "Explain further" button.
  // Override the `<p>` markdown component so each eligible paragraph
  // renders a hover-revealed button next to it. Eligibility check
  // runs on the flattened text. When the consumer didn't pass
  // `onAskFollowUp`, we fall back to the module-level `markdownComponents`
  // (no behaviour change).
  const langSafe = (lang === "kz" ? "kz" : "ru") as "ru" | "kz";
  const followUpLabel = explainFurtherLabel(langSafe);
  // s35 wave 29a (2026-04-28): assistant-bubble markdown tables now
  // expose a synthesized count-aware `aria-label` (computed from the
  // table's React-children shape). Wraps every table in
  // `<div role="region">` to give SR users a focusable landmark.
  const tableOverride = ({ children, ...props }: any) => {
    const { columnCount, rowCount } = countMarkdownTableShape(children);
    const label = markdownTableAriaLabel({
      columnCount,
      rowCount,
      lang: langSafe,
    });
    return (
      <div
        className="my-2 overflow-x-auto rounded-xl border border-zinc-200/90 bg-white/95 shadow-[0_1px_2px_rgba(24,24,27,0.04)]"
        role="region"
        aria-label={label}
      >
        <table
          className="w-full border-collapse text-left text-[13px]"
          aria-label={label}
          {...props}
        >
          {children}
        </table>
      </div>
    );
  };
  const componentsBase = { ...markdownComponents, table: tableOverride };
  const componentsWithFollowUp =
    onAskFollowUp != null
      ? {
          ...componentsBase,
          p: ({ children, ...props }: any) => {
            const flat = flattenChildren(children);
            const eligible = isExplainFurtherEligible(flat);
            return (
              <p
                className="group/explain my-1.5 leading-[1.7] text-zinc-800 first:mt-0 last:mb-0"
                {...props}
              >
                {children}
                {eligible ? (
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        onAskFollowUp(
                          buildExplainFurtherPrompt(flat, langSafe),
                        );
                      } catch {
                        /* noop — composer may be detached */
                      }
                    }}
                    aria-label={followUpLabel}
                    title={followUpLabel}
                    className="ml-1.5 inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 align-middle text-[10px] font-medium text-zinc-500 opacity-0 transition-opacity hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 focus:opacity-100 group-hover/explain:opacity-100 samga-anim-actions-reveal-target"
                  >
                    <HelpCircle size={10} aria-hidden />
                    <span>{followUpLabel}</span>
                  </button>
                ) : null}
              </p>
            );
          },
        }
      : componentsBase;

  // Fast path: no citations → just render markdown once.
  if (!hasCitation) {
    return (
      <div className={proseClass} {...mathSolutionDataAttrs}>
        {/* s29 (C1, 2026-04-27): auto-TOC for long answers. The
            component itself gates on heading count + word count, so
            we mount it unconditionally and let it decide. */}
        <AnchoredToc text={text} />
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={componentsWithFollowUp}
        >
          {text || "..."}
        </ReactMarkdown>
        {noLibraryLang ? <NoLibraryPill lang={noLibraryLang} /> : null}
      </div>
    );
  }

  if (!promoteCitations) {
    const joined = joinTextSegments(segments);
    return (
      <div className={proseClass} {...mathSolutionDataAttrs}>
        <AnchoredToc text={joined} />
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={componentsWithFollowUp}
        >
          {joined}
        </ReactMarkdown>
        {noLibraryLang ? <NoLibraryPill lang={noLibraryLang} /> : null}
      </div>
    );
  }

  // s26 phase 2: when the backend embedded ONE citation at the end of
  // the answer (the common shape produced by the agent loop's citation
  // validator), render the prose as a single markdown pass and append
  // the chip inline at the end of the last paragraph as a superscript.
  // This preserves paragraph flow — the prior code put each citation
  // in its own block-level wrapper, which fragmented short answers
  // into a stack of 2–4 mini-blocks. We fall back to the legacy
  // segmented render only when there are 2+ citations or the citation
  // appears mid-text.
  const citationSegments = segments.filter((s) => s.kind === "citation");
  const lastIsCitation =
    segments.length > 0 && segments[segments.length - 1]?.kind === "citation";
  const singleTrailing = citationSegments.length === 1 && lastIsCitation;

  if (singleTrailing) {
    const proseText = segments
      .filter((s) => s.kind === "text")
      .map((s) => (s as { text: string }).text)
      .join("\n\n")
      .trim();
    const cite = (
      citationSegments[0] as { kind: "citation"; citation: Citation }
    ).citation;
    const bookId = getBookId(cite, books);
    return (
      <div className={proseClass} {...mathSolutionDataAttrs}>
        <AnchoredToc text={proseText} />
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={componentsWithFollowUp}
        >
          {proseText || "..."}
        </ReactMarkdown>
        <div className="mt-1.5 inline-flex items-baseline">
          <CitationChip citation={cite} bookId={bookId} />
        </div>
        {noLibraryLang ? <NoLibraryPill lang={noLibraryLang} /> : null}
      </div>
    );
  }

  return (
    <div className={proseClass} {...mathSolutionDataAttrs}>
      {segments.map((seg, idx) => {
        if (seg.kind === "text") {
          if (!seg.text.trim()) return null;
          return (
            <ReactMarkdown
              key={`t-${idx}`}
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={componentsWithFollowUp}
            >
              {seg.text}
            </ReactMarkdown>
          );
        }

        // Phase A (s20c): prefer the backend-supplied bookId hint when
        // present; only fall back to the client-side fuzzy resolver when
        // the retrieval layer didn't give us an authoritative id.
        const bookId = getBookId(seg.citation, books);
        return (
          <span
            key={`c-${idx}`}
            className="mr-1 inline-flex items-baseline align-baseline"
          >
            <CitationChip citation={seg.citation} bookId={bookId} />
          </span>
        );
      })}
      {noLibraryLang ? <NoLibraryPill lang={noLibraryLang} /> : null}
    </div>
  );
}

export default AssistantMessage;
