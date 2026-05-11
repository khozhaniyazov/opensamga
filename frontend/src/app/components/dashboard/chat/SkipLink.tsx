/**
 * s33 (H6, 2026-04-28) — skip-link from /dashboard/chat page top to
 * the composer textarea.
 *
 * Why we need it: keyboard-only users (and SR users when not in
 * browse mode) hit ChatPage and have to Tab through every nav
 * item, the lang switcher, the mobile hamburger, the rail toggle,
 * the search input, every visible thread row, the kebab menus,
 * back to the transcript, then finally to the composer. That's
 * 30-50 Tabs to do the page's primary action: type a message.
 *
 * Behaviour:
 *   - The link is visually hidden by default (clip-path tiny box),
 *     and only becomes visible on focus. Focus comes from
 *     Tab-from-document-start, so the FIRST Tab on the page reveals
 *     it; pressing Enter/Space jumps focus to the composer.
 *   - target-id is stable (`chat-composer-textarea`), set by
 *     ChatComposer.
 *   - Activates via click + Enter (the native anchor behaviour),
 *     PLUS we explicitly call .focus() to ensure focus actually
 *     lands on the textarea (Chrome/Safari sometimes only scroll
 *     the target into view but leave focus on the link).
 *
 * Pure helper `composerTargetId()` exported so the composer's
 * `id=…` and the link's `href=#…` stay in sync via vitest pin.
 */

import { useLang } from "../../LanguageContext";

/** Single source of truth for the skip-link target id. */
export const COMPOSER_SKIP_TARGET_ID = "chat-composer-textarea";

export function composerTargetId(): string {
  return COMPOSER_SKIP_TARGET_ID;
}

export function SkipLink() {
  const { t, lang } = useLang();
  const label =
    t("chat.a11y.skipToComposer") ||
    (lang === "kz" ? "Хабарлама жазу өрісіне өту" : "К полю ввода");

  const handleFocus = () => {
    /* no-op; visual reveal is purely CSS-driven */
  };

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Native anchor behaviour scrolls the target into view but
    // doesn't always move focus on Chrome/Safari. Explicitly focus
    // the textarea so the next keystroke goes there.
    const node = document.getElementById(COMPOSER_SKIP_TARGET_ID);
    if (node) {
      e.preventDefault();
      (node as HTMLTextAreaElement).focus({ preventScroll: false });
    }
  };

  return (
    <a
      href={`#${COMPOSER_SKIP_TARGET_ID}`}
      onFocus={handleFocus}
      onClick={handleClick}
      // The wrapper is absolute-positioned at the top-left of the
      // chat page. The visually-hidden state uses the standard
      // sr-only clip rect; on focus we reveal a small chip with a
      // visible background so a sighted keyboard user can confirm
      // it's there.
      className="samga-skip-link"
    >
      {label}
    </a>
  );
}

export default SkipLink;
