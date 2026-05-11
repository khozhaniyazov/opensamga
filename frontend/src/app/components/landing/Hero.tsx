import {
  ArrowRight,
  BarChart3,
  BookOpenText,
  Bot,
  CheckCircle2,
  GraduationCap,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useLang } from "../LanguageContext";

const heroCopy = {
  ru: {
    badge: "Samga.ai | Samga Chat + стратегия гранта",
    title: "Подготовка к ЕНТ, которая не просто тренирует,",
    accent: "а доводит до поступления",
    subtitle:
      "Пробные экзамены, Samga Chat, разбор ошибок, тематические тренировки, библиотека учебников и каталог вузов в одном рабочем контуре. Не набор случайных функций, а система подготовки под реальный результат.",
    support:
      "Для учеников, которые хотят понимать, что делать сегодня, чтобы летом не гадать насчёт гранта.",
    ctaPrimary: "Начать подготовку",
    ctaSecondary: "Посмотреть платформу",
    points: [
      "Полный пробный экзамен на 240 минут и 120 вопросов",
      "Samga-разбор ошибок с привязкой к учебникам",
      "Тренировки по темам и быстрые тесты в одном кабинете",
      "Поиск вузов, специальностей и шансов на грант",
    ],
    stats: [
      { value: "340+", label: "учебников в каталоге" },
      { value: "90+", label: "вузов в каталоге" },
      { value: "200 / день", label: "сообщений в Premium" },
      { value: "KZ / RU", label: "языка интерфейса" },
    ],
    surfaceTitle: "Контур подготовки к поступлению",
    surfaceSubtitle: "Один экран, в котором видна вся траектория ученика",
    surfaceExam: "Пробный экзамен",
    surfaceExamMeta: "ЕНТ формат · 120 вопросов",
    surfaceReview: "Samga-разбор ошибок",
    surfaceReviewMeta: "Цитаты из учебника + приоритет тем",
    surfaceChance: "Шанс на грант",
    surfaceChanceMeta: "B057 · Информационные технологии",
    surfaceSource: "Источник",
    surfaceSourceMeta: "Физика, 11 класс · страница 32",
    surfaceSourceText:
      "Система не ограничивается ответом: она показывает, откуда взят материал и что нужно повторить дальше.",
    surfaceLine1: "Samga Chat Premium",
    surfaceLine2: "Samga-S1.1-thinking",
    surfaceLine3: "Сегодняшний ритм",
    surfaceLine4: "9 / 50 тренировок",
  },
  kz: {
    badge: "Samga.ai | Samga Chat + грант стратегиясы",
    title: "ҰБТ-ға дайындықты жай жаттығумен шектемей,",
    accent: "түсуге дейін жеткізетін платформа",
    subtitle:
      "Сынақ емтихандары, Samga Chat, қателерді талдау, тақырыптық жаттығулар, оқулықтар кітапханасы және ЖОО каталогы бір жүйеде жұмыс істейді. Бұл бөлек-бөлек функциялар емес, нақты нәтиже үшін құрылған дайындық контуры.",
    support:
      "Бүгін не істеу керегін түсініп, жазда грантқа қатысты күмәнді азайтқысы келетін оқушыларға арналған.",
    ctaPrimary: "Дайындықты бастау",
    ctaSecondary: "Платформаны көру",
    points: [
      "240 минуттық және 120 сұрақтық толық сынақ емтиханы",
      "Оқулықтарға сүйенген Samga қате талдауы",
      "Тақырыптық жаттығулар мен жылдам тесттер бір кабинетте",
      "ЖОО, мамандық және грант мүмкіндігін бір жерден көру",
    ],
    stats: [
      { value: "340+", label: "каталогтағы оқулық" },
      { value: "90+", label: "ЖОО каталогта" },
      { value: "200 / күн", label: "Premium чат лимиті" },
      { value: "KZ / RU", label: "интерфейс тілі" },
    ],
    surfaceTitle: "Түсуге апаратын дайындық контуры",
    surfaceSubtitle: "Оқушы жолын бір экранда көруге болатын жүйе",
    surfaceExam: "Сынақ емтиханы",
    surfaceExamMeta: "ҰБТ форматы · 120 сұрақ",
    surfaceReview: "Samga қате талдауы",
    surfaceReviewMeta: "Оқулық цитатасы + тақырып басымдығы",
    surfaceChance: "Грант мүмкіндігі",
    surfaceChanceMeta: "B057 · Ақпараттық технологиялар",
    surfaceSource: "Дереккөз",
    surfaceSourceMeta: "Физика, 11-сынып · 32-бет",
    surfaceSourceText:
      "Жүйе тек жауап бермейді: материал қайдан алынғанын және ары қарай нені қайталау керегін көрсетеді.",
    surfaceLine1: "Samga Chat Premium",
    surfaceLine2: "Samga-S1.1-thinking",
    surfaceLine3: "Бүгінгі қарқын",
    surfaceLine4: "9 / 50 жаттығу",
  },
} as const;

export function Hero() {
  const { lang } = useLang();
  const copy = heroCopy[lang === "kz" ? "kz" : "ru"];

  return (
    <section
      className="relative overflow-hidden pt-16"
      style={{
        background:
          "linear-gradient(180deg, #fff8ef 0%, #fff5e5 18%, #ffffff 54%, #ffffff 100%)",
      }}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -left-20 top-16 h-72 w-72 rounded-full blur-3xl"
          style={{ background: "rgba(251, 191, 36, 0.18)" }}
        />
        <div
          className="absolute right-[-4rem] top-24 h-80 w-80 rounded-full blur-3xl"
          style={{ background: "rgba(14, 165, 233, 0.12)" }}
        />
        <div
          className="absolute left-1/2 top-0 h-px w-[min(1120px,92vw)] -translate-x-1/2"
          style={{
            background:
              "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(161,161,170,0.5) 28%, rgba(161,161,170,0.5) 72%, rgba(255,255,255,0) 100%)",
          }}
        />
      </div>

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14 md:py-20">
        <div className="grid items-center gap-12 lg:grid-cols-[1.04fr_0.96fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white/85 px-3.5 py-1.5 text-amber-700 shadow-sm backdrop-blur">
              <Sparkles size={14} />
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.03em",
                }}
              >
                {copy.badge}
              </span>
            </div>

            <h1
              className="mt-6 text-zinc-950"
              style={{
                fontSize: "clamp(34px, 6vw, 62px)",
                fontWeight: 800,
                lineHeight: 1.02,
                letterSpacing: "-0.05em",
              }}
            >
              {copy.title}{" "}
              <span
                className="text-amber-700"
                style={{
                  textShadow: "0 10px 30px rgba(251, 191, 36, 0.18)",
                }}
              >
                {copy.accent}
              </span>
            </h1>

            <p
              className="mt-5 max-w-2xl text-zinc-600"
              style={{ fontSize: 17, lineHeight: 1.75 }}
            >
              {copy.subtitle}
            </p>

            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              {copy.points.map((point) => (
                <div
                  key={point}
                  className="flex items-start gap-3 rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-zinc-700 shadow-sm backdrop-blur"
                >
                  <CheckCircle2
                    size={18}
                    className="mt-0.5 shrink-0 text-amber-600"
                  />
                  <span
                    style={{ fontSize: 14, lineHeight: 1.6, fontWeight: 500 }}
                  >
                    {point}
                  </span>
                </div>
              ))}
            </div>

            {/* Session 22: single CTA (down from two). "Посмотреть
                платформу" previously scrolled to #features which was
                already visible below the hero — pure noise. */}
            <div className="mt-8">
              <a
                href="/register"
                className="inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-white shadow-lg transition-transform hover:-translate-y-0.5"
                style={{
                  background:
                    "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
                  fontSize: 15,
                  fontWeight: 700,
                  boxShadow: "0 18px 35px rgba(217, 119, 6, 0.22)",
                }}
              >
                {copy.ctaPrimary}
                <ArrowRight size={16} />
              </a>
            </div>

            <p
              className="mt-4 max-w-xl text-zinc-500"
              style={{ fontSize: 13, lineHeight: 1.7 }}
            >
              {copy.support}
            </p>

            <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {copy.stats.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-2xl border border-zinc-200 bg-white px-4 py-4 shadow-sm"
                >
                  <div
                    className="text-zinc-950"
                    style={{ fontSize: 22, fontWeight: 800 }}
                  >
                    {stat.value}
                  </div>
                  <div
                    className="mt-1 text-zinc-500"
                    style={{ fontSize: 12, lineHeight: 1.5 }}
                  >
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <div
              className="absolute -right-2 top-5 hidden rounded-2xl border border-amber-200 bg-white/95 px-4 py-3 shadow-lg lg:block"
              style={{ transform: "rotate(4deg)" }}
            >
              <div className="flex items-center gap-2 text-zinc-700">
                <Bot size={16} className="text-amber-600" />
                <span style={{ fontSize: 12, fontWeight: 700 }}>
                  {copy.surfaceLine1}
                </span>
              </div>
              <p className="mt-1 text-zinc-500" style={{ fontSize: 12 }}>
                {copy.surfaceLine2}
              </p>
            </div>

            <div
              className="absolute -left-4 bottom-10 hidden rounded-2xl border border-teal-200 bg-white/95 px-4 py-3 shadow-lg lg:block"
              style={{ transform: "rotate(-5deg)" }}
            >
              <div className="flex items-center gap-2 text-zinc-700">
                <ShieldCheck size={16} className="text-teal-600" />
                <span style={{ fontSize: 12, fontWeight: 700 }}>
                  {copy.surfaceLine3}
                </span>
              </div>
              <p className="mt-1 text-zinc-500" style={{ fontSize: 12 }}>
                {copy.surfaceLine4}
              </p>
            </div>

            <div
              className="relative overflow-hidden rounded-[28px] border border-zinc-200 p-5 text-white shadow-2xl md:p-6"
              style={{
                background:
                  "linear-gradient(160deg, #111827 0%, #0f172a 42%, #172554 100%)",
                boxShadow: "0 26px 60px rgba(15, 23, 42, 0.18)",
              }}
            >
              <div
                className="absolute inset-x-6 top-0 h-px"
                style={{
                  background:
                    "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(251,191,36,0.65) 48%, rgba(255,255,255,0) 100%)",
                }}
              />

              <div className="flex items-center justify-between">
                <div>
                  <p
                    className="text-white/60"
                    style={{
                      fontSize: 12,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                    }}
                  >
                    Samga.ai
                  </p>
                  <h2
                    className="mt-2"
                    style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.1 }}
                  >
                    {copy.surfaceTitle}
                  </h2>
                  <p
                    className="mt-2 max-w-sm text-white/65"
                    style={{ fontSize: 13, lineHeight: 1.6 }}
                  >
                    {copy.surfaceSubtitle}
                  </p>
                </div>
                <div className="hidden rounded-2xl border border-white/10 bg-white/5 px-4 py-3 md:block">
                  <div className="flex items-center gap-2">
                    <GraduationCap size={18} className="text-amber-300" />
                    <span style={{ fontSize: 13, fontWeight: 700 }}>
                      Samga Score
                    </span>
                  </div>
                  <p className="mt-2" style={{ fontSize: 26, fontWeight: 800 }}>
                    112<span className="text-white/45">/140</span>
                  </p>
                </div>
              </div>

              <div className="mt-7 grid gap-3 md:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-3xl border border-white/10 bg-white/6 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white/70" style={{ fontSize: 12 }}>
                        {copy.surfaceExam}
                      </p>
                      <p style={{ fontSize: 15, fontWeight: 700 }}>
                        {copy.surfaceExamMeta}
                      </p>
                    </div>
                    <span
                      className="rounded-full px-2.5 py-1 text-white"
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        background: "rgba(245, 158, 11, 0.22)",
                      }}
                    >
                      87/140
                    </span>
                  </div>
                  <div className="mt-4 h-2 rounded-full bg-white/10">
                    <div
                      className="h-2 rounded-full"
                      style={{
                        width: "72%",
                        background: "linear-gradient(90deg, #fbbf24, #fb7185)",
                      }}
                    />
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    {["math", "history", "reading"].map((item, index) => (
                      <div
                        key={item}
                        className="rounded-2xl bg-white/5 px-3 py-3 text-center"
                      >
                        <p className="text-white/55" style={{ fontSize: 11 }}>
                          {index === 0
                            ? "Math"
                            : index === 1
                              ? "History"
                              : "Reading"}
                        </p>
                        <p style={{ fontSize: 15, fontWeight: 700 }}>
                          {index === 0 ? "39" : index === 1 ? "18" : "9"}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3">
                  <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-4">
                    <div className="flex items-center gap-2 text-emerald-200">
                      <BarChart3 size={16} />
                      <span style={{ fontSize: 12, fontWeight: 700 }}>
                        {copy.surfaceChance}
                      </span>
                    </div>
                    <p
                      className="mt-3"
                      style={{ fontSize: 32, fontWeight: 800 }}
                    >
                      78%
                    </p>
                    <p
                      className="mt-1 text-emerald-100/80"
                      style={{ fontSize: 12, lineHeight: 1.5 }}
                    >
                      {copy.surfaceChanceMeta}
                    </p>
                  </div>

                  <div className="rounded-3xl border border-white/10 bg-white/6 p-4">
                    <div className="flex items-center gap-2 text-white/75">
                      <Sparkles size={16} className="text-sky-300" />
                      <span style={{ fontSize: 12, fontWeight: 700 }}>
                        {copy.surfaceReview}
                      </span>
                    </div>
                    <p
                      className="mt-3 text-white/90"
                      style={{ fontSize: 14, lineHeight: 1.6, fontWeight: 600 }}
                    >
                      {copy.surfaceReviewMeta}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-3xl border border-white/10 bg-white/6 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-white/75">
                    <BookOpenText size={16} className="text-amber-300" />
                    <span style={{ fontSize: 12, fontWeight: 700 }}>
                      {copy.surfaceSource}
                    </span>
                  </div>
                  <span
                    className="rounded-full bg-white/10 px-2.5 py-1 text-white/75"
                    style={{ fontSize: 11, fontWeight: 700 }}
                  >
                    {copy.surfaceSourceMeta}
                  </span>
                </div>
                <p
                  className="mt-3 text-white/90"
                  style={{ fontSize: 14, lineHeight: 1.7 }}
                >
                  {copy.surfaceSourceText}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="h-px bg-zinc-200/80" />
    </section>
  );
}
