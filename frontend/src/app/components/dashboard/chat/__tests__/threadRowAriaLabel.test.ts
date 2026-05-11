import { describe, it, expect } from "vitest";
import {
  threadRowAriaLabel,
  threadRowMessageCountPhrase,
} from "../threadRowAriaLabel";

const NOW = new Date("2026-04-28T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe("threadRowMessageCountPhrase", () => {
  it("RU plural agreement: 1 → 'сообщение'", () => {
    expect(threadRowMessageCountPhrase(1, "ru")).toBe("1 сообщение");
  });
  it("RU plural agreement: 2-4 → 'сообщения'", () => {
    expect(threadRowMessageCountPhrase(3, "ru")).toBe("3 сообщения");
  });
  it("RU plural agreement: 5-20 + teens → 'сообщений'", () => {
    expect(threadRowMessageCountPhrase(11, "ru")).toBe("11 сообщений");
    expect(threadRowMessageCountPhrase(12, "ru")).toBe("12 сообщений");
    expect(threadRowMessageCountPhrase(20, "ru")).toBe("20 сообщений");
  });
  it("RU plural agreement: 21 → 'сообщение' (mod10===1, mod100!==11)", () => {
    expect(threadRowMessageCountPhrase(21, "ru")).toBe("21 сообщение");
  });
  it("KZ uses single form regardless of count", () => {
    expect(threadRowMessageCountPhrase(1, "kz")).toBe("1 хабарлама");
    expect(threadRowMessageCountPhrase(7, "kz")).toBe("7 хабарлама");
    expect(threadRowMessageCountPhrase(11, "kz")).toBe("11 хабарлама");
  });
  it("Negative / NaN coerced to 0 ('0 сообщений' / '0 хабарлама')", () => {
    expect(threadRowMessageCountPhrase(-3, "ru")).toBe("0 сообщений");
    expect(threadRowMessageCountPhrase(Number.NaN, "kz")).toBe("0 хабарлама");
  });
});

describe("threadRowAriaLabel — title fallbacks", () => {
  it("uses 'Без названия' when title is null/empty/whitespace (RU)", () => {
    const out = threadRowAriaLabel({
      title: null,
      messageCount: 0,
      updatedAt: null,
      lang: "ru",
      now: NOW,
    });
    expect(out).toBe("Без названия");
  });
  it("uses 'Атаусыз' on KZ", () => {
    const out = threadRowAriaLabel({
      title: "   ",
      messageCount: 0,
      updatedAt: null,
      lang: "kz",
      now: NOW,
    });
    expect(out).toBe("Атаусыз");
  });
  it("trims surrounding whitespace from a real title", () => {
    const out = threadRowAriaLabel({
      title: "  Объясни ошибку  ",
      messageCount: 0,
      updatedAt: null,
      lang: "ru",
      now: NOW,
    });
    expect(out).toBe("Объясни ошибку");
  });
});

describe("threadRowAriaLabel — composition", () => {
  it("title + message count + relative time (RU)", () => {
    const out = threadRowAriaLabel({
      title: "Объясни ошибку",
      messageCount: 12,
      updatedAt: ago(3 * 24 * 60 * 60 * 1000),
      lang: "ru",
      now: NOW,
    });
    expect(out).toBe("Объясни ошибку (12 сообщений · 3 дня назад)");
  });
  it("title + message count + relative time (KZ)", () => {
    const out = threadRowAriaLabel({
      title: "Менің тарихым",
      messageCount: 4,
      updatedAt: ago(2 * 60 * 60 * 1000),
      lang: "kz",
      now: NOW,
    });
    expect(out).toBe("Менің тарихым (4 хабарлама · 2 сағат бұрын)");
  });
  it("appends ' · закреплено' when pinned", () => {
    const out = threadRowAriaLabel({
      title: "Срочное",
      messageCount: 2,
      updatedAt: ago(60 * 60 * 1000),
      pinned: true,
      lang: "ru",
      now: NOW,
    });
    expect(out).toBe("Срочное (2 сообщения · 1 час назад · закреплено)");
  });
  it("appends ' · в архиве' when archived", () => {
    const out = threadRowAriaLabel({
      title: "Старое",
      messageCount: 5,
      updatedAt: ago(40 * 24 * 60 * 60 * 1000),
      archived: true,
      lang: "ru",
      now: NOW,
    });
    expect(out).toMatch(/Старое \(5 сообщений · 1 месяц назад · в архиве\)/);
  });
  it("KZ archived suffix is 'мұрағатта'", () => {
    const out = threadRowAriaLabel({
      title: "Ескі",
      messageCount: 3,
      updatedAt: ago(40 * 24 * 60 * 60 * 1000),
      archived: true,
      lang: "kz",
      now: NOW,
    });
    expect(out).toMatch(/мұрағатта/);
  });
  it("renders both pinned + archived if both flagged (defensive)", () => {
    const out = threadRowAriaLabel({
      title: "Edge",
      messageCount: 1,
      updatedAt: ago(60 * 1000),
      pinned: true,
      archived: true,
      lang: "ru",
      now: NOW,
    });
    expect(out).toContain("закреплено");
    expect(out).toContain("в архиве");
  });
  it("omits relative time when updated_at is null/unparseable but keeps message count", () => {
    const out = threadRowAriaLabel({
      title: "No time",
      messageCount: 7,
      updatedAt: "garbage",
      lang: "ru",
      now: NOW,
    });
    expect(out).toBe("No time (7 сообщений)");
  });
  it("falls back to title alone when count is 0 and updated_at unparseable", () => {
    const out = threadRowAriaLabel({
      title: "Nothing",
      messageCount: 0,
      updatedAt: null,
      lang: "ru",
      now: NOW,
    });
    expect(out).toBe("Nothing");
  });
  it("'just now' bucket renders without unit ('только что' / 'жаңа ғана')", () => {
    const ru = threadRowAriaLabel({
      title: "T",
      messageCount: 1,
      updatedAt: ago(20 * 1000),
      lang: "ru",
      now: NOW,
    });
    expect(ru).toBe("T (1 сообщение · только что)");
    const kz = threadRowAriaLabel({
      title: "T",
      messageCount: 1,
      updatedAt: ago(20 * 1000),
      lang: "kz",
      now: NOW,
    });
    expect(kz).toBe("T (1 хабарлама · жаңа ғана)");
  });
});
