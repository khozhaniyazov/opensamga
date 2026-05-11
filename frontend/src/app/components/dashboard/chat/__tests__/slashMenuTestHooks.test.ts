import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * v3.69 (B11, 2026-05-02): static-source contract test pinning the
 * slash-menu test hooks.
 *
 * Bug recap: the slash menu visually rendered correctly, but E2E
 * tests querying `[data-radix-popper-content-wrapper]` were finding
 * a different chat popover (Radix-based) and getting back a wrapper
 * with `getComputedStyle().display === null` and a re-query that
 * returned 0 child items. The slash menu does NOT use Radix — so a
 * Radix selector was the wrong tool. v3.69 adds stable
 * `data-testid` + `data-state` + `data-slash-cmd` attributes so
 * keyboard-driven E2E tests can scope to the slash menu directly.
 *
 * No user-visible behaviour change. This is purely a test-hook
 * surface; the visual + a11y semantics (role="menu", aria-label,
 * role="menuitem") are unchanged.
 */

const SUT = resolve(__dirname, "..", "SlashMenuPopover.tsx");

function readSource(): string {
  return readFileSync(SUT, "utf8");
}

describe("SlashMenuPopover — v3.69 stable test hooks (B11)", () => {
  it("the open container has data-testid='chat-slash-menu' + data-state='open'", () => {
    const src = readSource();
    expect(src).toMatch(/data-testid=["']chat-slash-menu["']/);
    expect(src).toMatch(/data-state=["']open["']/);
  });

  it("the empty (no-matches) container shares data-testid + uses data-state='empty'", () => {
    const src = readSource();
    // Both containers have the same testid; the empty one is
    // distinguished by data-state="empty".
    expect(src).toMatch(/data-state=["']empty["']/);
    // Two occurrences of data-testid="chat-slash-menu" total
    // (open + empty container).
    const matches = src.match(/data-testid=["']chat-slash-menu["']/g);
    expect(matches?.length ?? 0).toBe(2);
  });

  it("the list element exposes data-testid='chat-slash-menu-list'", () => {
    const src = readSource();
    expect(src).toMatch(/data-testid=["']chat-slash-menu-list["']/);
  });

  it("each row exposes data-testid='chat-slash-menu-item' + data-slash-cmd={cmd.id}", () => {
    const src = readSource();
    expect(src).toMatch(/data-testid=["']chat-slash-menu-item["']/);
    expect(src).toMatch(/data-slash-cmd=\{cmd\.id\}/);
  });
});
