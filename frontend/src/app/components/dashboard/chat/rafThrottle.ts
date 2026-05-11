/**
 * s35 wave 49 (2026-04-28) — `rafThrottle` pure helper.
 *
 * The chat surface has several "fires on every scroll/resize tick"
 * subscriptions that read layout (scrollHeight, scrollTop,
 * clientHeight, getBoundingClientRect) and call setState. On a fast
 * trackpad scroll those handlers can fire 60-120 times per second,
 * each reading layout (forced reflow) and each scheduling React
 * work. The work is correct but redundant: the user only sees one
 * paint per animation frame.
 *
 * `rafThrottle(fn)` wraps a handler so it fires at most once per
 * animation frame. It is the conservative cousin of `lodash.throttle`:
 *
 *   - Coalesces N calls within one frame into one call (using the
 *     LATEST argv — that's the only reading the eventual paint will
 *     show, the intermediate values are stale).
 *   - First call schedules an rAF; trailing calls inside that window
 *     just update the pending argv and return.
 *   - On the rAF tick, the wrapped fn fires once with the latest argv.
 *   - `.cancel()` clears any pending rAF — useful in `useEffect`
 *     cleanups so a fast unmount doesn't leak a stale frame call.
 *
 * Why NOT debounce: debounce delays the trailing edge — the user
 * scrolls, releases, and the pill / scroll-detach state would lag
 * by the debounce window. rAF-throttle keeps every frame fresh.
 *
 * Why NOT setTimeout(0): `setTimeout(0)` doesn't align with the
 * paint cycle, and on some browsers fires faster than rAF (4ms
 * minimum), defeating the whole point.
 *
 * SSR-safe: when `requestAnimationFrame` is missing (Node, very old
 * SSR), we fall back to immediate invocation — better to fire eagerly
 * than to drop the call entirely.
 *
 * Pure helper: no React, no DOM-specific bindings. Tests at
 * `__tests__/rafThrottle.test.ts` cover coalescing, latest-argv,
 * cancel, SSR fallback, and re-arm after firing.
 */

export interface RafThrottled<Args extends unknown[]> {
  (...args: Args): void;
  /** Drop any pending rAF call. Idempotent. */
  cancel: () => void;
}

/** Wrap `fn` so it runs at most once per animation frame, with the
 *  most recent arguments. See module doc for rationale. */
export function rafThrottle<Args extends unknown[]>(
  fn: (...args: Args) => void,
): RafThrottled<Args> {
  let frameId: number | null = null;
  let pendingArgs: Args | null = null;

  const hasRaf =
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { requestAnimationFrame?: unknown })
      .requestAnimationFrame === "function";

  const wrapped = ((...args: Args) => {
    if (!hasRaf) {
      // SSR / very old browser — fire eagerly so we never drop a call.
      fn(...args);
      return;
    }
    pendingArgs = args;
    if (frameId !== null) return;
    frameId = (
      globalThis as { requestAnimationFrame: (cb: () => void) => number }
    ).requestAnimationFrame(() => {
      const argsToUse = pendingArgs;
      frameId = null;
      pendingArgs = null;
      if (argsToUse) fn(...argsToUse);
    });
  }) as RafThrottled<Args>;

  wrapped.cancel = () => {
    if (frameId === null) return;
    if (
      typeof globalThis !== "undefined" &&
      typeof (globalThis as { cancelAnimationFrame?: unknown })
        .cancelAnimationFrame === "function"
    ) {
      (
        globalThis as { cancelAnimationFrame: (id: number) => void }
      ).cancelAnimationFrame(frameId);
    }
    frameId = null;
    pendingArgs = null;
  };

  return wrapped;
}
