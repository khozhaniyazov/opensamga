/**
 * s35 wave 68 (2026-04-28) — telemetrySanitize pure pins.
 */

import { describe, expect, it } from "vitest";
import { MAX_DEPTH, MAX_STRING_LEN, sanitizeProps } from "../telemetrySanitize";

describe("sanitizeProps — PII key redaction", () => {
  it("redacts top-level `email`", () => {
    expect(sanitizeProps({ email: "user@example.com" })).toEqual({
      email: "***",
    });
  });

  it("redacts `phone` / `phone_number`", () => {
    expect(sanitizeProps({ phone: "+77001234567" })).toEqual({
      phone: "***",
    });
    expect(sanitizeProps({ phone_number: "+77001234567" })).toEqual({
      phone_number: "***",
    });
  });

  it("redacts `password`, `auth_token`, `api_secret`, `iin`", () => {
    expect(
      sanitizeProps({
        password: "hunter2",
        auth_token: "abc",
        api_secret: "xyz",
        iin: "880101400000",
      }),
    ).toEqual({
      password: "***",
      auth_token: "***",
      api_secret: "***",
      iin: "***",
    });
  });

  it("is case-insensitive on the key match", () => {
    expect(sanitizeProps({ Email: "x", USER_TOKEN: "y" })).toEqual({
      Email: "***",
      USER_TOKEN: "***",
    });
  });

  it("redacts in nested objects too", () => {
    expect(sanitizeProps({ user: { id: 1, email: "u@x.kz" } })).toEqual({
      user: { id: 1, email: "***" },
    });
  });

  it("redacts inside an array of objects", () => {
    expect(
      sanitizeProps({ items: [{ email: "a@b.c" }, { email: "x@y.z" }] }),
    ).toEqual({ items: [{ email: "***" }, { email: "***" }] });
  });
});

describe("sanitizeProps — non-PII pass-through", () => {
  it("preserves numeric / boolean / null scalars verbatim", () => {
    expect(sanitizeProps({ n: 42, b: true, z: null, x: undefined })).toEqual({
      n: 42,
      b: true,
      z: null,
      x: undefined,
    });
  });

  it("preserves short strings verbatim", () => {
    expect(sanitizeProps({ source: "composer" })).toEqual({
      source: "composer",
    });
  });

  it("preserves arrays of scalars", () => {
    expect(sanitizeProps({ ids: [1, 2, 3] })).toEqual({ ids: [1, 2, 3] });
  });

  it("preserves dashboard-relevant numeric fields the spree depends on", () => {
    // Pin: nothing in the sanitizer cares about names like
    // `book_id`, `page_number`, `match_count`, `dwell_ms_since_mount`.
    // These all flow through.
    expect(
      sanitizeProps({
        book_id: 42,
        page_number: 7,
        match_count: 5,
        dwell_ms_since_mount: 1234,
        is_streaming: false,
        command_id: "cite",
      }),
    ).toEqual({
      book_id: 42,
      page_number: 7,
      match_count: 5,
      dwell_ms_since_mount: 1234,
      is_streaming: false,
      command_id: "cite",
    });
  });
});

describe("sanitizeProps — string length cap", () => {
  it("truncates strings longer than MAX_STRING_LEN with an ellipsis", () => {
    const long = "a".repeat(MAX_STRING_LEN * 2);
    const out = sanitizeProps({ note: long }) as { note: string };
    expect(out.note.length).toBe(MAX_STRING_LEN + 1); // +1 for "…"
    expect(out.note.endsWith("…")).toBe(true);
  });

  it("does NOT truncate strings at exactly MAX_STRING_LEN", () => {
    const exact = "b".repeat(MAX_STRING_LEN);
    const out = sanitizeProps({ note: exact }) as { note: string };
    expect(out.note).toBe(exact);
  });
});

describe("sanitizeProps — depth cap", () => {
  it("replaces values past MAX_DEPTH with '[depth-cut]'", () => {
    let nested: Record<string, unknown> = { leaf: "deep" };
    for (let i = 0; i < MAX_DEPTH + 2; i++) {
      nested = { wrap: nested };
    }
    const out = sanitizeProps(nested);
    // Walk down and find a "[depth-cut]" sentinel somewhere.
    let cur: unknown = out;
    let foundCut = false;
    for (let i = 0; i < MAX_DEPTH + 4; i++) {
      if (cur === "[depth-cut]") {
        foundCut = true;
        break;
      }
      if (
        cur &&
        typeof cur === "object" &&
        "wrap" in (cur as Record<string, unknown>)
      ) {
        cur = (cur as Record<string, unknown>).wrap;
        continue;
      }
      break;
    }
    expect(foundCut).toBe(true);
  });
});

describe("sanitizeProps — exotic values", () => {
  it("coerces functions to '[function]'", () => {
    expect(sanitizeProps({ fn: () => 1 })).toEqual({ fn: "[function]" });
  });

  it("coerces symbols to '[symbol]'", () => {
    expect(sanitizeProps({ s: Symbol("x") })).toEqual({ s: "[symbol]" });
  });

  it("returns {} when given a non-object input", () => {
    // sanitizeProps is typed Record<string, unknown> so this is a
    // belt-and-braces guard; if a caller (or a future emit site)
    // passes something weird at runtime we don't crash.
    expect(sanitizeProps(null as unknown as Record<string, unknown>)).toEqual(
      {},
    );
    expect(sanitizeProps("oops" as unknown as Record<string, unknown>)).toEqual(
      {},
    );
  });
});

describe("sanitizeProps — purity", () => {
  it("does not mutate the input", () => {
    const input = { a: 1, b: { c: 2 }, email: "x@y.z" };
    const before = JSON.stringify(input);
    sanitizeProps(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
