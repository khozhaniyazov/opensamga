/**
 * Phase B (s21, 2026-04-22): per-message action row — Copy + Regenerate.
 *
 * s26 phase 2 (2026-04-26 evening): redesigned as icon-only ghost
 * buttons. The 10px text labels were sub-readable and competing with
 * the message body for attention; collapsing to 28×28 ghost buttons
 * with tooltips reclaims the vertical space and matches the visual
 * vocabulary of every modern AI chat (ChatGPT/Claude/Gemini). On
 * copy success we briefly tint the button emerald and swap the icon
 * with a scale-in animation so the action feels confirmed.
 *
 * Copy
 *  - Uses the standard Clipboard API when available; falls back to a
 *    transient `<textarea>` + document.execCommand('copy') for older
 *    browsers.
 *  - Strips the `<!-- samga-citation ... -->` hint before copying so
 *    users don't paste our bookkeeping into an essay.
 *
 * Regenerate
 *  - Only meaningful when this is the LAST assistant message AND the
 *    prior message is a user turn — otherwise the button is disabled
 *    with a tooltip explaining why.
 */

import { useEffect, useRef, useState } from "react";
import {
  Copy,
  Check,
  RefreshCw,
  ChevronDown,
  FileText,
  Hash,
} from "lucide-react";
import { useLang } from "../../LanguageContext";
import { useMessages } from "./MessagesContext";
import { markdownToPlainText } from "./utils";
import { messageCopiedAnnouncement } from "./messageCopiedAnnouncement";
import { regenerateButtonAria } from "./regenerateButtonAria";
import { copyButtonLabel, messageActionsLabels } from "./messageActionsLabels";
import type { Message } from "./types";

interface Props {
  message: Message;
  onRegenerate: (priorUserText: string) => void;
}

/** Strip the samga-citation HTML comment before copying. */
function cleanForCopy(text: string): string {
  return (text || "")
    .replace(/<!--\s*samga-citation[^>]*-->/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function MessageActions({ message, onRegenerate }: Props) {
  const { t, lang } = useLang();
  const { messages } = useMessages();
  const [copied, setCopied] = useState(false);
  // s35 wave 19a (2026-04-28): SR-only live-region announcement
  // when copy succeeds. The visible button already morphs to a
  // checkmark + emerald tint, but SR users who fire the action and
  // tab away never re-read the button. A polite live cell confirms
  // *which format* was actually copied (markdown vs plain). Empty
  // string suppresses the cell; cleared after the same 1400 ms pulse
  // as the copied state so the message doesn't linger.
  const [copyAnnounce, setCopyAnnounce] = useState("");
  // s29 (C2, 2026-04-27): the copy button now opens a tiny dropdown
  // when the user clicks the chevron next to it — choices are
  // "Copy as Markdown" and "Copy as plain text". Default click on the
  // main icon keeps prior behaviour (markdown copy with the citation
  // hint stripped) so muscle memory still works.
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const idx = messages.findIndex((m) => m.id === message.id);
  const isTail = idx === messages.length - 1;
  const priorUser =
    idx > 0 && messages[idx - 1]?.role === "user" ? messages[idx - 1] : null;
  const canRegen = isTail && priorUser !== null;

  // Close on outside click / Escape so the menu doesn't stick around.
  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  async function copyMarkdown() {
    const ok = await writeClipboard(cleanForCopy(message.text));
    setMenuOpen(false);
    if (!ok) return;
    setCopied(true);
    setCopyAnnounce(
      messageCopiedAnnouncement({
        format: "markdown",
        lang: lang === "kz" ? "kz" : "ru",
      }),
    );
    setTimeout(() => {
      setCopied(false);
      setCopyAnnounce("");
    }, 1400);
  }

  async function copyPlain() {
    const ok = await writeClipboard(
      markdownToPlainText(cleanForCopy(message.text)),
    );
    setMenuOpen(false);
    if (!ok) return;
    setCopied(true);
    setCopyAnnounce(
      messageCopiedAnnouncement({
        format: "plain",
        lang: lang === "kz" ? "kz" : "ru",
      }),
    );
    setTimeout(() => {
      setCopied(false);
      setCopyAnnounce("");
    }, 1400);
  }

  // s35 wave 24a (2026-04-28): label resolution moved to the
  // messageActionsLabels.ts pure helper so the dict-or-fallback
  // contract is centralised + testable. Closes the live bug where
  // the chevron's aria-label rendered the raw key
  // "chat.action.copy_format" because that key was never
  // registered in LanguageContext.
  const labels = messageActionsLabels(lang === "kz" ? "kz" : "ru", (k) => t(k));
  const copyLabel = copyButtonLabel(copied, labels);
  const copyMarkdownLabel = labels.copyMarkdown;
  const copyPlainLabel = labels.copyPlain;
  const moreFormatsLabel = labels.copyFormat;
  const regenLabel = labels.regenerate;
  const regenDisabledTitle = labels.regenerateDisabled;

  // Shared ghost-button recipe: 28×28 visible footprint, no border,
  // hover tints to zinc-100. Fits naturally next to the
  // FeedbackButtons row, which uses the same shape.
  //
  // s34 wave 1 (G5, 2026-04-28): tap-target expansion. The button
  // visually stays at h-7 w-7 (28px) so MessageActions stays
  // compact on desktop, but a `before:` pseudo-element extends the
  // hit area to >=44x44 (WCAG 2.5.5 AAA / Apple HIG). Pattern lifted
  // from Apple's developer docs — the larger pointer/touch surface
  // is invisible and clickable, the visual button is unchanged.
  const baseGhost =
    "relative inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-all duration-150 hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 before:absolute before:inset-[-8px] before:content-[''] before:rounded-lg";

  return (
    <div className="flex items-center gap-0.5">
      {/* s29 (C2, 2026-04-27): Copy is now a split control. Main
          icon = "Copy as Markdown" (preserves headings, lists, code
          fences). Chevron pops a small menu where the second choice
          is "Copy as plain text" — strips markdown so the result
          looks decent pasted into Word/Telegram. */}
      <div ref={wrapRef} className="relative inline-flex items-center">
        <button
          type="button"
          onClick={copyMarkdown}
          className={
            baseGhost + (copied ? " !bg-emerald-50 !text-emerald-600" : "")
          }
          aria-label={copyLabel}
          title={copyLabel}
        >
          {copied ? (
            <Check size={14} className="samga-anim-copy-success" />
          ) : (
            <Copy size={14} />
          )}
        </button>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className={
            // s34 wave 1 (G5): same hit-area pseudo-element as
            // baseGhost. Visual width stays w-5 so the split
            // control hugs the Copy button.
            "relative inline-flex h-7 w-5 items-center justify-center rounded-md text-zinc-400 transition-all duration-150 hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 before:absolute before:inset-[-8px] before:content-[''] before:rounded-lg"
          }
          aria-label={moreFormatsLabel}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title={moreFormatsLabel}
        >
          {/* s35 wave 35a (2026-04-28): chevron rotation for the
              copy-format split menu via parent button's
              aria-expanded; we use the 180° variant since the
              chevron points DOWN at rest. */}
          <ChevronDown
            size={12}
            className="samga-anim-chevron-target"
            style={{ ["--samga-chevron-rotate" as string]: "180deg" }}
          />
        </button>
        {menuOpen && (
          <div
            role="menu"
            className="absolute left-0 top-full z-20 mt-1 min-w-[200px] overflow-hidden rounded-md border border-zinc-200 bg-white py-1 text-[12px] shadow-lg samga-anim-popover"
          >
            <button
              role="menuitem"
              type="button"
              onClick={copyMarkdown}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-zinc-700 hover:bg-zinc-50"
            >
              <Hash size={12} className="text-zinc-400" aria-hidden="true" />
              <span>{copyMarkdownLabel}</span>
            </button>
            <button
              role="menuitem"
              type="button"
              onClick={copyPlain}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-zinc-700 hover:bg-zinc-50"
            >
              <FileText
                size={12}
                className="text-zinc-400"
                aria-hidden="true"
              />
              <span>{copyPlainLabel}</span>
            </button>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => canRegen && priorUser && onRegenerate(priorUser.text)}
        disabled={!canRegen}
        className={
          baseGhost +
          (!canRegen
            ? " !text-zinc-300 cursor-not-allowed hover:bg-transparent hover:!text-zinc-300"
            : "")
        }
        // s35 wave 19b (2026-04-28): state-aware aria-label —
        // disabled state folds the reason into the SR phrase
        // (sighted hover keeps the existing `regenDisabledTitle`
        // tooltip via `title=`). SR users now hear *why* the
        // button is dimmed.
        aria-label={regenerateButtonAria({
          canRegen,
          enabledLabel: regenLabel,
          lang: lang === "kz" ? "kz" : "ru",
        })}
        title={canRegen ? regenLabel : regenDisabledTitle}
      >
        <RefreshCw size={14} />
      </button>
      {/* s35 wave 19a (2026-04-28): SR-only live-region — emits a
          polite "Скопировано как Markdown / текст" announcement
          for ~1400 ms after a successful copy. The visible icon
          flip handles sighted feedback; this cell is exclusively
          for AT users. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copyAnnounce}
      </span>
    </div>
  );
}

export default MessageActions;
