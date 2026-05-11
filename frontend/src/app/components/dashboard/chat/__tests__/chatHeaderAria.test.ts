import { describe, it, expect } from "vitest";
import { chatHeaderUsageAria, clearChatButtonAria } from "../chatHeaderAria";

describe("chatHeaderUsageAria (s35 wave 23a)", () => {
  it("RU under-limit names metric + remaining", () => {
    const out = chatHeaderUsageAria({ used: 12, limit: 40, lang: "ru" });
    expect(out).toContain("Сегодня");
    expect(out).toContain("12");
    expect(out).toContain("40");
    expect(out).toContain("28"); // remaining
    expect(out).toContain("сообщений");
    expect(out).not.toMatch(/близко к лимиту|лимит достигнут/);
  });

  it("RU near-limit (≥80%, <100%) flags 'близко к лимиту'", () => {
    const out = chatHeaderUsageAria({ used: 33, limit: 40, lang: "ru" });
    expect(out).toContain("близко к лимиту");
    expect(out).toContain("осталось 7");
  });

  it("RU at-limit flags 'лимит достигнут' and omits remaining", () => {
    const out = chatHeaderUsageAria({ used: 40, limit: 40, lang: "ru" });
    expect(out).toContain("лимит достигнут");
    expect(out).not.toContain("осталось");
  });

  it("RU over-limit still flags reached, used kept in numerator", () => {
    const out = chatHeaderUsageAria({ used: 47, limit: 40, lang: "ru" });
    expect(out).toContain("47");
    expect(out).toContain("40");
    expect(out).toContain("лимит достигнут");
  });

  it("KZ under-limit names metric + remaining", () => {
    const out = chatHeaderUsageAria({ used: 12, limit: 40, lang: "kz" });
    expect(out).toContain("Бүгін");
    expect(out).toContain("12");
    expect(out).toContain("28");
    expect(out).toContain("қалды");
  });

  it("KZ near-limit flags 'лимитке жақын'", () => {
    const out = chatHeaderUsageAria({ used: 33, limit: 40, lang: "kz" });
    expect(out).toContain("лимитке жақын");
  });

  it("KZ at-limit flags 'лимитке жетті'", () => {
    const out = chatHeaderUsageAria({ used: 40, limit: 40, lang: "kz" });
    expect(out).toContain("лимитке жетті");
  });

  it("limit ≤ 0 → bare readout, no remaining/threshold cues", () => {
    const ru = chatHeaderUsageAria({ used: 12, limit: 0, lang: "ru" });
    expect(ru).toContain("12");
    expect(ru).not.toMatch(/из|остал|лимит/);
    const kz = chatHeaderUsageAria({ used: 12, limit: 0, lang: "kz" });
    expect(kz).toContain("12");
    expect(kz).not.toMatch(/қалды|лимит/);
  });

  it("negative limit treated as 0 (bare readout)", () => {
    const out = chatHeaderUsageAria({ used: 12, limit: -5, lang: "ru" });
    expect(out).not.toMatch(/из|остал|лимит/);
  });

  it("null/undefined coerced to 0", () => {
    expect(
      chatHeaderUsageAria({ used: null, limit: null, lang: "ru" }),
    ).toContain("0");
    expect(
      chatHeaderUsageAria({ used: undefined, limit: 40, lang: "ru" }),
    ).toContain("0");
  });

  it("NaN/Infinity coerced to 0", () => {
    const out = chatHeaderUsageAria({
      used: Number.NaN,
      limit: Number.POSITIVE_INFINITY,
      lang: "ru",
    });
    // Infinity → safeInt → 0, so we fall back to bare-readout form.
    expect(out).toContain("0");
  });

  it("float used floored to int", () => {
    const out = chatHeaderUsageAria({ used: 12.7, limit: 40, lang: "ru" });
    expect(out).toContain("12");
    expect(out).not.toContain("12.7");
  });

  it("80% boundary triggers near-limit", () => {
    // 32/40 = 80% exactly → near.
    const out = chatHeaderUsageAria({ used: 32, limit: 40, lang: "ru" });
    expect(out).toContain("близко к лимиту");
  });

  it("just under 80% does NOT trigger near-limit", () => {
    // 31/40 = 77.5% → no near cue.
    const out = chatHeaderUsageAria({ used: 31, limit: 40, lang: "ru" });
    expect(out).not.toContain("близко к лимиту");
  });

  it("unknown lang → RU fallback", () => {
    expect(
      // @ts-expect-error — runtime guard
      chatHeaderUsageAria({ used: 12, limit: 40, lang: "en" }),
    ).toBe(chatHeaderUsageAria({ used: 12, limit: 40, lang: "ru" }));
  });

  it("RU and KZ outputs differ for the same input", () => {
    expect(chatHeaderUsageAria({ used: 12, limit: 40, lang: "ru" })).not.toBe(
      chatHeaderUsageAria({ used: 12, limit: 40, lang: "kz" }),
    );
  });
});

describe("clearChatButtonAria (s35 wave 23a)", () => {
  it("RU names the target and that confirm is required", () => {
    const out = clearChatButtonAria("ru");
    expect(out).toContain("Очистить");
    expect(out).toMatch(/чат/i);
    expect(out).toMatch(/подтвержд/i);
  });

  it("KZ names the target and that confirm is required", () => {
    const out = clearChatButtonAria("kz");
    expect(out).toContain("тазалау");
    expect(out).toContain("растау");
  });

  it("RU and KZ outputs differ", () => {
    expect(clearChatButtonAria("ru")).not.toBe(clearChatButtonAria("kz"));
  });

  it("unknown lang → RU fallback", () => {
    // @ts-expect-error — runtime guard
    expect(clearChatButtonAria("en")).toBe(clearChatButtonAria("ru"));
  });

  it("longer than the bare verb (regression guard for refactor collapse)", () => {
    expect(clearChatButtonAria("ru").length).toBeGreaterThan("Очистить".length);
  });
});
