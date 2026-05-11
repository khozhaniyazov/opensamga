/**
 * s34 wave 9 (G4, 2026-04-28): vitest pins for reasoningHeader.ts.
 *
 * Copy contract is bilingual + plural-sensitive, and we explicitly
 * documented that compact mode drops elapsed + tool count when the
 * iterationCount is the headline metric. Pin every shape so a
 * future renderer rewrite can't silently regress the labels.
 */

import { describe, expect, it } from "vitest";
import {
  buildDoneLabel,
  buildLiveLabel,
  buildReasoningHeader,
  formatReasoningElapsed,
} from "../reasoningHeader";

describe("formatReasoningElapsed", () => {
  it("renders milliseconds under 1000", () => {
    expect(formatReasoningElapsed(842)).toBe("842 ms");
  });

  it("renders 1.0–9.9 s with one decimal", () => {
    expect(formatReasoningElapsed(3400)).toBe("3.4 s");
  });

  it("rounds to whole seconds at 10s+", () => {
    expect(formatReasoningElapsed(12_345)).toBe("12 s");
  });

  it("clamps non-finite / negative", () => {
    expect(formatReasoningElapsed(-1)).toBe("0 ms");
    expect(formatReasoningElapsed(NaN)).toBe("0 ms");
  });
});

describe("buildLiveLabel — full mode", () => {
  it("RU includes elapsed", () => {
    expect(
      buildLiveLabel({
        isStreaming: true,
        iterationCount: 1,
        toolCount: 0,
        elapsedMs: 3400,
        lang: "ru",
      }),
    ).toBe("Размышляю · 3.4 s");
  });

  it("KZ includes elapsed", () => {
    expect(
      buildLiveLabel({
        isStreaming: true,
        iterationCount: 1,
        toolCount: 0,
        elapsedMs: 3400,
        lang: "kz",
      }),
    ).toBe("Ойлап жатырмын · 3.4 s");
  });
});

describe("buildLiveLabel — compact mode", () => {
  it("RU drops elapsed", () => {
    expect(
      buildLiveLabel({
        isStreaming: true,
        iterationCount: 1,
        toolCount: 0,
        elapsedMs: 9999,
        lang: "ru",
        compact: true,
      }),
    ).toBe("Размышляю");
  });

  it("KZ drops elapsed", () => {
    expect(
      buildLiveLabel({
        isStreaming: true,
        iterationCount: 1,
        toolCount: 0,
        elapsedMs: 9999,
        lang: "kz",
        compact: true,
      }),
    ).toBe("Ойлап жатырмын");
  });
});

describe("buildDoneLabel — RU full mode", () => {
  it("zero work — bare 'Готово'", () => {
    expect(
      buildDoneLabel({
        isStreaming: false,
        iterationCount: 0,
        toolCount: 0,
        elapsedMs: 0,
        lang: "ru",
      }),
    ).toBe("Готово");
  });

  it("plural shape '3 шага · 7 инструментов · 4.1 s'", () => {
    expect(
      buildDoneLabel({
        isStreaming: false,
        iterationCount: 3,
        toolCount: 7,
        elapsedMs: 4100,
        lang: "ru",
      }),
    ).toBe("Готово · 3 шагов · 7 инструментов · 4.1 s");
  });

  it("singular tool form", () => {
    expect(
      buildDoneLabel({
        isStreaming: false,
        iterationCount: 1,
        toolCount: 1,
        elapsedMs: 1500,
        lang: "ru",
      }),
    ).toBe("Готово · 1 инструмент · 1.5 s");
  });

  it("genitive 2-4 tool form", () => {
    expect(
      buildDoneLabel({
        isStreaming: false,
        iterationCount: 1,
        toolCount: 3,
        elapsedMs: 1500,
        lang: "ru",
      }),
    ).toBe("Готово · 3 инструмента · 1.5 s");
  });
});

describe("buildDoneLabel — KZ full mode", () => {
  it("zero work — bare 'Дайын'", () => {
    expect(
      buildDoneLabel({
        isStreaming: false,
        iterationCount: 0,
        toolCount: 0,
        elapsedMs: 0,
        lang: "kz",
      }),
    ).toBe("Дайын");
  });

  it("multi-step run renders as 'Дайын · 4 қадам · 9 құрал · 5 s'", () => {
    expect(
      buildDoneLabel({
        isStreaming: false,
        iterationCount: 4,
        toolCount: 9,
        elapsedMs: 5000,
        lang: "kz",
      }),
    ).toBe("Дайын · 4 қадам · 9 құрал · 5.0 s");
  });
});

describe("buildDoneLabel — compact mode", () => {
  it("RU keeps step count, drops tool count + elapsed", () => {
    expect(
      buildDoneLabel({
        isStreaming: false,
        iterationCount: 4,
        toolCount: 9,
        elapsedMs: 5000,
        lang: "ru",
        compact: true,
      }),
    ).toBe("Готово · 4 шагов");
  });

  it("KZ keeps step count, drops tool count + elapsed", () => {
    expect(
      buildDoneLabel({
        isStreaming: false,
        iterationCount: 4,
        toolCount: 9,
        elapsedMs: 5000,
        lang: "kz",
        compact: true,
      }),
    ).toBe("Дайын · 4 қадам");
  });

  it("falls back to tool count when no multi-step (compact, RU)", () => {
    expect(
      buildDoneLabel({
        isStreaming: false,
        iterationCount: 1,
        toolCount: 2,
        elapsedMs: 5000,
        lang: "ru",
        compact: true,
      }),
    ).toBe("Готово · 2 инструмента");
  });

  it("falls back to bare prefix when nothing happened (compact)", () => {
    expect(
      buildDoneLabel({
        isStreaming: false,
        iterationCount: 0,
        toolCount: 0,
        elapsedMs: 5000,
        lang: "ru",
        compact: true,
      }),
    ).toBe("Готово");
  });
});

describe("buildReasoningHeader (top-level)", () => {
  it("delegates to live builder while streaming", () => {
    expect(
      buildReasoningHeader({
        isStreaming: true,
        iterationCount: 0,
        toolCount: 0,
        elapsedMs: 1200,
        lang: "ru",
      }),
    ).toBe("Размышляю · 1.2 s");
  });

  it("delegates to done builder when not streaming", () => {
    expect(
      buildReasoningHeader({
        isStreaming: false,
        iterationCount: 2,
        toolCount: 3,
        elapsedMs: 2000,
        lang: "ru",
      }),
    ).toBe("Готово · 2 шагов · 3 инструмента · 2.0 s");
  });

  it("compact + done + RU produces single-line phone-friendly copy", () => {
    expect(
      buildReasoningHeader({
        isStreaming: false,
        iterationCount: 4,
        toolCount: 7,
        elapsedMs: 4100,
        lang: "ru",
        compact: true,
      }),
    ).toBe("Готово · 4 шагов");
  });
});
