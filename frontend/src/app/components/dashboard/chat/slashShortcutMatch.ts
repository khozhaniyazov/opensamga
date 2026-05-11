/**
 * s35 wave 17a (2026-04-28) — pure helper detecting the
 * "open slash menu" keyboard shortcut.
 *
 * Today the only way to open the slash-command popover is to type a
 * literal `/` as the first character of the composer. ChatGPT,
 * Codex, and Claude all also wire **Cmd/Ctrl + /** as a recall
 * shortcut so power users don't have to clear the textarea first.
 * This wave introduces the same affordance.
 *
 * The helper is **pure** — it doesn't synthesise an event, doesn't
 * touch the DOM, doesn't open the menu. The component layer
 * (`ChatComposer`) calls `matchSlashShortcut(e)` in its `onKeyDown`
 * and on a positive match: prepends `/` to the input, moves the
 * caret, and lets `shouldShowSlashMenu` open the popover on the
 * next render — exactly the same code path as the user typing
 * `/` themselves. No new menu-state plumbing required.
 *
 * Cross-platform key matrix (intentionally narrow — no aliasing
 * the slash to Alt/AltGr layouts that already produce `/` natively):
 *
 *   - macOS / iPad: ⌘ + /  (event.metaKey + e.key === "/")
 *   - Win / Linux : Ctrl + /  (event.ctrlKey + e.key === "/")
 *
 * Shift + Cmd/Ctrl + / is rejected — that's the browser's
 * keyboard-shortcut overlay on Chromium and we don't want to
 * fight the OS-level binding. Repeat events (held key) are also
 * rejected so the helper fires once per discrete press.
 *
 * On a Russian/JCUKEN keyboard the `/` glyph is on the same
 * physical key as `.` (Shift+7 → `?`, Shift+. → `,`, etc.). We
 * therefore match against `e.key` *and* the legacy `e.code` so a
 * RU layout user gets the same affordance without having to switch
 * to EN. `code === "Slash"` is the layout-independent identifier
 * for the physical key.
 */

export interface SlashShortcutEventLike {
  /** Key value as reported by `KeyboardEvent.key`. */
  key: string;
  /** Layout-independent key code, e.g. "Slash" / "KeyE". */
  code?: string;
  /** macOS Command key. */
  metaKey: boolean;
  /** Windows/Linux Control key. */
  ctrlKey: boolean;
  /** Shift modifier — when true, the shortcut is ignored
   *  (Shift+Ctrl+/ is reserved by the browser on Chromium). */
  shiftKey: boolean;
  /** Alt / Option modifier — when true, ignored (avoids stealing
   *  AltGr-mapped slash on some EU keyboards). */
  altKey: boolean;
  /** True when the key is being repeated (held). We fire once per
   *  press, so repeats are a no-op. */
  repeat?: boolean;
}

/** Pure predicate — returns true iff the event looks like a
 *  recall shortcut press the composer should swallow. */
export function matchSlashShortcut(e: SlashShortcutEventLike): boolean {
  if (e.repeat) return false;
  if (e.shiftKey || e.altKey) return false;
  // Exactly one of Cmd / Ctrl must be held — never both, since
  // that's typically a chorded OS-level shortcut on Linux WMs.
  const usingMeta = e.metaKey && !e.ctrlKey;
  const usingCtrl = e.ctrlKey && !e.metaKey;
  if (!usingMeta && !usingCtrl) return false;
  // Match by `key` first (the canonical path on every modern
  // keyboard layout), fall back to physical `code` for layouts
  // that don't carry `/` directly (e.g. RU JCUKEN).
  if (e.key === "/") return true;
  if (typeof e.code === "string" && e.code === "Slash") return true;
  return false;
}

/** Pure helper — returns the new input value + caret position to
 *  apply when the shortcut is detected. The caller passes the
 *  textarea state as `(value, selStart)`; we prepend a literal
 *  `/` and shift the caret so the slash menu opens with an empty
 *  query and the user keeps typing the command name.
 *
 *  Idempotent against an already-leading-slash: if the value
 *  already starts with `/` we leave it alone (the menu is already
 *  open or about to be) and only return a caret reset to 1 so the
 *  cursor lands right after the slash. */
export interface SlashShortcutApply {
  value: string;
  caret: number;
}

export function applySlashShortcut(
  prevValue: string,
  prevSelStart: number,
): SlashShortcutApply {
  if (typeof prevValue === "string" && prevValue.startsWith("/")) {
    return { value: prevValue, caret: 1 };
  }
  // Insert at the front rather than at the caret because
  // `shouldShowSlashMenu` only fires on a *leading* "/". Inserting
  // mid-string would not open the menu.
  const safePrev = typeof prevValue === "string" ? prevValue : "";
  return { value: `/${safePrev}`, caret: 1 + Math.max(0, prevSelStart) };
}

/** Bilingual SR hint string — used by the keyboard-shortcuts
 *  cheat sheet (already exists at `KeyboardShortcutsModal`). The
 *  popover footer renders the visual `Ctrl + /` glyph; this is
 *  the SR-readable variant. */
export function slashShortcutAriaHint(lang: "ru" | "kz"): string {
  return lang === "kz"
    ? "Ctrl немесе ⌘ және /: пәрмендер мәзірін ашу"
    : "Ctrl или ⌘ и /: открыть меню команд";
}
