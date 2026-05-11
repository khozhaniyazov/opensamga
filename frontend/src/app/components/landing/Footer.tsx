import { useLang } from "../LanguageContext";
import { Logo } from "../shared/Logo";

export function Footer() {
  const { t } = useLang();

  return (
    <footer className="border-t border-zinc-200 bg-zinc-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid md:grid-cols-4 gap-10 mb-10">
          {/* Brand */}
          <div className="md:col-span-1">
            <div className="mb-3">
              <Logo size="md" />
            </div>
            <p
              className="text-zinc-400"
              style={{ fontSize: 13, lineHeight: 1.7 }}
            >
              {t("footer.desc")}
            </p>
          </div>

          {/* Links */}
          <div>
            <h4
              className="text-zinc-500 mb-3"
              style={{
                fontSize: 12,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {t("footer.platform")}
            </h4>
            <ul className="space-y-2" style={{ fontSize: 13 }}>
              <li>
                <a
                  href="#features"
                  className="text-zinc-400 hover:text-zinc-700 transition-colors"
                >
                  {t("footer.link.features")}
                </a>
              </li>
              <li>
                <a
                  href="#how-it-works"
                  className="text-zinc-400 hover:text-zinc-700 transition-colors"
                >
                  {t("footer.link.how")}
                </a>
              </li>
              <li>
                <a
                  href="/register"
                  className="text-zinc-400 hover:text-zinc-700 transition-colors"
                >
                  {t("footer.link.register")}
                </a>
              </li>
              <li>
                <a
                  href="/login"
                  className="text-zinc-400 hover:text-zinc-700 transition-colors"
                >
                  {t("footer.link.login")}
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4
              className="text-zinc-500 mb-3"
              style={{
                fontSize: 12,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {t("footer.resources")}
            </h4>
            <ul className="space-y-2" style={{ fontSize: 13 }}>
              <li>
                <a
                  href="/dashboard/library"
                  className="text-zinc-400 hover:text-zinc-700 transition-colors"
                >
                  {t("footer.link.textbooks")}
                </a>
              </li>
              <li>
                <a
                  href="/dashboard"
                  className="text-zinc-400 hover:text-zinc-700 transition-colors"
                >
                  {t("footer.link.tips")}
                </a>
              </li>
              <li>
                <a
                  href="#faq"
                  className="text-zinc-400 hover:text-zinc-700 transition-colors"
                >
                  {t("footer.link.faq")}
                </a>
              </li>
              <li>
                <a
                  href="mailto:support@samga.ai"
                  className="text-zinc-400 hover:text-zinc-700 transition-colors"
                >
                  {t("footer.link.support")}
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4
              className="text-zinc-500 mb-3"
              style={{
                fontSize: 12,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {t("footer.contacts")}
            </h4>
            <ul className="space-y-2" style={{ fontSize: 13 }}>
              <li className="text-zinc-400">{t("footer.location")}</li>
              <li>
                <a
                  href="mailto:hello@samga.ai"
                  className="text-zinc-500 hover:text-zinc-700 transition-colors"
                >
                  hello@samga.ai
                </a>
              </li>
              {/* Social links hidden until official accounts exist */}
            </ul>
          </div>
        </div>

        <div className="border-t border-zinc-200 pt-6 flex flex-col md:flex-row justify-between items-center gap-3">
          <p className="text-zinc-400" style={{ fontSize: 12 }}>
            &copy; {t("footer.copyright")}
          </p>
          <div className="flex gap-5" style={{ fontSize: 12 }}>
            <a
              href="/privacy"
              className="text-zinc-400 hover:text-zinc-600 transition-colors"
            >
              {t("footer.privacy")}
            </a>
            <a
              href="/terms"
              className="text-zinc-400 hover:text-zinc-600 transition-colors"
            >
              {t("footer.terms")}
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
