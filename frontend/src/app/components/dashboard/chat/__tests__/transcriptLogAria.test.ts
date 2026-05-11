import { describe, it, expect } from "vitest";
import { transcriptLogAria } from "../transcriptLogAria";

describe("transcriptLogAria (s35 wave 26b)", () => {
  it("RU 0 → empty-state sentence", () => {
    expect(transcriptLogAria({ messageCount: 0, lang: "ru" })).toBe(
      "Беседа: пока нет сообщений",
    );
  });

  it("RU 1 → singular", () => {
    expect(transcriptLogAria({ messageCount: 1, lang: "ru" })).toBe(
      "Беседа: 1 сообщение",
    );
  });

  it("RU 2 → paucal", () => {
    expect(transcriptLogAria({ messageCount: 2, lang: "ru" })).toBe(
      "Беседа: 2 сообщения",
    );
  });

  it("RU 4 → paucal", () => {
    expect(transcriptLogAria({ messageCount: 4, lang: "ru" })).toBe(
      "Беседа: 4 сообщения",
    );
  });

  it("RU 5 → genitive plural", () => {
    expect(transcriptLogAria({ messageCount: 5, lang: "ru" })).toBe(
      "Беседа: 5 сообщений",
    );
  });

  it("RU 11 → teen rule", () => {
    expect(transcriptLogAria({ messageCount: 11, lang: "ru" })).toBe(
      "Беседа: 11 сообщений",
    );
  });

  it("RU 21 → singular per units rule", () => {
    expect(transcriptLogAria({ messageCount: 21, lang: "ru" })).toBe(
      "Беседа: 21 сообщение",
    );
  });

  it("RU 22 → paucal per units rule", () => {
    expect(transcriptLogAria({ messageCount: 22, lang: "ru" })).toBe(
      "Беседа: 22 сообщения",
    );
  });

  it("RU 100 → genitive plural", () => {
    expect(transcriptLogAria({ messageCount: 100, lang: "ru" })).toBe(
      "Беседа: 100 сообщений",
    );
  });

  it("KZ 0 → empty-state sentence", () => {
    expect(transcriptLogAria({ messageCount: 0, lang: "kz" })).toBe(
      "Сұхбат: әзірге хабарлама жоқ",
    );
  });

  it("KZ N → uninflected", () => {
    for (const c of [1, 2, 5, 11, 21]) {
      expect(transcriptLogAria({ messageCount: c, lang: "kz" })).toBe(
        `Сұхбат: ${c} хабарлама`,
      );
    }
  });

  it("null/NaN/Infinity/negative/float coerced", () => {
    expect(transcriptLogAria({ messageCount: null, lang: "ru" })).toBe(
      "Беседа: пока нет сообщений",
    );
    expect(transcriptLogAria({ messageCount: undefined, lang: "ru" })).toBe(
      "Беседа: пока нет сообщений",
    );
    expect(transcriptLogAria({ messageCount: Number.NaN, lang: "ru" })).toBe(
      "Беседа: пока нет сообщений",
    );
    expect(transcriptLogAria({ messageCount: -3, lang: "ru" })).toBe(
      "Беседа: пока нет сообщений",
    );
    expect(
      transcriptLogAria({
        messageCount: Number.POSITIVE_INFINITY,
        lang: "ru",
      }),
    ).toBe("Беседа: пока нет сообщений");
    expect(transcriptLogAria({ messageCount: 2.9, lang: "ru" })).toBe(
      "Беседа: 2 сообщения",
    );
  });

  it("unknown lang → RU fallback", () => {
    expect(
      // @ts-expect-error — runtime guard
      transcriptLogAria({ messageCount: 3, lang: "en" }),
    ).toBe(transcriptLogAria({ messageCount: 3, lang: "ru" }));
  });

  it("RU and KZ outputs differ when count > 0", () => {
    expect(transcriptLogAria({ messageCount: 5, lang: "ru" })).not.toBe(
      transcriptLogAria({ messageCount: 5, lang: "kz" }),
    );
  });

  it("multi-call purity", () => {
    const a1 = transcriptLogAria({ messageCount: 5, lang: "ru" });
    transcriptLogAria({ messageCount: 1, lang: "kz" });
    const a2 = transcriptLogAria({ messageCount: 5, lang: "ru" });
    expect(a1).toBe(a2);
  });

  it("region name word always present", () => {
    for (const c of [0, 1, 5, 100]) {
      expect(transcriptLogAria({ messageCount: c, lang: "ru" })).toMatch(
        /Беседа/,
      );
      expect(transcriptLogAria({ messageCount: c, lang: "kz" })).toMatch(
        /Сұхбат/,
      );
    }
  });
});
