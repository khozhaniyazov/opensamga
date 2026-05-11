import { describe, it, expect } from "vitest";
import { tocEntryAria, tocToggleAria } from "../anchoredTocAria";

describe("tocToggleAria (s35 wave 23b)", () => {
  it("RU open + 4 entries → 'Скрыть содержание, 4 раздела' (paucal)", () => {
    expect(tocToggleAria({ open: true, count: 4, lang: "ru" })).toBe(
      "Скрыть содержание, 4 раздела",
    );
  });

  it("RU open + 1 entry → singular 'раздел'", () => {
    expect(tocToggleAria({ open: true, count: 1, lang: "ru" })).toBe(
      "Скрыть содержание, 1 раздел",
    );
  });

  it("RU open + 11 entries → genitive plural 'разделов' (teen)", () => {
    expect(tocToggleAria({ open: true, count: 11, lang: "ru" })).toBe(
      "Скрыть содержание, 11 разделов",
    );
  });

  it("RU open + 21 entries → singular per units rule", () => {
    expect(tocToggleAria({ open: true, count: 21, lang: "ru" })).toBe(
      "Скрыть содержание, 21 раздел",
    );
  });

  it("RU closed + 1 entry → 'Показать содержание, 1 раздел'", () => {
    expect(tocToggleAria({ open: false, count: 1, lang: "ru" })).toBe(
      "Показать содержание, 1 раздел",
    );
  });

  it("RU closed + 5 entries → genitive plural", () => {
    expect(tocToggleAria({ open: false, count: 5, lang: "ru" })).toBe(
      "Показать содержание, 5 разделов",
    );
  });

  it("KZ open + 4 entries → 'Мазмұнды жасыру, 4 бөлім' (uninflected)", () => {
    expect(tocToggleAria({ open: true, count: 4, lang: "kz" })).toBe(
      "Мазмұнды жасыру, 4 бөлім",
    );
  });

  it("KZ closed + 1 entry → 'Мазмұнды ашу, 1 бөлім'", () => {
    expect(tocToggleAria({ open: false, count: 1, lang: "kz" })).toBe(
      "Мазмұнды ашу, 1 бөлім",
    );
  });

  it("count=0 → bare verb (no count appended) RU", () => {
    expect(tocToggleAria({ open: true, count: 0, lang: "ru" })).toBe(
      "Скрыть содержание",
    );
  });

  it("count=0 → bare verb KZ", () => {
    expect(tocToggleAria({ open: false, count: 0, lang: "kz" })).toBe(
      "Мазмұнды ашу",
    );
  });

  it("count null/NaN/negative coerced to 0 → bare verb", () => {
    expect(tocToggleAria({ open: true, count: null, lang: "ru" })).toBe(
      "Скрыть содержание",
    );
    expect(tocToggleAria({ open: true, count: Number.NaN, lang: "ru" })).toBe(
      "Скрыть содержание",
    );
    expect(tocToggleAria({ open: true, count: -3, lang: "ru" })).toBe(
      "Скрыть содержание",
    );
  });

  it("count float floored", () => {
    expect(tocToggleAria({ open: true, count: 2.9, lang: "ru" })).toBe(
      "Скрыть содержание, 2 раздела",
    );
  });

  it("unknown lang → RU fallback", () => {
    expect(
      // @ts-expect-error — runtime guard
      tocToggleAria({ open: true, count: 1, lang: "en" }),
    ).toBe(tocToggleAria({ open: true, count: 1, lang: "ru" }));
  });

  it("RU and KZ outputs differ", () => {
    expect(tocToggleAria({ open: true, count: 4, lang: "ru" })).not.toBe(
      tocToggleAria({ open: true, count: 4, lang: "kz" }),
    );
  });
});

describe("tocEntryAria (s35 wave 23b)", () => {
  it("RU level 2 → 'Перейти к разделу: ...'", () => {
    expect(tocEntryAria({ text: "Введение", level: 2, lang: "ru" })).toBe(
      "Перейти к разделу: Введение",
    );
  });

  it("RU level 3 → 'Перейти к подразделу: ...'", () => {
    expect(tocEntryAria({ text: "Доказательство", level: 3, lang: "ru" })).toBe(
      "Перейти к подразделу: Доказательство",
    );
  });

  it("KZ level 2 → 'Бөлімге өту: ...'", () => {
    expect(tocEntryAria({ text: "Кіріспе", level: 2, lang: "kz" })).toBe(
      "Бөлімге өту: Кіріспе",
    );
  });

  it("KZ level 3 → 'Ішкі бөлімге өту: ...'", () => {
    expect(tocEntryAria({ text: "Дәлелдеу", level: 3, lang: "kz" })).toBe(
      "Ішкі бөлімге өту: Дәлелдеу",
    );
  });

  it("level outside {2,3} defaults to 2", () => {
    expect(tocEntryAria({ text: "Введение", level: 4, lang: "ru" })).toBe(
      "Перейти к разделу: Введение",
    );
    expect(tocEntryAria({ text: "Введение", level: 1, lang: "ru" })).toBe(
      "Перейти к разделу: Введение",
    );
  });

  it("null text → RU fallback '(без названия)'", () => {
    expect(tocEntryAria({ text: null, level: 2, lang: "ru" })).toBe(
      "Перейти к разделу: (без названия)",
    );
  });

  it("undefined text → KZ fallback '(атаусыз)'", () => {
    expect(tocEntryAria({ text: undefined, level: 2, lang: "kz" })).toBe(
      "Бөлімге өту: (атаусыз)",
    );
  });

  it("empty/whitespace text → fallback", () => {
    expect(tocEntryAria({ text: "", level: 2, lang: "ru" })).toBe(
      "Перейти к разделу: (без названия)",
    );
    expect(tocEntryAria({ text: "   \t  ", level: 2, lang: "ru" })).toBe(
      "Перейти к разделу: (без названия)",
    );
  });

  it("text trimmed", () => {
    expect(tocEntryAria({ text: "  Введение  ", level: 2, lang: "ru" })).toBe(
      "Перейти к разделу: Введение",
    );
  });

  it("unknown lang → RU fallback", () => {
    expect(
      // @ts-expect-error — runtime guard
      tocEntryAria({ text: "X", level: 2, lang: "en" }),
    ).toBe(tocEntryAria({ text: "X", level: 2, lang: "ru" }));
  });

  it("level 2 and level 3 strings differ in same lang", () => {
    expect(tocEntryAria({ text: "X", level: 2, lang: "ru" })).not.toBe(
      tocEntryAria({ text: "X", level: 3, lang: "ru" }),
    );
    expect(tocEntryAria({ text: "X", level: 2, lang: "kz" })).not.toBe(
      tocEntryAria({ text: "X", level: 3, lang: "kz" }),
    );
  });

  it("multiple invocations are pure (no shared state)", () => {
    const a1 = tocEntryAria({ text: "A", level: 2, lang: "ru" });
    const b = tocEntryAria({ text: "B", level: 3, lang: "kz" });
    const a2 = tocEntryAria({ text: "A", level: 2, lang: "ru" });
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });
});
