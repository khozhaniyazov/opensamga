import { describe, it, expect } from "vitest";
import {
  composerCounterMilestone,
  composerCounterAnnouncement,
} from "../composerCounterAnnounce";

const SOFT = 4000;
const HARD = 8000;
const WARN_FLOOR = Math.floor(HARD * 0.8); // 6400

describe("composerCounterMilestone", () => {
  it("returns 'below' under the soft limit", () => {
    expect(composerCounterMilestone({ len: 0, soft: SOFT, hard: HARD })).toBe(
      "below",
    );
    expect(
      composerCounterMilestone({ len: SOFT, soft: SOFT, hard: HARD }),
    ).toBe("below");
    expect(
      composerCounterMilestone({ len: SOFT - 1, soft: SOFT, hard: HARD }),
    ).toBe("below");
  });

  it("returns 'soft' between soft and 80% of hard", () => {
    expect(
      composerCounterMilestone({ len: SOFT + 1, soft: SOFT, hard: HARD }),
    ).toBe("soft");
    expect(
      composerCounterMilestone({ len: WARN_FLOOR - 1, soft: SOFT, hard: HARD }),
    ).toBe("soft");
  });

  it("returns 'warn' from 80% of hard up to and including hard", () => {
    expect(
      composerCounterMilestone({ len: WARN_FLOOR, soft: SOFT, hard: HARD }),
    ).toBe("warn");
    expect(
      composerCounterMilestone({ len: HARD, soft: SOFT, hard: HARD }),
    ).toBe("warn");
  });

  it("returns 'over' strictly above hard", () => {
    expect(
      composerCounterMilestone({ len: HARD + 1, soft: SOFT, hard: HARD }),
    ).toBe("over");
    expect(
      composerCounterMilestone({ len: HARD * 2, soft: SOFT, hard: HARD }),
    ).toBe("over");
  });

  it("clamps negative len to 0 (below)", () => {
    expect(composerCounterMilestone({ len: -50, soft: SOFT, hard: HARD })).toBe(
      "below",
    );
  });

  it("survives soft >= hard by widening hard at least one above soft (no crash, returns a valid bucket)", () => {
    const out = composerCounterMilestone({ len: 4, soft: 5, hard: 5 });
    expect(["below", "soft", "warn", "over"]).toContain(out);
    // len=4 < soft=5 → 'below' (soft is inclusive lower bound for 'below').
    expect(out).toBe("below");
  });
});

describe("composerCounterAnnouncement", () => {
  it("emits empty string when bucket unchanged", () => {
    expect(
      composerCounterAnnouncement(
        "soft",
        "soft",
        { len: 4500, soft: SOFT, hard: HARD },
        "ru",
      ),
    ).toBe("");
  });

  it("emits empty string when transitioning to 'below'", () => {
    expect(
      composerCounterAnnouncement(
        "warn",
        "below",
        { len: 100, soft: SOFT, hard: HARD },
        "ru",
      ),
    ).toBe("");
  });

  it("announces RU 'Приближаетесь к лимиту' on below→soft", () => {
    const out = composerCounterAnnouncement(
      "below",
      "soft",
      { len: 4500, soft: SOFT, hard: HARD },
      "ru",
    );
    expect(out).toMatch(/Приближаетесь к лимиту/);
    expect(out).toMatch(/3500/); // 8000 - 4500
  });

  it("announces RU 'Почти у лимита' on soft→warn with remaining count", () => {
    const out = composerCounterAnnouncement(
      "soft",
      "warn",
      { len: WARN_FLOOR, soft: SOFT, hard: HARD },
      "ru",
    );
    expect(out).toMatch(/Почти у лимита/);
    expect(out).toMatch(/1600/); // 8000 - 6400
  });

  it("announces RU 'Превышен лимит' on warn→over with overflow count", () => {
    const out = composerCounterAnnouncement(
      "warn",
      "over",
      { len: HARD + 17, soft: SOFT, hard: HARD },
      "ru",
    );
    expect(out).toMatch(/Превышен лимит/);
    expect(out).toMatch(/17/);
  });

  it("announces KZ copy on KZ lang", () => {
    expect(
      composerCounterAnnouncement(
        "below",
        "soft",
        { len: 4500, soft: SOFT, hard: HARD },
        "kz",
      ),
    ).toMatch(/жақындап/);
    expect(
      composerCounterAnnouncement(
        "soft",
        "warn",
        { len: WARN_FLOOR, soft: SOFT, hard: HARD },
        "kz",
      ),
    ).toMatch(/Шекке өте жақын/);
    expect(
      composerCounterAnnouncement(
        "warn",
        "over",
        { len: HARD + 5, soft: SOFT, hard: HARD },
        "kz",
      ),
    ).toMatch(/Шектен асып кетті/);
  });

  it("never duplicates the SR string within the same bucket on every keystroke", () => {
    // Simulate 100 keystrokes typed within the 'soft' bucket — the
    // throttle must produce a single announcement on entry and
    // empty strings for the rest.
    let prev: ReturnType<typeof composerCounterMilestone> = "below";
    const announcements: string[] = [];
    for (let len = SOFT - 5; len <= SOFT + 100; len++) {
      const next = composerCounterMilestone({ len, soft: SOFT, hard: HARD });
      const speak = composerCounterAnnouncement(
        prev,
        next,
        { len, soft: SOFT, hard: HARD },
        "ru",
      );
      if (speak) announcements.push(speak);
      prev = next;
    }
    // Crossing soft yields exactly one announcement.
    expect(announcements).toHaveLength(1);
    expect(announcements[0]).toMatch(/Приближаетесь/);
  });
});
