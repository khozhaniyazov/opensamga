/**
 * s35 wave 20b — vitest pins for `feedbackButtonAriaLabel`.
 */

import { describe, it, expect } from "vitest";
import { feedbackButtonAriaLabel } from "../feedbackButtonAriaLabel";

describe("feedbackButtonAriaLabel", () => {
  it("inactive up / RU → 'Полезно'", () => {
    expect(
      feedbackButtonAriaLabel({ direction: "up", active: false, lang: "ru" }),
    ).toBe("Полезно");
  });

  it("inactive down / RU → 'Не полезно'", () => {
    expect(
      feedbackButtonAriaLabel({ direction: "down", active: false, lang: "ru" }),
    ).toBe("Не полезно");
  });

  it("inactive up / KZ → 'Пайдалы'", () => {
    expect(
      feedbackButtonAriaLabel({ direction: "up", active: false, lang: "kz" }),
    ).toBe("Пайдалы");
  });

  it("inactive down / KZ → 'Пайдалы емес'", () => {
    expect(
      feedbackButtonAriaLabel({ direction: "down", active: false, lang: "kz" }),
    ).toBe("Пайдалы емес");
  });

  it("active up / RU → 'Полезно — нажмите ещё раз, чтобы убрать оценку'", () => {
    expect(
      feedbackButtonAriaLabel({ direction: "up", active: true, lang: "ru" }),
    ).toBe("Полезно — нажмите ещё раз, чтобы убрать оценку");
  });

  it("active down / RU → 'Не полезно — нажмите ещё раз, чтобы убрать оценку'", () => {
    expect(
      feedbackButtonAriaLabel({ direction: "down", active: true, lang: "ru" }),
    ).toBe("Не полезно — нажмите ещё раз, чтобы убрать оценку");
  });

  it("active up / KZ → 'Пайдалы — бағаны алу үшін қайта басыңыз'", () => {
    expect(
      feedbackButtonAriaLabel({ direction: "up", active: true, lang: "kz" }),
    ).toBe("Пайдалы — бағаны алу үшін қайта басыңыз");
  });

  it("active down / KZ → 'Пайдалы емес — бағаны алу үшін қайта басыңыз'", () => {
    expect(
      feedbackButtonAriaLabel({ direction: "down", active: true, lang: "kz" }),
    ).toBe("Пайдалы емес — бағаны алу үшін қайта басыңыз");
  });

  it("active label always starts with the inactive label", () => {
    for (const lang of ["ru", "kz"] as const) {
      for (const direction of ["up", "down"] as const) {
        const inactive = feedbackButtonAriaLabel({
          direction,
          active: false,
          lang,
        });
        const active = feedbackButtonAriaLabel({
          direction,
          active: true,
          lang,
        });
        expect(active.startsWith(inactive)).toBe(true);
        expect(active.length).toBeGreaterThan(inactive.length);
      }
    }
  });

  it("unknown direction → defaults to 'up'", () => {
    expect(
      // @ts-expect-error — runtime guard
      feedbackButtonAriaLabel({ direction: "left", active: false, lang: "ru" }),
    ).toBe("Полезно");
  });

  it("unknown lang → defaults to RU", () => {
    expect(
      // @ts-expect-error — runtime guard
      feedbackButtonAriaLabel({ direction: "up", active: false, lang: "en" }),
    ).toBe("Полезно");
  });

  it("active state with unknown lang → RU active suffix", () => {
    expect(
      feedbackButtonAriaLabel({
        direction: "down",
        active: true,
        // @ts-expect-error — runtime guard
        lang: "en",
      }),
    ).toBe("Не полезно — нажмите ещё раз, чтобы убрать оценку");
  });

  it("up and down inactive labels differ within the same lang", () => {
    expect(
      feedbackButtonAriaLabel({ direction: "up", active: false, lang: "ru" }),
    ).not.toBe(
      feedbackButtonAriaLabel({ direction: "down", active: false, lang: "ru" }),
    );
    expect(
      feedbackButtonAriaLabel({ direction: "up", active: false, lang: "kz" }),
    ).not.toBe(
      feedbackButtonAriaLabel({ direction: "down", active: false, lang: "kz" }),
    );
  });

  it("RU and KZ active strings differ", () => {
    expect(
      feedbackButtonAriaLabel({ direction: "up", active: true, lang: "ru" }),
    ).not.toBe(
      feedbackButtonAriaLabel({ direction: "up", active: true, lang: "kz" }),
    );
  });
});
