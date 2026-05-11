import { describe, expect, it } from "vitest";
import {
  parseChatDeepLinkParams,
  parseLibraryDeepLinkParams,
  renderChatPrefill,
} from "../weakTopicLinkParams";

describe("parseLibraryDeepLinkParams", () => {
  it("extracts q and subject from a query string", () => {
    expect(
      parseLibraryDeepLinkParams("?q=Algebra&subject=Mathematics"),
    ).toEqual({ q: "Algebra", subject: "Mathematics" });
  });

  it("trims whitespace and treats blank values as null", () => {
    expect(parseLibraryDeepLinkParams("?q=%20%20&subject=%20%20")).toEqual({
      q: null,
      subject: null,
    });
  });

  it("accepts a URLSearchParams instance directly", () => {
    const sp = new URLSearchParams({ q: "Newton's laws" });
    expect(parseLibraryDeepLinkParams(sp)).toEqual({
      q: "Newton's laws",
      subject: null,
    });
  });

  it("returns nulls for missing input", () => {
    expect(parseLibraryDeepLinkParams(null)).toEqual({
      q: null,
      subject: null,
    });
    expect(parseLibraryDeepLinkParams(undefined)).toEqual({
      q: null,
      subject: null,
    });
    expect(parseLibraryDeepLinkParams("")).toEqual({
      q: null,
      subject: null,
    });
  });
});

describe("parseChatDeepLinkParams", () => {
  it("extracts topic and subject", () => {
    expect(
      parseChatDeepLinkParams(
        "?topic=Algebra%20%3E%20Equations&subject=Mathematics",
      ),
    ).toEqual({ topic: "Algebra > Equations", subject: "Mathematics" });
  });

  it("returns subject=null when only topic is provided", () => {
    expect(parseChatDeepLinkParams("?topic=Newton")).toEqual({
      topic: "Newton",
      subject: null,
    });
  });

  it("trims and nulls blank values", () => {
    expect(parseChatDeepLinkParams("?topic=&subject=")).toEqual({
      topic: null,
      subject: null,
    });
  });
});

describe("renderChatPrefill", () => {
  const TEMPLATE =
    "Объясни тему: {topic} ({subject}). Покажи ключевые идеи и пример из учебника со ссылкой на страницу.";

  it("fills both placeholders", () => {
    const out = renderChatPrefill(TEMPLATE, {
      topic: "Algebra",
      subject: "Mathematics",
    });
    expect(out).toContain("Algebra");
    expect(out).toContain("Mathematics");
    expect(out).toContain("(Mathematics)");
  });

  it("collapses empty parens when subject is missing", () => {
    const out = renderChatPrefill(TEMPLATE, {
      topic: "Newton's laws",
      subject: null,
    });
    expect(out).toContain("Newton's laws");
    expect(out).not.toContain("()");
    expect(out).not.toMatch(/\(\s*\)/);
  });

  it("returns empty string when topic is missing", () => {
    expect(
      renderChatPrefill(TEMPLATE, { topic: null, subject: "Mathematics" }),
    ).toBe("");
  });

  it("works with KZ template too", () => {
    const kz =
      "Тақырыпты түсіндір: {topic} ({subject}). Негізгі идеяларды және оқулықтан бет нөмірі көрсетілген мысалды көрсет.";
    const out = renderChatPrefill(kz, {
      topic: "Алгебра",
      subject: "Математика",
    });
    expect(out).toContain("Алгебра");
    expect(out).toContain("Математика");
  });

  it("collapses runs of whitespace introduced by missing placeholders", () => {
    const tpl = "X {topic}   {subject} Y";
    expect(renderChatPrefill(tpl, { topic: "T", subject: null })).toBe("X T Y");
  });
});
