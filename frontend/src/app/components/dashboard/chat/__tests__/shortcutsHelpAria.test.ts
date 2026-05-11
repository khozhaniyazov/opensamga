import { describe, it, expect } from "vitest";
import {
  SHORTCUTS_HELP_DESCRIPTION_ID,
  shortcutsHelpDescription,
} from "../shortcutsHelpAria";

describe("shortcutsHelpDescription (s35 wave 25b)", () => {
  it("RU 0 shortcuts → bare dismiss instructions", () => {
    expect(shortcutsHelpDescription({ shortcutCount: 0, lang: "ru" })).toBe(
      "Нажмите Esc или «Закрыть», чтобы выйти.",
    );
  });

  it("RU 1 shortcut → singular noun", () => {
    expect(shortcutsHelpDescription({ shortcutCount: 1, lang: "ru" })).toBe(
      "Показано 1 сочетание клавиш. Нажмите Esc или «Закрыть», чтобы выйти.",
    );
  });

  it("RU 2 shortcuts → paucal noun", () => {
    expect(shortcutsHelpDescription({ shortcutCount: 2, lang: "ru" })).toBe(
      "Показано 2 сочетания клавиш. Нажмите Esc или «Закрыть», чтобы выйти.",
    );
  });

  it("RU 4 shortcuts → paucal", () => {
    expect(shortcutsHelpDescription({ shortcutCount: 4, lang: "ru" })).toBe(
      "Показано 4 сочетания клавиш. Нажмите Esc или «Закрыть», чтобы выйти.",
    );
  });

  it("RU 5 shortcuts → genitive plural", () => {
    expect(shortcutsHelpDescription({ shortcutCount: 5, lang: "ru" })).toBe(
      "Показано 5 сочетаний клавиш. Нажмите Esc или «Закрыть», чтобы выйти.",
    );
  });

  it("RU 11 shortcuts → teen rule → genitive plural", () => {
    expect(shortcutsHelpDescription({ shortcutCount: 11, lang: "ru" })).toBe(
      "Показано 11 сочетаний клавиш. Нажмите Esc или «Закрыть», чтобы выйти.",
    );
  });

  it("RU 21 shortcuts → singular (units rule)", () => {
    expect(shortcutsHelpDescription({ shortcutCount: 21, lang: "ru" })).toBe(
      "Показано 21 сочетание клавиш. Нажмите Esc или «Закрыть», чтобы выйти.",
    );
  });

  it("KZ 0 shortcuts → bare dismiss instructions", () => {
    expect(shortcutsHelpDescription({ shortcutCount: 0, lang: "kz" })).toBe(
      "Жабу үшін Esc немесе «Жабу» батырмасын басыңыз.",
    );
  });

  it("KZ N shortcuts → uninflected appendix", () => {
    expect(shortcutsHelpDescription({ shortcutCount: 1, lang: "kz" })).toBe(
      "1 пернетақта қысқартуы көрсетілген. Жабу үшін Esc немесе «Жабу» батырмасын басыңыз.",
    );
    expect(shortcutsHelpDescription({ shortcutCount: 5, lang: "kz" })).toBe(
      "5 пернетақта қысқартуы көрсетілген. Жабу үшін Esc немесе «Жабу» батырмасын басыңыз.",
    );
  });

  it("null/NaN/Infinity/negative/float coerced to integer count", () => {
    const baseRU = "Нажмите Esc или «Закрыть», чтобы выйти.";
    expect(shortcutsHelpDescription({ shortcutCount: null, lang: "ru" })).toBe(
      baseRU,
    );
    expect(
      shortcutsHelpDescription({ shortcutCount: undefined, lang: "ru" }),
    ).toBe(baseRU);
    expect(
      shortcutsHelpDescription({ shortcutCount: Number.NaN, lang: "ru" }),
    ).toBe(baseRU);
    expect(shortcutsHelpDescription({ shortcutCount: -3, lang: "ru" })).toBe(
      baseRU,
    );
    expect(
      shortcutsHelpDescription({
        shortcutCount: Number.POSITIVE_INFINITY,
        lang: "ru",
      }),
    ).toBe(baseRU);
    expect(shortcutsHelpDescription({ shortcutCount: 2.9, lang: "ru" })).toBe(
      "Показано 2 сочетания клавиш. Нажмите Esc или «Закрыть», чтобы выйти.",
    );
  });

  it("description always names the dismiss method (regression guard)", () => {
    for (const lang of ["ru", "kz"] as const) {
      for (const count of [0, 1, 5, 11, 21]) {
        const out = shortcutsHelpDescription({
          shortcutCount: count,
          lang,
        });
        expect(out).toMatch(/Esc/);
      }
    }
  });

  it("unknown lang → RU fallback", () => {
    expect(
      // @ts-expect-error — runtime guard
      shortcutsHelpDescription({ shortcutCount: 4, lang: "en" }),
    ).toBe(shortcutsHelpDescription({ shortcutCount: 4, lang: "ru" }));
  });

  it("DESCRIPTION_ID constant is a stable, non-empty string", () => {
    expect(SHORTCUTS_HELP_DESCRIPTION_ID).toBe("shortcuts-help-description");
  });

  it("multi-call purity", () => {
    const a1 = shortcutsHelpDescription({
      shortcutCount: 4,
      lang: "ru",
    });
    const b = shortcutsHelpDescription({
      shortcutCount: 1,
      lang: "kz",
    });
    const a2 = shortcutsHelpDescription({
      shortcutCount: 4,
      lang: "ru",
    });
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });
});
