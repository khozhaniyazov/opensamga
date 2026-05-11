import { useLang } from "./LanguageContext";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

const t = (ru: string, kz: string, lang: string) => (lang === "kz" ? kz : ru);

export function NotFoundPage() {
  const { lang } = useLang();
  // BUG #19 (2026-04-24): 404 routes were inheriting the default landing
  // title. Emit an explicit title so humans and crawlers see the real state.
  useDocumentTitle(t("404 — Страница не найдена", "404 — Бет табылмады", lang));
  return (
    <main className="min-h-screen flex items-center justify-center bg-zinc-50 p-6">
      <div className="max-w-md w-full text-center bg-white rounded-2xl border border-zinc-200 p-8 shadow-sm">
        <div
          className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-100 text-amber-900 mb-4"
          style={{ fontSize: 28, fontWeight: 700 }}
        >
          404
        </div>
        <h1
          className="text-zinc-800 mb-2"
          style={{ fontSize: 20, fontWeight: 700 }}
        >
          {t("Страница не найдена", "Бет табылмады", lang)}
        </h1>
        <p className="text-zinc-500 mb-6" style={{ fontSize: 14 }}>
          {t(
            "Похоже, вы перешли по устаревшей ссылке или неверному адресу.",
            "Сіз ескірген сілтемемен немесе қате мекенжаймен өттіңіз.",
            lang,
          )}
        </p>
        <div className="flex gap-2 justify-center">
          <a
            href="/"
            className="px-4 py-2 rounded-md bg-zinc-100 text-zinc-700 hover:bg-zinc-200 transition-colors"
            style={{ fontSize: 13, fontWeight: 500 }}
          >
            {t("На главную", "Басты бетке", lang)}
          </a>
          <a
            href="/dashboard"
            className="px-4 py-2 rounded-md bg-amber-700 text-white hover:bg-amber-800 transition-colors"
            style={{ fontSize: 13, fontWeight: 600 }}
          >
            {t("В кабинет", "Кабинетке", lang)}
          </a>
        </div>
      </div>
    </main>
  );
}

export default NotFoundPage;
