import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { devDebug, devError, devLog, devWarn } from "../devLog";

/**
 * v3.76 — devLog gate contract.
 *
 * Both branches must work:
 *  - DEV  → forwards to the matching `console.*`.
 *  - prod → no-op (zero `console.*` calls).
 *
 * The DEV signal comes from `import.meta.env?.DEV`, which Vitest
 * exposes as `true` by default. We override it via `vi.stubEnv` so
 * a single test file can exercise both branches.
 */

describe("devLog (DEV branch)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("DEV", true);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("devLog forwards to console.log under DEV", () => {
    devLog("hello", { x: 1 });
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith("hello", { x: 1 });
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it("devWarn forwards to console.warn under DEV", () => {
    devWarn("warning message", new Error("boom"));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith("warning message", expect.any(Error));
  });

  it("devError forwards to console.error under DEV", () => {
    const err = { name: "AxiosError", message: "Network Error" };
    devError("Error sending message:", err);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("Error sending message:", err);
  });

  it("devDebug forwards to console.debug under DEV", () => {
    devDebug("[telemetry]", "ev", { id: 1 });
    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).toHaveBeenCalledWith("[telemetry]", "ev", { id: 1 });
  });
});

describe("devLog (prod branch)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("DEV", false);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("devLog is a no-op in prod", () => {
    devLog("hello");
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("devWarn is a no-op in prod", () => {
    devWarn("warn");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("devError is a no-op in prod", () => {
    devError("error", { url: "/api/sensitive", body: "secret" });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("devDebug is a no-op in prod", () => {
    devDebug("debug");
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it("does not throw when called with no arguments", () => {
    expect(() => {
      devLog();
      devWarn();
      devError();
      devDebug();
    }).not.toThrow();
  });
});
