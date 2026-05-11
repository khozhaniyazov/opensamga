/**
 * s35 wave 39 (2026-04-28) — vitest pin tests for the network-error
 * SR live-region helpers.
 */

import { describe, expect, it } from "vitest";
import {
  networkErrorAnnouncementText,
  networkErrorReasonForStatus,
  shouldAnnounceNetworkError,
} from "../networkErrorAnnouncement";

describe("networkErrorAnnouncementText — RU happy paths", () => {
  it("limit", () => {
    expect(networkErrorAnnouncementText({ reason: "limit", lang: "ru" })).toBe(
      "Достигнут дневной лимит сообщений",
    );
  });
  it("paywall", () => {
    expect(
      networkErrorAnnouncementText({ reason: "paywall", lang: "ru" }),
    ).toBe("Нужна подписка для этой возможности");
  });
  it("network", () => {
    expect(
      networkErrorAnnouncementText({ reason: "network", lang: "ru" }),
    ).toBe(
      "Не удалось отправить сообщение. Проверьте соединение и попробуйте ещё раз",
    );
  });
  it("generic shares network copy", () => {
    expect(
      networkErrorAnnouncementText({ reason: "generic", lang: "ru" }),
    ).toBe(networkErrorAnnouncementText({ reason: "network", lang: "ru" }));
  });
});

describe("networkErrorAnnouncementText — KZ happy paths", () => {
  it("limit", () => {
    expect(networkErrorAnnouncementText({ reason: "limit", lang: "kz" })).toBe(
      "Күндік хабарлама шегіне жетті",
    );
  });
  it("paywall", () => {
    expect(
      networkErrorAnnouncementText({ reason: "paywall", lang: "kz" }),
    ).toBe("Бұл мүмкіндік үшін жазылым қажет");
  });
  it("network", () => {
    expect(
      networkErrorAnnouncementText({ reason: "network", lang: "kz" }),
    ).toBe("Хабарлама жіберілмеді. Желіні тексеріп, қайталап көріңіз");
  });
});

describe("networkErrorAnnouncementText — defensive", () => {
  it("unknown reason → generic", () => {
    expect(networkErrorAnnouncementText({ reason: "rate", lang: "ru" })).toBe(
      networkErrorAnnouncementText({ reason: "generic", lang: "ru" }),
    );
  });
  it("null reason → generic", () => {
    expect(networkErrorAnnouncementText({ reason: null, lang: "ru" })).toBe(
      networkErrorAnnouncementText({ reason: "generic", lang: "ru" }),
    );
  });
  it("undefined reason → generic", () => {
    expect(
      networkErrorAnnouncementText({ reason: undefined, lang: "ru" }),
    ).toBe(networkErrorAnnouncementText({ reason: "generic", lang: "ru" }));
  });
  it("non-string reason → generic", () => {
    expect(networkErrorAnnouncementText({ reason: 429, lang: "ru" })).toBe(
      networkErrorAnnouncementText({ reason: "generic", lang: "ru" }),
    );
  });
  it("unknown lang → ru", () => {
    expect(networkErrorAnnouncementText({ reason: "limit", lang: "fr" })).toBe(
      "Достигнут дневной лимит сообщений",
    );
  });
  it("null lang → ru", () => {
    expect(networkErrorAnnouncementText({ reason: "limit", lang: null })).toBe(
      "Достигнут дневной лимит сообщений",
    );
  });
});

describe("networkErrorReasonForStatus — happy paths", () => {
  it("429 → limit", () => {
    expect(networkErrorReasonForStatus(429)).toBe("limit");
  });
  it("403 → paywall", () => {
    expect(networkErrorReasonForStatus(403)).toBe("paywall");
  });
  it("408 → network", () => {
    expect(networkErrorReasonForStatus(408)).toBe("network");
  });
  it("502 → network", () => {
    expect(networkErrorReasonForStatus(502)).toBe("network");
  });
  it("504 → network", () => {
    expect(networkErrorReasonForStatus(504)).toBe("network");
  });
  it("0 (no-network/aborted) → network", () => {
    expect(networkErrorReasonForStatus(0)).toBe("network");
  });
  it("500 → generic (server error, not connectivity)", () => {
    expect(networkErrorReasonForStatus(500)).toBe("generic");
  });
  it("400 → generic", () => {
    expect(networkErrorReasonForStatus(400)).toBe("generic");
  });
});

describe("networkErrorReasonForStatus — defensive", () => {
  it("undefined → generic", () => {
    expect(networkErrorReasonForStatus(undefined)).toBe("generic");
  });
  it("null → generic", () => {
    expect(networkErrorReasonForStatus(null)).toBe("generic");
  });
  it("non-number → generic", () => {
    expect(networkErrorReasonForStatus("429")).toBe("generic");
  });
  it("NaN → generic", () => {
    expect(networkErrorReasonForStatus(NaN)).toBe("generic");
  });
  it("Infinity → generic", () => {
    expect(networkErrorReasonForStatus(Infinity)).toBe("generic");
  });
});

describe("shouldAnnounceNetworkError — dedupe", () => {
  it("first error (lastAnnouncedId null) → announce", () => {
    expect(
      shouldAnnounceNetworkError({
        errorId: "abc",
        lastAnnouncedId: null,
      }),
    ).toBe(true);
  });

  it("same id as last → suppress", () => {
    expect(
      shouldAnnounceNetworkError({
        errorId: "abc",
        lastAnnouncedId: "abc",
      }),
    ).toBe(false);
  });

  it("different id from last → announce", () => {
    expect(
      shouldAnnounceNetworkError({
        errorId: "xyz",
        lastAnnouncedId: "abc",
      }),
    ).toBe(true);
  });

  it("null errorId → suppress (no error to announce)", () => {
    expect(
      shouldAnnounceNetworkError({
        errorId: null,
        lastAnnouncedId: null,
      }),
    ).toBe(false);
  });

  it("undefined errorId → suppress", () => {
    expect(
      shouldAnnounceNetworkError({
        errorId: undefined,
        lastAnnouncedId: "abc",
      }),
    ).toBe(false);
  });

  it("empty-string errorId → suppress", () => {
    expect(
      shouldAnnounceNetworkError({
        errorId: "",
        lastAnnouncedId: null,
      }),
    ).toBe(false);
  });

  it("non-string errorId → suppress", () => {
    expect(
      shouldAnnounceNetworkError({
        errorId: 42,
        lastAnnouncedId: null,
      }),
    ).toBe(false);
    expect(
      shouldAnnounceNetworkError({
        errorId: { id: "abc" },
        lastAnnouncedId: null,
      }),
    ).toBe(false);
  });
});

describe("network-error helpers — purity", () => {
  it("text helper: same input → same output", () => {
    const a = networkErrorAnnouncementText({ reason: "limit", lang: "ru" });
    networkErrorAnnouncementText({ reason: "network", lang: "kz" });
    const b = networkErrorAnnouncementText({ reason: "limit", lang: "ru" });
    expect(a).toBe(b);
  });
  it("status helper: same input → same output", () => {
    expect(networkErrorReasonForStatus(429)).toBe(
      networkErrorReasonForStatus(429),
    );
  });
  it("dedupe helper: same input → same output", () => {
    const args = { errorId: "abc", lastAnnouncedId: null };
    expect(shouldAnnounceNetworkError(args)).toBe(
      shouldAnnounceNetworkError(args),
    );
  });
});
