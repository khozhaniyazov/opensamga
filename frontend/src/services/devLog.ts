/**
 * services/devLog.ts — DEV-gated console wrappers.
 *
 * v3.76 (2026-05-03): the FE equivalent of the v3.45-v3.57 BE
 * print-sweep arc. Network-layer modules (`services/api.ts`,
 * `services/chatWebSocket.ts`, `api/client.ts`) used to write raw
 * `console.error` lines on every transient failure — leaking axios
 * error objects (URL, headers, request body) to the browser console
 * in production. Production users see this in the devtools console
 * if they ever open it; more importantly, Sentry-style log scrapers
 * pick it up.
 *
 * The pattern mirrors the established gates in this repo:
 *   - `src/i18n.ts:88` — `if (import.meta.env?.DEV) console.debug(...)`
 *   - `src/app/lib/telemetry.ts:56` — same shape.
 *   - `src/app/components/dashboard/chat/useSendMessage.ts:830` —
 *     `if (process.env.NODE_ENV !== "production") console.warn(...)`
 *
 * This module collapses those ad-hoc gates into 4 helpers so the
 * call sites stay terse and a future "swap to a real logger" pass
 * has one chokepoint to update.
 *
 * NOT for use in error boundaries (those are user-visible diagnostic
 * surfaces and should remain ungated — see
 * `app/components/shared/ErrorBoundaries.tsx`).
 */

/** Returns true when running under Vite DEV (= `npm run dev`). */
function isDev(): boolean {
  // `import.meta.env?.DEV` is the canonical Vite signal. Optional
  // chaining defends against test environments / SSR shims where
  // `import.meta.env` may be undefined.
  return Boolean(import.meta.env?.DEV);
}

/** DEV-only `console.log`. No-op in production. */
export function devLog(...args: unknown[]): void {
  if (isDev()) {
    console.log(...args);
  }
}

/** DEV-only `console.warn`. No-op in production. */
export function devWarn(...args: unknown[]): void {
  if (isDev()) {
    console.warn(...args);
  }
}

/**
 * DEV-only `console.error`. No-op in production.
 *
 * Use for network-layer / parser-layer failures where the user-
 * visible surface is already handled by a `setError(...)` /
 * `throw` / catch chain — the console line is purely a developer
 * convenience while iterating.
 *
 * Do NOT use for genuine "the app is broken, the user can't see it"
 * paths. Those should go through `app/lib/telemetry.ts:track(...)`
 * so they reach the dashboard, not just the local devtools.
 */
export function devError(...args: unknown[]): void {
  if (isDev()) {
    console.error(...args);
  }
}

/** DEV-only `console.debug`. No-op in production. */
export function devDebug(...args: unknown[]): void {
  if (isDev()) {
    console.debug(...args);
  }
}
