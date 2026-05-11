/**
 * s35 wave 17b — vitest pins for composerSendButtonAria helpers.
 */

import { describe, it, expect } from "vitest";
import {
  composerSendButtonState,
  composerSendButtonAriaLabel,
  composerSendButtonTitle,
} from "../composerSendButtonAria";

describe("composerSendButtonState", () => {
  it("isSending → 'sending' (even with input)", () => {
    expect(
      composerSendButtonState({
        input: "hello",
        hardLimit: 100,
        isSending: true,
        lang: "ru",
      }),
    ).toBe("sending");
  });

  it("input length > cap → 'over-limit'", () => {
    expect(
      composerSendButtonState({
        input: "x".repeat(11),
        hardLimit: 10,
        isSending: false,
        lang: "ru",
      }),
    ).toBe("over-limit");
  });

  it("empty string → 'empty'", () => {
    expect(
      composerSendButtonState({
        input: "",
        hardLimit: 100,
        isSending: false,
        lang: "ru",
      }),
    ).toBe("empty");
  });

  it("whitespace only → 'empty'", () => {
    expect(
      composerSendButtonState({
        input: "   \n\t  ",
        hardLimit: 100,
        isSending: false,
        lang: "ru",
      }),
    ).toBe("empty");
  });

  it("normal input under cap → 'ready'", () => {
    expect(
      composerSendButtonState({
        input: "Hello",
        hardLimit: 100,
        isSending: false,
        lang: "ru",
      }),
    ).toBe("ready");
  });

  it("hardLimit null + input present → 'ready' (no cap reported)", () => {
    expect(
      composerSendButtonState({
        input: "x".repeat(10000),
        hardLimit: null,
        isSending: false,
        lang: "ru",
      }),
    ).toBe("ready");
  });

  it("hardLimit NaN → 'ready'", () => {
    expect(
      composerSendButtonState({
        input: "x",
        hardLimit: Number.NaN,
        isSending: false,
        lang: "ru",
      }),
    ).toBe("ready");
  });

  it("input null → 'empty'", () => {
    expect(
      composerSendButtonState({
        input: null,
        hardLimit: 100,
        isSending: false,
        lang: "ru",
      }),
    ).toBe("empty");
  });

  it("over-limit beats empty when input is whitespace > cap", () => {
    // input.length=10 > cap=5 → over-limit, even though
    // .trim()==="" which would normally be 'empty'.
    expect(
      composerSendButtonState({
        input: "          ",
        hardLimit: 5,
        isSending: false,
        lang: "ru",
      }),
    ).toBe("over-limit");
  });
});

describe("composerSendButtonAriaLabel", () => {
  it("ready RU: 'Отправить (Enter)'", () => {
    expect(
      composerSendButtonAriaLabel({
        input: "Hi",
        hardLimit: 100,
        isSending: false,
        lang: "ru",
      }),
    ).toBe("Отправить (Enter)");
  });

  it("ready KZ: 'Жіберу (Enter)'", () => {
    expect(
      composerSendButtonAriaLabel({
        input: "Hi",
        hardLimit: 100,
        isSending: false,
        lang: "kz",
      }),
    ).toBe("Жіберу (Enter)");
  });

  it("ready uses caller-provided sendLabel when present", () => {
    expect(
      composerSendButtonAriaLabel({
        input: "Hi",
        hardLimit: 100,
        isSending: false,
        sendLabel: "Send",
        lang: "ru",
      }),
    ).toBe("Send (Enter)");
  });

  it("ready ignores blank sendLabel and falls back", () => {
    expect(
      composerSendButtonAriaLabel({
        input: "Hi",
        hardLimit: 100,
        isSending: false,
        sendLabel: "   ",
        lang: "ru",
      }),
    ).toBe("Отправить (Enter)");
  });

  it("empty RU", () => {
    expect(
      composerSendButtonAriaLabel({
        input: "",
        hardLimit: 100,
        isSending: false,
        lang: "ru",
      }),
    ).toBe("Введите сообщение, чтобы отправить");
  });

  it("empty KZ", () => {
    expect(
      composerSendButtonAriaLabel({
        input: "",
        hardLimit: 100,
        isSending: false,
        lang: "kz",
      }),
    ).toBe("Жіберу үшін хабарлама теріңіз");
  });

  it("over-limit RU includes char counts", () => {
    expect(
      composerSendButtonAriaLabel({
        input: "x".repeat(12),
        hardLimit: 10,
        isSending: false,
        lang: "ru",
      }),
    ).toBe("Сообщение слишком длинное (12 из 10 символов)");
  });

  it("over-limit KZ includes char counts", () => {
    expect(
      composerSendButtonAriaLabel({
        input: "x".repeat(12),
        hardLimit: 10,
        isSending: false,
        lang: "kz",
      }),
    ).toBe("Хабарлама тым ұзын (12 / 10 таңба)");
  });

  it("sending RU", () => {
    expect(
      composerSendButtonAriaLabel({
        input: "anything",
        hardLimit: 100,
        isSending: true,
        lang: "ru",
      }),
    ).toBe("Дождитесь окончания ответа перед новой отправкой");
  });

  it("sending KZ", () => {
    expect(
      composerSendButtonAriaLabel({
        input: "anything",
        hardLimit: 100,
        isSending: true,
        lang: "kz",
      }),
    ).toBe("Алдыңғы жауап аяқталғанша күтіңіз");
  });

  it("unknown lang → falls back to RU", () => {
    expect(
      composerSendButtonAriaLabel({
        input: "Hi",
        hardLimit: 100,
        isSending: false,
        // @ts-expect-error — exercising defensive runtime path
        lang: "en",
      }),
    ).toBe("Отправить (Enter)");
  });

  it("title === aria-label by contract", () => {
    const args = {
      input: "Hi",
      hardLimit: 100,
      isSending: false,
      lang: "ru" as const,
    };
    expect(composerSendButtonTitle(args)).toBe(
      composerSendButtonAriaLabel(args),
    );
  });

  it("over-limit uses hard cap exactly at the boundary (cap=N, len=N+1)", () => {
    expect(
      composerSendButtonAriaLabel({
        input: "y".repeat(2001),
        hardLimit: 2000,
        isSending: false,
        lang: "ru",
      }),
    ).toBe("Сообщение слишком длинное (2001 из 2000 символов)");
  });
});
