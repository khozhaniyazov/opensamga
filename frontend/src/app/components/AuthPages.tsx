import { useState } from "react";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { useNavigate } from "react-router";
import { useLang } from "./LanguageContext";
import { useAuth } from "./auth/AuthContext";
import { Logo } from "./shared/Logo";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

function AuthShell({ children }: { children: React.ReactNode }) {
  const { t, lang } = useLang();

  return (
    <main className="min-h-screen bg-[#f1eee5] px-4 py-6 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <a
          href="/"
          className="inline-flex items-center gap-2 text-zinc-700 transition-colors hover:text-zinc-950"
          style={{ fontSize: 13, fontWeight: 600 }}
        >
          <ArrowLeft size={14} />
          {t("auth.back")}
        </a>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_440px]">
          <section className="rounded-[34px] border border-zinc-200/80 bg-[#fbfaf7] px-6 py-6 shadow-[0_24px_70px_rgba(24,24,27,0.08)] sm:px-7 sm:py-7">
            <div className="flex flex-wrap items-center gap-2">
              <Logo asLink={false} size="md" />
              <span
                className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-zinc-700"
                style={{ fontSize: 11, fontWeight: 700 }}
              >
                Samga Access
              </span>
            </div>

            <h1
              className="mt-8 max-w-3xl text-[30px] text-zinc-950 sm:text-[42px]"
              style={{ fontWeight: 780, lineHeight: 0.98 }}
            >
              {lang === "kz"
                ? "Кіру тыныш. Жұмыс қатты."
                : "Вход тихий. Работа громкая."}
            </h1>

            <p
              className="mt-4 max-w-2xl text-zinc-600"
              style={{ fontSize: 14, lineHeight: 1.85 }}
            >
              {lang === "kz"
                ? "Samga-ға кірген соң профиль толық жиналады: 2 профильдік пән, барлық міндетті пәндер, соңғы нәтижелер, әлсіз бағыт және арман университет."
                : "После входа Samga сразу собирает полный профиль: 2 профильных предмета, обязательные дисциплины, последние результаты, слабый предмет и вуз-цель."}
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {[
                lang === "kz" ? "2 профильдік пән" : "2 профильных предмета",
                lang === "kz"
                  ? "1-5 соңғы нәтиже"
                  : "1-5 последних результатов",
                lang === "kz" ? "Dream university" : "Dream university",
              ].map((item) => (
                <div
                  key={item}
                  className="rounded-[24px] border border-zinc-200/80 bg-white/92 px-4 py-4 shadow-[0_12px_30px_rgba(24,24,27,0.05)]"
                >
                  <p
                    className="text-zinc-950"
                    style={{ fontSize: 14, fontWeight: 720, lineHeight: 1.5 }}
                  >
                    {item}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-8 rounded-[26px] border border-zinc-200/80 bg-white/92 px-5 py-5 shadow-[0_12px_30px_rgba(24,24,27,0.05)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p
                    className="text-zinc-500"
                    style={{
                      fontSize: 11,
                      fontWeight: 760,
                      textTransform: "uppercase",
                      letterSpacing: "0.12em",
                    }}
                  >
                    Samga note
                  </p>
                  <p
                    className="mt-3 text-zinc-700"
                    style={{ fontSize: 13, lineHeight: 1.75 }}
                  >
                    {lang === "kz"
                      ? "Ақпарат жинау бөлігі енді жай форма емес, бүкіл кейінгі chat, practice және analytics логикасының іргесі."
                      : "Сбор профиля теперь не просто форма, а основа для всего, что Samga делает дальше: chat, practice и analytics."}
                  </p>
                </div>

                <span
                  className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-[#fbfaf7] px-3 py-1.5 text-zinc-500"
                  style={{ fontSize: 11, fontWeight: 700 }}
                >
                  Ready
                  <ArrowUpRight size={12} />
                </span>
              </div>
            </div>
          </section>

          <div className="rounded-[34px] border border-zinc-200/80 bg-white/94 px-6 py-6 shadow-[0_24px_70px_rgba(24,24,27,0.08)] sm:px-7 sm:py-7">
            {children}
          </div>
        </div>
      </div>
    </main>
  );
}

function localizeAuthError(message: string, lang: "ru" | "kz"): string {
  if (lang !== "kz") return message;
  if (message.includes("Неверный email") || message.includes("пароль")) {
    return "Email немесе құпия сөз дұрыс емес";
  }
  if (message.includes("Email уже зарегистрирован")) {
    return "Email бұрын тіркелген";
  }
  if (message.includes("минимум 8")) {
    return "Құпия сөз кемінде 8 таңбадан тұруы керек";
  }
  if (message.includes("хотя бы одну цифру")) {
    return "Құпия сөзде кемінде бір сан болуы керек";
  }
  if (message.includes("хотя бы одну букву")) {
    return "Құпия сөзде кемінде бір әріп болуы керек";
  }
  if (message.includes("Имя")) {
    return "Атыңызды дұрыс енгізіңіз";
  }
  return message;
}

export function LoginPage() {
  const { t, lang } = useLang();
  useDocumentTitle(t("auth.login.title"));
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  function validateLocal(): string | null {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      return lang === "kz" ? "Email мекенжайын енгізіңіз" : "Введите email";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      return lang === "kz"
        ? "Жарамды email мекенжайын енгізіңіз"
        : "Введите корректный email";
    }
    if (!password) {
      return lang === "kz" ? "Құпия сөзді енгізіңіз" : "Введите пароль";
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const localError = validateLocal();
    if (localError) {
      setError(localError);
      return;
    }
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      // replace:true so Back doesn't return to /login after success
      // (PublicOnlyRoute would just bounce them forward, leaving the URL
      // confusingly stuck on /login while rendering the dashboard).
      navigate("/dashboard", { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : t("auth.error");
      setError(localizeAuthError(message, lang));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <h2
        className="text-zinc-950"
        style={{ fontSize: 28, fontWeight: 760, lineHeight: 1.05 }}
      >
        {t("auth.login.title")}
      </h2>
      <p
        className="mt-3 text-zinc-500"
        style={{ fontSize: 13.5, lineHeight: 1.75 }}
      >
        {t("auth.login.subtitle")}
      </p>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
        {error ? (
          <p
            role="alert"
            aria-live="polite"
            className="rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-rose-700"
            style={{ fontSize: 12.5, lineHeight: 1.65 }}
          >
            {error}
          </p>
        ) : null}

        <div>
          <label
            className="mb-2 block text-zinc-500"
            style={{ fontSize: 12, fontWeight: 700 }}
          >
            {t("auth.login.email")}
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder="email@example.com"
            className="h-12 w-full rounded-[18px] border border-zinc-200 bg-[#fbfaf7] px-4 text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-300"
            style={{ fontSize: 14 }}
          />
        </div>

        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <label
              className="block text-zinc-500"
              style={{ fontSize: 12, fontWeight: 700 }}
            >
              {t("auth.login.password")}
            </label>
            <button
              type="button"
              onClick={() => setForgotOpen(true)}
              className="text-zinc-500 transition-colors hover:text-zinc-900"
              style={{ fontSize: 11, fontWeight: 700 }}
            >
              {lang === "kz" ? "Құпия сөзді ұмыттыңыз ба?" : "Забыли пароль?"}
            </button>
          </div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            placeholder="••••••••"
            className="h-12 w-full rounded-[18px] border border-zinc-200 bg-[#fbfaf7] px-4 text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-300"
            style={{ fontSize: 14 }}
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex h-12 w-full items-center justify-center rounded-[18px] bg-zinc-950 text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
          style={{ fontSize: 14, fontWeight: 720 }}
        >
          {submitting ? t("common.loading") : t("auth.login.submit")}
        </button>
      </form>

      {forgotOpen ? (
        <div
          className="mt-4 rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-4 text-amber-800"
          role="status"
        >
          <p style={{ fontSize: 12.5, lineHeight: 1.7 }}>
            {lang === "kz"
              ? "Құпия сөзді қалпына келтіру әлі қосылмаған. Қолдау қызметіне жазыңыз: support@samga.ai"
              : "Автоматическое восстановление пароля пока не подключено. Напишите в поддержку: support@samga.ai"}
          </p>
        </div>
      ) : null}

      <p
        className="mt-6 text-center text-zinc-500"
        style={{ fontSize: 12.5, lineHeight: 1.6 }}
      >
        {t("auth.login.noAccount")}{" "}
        <a
          href="/register"
          className="text-zinc-950 transition-colors hover:text-amber-700"
          style={{ fontWeight: 700 }}
        >
          {t("auth.login.register")}
        </a>
      </p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { t, lang } = useLang();
  useDocumentTitle(t("auth.register.title"));
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // BUG #4 (2026-04-24): the register form relied solely on HTML5
  // `required` / `minLength` / `type="email"` attributes for validation.
  // A Playwright submit that bypasses native checks (e.g. form.submit())
  // would POST garbage to the backend and surface only a cryptic 422.
  // Added an explicit pre-flight check that paints an inline error so
  // real users also get a clearer message before the network hits.
  function validateLocal(): string | null {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName) {
      return lang === "kz" ? "Аты-жөніңізді енгізіңіз" : "Введите имя";
    }
    if (!trimmedEmail) {
      return lang === "kz" ? "Email мекенжайын енгізіңіз" : "Введите email";
    }
    // Minimal, permissive email regex — just "has @ and a dot after it".
    // Deep RFC validation belongs on the server.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      return lang === "kz"
        ? "Жарамды email мекенжайын енгізіңіз"
        : "Введите корректный email";
    }
    // F1 (s26 phase 7): backend's EmailStr validator goes through
    // email-validator's deliverability check, which rejects RFC-2606
    // reserved TLDs (.test, .example, .invalid, .localhost) with a
    // generic 422. Catch them here so testers / typo-prone users get
    // an actionable message instead of "Validation error" at the
    // network boundary.
    const reservedTld = trimmedEmail
      .toLowerCase()
      .match(/\.(test|example|invalid|localhost)$/);
    if (reservedTld) {
      return lang === "kz"
        ? `Бұл доменді (.${reservedTld[1]}) пайдалану мүмкін емес — нақты email енгізіңіз`
        : `Домен .${reservedTld[1]} зарезервирован и не принимается — используйте реальный email`;
    }
    if (password.length < 8) {
      return lang === "kz"
        ? "Құпия сөз кемінде 8 таңбадан тұруы тиіс"
        : "Пароль должен содержать минимум 8 символов";
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const localError = validateLocal();
    if (localError) {
      setError(localError);
      return;
    }
    setSubmitting(true);
    try {
      await register(name.trim(), email.trim(), password);
      // replace:true — see login handler for rationale
      navigate("/dashboard", { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : t("auth.error");
      setError(localizeAuthError(message, lang));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <h2
        className="text-zinc-950"
        style={{ fontSize: 28, fontWeight: 760, lineHeight: 1.05 }}
      >
        {t("auth.register.title")}
      </h2>
      <p
        className="mt-3 text-zinc-500"
        style={{ fontSize: 13.5, lineHeight: 1.75 }}
      >
        {t("auth.register.subtitle")}
      </p>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
        {error ? (
          <p
            role="alert"
            aria-live="polite"
            className="rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-rose-700"
            style={{ fontSize: 12.5, lineHeight: 1.65 }}
          >
            {error}
          </p>
        ) : null}

        <div>
          <label
            className="mb-2 block text-zinc-500"
            style={{ fontSize: 12, fontWeight: 700 }}
          >
            {t("auth.register.name")}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="name"
            placeholder={t("auth.register.namePlaceholder")}
            className="h-12 w-full rounded-[18px] border border-zinc-200 bg-[#fbfaf7] px-4 text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-300"
            style={{ fontSize: 14 }}
          />
        </div>

        <div>
          <label
            className="mb-2 block text-zinc-500"
            style={{ fontSize: 12, fontWeight: 700 }}
          >
            {t("auth.login.email")}
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder="email@example.com"
            className="h-12 w-full rounded-[18px] border border-zinc-200 bg-[#fbfaf7] px-4 text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-300"
            style={{ fontSize: 14 }}
          />
          {/* F1 (s27, 2026-04-27): the backend's EmailStr / email-validator
              rejects RFC-2606 reserved TLDs (.test/.example/.invalid/.localhost)
              with a 422. validateLocal() catches it client-side, but a
              field-level hint up-front beats a red toast on submit. */}
          <p
            className="mt-2 text-zinc-500"
            style={{ fontSize: 12, lineHeight: 1.65 }}
          >
            {t("auth.register.emailHint")}
          </p>
        </div>

        <div>
          <label
            className="mb-2 block text-zinc-500"
            style={{ fontSize: 12, fontWeight: 700 }}
          >
            {t("auth.login.password")}
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="••••••••"
            className="h-12 w-full rounded-[18px] border border-zinc-200 bg-[#fbfaf7] px-4 text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-300"
            style={{ fontSize: 14 }}
          />
          <p
            className="mt-2 text-zinc-500"
            style={{ fontSize: 12, lineHeight: 1.65 }}
          >
            {t("auth.register.passwordHint")}
          </p>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex h-12 w-full items-center justify-center rounded-[18px] bg-zinc-950 text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
          style={{ fontSize: 14, fontWeight: 720 }}
        >
          {submitting ? t("common.loading") : t("auth.register.submit")}
        </button>
      </form>

      <p
        className="mt-6 text-center text-zinc-500"
        style={{ fontSize: 12.5, lineHeight: 1.6 }}
      >
        {t("auth.register.hasAccount")}{" "}
        <a
          href="/login"
          className="text-zinc-950 transition-colors hover:text-amber-700"
          style={{ fontWeight: 700 }}
        >
          {t("auth.register.login")}
        </a>
      </p>
    </AuthShell>
  );
}
