/**
 * s35 wave 17a — vitest pins for `matchSlashShortcut`,
 * `applySlashShortcut`, and `slashShortcutAriaHint`.
 */

import { describe, it, expect } from "vitest";
import {
  matchSlashShortcut,
  applySlashShortcut,
  slashShortcutAriaHint,
  type SlashShortcutEventLike,
} from "../slashShortcutMatch";

function ev(
  override: Partial<SlashShortcutEventLike> = {},
): SlashShortcutEventLike {
  return {
    key: "/",
    code: "Slash",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    ...override,
  };
}

describe("matchSlashShortcut", () => {
  it("Ctrl + / → match (Win/Linux)", () => {
    expect(matchSlashShortcut(ev({ ctrlKey: true }))).toBe(true);
  });

  it("Cmd + / → match (macOS)", () => {
    expect(matchSlashShortcut(ev({ metaKey: true }))).toBe(true);
  });

  it("plain / → no match (handled by typing flow)", () => {
    expect(matchSlashShortcut(ev())).toBe(false);
  });

  it("Shift + Ctrl + / → no match (browser shortcut overlay)", () => {
    expect(matchSlashShortcut(ev({ ctrlKey: true, shiftKey: true }))).toBe(
      false,
    );
  });

  it("Alt + Ctrl + / → no match (avoid AltGr layouts)", () => {
    expect(matchSlashShortcut(ev({ ctrlKey: true, altKey: true }))).toBe(false);
  });

  it("Cmd + Ctrl + / → no match (chorded OS shortcut)", () => {
    expect(matchSlashShortcut(ev({ ctrlKey: true, metaKey: true }))).toBe(
      false,
    );
  });

  it("repeat=true → no match (key is being held)", () => {
    expect(matchSlashShortcut(ev({ ctrlKey: true, repeat: true }))).toBe(false);
  });

  it("Ctrl + . → no match (wrong key)", () => {
    expect(
      matchSlashShortcut(ev({ ctrlKey: true, key: ".", code: "Period" })),
    ).toBe(false);
  });

  it("RU JCUKEN: Ctrl + key='.' but code='Slash' → match by code", () => {
    // On a RU layout pressing the physical Slash key produces "."
    // as the key value. We accept the physical code as fallback.
    expect(
      matchSlashShortcut(ev({ ctrlKey: true, key: ".", code: "Slash" })),
    ).toBe(true);
  });

  it("Cmd + key='?' (Shift considered) → no match because shift", () => {
    expect(
      matchSlashShortcut(
        ev({ metaKey: true, shiftKey: true, key: "?", code: "Slash" }),
      ),
    ).toBe(false);
  });

  it("no modifier → no match", () => {
    expect(matchSlashShortcut(ev({ key: "/", ctrlKey: false }))).toBe(false);
  });

  it("Ctrl + / with no code field present → still matches via key", () => {
    expect(
      matchSlashShortcut({
        key: "/",
        metaKey: false,
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
        repeat: false,
      }),
    ).toBe(true);
  });
});

describe("applySlashShortcut", () => {
  it("empty input → '/' + caret 1", () => {
    expect(applySlashShortcut("", 0)).toEqual({ value: "/", caret: 1 });
  });

  it("plain text 'hello' caret=2 → '/hello' + caret 3", () => {
    expect(applySlashShortcut("hello", 2)).toEqual({
      value: "/hello",
      caret: 3,
    });
  });

  it("plain text caret=0 → '/text' + caret 1", () => {
    expect(applySlashShortcut("text", 0)).toEqual({
      value: "/text",
      caret: 1,
    });
  });

  it("already starts with '/' → unchanged value, caret reset to 1", () => {
    expect(applySlashShortcut("/eli", 4)).toEqual({
      value: "/eli",
      caret: 1,
    });
  });

  it("non-string prev coerces to '' (defensive)", () => {
    // @ts-expect-error — exercising defensive runtime path
    expect(applySlashShortcut(null, 0)).toEqual({ value: "/", caret: 1 });
  });

  it("negative caret clamps to 0 → '/' + caret 1", () => {
    expect(applySlashShortcut("", -5)).toEqual({ value: "/", caret: 1 });
  });

  it("multibyte input 'привет' caret=3 → '/привет' caret 4", () => {
    expect(applySlashShortcut("привет", 3)).toEqual({
      value: "/привет",
      caret: 4,
    });
  });
});

describe("slashShortcutAriaHint", () => {
  it("RU", () => {
    expect(slashShortcutAriaHint("ru")).toBe(
      "Ctrl или ⌘ и /: открыть меню команд",
    );
  });
  it("KZ", () => {
    expect(slashShortcutAriaHint("kz")).toBe(
      "Ctrl немесе ⌘ және /: пәрмендер мәзірін ашу",
    );
  });
});
