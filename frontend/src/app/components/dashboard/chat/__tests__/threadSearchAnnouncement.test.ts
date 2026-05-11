/**
 * s35 wave 21a — vitest pins for `threadSearchAnnouncement`.
 */

import { describe, it, expect } from "vitest";
import { threadSearchAnnouncement } from "../threadSearchAnnouncement";

describe("threadSearchAnnouncement", () => {
  it("empty query → '' (suppress live region)", () => {
    expect(threadSearchAnnouncement({ count: 5, query: "", lang: "ru" })).toBe(
      "",
    );
  });

  it("whitespace-only query → '' (suppress)", () => {
    expect(
      threadSearchAnnouncement({ count: 5, query: "   \t  ", lang: "ru" }),
    ).toBe("");
  });

  it("null query → '' (suppress)", () => {
    expect(
      threadSearchAnnouncement({ count: 5, query: null, lang: "ru" }),
    ).toBe("");
  });

  it("undefined query → '' (suppress)", () => {
    expect(
      threadSearchAnnouncement({ count: 5, query: undefined, lang: "ru" }),
    ).toBe("");
  });

  it("RU 0 matches → 'Ничего не найдено'", () => {
    expect(
      threadSearchAnnouncement({ count: 0, query: "foo", lang: "ru" }),
    ).toBe("Ничего не найдено");
  });

  it("KZ 0 matches → 'Ештеңе табылған жоқ'", () => {
    expect(
      threadSearchAnnouncement({ count: 0, query: "foo", lang: "kz" }),
    ).toBe("Ештеңе табылған жоқ");
  });

  it("RU 1 match → '1 чат найден' (singular)", () => {
    expect(
      threadSearchAnnouncement({ count: 1, query: "foo", lang: "ru" }),
    ).toBe("1 чат найден");
  });

  it("RU 2 matches → '2 чата найдено' (paucal)", () => {
    expect(
      threadSearchAnnouncement({ count: 2, query: "foo", lang: "ru" }),
    ).toBe("2 чата найдено");
  });

  it("RU 4 matches → '4 чата найдено' (paucal)", () => {
    expect(
      threadSearchAnnouncement({ count: 4, query: "foo", lang: "ru" }),
    ).toBe("4 чата найдено");
  });

  it("RU 5 matches → '5 чатов найдено' (genitive plural)", () => {
    expect(
      threadSearchAnnouncement({ count: 5, query: "foo", lang: "ru" }),
    ).toBe("5 чатов найдено");
  });

  it("RU 11 matches → '11 чатов найдено' (teen → genitive plural)", () => {
    expect(
      threadSearchAnnouncement({ count: 11, query: "foo", lang: "ru" }),
    ).toBe("11 чатов найдено");
  });

  it("RU 14 matches → '14 чатов найдено' (teen → genitive plural)", () => {
    expect(
      threadSearchAnnouncement({ count: 14, query: "foo", lang: "ru" }),
    ).toBe("14 чатов найдено");
  });

  it("RU 21 matches → '21 чат найден' (singular per units rule)", () => {
    expect(
      threadSearchAnnouncement({ count: 21, query: "foo", lang: "ru" }),
    ).toBe("21 чат найден");
  });

  it("RU 22 matches → '22 чата найдено' (paucal)", () => {
    expect(
      threadSearchAnnouncement({ count: 22, query: "foo", lang: "ru" }),
    ).toBe("22 чата найдено");
  });

  it("RU 100 matches → '100 чатов найдено' (genitive plural)", () => {
    expect(
      threadSearchAnnouncement({ count: 100, query: "foo", lang: "ru" }),
    ).toBe("100 чатов найдено");
  });

  it("KZ 1 match → '1 чат табылды' (uninflected)", () => {
    expect(
      threadSearchAnnouncement({ count: 1, query: "foo", lang: "kz" }),
    ).toBe("1 чат табылды");
  });

  it("KZ 12 matches → '12 чат табылды' (uninflected)", () => {
    expect(
      threadSearchAnnouncement({ count: 12, query: "foo", lang: "kz" }),
    ).toBe("12 чат табылды");
  });

  it("count null → 0 → 'Ничего не найдено' when filtering", () => {
    expect(
      threadSearchAnnouncement({ count: null, query: "foo", lang: "ru" }),
    ).toBe("Ничего не найдено");
  });

  it("count NaN → 0 → 'Ничего не найдено'", () => {
    expect(
      threadSearchAnnouncement({
        count: Number.NaN,
        query: "foo",
        lang: "ru",
      }),
    ).toBe("Ничего не найдено");
  });

  it("count negative → 0 → 'Ничего не найдено'", () => {
    expect(
      threadSearchAnnouncement({ count: -5, query: "foo", lang: "ru" }),
    ).toBe("Ничего не найдено");
  });

  it("count float → floored to int", () => {
    expect(
      threadSearchAnnouncement({ count: 3.7, query: "foo", lang: "ru" }),
    ).toBe("3 чата найдено");
  });

  it("unknown lang → RU fallback", () => {
    expect(
      // @ts-expect-error — runtime guard
      threadSearchAnnouncement({ count: 1, query: "foo", lang: "en" }),
    ).toBe("1 чат найден");
  });

  it("query trimmed (leading/trailing spaces don't suppress)", () => {
    expect(
      threadSearchAnnouncement({ count: 1, query: "  foo  ", lang: "ru" }),
    ).toBe("1 чат найден");
  });
});
