import { describe, expect, it } from "vitest";

import {
  filterNavTreeForAdmin,
  type NavLeafLike,
  type NavGroupLike,
  type NavNodeLike,
} from "../navTreeFilter";

const studentLeaf: NavLeafLike = {
  kind: "leaf",
  labelKey: "dash.nav.chat",
  href: "/dashboard/chat",
};

const adminLeaf: NavLeafLike = {
  kind: "leaf",
  labelKey: "dash.nav.opsTrustSignals",
  href: "/dashboard/trust-signals",
  adminOnly: true,
};

const studentGroup: NavGroupLike = {
  kind: "group",
  key: "practice",
  labelKey: "dash.nav.practice",
  children: [
    { kind: "leaf", labelKey: "dash.nav.exams", href: "/dashboard/exams" },
  ],
};

const opsGroup: NavGroupLike = {
  kind: "group",
  key: "ops",
  labelKey: "dash.nav.ops",
  adminOnly: true,
  children: [
    {
      kind: "leaf",
      labelKey: "dash.nav.opsRagStats",
      href: "/dashboard/rag-stats",
    },
    {
      kind: "leaf",
      labelKey: "dash.nav.opsRetakeGuideFetch",
      href: "/dashboard/retake-guide-fetch-stats",
    },
  ],
};

const mixedGroup: NavGroupLike = {
  kind: "group",
  key: "account",
  labelKey: "dash.nav.account",
  children: [
    { kind: "leaf", labelKey: "dash.nav.profile", href: "/dashboard/profile" },
    {
      kind: "leaf",
      labelKey: "dash.nav.adminThing",
      href: "/dashboard/admin-thing",
      adminOnly: true,
    },
  ],
};

const tree: NavNodeLike[] = [
  studentLeaf,
  adminLeaf,
  studentGroup,
  mixedGroup,
  opsGroup,
];

describe("filterNavTreeForAdmin", () => {
  it("admins see every node", () => {
    const out = filterNavTreeForAdmin(tree, true);
    expect(out).toHaveLength(5);
    expect(out.map((n) => ("href" in n ? n.href : n.key))).toEqual([
      "/dashboard/chat",
      "/dashboard/trust-signals",
      "practice",
      "account",
      "ops",
    ]);
  });

  it("non-admins lose adminOnly leaves", () => {
    const out = filterNavTreeForAdmin(tree, false);
    expect(
      out.find(
        (n) => n.kind === "leaf" && n.href === "/dashboard/trust-signals",
      ),
    ).toBeUndefined();
  });

  it("non-admins lose adminOnly groups entirely", () => {
    const out = filterNavTreeForAdmin(tree, false);
    expect(
      out.find((n) => n.kind === "group" && n.key === "ops"),
    ).toBeUndefined();
  });

  it("non-admins keep non-adminOnly groups but lose adminOnly children inside them", () => {
    const out = filterNavTreeForAdmin(tree, false);
    const account = out.find(
      (n) => n.kind === "group" && n.key === "account",
    ) as NavGroupLike | undefined;
    expect(account).toBeDefined();
    expect(account!.children.map((c) => c.href)).toEqual([
      "/dashboard/profile",
    ]);
  });

  it("drops a group that becomes empty after filtering its children", () => {
    const allAdminGroup: NavGroupLike = {
      kind: "group",
      key: "all-admin",
      labelKey: "x",
      children: [
        { kind: "leaf", labelKey: "a", href: "/a", adminOnly: true },
        { kind: "leaf", labelKey: "b", href: "/b", adminOnly: true },
      ],
    };
    const out = filterNavTreeForAdmin([allAdminGroup], false);
    expect(out).toEqual([]);
  });

  it("does not mutate the input tree", () => {
    const before = JSON.stringify(tree);
    filterNavTreeForAdmin(tree, false);
    expect(JSON.stringify(tree)).toBe(before);
  });

  it("admin sees the full ops group with both leaves", () => {
    const out = filterNavTreeForAdmin(tree, true);
    const ops = out.find((n) => n.kind === "group" && n.key === "ops") as
      | NavGroupLike
      | undefined;
    expect(ops).toBeDefined();
    expect(ops!.children).toHaveLength(2);
    expect(ops!.children.map((c) => c.href)).toEqual([
      "/dashboard/rag-stats",
      "/dashboard/retake-guide-fetch-stats",
    ]);
  });

  it("returns an empty array for an empty input", () => {
    expect(filterNavTreeForAdmin([], false)).toEqual([]);
    expect(filterNavTreeForAdmin([], true)).toEqual([]);
  });
});
