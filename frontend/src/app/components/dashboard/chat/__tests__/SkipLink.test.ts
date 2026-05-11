/**
 * s33 (H6) — vitest pin keeping the skip-link's href target id and
 * the composer's id in sync.
 */

import { describe, expect, it } from "vitest";
import { COMPOSER_SKIP_TARGET_ID, composerTargetId } from "../SkipLink";

describe("SkipLink", () => {
  it("exports a stable target id constant", () => {
    expect(COMPOSER_SKIP_TARGET_ID).toBe("chat-composer-textarea");
  });

  it("composerTargetId() returns the same constant", () => {
    expect(composerTargetId()).toBe(COMPOSER_SKIP_TARGET_ID);
  });
});
