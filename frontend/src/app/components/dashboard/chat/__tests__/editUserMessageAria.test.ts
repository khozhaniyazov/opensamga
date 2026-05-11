import { describe, it, expect } from "vitest";
import {
  editUserMessageAria,
  editUserMessageTitle,
} from "../editUserMessageAria";

describe("editUserMessageAria (s35 wave 24b)", () => {
  it("RU no follow-ups → bare consequence-aware head", () => {
    expect(editUserMessageAria({ followUpCount: 0, lang: "ru" })).toBe(
      "Изменить и переслать сообщение",
    );
  });

  it("RU 1 follow-up → singular noun + singular verb", () => {
    expect(editUserMessageAria({ followUpCount: 1, lang: "ru" })).toBe(
      "Изменить и переслать сообщение, 1 следующее сообщение будет удалено",
    );
  });

  it("RU 2 follow-ups → paucal noun + plural verb", () => {
    expect(editUserMessageAria({ followUpCount: 2, lang: "ru" })).toBe(
      "Изменить и переслать сообщение, 2 следующих сообщения будут удалены",
    );
  });

  it("RU 4 follow-ups → still paucal", () => {
    expect(editUserMessageAria({ followUpCount: 4, lang: "ru" })).toBe(
      "Изменить и переслать сообщение, 4 следующих сообщения будут удалены",
    );
  });

  it("RU 5 follow-ups → genitive plural", () => {
    expect(editUserMessageAria({ followUpCount: 5, lang: "ru" })).toBe(
      "Изменить и переслать сообщение, 5 следующих сообщений будут удалены",
    );
  });

  it("RU 11 follow-ups → genitive plural via teen rule", () => {
    expect(editUserMessageAria({ followUpCount: 11, lang: "ru" })).toBe(
      "Изменить и переслать сообщение, 11 следующих сообщений будут удалены",
    );
  });

  it("RU 21 follow-ups → singular per units rule", () => {
    expect(editUserMessageAria({ followUpCount: 21, lang: "ru" })).toBe(
      "Изменить и переслать сообщение, 21 следующее сообщение будет удалено",
    );
  });

  it("RU 22 follow-ups → paucal per units rule", () => {
    expect(editUserMessageAria({ followUpCount: 22, lang: "ru" })).toBe(
      "Изменить и переслать сообщение, 22 следующих сообщения будут удалены",
    );
  });

  it("KZ no follow-ups → bare head", () => {
    expect(editUserMessageAria({ followUpCount: 0, lang: "kz" })).toBe(
      "Хабарламаны өзгерту және қайта жіберу",
    );
  });

  it("KZ N follow-ups → uninflected appendix", () => {
    expect(editUserMessageAria({ followUpCount: 1, lang: "kz" })).toBe(
      "Хабарламаны өзгерту және қайта жіберу, 1 келесі хабарлама өшіріледі",
    );
    expect(editUserMessageAria({ followUpCount: 5, lang: "kz" })).toBe(
      "Хабарламаны өзгерту және қайта жіберу, 5 келесі хабарлама өшіріледі",
    );
  });

  it("null/NaN/negative coerced to 0 → bare head", () => {
    expect(editUserMessageAria({ followUpCount: null, lang: "ru" })).toBe(
      "Изменить и переслать сообщение",
    );
    expect(editUserMessageAria({ followUpCount: undefined, lang: "ru" })).toBe(
      "Изменить и переслать сообщение",
    );
    expect(editUserMessageAria({ followUpCount: Number.NaN, lang: "ru" })).toBe(
      "Изменить и переслать сообщение",
    );
    expect(editUserMessageAria({ followUpCount: -7, lang: "ru" })).toBe(
      "Изменить и переслать сообщение",
    );
  });

  it("float follow-up count floored", () => {
    expect(editUserMessageAria({ followUpCount: 2.9, lang: "ru" })).toBe(
      "Изменить и переслать сообщение, 2 следующих сообщения будут удалены",
    );
  });

  it("Infinity coerced to 0", () => {
    expect(
      editUserMessageAria({
        followUpCount: Number.POSITIVE_INFINITY,
        lang: "ru",
      }),
    ).toBe("Изменить и переслать сообщение");
  });

  it("unknown lang → RU fallback", () => {
    expect(
      // @ts-expect-error — runtime guard
      editUserMessageAria({ followUpCount: 2, lang: "en" }),
    ).toBe(editUserMessageAria({ followUpCount: 2, lang: "ru" }));
  });

  it("RU and KZ outputs differ", () => {
    expect(editUserMessageAria({ followUpCount: 3, lang: "ru" })).not.toBe(
      editUserMessageAria({ followUpCount: 3, lang: "kz" }),
    );
  });

  it("output always names the destructive consequence when count>0 (regression guard)", () => {
    for (const c of [1, 2, 4, 5, 11, 21]) {
      const ru = editUserMessageAria({ followUpCount: c, lang: "ru" });
      expect(ru).toMatch(/удалено|удалены/);
    }
    for (const c of [1, 2, 5]) {
      const kz = editUserMessageAria({ followUpCount: c, lang: "kz" });
      expect(kz).toContain("өшіріледі");
    }
  });

  it("multiple invocations are pure", () => {
    const a1 = editUserMessageAria({ followUpCount: 3, lang: "ru" });
    const b = editUserMessageAria({ followUpCount: 5, lang: "kz" });
    const a2 = editUserMessageAria({ followUpCount: 3, lang: "ru" });
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });
});

describe("editUserMessageTitle (s35 wave 24b)", () => {
  it("RU returns bare verb for the visible tooltip", () => {
    expect(editUserMessageTitle("ru")).toBe("Изменить");
  });

  it("KZ returns bare verb", () => {
    expect(editUserMessageTitle("kz")).toBe("Өзгерту");
  });

  it("unknown lang → RU fallback", () => {
    // @ts-expect-error — runtime guard
    expect(editUserMessageTitle("en")).toBe("Изменить");
  });

  it("title is shorter than the aria-label so visible chrome stays compact", () => {
    const ariaWithCount = editUserMessageAria({
      followUpCount: 3,
      lang: "ru",
    });
    expect(editUserMessageTitle("ru").length).toBeLessThan(
      ariaWithCount.length,
    );
  });
});
