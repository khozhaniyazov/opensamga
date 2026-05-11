/**
 * s33 wave 3 (C3, 2026-04-28) — collapsible code block.
 *
 * Drop-in replacement for the bare `<pre>` markdown override in
 * AssistantMessage. Self-collapses when the block is >= 30 lines.
 * Click "Show full" to expand. Copy button always visible.
 */

import { useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Copy } from "lucide-react";
import { useLang } from "../../LanguageContext";
import {
  collapseToggleLabel,
  copyButtonLabel,
  countCodeLines,
  previewLines,
  shouldCollapseCode,
} from "./codeCollapse";
import { codeBlockCopiedAnnouncement } from "./codeBlockCopiedAnnouncement";

interface Props {
  /** The raw text of the code block — extracted from the markdown
   *  AST node before the AssistantMessage handler hands the block
   *  to us. We need it as a string so countCodeLines + previewLines
   *  can do their thing. */
  rawCode: string;
  /** The original children (typically a single <code> node) — what
   *  AssistantMessage's markdown override would have rendered into
   *  <pre>. We render this when expanded so syntax highlighting
   *  classes survive. */
  children: React.ReactNode;
  /** Forwarded HTML attrs from the markdown override. */
  preProps?: Record<string, unknown>;
}

export function CodeBlock({ rawCode, children, preProps }: Props) {
  const { lang } = useLang();
  const langSafe = (lang === "kz" ? "kz" : "ru") as "ru" | "kz";

  const totalLines = useMemo(() => countCodeLines(rawCode), [rawCode]);
  const collapsible = useMemo(() => shouldCollapseCode(rawCode), [rawCode]);
  const preview = useMemo(() => previewLines(rawCode), [rawCode]);

  const [expanded, setExpanded] = useState<boolean>(!collapsible);
  const [copied, setCopied] = useState<boolean>(false);
  const copyTimer = useRef<number | null>(null);

  const handleCopy = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(rawCode);
      } else {
        // Fallback: textarea + execCommand. Older Safari + private
        // mode sometimes lack navigator.clipboard.
        const ta = document.createElement("textarea");
        ta.value = rawCode;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* silent — user can still hand-copy from the rendered text */
    }
  };

  const toggleLabel = collapseToggleLabel({
    expanded,
    totalLines,
    lang: langSafe,
  });
  const copyLabel = copyButtonLabel({ copied, lang: langSafe });

  // s35 wave 22a (2026-04-28): SR-only live-region announcement
  // when copy succeeds. Mirrors wave-19a MessageActions pattern —
  // visible Copy → Check chip is sighted-only feedback; this cell
  // closes the gap for AT users who fired the action and tabbed
  // away. We emit the count-aware string only while `copied` is
  // true (the 1.8s confirmation window) and clear it on collapse
  // back to <Copy> so the same line isn't re-announced on a
  // second copy of the same block.
  const copiedAnnounce = copied
    ? codeBlockCopiedAnnouncement({ lines: totalLines, lang: langSafe })
    : "";

  return (
    <div className="my-2 overflow-hidden rounded-xl bg-zinc-950 text-zinc-100">
      {/* Header strip — copy + (optional) collapse toggle */}
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-3 py-1.5">
        <span
          className="font-mono text-zinc-500"
          style={{ fontSize: 10.5, letterSpacing: "0.04em" }}
        >
          {totalLines === 1 ? "1 line" : `${totalLines} lines`}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCopy}
            aria-label={copyLabel}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-300"
            style={{ fontSize: 11, fontWeight: 600 }}
          >
            {copied ? (
              <Check size={11} className="samga-anim-copy-success" />
            ) : (
              <Copy size={11} />
            )}
            <span>{copyLabel}</span>
          </button>
          {collapsible ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-label={toggleLabel}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-300"
              style={{ fontSize: 11, fontWeight: 600 }}
            >
              {/* s35 wave 35a (2026-04-28): single chevron + CSS rotation. */}
              <ChevronRight size={11} className="samga-anim-chevron-target" />
              <span>{toggleLabel}</span>
            </button>
          ) : null}
        </div>
      </div>
      {/* Body */}
      {expanded ? (
        <pre
          className="overflow-x-auto px-3 py-3 text-[12px] leading-6"
          {...preProps}
        >
          {children}
        </pre>
      ) : (
        <div className="relative">
          <pre
            className="overflow-x-auto px-3 py-3 text-[12px] leading-6"
            aria-hidden="false"
            {...preProps}
          >
            <code>{preview + "\n"}</code>
          </pre>
          {/* Fade gradient hinting "more below" */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10"
            style={{
              background:
                "linear-gradient(to bottom, rgba(9,9,11,0) 0%, rgba(9,9,11,0.85) 70%, rgba(9,9,11,1) 100%)",
            }}
          />
        </div>
      )}
      {/* s35 wave 22a (2026-04-28): SR-only live-region for the
          copy confirmation. Sibling of the body so the announce
          fires the moment `copied` flips to true. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copiedAnnounce}
      </span>
    </div>
  );
}

export default CodeBlock;
