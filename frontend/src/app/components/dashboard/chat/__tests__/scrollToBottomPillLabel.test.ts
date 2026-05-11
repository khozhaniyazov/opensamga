import { describe, it, expect } from "vitest";
import {
  scrollToBottomPillLabel,
  scrollToBottomPillNoun,
} from "../scrollToBottomPillLabel";

describe("scrollToBottomPillLabel — guard cases", () => {
  it("returns bare RU label when count is 0", () => {
    expect(scrollToBottomPillLabel(0, "ru")).toBe("К последнему сообщению");
  });
  it("returns bare KZ label when count is 0", () => {
    expect(scrollToBottomPillLabel(0, "kz")).toBe("Соңғы хабарламаға");
  });
  it("returns bare label on null/undefined/NaN", () => {
    expect(scrollToBottomPillLabel(null, "ru")).toBe("К последнему сообщению");
    expect(scrollToBottomPillLabel(undefined, "ru")).toBe(
      "К последнему сообщению",
    );
    expect(scrollToBottomPillLabel(Number.NaN, "ru")).toBe(
      "К последнему сообщению",
    );
  });
  it("returns bare label on negative inputs (no -3 prefix leak)", () => {
    expect(scrollToBottomPillLabel(-3, "ru")).toBe("К последнему сообщению");
  });
});

describe("scrollToBottomPillLabel — RU plural agreement", () => {
  it("1 → новое сообщение", () => {
    expect(scrollToBottomPillLabel(1, "ru")).toBe(
      "1 новое сообщение · К последнему сообщению",
    );
  });
  it("2/3/4 → новых сообщения", () => {
    for (const n of [2, 3, 4]) {
      expect(scrollToBottomPillLabel(n, "ru")).toBe(
        `${n} новых сообщения · К последнему сообщению`,
      );
    }
  });
  it("5..10 → новых сообщений", () => {
    for (const n of [5, 6, 7, 8, 9, 10]) {
      expect(scrollToBottomPillLabel(n, "ru")).toBe(
        `${n} новых сообщений · К последнему сообщению`,
      );
    }
  });
  it("teens 11..14 → новых сообщений (defensive against mod10===1)", () => {
    for (const n of [11, 12, 13, 14]) {
      expect(scrollToBottomPillLabel(n, "ru")).toBe(
        `${n} новых сообщений · К последнему сообщению`,
      );
    }
  });
  it("21 → новое сообщение (mod10===1, mod100!==11)", () => {
    expect(scrollToBottomPillLabel(21, "ru")).toBe(
      "21 новое сообщение · К последнему сообщению",
    );
  });
  it("22/23/24 → новых сообщения", () => {
    for (const n of [22, 23, 24]) {
      expect(scrollToBottomPillLabel(n, "ru")).toBe(
        `${n} новых сообщения · К последнему сообщению`,
      );
    }
  });
  it("99+ rendering responsibility belongs to the visible badge, not the label — label still pluralises 100 correctly", () => {
    expect(scrollToBottomPillLabel(100, "ru")).toBe(
      "100 новых сообщений · К последнему сообщению",
    );
  });
});

describe("scrollToBottomPillLabel — KZ", () => {
  it("uses single noun form 'жаңа хабарлама' regardless of count", () => {
    expect(scrollToBottomPillLabel(1, "kz")).toBe(
      "1 жаңа хабарлама · Соңғы хабарламаға",
    );
    expect(scrollToBottomPillLabel(5, "kz")).toBe(
      "5 жаңа хабарлама · Соңғы хабарламаға",
    );
  });
});

describe("scrollToBottomPillNoun — direct probe", () => {
  it("returns canonical RU forms in order", () => {
    expect(scrollToBottomPillNoun(1, "ru")).toBe("новое сообщение");
    expect(scrollToBottomPillNoun(2, "ru")).toBe("новых сообщения");
    expect(scrollToBottomPillNoun(5, "ru")).toBe("новых сообщений");
  });
  it("returns the single KZ form", () => {
    expect(scrollToBottomPillNoun(1, "kz")).toBe("жаңа хабарлама");
    expect(scrollToBottomPillNoun(7, "kz")).toBe("жаңа хабарлама");
  });
});
