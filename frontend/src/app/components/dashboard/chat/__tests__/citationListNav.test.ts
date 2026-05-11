/**
 * s33 (H3) — vitest pins for the citation-list keyboard helpers.
 */

import { describe, expect, it } from "vitest";
import {
  isCitationActivateKey,
  isCitationNavKey,
  nextCitationIndex,
  rowTabIndex,
} from "../citationListNav";

describe("nextCitationIndex", () => {
  it("ArrowDown advances by one", () => {
    expect(nextCitationIndex("ArrowDown", 0, 3)).toBe(1);
    expect(nextCitationIndex("ArrowDown", 1, 3)).toBe(2);
  });

  it("ArrowDown wraps from last to first", () => {
    expect(nextCitationIndex("ArrowDown", 2, 3)).toBe(0);
  });

  it("ArrowUp moves back by one", () => {
    expect(nextCitationIndex("ArrowUp", 1, 3)).toBe(0);
  });

  it("ArrowUp wraps from first to last", () => {
    expect(nextCitationIndex("ArrowUp", 0, 3)).toBe(2);
  });

  it("Home jumps to 0", () => {
    expect(nextCitationIndex("Home", 5, 8)).toBe(0);
  });

  it("End jumps to last", () => {
    expect(nextCitationIndex("End", 0, 8)).toBe(7);
  });

  it("returns -1 on empty list", () => {
    expect(nextCitationIndex("ArrowDown", 0, 0)).toBe(-1);
  });

  it("normalises out-of-range current", () => {
    // current=10 with length=3 → coerced to 0; ArrowDown → 1.
    expect(nextCitationIndex("ArrowDown", 10, 3)).toBe(1);
    expect(nextCitationIndex("ArrowUp", -5, 3)).toBe(2);
  });

  it("returns current unchanged for irrelevant keys", () => {
    expect(nextCitationIndex("a", 1, 3)).toBe(1);
    expect(nextCitationIndex("Tab", 1, 3)).toBe(1);
  });
});

describe("isCitationNavKey", () => {
  it("recognises arrow + home/end keys", () => {
    expect(isCitationNavKey("ArrowUp")).toBe(true);
    expect(isCitationNavKey("ArrowDown")).toBe(true);
    expect(isCitationNavKey("Home")).toBe(true);
    expect(isCitationNavKey("End")).toBe(true);
  });

  it("returns false for activation / typing keys", () => {
    expect(isCitationNavKey("Enter")).toBe(false);
    expect(isCitationNavKey(" ")).toBe(false);
    expect(isCitationNavKey("Tab")).toBe(false);
    expect(isCitationNavKey("a")).toBe(false);
  });
});

describe("isCitationActivateKey", () => {
  it("recognises Enter and Space (incl. legacy 'Spacebar')", () => {
    expect(isCitationActivateKey("Enter")).toBe(true);
    expect(isCitationActivateKey(" ")).toBe(true);
    expect(isCitationActivateKey("Spacebar")).toBe(true);
  });

  it("returns false for nav keys", () => {
    expect(isCitationActivateKey("ArrowDown")).toBe(false);
    expect(isCitationActivateKey("Home")).toBe(false);
  });
});

describe("rowTabIndex", () => {
  it("active row gets 0, others get -1", () => {
    expect(rowTabIndex(0, 0)).toBe(0);
    expect(rowTabIndex(1, 0)).toBe(-1);
    expect(rowTabIndex(0, 2)).toBe(-1);
    expect(rowTabIndex(2, 2)).toBe(0);
  });
});
