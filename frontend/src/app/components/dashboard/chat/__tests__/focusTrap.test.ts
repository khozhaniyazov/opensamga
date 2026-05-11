/**
 * s32 (H2) — vitest pin tests for the focusTrap pure helpers.
 *
 * The hook itself (`useFocusTrap`) requires a DOM + keyboard event
 * harness; we exercise the helpers (`getFocusableElements`,
 * `nextFocusInTrap`, `wrapFocusIndex`) which carry the contract.
 */

import { describe, expect, it } from "vitest";
import {
  getFocusableElements,
  nextFocusInTrap,
  wrapFocusIndex,
} from "../focusTrap";

function makeRoot(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

function teardown(root: HTMLElement): void {
  document.body.removeChild(root);
}

describe("getFocusableElements", () => {
  it("returns [] for null root", () => {
    expect(getFocusableElements(null)).toEqual([]);
  });

  it("finds buttons, inputs, textareas, selects, anchors with href", () => {
    const root = makeRoot(`
      <button id="b1">b1</button>
      <input id="i1" />
      <textarea id="t1"></textarea>
      <select id="s1"><option>a</option></select>
      <a id="a1" href="#x">x</a>
    `);
    const ids = getFocusableElements(root).map((el) => el.id);
    expect(ids).toEqual(["b1", "i1", "t1", "s1", "a1"]);
    teardown(root);
  });

  it("excludes disabled elements", () => {
    const root = makeRoot(`
      <button id="b1">ok</button>
      <button id="b2" disabled>skip</button>
      <input id="i1" disabled />
    `);
    const ids = getFocusableElements(root).map((el) => el.id);
    expect(ids).toEqual(["b1"]);
    teardown(root);
  });

  it('excludes tabindex="-1" but keeps tabindex="0"', () => {
    const root = makeRoot(`
      <div id="d1" tabindex="0">visible</div>
      <div id="d2" tabindex="-1">programmatic only</div>
    `);
    const ids = getFocusableElements(root).map((el) => el.id);
    expect(ids).toEqual(["d1"]);
    teardown(root);
  });

  it("excludes anchors without href (not natively tabbable)", () => {
    const root = makeRoot(`
      <a id="a1">no href</a>
      <a id="a2" href="#y">has href</a>
    `);
    const ids = getFocusableElements(root).map((el) => el.id);
    expect(ids).toEqual(["a2"]);
    teardown(root);
  });

  it("skips elements behind aria-hidden ancestors", () => {
    const root = makeRoot(`
      <div aria-hidden="true">
        <button id="hidden">skip</button>
      </div>
      <button id="visible">ok</button>
    `);
    const ids = getFocusableElements(root).map((el) => el.id);
    expect(ids).toEqual(["visible"]);
    teardown(root);
  });

  it("preserves document order across nested containers", () => {
    const root = makeRoot(`
      <div>
        <button id="b1">1</button>
        <div>
          <button id="b2">2</button>
        </div>
      </div>
      <button id="b3">3</button>
    `);
    const ids = getFocusableElements(root).map((el) => el.id);
    expect(ids).toEqual(["b1", "b2", "b3"]);
    teardown(root);
  });
});

describe("wrapFocusIndex", () => {
  it("returns the index unchanged when in range", () => {
    expect(wrapFocusIndex(0, 4)).toBe(0);
    expect(wrapFocusIndex(2, 4)).toBe(2);
  });

  it("wraps positive overflow", () => {
    expect(wrapFocusIndex(4, 4)).toBe(0);
    expect(wrapFocusIndex(7, 4)).toBe(3);
  });

  it("wraps negative underflow (Shift+Tab from first focusable)", () => {
    expect(wrapFocusIndex(-1, 4)).toBe(3);
    expect(wrapFocusIndex(-5, 4)).toBe(3);
  });

  it("returns 0 on non-positive length", () => {
    expect(wrapFocusIndex(2, 0)).toBe(0);
    expect(wrapFocusIndex(2, -3)).toBe(0);
  });

  it("returns 0 on non-finite values", () => {
    expect(wrapFocusIndex(Number.NaN, 4)).toBe(0);
    expect(wrapFocusIndex(Number.POSITIVE_INFINITY, 4)).toBe(0);
    expect(wrapFocusIndex(2, Number.NaN)).toBe(0);
  });
});

describe("nextFocusInTrap", () => {
  it("Tab forward from index 0 lands on index 1", () => {
    expect(nextFocusInTrap(0, 3, "forward")).toBe(1);
  });

  it("Tab forward from the last index wraps to 0", () => {
    expect(nextFocusInTrap(2, 3, "forward")).toBe(0);
  });

  it("Shift+Tab from index 1 lands on index 0", () => {
    expect(nextFocusInTrap(1, 3, "backward")).toBe(0);
  });

  it("Shift+Tab from index 0 wraps to the last index", () => {
    expect(nextFocusInTrap(0, 3, "backward")).toBe(2);
  });

  it("currentIdx=-1 (focus outside trap) lands on first on Tab forward", () => {
    // Real-world: a click on the modal backdrop blurs the
    // previously-focused button, leaving document.activeElement on
    // body. Tab should pull focus into the dialog.
    expect(nextFocusInTrap(-1, 3, "forward")).toBe(0);
  });

  it("currentIdx=-1 lands on last on Shift+Tab", () => {
    expect(nextFocusInTrap(-1, 3, "backward")).toBe(2);
  });

  it("returns -1 on empty list (caller short-circuits)", () => {
    expect(nextFocusInTrap(0, 0, "forward")).toBe(-1);
    expect(nextFocusInTrap(-1, 0, "backward")).toBe(-1);
  });
});
