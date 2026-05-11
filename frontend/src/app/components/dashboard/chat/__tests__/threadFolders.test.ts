/**
 * s33 wave 3 (E3) — vitest pins for the thread-folders helpers.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_FOLDER_NAME_LENGTH,
  MAX_THREAD_FOLDERS,
  THREAD_FOLDERS_KEY,
  THREAD_FOLDERS_VERSION,
  THREAD_FOLDER_COLORS,
  assignThread,
  coerceThreadFoldersState,
  createFolder,
  deleteFolder,
  folderCounts,
  folderOfThread,
  loadThreadFolders,
  newFolderId,
  renameFolder,
  saveThreadFolders,
} from "../threadFolders";

describe("constants", () => {
  it("storage key + version are stable", () => {
    expect(THREAD_FOLDERS_KEY).toBe("samga.chat.threadFolders");
    expect(THREAD_FOLDERS_VERSION).toBe(1);
  });

  it("max folder count is 24", () => {
    expect(MAX_THREAD_FOLDERS).toBe(24);
  });

  it("max name length is 40", () => {
    expect(MAX_FOLDER_NAME_LENGTH).toBe(40);
  });

  it("color palette is frozen at 6 entries", () => {
    expect(THREAD_FOLDER_COLORS.length).toBe(6);
    expect(THREAD_FOLDER_COLORS[0]).toBe("amber");
  });
});

describe("coerceThreadFoldersState", () => {
  it("returns empty state on null/undefined/non-object", () => {
    expect(coerceThreadFoldersState(null).folders).toEqual([]);
    expect(coerceThreadFoldersState(undefined).folders).toEqual([]);
    expect(coerceThreadFoldersState("garbage").folders).toEqual([]);
  });

  it("rejects unknown version (forward-compat bailout)", () => {
    expect(
      coerceThreadFoldersState({
        version: 99,
        folders: [{ id: "f1", name: "X", color: "amber", createdAt: 0 }],
        assignments: {},
      }).folders,
    ).toEqual([]);
  });

  it("filters folders missing required fields", () => {
    const out = coerceThreadFoldersState({
      version: 1,
      folders: [
        { id: "", name: "ok", color: "amber" },
        { id: "f1", name: "" },
        { id: "f2", name: "good", color: "amber", createdAt: 100 },
        { name: "no id" },
      ],
      assignments: {},
    });
    expect(out.folders.map((f) => f.id)).toEqual(["f2"]);
  });

  it("clips folder name to 40 chars", () => {
    const long = "x".repeat(100);
    const out = coerceThreadFoldersState({
      version: 1,
      folders: [{ id: "f1", name: long, color: "amber", createdAt: 0 }],
      assignments: {},
    });
    expect(out.folders[0].name.length).toBe(40);
  });

  it("falls back to amber for unknown color", () => {
    const out = coerceThreadFoldersState({
      version: 1,
      folders: [{ id: "f1", name: "X", color: "magenta" as any, createdAt: 0 }],
      assignments: {},
    });
    expect(out.folders[0].color).toBe("amber");
  });

  it("drops assignments pointing at nonexistent folders", () => {
    const out = coerceThreadFoldersState({
      version: 1,
      folders: [{ id: "f1", name: "Math", color: "amber", createdAt: 0 }],
      assignments: {
        t1: "f1",
        t2: "f-deleted",
        t3: null,
      },
    });
    expect(out.assignments).toEqual({ t1: "f1", t3: null });
  });

  it("caps folder count at MAX_THREAD_FOLDERS", () => {
    const folders = Array.from({ length: 50 }, (_, i) => ({
      id: `f${i}`,
      name: `n${i}`,
      color: "amber",
      createdAt: i,
    }));
    const out = coerceThreadFoldersState({
      version: 1,
      folders,
      assignments: {},
    });
    expect(out.folders.length).toBe(MAX_THREAD_FOLDERS);
  });
});

describe("loadThreadFolders / saveThreadFolders", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("returns empty state when nothing stored", () => {
    const out = loadThreadFolders();
    expect(out.folders).toEqual([]);
    expect(out.assignments).toEqual({});
  });

  it("round-trips through localStorage", () => {
    const initial = createFolder({
      state: {
        version: 1,
        folders: [],
        assignments: {},
      },
      name: "Math",
    })!;
    saveThreadFolders(initial);
    const reloaded = loadThreadFolders();
    expect(reloaded.folders.length).toBe(1);
    expect(reloaded.folders[0].name).toBe("Math");
  });

  it("recovers from corrupt JSON", () => {
    localStorage.setItem(THREAD_FOLDERS_KEY, "{not json");
    const out = loadThreadFolders();
    expect(out.folders).toEqual([]);
  });
});

describe("newFolderId", () => {
  it("starts with f_ prefix", () => {
    expect(newFolderId().startsWith("f_")).toBe(true);
  });

  it("generates unique ids on consecutive calls", () => {
    const a = newFolderId();
    const b = newFolderId();
    expect(a).not.toBe(b);
  });
});

describe("createFolder", () => {
  const empty = { version: 1, folders: [], assignments: {} } as const;

  it("returns null on empty / whitespace name", () => {
    expect(createFolder({ state: empty as any, name: "" })).toBeNull();
    expect(createFolder({ state: empty as any, name: "   " })).toBeNull();
  });

  it("trims + clips long names", () => {
    const out = createFolder({
      state: empty as any,
      name: "  " + "y".repeat(60) + "  ",
    });
    expect(out!.folders[0].name.length).toBe(40);
  });

  it("falls back to amber on invalid color", () => {
    const out = createFolder({
      state: empty as any,
      name: "X",
      color: "magenta" as any,
    });
    expect(out!.folders[0].color).toBe("amber");
  });

  it("returns null when at the cap", () => {
    const folders = Array.from({ length: MAX_THREAD_FOLDERS }, (_, i) => ({
      id: `f${i}`,
      name: `n${i}`,
      color: "amber" as const,
      createdAt: i,
    }));
    const state = { version: 1, folders, assignments: {} };
    expect(createFolder({ state, name: "extra" })).toBeNull();
  });
});

describe("renameFolder", () => {
  const state = {
    version: 1,
    folders: [
      { id: "f1", name: "Math", color: "amber" as const, createdAt: 0 },
      { id: "f2", name: "Phys", color: "rose" as const, createdAt: 1 },
    ],
    assignments: {},
  };

  it("renames an existing folder", () => {
    const out = renameFolder({ state, folderId: "f1", name: "Алгебра" });
    expect(out.folders.find((f) => f.id === "f1")!.name).toBe("Алгебра");
  });

  it("returns state unchanged for unknown folder id", () => {
    const out = renameFolder({ state, folderId: "f99", name: "X" });
    expect(out).toBe(state); // referential equality (no mutation)
  });

  it("returns state unchanged for empty / whitespace name", () => {
    expect(renameFolder({ state, folderId: "f1", name: "" })).toBe(state);
    expect(renameFolder({ state, folderId: "f1", name: "   " })).toBe(state);
  });

  it("clips long renames", () => {
    const out = renameFolder({
      state,
      folderId: "f1",
      name: "y".repeat(99),
    });
    expect(out.folders.find((f) => f.id === "f1")!.name.length).toBe(40);
  });
});

describe("deleteFolder", () => {
  const state = {
    version: 1,
    folders: [
      { id: "f1", name: "Math", color: "amber" as const, createdAt: 0 },
      { id: "f2", name: "Phys", color: "rose" as const, createdAt: 1 },
    ],
    assignments: { t1: "f1", t2: "f2", t3: "f1" },
  };

  it("removes the folder + nulls out assignments pointing at it", () => {
    const out = deleteFolder({ state, folderId: "f1" });
    expect(out.folders.map((f) => f.id)).toEqual(["f2"]);
    expect(out.assignments).toEqual({ t1: null, t2: "f2", t3: null });
  });

  it("returns state unchanged for unknown folder id", () => {
    expect(deleteFolder({ state, folderId: "f99" })).toBe(state);
  });
});

describe("assignThread / folderOfThread", () => {
  const baseState = {
    version: 1,
    folders: [
      { id: "f1", name: "Math", color: "amber" as const, createdAt: 0 },
    ],
    assignments: {},
  };

  it("assigns + reads back", () => {
    const out = assignThread({
      state: baseState,
      threadId: "t1",
      folderId: "f1",
    });
    expect(folderOfThread(out, "t1")?.id).toBe("f1");
  });

  it("unfile via folderId=null", () => {
    const filed = assignThread({
      state: baseState,
      threadId: "t1",
      folderId: "f1",
    });
    const unfiled = assignThread({
      state: filed,
      threadId: "t1",
      folderId: null,
    });
    expect(folderOfThread(unfiled, "t1")).toBeNull();
  });

  it("refuses to assign to a nonexistent folder", () => {
    const out = assignThread({
      state: baseState,
      threadId: "t1",
      folderId: "f-bogus",
    });
    expect(out).toBe(baseState);
  });

  it("ignores empty / non-string thread id", () => {
    const a = assignThread({
      state: baseState,
      threadId: "",
      folderId: "f1",
    });
    expect(a).toBe(baseState);
    const b = assignThread({
      state: baseState,
      threadId: undefined as any,
      folderId: "f1",
    });
    expect(b).toBe(baseState);
  });
});

describe("folderCounts", () => {
  const state = {
    version: 1,
    folders: [
      { id: "f1", name: "Math", color: "amber" as const, createdAt: 0 },
      { id: "f2", name: "Phys", color: "rose" as const, createdAt: 1 },
    ],
    assignments: { t1: "f1", t2: "f1", t3: "f2" },
  };

  it("counts assigned + unfiled threads", () => {
    const out = folderCounts(state, ["t1", "t2", "t3", "t4", "t5"]);
    expect(out["f1"]).toBe(2);
    expect(out["f2"]).toBe(1);
    expect(out[""]).toBe(2); // t4, t5 unfiled
  });

  it("treats stale assignment (folder deleted upstream) as unfiled", () => {
    const stateWithStale = {
      ...state,
      assignments: { ...state.assignments, t9: "f-deleted" },
    };
    const out = folderCounts(stateWithStale, ["t9"]);
    expect(out[""]).toBe(1);
  });
});
