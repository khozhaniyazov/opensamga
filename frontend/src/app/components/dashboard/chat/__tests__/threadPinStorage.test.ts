/**
 * s32 (E2) — vitest pins for the localStorage-backed pin helpers.
 *
 * The hook side is wired in ThreadRail; we exercise the pure module
 * (load/save/toggle/sort) which carries the contract.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PINNED_KEY,
  MAX_PINNED,
  isThreadPinned,
  loadPinnedIds,
  savePinnedIds,
  sortThreadsWithPinned,
  togglePinnedId,
  type StorageLike,
} from "../threadPinStorage";

class MemoryStorage implements StorageLike {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

let mem: MemoryStorage;

beforeEach(() => {
  mem = new MemoryStorage();
});

afterEach(() => {
  mem = new MemoryStorage();
});

describe("loadPinnedIds", () => {
  it("returns [] on empty storage", () => {
    expect(loadPinnedIds(mem)).toEqual([]);
  });

  it("returns the persisted ids in saved order", () => {
    savePinnedIds([3, 1, 7], mem);
    expect(loadPinnedIds(mem)).toEqual([3, 1, 7]);
  });

  it("survives the round-trip after a savePinnedIds call", () => {
    savePinnedIds([42], mem);
    const raw = mem.getItem(PINNED_KEY) as string;
    expect(raw).toContain('"v":1');
    expect(raw).toContain('"ids":[42]');
  });

  it("ignores corrupted JSON and clears the key", () => {
    mem.setItem(PINNED_KEY, "{not json");
    expect(loadPinnedIds(mem)).toEqual([]);
    expect(mem.getItem(PINNED_KEY)).toBeNull();
  });

  it("rejects payloads with the wrong schema version", () => {
    mem.setItem(PINNED_KEY, JSON.stringify({ v: 999, ids: [1, 2] }));
    expect(loadPinnedIds(mem)).toEqual([]);
  });

  it("filters non-positive / non-integer ids on read", () => {
    // Strings that coerce cleanly to a positive integer (e.g. "4")
    // are accepted by design — defensive against future drift where
    // an older client may have persisted ids as strings. Junk like
    // "junk" / 3.5 / 0 / -2 is dropped.
    mem.setItem(
      PINNED_KEY,
      JSON.stringify({ v: 1, ids: [1, 0, -2, 3.5, "4", "junk", 7] }),
    );
    expect(loadPinnedIds(mem)).toEqual([1, 4, 7]);
  });

  it("returns [] when storage is null (SSR / private mode)", () => {
    expect(loadPinnedIds(null)).toEqual([]);
  });
});

describe("savePinnedIds", () => {
  it("dedups within a single save", () => {
    savePinnedIds([1, 1, 2, 1, 3], mem);
    expect(loadPinnedIds(mem)).toEqual([1, 2, 3]);
  });

  it("truncates to MAX_PINNED", () => {
    const overflow = Array.from({ length: MAX_PINNED + 5 }, (_, i) => i + 1);
    savePinnedIds(overflow, mem);
    const result = loadPinnedIds(mem);
    expect(result).toHaveLength(MAX_PINNED);
    // First MAX_PINNED preserved in input order.
    expect(result).toEqual(overflow.slice(0, MAX_PINNED));
  });

  it("strips invalid ids before persisting", () => {
    savePinnedIds([0, -1, 2.5, Number.NaN, 4], mem);
    expect(loadPinnedIds(mem)).toEqual([4]);
  });

  it("is a no-op when storage is null", () => {
    expect(() => savePinnedIds([1], null)).not.toThrow();
  });
});

describe("togglePinnedId", () => {
  it("adds a new id to the front", () => {
    expect(togglePinnedId([2, 3], 9)).toEqual([9, 2, 3]);
  });

  it("removes an existing id, preserving the rest's order", () => {
    expect(togglePinnedId([2, 9, 3], 9)).toEqual([2, 3]);
  });

  it("clamps an add to MAX_PINNED entries", () => {
    const full = Array.from({ length: MAX_PINNED }, (_, i) => i + 1);
    const next = togglePinnedId(full, 999);
    expect(next).toHaveLength(MAX_PINNED);
    expect(next[0]).toBe(999);
  });

  it("returns a copy when threadId is null", () => {
    const input = [1, 2];
    const result = togglePinnedId(input, null);
    expect(result).toEqual([1, 2]);
    expect(result).not.toBe(input);
  });

  it("rejects non-finite / non-integer / non-positive ids", () => {
    expect(togglePinnedId([1], Number.NaN)).toEqual([1]);
    expect(togglePinnedId([1], 2.5)).toEqual([1]);
    expect(togglePinnedId([1], 0)).toEqual([1]);
    expect(togglePinnedId([1], -1)).toEqual([1]);
  });
});

describe("isThreadPinned", () => {
  it("recognises pinned ids", () => {
    expect(isThreadPinned([1, 2, 3], 2)).toBe(true);
  });

  it("returns false for unpinned ids", () => {
    expect(isThreadPinned([1, 2, 3], 4)).toBe(false);
  });

  it("returns false for null / non-finite ids (legacy bucket)", () => {
    expect(isThreadPinned([1], null)).toBe(false);
    expect(isThreadPinned([1], undefined)).toBe(false);
    expect(isThreadPinned([1], Number.NaN)).toBe(false);
  });
});

describe("sortThreadsWithPinned", () => {
  type T = { id: number | null; title: string };
  const threads: T[] = [
    { id: 1, title: "a" },
    { id: 2, title: "b" },
    { id: 3, title: "c" },
    { id: null, title: "legacy" },
  ];

  it("returns input order when nothing is pinned", () => {
    const result = sortThreadsWithPinned(threads, []);
    expect(result.map((t) => t.id)).toEqual([1, 2, 3, null]);
  });

  it("places pinned threads at the top in pin order", () => {
    const result = sortThreadsWithPinned(threads, [3, 1]);
    expect(result.map((t) => t.id)).toEqual([3, 1, 2, null]);
  });

  it("legacy bucket is never pinned (id === null)", () => {
    // Even if a junk id matches null somehow (it shouldn't), the
    // legacy bucket stays in its natural slot.
    const result = sortThreadsWithPinned(threads, [2]);
    expect(result.map((t) => t.id)).toEqual([2, 1, 3, null]);
  });

  it("returns [] on non-array input (defensive)", () => {
    expect(sortThreadsWithPinned(undefined as unknown as T[], [1])).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = threads.slice();
    const before = input.map((t) => t.id);
    sortThreadsWithPinned(input, [3, 1]);
    expect(input.map((t) => t.id)).toEqual(before);
  });
});
