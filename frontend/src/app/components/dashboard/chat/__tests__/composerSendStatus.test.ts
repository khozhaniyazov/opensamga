import { describe, it, expect } from "vitest";
import {
  composerSendStatus,
  detectComposerStatusEdge,
  nextComposerSendStatus,
} from "../composerSendStatus";

describe("composerSendStatus (s35 wave 25d)", () => {
  it("RU send edge → 'sent, waiting for reply'", () => {
    expect(composerSendStatus("send", "ru")).toBe(
      "Сообщение отправлено, ждём ответ",
    );
  });

  it("RU complete edge → 'answer received'", () => {
    expect(composerSendStatus("complete", "ru")).toBe("Ответ получен");
  });

  it("RU null edge → empty string (stay silent)", () => {
    expect(composerSendStatus(null, "ru")).toBe("");
  });

  it("KZ send edge → uninflected mirror", () => {
    expect(composerSendStatus("send", "kz")).toBe(
      "Хабарлама жіберілді, жауапты күтудеміз",
    );
  });

  it("KZ complete edge → uninflected mirror", () => {
    expect(composerSendStatus("complete", "kz")).toBe("Жауап келді");
  });

  it("KZ null edge → empty string", () => {
    expect(composerSendStatus(null, "kz")).toBe("");
  });

  it("unknown lang → RU fallback", () => {
    expect(
      // @ts-expect-error — runtime guard
      composerSendStatus("send", "en"),
    ).toBe("Сообщение отправлено, ждём ответ");
  });
});

describe("detectComposerStatusEdge (s35 wave 25d)", () => {
  it("false→true is a send edge", () => {
    expect(
      detectComposerStatusEdge({
        prevSending: false,
        nextSending: true,
      }),
    ).toBe("send");
  });

  it("true→false is a complete edge", () => {
    expect(
      detectComposerStatusEdge({
        prevSending: true,
        nextSending: false,
      }),
    ).toBe("complete");
  });

  it("false→false is no edge", () => {
    expect(
      detectComposerStatusEdge({
        prevSending: false,
        nextSending: false,
      }),
    ).toBeNull();
  });

  it("true→true is no edge (mid-stream)", () => {
    expect(
      detectComposerStatusEdge({
        prevSending: true,
        nextSending: true,
      }),
    ).toBeNull();
  });
});

describe("nextComposerSendStatus (s35 wave 25d)", () => {
  it("RU rising edge → send sentence", () => {
    expect(
      nextComposerSendStatus({
        prevSending: false,
        nextSending: true,
        lang: "ru",
      }),
    ).toBe("Сообщение отправлено, ждём ответ");
  });

  it("RU falling edge → complete sentence", () => {
    expect(
      nextComposerSendStatus({
        prevSending: true,
        nextSending: false,
        lang: "ru",
      }),
    ).toBe("Ответ получен");
  });

  it("RU no transition → empty", () => {
    expect(
      nextComposerSendStatus({
        prevSending: false,
        nextSending: false,
        lang: "ru",
      }),
    ).toBe("");
    expect(
      nextComposerSendStatus({
        prevSending: true,
        nextSending: true,
        lang: "ru",
      }),
    ).toBe("");
  });

  it("KZ rising → KZ sentence", () => {
    expect(
      nextComposerSendStatus({
        prevSending: false,
        nextSending: true,
        lang: "kz",
      }),
    ).toBe("Хабарлама жіберілді, жауапты күтудеміз");
  });

  it("non-boolean truthy/falsy coerced", () => {
    expect(
      nextComposerSendStatus({
        // @ts-expect-error — runtime coercion
        prevSending: 0,
        // @ts-expect-error — runtime coercion
        nextSending: 1,
        lang: "ru",
      }),
    ).toBe("Сообщение отправлено, ждём ответ");
  });

  it("multi-call purity", () => {
    const a1 = nextComposerSendStatus({
      prevSending: false,
      nextSending: true,
      lang: "ru",
    });
    nextComposerSendStatus({
      prevSending: true,
      nextSending: false,
      lang: "kz",
    });
    const a2 = nextComposerSendStatus({
      prevSending: false,
      nextSending: true,
      lang: "ru",
    });
    expect(a1).toBe(a2);
  });
});
