import { ArrowRight, Play } from "lucide-react";
import { useLang } from "../LanguageContext";

export function CTA() {
  const { t } = useLang();

  return (
    <section className="relative py-20 md:py-28 bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-8 py-14 md:px-14 md:py-16 text-center">
          <h2
            className="text-zinc-900 mb-3 max-w-lg mx-auto"
            style={{
              fontSize: "clamp(22px, 3vw, 30px)",
              fontWeight: 700,
              lineHeight: 1.25,
              letterSpacing: "-0.02em",
            }}
          >
            {t("cta.title")}
          </h2>
          <p
            className="text-zinc-500 mb-7 max-w-md mx-auto"
            style={{ fontSize: 15, lineHeight: 1.7 }}
          >
            {t("cta.subtitle")}
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a
              href="/register"
              className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-md bg-amber-500 text-white hover:bg-amber-600 transition-colors"
              style={{ fontSize: 14, fontWeight: 600 }}
            >
              {t("cta.start")}
              <ArrowRight size={16} />
            </a>
            <a
              href="#how-it-works"
              className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-md border border-zinc-200 text-zinc-500 hover:text-zinc-900 hover:border-zinc-300 transition-colors"
              style={{ fontSize: 14, fontWeight: 500 }}
            >
              <Play size={14} />
              {t("cta.demo")}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
