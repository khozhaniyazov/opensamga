/**
 * s32 (H1) — vitest pins for the stream-complete a11y helpers.
 */

import { describe, expect, it } from "vitest";
import {
  ANNOUNCEMENT_TTL_MS,
  announcementMessageFor,
  politenessFor,
} from "../StreamCompleteAnnouncer";

describe("politenessFor", () => {
  it("is assertive only on the true→false transition", () => {
    expect(politenessFor(false, true)).toBe("assertive");
  });

  it("stays polite while sending", () => {
    expect(politenessFor(true, false)).toBe("polite");
    expect(politenessFor(true, true)).toBe("polite");
  });

  it("stays polite at idle", () => {
    expect(politenessFor(false, false)).toBe("polite");
  });

  it("stays polite on first mount (prev=null)", () => {
    // No prior state means we can't know whether streaming just
    // ended; default to polite so a hard-reload while idle doesn't
    // shout into the SR.
    expect(politenessFor(false, null)).toBe("polite");
    expect(politenessFor(true, null)).toBe("polite");
  });
});

describe("announcementMessageFor", () => {
  const LABEL_RU = "Ответ готов";

  it("emits the label on true→false transition", () => {
    expect(announcementMessageFor(false, true, LABEL_RU)).toBe(LABEL_RU);
  });

  it("returns empty string outside the transition", () => {
    expect(announcementMessageFor(true, false, LABEL_RU)).toBe("");
    expect(announcementMessageFor(true, true, LABEL_RU)).toBe("");
    expect(announcementMessageFor(false, false, LABEL_RU)).toBe("");
  });

  it("does not announce on first mount when idle (prev=null)", () => {
    // Reopening a thread that's already done shouldn't announce —
    // user didn't trigger the stream this session.
    expect(announcementMessageFor(false, null, LABEL_RU)).toBe("");
  });

  it("does not announce when first mount catches mid-stream", () => {
    expect(announcementMessageFor(true, null, LABEL_RU)).toBe("");
  });
});

describe("ANNOUNCEMENT_TTL_MS", () => {
  it("is the documented constant (1500ms)", () => {
    // Pin so a future tweak comes through tests, not silently.
    expect(ANNOUNCEMENT_TTL_MS).toBe(1500);
  });
});
