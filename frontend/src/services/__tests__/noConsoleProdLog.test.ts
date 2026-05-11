import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * v3.76 contract test — pin the FE network-layer modules off raw
 * `console.*` for production. Mirrors the v3.45-v3.57 BE print-sweep
 * + v3.57 ruff T20 gate.
 *
 * Each module on the list is allowed to:
 *   - Use `devLog`, `devWarn`, `devError`, `devDebug` from
 *     `services/devLog.ts` (these gate on `import.meta.env?.DEV`).
 *   - Reference `console.*` only inside `import { ... } from "..."`
 *     comments / docstrings (we strip those before checking).
 *
 * It must NOT contain any raw `console.log` / `console.warn` /
 * `console.error` / `console.debug` / `console.info` call — that
 * would re-introduce the prod-console leak v3.76 fixed.
 *
 * Static-source contract test (readFileSync + regex) per the
 * `feedback_static_source_contract_tests.md` pattern: the change is
 * a 1-call-site gate, not a render-tree mutation.
 */

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");

const SWEEP_TARGETS = [
  "frontend/src/services/api.ts",
  "frontend/src/services/chatWebSocket.ts",
  "frontend/src/api/client.ts",
];

/**
 * Strip line comments and block comments from a TS source string.
 * Quick-and-dirty — it does NOT understand strings, regex literals,
 * or JSX, but the SUT files don't have `console.` substrings inside
 * string literals (verified by hand at v3.76 ship time), so this is
 * safe for the contract.
 */
function stripComments(src: string): string {
  return src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

const RAW_CONSOLE_CALL = /\bconsole\.(log|warn|error|debug|info)\s*\(/;

describe("v3.76 raw console.* gate (network-layer modules)", () => {
  for (const rel of SWEEP_TARGETS) {
    it(`${rel} contains no raw console.* call`, () => {
      const abs = resolve(REPO_ROOT, rel);
      const src = readFileSync(abs, "utf8");
      const stripped = stripComments(src);
      const match = stripped.match(RAW_CONSOLE_CALL);
      expect(
        match,
        `Found raw console.${match?.[1]}(...) call in ${rel}. Use ` +
          `devLog/devWarn/devError/devDebug from services/devLog.ts ` +
          `so the line is gated on DEV. If this is intentional, ` +
          `update the v3.76 contract test allowlist.`,
      ).toBeNull();
    });
  }

  it("services/devLog.ts is itself allowed to mention console.*", () => {
    // Sanity: devLog.ts MUST reference console.* (it's the wrapper).
    // If a future cleanup pass strips this file accidentally, this
    // test will alert us before the prod build silently breaks.
    const abs = resolve(REPO_ROOT, "frontend/src/services/devLog.ts");
    const src = readFileSync(abs, "utf8");
    expect(src).toMatch(/console\.log/);
    expect(src).toMatch(/console\.warn/);
    expect(src).toMatch(/console\.error/);
    expect(src).toMatch(/console\.debug/);
  });
});
