import { describe, it, expect } from "vitest";
import {
  nextScrollPillAnnouncement,
  scrollToBottomPillAnnouncement,
} from "../scrollToBottomPillAnnouncement";

describe("scrollToBottomPillAnnouncement (s35 wave 25c)", () => {
  it("RU 0 → empty string (no announce)", () => {
    expect(scrollToBottomPillAnnouncement(0, "ru")).toBe("");
  });

  it("RU 1 → singular", () => {
    expect(scrollToBottomPillAnnouncement(1, "ru")).toBe(
      "1 новое сообщение ниже",
    );
  });

  it("RU 2 → paucal", () => {
    expect(scrollToBottomPillAnnouncement(2, "ru")).toBe(
      "2 новых сообщения ниже",
    );
  });

  it("RU 4 → paucal", () => {
    expect(scrollToBottomPillAnnouncement(4, "ru")).toBe(
      "4 новых сообщения ниже",
    );
  });

  it("RU 5 → genitive plural", () => {
    expect(scrollToBottomPillAnnouncement(5, "ru")).toBe(
      "5 новых сообщений ниже",
    );
  });

  it("RU 11 → teen → genitive plural", () => {
    expect(scrollToBottomPillAnnouncement(11, "ru")).toBe(
      "11 новых сообщений ниже",
    );
  });

  it("RU 21 → singular per units rule", () => {
    expect(scrollToBottomPillAnnouncement(21, "ru")).toBe(
      "21 новое сообщение ниже",
    );
  });

  it("KZ 0 → empty string", () => {
    expect(scrollToBottomPillAnnouncement(0, "kz")).toBe("");
  });

  it("KZ N → uninflected", () => {
    expect(scrollToBottomPillAnnouncement(1, "kz")).toBe(
      "1 жаңа хабарлама төменде",
    );
    expect(scrollToBottomPillAnnouncement(5, "kz")).toBe(
      "5 жаңа хабарлама төменде",
    );
  });

  it("null/NaN/Infinity/negative coerced to 0 → empty", () => {
    expect(scrollToBottomPillAnnouncement(null, "ru")).toBe("");
    expect(scrollToBottomPillAnnouncement(undefined, "ru")).toBe("");
    expect(scrollToBottomPillAnnouncement(Number.NaN, "ru")).toBe("");
    expect(scrollToBottomPillAnnouncement(-3, "ru")).toBe("");
    expect(scrollToBottomPillAnnouncement(Number.POSITIVE_INFINITY, "ru")).toBe(
      "",
    );
  });

  it("float coerced via floor", () => {
    expect(scrollToBottomPillAnnouncement(2.9, "ru")).toBe(
      "2 новых сообщения ниже",
    );
  });

  it("unknown lang → RU fallback", () => {
    expect(
      // @ts-expect-error — runtime guard
      scrollToBottomPillAnnouncement(3, "en"),
    ).toBe(scrollToBottomPillAnnouncement(3, "ru"));
  });
});

describe("nextScrollPillAnnouncement (s35 wave 25c rising-edge gate)", () => {
  it("returns null when count is unchanged", () => {
    expect(
      nextScrollPillAnnouncement({
        prevCount: 3,
        nextCount: 3,
        lang: "ru",
      }),
    ).toBeNull();
  });

  it("returns null when count drops (e.g. user scrolls back down)", () => {
    expect(
      nextScrollPillAnnouncement({
        prevCount: 5,
        nextCount: 0,
        lang: "ru",
      }),
    ).toBeNull();
    expect(
      nextScrollPillAnnouncement({
        prevCount: 5,
        nextCount: 3,
        lang: "ru",
      }),
    ).toBeNull();
  });

  it("returns the announce when count rises 0→1", () => {
    expect(
      nextScrollPillAnnouncement({
        prevCount: 0,
        nextCount: 1,
        lang: "ru",
      }),
    ).toBe("1 новое сообщение ниже");
  });

  it("returns the announce when count rises 3→5", () => {
    expect(
      nextScrollPillAnnouncement({
        prevCount: 3,
        nextCount: 5,
        lang: "ru",
      }),
    ).toBe("5 новых сообщений ниже");
  });

  it("KZ rising edge speaks uninflected form", () => {
    expect(
      nextScrollPillAnnouncement({
        prevCount: 0,
        nextCount: 2,
        lang: "kz",
      }),
    ).toBe("2 жаңа хабарлама төменде");
  });

  it("null/NaN inputs coerce as 0 — null when both 0", () => {
    expect(
      nextScrollPillAnnouncement({
        prevCount: Number.NaN,
        nextCount: null as unknown as number,
        lang: "ru",
      }),
    ).toBeNull();
  });

  it("null prev + valid next → rising edge", () => {
    expect(
      nextScrollPillAnnouncement({
        prevCount: null as unknown as number,
        nextCount: 3,
        lang: "ru",
      }),
    ).toBe("3 новых сообщения ниже");
  });

  it("multi-call purity", () => {
    const a1 = nextScrollPillAnnouncement({
      prevCount: 0,
      nextCount: 5,
      lang: "ru",
    });
    nextScrollPillAnnouncement({ prevCount: 0, nextCount: 1, lang: "kz" });
    const a2 = nextScrollPillAnnouncement({
      prevCount: 0,
      nextCount: 5,
      lang: "ru",
    });
    expect(a1).toBe(a2);
  });
});
