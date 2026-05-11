import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * v3.71 (B13, 2026-05-02): static-source contract test pinning the
 * retake-guide empty-state card.
 *
 * Bug recap: when the live testcenter.kz fetch failed AND the local
 * FALLBACK_SESSIONS_2026 cache had nothing usable, the page
 * rendered a bare "—" placeholder under "Ближайшие сессии:". v3.71
 * replaces that with a proper empty-state card sourced from three
 * new BE-supplied i18n keys (sessions_empty_title /
 * sessions_empty_body / sessions_empty_link_label) and a link to
 * testcenter.kz.
 *
 * This test pins:
 *   1. The "—" placeholder is gone (no surprise regression).
 *   2. The new card has data-testid="retake-guide-sessions-empty"
 *      and role="status" so a screen reader announces it.
 *   3. The card references the three new BE strings and the
 *      canonical testcenter.kz URL.
 *
 * Static-source pattern: RetakeGuidePage drags the LanguageContext
 * + apiGet + react-query lite via apiGet. The change here is
 * structural — exactly what static-source tests are good for.
 */

const SUT = resolve(__dirname, "..", "RetakeGuidePage.tsx");

function readSource(): string {
  return readFileSync(SUT, "utf8");
}

describe("RetakeGuidePage — v3.71 empty-state card (B13)", () => {
  it("does NOT render the bare '—' placeholder for empty sessions", () => {
    const src = readSource();
    // The pre-v3.71 line was: <p className="text-sm italic text-zinc-500">—</p>
    // Allow the em-dash to appear elsewhere (formatRetakeDate fallbacks),
    // but disallow it as the sole child of an italic-zinc paragraph.
    expect(src).not.toMatch(/text-zinc-500["']\s*>\s*—\s*<\/p>/);
  });

  it("renders a card with the v3.71 testid + role=status when sessions[] is empty", () => {
    const src = readSource();
    expect(src).toMatch(/data-testid=["']retake-guide-sessions-empty["']/);
    expect(src).toMatch(/role=["']status["']/);
  });

  it("references all three new BE-supplied empty-state strings", () => {
    const src = readSource();
    expect(src).toMatch(/s\.sessions_empty_title/);
    expect(src).toMatch(/s\.sessions_empty_body/);
    expect(src).toMatch(/s\.sessions_empty_link_label/);
  });

  it("links out to https://testcenter.kz/ with safe target/rel", () => {
    const src = readSource();
    expect(src).toMatch(/href=["']https:\/\/testcenter\.kz\/?["']/);
    expect(src).toMatch(/target=["']_blank["']/);
    expect(src).toMatch(/rel=["']noopener noreferrer["']/);
  });
});
