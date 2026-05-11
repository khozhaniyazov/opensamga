/**
 * Lightweight telemetry stub (session 21 Phase B, 2026-04-22).
 *
 * Design goals:
 *   - Zero external dependency. The PostHog / Mixpanel choice is not yet
 *     locked in (DESIGN_CHAT_FLAGSHIP.md §8 lists both). Rather than
 *     commit to one now and re-wire everything later, we buffer events
 *     here and expose a tiny `track()` surface. A single concrete
 *     transport can be plugged in later by replacing `flushBuffer()`.
 *   - Non-blocking. Never throws; swallows errors so a telemetry bug
 *     can never break the chat UX.
 *   - Dev visibility. In dev mode each event is mirrored to
 *     `console.debug` so we can see the event stream during manual QA
 *     (this is what unblocked empty-state-card tuning in sessions 18-20).
 *   - Navigation-safe. Flushes via `navigator.sendBeacon` on page hide
 *     so events from the user's last interaction aren't lost.
 *
 * The full event catalogue lives in DESIGN_CHAT_FLAGSHIP.md §8. This
 * file defines type-safe helpers for the ones Phase B actually emits.
 */

import { sanitizeProps } from "./telemetrySanitize";

// Generic prop bag. The local typed-event helpers below pass typed
// interfaces in; at the boundary we widen with a single cast so
// strict-TS doesn't reject typed interfaces (which lack an implicit
// index signature) being assigned to Record<string, unknown>.
export type EventProps = Record<string, unknown>;

interface BufferedEvent {
  event: string;
  props: EventProps;
  ts: number; // epoch ms
}

const BUFFER: BufferedEvent[] = [];
const MAX_BUFFER = 500;

/** Public entry point. Never throws. */
export function track(event: string, props: object = {}): void {
  try {
    // s35 wave 68 (2026-04-28): every emit goes through the
    // sanitizer. Drops common PII keys (email/phone/password/
    // token/secret/iin), truncates long strings, recurses into
    // nested objects up to MAX_DEPTH. The `{ ...props }` shallow
    // copy is now redundant but kept for defensive-style parity
    // — sanitizeProps itself returns a fresh object.
    const ev: BufferedEvent = {
      event,
      props: sanitizeProps({ ...props } as Record<string, unknown>),
      ts: Date.now(),
    };
    BUFFER.push(ev);
    if (BUFFER.length > MAX_BUFFER) BUFFER.shift();

    if (import.meta.env?.DEV) {
      console.debug("[telemetry]", event, props);
    }
  } catch {
    // Never let telemetry throw into the React render path.
  }
}

/** Drain the buffer. Returns the events that were captured. */
export function drainBuffer(): BufferedEvent[] {
  const out = BUFFER.splice(0, BUFFER.length);
  return out;
}

/** Inspector for debugging / QA. Non-mutating. */
export function peekBuffer(): ReadonlyArray<BufferedEvent> {
  return BUFFER.slice();
}

/**
 * Flush on navigation. Placeholder transport: POSTs only when
 * `VITE_TELEMETRY_ENDPOINT` is configured. Until then this is a no-op
 * sink — events still live in the dev console and the in-memory buffer
 * for manual inspection via `window.__samga_telemetry = peekBuffer()`.
 *
 * Exported (s35 wave 71, 2026-04-28) so tests can pin the
 * navigation-safe contract: no-op when no endpoint, no-op on empty
 * buffer, drains the buffer on success, swallows transport errors.
 */
export function flushBuffer(): void {
  const endpoint = import.meta.env?.VITE_TELEMETRY_ENDPOINT as
    | string
    | undefined;
  if (!endpoint) return;

  const events = drainBuffer();
  if (events.length === 0) return;
  try {
    const blob = new Blob([JSON.stringify({ events })], {
      type: "application/json",
    });
    if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
      navigator.sendBeacon(endpoint, blob);
    }
  } catch {
    // Swallow. Dropped events are a better outcome than a runtime crash.
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushBuffer);
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushBuffer();
  });
  // Expose a debugging handle for manual QA. Harmless in prod.
  (
    window as unknown as {
      __samga_telemetry?: () => ReadonlyArray<BufferedEvent>;
    }
  ).__samga_telemetry = peekBuffer;
}

// ---------------------------------------------------------------------------
// Typed helpers — keep the call-site short and misuse-proof.
// ---------------------------------------------------------------------------

export interface ChatMessageSentProps {
  locale: string;
  source: "composer" | "empty_card" | "regen";
  has_text_len: number;
  // s35 wave 62 (2026-04-28): true on the FIRST chat_message_sent
  // event after page mount, false on every subsequent send. Lets
  // dashboards split first-turn behaviour from continued-session
  // behaviour without joining against session_start events.
  is_first_send?: boolean;
  // s35 wave 62: ms from page mount → send. Only meaningful when
  // is_first_send=true (continued sends would have huge values
  // dominated by reading-time, not actionable). null when the
  // page-mount timestamp wasn't available (defensive — should
  // never happen in practice but the helper handles it).
  time_to_first_send_ms?: number | null;
}
export function trackChatMessageSent(props: ChatMessageSentProps): void {
  track("chat_message_sent", props);
}

export interface ChatEmptyStateCardClickedProps {
  card_id: string;
  locale: string;
  is_personalized: boolean;
}
export function trackChatEmptyStateCardClicked(
  props: ChatEmptyStateCardClickedProps,
): void {
  track("chat_empty_state_card_clicked", props);
}

// s22c: one-click prompt template pills on the empty state (below
// the 4 capability cards). Distinct event so we can see uptake for
// "Compare min scores vs your scores" etc. separately from the
// flagship capability cards.
//
// `rank_position` is 0-based — the slot the pill occupied at click
// time (post-personalisation ranking). `was_personalized` is true
// when the student had any non-default signal in
// /api/chat/template-context at mount (mistakes / exams / library
// activity / weakness tag). These let us measure uplift of the
// smart-ordering pass independently of raw click-through.
export interface ChatTemplateClickedProps {
  template_id: string;
  locale: string;
  rank_position?: number;
  was_personalized?: boolean;
  /** s35 wave 54 (2026-04-28) — ms between component mount and the
   *  click. Lets the funnel split "reflexive" tile clicks from
   *  "deliberate" ones. Computed via templateDwell.computeDwellMs.
   *  0 when the timing math couldn't run (mount race / clock drift). */
  dwell_ms_since_mount?: number;
}
export function trackChatTemplateClicked(
  props: ChatTemplateClickedProps,
): void {
  track("chat_template_clicked", props);
}

export interface CitationHoverProps {
  book_id: number | null;
  page_number: number;
  dwell_ms: number;
}
export function trackCitationHover(props: CitationHoverProps): void {
  track("chat_citation_hover", props);
}

export interface CitationClickedProps {
  book_id: number | null;
  page_number: number;
  // s35 wave 61 (2026-04-28): optional hover-to-click dwell.
  // null when the user clicked without a prior hover (keyboard
  // activation, touch tap that doesn't emit mouseenter, etc.).
  hover_dwell_ms?: number | null;
}
export function trackCitationClicked(props: CitationClickedProps): void {
  track("chat_citation_clicked", props);
}

export interface FeedbackSubmittedProps {
  rag_query_log_id: number | null;
  rating: 1 | -1;
}
export function trackFeedbackSubmitted(props: FeedbackSubmittedProps): void {
  track("chat_feedback_submitted", props);
}

// s35 wave 55 (2026-04-28): SourcesDrawer expand/collapse.
// `source_count` is the number of consulted sources rendered in the
// drawer at toggle time. `is_open` is the post-toggle state — true
// when the user just opened, false when they collapsed.
export interface SourcesDrawerToggledProps {
  source_count: number;
  is_open: boolean;
}
export function trackSourcesDrawerToggled(
  props: SourcesDrawerToggledProps,
): void {
  track("chat_sources_drawer_toggled", props);
}

// s35 wave 59 (2026-04-28): ChatComposer slash menu lifecycle.
// Two events — open (transition from closed→open) and command
// selected (user picked a row).
//
// `match_count` on the open event is how many commands matched the
// initial query at open time (almost always SLASH_COMMANDS.length
// since the user just typed `/`). `match_count` on the selected
// event is the visible filtered list at click/keyboard-activate
// time. `command_id` is the stable id of the picked row
// (NEVER translate). `via` distinguishes mouse vs keyboard activate
// so we can see which path actually drives engagement.
export interface SlashMenuOpenedProps {
  /** Number of matching commands at open time. */
  match_count: number;
}
export function trackSlashMenuOpened(props: SlashMenuOpenedProps): void {
  track("chat_slash_menu_opened", props);
}

export interface SlashCommandSelectedProps {
  command_id: string;
  /** 0-based row index inside the filtered list at activation time. */
  rank_position: number;
  /** Filtered list size at activation time — tells us if the user
   *  picked a 1-of-1 (typed the exact prefix) or 1-of-many. */
  match_count: number;
  /** "mouse" | "keyboard" — split so we can see whether the menu
   *  is primarily a mouse or arrow-key driven affordance. */
  via: "mouse" | "keyboard";
}
export function trackSlashCommandSelected(
  props: SlashCommandSelectedProps,
): void {
  track("chat_slash_command_selected", props);
}

// s35 wave 57 (2026-04-28): ReasoningPanel toggle.
// `is_open` is the post-toggle state. `is_streaming` lets the
// dashboard split "user opened the panel mid-run to watch tools
// fire" (high engagement) from "user opened it post-run to inspect
// citations" (different intent — usually a trust check).
// `tool_count` and `iteration_count` give us "panel weight" so we
// can correlate engagement with how heavy the run actually was.
export interface ReasoningPanelToggledProps {
  is_open: boolean;
  is_streaming: boolean;
  tool_count: number;
  iteration_count: number;
}
export function trackReasoningPanelToggled(
  props: ReasoningPanelToggledProps,
): void {
  track("chat_reasoning_panel_toggled", props);
}

// s35 wave 55 (2026-04-28): individual citation row click within
// the SourcesDrawer. Distinct from `chat_citation_clicked`
// (inline-chip click in the prose) because the drawer click
// pattern is "user actively went looking for the source list" vs
// the in-flow chip which they hit while reading.
export interface SourcesDrawerRowClickedProps {
  book_id: number | null;
  page_number: number;
  /** 0-based row index inside the drawer at click time. */
  row_index: number;
  /** Drawer size at click time — tells us if the user clicked one
   *  of many vs one of one. */
  source_count: number;
}
export function trackSourcesDrawerRowClicked(
  props: SourcesDrawerRowClickedProps,
): void {
  track("chat_sources_drawer_row_clicked", props);
}
