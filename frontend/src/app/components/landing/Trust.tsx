import {
  ShieldCheck,
  Award,
  Users,
  Timer,
  BarChart3,
  Quote,
  ScanLine,
} from "lucide-react";
import { useLang } from "../LanguageContext";

// Session 22: removed "trust.1" ("Ответы с цитатами из учебников") — it
// duplicated the citation example block above (trust.title / citation.title).
const trustKeys = [
  { key: "2", icon: Timer },
  { key: "3", icon: BarChart3 },
  { key: "4", icon: Award },
  { key: "5", icon: Users },
  { key: "6", icon: ShieldCheck },
];

export function Trust() {
  const { t } = useLang();

  return (
    <section id="trust" className="relative py-20 md:py-28 bg-white">
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
            {t("trust.label")}
          </p>
          <h2
            className="text-zinc-900 mb-3"
            style={{
              fontSize: "clamp(24px, 3.5vw, 34px)",
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            {t("trust.title")}
          </h2>
          <p
            className="text-zinc-500"
            style={{ fontSize: 15, lineHeight: 1.7 }}
          >
            {t("trust.subtitle")}
          </p>
        </div>

        {/* Citation example block */}
        <div className="mb-10 rounded-lg border border-zinc-200 bg-zinc-50 p-6 md:p-8">
          <div className="flex items-start gap-3 mb-5">
            <div className="shrink-0 w-9 h-9 rounded-md bg-amber-50 border border-amber-200 flex items-center justify-center mt-0.5">
              <Quote size={16} className="text-amber-600" />
            </div>
            <div>
              <h3
                className="text-zinc-800 mb-1"
                style={{ fontSize: 16, fontWeight: 600 }}
              >
                {t("citation.title")}
              </h3>
              <p
                className="text-zinc-500"
                style={{ fontSize: 13, lineHeight: 1.7 }}
              >
                {t("citation.subtitle")}
              </p>
            </div>
          </div>

          {/* Example citation card */}
          <div className="rounded-md border border-zinc-200 bg-white p-5">
            <p
              className="text-zinc-400 mb-2"
              style={{
                fontSize: 12,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              {t("citation.question")}
            </p>
            <p
              className="text-zinc-700 mb-4"
              style={{ fontSize: 14, lineHeight: 1.6 }}
            >
              {t("citation.question.text")}
            </p>

            <div className="border-t border-zinc-200 pt-4">
              <p
                className="text-zinc-400 mb-2"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                {t("citation.source")}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="inline-flex items-center px-2.5 py-1 rounded-md bg-zinc-100 text-zinc-700"
                  style={{ fontSize: 13 }}
                >
                  {t("citation.book")}
                </span>
                <span
                  className="inline-flex items-center px-2.5 py-1 rounded-md bg-zinc-100 text-zinc-700"
                  style={{ fontSize: 13 }}
                >
                  {t("citation.grade")}
                </span>
                <span
                  className="inline-flex items-center px-2.5 py-1 rounded-md bg-amber-50 text-amber-600 border border-amber-200"
                  style={{ fontSize: 13, fontWeight: 600 }}
                >
                  {t("citation.page")}
                </span>
              </div>
            </div>
          </div>

          {/* OCR note */}
          <div
            className="flex items-center gap-2 mt-4 text-zinc-400"
            style={{ fontSize: 12 }}
          >
            <ScanLine size={14} className="shrink-0" />
            <span>{t("citation.ocr")}</span>
          </div>
        </div>

        {/* Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {trustKeys.map((point) => {
            const Icon = point.icon;
            return (
              <div
                key={point.key}
                className="flex gap-4 p-5 rounded-lg border border-zinc-200 bg-zinc-50/50 hover:bg-zinc-50 transition-colors"
              >
                <div className="shrink-0 w-9 h-9 rounded-md bg-zinc-100 flex items-center justify-center mt-0.5">
                  <Icon size={18} className="text-zinc-500" />
                </div>
                <div>
                  <h3
                    className="text-zinc-800 mb-1"
                    style={{ fontSize: 14, fontWeight: 600 }}
                  >
                    {t(`trust.${point.key}.title`)}
                  </h3>
                  <p
                    className="text-zinc-500"
                    style={{ fontSize: 13, lineHeight: 1.7 }}
                  >
                    {t(`trust.${point.key}.desc`)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Social proof bar */}
        <div className="mt-10 py-5 px-6 rounded-lg border border-zinc-200 bg-zinc-50">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex -space-x-1.5">
                {[
                  "bg-zinc-300",
                  "bg-zinc-400",
                  "bg-zinc-300",
                  "bg-zinc-400",
                  "bg-zinc-300",
                ].map((color, i) => (
                  <div
                    key={i}
                    className={`w-7 h-7 rounded-full ${color} border-2 border-white flex items-center justify-center`}
                  >
                    <span
                      className="text-white"
                      style={{ fontSize: 9, fontWeight: 700 }}
                    >
                      {["А", "Б", "Д", "М", "С"][i]}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-zinc-500" style={{ fontSize: 13 }}>
                <span className="text-zinc-800" style={{ fontWeight: 600 }}>
                  {t("trust.social.count")}
                </span>{" "}
                {t("trust.social.text")}
              </p>
            </div>

            <div
              className="flex items-center gap-5 text-zinc-400"
              style={{ fontSize: 12, fontWeight: 500 }}
            >
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                {t("trust.social.kz")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                {t("trust.social.ru")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                {t("trust.social.free")}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
