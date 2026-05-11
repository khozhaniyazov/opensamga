import { useEffect, useRef } from "react";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  MessageSquareText,
  Target,
} from "lucide-react";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";

type Spark = {
  x: number;
  y: number;
  z: number;
  speed: number;
  hue: number;
  size: number;
};

/**
 * v3.62 (2026-05-02) — pure helper extracted out of `drawOrbit` so
 * narrow-viewport behaviour can be unit-tested without spinning up
 * a canvas + jsdom + RAF loop. The native
 * CanvasRenderingContext2D.ellipse() throws `IndexSizeError` when
 * given a negative radius (observed on a 390x844 mobile viewport
 * where radiusX-3*34 went negative). We clamp at 0 and let the
 * caller skip the call entirely.
 */
export function safeOrbitRingRadii(
  baseRadiusX: number,
  baseRadiusY: number,
  ringStep: number,
): { rx: number; ry: number } {
  const rx = Math.max(0, baseRadiusX - ringStep * 34);
  const ry = Math.max(0, baseRadiusY - ringStep * 23);
  return { rx, ry };
}

function createSparks(count: number): Spark[] {
  return Array.from({ length: count }, (_, index) => {
    const seed = Math.sin(index * 999) * 10000;
    const random = seed - Math.floor(seed);
    const randomTwo = Math.sin(index * 271.3) * 10000;
    const randomThree = randomTwo - Math.floor(randomTwo);

    return {
      x: random,
      y: randomThree,
      z: 0.45 + ((index * 37) % 100) / 110,
      speed: 0.18 + ((index * 13) % 70) / 160,
      hue: index % 7 === 0 ? 18 : index % 5 === 0 ? 154 : 48,
      size: 0.8 + ((index * 19) % 28) / 10,
    };
  });
}

function SignalField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return undefined;

    const sparks = createSparks(160);
    let width = 0;
    let height = 0;
    let animationFrame = 0;
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const onPointerMove = (event: PointerEvent) => {
      pointer.tx = (event.clientX / width - 0.5) * 2;
      pointer.ty = (event.clientY / height - 0.5) * 2;
    };

    const drawRibbon = (time: number) => {
      const centerY = height * 0.58;
      const amplitude = Math.max(30, height * 0.075);
      const stride = 22;

      for (let layer = 0; layer < 16; layer += 1) {
        const yOffset = (layer - 8) * 18;
        context.beginPath();
        for (let x = -40; x <= width + 40; x += stride) {
          const wave =
            Math.sin(x * 0.006 + time * 0.0007 + layer * 0.44) * amplitude +
            Math.cos(x * 0.0028 - time * 0.00034 + layer) * amplitude * 0.42;
          const y = centerY + yOffset + wave + pointer.y * 26;
          if (x === -40) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.strokeStyle =
          layer % 3 === 0
            ? `rgba(245, 158, 11, ${0.12 - layer * 0.003})`
            : `rgba(244, 244, 245, ${0.11 - layer * 0.003})`;
        context.lineWidth = layer % 4 === 0 ? 1.4 : 0.8;
        context.stroke();
      }
    };

    const drawOrbit = (time: number) => {
      const centerX = width * 0.74 + pointer.x * 34;
      const centerY = height * 0.46 + pointer.y * 24;
      const radiusX = Math.min(width * 0.2, 260);
      const radiusY = Math.min(height * 0.23, 220);

      context.save();
      context.translate(centerX, centerY);
      context.rotate(-0.22);
      for (let ring = 0; ring < 4; ring += 1) {
        // v3.62 (2026-05-02): on narrow viewports (~< 680px wide,
        // ~< 590px tall) the inner rings step past zero and
        // CanvasRenderingContext2D.ellipse() throws IndexSizeError.
        // safeOrbitRingRadii clamps at 0 and signals "skip this ring"
        // when there's nothing to draw.
        const { rx, ry } = safeOrbitRingRadii(radiusX, radiusY, ring);
        if (rx <= 0 || ry <= 0) continue;
        context.beginPath();
        context.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        context.strokeStyle =
          ring === 0 ? "rgba(244,244,245,0.18)" : "rgba(244,244,245,0.07)";
        context.lineWidth = ring === 0 ? 1.1 : 0.8;
        context.stroke();
      }

      for (let i = 0; i < 30; i += 1) {
        const angle = i * 0.62 + time * 0.00028;
        // Same clamp keeps the satellite dots inside the visible
        // ring set rather than drifting through (0, 0).
        const { rx, ry } = safeOrbitRingRadii(radiusX, radiusY, i % 4);
        if (rx <= 0 || ry <= 0) continue;
        const x = Math.cos(angle) * rx;
        const y = Math.sin(angle) * ry;
        context.beginPath();
        context.arc(x, y, i % 9 === 0 ? 2.2 : 1.2, 0, Math.PI * 2);
        context.fillStyle =
          i % 9 === 0 ? "rgba(245,158,11,0.78)" : "rgba(244,244,245,0.34)";
        context.fill();
      }
      context.restore();
    };

    const drawSparks = (time: number) => {
      sparks.forEach((spark, index) => {
        const drift = (time * 0.00005 * spark.speed + spark.x) % 1;
        const x = width * drift + pointer.x * spark.z * 22;
        const y =
          height * (0.16 + spark.y * 0.74) +
          Math.sin(time * 0.001 * spark.speed + index) * 18 * spark.z +
          pointer.y * spark.z * 18;
        const alpha = 0.16 + Math.sin(time * 0.002 + index) * 0.075;

        context.beginPath();
        context.arc(x, y, spark.size * spark.z, 0, Math.PI * 2);
        context.fillStyle = `hsla(${spark.hue}, 82%, 62%, ${alpha})`;
        context.fill();
      });
    };

    const render = (time: number) => {
      pointer.x += (pointer.tx - pointer.x) * 0.035;
      pointer.y += (pointer.ty - pointer.y) * 0.035;

      context.fillStyle = "#09090b";
      context.fillRect(0, 0, width, height);

      context.globalCompositeOperation = "source-over";
      drawRibbon(time);
      drawOrbit(time);
      context.globalCompositeOperation = "lighter";
      drawSparks(time);
      context.globalCompositeOperation = "source-over";

      animationFrame = window.requestAnimationFrame(render);
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove);
    animationFrame = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    />
  );
}

const proofPoints = [
  { icon: MessageSquareText, label: "AI-разбор по учебникам" },
  { icon: Target, label: "Пробел до гранта" },
  { icon: CheckCircle2, label: "Практика по ошибкам" },
];

export function LandingPage() {
  useDocumentTitle(null);

  return (
    <div className="relative min-h-screen overflow-hidden bg-zinc-950 text-zinc-50">
      <SignalField />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(9,9,11,0.92)_0%,rgba(9,9,11,0.68)_42%,rgba(9,9,11,0.38)_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-[linear-gradient(180deg,rgba(9,9,11,0)_0%,#09090b_92%)]" />

      <header className="absolute inset-x-0 top-0 z-20">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5 sm:px-8">
          <a
            href="/"
            className="group inline-flex items-center gap-3"
            aria-label="Samga"
          >
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-zinc-50 text-zinc-950">
              <BookOpen size={18} />
            </span>
            <span className="text-sm font-semibold text-zinc-100 transition-colors group-hover:text-white">
              Samga
            </span>
          </a>
          <a
            href="/login"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-white/15 bg-white/5 px-4 text-sm font-semibold text-zinc-100 transition-colors hover:bg-white/10"
          >
            Войти
          </a>
        </div>
      </header>

      <main className="relative z-10">
        <section className="mx-auto flex min-h-[92svh] max-w-7xl flex-col justify-center px-5 pb-16 pt-28 sm:px-8 lg:min-h-[90svh]">
          <div className="max-w-4xl">
            <p className="mb-5 inline-flex rounded-full border border-white/15 bg-white/8 px-3 py-1.5 text-xs font-semibold text-zinc-200">
              ҰБТ / ЕНТ preparation workspace
            </p>
            <h1 className="max-w-4xl text-[56px] font-semibold leading-[0.94] tracking-normal text-white sm:text-[88px] lg:text-[116px]">
              Samga
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-zinc-200 sm:text-lg">
              Персональная подготовка к ЕНТ: чат с источниками, пробные
              экзамены, разбор ошибок и понятная карта до целевого балла.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="/register"
                className="group inline-flex h-12 items-center justify-center gap-3 rounded-lg bg-white px-5 text-sm font-bold text-zinc-950 transition-colors hover:bg-zinc-100"
              >
                Начать подготовку
                <ArrowRight
                  size={16}
                  className="transition-transform group-hover:translate-x-1"
                />
              </a>
              <a
                href="/dashboard"
                className="inline-flex h-12 items-center justify-center rounded-lg border border-white/15 bg-white/5 px-5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                Открыть рабочее пространство
              </a>
            </div>
          </div>

          <div className="mt-10 grid max-w-4xl gap-3 sm:grid-cols-3">
            {proofPoints.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className="flex min-h-14 items-center gap-3 rounded-lg border border-white/12 bg-white/7 px-4 py-3 text-sm font-semibold text-zinc-100"
                >
                  <Icon size={17} className="shrink-0 text-amber-300" />
                  <span>{item.label}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="relative border-t border-white/10 bg-zinc-950/96 px-5 py-8 sm:px-8">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 text-sm text-zinc-400 sm:flex-row sm:items-center sm:justify-between">
            <span>Built for Kazakhstan students preparing for UNT.</span>
            <span className="font-semibold text-zinc-200">
              Chat. Exams. Mistakes. Gap analysis.
            </span>
          </div>
        </section>
      </main>
    </div>
  );
}
