import { useEffect, useState } from "react";
import {
  SAMGA_LOADING_FRAMES,
  formatSamgaElapsed,
  getSamgaLoadingLabel,
} from "../../lib/samgaLoading";

interface SamgaLoadingPanelProps {
  lang: string;
  eyebrow?: string;
  title: string;
  description: string;
  hint?: string;
  className?: string;
}

export function SamgaLoadingPanel({
  lang,
  eyebrow,
  title,
  description,
  hint,
  className = "",
}: SamgaLoadingPanelProps) {
  const [elapsed, setElapsed] = useState(0);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
      setFrame((value) => (value + 1) % SAMGA_LOADING_FRAMES.length);
    }, 500);

    return () => window.clearInterval(interval);
  }, []);

  const action = getSamgaLoadingLabel(lang, elapsed);
  const elapsedLabel = formatSamgaElapsed(elapsed);

  return (
    <section
      className={`rounded-[30px] border border-zinc-200/80 bg-[#fbfaf7] px-6 py-6 shadow-[0_20px_50px_rgba(24,24,27,0.06)] sm:px-7 sm:py-7 ${className}`}
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_250px] lg:items-end">
        <div className="max-w-3xl">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-zinc-700"
              style={{ fontSize: 11, fontWeight: 700 }}
            >
              Samga
            </span>
            {eyebrow ? (
              <span
                className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-700"
                style={{ fontSize: 11, fontWeight: 700 }}
              >
                {eyebrow}
              </span>
            ) : null}
          </div>

          <h1
            className="text-[24px] text-zinc-950 sm:text-[30px]"
            style={{ fontWeight: 760, lineHeight: 1.08 }}
          >
            {title}
          </h1>
          <p
            className="mt-3 text-[13px] text-zinc-600 sm:text-[14px]"
            style={{ lineHeight: 1.75 }}
          >
            {description}
          </p>
        </div>

        <div className="rounded-[24px] border border-zinc-200/80 bg-white/92 px-4 py-4 shadow-[0_12px_30px_rgba(24,24,27,0.05)]">
          <div className="flex items-center gap-2.5">
            <span
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-700 shadow-sm"
              aria-hidden="true"
            >
              <span className="font-mono text-[16px] leading-none">
                {SAMGA_LOADING_FRAMES[frame]}
              </span>
            </span>
            <div className="min-w-0">
              <p
                className="font-mono text-zinc-900"
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                }}
              >
                {action}
              </p>
              <p
                className="mt-1 text-zinc-500"
                style={{ fontSize: 12, lineHeight: 1.5 }}
              >
                {elapsedLabel}
                {hint ? ` · ${hint}` : ""}
              </p>
            </div>
          </div>

          <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-200">
            <div className="h-full w-1/2 rounded-full bg-amber-500 animate-[samga-progress_1.1s_ease-in-out_infinite]" />
          </div>
        </div>
      </div>
    </section>
  );
}
