/**
 * s35 wave 19a — vitest pins for `messageCopiedAnnouncement`.
 */

import { describe, it, expect } from "vitest";
import { messageCopiedAnnouncement } from "../messageCopiedAnnouncement";

describe("messageCopiedAnnouncement", () => {
  it("RU markdown → 'Скопировано как Markdown'", () => {
    expect(messageCopiedAnnouncement({ format: "markdown", lang: "ru" })).toBe(
      "Скопировано как Markdown",
    );
  });

  it("RU plain → 'Скопировано как текст'", () => {
    expect(messageCopiedAnnouncement({ format: "plain", lang: "ru" })).toBe(
      "Скопировано как текст",
    );
  });

  it("KZ markdown → 'Markdown ретінде көшірілді'", () => {
    expect(messageCopiedAnnouncement({ format: "markdown", lang: "kz" })).toBe(
      "Markdown ретінде көшірілді",
    );
  });

  it("KZ plain → 'Қарапайым мәтін ретінде көшірілді'", () => {
    expect(messageCopiedAnnouncement({ format: "plain", lang: "kz" })).toBe(
      "Қарапайым мәтін ретінде көшірілді",
    );
  });

  it("unknown format → defaults to markdown", () => {
    expect(
      // @ts-expect-error — runtime guard
      messageCopiedAnnouncement({ format: "rtf", lang: "ru" }),
    ).toBe("Скопировано как Markdown");
  });

  it("unknown lang → defaults to RU", () => {
    expect(
      // @ts-expect-error — runtime guard
      messageCopiedAnnouncement({ format: "markdown", lang: "en" }),
    ).toBe("Скопировано как Markdown");
  });

  it("KZ branch is independent of unknown format guard", () => {
    expect(
      // @ts-expect-error — runtime guard
      messageCopiedAnnouncement({ format: "html", lang: "kz" }),
    ).toBe("Markdown ретінде көшірілді");
  });

  it("RU and KZ markdown strings differ", () => {
    expect(
      messageCopiedAnnouncement({ format: "markdown", lang: "ru" }),
    ).not.toBe(messageCopiedAnnouncement({ format: "markdown", lang: "kz" }));
  });

  it("RU plain and RU markdown strings differ", () => {
    expect(messageCopiedAnnouncement({ format: "plain", lang: "ru" })).not.toBe(
      messageCopiedAnnouncement({ format: "markdown", lang: "ru" }),
    );
  });

  it("output is a non-empty string for every legal combination", () => {
    const cases: Array<MessageCopiedAnnouncementArgsAny> = [
      { format: "markdown", lang: "ru" },
      { format: "markdown", lang: "kz" },
      { format: "plain", lang: "ru" },
      { format: "plain", lang: "kz" },
    ];
    for (const c of cases) {
      const out = messageCopiedAnnouncement(c);
      expect(typeof out).toBe("string");
      expect(out.length).toBeGreaterThan(0);
    }
  });
});

// Local alias to keep the test self-contained without re-exporting.
type MessageCopiedAnnouncementArgsAny = {
  format: "markdown" | "plain";
  lang: "ru" | "kz";
};
