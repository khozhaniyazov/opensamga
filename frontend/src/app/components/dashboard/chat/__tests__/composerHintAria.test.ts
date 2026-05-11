import { describe, it, expect } from "vitest";
import {
  composerHintAriaText,
  COMPOSER_HINT_DESCRIPTION_ID,
} from "../composerHintAria";

describe("composerHintAriaText — RU idle", () => {
  it("idle — full hint with all 4 shortcuts", () => {
    expect(
      composerHintAriaText({
        isSending: false,
        composing: false,
        slashMenuOpen: false,
        lang: "ru",
      }),
    ).toBe(
      "Подсказка по горячим клавишам: Enter — отправить, Shift + Enter — новая строка, Слэш — открыть меню команд, Стрелка вверх — повторить последнее сообщение.",
    );
  });

  it("sending — Enter dropped, ArrowUp dropped, Esc added", () => {
    expect(
      composerHintAriaText({
        isSending: true,
        composing: false,
        slashMenuOpen: false,
        lang: "ru",
      }),
    ).toBe(
      "Подсказка по горячим клавишам: Shift + Enter — новая строка, Слэш — открыть меню команд, Esc — остановить ответ.",
    );
  });

  it("composing — Enter dropped (IME commits)", () => {
    expect(
      composerHintAriaText({
        isSending: false,
        composing: true,
        slashMenuOpen: false,
        lang: "ru",
      }),
    ).toBe(
      "Подсказка по горячим клавишам: Shift + Enter — новая строка, Слэш — открыть меню команд, Стрелка вверх — повторить последнее сообщение.",
    );
  });

  it("slashMenuOpen — sr text switches to slash navigation paragraph", () => {
    expect(
      composerHintAriaText({
        isSending: false,
        composing: false,
        slashMenuOpen: true,
        lang: "ru",
      }),
    ).toBe(
      "Подсказка по горячим клавишам: стрелки вверх и вниз — выбрать команду, Enter — подтвердить, Esc — закрыть меню.",
    );
  });

  it("slashMenuOpen takes precedence over sending", () => {
    expect(
      composerHintAriaText({
        isSending: true,
        composing: false,
        slashMenuOpen: true,
        lang: "ru",
      }),
    ).toBe(
      "Подсказка по горячим клавишам: стрелки вверх и вниз — выбрать команду, Enter — подтвердить, Esc — закрыть меню.",
    );
  });
});

describe("composerHintAriaText — KZ", () => {
  it("idle", () => {
    expect(
      composerHintAriaText({
        isSending: false,
        composing: false,
        slashMenuOpen: false,
        lang: "kz",
      }),
    ).toBe(
      "Жылдам пернелер бойынша көмек: Enter — жіберу, Shift + Enter — жаңа жол, Слэш — командалар мәзірін ашу, Жоғарғы көрсеткі — соңғы хабарламаны қайталау.",
    );
  });

  it("sending", () => {
    expect(
      composerHintAriaText({
        isSending: true,
        composing: false,
        slashMenuOpen: false,
        lang: "kz",
      }),
    ).toBe(
      "Жылдам пернелер бойынша көмек: Shift + Enter — жаңа жол, Слэш — командалар мәзірін ашу, Esc — жауапты тоқтату.",
    );
  });

  it("slashMenuOpen", () => {
    expect(
      composerHintAriaText({
        isSending: false,
        composing: false,
        slashMenuOpen: true,
        lang: "kz",
      }),
    ).toBe(
      "Жылдам пернелер бойынша көмек: жоғары және төмен көрсеткілер — команданы таңдау, Enter — растау, Esc — мәзірді жабу.",
    );
  });
});

describe("composerHintAriaText — defensive", () => {
  it("non-boolean booleans → falsy", () => {
    expect(
      composerHintAriaText({
        isSending: 1,
        composing: "yes",
        slashMenuOpen: 0,
        lang: "ru",
      }),
    ).toBe(
      "Подсказка по горячим клавишам: Enter — отправить, Shift + Enter — новая строка, Слэш — открыть меню команд, Стрелка вверх — повторить последнее сообщение.",
    );
  });

  it("unknown lang → ru", () => {
    expect(
      composerHintAriaText({
        isSending: false,
        composing: false,
        slashMenuOpen: false,
        lang: "fr",
      }),
    ).toBe(
      "Подсказка по горячим клавишам: Enter — отправить, Shift + Enter — новая строка, Слэш — открыть меню команд, Стрелка вверх — повторить последнее сообщение.",
    );
  });

  it("null lang → ru", () => {
    expect(
      composerHintAriaText({
        isSending: false,
        composing: false,
        slashMenuOpen: false,
        lang: null,
      }),
    ).toBe(
      "Подсказка по горячим клавишам: Enter — отправить, Shift + Enter — новая строка, Слэш — открыть меню команд, Стрелка вверх — повторить последнее сообщение.",
    );
  });

  it("purity: same input same output", () => {
    const a = composerHintAriaText({
      isSending: false,
      composing: false,
      slashMenuOpen: false,
      lang: "ru",
    });
    composerHintAriaText({
      isSending: true,
      composing: true,
      slashMenuOpen: true,
      lang: "kz",
    });
    const b = composerHintAriaText({
      isSending: false,
      composing: false,
      slashMenuOpen: false,
      lang: "ru",
    });
    expect(a).toBe(b);
  });

  it("exposes a stable description id", () => {
    expect(COMPOSER_HINT_DESCRIPTION_ID).toBe("samga-composer-hint");
  });
});
