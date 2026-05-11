/**
 * v4.13 (2026-05-06) — onboarding a11y + Continue-gating contract pins.
 *
 * Backstory: M2 in the 2026-05-06 hunt sweep. Two related gaps in
 * `OnboardingPage.tsx`:
 *
 *   1. The step-level error banner (`{error && ...}`) had no
 *      `role="alert"`, so when validateStep() refused to advance
 *      (e.g. "Балл не должен превышать максимум предмета"), a
 *      screen-reader user got no announcement — the red copy was
 *      visual-only.
 *
 *   2. Continue/Submit stayed enabled while any per-cell `overMax`
 *      flag was set. The submit lane still refused via
 *      validateStep(), but a sighted user could click Continue,
 *      see the banner flash, then have to look for the red cell —
 *      a round-trip that's unnecessary because `scoreFlags` already
 *      carries the signal at keystroke time.
 *
 * Fix (single file, `OnboardingPage.tsx`):
 *   - Banner: `role="alert"` on the error wrapper <div>. The inline
 *     per-cell helper <p> also carries role="alert" when overMax,
 *     plain <p> when the value was silently stripped.
 *   - Continue gate: `const hasOverMaxScore = step === "results" &&
 *     Object.values(scoreFlags).some((flag) => flag?.overMax);` and
 *     `disabled={saving || hasOverMaxScore}` on the submit button.
 *
 * Static-source contract (cf. feedback_static_source_contract_tests):
 * OnboardingPage is 1700+ lines and renders through LanguageContext,
 * AuthContext, and useNavigate — too heavy for a full-render vitest
 * over three structural attribute edits. Pinning source via regex is
 * the same pattern as v3.65/v3.66/v3.67 (library aria-label guards)
 * and v3.78 (FeedbackButtons error-surfacing).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../OnboardingPage.tsx");

function loadSource(): string {
  return readFileSync(SRC, "utf-8");
}

/**
 * Strip JSX/JS comments (// line and /* block *\/) so regex assertions
 * don't false-positive on comment prose. We keep it local to this test
 * because every other static-source test in the repo currently does
 * raw substring matches and hasn't needed comment-stripping — but this
 * test *intentionally* has inline annotation prose that mentions
 * `role="alert"` to explain the ternary, which would otherwise trip
 * the "no leak" assertion.
 */
function stripComments(src: string): string {
  // Remove /* … */ block comments first (non-greedy), then // line
  // comments. We do NOT try to be JSX-aware about strings — the
  // OnboardingPage.tsx file doesn't contain `//` or `/*` inside
  // string literals today.
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlock.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("onboarding error banner carries role=alert (v4.13)", () => {
  it("OnboardingPage.tsx still contains the {error && ...} banner block", () => {
    // Pin the gate expression so a refactor that changes the variable
    // name trips a clear failure here rather than failing the regex
    // below with no hint.
    expect(loadSource()).toMatch(/\{error && \(/);
  });

  it('the step-level error wrapper <div> has role="alert"', () => {
    // Strip comments first — the banner is preceded by a multi-line
    // comment that mentions role="alert" in prose, which would
    // false-positive the regex below.
    const src = stripComments(loadSource());
    // Scope to the banner block: `{error && (` … `)}`. The block is
    // non-nested in OnboardingPage's JSX at this point in the tree,
    // so a non-greedy match to the next `)}` is tight enough.
    const block = src.match(/\{error && \(([\s\S]*?)\)\s*\}/);
    expect(
      block,
      "expected {error && (...)} block to still exist",
    ).not.toBeNull();
    const blockText = block?.[1] ?? "";
    expect(blockText).toMatch(/role=("|')alert\1/);
    // Sanity: red banner copy survives the edit — this is the element
    // we wanted to annotate, not some other role=alert somewhere.
    expect(blockText).toMatch(/border-red-200/);
    expect(blockText).toMatch(/bg-red-50/);
  });

  it("the per-cell overMax helper <p> is announced via role=alert", () => {
    const src = loadSource();
    // Pin the ternary that toggles role only when overMax. We accept
    // either `role={overMax ? "alert" : undefined}` or the reverse
    // inline form.
    expect(src).toMatch(
      /role=\{\s*overMax\s*\?\s*("|')alert\1\s*:\s*undefined\s*\}/,
    );
  });

  it("the stripped-character helper stays informational (no role=alert leak)", () => {
    // Defence in depth: if someone later bolts role="alert" onto the
    // helper <p> unconditionally, both branches (overMax AND stripped)
    // would announce. The stripped branch isn't blocking — the char
    // was already dropped silently — so a screen reader shouldn't
    // interrupt. The ternary form pinned above guarantees this;
    // a plain role="alert" on the helper would fail that assertion.
    const src = stripComments(loadSource());
    const helper = src.match(
      /\{\(overMax \|\| stripped\) && \(([\s\S]*?)\)\s*\}/,
    );
    expect(
      helper,
      "expected overMax||stripped helper block to exist",
    ).not.toBeNull();
    const helperText = helper?.[1] ?? "";
    // Allowed: role={overMax ? "alert" : undefined}. Disallowed:
    // a bare role="alert" string literal (i.e. `role="alert"` with no
    // conditional). The ternary form contains `role={overMax ?` so a
    // plain-literal grep won't match it.
    expect(helperText).not.toMatch(/role=("|')alert\1/);
  });
});

describe("onboarding Continue gate on overMax scores (v4.13)", () => {
  it("OnboardingPage.tsx derives hasOverMaxScore from scoreFlags", () => {
    const src = loadSource();
    // Pin the exact derivation expression — a future rename that
    // changes the check (e.g. to only check the active subject) must
    // come through the test so the behaviour is re-validated.
    expect(src).toMatch(/const hasOverMaxScore =/);
    expect(src).toMatch(/step === ("|')results\1/);
    expect(src).toMatch(/Object\.values\(scoreFlags\)/);
    expect(src).toMatch(/\.some\(\s*\(flag\) => flag\?\.overMax\s*\)/);
  });

  it("the submit <button> is disabled while hasOverMaxScore is true", () => {
    const src = loadSource();
    // Scope to the submit button by pinning `type="submit"`. Within a
    // ~250-char window, disabled= must reference hasOverMaxScore.
    const match = src.match(
      /type=("|')submit\1[\s\S]{0,400}?disabled=\{[^}]*\}/,
    );
    expect(match, "expected submit button with disabled=…").not.toBeNull();
    const disabledClause = match?.[0] ?? "";
    expect(disabledClause).toMatch(/disabled=\{[^}]*hasOverMaxScore/);
    // saving must still be part of the gate (don't accidentally
    // regress the existing mid-save double-submit guard).
    expect(disabledClause).toMatch(/disabled=\{[^}]*saving/);
  });

  it("aria-disabled mirrors the disabled attribute for assistive tech", () => {
    const src = loadSource();
    const match = src.match(
      /type=("|')submit\1[\s\S]{0,400}?aria-disabled=\{[^}]*\}/,
    );
    expect(match).not.toBeNull();
    const aria = match?.[0] ?? "";
    expect(aria).toMatch(/aria-disabled=\{[^}]*hasOverMaxScore/);
  });
});
