import type { ReactNode } from "react";
import {
  ErrorBoundary as ReactErrorBoundary,
  type FallbackProps,
} from "react-error-boundary";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import { Logo } from "./Logo";
import { track } from "../../lib/telemetry";

type ErrorFallbackProps = FallbackProps;

/**
 * v4.9 (2026-05-05): wire React error-boundary catches into the
 * telemetry buffer so a future PostHog / Mixpanel transport picks
 * them up automatically.
 *
 * Three boundary tiers (Global / Route / Feature) emit a single
 * `react.error_boundary` event with `tier` as a property, so
 * dashboards can chart "blast radius" — a Feature crash should
 * be way less alarming than a Global one.
 *
 * Why both `console.error` AND `track`? — `track` already mirrors
 * to `console.debug` in dev. Keeping the existing `console.error`
 * calls so prod stack traces still surface in Sentry-like
 * browser-extension consoles, AND adding a `track` so the
 * in-memory telemetry buffer carries them too. Both write paths
 * are non-blocking and `track` swallows its own errors.
 */
function reportBoundary(
  tier: "global" | "route" | "feature",
  error: unknown,
): void {
  // react-error-boundary types the FallbackProps `error` as
  // `unknown` (since anything can be thrown in JS). Coerce here
  // and cap aggressively — the telemetry sanitizer already drops
  // PII keys + truncates long strings, but stack traces can still
  // be huge.
  const errObj =
    error instanceof Error
      ? error
      : new Error(typeof error === "string" ? error : "non-error throw");
  const message = (errObj.message ?? "").slice(0, 240);
  const name = (errObj.name ?? "Error").slice(0, 60);
  track("react.error_boundary", {
    tier,
    error_name: name,
    error_message: message,
    // Stack omitted on purpose — it's too noisy for the buffer
    // and the app is too small to need source-map symbolication
    // here. A future Sentry transport would re-attach the stack
    // outside the buffer entry.
  });
}

function GlobalErrorFallback({
  error,
  resetErrorBoundary,
}: ErrorFallbackProps) {
  const { t } = useTranslation("errors");
  console.error("[GlobalErrorBoundary]", error);
  reportBoundary("global", error);

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-6 sm:px-6">
      <div className="mx-auto grid max-w-5xl gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-2xl border border-zinc-200/80 bg-zinc-50 px-6 py-6 sm:px-7 sm:py-7">
          <div className="flex flex-wrap items-center gap-2">
            <Logo asLink={false} size="md" />
            <span
              className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-zinc-700"
              style={{ fontSize: 11, fontWeight: 700 }}
            >
              Samga Recovery
            </span>
          </div>

          <h1
            className="mt-8 max-w-3xl text-[30px] text-zinc-950 sm:text-[42px]"
            style={{ fontWeight: 780, lineHeight: 0.98 }}
          >
            {t("global.title")}
          </h1>
          <p
            className="mt-4 max-w-2xl text-zinc-600"
            style={{ fontSize: 14, lineHeight: 1.85 }}
          >
            {t("global.message")}
          </p>
        </section>

        <aside className="rounded-2xl border border-zinc-200/80 bg-white px-6 py-6 sm:px-7 sm:py-7">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 text-rose-700">
            <AlertTriangle size={20} />
          </div>

          <p
            className="mt-5 text-zinc-950"
            style={{ fontSize: 20, fontWeight: 740 }}
          >
            Samga guard
          </p>
          <p
            className="mt-2 text-zinc-500"
            style={{ fontSize: 13, lineHeight: 1.75 }}
          >
            {t("route.message")}
          </p>

          <div className="mt-6 flex flex-col gap-3">
            <button
              onClick={resetErrorBoundary}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-zinc-950 text-white transition-colors hover:bg-black"
              style={{ fontSize: 14, fontWeight: 720 }}
            >
              <RefreshCw size={16} />
              {t("retry")}
            </button>
            <button
              onClick={() => {
                window.location.href = "/";
              }}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-950"
              style={{ fontSize: 14, fontWeight: 700 }}
            >
              <Home size={16} />
              {t("goBack")}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function RouteErrorFallback({ error, resetErrorBoundary }: ErrorFallbackProps) {
  const { t } = useTranslation("errors");
  console.error("[RouteErrorBoundary]", error);
  reportBoundary("route", error);

  return (
    <div className="flex min-h-[420px] items-center justify-center px-4 py-6">
      <div className="w-full max-w-2xl rounded-2xl border border-zinc-200/80 bg-zinc-50 px-6 py-6 shadow-sm">
        <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 text-amber-700">
          <AlertTriangle size={18} />
        </div>

        <h2
          className="mt-5 text-zinc-950"
          style={{ fontSize: 26, fontWeight: 760, lineHeight: 1.05 }}
        >
          {t("route.title")}
        </h2>
        <p
          className="mt-3 max-w-xl text-zinc-600"
          style={{ fontSize: 13.5, lineHeight: 1.8 }}
        >
          {t("route.message")}
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            onClick={resetErrorBoundary}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 text-white transition-colors hover:bg-black"
            style={{ fontSize: 13, fontWeight: 720 }}
          >
            <RefreshCw size={14} />
            {t("retry")}
          </button>
          <button
            onClick={() => {
              window.location.href = "/";
            }}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-950"
            style={{ fontSize: 13, fontWeight: 700 }}
          >
            <Home size={14} />
            {t("goBack")}
          </button>
        </div>
      </div>
    </div>
  );
}

function FeatureErrorFallback({ error }: ErrorFallbackProps) {
  const { t } = useTranslation("errors");
  console.error("[FeatureErrorBoundary]", error);
  reportBoundary("feature", error);

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
      <p className="text-amber-900" style={{ fontSize: 12.5, lineHeight: 1.7 }}>
        {t("feature.message")}
      </p>
    </div>
  );
}

export function GlobalErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ReactErrorBoundary
      FallbackComponent={GlobalErrorFallback}
      onReset={() => {
        window.location.href = "/";
      }}
    >
      {children}
    </ReactErrorBoundary>
  );
}

export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ReactErrorBoundary FallbackComponent={RouteErrorFallback}>
      {children}
    </ReactErrorBoundary>
  );
}

export function FeatureErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ReactErrorBoundary FallbackComponent={FeatureErrorFallback}>
      {children}
    </ReactErrorBoundary>
  );
}
