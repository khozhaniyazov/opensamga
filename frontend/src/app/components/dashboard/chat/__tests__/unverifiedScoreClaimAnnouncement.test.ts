/**
 * s35 wave 42 (I5) — vitest pins for the unverified-score-claim
 * detector + announcement helpers.
 */

import { describe, expect, it } from "vitest";
import {
  containsUnverifiedScoreClaim,
  shouldAnnounceUnverifiedScoreClaim,
  unverifiedScoreClaimAnnouncementText,
} from "../unverifiedScoreClaimAnnouncement";

describe("containsUnverifiedScoreClaim — RU positives", () => {
  it("flags 'твой балл 95'", () => {
    expect(containsUnverifiedScoreClaim("Твой балл 95")).toBe(true);
  });

  it("flags 'ваш результат 130 баллов'", () => {
    expect(
      containsUnverifiedScoreClaim("Ваш результат 130 баллов из 140"),
    ).toBe(true);
  });

  it("flags X/140 anchored by 'ты'", () => {
    expect(containsUnverifiedScoreClaim("Ты набрал 120/140 на пробном")).toBe(
      true,
    );
  });

  it("flags X из 140", () => {
    expect(containsUnverifiedScoreClaim("Вы получили 110 из 140")).toBe(true);
  });

  it("flags percentage", () => {
    expect(containsUnverifiedScoreClaim("Твой результат 80%")).toBe(true);
  });
});

describe("containsUnverifiedScoreClaim — KZ positives", () => {
  it("flags 'сенің ұпайың 95'", () => {
    expect(containsUnverifiedScoreClaim("Сенің ұпайың 95 болды")).toBe(true);
  });

  it("flags 'сіздің балыңыз'", () => {
    expect(containsUnverifiedScoreClaim("Сіздің балыңыз 130 балл")).toBe(true);
  });

  it("flags KZ X/140", () => {
    expect(containsUnverifiedScoreClaim("Сен 120/140 алдың")).toBe(true);
  });
});

describe("containsUnverifiedScoreClaim — negatives", () => {
  it("score without pronoun is not a claim", () => {
    expect(containsUnverifiedScoreClaim("Проходной балл — 95")).toBe(false);
  });

  it("pronoun without score is not a claim", () => {
    expect(
      containsUnverifiedScoreClaim("Ты можешь готовиться по этому учебнику"),
    ).toBe(false);
  });

  it("empty string", () => {
    expect(containsUnverifiedScoreClaim("")).toBe(false);
    expect(containsUnverifiedScoreClaim("   ")).toBe(false);
  });

  it("non-string defensive", () => {
    expect(containsUnverifiedScoreClaim(null)).toBe(false);
    expect(containsUnverifiedScoreClaim(undefined)).toBe(false);
    expect(containsUnverifiedScoreClaim(123 as unknown as string)).toBe(false);
  });

  it("does NOT match 'тыкать' (substring of 'ты')", () => {
    expect(
      containsUnverifiedScoreClaim("Не нужно тыкать в одну формулу 5 баллов"),
    ).toBe(false);
  });

  it("does NOT match 'выпускник' (substring of 'вы')", () => {
    expect(
      containsUnverifiedScoreClaim(
        "Каждый выпускник 11 класса должен сдать на 95 баллов",
      ),
    ).toBe(false);
  });
});

describe("unverifiedScoreClaimAnnouncementText", () => {
  it("RU sentence", () => {
    expect(unverifiedScoreClaimAnnouncementText({ lang: "ru" })).toBe(
      "В ответе указан балл — проверьте, что бот посмотрел ваши настоящие данные.",
    );
  });

  it("KZ sentence", () => {
    expect(unverifiedScoreClaimAnnouncementText({ lang: "kz" })).toBe(
      "Жауапта балл саны бар — бот сіздің нақты деректеріңізді көрді ме, тексеріңіз.",
    );
  });
});

describe("shouldAnnounceUnverifiedScoreClaim", () => {
  it("announces fresh id", () => {
    expect(
      shouldAnnounceUnverifiedScoreClaim({
        messageId: "msg-1",
        lastAnnouncedId: null,
      }),
    ).toBe(true);
  });

  it("dedupes against the same id", () => {
    expect(
      shouldAnnounceUnverifiedScoreClaim({
        messageId: "msg-1",
        lastAnnouncedId: "msg-1",
      }),
    ).toBe(false);
  });

  it("announces a different id", () => {
    expect(
      shouldAnnounceUnverifiedScoreClaim({
        messageId: "msg-2",
        lastAnnouncedId: "msg-1",
      }),
    ).toBe(true);
  });

  it("does not announce on null / empty / non-string id", () => {
    expect(
      shouldAnnounceUnverifiedScoreClaim({
        messageId: null,
        lastAnnouncedId: null,
      }),
    ).toBe(false);
    expect(
      shouldAnnounceUnverifiedScoreClaim({
        messageId: "",
        lastAnnouncedId: null,
      }),
    ).toBe(false);
    expect(
      shouldAnnounceUnverifiedScoreClaim({
        messageId: 42 as unknown as string,
        lastAnnouncedId: null,
      }),
    ).toBe(false);
  });
});
