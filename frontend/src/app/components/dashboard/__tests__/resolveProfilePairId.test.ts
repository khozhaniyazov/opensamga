/**
 * v3.61 (2026-05-02) — resolveProfilePairId() contract pins.
 *
 * Backstory: B7 in the 2026-05-02 E2E report. A profile with
 * Math+Physics rendered as Math+Informatics in the Strategy Lab
 * "ВЫБРАННАЯ ПАРА" preview because StrategyLabPage used
 * SUBJECT_PAIRS[0].id (math-it) unconditionally as the initial
 * selected-pair state.
 *
 * The fix lifts a small pure helper into profilePairSimulatorModel
 * so we can default the selection to the user's actual profile
 * pair. These tests pin the helper's behavior in isolation; the
 * page-level integration is covered indirectly by an upcoming
 * StrategyLabPage contract test (left as a follow-up because
 * StrategyLabPage's render tree pulls AuthProvider + a chunky
 * universities mock — out of scope for this slice).
 */

import { describe, expect, it } from "vitest";

import {
  PROFILE_PAIR_FIRST_WAVE,
  resolveProfilePairId,
} from "../profilePairSimulatorModel";

describe("resolveProfilePairId (v3.61)", () => {
  it("returns null for null/undefined/empty input", () => {
    expect(resolveProfilePairId(null)).toBeNull();
    expect(resolveProfilePairId(undefined)).toBeNull();
    expect(resolveProfilePairId([])).toBeNull();
  });

  it("returns null for arrays of length 1 or 3+", () => {
    expect(resolveProfilePairId(["Mathematics"])).toBeNull();
    expect(
      resolveProfilePairId(["Mathematics", "Physics", "Chemistry"]),
    ).toBeNull();
  });

  it("matches a canonical pair regardless of element order", () => {
    expect(resolveProfilePairId(["Mathematics", "Physics"])).toBe("phys-math");
    expect(resolveProfilePairId(["Physics", "Mathematics"])).toBe("phys-math");
  });

  it("matches all five first-wave pairs by their canonical names", () => {
    expect(resolveProfilePairId(["Mathematics", "Informatics"])).toBe(
      "math-it",
    );
    expect(resolveProfilePairId(["Biology", "Chemistry"])).toBe("bio-chem");
    expect(resolveProfilePairId(["Mathematics", "Physics"])).toBe("phys-math");
    expect(resolveProfilePairId(["Geography", "Mathematics"])).toBe("geo-math");
    expect(resolveProfilePairId(["World History", "Fundamentals of Law"])).toBe(
      "history-law",
    );
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(resolveProfilePairId(["mathematics", "physics"])).toBe("phys-math");
    expect(resolveProfilePairId(["  Mathematics  ", "Physics"])).toBe(
      "phys-math",
    );
    expect(resolveProfilePairId(["MATHEMATICS", "PHYSICS"])).toBe("phys-math");
  });

  it("returns null for a pair that exists in the broader combination list but not first-wave", () => {
    // KazLang+KazLit is a valid PROFILE_SUBJECT_COMBINATIONS pair, but
    // not part of the simulator's first wave. Caller is expected to
    // fall back to a default (math-it) when null is returned.
    expect(
      resolveProfilePairId(["Kazakh Language", "Kazakh Literature"]),
    ).toBeNull();
  });

  it("returns null for a non-canonical pair (e.g. unrelated subjects)", () => {
    expect(resolveProfilePairId(["Mathematics", "Chemistry"])).toBeNull();
  });

  it("returns null for empty-string entries", () => {
    expect(resolveProfilePairId(["", ""])).toBeNull();
    expect(resolveProfilePairId(["Mathematics", ""])).toBeNull();
  });

  it("every first-wave pair is round-trippable through the resolver", () => {
    // Drift guard — if anyone renames a canonical English subject
    // without updating the simulator's first wave, this test fails
    // before the page silently breaks.
    for (const pair of PROFILE_PAIR_FIRST_WAVE) {
      expect(resolveProfilePairId(pair.subjects)).toBe(pair.id);
    }
  });
});
