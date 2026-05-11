import { describe, it, expect } from "vitest";
import { copyButtonLabel, messageActionsLabels } from "../messageActionsLabels";

describe("messageActionsLabels (s35 wave 24a)", () => {
  it("returns RU built-in labels when no dict is supplied", () => {
    const out = messageActionsLabels("ru");
    expect(out.copy).toBe("Копировать");
    expect(out.copied).toBe("Скопировано");
    expect(out.copyMarkdown).toBe("Копировать как Markdown");
    expect(out.copyPlain).toBe("Копировать как текст");
    expect(out.copyFormat).toBe("Формат копирования");
    expect(out.regenerate).toBe("Перегенерировать");
    expect(out.regenerateDisabled).toBe(
      "Регенерация доступна только для последнего ответа",
    );
  });

  it("returns KZ built-in labels when no dict is supplied", () => {
    const out = messageActionsLabels("kz");
    expect(out.copy).toBe("Көшіру");
    expect(out.copied).toBe("Көшірілді");
    expect(out.copyMarkdown).toBe("Markdown ретінде көшіру");
    expect(out.copyPlain).toBe("Қарапайым мәтін ретінде көшіру");
    expect(out.copyFormat).toBe("Көшіру форматы");
    expect(out.regenerate).toBe("Қайталау");
    expect(out.regenerateDisabled).toBe(
      "Қайта жасауды тек соңғы жауапта қолдануға болады",
    );
  });

  it("ALL fields are non-empty strings (regression: copy_format key was leaking visibly)", () => {
    for (const lang of ["ru", "kz"] as const) {
      const out = messageActionsLabels(lang);
      for (const v of Object.values(out)) {
        expect(typeof v).toBe("string");
        expect(v.length).toBeGreaterThan(0);
        // Critical: helper must NEVER return a raw i18n key.
        expect(v).not.toMatch(/^chat\.action\./);
      }
    }
  });

  it("dict overrides the built-in fallback when supplied", () => {
    const dict: Record<string, string> = {
      "chat.action.copy_format": "Pick a format",
      "chat.action.regenerate": "Re-roll",
    };
    const out = messageActionsLabels("ru", (k) => dict[k] ?? null);
    expect(out.copyFormat).toBe("Pick a format");
    expect(out.regenerate).toBe("Re-roll");
    // Fields with no dict entry keep the built-in fallback.
    expect(out.copy).toBe("Копировать");
    expect(out.copyPlain).toBe("Копировать как текст");
  });

  it("dict miss-as-key (useLang.t semantics) falls through to fallback", () => {
    // `useLang().t` returns the key string itself on miss; helper
    // must treat that as a miss too, not pass it through.
    const passThrough = (k: string) => k;
    const out = messageActionsLabels("ru", passThrough);
    expect(out.copyFormat).toBe("Формат копирования");
    expect(out.copyMarkdown).toBe("Копировать как Markdown");
  });

  it("dict throw is caught — fallback used silently", () => {
    const angry = (_k: string): string => {
      throw new Error("dict blew up");
    };
    const out = messageActionsLabels("ru", angry);
    expect(out.copy).toBe("Копировать");
    expect(out.copyFormat).toBe("Формат копирования");
  });

  it("empty/null/undefined dict values fall through to fallback", () => {
    const dict: Record<string, string | null | undefined> = {
      "chat.action.copy": "",
      "chat.action.copy_format": null,
      "chat.action.regenerate": undefined,
    };
    const out = messageActionsLabels("ru", (k) => dict[k]);
    expect(out.copy).toBe("Копировать");
    expect(out.copyFormat).toBe("Формат копирования");
    expect(out.regenerate).toBe("Перегенерировать");
  });

  it("unknown lang → RU fallback", () => {
    // @ts-expect-error — runtime guard
    const out = messageActionsLabels("en");
    expect(out).toEqual(messageActionsLabels("ru"));
  });

  it("returns a fresh object (caller can safely mutate)", () => {
    const a = messageActionsLabels("ru");
    a.copy = "MUTATED";
    const b = messageActionsLabels("ru");
    expect(b.copy).toBe("Копировать");
  });

  it("RU and KZ outputs differ", () => {
    expect(messageActionsLabels("ru")).not.toEqual(messageActionsLabels("kz"));
  });
});

describe("copyButtonLabel (s35 wave 24a)", () => {
  it("renders the copy verb when not yet copied", () => {
    const out = copyButtonLabel(false, {
      copy: "Копировать",
      copied: "Скопировано",
    });
    expect(out).toBe("Копировать");
  });

  it("renders the past-tense form while copied=true", () => {
    const out = copyButtonLabel(true, {
      copy: "Копировать",
      copied: "Скопировано",
    });
    expect(out).toBe("Скопировано");
  });

  it("works seamlessly off the messageActionsLabels output", () => {
    const labels = messageActionsLabels("kz");
    expect(copyButtonLabel(false, labels)).toBe("Көшіру");
    expect(copyButtonLabel(true, labels)).toBe("Көшірілді");
  });

  it("non-boolean truthy/falsy `copied` values coerce as expected", () => {
    const labels = { copy: "Copy", copied: "Copied" };
    // @ts-expect-error — runtime coercion
    expect(copyButtonLabel(1, labels)).toBe("Copied");
    // @ts-expect-error — runtime coercion
    expect(copyButtonLabel(0, labels)).toBe("Copy");
  });
});
