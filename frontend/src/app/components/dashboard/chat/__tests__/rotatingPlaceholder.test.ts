/**
 * s31 (B4) — vitest pin tests for rotatingPlaceholder pure helpers.
 */

import { describe, expect, it } from "vitest";
import {
  PLACEHOLDERS_KZ,
  PLACEHOLDERS_RU,
  ROTATION_INTERVAL_MS,
  nextPlaceholderIndex,
  pickPlaceholder,
  placeholdersFor,
} from "../rotatingPlaceholder";

describe("PLACEHOLDERS contract", () => {
  it("ships exactly five RU suggestions", () => {
    // Pinned to 5 — bumping this changes the rotation cadence visible
    // to the user; the bump should be intentional and reflected in
    // the B4 row of the roadmap.
    expect(PLACEHOLDERS_RU).toHaveLength(5);
  });

  it("ships exactly five KZ suggestions", () => {
    expect(PLACEHOLDERS_KZ).toHaveLength(5);
  });

  it("RU index 0 matches the historic chat.placeholder copy", () => {
    // Critical: the first paint must look identical to before B4 so
    // returning users don't see a flicker on load.
    expect(PLACEHOLDERS_RU[0]).toBe(
      "Спросите про тему, результат или университет...",
    );
  });

  it("KZ index 0 matches the historic chat.placeholder copy", () => {
    expect(PLACEHOLDERS_KZ[0]).toBe(
      "Тақырып, нәтиже немесе ЖОО туралы сұраңыз...",
    );
  });

  it("ROTATION_INTERVAL_MS is pinned to 4500", () => {
    // Bumping this changes the perceived "calmness" of the empty
    // composer; if you raise it, raise it on purpose.
    expect(ROTATION_INTERVAL_MS).toBe(4500);
  });
});

describe("placeholdersFor", () => {
  it("returns RU list for ru", () => {
    expect(placeholdersFor("ru")).toBe(PLACEHOLDERS_RU);
  });

  it("returns KZ list for kz", () => {
    expect(placeholdersFor("kz")).toBe(PLACEHOLDERS_KZ);
  });
});

describe("pickPlaceholder", () => {
  it("returns the entry at the given index", () => {
    expect(pickPlaceholder(PLACEHOLDERS_RU, 0)).toBe(PLACEHOLDERS_RU[0]);
    expect(pickPlaceholder(PLACEHOLDERS_RU, 2)).toBe(PLACEHOLDERS_RU[2]);
  });

  it("wraps via modulo for indices past the end", () => {
    // The rotation timer increments forever — wrap is the contract,
    // not a bug.
    expect(pickPlaceholder(PLACEHOLDERS_RU, 5)).toBe(PLACEHOLDERS_RU[0]);
    expect(pickPlaceholder(PLACEHOLDERS_RU, 7)).toBe(PLACEHOLDERS_RU[2]);
  });

  it("wraps negative indices defensively", () => {
    expect(pickPlaceholder(PLACEHOLDERS_RU, -1)).toBe(
      PLACEHOLDERS_RU[PLACEHOLDERS_RU.length - 1],
    );
    expect(pickPlaceholder(PLACEHOLDERS_RU, -6)).toBe(
      PLACEHOLDERS_RU[PLACEHOLDERS_RU.length - 1],
    );
  });

  it("returns empty string on an empty list", () => {
    // Defensive: a future refactor that empties the list shouldn't
    // crash the composer's render.
    expect(pickPlaceholder([], 0)).toBe("");
  });

  it("falls back to index 0 on non-finite indices", () => {
    expect(pickPlaceholder(PLACEHOLDERS_RU, Number.NaN)).toBe(
      PLACEHOLDERS_RU[0],
    );
    expect(pickPlaceholder(PLACEHOLDERS_RU, Number.POSITIVE_INFINITY)).toBe(
      PLACEHOLDERS_RU[0],
    );
  });
});

describe("nextPlaceholderIndex", () => {
  it("increments by one within the cycle", () => {
    expect(nextPlaceholderIndex(0, 5)).toBe(1);
    expect(nextPlaceholderIndex(3, 5)).toBe(4);
  });

  it("wraps from the last index back to 0", () => {
    expect(nextPlaceholderIndex(4, 5)).toBe(0);
  });

  it("returns 0 on a non-positive length", () => {
    // Defensive — a zero-length list should never crash the timer.
    expect(nextPlaceholderIndex(2, 0)).toBe(0);
    expect(nextPlaceholderIndex(2, -1)).toBe(0);
  });

  it("returns 0 on a non-finite current index", () => {
    expect(nextPlaceholderIndex(Number.NaN, 5)).toBe(0);
    expect(nextPlaceholderIndex(Number.POSITIVE_INFINITY, 5)).toBe(0);
  });
});
