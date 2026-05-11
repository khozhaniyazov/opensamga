/**
 * s34 wave 10 (E5, 2026-04-28): vitest pins for threadArchiveStorage.ts.
 *
 * The storage round-trip + the auto-archive cutoff drive whether a
 * thread is visible in the rail. Pin every shape so a future refactor
 * (when the BE column lands) can swap implementations without
 * regressing the user-visible filter rules.
 */

import { describe, expect, it } from "vitest";
import {
  ARCHIVED_KEY,
  ARCHIVE_AGE_DAYS,
  SHOW_ARCHIVED_KEY,
  isAutoArchivedByAge,
  isThreadArchived,
  isThreadManuallyArchived,
  loadArchivedIds,
  loadShowArchived,
  partitionThreadsByArchived,
  saveArchivedIds,
  saveShowArchived,
  toggleArchivedId,
  type StorageLike,
} from "../threadArchiveStorage";

function makeStorage(): StorageLike & { _store: Record<string, string> } {
  const store: Record<string, string> = {};
  return {
    _store: store,
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = v;
    },
    removeItem: (k) => {
      delete store[k];
    },
  };
}

const NOW = new Date("2026-04-28T12:00:00.000Z");

describe("constants", () => {
  it("ARCHIVE_AGE_DAYS = 90 (boss-stated)", () => {
    expect(ARCHIVE_AGE_DAYS).toBe(90);
  });

  it("storage keys are stable", () => {
    expect(ARCHIVED_KEY).toBe("samga.chat.archivedThreads");
    expect(SHOW_ARCHIVED_KEY).toBe("samga.chat.showArchived");
  });
});

describe("archived ids round-trip", () => {
  it("save then load preserves ids", () => {
    const s = makeStorage();
    saveArchivedIds([1, 7, 42], s);
    expect(loadArchivedIds(s)).toEqual([1, 7, 42]);
  });

  it("dedups on save", () => {
    const s = makeStorage();
    saveArchivedIds([3, 3, 3, 5], s);
    expect(loadArchivedIds(s)).toEqual([3, 5]);
  });

  it("drops non-positive / non-integer ids on save", () => {
    const s = makeStorage();
    saveArchivedIds([1, 0, -2, 3.5, NaN as unknown as number, 9], s);
    expect(loadArchivedIds(s)).toEqual([1, 9]);
  });

  it("load returns [] on missing key", () => {
    const s = makeStorage();
    expect(loadArchivedIds(s)).toEqual([]);
  });

  it("load wipes corrupt blob and returns []", () => {
    const s = makeStorage();
    s.setItem(ARCHIVED_KEY, "not json");
    expect(loadArchivedIds(s)).toEqual([]);
    expect(s.getItem(ARCHIVED_KEY)).toBeNull();
  });

  it("load wipes wrong-version blob and returns []", () => {
    const s = makeStorage();
    s.setItem(ARCHIVED_KEY, JSON.stringify({ v: 99, ids: [1, 2] }));
    expect(loadArchivedIds(s)).toEqual([]);
  });
});

describe("toggleArchivedId", () => {
  it("adds when missing", () => {
    expect(toggleArchivedId([1, 2], 3)).toEqual([1, 2, 3]);
  });

  it("removes when present", () => {
    expect(toggleArchivedId([1, 2, 3], 2)).toEqual([1, 3]);
  });

  it("ignores null / undefined / 0 / NaN", () => {
    expect(toggleArchivedId([1, 2], null)).toEqual([1, 2]);
    expect(toggleArchivedId([1, 2], undefined)).toEqual([1, 2]);
    expect(toggleArchivedId([1, 2], 0)).toEqual([1, 2]);
    expect(toggleArchivedId([1, 2], NaN)).toEqual([1, 2]);
  });
});

describe("isThreadManuallyArchived", () => {
  it("true when present", () => {
    expect(isThreadManuallyArchived([1, 2, 3], 2)).toBe(true);
  });

  it("false when absent", () => {
    expect(isThreadManuallyArchived([1, 2, 3], 5)).toBe(false);
  });

  it("false on null", () => {
    expect(isThreadManuallyArchived([1, 2, 3], null)).toBe(false);
  });
});

describe("show-archived toggle", () => {
  it("defaults to false on missing key", () => {
    const s = makeStorage();
    expect(loadShowArchived(s)).toBe(false);
  });

  it("round-trips a true write", () => {
    const s = makeStorage();
    saveShowArchived(true, s);
    expect(loadShowArchived(s)).toBe(true);
  });

  it("round-trips a false write", () => {
    const s = makeStorage();
    saveShowArchived(true, s);
    saveShowArchived(false, s);
    expect(loadShowArchived(s)).toBe(false);
  });

  it("wipes corrupt blob and returns false", () => {
    const s = makeStorage();
    s.setItem(SHOW_ARCHIVED_KEY, "{not json");
    expect(loadShowArchived(s)).toBe(false);
  });
});

describe("isAutoArchivedByAge", () => {
  it("false on null", () => {
    expect(isAutoArchivedByAge(null, NOW)).toBe(false);
  });

  it("false on garbage timestamp", () => {
    expect(isAutoArchivedByAge("not a date", NOW)).toBe(false);
  });

  it("false within 89 days", () => {
    const d = new Date(NOW.getTime() - 89 * 24 * 60 * 60 * 1000);
    expect(isAutoArchivedByAge(d.toISOString(), NOW)).toBe(false);
  });

  it("true at 91 days", () => {
    const d = new Date(NOW.getTime() - 91 * 24 * 60 * 60 * 1000);
    expect(isAutoArchivedByAge(d.toISOString(), NOW)).toBe(true);
  });

  it("false on future timestamp (clock skew)", () => {
    const d = new Date(NOW.getTime() + 60_000);
    expect(isAutoArchivedByAge(d.toISOString(), NOW)).toBe(false);
  });
});

describe("isThreadArchived (combined)", () => {
  const ARCHIVED = [42];

  it("manual-archived wins over recency", () => {
    expect(
      isThreadArchived({
        threadId: 42,
        updatedAt: NOW.toISOString(),
        archivedIds: ARCHIVED,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("auto-archived by age", () => {
    const d = new Date(NOW.getTime() - 100 * 24 * 60 * 60 * 1000);
    expect(
      isThreadArchived({
        threadId: 1,
        updatedAt: d.toISOString(),
        archivedIds: [],
        now: NOW,
      }),
    ).toBe(true);
  });

  it("legacy bucket never auto-archived", () => {
    const d = new Date(NOW.getTime() - 1000 * 24 * 60 * 60 * 1000);
    expect(
      isThreadArchived({
        threadId: null,
        updatedAt: d.toISOString(),
        archivedIds: [],
        now: NOW,
      }),
    ).toBe(false);
  });

  it("recent + not manual = active", () => {
    expect(
      isThreadArchived({
        threadId: 1,
        updatedAt: NOW.toISOString(),
        archivedIds: [],
        now: NOW,
      }),
    ).toBe(false);
  });
});

describe("partitionThreadsByArchived", () => {
  it("splits + preserves input order", () => {
    const oldDate = new Date(
      NOW.getTime() - 200 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const newDate = NOW.toISOString();
    const threads = [
      { id: 1, updated_at: newDate },
      { id: 2, updated_at: oldDate },
      { id: 3, updated_at: newDate },
      { id: 4, updated_at: oldDate },
    ];
    const { active, archived } = partitionThreadsByArchived(threads, [], NOW);
    expect(active.map((t) => t.id)).toEqual([1, 3]);
    expect(archived.map((t) => t.id)).toEqual([2, 4]);
  });

  it("respects manual archive list", () => {
    const newDate = NOW.toISOString();
    const threads = [
      { id: 1, updated_at: newDate },
      { id: 2, updated_at: newDate },
    ];
    const { active, archived } = partitionThreadsByArchived(threads, [2], NOW);
    expect(active.map((t) => t.id)).toEqual([1]);
    expect(archived.map((t) => t.id)).toEqual([2]);
  });

  it("returns empty partitions on null input", () => {
    expect(partitionThreadsByArchived(null, [], NOW)).toEqual({
      active: [],
      archived: [],
    });
  });

  it("preserves the legacy bucket as active", () => {
    const oldDate = new Date(
      NOW.getTime() - 500 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const threads = [
      { id: null, updated_at: oldDate },
      { id: 7, updated_at: NOW.toISOString() },
    ];
    const { active, archived } = partitionThreadsByArchived(threads, [], NOW);
    expect(active.map((t) => t.id)).toEqual([null, 7]);
    expect(archived).toEqual([]);
  });
});
