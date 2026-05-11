/**
 * v4.14 (2026-05-06) — profile language ↔ LanguageContext
 * reconciliation contract pins.
 *
 * Backstory: M3 in the 2026-05-06 hunt sweep. The profile page
 * has a `#profile-language` <select> (RU/KZ/EN) that saves
 * `language_preference` via `PUT /users/me`. Before this change,
 * saving "KZ" updated the backend column + local component state
 * but left the running UI in Russian until the user did one of:
 *   - clicked the header RU/KZ toggle (the only writer of
 *     `samga_lang` in localStorage AND the only caller of
 *     LanguageContext's setLang),
 *   - reloaded the page (LanguageProvider reads `samga_lang` on
 *     first paint).
 *
 * Fix: handleSave() now calls LanguageContext's setLang("kz" | "ru")
 * when the saved preference differs from the running `lang`. EN is
 * a future-stage backend value — we persist it but don't switch the
 * runtime locale (there's no EN dictionary).
 *
 * Static-source contract (cf. feedback_static_source_contract_tests):
 * the fix is a ~6-line addition inside a 730-line component that
 * renders through LanguageContext + AuthContext + react-router +
 * sonner. Pulling all of that in just to assert a setLang call would
 * be brittle and slow — the regex pins the call-site + the conditions
 * around it.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../ProfilePage.tsx");

function loadSource(): string {
  return readFileSync(SRC, "utf-8");
}

/**
 * Strip comments so prose in annotations doesn't false-positive
 * the assertions below. Same shape as the v4.13 onboarding test
 * (which pins a nearby file). Block comments first (non-greedy),
 * then `//` line comments — guarded so URLs (`https://...`) inside
 * strings aren't swallowed.
 */
function stripComments(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlock.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("profile page pulls setLang from LanguageContext (v4.14)", () => {
  it("ProfilePage destructures setLang alongside lang + t", () => {
    const src = stripComments(loadSource());
    // The useLang() call returns { lang, setLang, t }. We pin that
    // setLang is actually pulled out — if a later refactor drops it,
    // the handleSave dispatch below would silently no-op.
    expect(src).toMatch(
      /const\s*\{\s*lang,\s*setLang,\s*t\s*\}\s*=\s*useLang\(\)/,
    );
  });
});

describe("profile save dispatches into LanguageContext (v4.14)", () => {
  it("handleSave is defined and calls apiPut('/users/me')", () => {
    const src = stripComments(loadSource());
    // Sanity — the function we're annotating must still exist with
    // the same call shape. Pin a substring of the PUT URL.
    expect(src).toMatch(/async function handleSave\b/);
    expect(src).toMatch(/apiPut\(("|')\/users\/me\1/);
  });

  it("after the PUT, handleSave flips LanguageContext to 'kz' when KZ was saved", () => {
    const src = stripComments(loadSource());
    // The dispatch must happen AFTER the apiPut succeeds (otherwise a
    // network failure would change the UI without persistence). We
    // assert by ordering: the KZ branch appears after the PUT call
    // in the source text — a simple but sufficient proxy for
    // "inside the try block, after await apiPut".
    const putIndex = src.search(/apiPut\(("|')\/users\/me\1/);
    const kzDispatchIndex = src.search(
      /if\s*\(\s*languagePreference\s*===\s*("|')KZ\1\s*&&\s*lang\s*!==\s*("|')kz\2\s*\)\s*\{\s*setLang\(\s*("|')kz\3\s*\)/,
    );
    expect(putIndex, "expected apiPut call").toBeGreaterThan(-1);
    expect(kzDispatchIndex, "expected KZ dispatch branch").toBeGreaterThan(-1);
    expect(kzDispatchIndex).toBeGreaterThan(putIndex);
  });

  it("handleSave flips LanguageContext to 'ru' when RU was saved", () => {
    const src = stripComments(loadSource());
    expect(src).toMatch(
      /if\s*\(\s*languagePreference\s*===\s*("|')RU\1\s*&&\s*lang\s*!==\s*("|')ru\2\s*\)\s*\{\s*setLang\(\s*("|')ru\3\s*\)/,
    );
  });

  it("handleSave does NOT flip the runtime locale when EN is saved (no EN dictionary)", () => {
    const src = stripComments(loadSource());
    // Guard against someone later bolting on `setLang("en")` — the
    // LanguageContext type is `"ru" | "kz"`, so this would be a TS
    // error anyway, but pin it here so the intent is explicit: EN
    // persists to the backend, the runtime UI stays on whichever
    // locale the user is currently viewing.
    expect(src).not.toMatch(/setLang\(\s*("|')en\1\s*\)/i);
  });

  it("no-op when saved preference already matches running lang (setLang stays guarded)", () => {
    const src = stripComments(loadSource());
    // Both branches must have the `lang !== ...` guard so we don't
    // cause a redundant LanguageProvider re-render when the user
    // saves the same language they're already viewing. This guard
    // also helps when handleSave runs while the header toggle has
    // already applied the change.
    const kzBranch = src.match(
      /if\s*\(\s*languagePreference\s*===\s*("|')KZ\1\s*&&\s*lang\s*!==\s*("|')kz\2\s*\)/,
    );
    const ruBranch = src.match(
      /if\s*\(\s*languagePreference\s*===\s*("|')RU\1\s*&&\s*lang\s*!==\s*("|')ru\2\s*\)/,
    );
    expect(kzBranch).not.toBeNull();
    expect(ruBranch).not.toBeNull();
  });
});
