import { describe, it, expect } from "vitest";
import { feedbackPopoverDialogAriaLabel } from "../feedbackPopoverDialogAria";

describe("feedbackPopoverDialogAriaLabel — RU", () => {
  it("down direction", () => {
    expect(
      feedbackPopoverDialogAriaLabel({ direction: "down", lang: "ru" }),
    ).toBe("Форма обратной связи: что было не так?");
  });

  it("up direction", () => {
    expect(
      feedbackPopoverDialogAriaLabel({ direction: "up", lang: "ru" }),
    ).toBe("Форма обратной связи: что было удачным?");
  });

  it("unknown direction → bare", () => {
    expect(
      feedbackPopoverDialogAriaLabel({ direction: null, lang: "ru" }),
    ).toBe("Форма обратной связи");
  });
});

describe("feedbackPopoverDialogAriaLabel — KZ", () => {
  it("down", () => {
    expect(
      feedbackPopoverDialogAriaLabel({ direction: "down", lang: "kz" }),
    ).toBe("Кері байланыс формасы: не дұрыс емес?");
  });

  it("up", () => {
    expect(
      feedbackPopoverDialogAriaLabel({ direction: "up", lang: "kz" }),
    ).toBe("Кері байланыс формасы: оң бағаға не қосар едіңіз?");
  });

  it("unknown direction → bare", () => {
    expect(
      feedbackPopoverDialogAriaLabel({ direction: undefined, lang: "kz" }),
    ).toBe("Кері байланыс формасы");
  });
});

describe("feedbackPopoverDialogAriaLabel — defensive", () => {
  it("garbage direction", () => {
    expect(
      feedbackPopoverDialogAriaLabel({ direction: "sideways", lang: "ru" }),
    ).toBe("Форма обратной связи");
  });

  it("unknown lang → ru", () => {
    expect(
      feedbackPopoverDialogAriaLabel({ direction: "down", lang: "en" }),
    ).toBe("Форма обратной связи: что было не так?");
  });

  it("null lang → ru", () => {
    expect(
      feedbackPopoverDialogAriaLabel({ direction: "down", lang: null }),
    ).toBe("Форма обратной связи: что было не так?");
  });

  it("purity", () => {
    const a = feedbackPopoverDialogAriaLabel({
      direction: "down",
      lang: "ru",
    });
    feedbackPopoverDialogAriaLabel({ direction: "up", lang: "kz" });
    const b = feedbackPopoverDialogAriaLabel({
      direction: "down",
      lang: "ru",
    });
    expect(a).toBe(b);
  });
});
