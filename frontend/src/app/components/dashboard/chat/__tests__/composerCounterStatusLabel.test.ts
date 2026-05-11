/**
 * s35 wave 18a — vitest pins for composerCounterStatusLabel +
 * composerCounterStatus.
 */

import { describe, it, expect } from "vitest";
import {
  composerCounterStatus,
  composerCounterStatusLabel,
} from "../composerCounterStatusLabel";

describe("composerCounterStatus", () => {
  it("len < soft → 'below' (explicit soft)", () => {
    expect(
      composerCounterStatus({ len: 100, soft: 6400, hard: 8000, lang: "ru" }),
    ).toBe("below");
  });
  it("len === soft → 'near'", () => {
    expect(
      composerCounterStatus({ len: 6400, soft: 6400, hard: 8000, lang: "ru" }),
    ).toBe("near");
  });
  it("len just under hard → 'near'", () => {
    expect(
      composerCounterStatus({ len: 7999, soft: 6400, hard: 8000, lang: "ru" }),
    ).toBe("near");
  });
  it("len === hard → 'near' (boundary)", () => {
    expect(
      composerCounterStatus({ len: 8000, soft: 6400, hard: 8000, lang: "ru" }),
    ).toBe("near");
  });
  it("len > hard → 'over'", () => {
    expect(
      composerCounterStatus({ len: 8001, soft: 6400, hard: 8000, lang: "ru" }),
    ).toBe("over");
  });
  it("soft null → defaults to floor(hard*0.8)", () => {
    // 6400 = 0.8 * 8000 → exactly at threshold ⇒ near
    expect(
      composerCounterStatus({ len: 6400, soft: null, hard: 8000, lang: "ru" }),
    ).toBe("near");
    // 6399 just under default soft ⇒ below
    expect(
      composerCounterStatus({ len: 6399, soft: null, hard: 8000, lang: "ru" }),
    ).toBe("below");
  });
  it("len null → 0 → 'below'", () => {
    expect(
      composerCounterStatus({ len: null, soft: 6400, hard: 8000, lang: "ru" }),
    ).toBe("below");
  });
  it("len NaN → 'below'", () => {
    expect(
      composerCounterStatus({
        len: Number.NaN,
        soft: 6400,
        hard: 8000,
        lang: "ru",
      }),
    ).toBe("below");
  });
  it("len negative → coerced to 0 → 'below'", () => {
    expect(
      composerCounterStatus({
        len: -100,
        soft: 6400,
        hard: 8000,
        lang: "ru",
      }),
    ).toBe("below");
  });
});

describe("composerCounterStatusLabel", () => {
  it("RU below: 'N из M символов'", () => {
    expect(
      composerCounterStatusLabel({
        len: 100,
        soft: 6400,
        hard: 8000,
        lang: "ru",
      }),
    ).toBe("100 из 8000 символов");
  });

  it("KZ below: 'N / M таңба'", () => {
    expect(
      composerCounterStatusLabel({
        len: 100,
        soft: 6400,
        hard: 8000,
        lang: "kz",
      }),
    ).toBe("100 / 8000 таңба");
  });

  it("RU near: appends '· приближаемся к лимиту'", () => {
    expect(
      composerCounterStatusLabel({
        len: 7000,
        soft: 6400,
        hard: 8000,
        lang: "ru",
      }),
    ).toBe("7000 из 8000 символов · приближаемся к лимиту");
  });

  it("KZ near: appends '· лимитке жақын'", () => {
    expect(
      composerCounterStatusLabel({
        len: 7000,
        soft: 6400,
        hard: 8000,
        lang: "kz",
      }),
    ).toBe("7000 / 8000 таңба · лимитке жақын");
  });

  it("RU over: appends '· превышен лимит на N'", () => {
    expect(
      composerCounterStatusLabel({
        len: 8200,
        soft: 6400,
        hard: 8000,
        lang: "ru",
      }),
    ).toBe("8200 из 8000 символов · превышен лимит на 200");
  });

  it("KZ over: appends '· лимит N таңбаға асып кетті'", () => {
    expect(
      composerCounterStatusLabel({
        len: 8200,
        soft: 6400,
        hard: 8000,
        lang: "kz",
      }),
    ).toBe("8200 / 8000 таңба · лимит 200 таңбаға асып кетті");
  });

  it("over by exactly 1 (boundary len = hard + 1)", () => {
    expect(
      composerCounterStatusLabel({
        len: 8001,
        soft: 6400,
        hard: 8000,
        lang: "ru",
      }),
    ).toBe("8001 из 8000 символов · превышен лимит на 1");
  });

  it("len === hard → 'near' (not over by 0)", () => {
    const out = composerCounterStatusLabel({
      len: 8000,
      soft: 6400,
      hard: 8000,
      lang: "ru",
    });
    expect(out).toContain("приближаемся к лимиту");
    expect(out).not.toContain("превышен");
  });

  it("len null → '0 из M символов'", () => {
    expect(
      composerCounterStatusLabel({
        len: null,
        soft: 6400,
        hard: 8000,
        lang: "ru",
      }),
    ).toBe("0 из 8000 символов");
  });

  it("hard null → uses MAX_SAFE_INTEGER guard; never reports 'over'", () => {
    // With explicit soft=80 and len=100, status is 'near' (len >=
    // soft) — that's correct. The point of the MAX_SAFE_INTEGER
    // fallback is purely to prevent 'over' from triggering when
    // the caller hasn't passed a real cap.
    const out = composerCounterStatusLabel({
      len: 100,
      soft: 80,
      hard: null,
      lang: "ru",
    });
    expect(out.startsWith("100 из ")).toBe(true);
    expect(out).not.toContain("превышен");
  });

  it("hard null + soft null → 'below' (default soft = floor(MAX*0.8) is huge)", () => {
    const out = composerCounterStatusLabel({
      len: 100,
      soft: null,
      hard: null,
      lang: "ru",
    });
    expect(out).toBe(`100 из ${Number.MAX_SAFE_INTEGER} символов`);
  });

  it("soft null → default 0.8 boundary respected (RU near)", () => {
    expect(
      composerCounterStatusLabel({
        len: 6400,
        soft: null,
        hard: 8000,
        lang: "ru",
      }),
    ).toBe("6400 из 8000 символов · приближаемся к лимиту");
  });

  it("unknown lang → RU fallback", () => {
    expect(
      composerCounterStatusLabel({
        len: 100,
        soft: 6400,
        hard: 8000,
        // @ts-expect-error — exercising defensive runtime path
        lang: "en",
      }),
    ).toBe("100 из 8000 символов");
  });

  it("len 6.7 → floored to 6", () => {
    expect(
      composerCounterStatusLabel({
        len: 6.7,
        soft: 6400,
        hard: 8000,
        lang: "ru",
      }),
    ).toBe("6 из 8000 символов");
  });
});
