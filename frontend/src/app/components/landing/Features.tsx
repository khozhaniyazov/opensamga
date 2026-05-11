import {
  MessageSquareText,
  FileCheck,
  RotateCcw,
  BookOpen,
  Headphones,
  GraduationCap,
} from "lucide-react";
import { useLang } from "../LanguageContext";

const featureKeys = [
  { key: "1", icon: MessageSquareText, soon: false },
  { key: "2", icon: FileCheck, soon: false },
  { key: "3", icon: RotateCcw, soon: true },
  { key: "4", icon: BookOpen, soon: false },
  { key: "5", icon: Headphones, soon: false },
  { key: "6", icon: GraduationCap, soon: false },
];

export function Features() {
  const { t } = useLang();

  return (
    <section id="features" className="relative py-20 md:py-28 bg-white">
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
            {t("features.label")}
          </p>
          <h2
            className="text-zinc-900 mb-3"
            style={{
              fontSize: "clamp(24px, 3.5vw, 34px)",
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            {t("features.title")}
          </h2>
          <p
            className="text-zinc-500"
            style={{ fontSize: 15, lineHeight: 1.7 }}
          >
            {t("features.subtitle")}
          </p>
        </div>

        {/* Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {featureKeys.map((f) => {
            const Icon = f.icon;
            return (
              <div
                key={f.key}
                className="p-5 rounded-lg border border-zinc-200 bg-zinc-50/50 hover:bg-zinc-50 transition-colors"
              >
                <div className="w-9 h-9 rounded-md bg-amber-50 flex items-center justify-center mb-3.5">
                  <Icon size={18} className="text-amber-600" />
                </div>
                <div className="flex items-center gap-2 mb-1.5">
                  <h3
                    className="text-zinc-800"
                    style={{ fontSize: 15, fontWeight: 600 }}
                  >
                    {t(`features.${f.key}.title`)}
                  </h3>
                  {f.soon && (
                    <span
                      className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200"
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: "0.03em",
                      }}
                    >
                      {t("features.soon")}
                    </span>
                  )}
                </div>
                <p
                  className="text-zinc-500"
                  style={{ fontSize: 13, lineHeight: 1.7 }}
                >
                  {t(`features.${f.key}.desc`)}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
