import { describe, it, expect } from "vitest";
import { codeBlockCopiedAnnouncement } from "../codeBlockCopiedAnnouncement";

describe("codeBlockCopiedAnnouncement (s35 wave 22a)", () => {
  it("RU 1 line → 'Скопирована 1 строка кода' (singular)", () => {
    expect(codeBlockCopiedAnnouncement({ lines: 1, lang: "ru" })).toBe(
      "Скопирована 1 строка кода",
    );
  });

  it("RU 2 lines → 'Скопировано 2 строки кода' (paucal)", () => {
    expect(codeBlockCopiedAnnouncement({ lines: 2, lang: "ru" })).toBe(
      "Скопировано 2 строки кода",
    );
  });

  it("RU 4 lines → 'Скопировано 4 строки кода' (paucal)", () => {
    expect(codeBlockCopiedAnnouncement({ lines: 4, lang: "ru" })).toBe(
      "Скопировано 4 строки кода",
    );
  });

  it("RU 5 lines → 'Скопировано 5 строк кода' (genitive plural)", () => {
    expect(codeBlockCopiedAnnouncement({ lines: 5, lang: "ru" })).toBe(
      "Скопировано 5 строк кода",
    );
  });

  it("RU 11 lines → 'Скопировано 11 строк кода' (teen → genitive plural)", () => {
    expect(codeBlockCopiedAnnouncement({ lines: 11, lang: "ru" })).toBe(
      "Скопировано 11 строк кода",
    );
  });

  it("RU 14 lines → 'Скопировано 14 строк кода' (teen → genitive plural)", () => {
    expect(codeBlockCopiedAnnouncement({ lines: 14, lang: "ru" })).toBe(
      "Скопировано 14 строк кода",
    );
  });

  it("RU 21 lines → 'Скопирована 21 строка кода' (units rule)", () => {
    expect(codeBlockCopiedAnnouncement({ lines: 21, lang: "ru" })).toBe(
      "Скопирована 21 строка кода",
    );
  });

  it("RU 22 lines → 'Скопировано 22 строки кода' (paucal)", () => {
    expect(codeBlockCopiedAnnouncement({ lines: 22, lang: "ru" })).toBe(
      "Скопировано 22 строки кода",
    );
  });

  it("RU 100 lines → 'Скопировано 100 строк кода' (genitive plural)", () => {
    expect(codeBlockCopiedAnnouncement({ lines: 100, lang: "ru" })).toBe(
      "Скопировано 100 строк кода",
    );
  });

  it("KZ 1 line → '1 жол код көшірілді' (uninflected)", () => {
    expect(codeBlockCopiedAnnouncement({ lines: 1, lang: "kz" })).toBe(
      "1 жол код көшірілді",
    );
  });

  it("KZ 14 lines → '14 жол код көшірілді' (uninflected)", () => {
    expect(codeBlockCopiedAnnouncement({ lines: 14, lang: "kz" })).toBe(
      "14 жол код көшірілді",
    );
  });

  it("RU lines=0 → bare 'Код скопирован'", () => {
    expect(codeBlockCopiedAnnouncement({ lines: 0, lang: "ru" })).toBe(
      "Код скопирован",
    );
  });

  it("KZ lines=0 → bare 'Код көшірілді'", () => {
    expect(codeBlockCopiedAnnouncement({ lines: 0, lang: "kz" })).toBe(
      "Код көшірілді",
    );
  });

  it("RU lines null → bare confirmation", () => {
    expect(codeBlockCopiedAnnouncement({ lines: null, lang: "ru" })).toBe(
      "Код скопирован",
    );
  });

  it("RU lines undefined → bare confirmation", () => {
    expect(codeBlockCopiedAnnouncement({ lines: undefined, lang: "ru" })).toBe(
      "Код скопирован",
    );
  });

  it("RU lines NaN → bare confirmation", () => {
    expect(codeBlockCopiedAnnouncement({ lines: Number.NaN, lang: "ru" })).toBe(
      "Код скопирован",
    );
  });

  it("RU lines negative → coerced to 0 → bare confirmation", () => {
    expect(codeBlockCopiedAnnouncement({ lines: -3, lang: "ru" })).toBe(
      "Код скопирован",
    );
  });

  it("RU float lines floored to int", () => {
    expect(codeBlockCopiedAnnouncement({ lines: 3.7, lang: "ru" })).toBe(
      "Скопировано 3 строки кода",
    );
  });

  it("unknown lang → RU fallback", () => {
    expect(
      // @ts-expect-error — runtime guard
      codeBlockCopiedAnnouncement({ lines: 1, lang: "en" }),
    ).toBe("Скопирована 1 строка кода");
  });

  it("RU and KZ outputs differ for the same line count", () => {
    expect(codeBlockCopiedAnnouncement({ lines: 5, lang: "ru" })).not.toBe(
      codeBlockCopiedAnnouncement({ lines: 5, lang: "kz" }),
    );
  });

  it("multiple invocations are pure (no shared state)", () => {
    const a1 = codeBlockCopiedAnnouncement({ lines: 7, lang: "ru" });
    const b = codeBlockCopiedAnnouncement({ lines: 1, lang: "kz" });
    const a2 = codeBlockCopiedAnnouncement({ lines: 7, lang: "ru" });
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });
});
