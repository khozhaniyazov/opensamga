import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * v3.68 (B10, 2026-05-02): static-source contract test pinning the
 * deep-link prefill effect in ChatPage.tsx.
 *
 * Bug recap: pre-v3.68 the effect called
 *   url.searchParams.delete("topic") + ("subject")
 *   window.history.replaceState(...)
 * after seeding the composer. That broke shareable links
 * (/dashboard/chat?topic=Kinematics&subject=physics) — refresh
 * cleared the URL and lost the prefill. v3.68 keeps the params
 * and instead skips the seed when the active thread already has a
 * non-empty saved draft (so a typing user is not clobbered).
 *
 * We use the static-source pattern (readFileSync + regex) instead of
 * full-render vitest because ChatPage pulls react-router, AuthContext,
 * LanguageProvider, MessagesProvider, etc. The change here is
 * structural (the deletes are gone, loadDraft is gated on draft text)
 * — exactly what static-source tests are good for. See
 * feedback_static_source_contract_tests.md.
 */

const SUT = resolve(__dirname, "..", "ChatPage.tsx");

function readSource(): string {
  return readFileSync(SUT, "utf8");
}

describe("ChatPage — v3.68 deep-link preservation (B10)", () => {
  it("does NOT delete topic/subject params after seeding", () => {
    const src = readSource();
    expect(src).not.toMatch(/searchParams\.delete\(["']topic["']\)/);
    expect(src).not.toMatch(/searchParams\.delete\(["']subject["']\)/);
  });

  it("does NOT replaceState inside the deep-link prefill effect", () => {
    const src = readSource();
    // Find the deep-link prefill effect and assert no replaceState
    // inside it. The "thread" deep-link effect above it still uses
    // replaceState (deliberately — that one's a one-shot select);
    // we scope the assertion to the v3.68 block.
    const block = src.match(
      /\/\/ v3\.24[\s\S]*?parseChatDeepLinkParams[\s\S]*?eslint-disable-next-line react-hooks\/exhaustive-deps\s*\}, \[\]\);/,
    );
    expect(block, "expected v3.24/v3.68 deep-link prefill effect").toBeTruthy();
    expect(block![0]).not.toMatch(/replaceState/);
  });

  it("imports loadDraft from chat/draftStorage", () => {
    const src = readSource();
    expect(src).toMatch(
      /import\s*\{\s*loadDraft\s*\}\s*from\s*["']\.\/chat\/draftStorage["']/,
    );
  });

  it("guards seed with an existing-draft check before seedComposer", () => {
    const src = readSource();
    // The contract: the deep-link effect calls loadDraft(activeThreadId)
    // and bails (return) when the trimmed result is non-empty, before
    // calling seedComposer.
    const block = src.match(
      /parseChatDeepLinkParams[\s\S]*?seedComposer\(seeded\)/,
    );
    expect(block, "expected effect block").toBeTruthy();
    expect(block![0]).toMatch(/loadDraft\(\s*activeThreadId\s*\)/);
    expect(block![0]).toMatch(/existingDraft\.trim\(\)\.length\s*>\s*0/);
  });
});
