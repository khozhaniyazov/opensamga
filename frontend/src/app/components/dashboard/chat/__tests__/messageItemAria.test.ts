/**
 * s35 wave 38 (2026-04-28) — vitest pin tests for `messageItemAria`.
 * Pure helper, no DOM.
 */

import { describe, expect, it } from "vitest";
import { messageItemAria } from "../messageItemAria";

describe("messageItemAria — RU happy paths", () => {
  it("user, 1/5", () => {
    const r = messageItemAria({
      role: "user",
      position: 1,
      total: 5,
      streaming: false,
      lang: "ru",
    });
    expect(r).toEqual({
      ariaLabel: "Сообщение 1 из 5, ваше сообщение",
      posInSet: 1,
      setSize: 5,
      resolvedRole: "user",
    });
  });

  it("assistant, 2/5", () => {
    expect(
      messageItemAria({
        role: "assistant",
        position: 2,
        total: 5,
        streaming: false,
        lang: "ru",
      }).ariaLabel,
    ).toBe("Сообщение 2 из 5, ответ Samga");
  });

  it("error, 3/5", () => {
    expect(
      messageItemAria({
        role: "error",
        position: 3,
        total: 5,
        streaming: false,
        lang: "ru",
      }).ariaLabel,
    ).toBe("Сообщение 3 из 5, ошибка");
  });

  it("streaming assistant, 5/5", () => {
    expect(
      messageItemAria({
        role: "assistant",
        position: 5,
        total: 5,
        streaming: true,
        lang: "ru",
      }).ariaLabel,
    ).toBe("Сообщение 5 из 5, ответ Samga, генерируется");
  });

  it("streaming flag IGNORED for user bubbles", () => {
    expect(
      messageItemAria({
        role: "user",
        position: 1,
        total: 1,
        streaming: true,
        lang: "ru",
      }).ariaLabel,
    ).toBe("Сообщение 1 из 1, ваше сообщение");
  });

  it("streaming flag IGNORED for error bubbles", () => {
    expect(
      messageItemAria({
        role: "error",
        position: 1,
        total: 1,
        streaming: true,
        lang: "ru",
      }).ariaLabel,
    ).toBe("Сообщение 1 из 1, ошибка");
  });
});

describe("messageItemAria — KZ happy paths", () => {
  it("user, 1/5", () => {
    expect(
      messageItemAria({
        role: "user",
        position: 1,
        total: 5,
        streaming: false,
        lang: "kz",
      }).ariaLabel,
    ).toBe("1-ден 5-ке дейінгі хабарлама, сіздің хабарламаңыз");
  });

  it("assistant, 2/5", () => {
    expect(
      messageItemAria({
        role: "assistant",
        position: 2,
        total: 5,
        streaming: false,
        lang: "kz",
      }).ariaLabel,
    ).toBe("2-ден 5-ке дейінгі хабарлама, Samga жауабы");
  });

  it("streaming assistant", () => {
    expect(
      messageItemAria({
        role: "assistant",
        position: 5,
        total: 5,
        streaming: true,
        lang: "kz",
      }).ariaLabel,
    ).toBe("5-ден 5-ке дейінгі хабарлама, Samga жауабы, жасалуда");
  });
});

describe("messageItemAria — defensive coercion", () => {
  it("position < 1 clamps to 1", () => {
    expect(
      messageItemAria({
        role: "user",
        position: 0,
        total: 5,
        streaming: false,
        lang: "ru",
      }).posInSet,
    ).toBe(1);
    expect(
      messageItemAria({
        role: "user",
        position: -3,
        total: 5,
        streaming: false,
        lang: "ru",
      }).posInSet,
    ).toBe(1);
  });

  it("total < position clamps to position", () => {
    const r = messageItemAria({
      role: "user",
      position: 5,
      total: 3,
      streaming: false,
      lang: "ru",
    });
    expect(r.posInSet).toBe(5);
    expect(r.setSize).toBe(5);
    expect(r.ariaLabel).toBe("Сообщение 5 из 5, ваше сообщение");
  });

  it("non-finite position → 1", () => {
    expect(
      messageItemAria({
        role: "user",
        position: NaN,
        total: 5,
        streaming: false,
        lang: "ru",
      }).posInSet,
    ).toBe(1);
    expect(
      messageItemAria({
        role: "user",
        position: Infinity,
        total: 5,
        streaming: false,
        lang: "ru",
      }).posInSet,
    ).toBe(1);
  });

  it("non-finite total → matches position", () => {
    expect(
      messageItemAria({
        role: "user",
        position: 3,
        total: NaN,
        streaming: false,
        lang: "ru",
      }).setSize,
    ).toBe(3);
  });

  it("float position floored", () => {
    expect(
      messageItemAria({
        role: "user",
        position: 2.7,
        total: 5,
        streaming: false,
        lang: "ru",
      }).posInSet,
    ).toBe(2);
  });

  it("unknown role → assistant", () => {
    expect(
      messageItemAria({
        role: "system",
        position: 1,
        total: 1,
        streaming: false,
        lang: "ru",
      }).resolvedRole,
    ).toBe("assistant");
    expect(
      messageItemAria({
        role: null,
        position: 1,
        total: 1,
        streaming: false,
        lang: "ru",
      }).resolvedRole,
    ).toBe("assistant");
    expect(
      messageItemAria({
        role: undefined,
        position: 1,
        total: 1,
        streaming: false,
        lang: "ru",
      }).resolvedRole,
    ).toBe("assistant");
  });

  it("unknown lang → ru", () => {
    expect(
      messageItemAria({
        role: "user",
        position: 1,
        total: 1,
        streaming: false,
        lang: "fr",
      }).ariaLabel,
    ).toBe("Сообщение 1 из 1, ваше сообщение");
  });

  it("non-boolean streaming → false", () => {
    expect(
      messageItemAria({
        role: "assistant",
        position: 1,
        total: 1,
        streaming: 1,
        lang: "ru",
      }).ariaLabel,
    ).toBe("Сообщение 1 из 1, ответ Samga");
    expect(
      messageItemAria({
        role: "assistant",
        position: 1,
        total: 1,
        streaming: "yes",
        lang: "ru",
      }).ariaLabel,
    ).toBe("Сообщение 1 из 1, ответ Samga");
  });
});

describe("messageItemAria — purity", () => {
  it("same input → same output", () => {
    const a = messageItemAria({
      role: "user",
      position: 1,
      total: 5,
      streaming: false,
      lang: "ru",
    });
    messageItemAria({
      role: "assistant",
      position: 5,
      total: 5,
      streaming: true,
      lang: "kz",
    });
    const b = messageItemAria({
      role: "user",
      position: 1,
      total: 5,
      streaming: false,
      lang: "ru",
    });
    expect(a).toEqual(b);
  });
});
