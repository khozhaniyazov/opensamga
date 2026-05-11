/**
 * s35 wave 72 (2026-04-29) — sanitizer ↔ track() integration pin.
 *
 * The unit-level sanitizer pins (w68) cover the pure
 * `sanitizeProps` helper in isolation. The flush pins (w71) cover
 * the wire transport. What was missing: an end-to-end pin that
 * emits a real event THROUGH `track()` (not via direct buffer
 * mutation) and asserts the SANITIZED form is what landed in the
 * buffer.
 *
 * If a future refactor wires a new emit path that bypasses
 * `track()` (e.g. a "fast path" that pushes directly to BUFFER),
 * this test will catch it — peekBuffer() would return un-sanitized
 * data and the PII assertion fails.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  drainBuffer,
  peekBuffer,
  track,
  trackChatMessageSent,
} from "../telemetry";

beforeEach(() => {
  drainBuffer();
});
afterEach(() => {
  drainBuffer();
});

describe("track() ↔ sanitizer integration", () => {
  it("redacts PII keys when a caller emits raw track()", () => {
    track("regression_probe", {
      email: "user@samga.kz",
      iin: "880101400000",
      auth_token: "bearer-abc",
      // non-PII fields pass through.
      book_id: 42,
      page_number: 7,
    });
    const buf = peekBuffer();
    expect(buf.length).toBe(1);
    expect(buf[0].props).toEqual({
      email: "***",
      iin: "***",
      auth_token: "***",
      book_id: 42,
      page_number: 7,
    });
  });

  it("typed wrappers (e.g. trackChatMessageSent) also flow through the sanitizer", () => {
    // We pass extra non-typed keys via `as` cast to simulate a
    // hypothetical future wave that adds an `email` field to the
    // typed payload. The sanitizer must redact it regardless of
    // whether the wrapper or the raw track() is the entry point.
    trackChatMessageSent({
      locale: "ru",
      source: "composer",
      has_text_len: 24,
      // @ts-expect-error — intentionally passing an off-shape key
      email: "leak@samga.kz",
    });
    const buf = peekBuffer();
    expect(buf.length).toBe(1);
    expect(buf[0].props.email).toBe("***");
    // Legitimate fields preserved.
    expect(buf[0].props.locale).toBe("ru");
    expect(buf[0].props.source).toBe("composer");
    expect(buf[0].props.has_text_len).toBe(24);
  });

  it("truncates long string values regardless of the call site", () => {
    const huge = "x".repeat(1024);
    track("regression_probe_long", { note: huge });
    const buf = peekBuffer();
    const note = buf[0].props.note as string;
    // Exact length pinned in telemetrySanitize.test.ts; here we
    // just assert the truncation happened (the sanitizer ran).
    expect(note.length).toBeLessThan(huge.length);
    expect(note.endsWith("…")).toBe(true);
  });

  it("recursive sanitize protects nested PII smuggling", () => {
    track("regression_probe_nested", {
      user: { id: 1, profile: { email: "x@y.kz" } },
    });
    const buf = peekBuffer();
    const user = buf[0].props.user as { profile: { email: string } };
    expect(user.profile.email).toBe("***");
  });
});
