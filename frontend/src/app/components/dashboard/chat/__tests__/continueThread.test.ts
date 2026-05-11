/**
 * s34 wave 8 (E6, 2026-04-28): vitest pins for continueThread.ts.
 *
 * The selector + recency math drives the home-page teaser, so any
 * future refactor that breaks the eligibility rules ("don't surface
 * the legacy bucket", "don't surface 0-message rows", "don't
 * surface stale threads") will regress the home page silently
 * without these pins.
 */

import { describe, expect, it } from "vitest";
import {
  RECENT_THREAD_TITLE_MAX_CHARS,
  RECENT_THREAD_WINDOW_DAYS,
  buildTeaserHref,
  formatLastActiveLabel,
  isThreadRecentlyActive,
  parseUpdatedAt,
  resolveTeaserTitle,
  selectMostRecentThread,
} from "../continueThread";
import type { ChatThread } from "../MessagesContext";

const NOW = new Date("2026-04-28T12:00:00.000Z");

function makeThread(over: Partial<ChatThread> = {}): ChatThread {
  return {
    id: 1,
    title: "Math review",
    created_at: "2026-04-20T08:00:00Z",
    updated_at: "2026-04-28T11:00:00Z",
    message_count: 5,
    ...over,
  };
}

describe("RECENT_THREAD_WINDOW_DAYS", () => {
  it("is 30 days (boss-stated; bump together with home-page copy)", () => {
    expect(RECENT_THREAD_WINDOW_DAYS).toBe(30);
  });
});

describe("RECENT_THREAD_TITLE_MAX_CHARS", () => {
  it("is 60 (matches home-page tile single-line budget)", () => {
    expect(RECENT_THREAD_TITLE_MAX_CHARS).toBe(60);
  });
});

describe("parseUpdatedAt", () => {
  it("parses an ISO-8601 string", () => {
    expect(parseUpdatedAt("2026-04-28T11:00:00Z")?.getTime()).toBe(
      Date.UTC(2026, 3, 28, 11, 0, 0),
    );
  });

  it("returns null on null/undefined", () => {
    expect(parseUpdatedAt(null)).toBeNull();
    expect(parseUpdatedAt(undefined)).toBeNull();
  });

  it("returns null on non-string values", () => {
    expect(parseUpdatedAt(42 as unknown as string)).toBeNull();
  });

  it("returns null on garbage", () => {
    expect(parseUpdatedAt("not a date")).toBeNull();
  });
});

describe("isThreadRecentlyActive", () => {
  it("treats today as recent", () => {
    expect(isThreadRecentlyActive("2026-04-28T11:00:00Z", NOW)).toBe(true);
  });

  it("treats 29 days ago as recent", () => {
    const d = new Date(NOW.getTime() - 29 * 24 * 60 * 60 * 1000);
    expect(isThreadRecentlyActive(d.toISOString(), NOW)).toBe(true);
  });

  it("treats 31 days ago as stale", () => {
    const d = new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000);
    expect(isThreadRecentlyActive(d.toISOString(), NOW)).toBe(false);
  });

  it("treats future timestamps as fresh (clock skew tolerance)", () => {
    const d = new Date(NOW.getTime() + 60_000);
    expect(isThreadRecentlyActive(d.toISOString(), NOW)).toBe(true);
  });

  it("returns false on null", () => {
    expect(isThreadRecentlyActive(null, NOW)).toBe(false);
  });
});

describe("selectMostRecentThread", () => {
  it("returns null on empty / non-array input", () => {
    expect(selectMostRecentThread([], NOW)).toBeNull();
    expect(selectMostRecentThread(null, NOW)).toBeNull();
    expect(selectMostRecentThread(undefined, NOW)).toBeNull();
  });

  it("picks the most-recently-updated thread", () => {
    const threads: ChatThread[] = [
      makeThread({ id: 1, updated_at: "2026-04-25T08:00:00Z" }),
      makeThread({ id: 2, updated_at: "2026-04-28T08:00:00Z" }),
      makeThread({ id: 3, updated_at: "2026-04-26T08:00:00Z" }),
    ];
    expect(selectMostRecentThread(threads, NOW)?.thread.id).toBe(2);
  });

  it("excludes the legacy bucket", () => {
    const threads: ChatThread[] = [
      makeThread({
        id: null as unknown as number,
        isLegacy: true,
        updated_at: "2026-04-28T11:30:00Z",
      }),
      makeThread({ id: 7, updated_at: "2026-04-28T11:00:00Z" }),
    ];
    expect(selectMostRecentThread(threads, NOW)?.thread.id).toBe(7);
  });

  it("excludes empty (zero-message) threads", () => {
    const threads: ChatThread[] = [
      makeThread({
        id: 1,
        message_count: 0,
        updated_at: "2026-04-28T11:30:00Z",
      }),
      makeThread({
        id: 2,
        message_count: 3,
        updated_at: "2026-04-28T11:00:00Z",
      }),
    ];
    expect(selectMostRecentThread(threads, NOW)?.thread.id).toBe(2);
  });

  it("excludes stale threads beyond the window", () => {
    const threads: ChatThread[] = [
      makeThread({ id: 1, updated_at: "2026-01-01T00:00:00Z" }),
    ];
    expect(selectMostRecentThread(threads, NOW)).toBeNull();
  });

  it("breaks ties by id descending", () => {
    const threads: ChatThread[] = [
      makeThread({ id: 5, updated_at: "2026-04-28T11:00:00Z" }),
      makeThread({ id: 9, updated_at: "2026-04-28T11:00:00Z" }),
      makeThread({ id: 1, updated_at: "2026-04-28T11:00:00Z" }),
    ];
    expect(selectMostRecentThread(threads, NOW)?.thread.id).toBe(9);
  });

  it("propagates messageCount and updatedAt mirrors", () => {
    const result = selectMostRecentThread(
      [makeThread({ id: 1, message_count: 4 })],
      NOW,
    );
    expect(result?.messageCount).toBe(4);
    expect(result?.updatedAt).toBe("2026-04-28T11:00:00Z");
  });

  it("ignores rows with unparseable updated_at", () => {
    const threads: ChatThread[] = [
      makeThread({ id: 1, updated_at: "garbage" as unknown as string }),
    ];
    expect(selectMostRecentThread(threads, NOW)).toBeNull();
  });
});

describe("resolveTeaserTitle", () => {
  it("trims a normal title", () => {
    expect(resolveTeaserTitle({ title: "  Physics  " })).toBe("Physics");
  });

  it("falls back when title is empty", () => {
    expect(resolveTeaserTitle({ title: null }, "fallback")).toBe("fallback");
  });

  it("ellipsizes very long titles", () => {
    const long = "x".repeat(100);
    const out = resolveTeaserTitle({ title: long });
    expect(out.length).toBe(RECENT_THREAD_TITLE_MAX_CHARS);
    expect(out.endsWith("…")).toBe(true);
  });

  it("does not truncate a title at the boundary", () => {
    const exactly = "y".repeat(RECENT_THREAD_TITLE_MAX_CHARS);
    expect(resolveTeaserTitle({ title: exactly })).toBe(exactly);
  });
});

describe("formatLastActiveLabel", () => {
  it("renders 'just now' for under an hour, RU", () => {
    const ts = new Date(NOW.getTime() - 30 * 60 * 1000).toISOString();
    expect(formatLastActiveLabel(ts, "ru", NOW)).toBe("только что");
  });

  it("renders 'just now' for under an hour, KZ", () => {
    const ts = new Date(NOW.getTime() - 30 * 60 * 1000).toISOString();
    expect(formatLastActiveLabel(ts, "kz", NOW)).toBe("жаңа ғана");
  });

  it("renders 'today' same-day RU", () => {
    const ts = new Date("2026-04-28T02:00:00.000Z").toISOString();
    expect(formatLastActiveLabel(ts, "ru", NOW)).toBe("сегодня");
  });

  it("renders 'yesterday' RU", () => {
    const ts = new Date("2026-04-27T11:00:00.000Z").toISOString();
    expect(formatLastActiveLabel(ts, "ru", NOW)).toBe("вчера");
  });

  it("renders N days ago RU for 2..7", () => {
    const ts = new Date(NOW.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatLastActiveLabel(ts, "ru", NOW)).toBe("4 дн. назад");
  });

  it("renders ISO date for older entries", () => {
    const ts = "2026-04-10T11:00:00.000Z";
    expect(formatLastActiveLabel(ts, "ru", NOW)).toBe("2026-04-10");
  });

  it("returns empty string when timestamp is invalid", () => {
    expect(formatLastActiveLabel(null, "ru", NOW)).toBe("");
    expect(formatLastActiveLabel("garbage", "ru", NOW)).toBe("");
  });
});

describe("buildTeaserHref", () => {
  it("emits the deep-link with the thread param", () => {
    expect(buildTeaserHref({ id: 42 })).toBe("/dashboard/chat?thread=42");
  });

  it("falls back to the bare chat path on legacy/null id", () => {
    expect(buildTeaserHref({ id: null as unknown as number })).toBe(
      "/dashboard/chat",
    );
  });
});
