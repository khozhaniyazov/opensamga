import { describe, expect, it } from "vitest";
import {
  buildRetakeGuideQuery,
  daysUntil,
  formatRetakeDate,
  formatRetakeFee,
  sessionKindLabel,
} from "../retakeGuideModel";

describe("formatRetakeDate", () => {
  it("returns dash on null / unparseable input", () => {
    expect(formatRetakeDate(null)).toBe("—");
    expect(formatRetakeDate("not-a-date")).toBe("—");
  });

  it("formats a real ISO date to a non-empty locale string", () => {
    const out = formatRetakeDate("2026-06-15");
    expect(out).not.toBe("—");
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("formatRetakeFee", () => {
  it("formats whole tenge with KZT symbol", () => {
    const out = formatRetakeFee(6500);
    expect(out).toMatch(/6.?500/);
    expect(out).toContain("₸");
  });

  it("returns dash for negative / NaN / Infinity", () => {
    expect(formatRetakeFee(-1)).toBe("—");
    expect(formatRetakeFee(Number.NaN)).toBe("—");
    expect(formatRetakeFee(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("rounds fractional input", () => {
    const out = formatRetakeFee(6499.6);
    expect(out).toMatch(/6.?500/);
  });
});

describe("daysUntil", () => {
  it("returns positive integer for a future date", () => {
    const now = Date.parse("2026-05-01T00:00:00Z");
    expect(daysUntil("2026-06-15", now)).toBe(45);
  });

  it("returns negative integer for a past date", () => {
    const now = Date.parse("2026-07-01T00:00:00Z");
    expect(daysUntil("2026-06-01", now)).toBeLessThan(0);
  });

  it("returns NaN on bad input", () => {
    expect(Number.isNaN(daysUntil("garbage"))).toBe(true);
  });
});

describe("sessionKindLabel", () => {
  it("looks up the kind_<kind> key", () => {
    const strings = {
      kind_main: "Main session",
      kind_additional: "Additional",
      kind_supplementary: "Reserve",
    };
    expect(sessionKindLabel("main", strings)).toBe("Main session");
    expect(sessionKindLabel("additional", strings)).toBe("Additional");
    expect(sessionKindLabel("supplementary", strings)).toBe("Reserve");
  });

  it("falls back to the raw kind string when key missing", () => {
    expect(sessionKindLabel("main", {})).toBe("main");
  });
});

describe("buildRetakeGuideQuery (v3.31 contract pin)", () => {
  // Regression: v3.28 shipped the FE sending `lang=kz`, but the BE
  // route accepts the param under the name `language`. The mismatch
  // silently returned RU strings to all KZ users. This helper is
  // the single source of truth — if you're tempted to rename the
  // key, you must also update the BE handler in lockstep.
  it("emits the BE-shaped 'language' param, never 'lang'", () => {
    const qs = buildRetakeGuideQuery({
      lang: "kz",
      weeksUntilSession: 8,
    });
    const params = new URLSearchParams(qs);
    expect(params.get("language")).toBe("kz");
    expect(params.has("lang")).toBe(false);
  });

  it("normalizes any non-kz input to ru", () => {
    expect(
      new URLSearchParams(
        buildRetakeGuideQuery({ lang: "ru", weeksUntilSession: 4 }),
      ).get("language"),
    ).toBe("ru");
    expect(
      new URLSearchParams(
        buildRetakeGuideQuery({ lang: "en", weeksUntilSession: 4 }),
      ).get("language"),
    ).toBe("ru");
    expect(
      new URLSearchParams(
        buildRetakeGuideQuery({ lang: "", weeksUntilSession: 4 }),
      ).get("language"),
    ).toBe("ru");
  });

  it("treats kz-KZ / KZ as kz (case + region tolerance)", () => {
    expect(
      new URLSearchParams(
        buildRetakeGuideQuery({ lang: "kz-KZ", weeksUntilSession: 4 }),
      ).get("language"),
    ).toBe("kz");
    expect(
      new URLSearchParams(
        buildRetakeGuideQuery({ lang: "KZ", weeksUntilSession: 4 }),
      ).get("language"),
    ).toBe("kz");
  });

  it("clamps weeks_until_session to BE-accepted 0..52", () => {
    const negative = new URLSearchParams(
      buildRetakeGuideQuery({ lang: "ru", weeksUntilSession: -10 }),
    );
    expect(negative.get("weeks_until_session")).toBe("0");

    const huge = new URLSearchParams(
      buildRetakeGuideQuery({ lang: "ru", weeksUntilSession: 9999 }),
    );
    expect(huge.get("weeks_until_session")).toBe("52");

    const fractional = new URLSearchParams(
      buildRetakeGuideQuery({ lang: "ru", weeksUntilSession: 6.7 }),
    );
    expect(fractional.get("weeks_until_session")).toBe("6");
  });

  it("omits current_score when undefined / null / non-finite", () => {
    expect(
      new URLSearchParams(
        buildRetakeGuideQuery({ lang: "ru", weeksUntilSession: 4 }),
      ).has("current_score"),
    ).toBe(false);
    expect(
      new URLSearchParams(
        buildRetakeGuideQuery({
          lang: "ru",
          weeksUntilSession: 4,
          currentScore: null,
        }),
      ).has("current_score"),
    ).toBe(false);
    expect(
      new URLSearchParams(
        buildRetakeGuideQuery({
          lang: "ru",
          weeksUntilSession: 4,
          currentScore: Number.NaN,
        }),
      ).has("current_score"),
    ).toBe(false);
  });

  it("includes current_score (truncated) when finite", () => {
    const qs = buildRetakeGuideQuery({
      lang: "kz",
      weeksUntilSession: 4,
      currentScore: 95.9,
    });
    expect(new URLSearchParams(qs).get("current_score")).toBe("95");
  });
});
