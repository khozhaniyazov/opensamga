/**
 * s35 wave 59 (2026-04-28) — ChatComposer slash-menu telemetry pins.
 *
 * Component-render not attempted — ChatComposer mounts useViewport,
 * useKeyboardInset, useReducedMotion, the SlashMenuPopover, the
 * cite-page picker, etc. Telemetry surface is small + boss-facing,
 * so we pin it directly via the typed wrappers.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  drainBuffer,
  peekBuffer,
  trackSlashCommandSelected,
  trackSlashMenuOpened,
} from "../../../../lib/telemetry";

beforeEach(() => {
  drainBuffer();
});
afterEach(() => {
  drainBuffer();
});

describe("trackSlashMenuOpened", () => {
  it("emits chat_slash_menu_opened with the open-time match_count", () => {
    trackSlashMenuOpened({ match_count: 7 });
    const buf = peekBuffer();
    expect(buf.length).toBe(1);
    expect(buf[0].event).toBe("chat_slash_menu_opened");
    expect(buf[0].props).toEqual({ match_count: 7 });
  });

  it("preserves zero match_count (user typed `/` with everything filtered out)", () => {
    trackSlashMenuOpened({ match_count: 0 });
    expect(peekBuffer()[0].props.match_count).toBe(0);
  });
});

describe("trackSlashCommandSelected", () => {
  it("emits chat_slash_command_selected with the full payload", () => {
    trackSlashCommandSelected({
      command_id: "cite",
      rank_position: 2,
      match_count: 5,
      via: "mouse",
    });
    const buf = peekBuffer();
    expect(buf.length).toBe(1);
    expect(buf[0].event).toBe("chat_slash_command_selected");
    expect(buf[0].props).toEqual({
      command_id: "cite",
      rank_position: 2,
      match_count: 5,
      via: "mouse",
    });
  });

  it("captures via:keyboard for arrow-key + Enter activation", () => {
    trackSlashCommandSelected({
      command_id: "explain",
      rank_position: 0,
      match_count: 1,
      via: "keyboard",
    });
    expect(peekBuffer()[0].props.via).toBe("keyboard");
  });

  it("preserves rank_position 0 (top of the filtered list)", () => {
    trackSlashCommandSelected({
      command_id: "summarise",
      rank_position: 0,
      match_count: 4,
      via: "mouse",
    });
    expect(peekBuffer()[0].props.rank_position).toBe(0);
  });

  it("event names do NOT collide with sources-drawer / reasoning / template events", () => {
    trackSlashMenuOpened({ match_count: 3 });
    trackSlashCommandSelected({
      command_id: "cite",
      rank_position: 0,
      match_count: 3,
      via: "mouse",
    });
    const events = peekBuffer().map((e) => e.event);
    expect(events).toEqual([
      "chat_slash_menu_opened",
      "chat_slash_command_selected",
    ]);
    expect(events).not.toContain("chat_sources_drawer_toggled");
    expect(events).not.toContain("chat_reasoning_panel_toggled");
    expect(events).not.toContain("chat_template_clicked");
  });

  it("a single open + select sequence emits exactly 2 events in order", () => {
    trackSlashMenuOpened({ match_count: 5 });
    trackSlashCommandSelected({
      command_id: "explain",
      rank_position: 0,
      match_count: 5,
      via: "keyboard",
    });
    const buf = peekBuffer();
    expect(buf.length).toBe(2);
    expect(buf[0].event).toBe("chat_slash_menu_opened");
    expect(buf[1].event).toBe("chat_slash_command_selected");
  });
});
