import { useState } from "react";
import { Menu, X } from "lucide-react";
import { useLang } from "../LanguageContext";
import { Logo } from "../shared/Logo";

export function Navbar() {
  const { lang, setLang, t } = useLang();
  const [isOpen, setIsOpen] = useState(false);

  const navLinks = [
    { label: t("nav.features"), href: "#features" },
    { label: t("nav.how"), href: "#how-it-works" },
    { label: t("nav.trust"), href: "#trust" },
    { label: t("nav.faq"), href: "#faq" },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-zinc-200 bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <Logo size="md" />

          {/* Mobile menu button */}
          <button className="md:hidden" onClick={() => setIsOpen(!isOpen)}>
            {isOpen ? (
              <X size={24} className="text-zinc-500" />
            ) : (
              <Menu size={24} className="text-zinc-500" />
            )}
          </button>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-7">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-zinc-500 hover:text-zinc-900 transition-colors"
                style={{ fontSize: 13, fontWeight: 500 }}
              >
                {link.label}
              </a>
            ))}
          </div>

          {/* Desktop CTA + Lang toggle */}
          <div className="hidden md:flex items-center gap-2.5">
            {/* Language toggle */}
            <div className="flex items-center border border-zinc-200 rounded-md overflow-hidden mr-1">
              <button
                onClick={() => setLang("ru")}
                className={`px-2 py-1 transition-colors ${
                  lang === "ru"
                    ? "bg-zinc-100 text-zinc-900"
                    : "text-zinc-400 hover:text-zinc-600"
                }`}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.03em",
                }}
              >
                RU
              </button>
              <button
                onClick={() => setLang("kz")}
                className={`px-2 py-1 transition-colors ${
                  lang === "kz"
                    ? "bg-zinc-100 text-zinc-900"
                    : "text-zinc-400 hover:text-zinc-600"
                }`}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.03em",
                }}
              >
                KZ
              </button>
            </div>

            <a
              href="/login"
              className="px-3.5 py-1.5 rounded-md text-zinc-500 hover:text-zinc-900 transition-colors"
              style={{ fontSize: 13, fontWeight: 500 }}
            >
              {t("nav.login")}
            </a>
            <a
              href="/register"
              className="px-3.5 py-1.5 rounded-md bg-amber-500 text-white hover:bg-amber-600 transition-colors"
              style={{ fontSize: 13, fontWeight: 600 }}
            >
              {t("nav.register")}
            </a>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {isOpen && (
        <div className="md:hidden border-t border-zinc-200 bg-white">
          <div className="px-4 py-3 space-y-2">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="block text-zinc-500 hover:text-zinc-900 transition-colors py-1"
                style={{ fontSize: 13, fontWeight: 500 }}
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
