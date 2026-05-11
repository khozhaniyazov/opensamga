/**
 * s35 wave 50 (2026-04-28) — UserMessageRow.
 *
 * Extracted from ChatTranscript so the user-bubble JSX (LaTeX-aware
 * markdown + edit-and-rewind pencil button) lives in its own
 * single-responsibility module. The transcript was 711 lines after
 * the wave 21–47 spree; pulling the user branch out drops about 60
 * lines and gives the component a unit-testable surface for the
 * pencil-button consequence-aria pin.
 *
 * The split is INTERNAL — this component is only rendered from
 * ChatTranscript; no other call site, no public API changes. The
 * transcript still owns:
 *   - the per-bubble <div role="article" aria-posinset/setsize>,
 *   - the avatar column,
 *   - the bubble chrome classes (border / gradient / shadow),
 *   - the virtualization style.
 *
 * UserMessageRow owns the inner content of the bubble: the LaTeX-
 * aware text render and the floating pencil button.
 *
 * No behavioural change. The latex regex, the markdown invocation,
 * the pencil-button onClick (`seedComposer + truncateFrom`), and the
 * consequence-aria call are byte-identical to the prior inline JSX.
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Pencil } from "lucide-react";
import {
  editUserMessageAria,
  editUserMessageTitle,
} from "./editUserMessageAria";

interface Props {
  /** Raw user-typed text. We render it as markdown only when LaTeX
   *  delimiters are present so plain prose keeps its newlines via
   *  the whitespace-preserving <p>. */
  text: string;
  /** Disables the edit pencil mid-generation — you can't rewind a
   *  thread that's still streaming. */
  isSending: boolean;
  /** How many turns will be discarded if the user clicks the pencil.
   *  Forwarded to `editUserMessageAria` so SR users hear "Edit and
   *  resend, 4 follow-ups will be discarded". */
  followUpCount: number;
  lang: "ru" | "kz";
  /** Click handler — wires up the composer-seed + truncate-from
   *  action in the parent. The component doesn't read MessagesContext
   *  itself so it stays trivially testable. */
  onEdit: () => void;
}

/** Predicate exported for vitest — does the text contain any LaTeX
 *  math delimiter that the markdown renderer should pick up?
 *
 *  Mirrors the regex inlined into ChatTranscript pre-split. The
 *  patterns are: `$$…$$` block math, `$…$` inline math (single line,
 *  no internal `$` so we don't mismatch literal currency), `\[…\]`
 *  bracket display, and `\(…\)` paren inline. */
export function userMessageHasMath(text: string): boolean {
  if (typeof text !== "string" || text.length === 0) return false;
  return /\$\$|\$[^$\n]+\$|\\\[|\\\(/.test(text);
}

export function UserMessageRow({
  text,
  isSending,
  followUpCount,
  lang,
  onEdit,
}: Props) {
  return (
    <div className="group relative">
      {userMessageHasMath(text) ? (
        <div
          className="pr-7 leading-7 [&_p]:my-1 [&_p]:leading-7 [&_.katex]:text-white"
          style={{ margin: 0 }}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
          >
            {text}
          </ReactMarkdown>
        </div>
      ) : (
        <p
          style={{ whiteSpace: "pre-wrap", margin: 0 }}
          className="pr-7 leading-7"
        >
          {text}
        </p>
      )}
      {!isSending && (
        <button
          type="button"
          onClick={onEdit}
          className="absolute -right-1 -top-1 rounded-lg p-1 text-white/45 opacity-0 transition-opacity hover:bg-white/10 hover:text-white focus:opacity-100 group-hover:opacity-100 samga-anim-actions-reveal-target"
          style={{ fontSize: 10 }}
          aria-label={editUserMessageAria({
            followUpCount: Math.max(0, followUpCount),
            lang,
          })}
          title={editUserMessageTitle(lang)}
        >
          <Pencil size={11} />
        </button>
      )}
    </div>
  );
}

export default UserMessageRow;
