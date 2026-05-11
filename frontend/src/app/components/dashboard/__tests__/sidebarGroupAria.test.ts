import { describe, it, expect } from "vitest";
import { sidebarGroupButtonAriaLabel } from "../sidebarGroupAria";

describe("sidebarGroupButtonAriaLabel — RU happy paths", () => {
  it("3 children, open", () => {
    expect(
      sidebarGroupButtonAriaLabel({
        label: "Практика",
        childCount: 3,
        open: true,
        lang: "ru",
      }),
    ).toBe("Практика, раздел из 3 пункта, развёрнут");
  });

  it("3 children, closed", () => {
    expect(
      sidebarGroupButtonAriaLabel({
        label: "Практика",
        childCount: 3,
        open: false,
        lang: "ru",
      }),
    ).toBe("Практика, раздел из 3 пункта, свёрнут");
  });

  it("1 child → singular пункт", () => {
    expect(
      sidebarGroupButtonAriaLabel({
        label: "Аккаунт",
        childCount: 1,
        open: false,
        lang: "ru",
      }),
    ).toBe("Аккаунт, раздел из 1 пункт, свёрнут");
  });

  it("21 children → singular (units rule)", () => {
    expect(
      sidebarGroupButtonAriaLabel({
        label: "Тесты",
        childCount: 21,
        open: false,
        lang: "ru",
      }),
    ).toBe("Тесты, раздел из 21 пункт, свёрнут");
  });

  it("5 children → genitive plural", () => {
    expect(
      sidebarGroupButtonAriaLabel({
        label: "Вузы",
        childCount: 5,
        open: false,
        lang: "ru",
      }),
    ).toBe("Вузы, раздел из 5 пунктов, свёрнут");
  });

  it("11 children (teen) → genitive plural", () => {
    expect(
      sidebarGroupButtonAriaLabel({
        label: "Тесты",
        childCount: 11,
        open: false,
        lang: "ru",
      }),
    ).toBe("Тесты, раздел из 11 пунктов, свёрнут");
  });

  it("14 children (teen edge) → genitive plural", () => {
    expect(
      sidebarGroupButtonAriaLabel({
        label: "Тесты",
        childCount: 14,
        open: true,
        lang: "ru",
      }),
    ).toBe("Тесты, раздел из 14 пунктов, развёрнут");
  });

  it("22 children → paucal пункта", () => {
    expect(
      sidebarGroupButtonAriaLabel({
        label: "Тесты",
        childCount: 22,
        open: false,
        lang: "ru",
      }),
    ).toBe("Тесты, раздел из 22 пункта, свёрнут");
  });

  it("0 children → no count phrase", () => {
    expect(
      sidebarGroupButtonAriaLabel({
        label: "Пусто",
        childCount: 0,
        open: false,
        lang: "ru",
      }),
    ).toBe("Пусто, раздел, свёрнут");
  });
});

describe("sidebarGroupButtonAriaLabel — KZ", () => {
  it("3 children, open", () => {
    expect(
      sidebarGroupButtonAriaLabel({
        label: "Практика",
        childCount: 3,
        open: true,
        lang: "kz",
      }),
    ).toBe("Практика, бөлім, ішінде 3 сілтеме, жайылған");
  });

  it("KZ uninflected for any count", () => {
    expect(
      sidebarGroupButtonAriaLabel({
        label: "Тесты",
        childCount: 11,
        open: false,
        lang: "kz",
      }),
    ).toBe("Тесты, бөлім, ішінде 11 сілтеме, жиналған");
    expect(
      sidebarGroupButtonAriaLabel({
        label: "Тесты",
        childCount: 1,
        open: false,
        lang: "kz",
      }),
    ).toBe("Тесты, бөлім, ішінде 1 сілтеме, жиналған");
  });

  it("KZ 0 children → no count phrase", () => {
    expect(
      sidebarGroupButtonAriaLabel({
        label: "Пусто",
        childCount: 0,
        open: false,
        lang: "kz",
      }),
    ).toBe("Пусто, бөлім, жиналған");
  });
});

describe("sidebarGroupButtonAriaLabel — defensive", () => {
  it("missing label → bare 'Раздел…'", () => {
    expect(
      sidebarGroupButtonAriaLabel({
        label: "",
        childCount: 3,
        open: true,
        lang: "ru",
      }),
    ).toBe("Раздел из 3 пункта, развёрнут");
  });

  it("non-string label → bare phrasing", () => {
    expect(
      sidebarGroupButtonAriaLabel({
        label: 123,
        childCount: 3,
        open: true,
        lang: "ru",
      }),
    ).toBe("Раздел из 3 пункта, развёрнут");
  });

  it("trims label whitespace", () => {
    expect(
      sidebarGroupButtonAriaLabel({
        label: "   Практика   ",
        childCount: 1,
        open: false,
        lang: "ru",
      }),
    ).toBe("Практика, раздел из 1 пункт, свёрнут");
  });

  it("non-number count → 0", () => {
    expect(
      sidebarGroupButtonAriaLabel({
        label: "Тест",
        childCount: "abc",
        open: false,
        lang: "ru",
      }),
    ).toBe("Тест, раздел, свёрнут");
  });

  it("negative count → 0", () => {
    expect(
      sidebarGroupButtonAriaLabel({
        label: "Тест",
        childCount: -5,
        open: false,
        lang: "ru",
      }),
    ).toBe("Тест, раздел, свёрнут");
  });

  it("fractional count → floored", () => {
    expect(
      sidebarGroupButtonAriaLabel({
        label: "Тест",
        childCount: 3.7,
        open: true,
        lang: "ru",
      }),
    ).toBe("Тест, раздел из 3 пункта, развёрнут");
  });

  it("unrecognized lang → defaults to ru", () => {
    expect(
      sidebarGroupButtonAriaLabel({
        label: "Тест",
        childCount: 3,
        open: false,
        lang: "en",
      }),
    ).toBe("Тест, раздел из 3 пункта, свёрнут");
  });

  it("non-boolean open → falsy → closed", () => {
    expect(
      sidebarGroupButtonAriaLabel({
        label: "Тест",
        childCount: 3,
        open: "true",
        lang: "ru",
      }),
    ).toBe("Тест, раздел из 3 пункта, свёрнут");
    expect(
      sidebarGroupButtonAriaLabel({
        label: "Тест",
        childCount: 3,
        open: undefined,
        lang: "ru",
      }),
    ).toBe("Тест, раздел из 3 пункта, свёрнут");
  });

  it("null inputs → fully defensive", () => {
    expect(
      sidebarGroupButtonAriaLabel({
        label: null,
        childCount: null,
        open: null,
        lang: null,
      }),
    ).toBe("Раздел, свёрнут");
  });

  it("purity: same input same output", () => {
    const a = sidebarGroupButtonAriaLabel({
      label: "Практика",
      childCount: 3,
      open: true,
      lang: "ru",
    });
    sidebarGroupButtonAriaLabel({
      label: "Other",
      childCount: 99,
      open: false,
      lang: "kz",
    });
    const b = sidebarGroupButtonAriaLabel({
      label: "Практика",
      childCount: 3,
      open: true,
      lang: "ru",
    });
    expect(a).toBe(b);
  });
});
