import { UserCog, ClipboardCheck, Target, Headphones } from "lucide-react";
import { useLang } from "../LanguageContext";

const stepKeys = [
  { key: "1", icon: UserCog },
  { key: "2", icon: ClipboardCheck },
  { key: "3", icon: Target },
  { key: "4", icon: Headphones },
];

export function HowItWorks() {
  const { t } = useLang();

  return (
    <section id="how-it-works" className="relative py-20 md:py-28 bg-zinc-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="max-w-xl mx-auto text-center mb-14">
          <p
            className="text-amber-600 mb-3"
            style={{
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {t("how.label")}
          </p>
          <h2
            className="text-zinc-900 mb-3"
            style={{
              fontSize: "clamp(24px, 3.5vw, 34px)",
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            {t("how.title")}
          </h2>
          <p
            className="text-zinc-500"
            style={{ fontSize: 15, lineHeight: 1.7 }}
          >
            {t("how.subtitle")}
          </p>
        </div>

        {/* Steps - 2x2 grid */}
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          {stepKeys.map((step, index) => {
            const Icon = step.icon;
            const num = String(index + 1).padStart(2, "0");
            return (
              <div
                key={step.key}
                className="relative p-6 rounded-lg border border-zinc-200 bg-white"
              >
                {/* Step number */}
                <div className="flex items-center gap-3 mb-4">
                  <span
                    className="text-amber-500"
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: "0.05em",
                    }}
                  >
                    {t("how.step")} {num}
                  </span>
                </div>

                {/* Icon */}
                <div className="w-10 h-10 rounded-md bg-zinc-100 border border-zinc-200 flex items-center justify-center mb-4">
                  <Icon size={20} className="text-zinc-600" />
                </div>

                <h3
                  className="text-zinc-800 mb-2"
                  style={{ fontSize: 18, fontWeight: 600 }}
                >
                  {t(`how.${step.key}.title`)}
                </h3>
                <p
                  className="text-zinc-500"
                  style={{ fontSize: 13, lineHeight: 1.75 }}
                >
                  {t(`how.${step.key}.desc`)}
                </p>
              </div>
            );
          })}
        </div>

        {/* Exam format note */}
        <div className="rounded-md border border-zinc-200 bg-white px-5 py-3.5 text-center">
          <p
            className="text-zinc-500"
            style={{ fontSize: 13, fontWeight: 500, letterSpacing: "0.01em" }}
          >
            {t("how.format")}
          </p>
        </div>
      </div>
    </section>
  );
}
