/**
 * v4.20 (2026-05-08) — FE lint gate: --max-warnings=0 + zero
 * `react-hooks/exhaustive-deps` regressions.
 *
 * Two belts-and-braces contract pins:
 *
 * 1. `frontend/package.json` `lint` script must include
 *    `--max-warnings=0`. Pre-v4.20 it was a bare `eslint .` so
 *    warnings never failed the lane; one warning had been
 *    tolerated since v3.50. Tripwire blocks future drift.
 *
 * 2. `RetakeGuideFetchStatsPage.tsx` must wrap its `load` helper
 *    in `useCallback` and list `[load]` on the mount-time
 *    `useEffect`. This is the specific fix v4.20 ships for the
 *    pre-v4.20 `react-hooks/exhaustive-deps` warning; if a
 *    future refactor regresses the pattern, this test will fail
 *    before the slower full `npm run lint` catches it.
 *
 * Static-source only (readFileSync + regex). No React render.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
// HERE = frontend/src/app/components/dashboard/__tests__
// Five levels up = frontend/
const FE_ROOT = join(HERE, "..", "..", "..", "..", "..");

describe("v4.20 FE lint gate", () => {
  it("package.json `lint` script fails on any warning", () => {
    const pkg = JSON.parse(
      readFileSync(join(FE_ROOT, "package.json"), "utf-8"),
    ) as { scripts: Record<string, string> };
    const lint = pkg.scripts.lint;
    expect(lint, "lint script must be defined").toBeTruthy();
    expect(
      lint,
      "lint script must include --max-warnings=0 so warnings fail CI",
    ).toMatch(/--max-warnings\s*=?\s*0\b/);
  });

  it("RetakeGuideFetchStatsPage.tsx wraps `load` in useCallback and lists it as effect dep", () => {
    const path = join(
      FE_ROOT,
      "src",
      "app",
      "components",
      "dashboard",
      "RetakeGuideFetchStatsPage.tsx",
    );
    const src = readFileSync(path, "utf-8");

    // useCallback imported from react. Order of named imports is
    // stylistic, so match `useCallback` inside the same import
    // statement as `from "react"` regardless of position.
    expect(src).toMatch(/import\s+[^;]*useCallback[^;]*from\s+["']react["']/);

    // `const load = useCallback(...)` — the v4.20 shape.
    expect(src).toMatch(/const\s+load\s*=\s*useCallback\s*\(/);

    // `useEffect(() => { void load(); }, [load])` — the mount-time
    // effect must list `load` as a dep. The arrow-body contains its
    // own parens (`void load()`), so a simple `[^)]*` won't walk it.
    // Anchor on the `}, [load])` tail instead.
    expect(src).toMatch(
      /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?\}\s*,\s*\[\s*load\s*\]\s*\)/,
    );

    // Belt-and-braces: no empty dep array on this SUT's useEffect.
    expect(src).not.toMatch(
      /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?\}\s*,\s*\[\s*\]\s*\)/,
    );
  });
});
