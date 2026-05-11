/**
 * v3.64 (2026-05-02) — `lib.searchScope` copy contract pins.
 *
 * Backstory: B4 in the 2026-05-02 E2E report. A user typed "Ом"
 * into /dashboard/library?subject=physics, expecting to find the
 * Ohm's Law section, and got "Найдено: 0" with no explanation.
 * The search bar matches book titles + subjects only, not chapter
 * content; the empty-state copy didn't mention this. Students who
 * type a topic instead of a subject hit a wall.
 *
 * v3.64 adds an `lib.searchScope` translation key + an empty-state
 * branch in LibraryPage that surfaces it only when
 * `query.trim().length > 0`. These tests pin the copy via the
 * public `useLang().t()` API.
 */

import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";

import { LanguageProvider, useLang } from "../../LanguageContext";

function Wrapper({ children }: { children: ReactNode }) {
  return createElement(LanguageProvider, null, children);
}

describe("lib.searchScope copy (v3.64)", () => {
  it("RU copy is non-empty and explains the title-only scope + chat fallback", () => {
    const { result } = renderHook(() => useLang(), { wrapper: Wrapper });
    act(() => result.current.setLang("ru"));
    const text = result.current.t("lib.searchScope");
    expect(text).toBeTruthy();
    expect(text).not.toBe("lib.searchScope"); // not a missing-key passthrough
    // Substring matches keep this resilient against copy tweaks
    // that preserve the meaning.
    expect(text).toMatch(/назван/i); // "по названиям и предметам учебников"
    expect(text).toMatch(/чат/i); // "задайте вопрос в чате"
  });

  it("KZ copy is non-empty and points at chat as the content-search escape hatch", () => {
    const { result } = renderHook(() => useLang(), { wrapper: Wrapper });
    act(() => result.current.setLang("kz"));
    const text = result.current.t("lib.searchScope");
    expect(text).toBeTruthy();
    expect(text).not.toBe("lib.searchScope");
    expect(text).toMatch(/чат/i); // "чатқа сұрақ қойыңыз"
    expect(text).toMatch(/тақырып/i); // "тақырыпты табу үшін"
  });

  it("RU and KZ copy differ (regression guard for missing localisation)", () => {
    const { result } = renderHook(() => useLang(), { wrapper: Wrapper });
    act(() => result.current.setLang("ru"));
    const ruText = result.current.t("lib.searchScope");
    act(() => result.current.setLang("kz"));
    const kzText = result.current.t("lib.searchScope");
    expect(ruText).not.toEqual(kzText);
  });

  it("t() falls back to the key itself for missing entries (sanity check)", () => {
    const { result } = renderHook(() => useLang(), { wrapper: Wrapper });
    expect(result.current.t("lib.searchScope.does.not.exist")).toBe(
      "lib.searchScope.does.not.exist",
    );
  });
});
