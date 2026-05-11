/**
 * v3.12 (F5, 2026-04-30) — vitest pins for imageOcrCapability.
 * Pure helpers, no DOM.
 */

import { describe, expect, it } from "vitest";
import {
  ALLOWED_OCR_IMAGE_TYPES,
  detectImageOcrCapability,
  MAX_OCR_IMAGE_BYTES,
  ocrLangParam,
  ocrPreflightMessage,
  preflightOcrFile,
} from "../imageOcrCapability";

// ---------------------------------------------------------------------------
// preflightOcrFile
// ---------------------------------------------------------------------------

describe("preflightOcrFile", () => {
  const okPng = { type: "image/png", size: 1024 };
  const okJpeg = { type: "image/jpeg", size: 1024 };
  const okJpg = { type: "image/jpg", size: 1024 };

  it("happy path: png/jpeg/jpg under cap → ok", () => {
    expect(preflightOcrFile(okPng)).toBe("ok");
    expect(preflightOcrFile(okJpeg)).toBe("ok");
    expect(preflightOcrFile(okJpg)).toBe("ok");
  });

  it("uppercase / mixed-case content type → ok", () => {
    expect(preflightOcrFile({ type: "IMAGE/PNG", size: 1 })).toBe("ok");
    expect(preflightOcrFile({ type: "Image/Jpeg", size: 1 })).toBe("ok");
  });

  it("trims whitespace on content type", () => {
    expect(preflightOcrFile({ type: "  image/png  ", size: 1 })).toBe("ok");
  });

  it("rejects HEIC and other non-allow-list types", () => {
    expect(preflightOcrFile({ type: "image/heic", size: 1 })).toBe("bad-type");
    expect(preflightOcrFile({ type: "image/webp", size: 1 })).toBe("bad-type");
    expect(preflightOcrFile({ type: "image/gif", size: 1 })).toBe("bad-type");
    expect(preflightOcrFile({ type: "application/pdf", size: 1 })).toBe(
      "bad-type",
    );
  });

  it("missing/empty content type → bad-type", () => {
    expect(preflightOcrFile({ size: 1 })).toBe("bad-type");
    expect(preflightOcrFile({ type: "", size: 1 })).toBe("bad-type");
    expect(preflightOcrFile({ type: 123, size: 1 })).toBe("bad-type");
  });

  it("zero / negative size → empty", () => {
    expect(preflightOcrFile({ type: "image/png", size: 0 })).toBe("empty");
    expect(preflightOcrFile({ type: "image/png", size: -1 })).toBe("empty");
  });

  it("non-finite size → too-large (defensive)", () => {
    expect(preflightOcrFile({ type: "image/png", size: Number.NaN })).toBe(
      "too-large",
    );
    expect(preflightOcrFile({ type: "image/png", size: Infinity })).toBe(
      "too-large",
    );
  });

  it("missing or non-numeric size → too-large", () => {
    expect(preflightOcrFile({ type: "image/png" })).toBe("too-large");
    expect(preflightOcrFile({ type: "image/png", size: "1024" })).toBe(
      "too-large",
    );
  });

  it("size at cap → ok; over cap → too-large", () => {
    expect(
      preflightOcrFile({ type: "image/png", size: MAX_OCR_IMAGE_BYTES }),
    ).toBe("ok");
    expect(
      preflightOcrFile({ type: "image/png", size: MAX_OCR_IMAGE_BYTES + 1 }),
    ).toBe("too-large");
  });

  it("missing file argument → no-file", () => {
    expect(preflightOcrFile(null)).toBe("no-file");
    expect(preflightOcrFile(undefined)).toBe("no-file");
    expect(preflightOcrFile("not an object")).toBe("no-file");
    expect(preflightOcrFile(42)).toBe("no-file");
  });
});

// ---------------------------------------------------------------------------
// detectImageOcrCapability
// ---------------------------------------------------------------------------

describe("detectImageOcrCapability", () => {
  it("modern browser with FormData/File/fetch → true", () => {
    const fakeWin = {
      FormData: function () {},
      File: function () {},
      fetch: () => {},
    };
    expect(detectImageOcrCapability(fakeWin)).toBe(true);
  });

  it("missing any of the three primitives → false", () => {
    expect(
      detectImageOcrCapability({
        FormData: function () {},
        File: function () {},
      }),
    ).toBe(false);
    expect(
      detectImageOcrCapability({ FormData: function () {}, fetch: () => {} }),
    ).toBe(false);
    expect(
      detectImageOcrCapability({ File: function () {}, fetch: () => {} }),
    ).toBe(false);
  });

  it("SSR / null window → false", () => {
    // `undefined` would trigger the default parameter and pull the
    // ambient jsdom window, so we can't pin it here. `null` and
    // non-objects are the SSR / pre-Phase-A signals we actually care
    // about.
    expect(detectImageOcrCapability(null)).toBe(false);
    expect(detectImageOcrCapability("nope")).toBe(false);
    expect(detectImageOcrCapability(0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ocrPreflightMessage
// ---------------------------------------------------------------------------

describe("ocrPreflightMessage", () => {
  it("ok → empty string (caller suppresses toast)", () => {
    expect(ocrPreflightMessage("ok", "ru")).toBe("");
    expect(ocrPreflightMessage("ok", "kz")).toBe("");
  });

  it("bad-type mentions JPEG and PNG in both langs", () => {
    const ru = ocrPreflightMessage("bad-type", "ru");
    const kz = ocrPreflightMessage("bad-type", "kz");
    expect(ru).toContain("JPEG");
    expect(ru).toContain("PNG");
    expect(kz).toContain("JPEG");
    expect(kz).toContain("PNG");
    expect(ru).not.toBe(kz);
  });

  it("too-large mentions cap in MB", () => {
    const cap = MAX_OCR_IMAGE_BYTES / (1024 * 1024);
    const ru = ocrPreflightMessage("too-large", "ru");
    const kz = ocrPreflightMessage("too-large", "kz");
    expect(ru).toContain(String(cap));
    expect(kz).toContain(String(cap));
  });

  it("empty + no-file return non-empty localized strings", () => {
    expect(ocrPreflightMessage("empty", "ru")).not.toBe("");
    expect(ocrPreflightMessage("empty", "kz")).not.toBe("");
    expect(ocrPreflightMessage("no-file", "ru")).not.toBe("");
    expect(ocrPreflightMessage("no-file", "kz")).not.toBe("");
  });

  it("anything other than 'kz' falls back to RU", () => {
    expect(ocrPreflightMessage("bad-type", "en")).toBe(
      ocrPreflightMessage("bad-type", "ru"),
    );
    expect(ocrPreflightMessage("bad-type", null)).toBe(
      ocrPreflightMessage("bad-type", "ru"),
    );
    expect(ocrPreflightMessage("bad-type", undefined)).toBe(
      ocrPreflightMessage("bad-type", "ru"),
    );
  });
});

// ---------------------------------------------------------------------------
// ocrLangParam
// ---------------------------------------------------------------------------

describe("ocrLangParam", () => {
  it("'kz' → 'kz'", () => {
    expect(ocrLangParam("kz")).toBe("kz");
  });

  it("anything else → 'ru'", () => {
    expect(ocrLangParam("ru")).toBe("ru");
    expect(ocrLangParam("en")).toBe("ru");
    expect(ocrLangParam("")).toBe("ru");
    expect(ocrLangParam(null)).toBe("ru");
    expect(ocrLangParam(undefined)).toBe("ru");
    expect(ocrLangParam(42)).toBe("ru");
  });
});

// ---------------------------------------------------------------------------
// Pinned constants
// ---------------------------------------------------------------------------

describe("constants", () => {
  it("ALLOWED_OCR_IMAGE_TYPES matches BE allow-list", () => {
    expect([...ALLOWED_OCR_IMAGE_TYPES].sort()).toEqual(
      ["image/jpeg", "image/jpg", "image/png"].sort(),
    );
  });

  it("MAX_OCR_IMAGE_BYTES is 8 MiB", () => {
    expect(MAX_OCR_IMAGE_BYTES).toBe(8 * 1024 * 1024);
  });
});
