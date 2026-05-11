import { describe, expect, it } from "vitest";
import {
  buildUniversitiesQuery,
  parseUniversitiesDeepLink,
} from "../universitiesDeepLink";

describe("parseUniversitiesDeepLink", () => {
  it("returns null when params are missing or empty", () => {
    expect(parseUniversitiesDeepLink(null).majorCode).toBeNull();
    expect(parseUniversitiesDeepLink(undefined).majorCode).toBeNull();
    expect(
      parseUniversitiesDeepLink(new URLSearchParams("")).majorCode,
    ).toBeNull();
    expect(
      parseUniversitiesDeepLink(new URLSearchParams("major_code=")).majorCode,
    ).toBeNull();
    expect(
      parseUniversitiesDeepLink(new URLSearchParams("major_code=%20%20"))
        .majorCode,
    ).toBeNull();
  });

  it("uppercases and trims a clean code", () => {
    expect(
      parseUniversitiesDeepLink(new URLSearchParams("major_code=b057"))
        .majorCode,
    ).toBe("B057");
    expect(
      parseUniversitiesDeepLink(new URLSearchParams("major_code=%20B057%20"))
        .majorCode,
    ).toBe("B057");
  });

  it("rejects garbage characters and overlong values", () => {
    expect(
      parseUniversitiesDeepLink(
        new URLSearchParams("major_code=<script>alert(1)</script>"),
      ).majorCode,
    ).toBeNull();
    expect(
      parseUniversitiesDeepLink(new URLSearchParams("major_code=B057;DROP"))
        .majorCode,
    ).toBeNull();
    expect(
      parseUniversitiesDeepLink(
        new URLSearchParams("major_code=AAAAAAAAAAAAAAAAA"), // 17 chars
      ).majorCode,
    ).toBeNull();
  });

  it("permits dash and underscore (defense-in-depth, not real codes)", () => {
    expect(
      parseUniversitiesDeepLink(new URLSearchParams("major_code=B-57"))
        .majorCode,
    ).toBe("B-57");
    expect(
      parseUniversitiesDeepLink(new URLSearchParams("major_code=B_57"))
        .majorCode,
    ).toBe("B_57");
  });
});

describe("buildUniversitiesQuery", () => {
  it("returns empty string when both filters are blank/null", () => {
    expect(buildUniversitiesQuery({})).toBe("");
    expect(buildUniversitiesQuery({ query: "", majorCode: "" })).toBe("");
    expect(buildUniversitiesQuery({ query: null, majorCode: null })).toBe("");
    expect(buildUniversitiesQuery({ query: "  ", majorCode: "  " })).toBe("");
  });

  it("emits major_code only when set", () => {
    expect(buildUniversitiesQuery({ majorCode: "B057" })).toBe(
      "major_code=B057",
    );
  });

  it("emits both keys when both are set", () => {
    const qs = buildUniversitiesQuery({ query: "kbtu", majorCode: "B057" });
    const params = new URLSearchParams(qs);
    expect(params.get("query")).toBe("kbtu");
    expect(params.get("major_code")).toBe("B057");
  });
});
