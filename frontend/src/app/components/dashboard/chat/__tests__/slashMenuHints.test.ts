import { describe, it, expect } from "vitest";
import { slashMenuHintItems, slashMenuHintAriaLabel } from "../slashMenuHints";

describe("slashMenuHintItems", () => {
  it("returns 4 rows in canonical order (navigate, select, dismiss, recall) for RU", () => {
    const items = slashMenuHintItems("ru");
    expect(items).toHaveLength(4);
    expect(items[0].label).toMatch(/перейти/);
    expect(items[1].label).toMatch(/выбрать/);
    expect(items[2].label).toMatch(/закрыть/);
    expect(items[3].label).toMatch(/вызвать/);
  });

  it("returns 4 rows in canonical order for KZ", () => {
    const items = slashMenuHintItems("kz");
    expect(items).toHaveLength(4);
    expect(items[0].label).toMatch(/жылжу/);
    expect(items[1].label).toMatch(/таңдау/);
    expect(items[2].label).toMatch(/жабу/);
    expect(items[3].label).toMatch(/шақыру/);
  });

  it("uses up/down arrow chips for the navigate row", () => {
    expect(slashMenuHintItems("ru")[0].keys).toEqual(["↑", "↓"]);
    expect(slashMenuHintItems("kz")[0].keys).toEqual(["↑", "↓"]);
  });

  it("uses Enter chip for the select row", () => {
    expect(slashMenuHintItems("ru")[1].keys).toEqual(["Enter"]);
    expect(slashMenuHintItems("kz")[1].keys).toEqual(["Enter"]);
  });

  it("uses Esc chip for the dismiss row", () => {
    expect(slashMenuHintItems("ru")[2].keys).toEqual(["Esc"]);
    expect(slashMenuHintItems("kz")[2].keys).toEqual(["Esc"]);
  });

  it("uses platform-aware Ctrl/⌘ + slash chips for the recall row (RU)", () => {
    expect(slashMenuHintItems("ru")[3].keys).toEqual(["Ctrl / ⌘", "/"]);
  });

  it("uses platform-aware Ctrl/⌘ + slash chips for the recall row (KZ)", () => {
    expect(slashMenuHintItems("kz")[3].keys).toEqual(["Ctrl / ⌘", "/"]);
  });

  it("recall row label mentions 'команд' (RU) / 'пәрмен' (KZ)", () => {
    expect(slashMenuHintItems("ru")[3].label).toContain("команд");
    expect(slashMenuHintItems("kz")[3].label).toContain("пәрмен");
  });

  it("never returns an empty key array (every row needs a chip)", () => {
    for (const lang of ["ru", "kz"] as const) {
      for (const item of slashMenuHintItems(lang)) {
        expect(item.keys.length).toBeGreaterThan(0);
        for (const k of item.keys) {
          expect(k.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("never returns an empty label", () => {
    for (const lang of ["ru", "kz"] as const) {
      for (const item of slashMenuHintItems(lang)) {
        expect(item.label.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("slashMenuHintAriaLabel", () => {
  it("formats single-key chip as 'Enter: выбрать'", () => {
    const items = slashMenuHintItems("ru");
    expect(slashMenuHintAriaLabel(items[1])).toBe("Enter: выбрать");
  });

  it("joins multi-key chips with a single space", () => {
    const items = slashMenuHintItems("ru");
    expect(slashMenuHintAriaLabel(items[0])).toBe("↑ ↓: перейти по списку");
  });

  it("matches the KZ label text", () => {
    const items = slashMenuHintItems("kz");
    expect(slashMenuHintAriaLabel(items[2])).toBe("Esc: жабу");
  });

  it("recall row aria reads 'Ctrl / ⌘ /: <label>'", () => {
    const items = slashMenuHintItems("ru");
    expect(slashMenuHintAriaLabel(items[3])).toBe(
      "Ctrl / ⌘ /: вызвать меню команд",
    );
  });

  it("recall row aria for KZ reads 'Ctrl / ⌘ /: пәрмендер мәзірін шақыру'", () => {
    const items = slashMenuHintItems("kz");
    expect(slashMenuHintAriaLabel(items[3])).toBe(
      "Ctrl / ⌘ /: пәрмендер мәзірін шақыру",
    );
  });
});
