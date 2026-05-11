/**
 * s31 wave 2 (F3) — vitest pin tests for the per-thread draft
 * helpers.
 *
 * The helpers accept an injectable `storage: StorageLike` so we can
 * exercise every branch (private-mode failure, expiry, shape drift,
 * thread isolation) without jsdom.
 */

import { describe, expect, it } from "vitest";
import {
  DRAFT_KEY_LEGACY,
  DRAFT_KEY_PREFIX,
  DRAFT_TTL_MS,
  clearDraft,
  draftKeyFor,
  loadDraft,
  saveDraft,
  type StorageLike,
} from "../draftStorage";

function makeMemoryStorage(): StorageLike & { _data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    _data: data,
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}

describe("draftKeyFor", () => {
  it("returns the legacy key for null/undefined", () => {
    // The unsaved/orphan composer (no thread yet created) must keep
    // landing on the legacy key so existing s22-era drafts continue
    // to load.
    expect(draftKeyFor(null)).toBe(DRAFT_KEY_LEGACY);
    expect(draftKeyFor(undefined)).toBe(DRAFT_KEY_LEGACY);
  });

  it("returns the legacy key for non-positive ids", () => {
    expect(draftKeyFor(0)).toBe(DRAFT_KEY_LEGACY);
    expect(draftKeyFor(-1)).toBe(DRAFT_KEY_LEGACY);
  });

  it("returns the legacy key for non-finite or non-integer values", () => {
    expect(draftKeyFor(Number.NaN)).toBe(DRAFT_KEY_LEGACY);
    expect(draftKeyFor(Number.POSITIVE_INFINITY)).toBe(DRAFT_KEY_LEGACY);
    expect(draftKeyFor(1.5)).toBe(DRAFT_KEY_LEGACY);
  });

  it("returns a per-thread key for positive integers", () => {
    expect(draftKeyFor(42)).toBe(`${DRAFT_KEY_PREFIX}42`);
    expect(draftKeyFor(7)).toBe(`${DRAFT_KEY_PREFIX}7`);
  });
});

describe("saveDraft / loadDraft round-trip", () => {
  it("round-trips a per-thread draft", () => {
    const s = makeMemoryStorage();
    saveDraft("hello 42", 42, () => 1000, s);
    expect(loadDraft(42, () => 1000, s)).toBe("hello 42");
  });

  it("round-trips the legacy draft when threadId is null", () => {
    const s = makeMemoryStorage();
    saveDraft("orphan", null, () => 1000, s);
    expect(loadDraft(null, () => 1000, s)).toBe("orphan");
    expect(s._data.has(DRAFT_KEY_LEGACY)).toBe(true);
  });

  it("isolates drafts across threads", () => {
    // The whole point of F3: thread A's typing must not leak into
    // thread B's composer.
    const s = makeMemoryStorage();
    saveDraft("draft for A", 1, () => 1000, s);
    saveDraft("draft for B", 2, () => 1000, s);
    expect(loadDraft(1, () => 1000, s)).toBe("draft for A");
    expect(loadDraft(2, () => 1000, s)).toBe("draft for B");
  });

  it("does not collide between thread 1 and the legacy key", () => {
    const s = makeMemoryStorage();
    saveDraft("legacy text", null, () => 1000, s);
    saveDraft("thread 1 text", 1, () => 1000, s);
    expect(loadDraft(null, () => 1000, s)).toBe("legacy text");
    expect(loadDraft(1, () => 1000, s)).toBe("thread 1 text");
  });
});

describe("saveDraft whitespace handling", () => {
  it("clears the per-thread key on whitespace-only input", () => {
    const s = makeMemoryStorage();
    saveDraft("hello", 5, () => 1000, s);
    expect(loadDraft(5, () => 1000, s)).toBe("hello");
    saveDraft("   \n  ", 5, () => 2000, s);
    expect(loadDraft(5, () => 2000, s)).toBe("");
  });

  it("does not touch other threads' drafts when clearing", () => {
    const s = makeMemoryStorage();
    saveDraft("keep me", 1, () => 1000, s);
    saveDraft("", 2, () => 1000, s);
    expect(loadDraft(1, () => 1000, s)).toBe("keep me");
  });
});

describe("loadDraft expiry + shape drift", () => {
  it("returns empty string and removes the key when the payload is older than TTL", () => {
    const s = makeMemoryStorage();
    saveDraft("stale", 9, () => 1000, s);
    const future = 1000 + DRAFT_TTL_MS + 1;
    expect(loadDraft(9, () => future, s)).toBe("");
    expect(s._data.has(`${DRAFT_KEY_PREFIX}9`)).toBe(false);
  });

  it("discards entries with the wrong schema version", () => {
    const s = makeMemoryStorage();
    s.setItem(
      `${DRAFT_KEY_PREFIX}3`,
      JSON.stringify({ v: 999, text: "alien", at: 1000 }),
    );
    expect(loadDraft(3, () => 1000, s)).toBe("");
    expect(s._data.has(`${DRAFT_KEY_PREFIX}3`)).toBe(false);
  });

  it("discards JSON corruption silently", () => {
    const s = makeMemoryStorage();
    s.setItem(`${DRAFT_KEY_PREFIX}4`, "{not json");
    expect(loadDraft(4, () => 1000, s)).toBe("");
    // Corrupted entry is removed so subsequent reads short-circuit.
    expect(s._data.has(`${DRAFT_KEY_PREFIX}4`)).toBe(false);
  });
});

describe("clearDraft", () => {
  it("removes only the per-thread key", () => {
    const s = makeMemoryStorage();
    saveDraft("A", 1, () => 1000, s);
    saveDraft("B", 2, () => 1000, s);
    clearDraft(1, s);
    expect(loadDraft(1, () => 1000, s)).toBe("");
    expect(loadDraft(2, () => 1000, s)).toBe("B");
  });

  it("is idempotent on a missing key", () => {
    const s = makeMemoryStorage();
    expect(() => clearDraft(99, s)).not.toThrow();
  });

  it("clears the legacy key when threadId is null/undefined", () => {
    const s = makeMemoryStorage();
    saveDraft("orphan", null, () => 1000, s);
    clearDraft(null, s);
    expect(s._data.has(DRAFT_KEY_LEGACY)).toBe(false);
  });
});

describe("storage failure", () => {
  it("loadDraft returns empty string when storage is null", () => {
    expect(loadDraft(1, () => 1000, null)).toBe("");
  });

  it("saveDraft is a no-op when storage is null", () => {
    expect(() => saveDraft("x", 1, () => 1000, null)).not.toThrow();
  });

  it("clearDraft is a no-op when storage is null", () => {
    expect(() => clearDraft(1, null)).not.toThrow();
  });

  it("loadDraft swallows getItem throws", () => {
    const throwy: StorageLike = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(loadDraft(1, () => 1000, throwy)).toBe("");
  });
});
