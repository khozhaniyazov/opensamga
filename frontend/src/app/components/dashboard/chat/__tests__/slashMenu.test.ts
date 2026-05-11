/**
 * s31 (F1) — vitest pin tests for slashMenu pure helpers.
 */

import { describe, expect, it } from "vitest";
import {
  SLASH_COMMANDS,
  clampMenuIndex,
  filterSlashCommands,
  shouldShowSlashMenu,
  slashMenuQuery,
} from "../slashMenu";

const titleResolver = (cmd: { id: string }) => cmd.id;

describe("SLASH_COMMANDS contract", () => {
  // v3.20 adds `prep_plan` as the seventh tile-mirrored command.
  // s35 wave 40 (F6 picker, 2026-04-28): added `cite` as the 9th
  // entry, kind="picker" — opens CitePagePicker modal instead of
  // seeding the composer. Bump when adding more slash-only commands.
  it("ships nine commands (seven tile-mirrors + two slash-only)", () => {
    expect(SLASH_COMMANDS).toHaveLength(9);
  });

  it("ids match the documented set, in the documented order", () => {
    expect(SLASH_COMMANDS.map((c) => c.id)).toEqual([
      "compare_scores",
      "explain_mistake",
      "plan_week",
      "prep_plan",
      "compare_unis",
      "drill_weak",
      "summarize_pdf",
      "eli11",
      "cite",
    ]);
  });

  it("every command has matching i18n keys", () => {
    for (const cmd of SLASH_COMMANDS) {
      expect(cmd.titleKey).toBe(`chat.templates.${cmd.id}.title`);
      expect(cmd.promptKey).toBe(`chat.templates.${cmd.id}.prompt`);
    }
  });

  it("only the cite row is a picker; everything else is prompt-kind", () => {
    for (const cmd of SLASH_COMMANDS) {
      if (cmd.id === "cite") {
        expect(cmd.kind).toBe("picker");
      } else {
        // Either undefined (default = prompt) or explicitly "prompt".
        expect(cmd.kind == null || cmd.kind === "prompt").toBe(true);
      }
    }
  });
});

describe("shouldShowSlashMenu", () => {
  it("opens on a single leading slash", () => {
    expect(shouldShowSlashMenu("/")).toBe(true);
    expect(shouldShowSlashMenu("/co")).toBe(true);
    expect(shouldShowSlashMenu("/compare_scores")).toBe(true);
  });

  it("stays closed on empty input", () => {
    expect(shouldShowSlashMenu("")).toBe(false);
  });

  it("stays closed when the slash isn't first", () => {
    // "https://example" or " /foo" — both should not pop the menu.
    expect(shouldShowSlashMenu(" /compare")).toBe(false);
    expect(shouldShowSlashMenu("hello /compare")).toBe(false);
  });

  it("stays closed on a double-slash escape sequence", () => {
    // Reserve `//` so users can type a literal "//comment" without
    // the menu hijacking the keystroke.
    expect(shouldShowSlashMenu("//")).toBe(false);
    expect(shouldShowSlashMenu("//foo")).toBe(false);
  });

  it("stays closed when whitespace immediately follows the slash", () => {
    expect(shouldShowSlashMenu("/ ")).toBe(false);
    expect(shouldShowSlashMenu("/\t")).toBe(false);
  });

  it("rejects non-string defensively", () => {
    // @ts-expect-error — testing the runtime guard.
    expect(shouldShowSlashMenu(null)).toBe(false);
    // @ts-expect-error
    expect(shouldShowSlashMenu(undefined)).toBe(false);
    // @ts-expect-error
    expect(shouldShowSlashMenu(123)).toBe(false);
  });
});

describe("slashMenuQuery", () => {
  it("returns the substring after the leading slash", () => {
    expect(slashMenuQuery("/co")).toBe("co");
    expect(slashMenuQuery("/compare_scores")).toBe("compare_scores");
    expect(slashMenuQuery("/")).toBe("");
  });

  it("returns empty string when the menu shouldn't show", () => {
    expect(slashMenuQuery("")).toBe("");
    expect(slashMenuQuery("hello")).toBe("");
    expect(slashMenuQuery("//")).toBe("");
  });
});

describe("filterSlashCommands", () => {
  it("returns the full list on an empty query", () => {
    expect(filterSlashCommands("", SLASH_COMMANDS, titleResolver)).toHaveLength(
      SLASH_COMMANDS.length,
    );
  });

  it("matches against the id (case-insensitive)", () => {
    const out = filterSlashCommands("compare", SLASH_COMMANDS, titleResolver);
    // compare_scores + compare_unis
    expect(out.map((c) => c.id).sort()).toEqual(
      ["compare_scores", "compare_unis"].sort(),
    );
  });

  it("matches against the resolved title", () => {
    // Resolver here just returns the id, so use a custom resolver
    // that proves the title path is exercised.
    const titleMap: Record<string, string> = {
      compare_scores: "Мои баллы и пороги",
      explain_mistake: "Разбор ошибки",
      plan_week: "План недели",
      prep_plan: "План подготовки к ЕНТ",
      compare_unis: "Два университета",
      drill_weak: "Слабая тема",
      summarize_pdf: "Кратко учебник",
      eli11: "Объясни как 11-класснику",
    };
    const out = filterSlashCommands(
      "ошибк",
      SLASH_COMMANDS,
      (c) => titleMap[c.id] ?? c.id,
    );
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("explain_mistake");
  });

  it("matches the prep-plan command by id", () => {
    const out = filterSlashCommands("prep", SLASH_COMMANDS, titleResolver);
    expect(out.map((c) => c.id)).toEqual(["prep_plan"]);
  });

  it("returns an empty list when nothing matches", () => {
    const out = filterSlashCommands(
      "absolutely-nothing",
      SLASH_COMMANDS,
      titleResolver,
    );
    expect(out).toEqual([]);
  });

  it("returns a copy, not the source array (mutation safety)", () => {
    const out = filterSlashCommands("", SLASH_COMMANDS, titleResolver);
    expect(out).not.toBe(SLASH_COMMANDS);
  });
});

describe("clampMenuIndex", () => {
  it("returns the index unchanged when in range", () => {
    expect(clampMenuIndex(0, 6)).toBe(0);
    expect(clampMenuIndex(3, 6)).toBe(3);
  });

  it("wraps positive overflow", () => {
    expect(clampMenuIndex(6, 6)).toBe(0);
    expect(clampMenuIndex(8, 6)).toBe(2);
  });

  it("wraps negative underflow", () => {
    // Up arrow on the first row should land on the last row.
    expect(clampMenuIndex(-1, 6)).toBe(5);
    expect(clampMenuIndex(-7, 6)).toBe(5);
  });

  it("returns 0 on a non-positive length", () => {
    expect(clampMenuIndex(2, 0)).toBe(0);
    expect(clampMenuIndex(2, -3)).toBe(0);
  });

  it("returns 0 on a non-finite index", () => {
    expect(clampMenuIndex(Number.NaN, 6)).toBe(0);
    expect(clampMenuIndex(Number.POSITIVE_INFINITY, 6)).toBe(0);
  });
});
