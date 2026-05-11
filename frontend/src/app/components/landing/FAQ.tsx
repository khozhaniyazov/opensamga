import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useLang } from "../LanguageContext";

const faqKeys = ["1", "2", "3", "4"];

export function FAQ() {
  const { t } = useLang();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section id="faq" className="relative py-20 md:py-28 bg-zinc-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <p
            className="text-amber-600 mb-3"
            style={{
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {t("faq.label")}
          </p>
          <h2
            className="text-zinc-900"
            style={{
              fontSize: "clamp(24px, 3.5vw, 34px)",
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            {t("faq.title")}
          </h2>
        </div>

        {/* Accordion */}
        <div className="space-y-2">
          {faqKeys.map((key, index) => {
            const isOpen = openIndex === index;
            return (
              <div
                key={key}
                className="rounded-lg border border-zinc-200 bg-white overflow-hidden"
              >
                <button
                  onClick={() => setOpenIndex(isOpen ? null : index)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-zinc-50 transition-colors"
                >
                  <span
                    className="text-zinc-800 pr-4"
                    style={{ fontSize: 14, fontWeight: 600 }}
                  >
                    {t(`faq.${key}.q`)}
                  </span>
                  <ChevronDown
                    size={16}
                    className={`shrink-0 text-zinc-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {isOpen && (
                  <div className="px-5 pb-4">
                    <p
                      className="text-zinc-500"
                      style={{ fontSize: 13, lineHeight: 1.75 }}
                    >
                      {t(`faq.${key}.a`)}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
