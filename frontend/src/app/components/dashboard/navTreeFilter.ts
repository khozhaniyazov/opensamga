/**
 * v3.37 (2026-05-01) — pure helper for filtering the dashboard
 * sidebar nav tree by admin status.
 *
 * Lives next to ``DashboardLayout.tsx`` and gets exercised in
 * ``__tests__/navTreeFilter.test.ts`` so the admin-gating rules
 * are pinned without rendering the layout.
 *
 * Contract:
 * - Leaves and groups marked ``adminOnly`` are dropped for
 *   non-admins.
 * - Children inside non-adminOnly groups can themselves be
 *   ``adminOnly``; those leaves are dropped too.
 * - If a group becomes empty after filtering, the group itself is
 *   dropped (don't render an empty collapsible).
 * - Admins see everything.
 */

export interface NavLeafLike {
  kind: "leaf";
  labelKey: string;
  href: string;
  adminOnly?: boolean;
}

export interface NavGroupLike<L extends NavLeafLike = NavLeafLike> {
  kind: "group";
  key: string;
  labelKey: string;
  children: L[];
  adminOnly?: boolean;
}

export type NavNodeLike<L extends NavLeafLike = NavLeafLike> =
  | L
  | NavGroupLike<L>;

/**
 * Filter the nav tree by ``isAdmin``. Generic over the concrete
 * leaf type ``L`` so the caller's richer node types (with ``icon``,
 * ``gated``, etc.) survive end-to-end without a cast.
 */
export function filterNavTreeForAdmin<
  L extends NavLeafLike,
  N extends NavNodeLike<L>,
>(tree: ReadonlyArray<N>, isAdmin: boolean): N[] {
  const out: N[] = [];
  for (const node of tree) {
    if (node.kind === "leaf") {
      if (node.adminOnly && !isAdmin) continue;
      out.push(node);
      continue;
    }
    // group
    if (node.adminOnly && !isAdmin) continue;
    const filteredChildren = (node.children as L[]).filter(
      (c) => !(c.adminOnly && !isAdmin),
    );
    if (filteredChildren.length === 0) continue;
    // Cast required because `{ ...node, children: filteredChildren }`
    // structurally widens to NavGroupLike<L>, but at runtime it is
    // still the caller's concrete N (NavGroup with full icon/etc).
    out.push({ ...node, children: filteredChildren } as N);
  }
  return out;
}
