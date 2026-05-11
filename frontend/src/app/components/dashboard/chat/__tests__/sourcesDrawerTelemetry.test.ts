/**
 * s35 wave 55 (2026-04-28) — SourcesDrawer telemetry pure pins.
 *
 * The new track* helpers are wired through telemetry's in-memory
 * buffer. Pinning the contract via `peekBuffer` is enough — the
 * full RTL render is exercised by the existing SourcesDrawer
 * suite (SourcesDrawer.test.tsx, ~30+ pins).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  trackSourcesDrawerRowClicked,
  trackSourcesDrawerToggled,
} from "../../../../lib/telemetry";
import { drainBuffer, peekBuffer } from "../../../../lib/telemetry";

beforeEach(() => {
  drainBuffer();
});

afterEach(() => {
  drainBuffer();
});

describe("trackSourcesDrawerToggled", () => {
  it("emits chat_sources_drawer_toggled with the post-toggle is_open=true", () => {
    trackSourcesDrawerToggled({ source_count: 3, is_open: true });
    const buf = peekBuffer();
    expect(buf.length).toBe(1);
    expect(buf[0].event).toBe("chat_sources_drawer_toggled");
    expect(buf[0].props.source_count).toBe(3);
    expect(buf[0].props.is_open).toBe(true);
  });

  it("emits chat_sources_drawer_toggled with is_open=false on collapse", () => {
    trackSourcesDrawerToggled({ source_count: 5, is_open: false });
    const buf = peekBuffer();
    expect(buf[0].props.is_open).toBe(false);
    expect(buf[0].props.source_count).toBe(5);
  });

  it("preserves a 0 source_count without coercing it away", () => {
    // Should never happen at the call site (drawer doesn't render
    // when count===0), but we want the type-level guarantee that
    // the helper passes the value through unchanged.
    trackSourcesDrawerToggled({ source_count: 0, is_open: true });
    const buf = peekBuffer();
    expect(buf[0].props.source_count).toBe(0);
  });
});

describe("trackSourcesDrawerRowClicked", () => {
  it("emits chat_sources_drawer_row_clicked with full payload", () => {
    trackSourcesDrawerRowClicked({
      book_id: 42,
      page_number: 18,
      row_index: 1,
      source_count: 4,
    });
    const buf = peekBuffer();
    expect(buf.length).toBe(1);
    expect(buf[0].event).toBe("chat_sources_drawer_row_clicked");
    expect(buf[0].props).toEqual({
      book_id: 42,
      page_number: 18,
      row_index: 1,
      source_count: 4,
    });
  });

  it("preserves null book_id (legacy / unmatched citation)", () => {
    trackSourcesDrawerRowClicked({
      book_id: null,
      page_number: 5,
      row_index: 0,
      source_count: 1,
    });
    const buf = peekBuffer();
    expect(buf[0].props.book_id).toBeNull();
  });

  it("event names DO NOT collide with the existing chip-click event", () => {
    // Spec contract: drawer-row click must be a DISTINCT event from
    // the inline chip click (`chat_citation_clicked`). Locks the
    // dashboard wiring against a future "let's just merge them"
    // refactor that would silently drop a year of split-funnel data.
    trackSourcesDrawerRowClicked({
      book_id: 1,
      page_number: 1,
      row_index: 0,
      source_count: 1,
    });
    const buf = peekBuffer();
    expect(buf[0].event).not.toBe("chat_citation_clicked");
    expect(buf[0].event).toBe("chat_sources_drawer_row_clicked");
  });
});
