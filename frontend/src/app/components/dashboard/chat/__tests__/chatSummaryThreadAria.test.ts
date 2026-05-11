import { describe, it, expect } from "vitest";
import {
  chatSummaryThreadAriaLabel,
  type ChatSummaryThreadLang,
} from "../chatSummaryThreadAria";

describe("chatSummaryThreadAriaLabel (s35 wave 27a)", () => {
  it("RU full input → verb + title + date sentence", () => {
    expect(
      chatSummaryThreadAriaLabel({
        title: "Дискриминант квадратного уравнения",
        updatedAt: "2026-04-25T12:00:00Z",
        lang: "ru",
      }),
    ).toBe(
      "Открыть диалог: Дискриминант квадратного уравнения, последнее обновление 2026-04-25",
    );
  });

  it("KZ full input → verb + title + date sentence", () => {
    expect(
      chatSummaryThreadAriaLabel({
        title: "Математика",
        updatedAt: "2026-04-25",
        lang: "kz",
      }),
    ).toBe("Сұхбатты ашу: Математика, соңғы жаңарту 2026-04-25");
  });

  it("RU missing/empty/whitespace title → fallback", () => {
    for (const t of [null, undefined, "", "   "]) {
      expect(
        chatSummaryThreadAriaLabel({
          title: t,
          updatedAt: "2026-04-25",
          lang: "ru",
        }),
      ).toBe("Открыть диалог: Без названия, последнее обновление 2026-04-25");
    }
  });

  it("KZ missing/empty/whitespace title → fallback", () => {
    expect(
      chatSummaryThreadAriaLabel({
        title: null,
        updatedAt: "2026-04-25",
        lang: "kz",
      }),
    ).toBe("Сұхбатты ашу: Атаусыз, соңғы жаңарту 2026-04-25");
  });

  it("missing/invalid date → bare verb + title only", () => {
    for (const d of [null, undefined, "", "  ", "not-a-date", "2026/04/25"]) {
      expect(
        chatSummaryThreadAriaLabel({
          title: "Алгебра",
          updatedAt: d,
          lang: "ru",
        }),
      ).toBe("Открыть диалог: Алгебра");
      expect(
        chatSummaryThreadAriaLabel({
          title: "Алгебра",
          updatedAt: d,
          lang: "kz",
        }),
      ).toBe("Сұхбатты ашу: Алгебра");
    }
  });

  it("ISO timestamp prefix is accepted", () => {
    expect(
      chatSummaryThreadAriaLabel({
        title: "Физика",
        updatedAt: "2026-04-25T13:14:15.999Z",
        lang: "ru",
      }),
    ).toBe("Открыть диалог: Физика, последнее обновление 2026-04-25");
  });

  it("title is trimmed before insertion", () => {
    expect(
      chatSummaryThreadAriaLabel({
        title: "   Топик   ",
        updatedAt: null,
        lang: "ru",
      }),
    ).toBe("Открыть диалог: Топик");
  });

  it("non-string title coerces to fallback", () => {
    // Runtime-guard test: deliberately passing a non-string title to
    // confirm the function coerces. Cast through unknown to bypass TS.
    expect(
      chatSummaryThreadAriaLabel({
        title: 123 as unknown as string,
        updatedAt: null,
        lang: "ru",
      }),
    ).toBe("Открыть диалог: Без названия");
  });

  it("unknown lang → RU fallback", () => {
    // Runtime-guard test: lang outside ChatSummaryThreadLang union.
    expect(
      chatSummaryThreadAriaLabel({
        title: "X",
        updatedAt: null,
        lang: "en" as unknown as ChatSummaryThreadLang,
      }),
    ).toBe("Открыть диалог: X");
  });

  it("multi-call purity", () => {
    const a1 = chatSummaryThreadAriaLabel({
      title: "X",
      updatedAt: "2026-01-01",
      lang: "ru",
    });
    chatSummaryThreadAriaLabel({ title: "Y", updatedAt: null, lang: "kz" });
    const a2 = chatSummaryThreadAriaLabel({
      title: "X",
      updatedAt: "2026-01-01",
      lang: "ru",
    });
    expect(a1).toBe(a2);
  });

  it("verb word always present", () => {
    for (const lang of ["ru", "kz"] as const) {
      const out = chatSummaryThreadAriaLabel({
        title: "Z",
        updatedAt: null,
        lang,
      });
      const verb = lang === "kz" ? "Сұхбатты ашу" : "Открыть диалог";
      expect(out.startsWith(verb)).toBe(true);
    }
  });
});
