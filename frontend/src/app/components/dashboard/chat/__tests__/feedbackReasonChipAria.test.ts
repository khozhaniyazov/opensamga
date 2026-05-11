/**
 * s35 wave 21b — vitest pins for `feedbackReasonChipAria`.
 */

import { describe, it, expect } from "vitest";
import { feedbackReasonChipAria } from "../feedbackReasonChipAria";

describe("feedbackReasonChipAria", () => {
  it("inactive RU → 'Причина: «<label>»'", () => {
    expect(
      feedbackReasonChipAria({
        label: "Неточный",
        active: false,
        lang: "ru",
      }),
    ).toBe("Причина: «Неточный»");
  });

  it("inactive KZ → 'Себеп: «<label>»'", () => {
    expect(
      feedbackReasonChipAria({
        label: "Дәл емес",
        active: false,
        lang: "kz",
      }),
    ).toBe("Себеп: «Дәл емес»");
  });

  it("active RU → tail '— выбрано, нажмите ещё раз, чтобы снять'", () => {
    expect(
      feedbackReasonChipAria({
        label: "Неточный",
        active: true,
        lang: "ru",
      }),
    ).toBe("Причина: «Неточный» — выбрано, нажмите ещё раз, чтобы снять");
  });

  it("active KZ → tail '— таңдалды, алу үшін қайта басыңыз'", () => {
    expect(
      feedbackReasonChipAria({
        label: "Дәл емес",
        active: true,
        lang: "kz",
      }),
    ).toBe("Себеп: «Дәл емес» — таңдалды, алу үшін қайта басыңыз");
  });

  it("active label always starts with the inactive label", () => {
    for (const lang of ["ru", "kz"] as const) {
      const inactive = feedbackReasonChipAria({
        label: "X",
        active: false,
        lang,
      });
      const active = feedbackReasonChipAria({
        label: "X",
        active: true,
        lang,
      });
      expect(active.startsWith(inactive)).toBe(true);
      expect(active.length).toBeGreaterThan(inactive.length);
    }
  });

  it("null label → RU fallback 'Без названия'", () => {
    expect(
      feedbackReasonChipAria({ label: null, active: false, lang: "ru" }),
    ).toBe("Причина: «Без названия»");
  });

  it("null label → KZ fallback 'Атаусыз'", () => {
    expect(
      feedbackReasonChipAria({ label: null, active: false, lang: "kz" }),
    ).toBe("Себеп: «Атаусыз»");
  });

  it("undefined label → RU fallback", () => {
    expect(
      feedbackReasonChipAria({ label: undefined, active: false, lang: "ru" }),
    ).toBe("Причина: «Без названия»");
  });

  it("empty-string label → fallback", () => {
    expect(
      feedbackReasonChipAria({ label: "", active: false, lang: "ru" }),
    ).toBe("Причина: «Без названия»");
  });

  it("whitespace-only label → fallback", () => {
    expect(
      feedbackReasonChipAria({ label: "   \t  ", active: false, lang: "ru" }),
    ).toBe("Причина: «Без названия»");
  });

  it("label trimmed (leading/trailing whitespace dropped)", () => {
    expect(
      feedbackReasonChipAria({
        label: "  Неточный  ",
        active: false,
        lang: "ru",
      }),
    ).toBe("Причина: «Неточный»");
  });

  it("unknown lang → RU fallback (head + tail)", () => {
    expect(
      feedbackReasonChipAria({
        label: "X",
        active: true,
        // @ts-expect-error — runtime guard
        lang: "en",
      }),
    ).toBe("Причина: «X» — выбрано, нажмите ещё раз, чтобы снять");
  });

  it("RU active and KZ active strings differ", () => {
    expect(
      feedbackReasonChipAria({ label: "X", active: true, lang: "ru" }),
    ).not.toBe(
      feedbackReasonChipAria({ label: "X", active: true, lang: "kz" }),
    );
  });

  it("inactive label preserves Cyrillic guillemets «»", () => {
    const out = feedbackReasonChipAria({
      label: "Слишком общий",
      active: false,
      lang: "ru",
    });
    expect(out).toContain("«");
    expect(out).toContain("»");
  });

  it("multiple invocations are pure (no shared state)", () => {
    const a1 = feedbackReasonChipAria({
      label: "A",
      active: true,
      lang: "ru",
    });
    const b = feedbackReasonChipAria({
      label: "B",
      active: false,
      lang: "kz",
    });
    const a2 = feedbackReasonChipAria({
      label: "A",
      active: true,
      lang: "ru",
    });
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });
});
