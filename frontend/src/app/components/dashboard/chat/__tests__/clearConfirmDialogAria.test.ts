import { describe, it, expect } from "vitest";
import {
  CLEAR_CONFIRM_DESCRIPTION_ID,
  clearConfirmCancelAriaLabel,
  clearConfirmDestructiveAriaLabel,
} from "../clearConfirmDialogAria";

describe("clearConfirmDialogAria (s35 wave 22b)", () => {
  describe("CLEAR_CONFIRM_DESCRIPTION_ID", () => {
    it("is a non-empty stable string", () => {
      expect(typeof CLEAR_CONFIRM_DESCRIPTION_ID).toBe("string");
      expect(CLEAR_CONFIRM_DESCRIPTION_ID.length).toBeGreaterThan(0);
    });

    it("is a valid DOM id (no whitespace, starts with a letter)", () => {
      expect(CLEAR_CONFIRM_DESCRIPTION_ID).toMatch(/^[a-z][a-z0-9-]*$/i);
    });
  });

  describe("clearConfirmDestructiveAriaLabel", () => {
    it("RU mentions the action verb and the consequence", () => {
      const out = clearConfirmDestructiveAriaLabel("ru");
      expect(out).toContain("Очистить");
      expect(out).toMatch(/удалит/i);
      expect(out).toMatch(/необратим/i);
    });

    it("KZ mentions the action verb and the consequence", () => {
      const out = clearConfirmDestructiveAriaLabel("kz");
      expect(out).toContain("тазалау");
      expect(out).toContain("жойылады");
      expect(out).toContain("қайтарылмайды");
    });

    it("RU and KZ outputs differ", () => {
      expect(clearConfirmDestructiveAriaLabel("ru")).not.toBe(
        clearConfirmDestructiveAriaLabel("kz"),
      );
    });

    it("unknown lang → RU fallback", () => {
      // @ts-expect-error — runtime guard
      expect(clearConfirmDestructiveAriaLabel("en")).toBe(
        clearConfirmDestructiveAriaLabel("ru"),
      );
    });

    it("destructive label is longer than the bare verb", () => {
      // Pin: the whole point of the helper is to add the
      // consequence beyond the visible verb. If a future refactor
      // collapses it back to "Очистить" alone, this fails.
      expect(clearConfirmDestructiveAriaLabel("ru").length).toBeGreaterThan(
        "Очистить".length,
      );
      expect(clearConfirmDestructiveAriaLabel("kz").length).toBeGreaterThan(
        "Тазалау".length,
      );
    });
  });

  describe("clearConfirmCancelAriaLabel", () => {
    it("RU mentions the cancel verb and the safe outcome", () => {
      const out = clearConfirmCancelAriaLabel("ru");
      expect(out).toContain("Отмена");
      expect(out).toMatch(/закрыть/i);
      expect(out).toMatch(/без удалени/i);
    });

    it("KZ mentions the cancel verb and the safe outcome", () => {
      const out = clearConfirmCancelAriaLabel("kz");
      expect(out).toContain("Болдырмау");
      expect(out).toContain("жоюсыз");
    });

    it("RU and KZ outputs differ", () => {
      expect(clearConfirmCancelAriaLabel("ru")).not.toBe(
        clearConfirmCancelAriaLabel("kz"),
      );
    });

    it("unknown lang → RU fallback", () => {
      // @ts-expect-error — runtime guard
      expect(clearConfirmCancelAriaLabel("en")).toBe(
        clearConfirmCancelAriaLabel("ru"),
      );
    });
  });

  describe("destructive vs cancel disambiguation", () => {
    it("destructive RU and cancel RU are obviously different", () => {
      expect(clearConfirmDestructiveAriaLabel("ru")).not.toBe(
        clearConfirmCancelAriaLabel("ru"),
      );
    });

    it("destructive KZ and cancel KZ are obviously different", () => {
      expect(clearConfirmDestructiveAriaLabel("kz")).not.toBe(
        clearConfirmCancelAriaLabel("kz"),
      );
    });
  });

  it("multiple invocations are pure (no shared state)", () => {
    const a1 = clearConfirmDestructiveAriaLabel("ru");
    const b = clearConfirmCancelAriaLabel("kz");
    const a2 = clearConfirmDestructiveAriaLabel("ru");
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });
});
