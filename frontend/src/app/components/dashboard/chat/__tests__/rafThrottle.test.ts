/**
 * s35 wave 49 (2026-04-28) — vitest pins for `rafThrottle`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rafThrottle } from "../rafThrottle";

describe("rafThrottle — animation-frame coalescing", () => {
  // Spies. We only need the .mockRestore() handle, so use the
  // narrowest interface that exposes it.
  type SpyHandle = { mockRestore: () => void };
  let raf: SpyHandle;
  let caf: SpyHandle;
  let pending: Array<{ id: number; cb: () => void }> = [];
  let nextId = 1;

  beforeEach(() => {
    pending = [];
    nextId = 1;
    raf = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        const id = nextId++;
        pending.push({ id, cb: () => cb(performance.now()) });
        return id;
      });
    caf = vi
      .spyOn(globalThis, "cancelAnimationFrame")
      .mockImplementation((id: number) => {
        pending = pending.filter((p) => p.id !== id);
      });
  });

  afterEach(() => {
    raf.mockRestore();
    caf.mockRestore();
  });

  /** Run all pending rAF callbacks (one frame). Mirrors the real
   *  browser flushing all rAFs at the next paint tick. */
  function flushFrame() {
    const toRun = pending;
    pending = [];
    for (const p of toRun) p.cb();
  }

  it("coalesces N calls within one frame to a single fn invocation", () => {
    const fn = vi.fn();
    const throttled = rafThrottle(fn);

    throttled(1);
    throttled(2);
    throttled(3);
    expect(fn).not.toHaveBeenCalled();

    flushFrame();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("fires with the LATEST argv from the pending window", () => {
    const fn = vi.fn();
    const throttled = rafThrottle(fn);

    throttled("first");
    throttled("middle");
    throttled("last");

    flushFrame();
    expect(fn).toHaveBeenCalledWith("last");
  });

  it("re-arms after firing — second burst gets its own frame", () => {
    const fn = vi.fn();
    const throttled = rafThrottle<[number]>(fn);

    throttled(1);
    flushFrame();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith(1);

    throttled(2);
    throttled(3);
    flushFrame();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith(3);
  });

  it("only schedules one rAF per pending window, not one per call", () => {
    const fn = vi.fn();
    const throttled = rafThrottle(fn);
    throttled();
    throttled();
    throttled();
    throttled();
    expect(raf).toHaveBeenCalledTimes(1);
  });

  it(".cancel() drops the pending call and stops the rAF", () => {
    const fn = vi.fn();
    const throttled = rafThrottle(fn);
    throttled("queued");

    throttled.cancel();
    expect(caf).toHaveBeenCalledTimes(1);

    flushFrame();
    expect(fn).not.toHaveBeenCalled();
  });

  it(".cancel() is idempotent when nothing is pending", () => {
    const fn = vi.fn();
    const throttled = rafThrottle(fn);
    throttled.cancel();
    throttled.cancel();
    expect(caf).not.toHaveBeenCalled();
  });

  it("zero-argument handlers still fire exactly once per frame", () => {
    const fn = vi.fn();
    const throttled = rafThrottle(fn);

    throttled();
    throttled();
    flushFrame();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith();
  });
});

describe("rafThrottle — SSR / no-rAF fallback", () => {
  it("fires eagerly when requestAnimationFrame is missing", () => {
    const original = globalThis.requestAnimationFrame;
    // @ts-expect-error force the SSR shape
    delete globalThis.requestAnimationFrame;

    try {
      const fn = vi.fn();
      const throttled = rafThrottle<[string]>(fn);
      throttled("a");
      throttled("b");
      // No coalescing path available — both calls fire.
      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenNthCalledWith(1, "a");
      expect(fn).toHaveBeenNthCalledWith(2, "b");
    } finally {
      globalThis.requestAnimationFrame = original;
    }
  });
});
