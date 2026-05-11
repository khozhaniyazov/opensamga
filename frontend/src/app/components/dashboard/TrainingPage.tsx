import { useMemo, useState, type ReactNode } from "react";
import { Dumbbell, Play, Sparkles, Target } from "lucide-react";
import { useNavigate } from "react-router";
import { usePlan } from "../billing/PlanContext";
import { useLang } from "../LanguageContext";
import { LimitReachedModal } from "../billing/LimitReachedModal";
import { PaywallModal } from "../billing/PaywallModal";
import { PlanGuard } from "../billing/PlanGuard";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";

const subjects = [
  {
    nameKey: "subject.mathLit",
    apiSubject: "Mathematical Literacy",
    typeKey: "training.required",
    topicKeys: [
      "topic.percents",
      "topic.equations",
      "topic.geometry",
      "topic.statistics",
      "topic.logic",
    ],
    tone: "sky",
  },
  {
    nameKey: "subject.readLit",
    apiSubject: "Reading Literacy",
    typeKey: "training.required",
    topicKeys: [
      "topic.textAnalysis",
      "topic.argumentation",
      "topic.mainIdea",
      "topic.structure",
    ],
    tone: "rose",
  },
  {
    nameKey: "subject.histKz",
    apiSubject: "History of Kazakhstan",
    typeKey: "training.required",
    topicKeys: [
      "topic.ancient",
      "topic.medieval",
      "topic.khanate",
      "topic.modern",
      "topic.independence",
    ],
    tone: "amber",
  },
  {
    nameKey: "subject.physics",
    apiSubject: "Physics",
    typeKey: "training.elective",
    topicKeys: [
      "topic.mechanics",
      "topic.thermo",
      "topic.electricity",
      "topic.optics",
      "topic.nuclear",
    ],
    tone: "violet",
  },
  {
    nameKey: "subject.math",
    apiSubject: "Mathematics",
    typeKey: "training.elective",
    topicKeys: [
      "topic.algebra",
      "topic.trig",
      "topic.derivatives",
      "topic.integrals",
      "topic.combinatorics",
    ],
    tone: "emerald",
  },
] as const;

const toneClasses: Record<
  string,
  {
    icon: string;
    badge: string;
    chip: string;
  }
> = {
  sky: {
    icon: "bg-sky-50 text-sky-700 border-sky-200",
    badge: "bg-sky-50 text-sky-700 border-sky-200",
    chip: "bg-sky-50/70 text-sky-700 border-sky-200/70",
  },
  rose: {
    icon: "bg-rose-50 text-rose-700 border-rose-200",
    badge: "bg-rose-50 text-rose-700 border-rose-200",
    chip: "bg-rose-50/70 text-rose-700 border-rose-200/70",
  },
  amber: {
    icon: "bg-amber-50 text-amber-700 border-amber-200",
    badge: "bg-amber-50 text-amber-700 border-amber-200",
    chip: "bg-amber-50/70 text-amber-700 border-amber-200/70",
  },
  violet: {
    icon: "bg-violet-50 text-violet-700 border-violet-200",
    badge: "bg-violet-50 text-violet-700 border-violet-200",
    chip: "bg-violet-50/70 text-violet-700 border-violet-200/70",
  },
  emerald: {
    icon: "bg-emerald-50 text-emerald-700 border-emerald-200",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
    chip: "bg-emerald-50/70 text-emerald-700 border-emerald-200/70",
  },
};

export function TrainingPage() {
  return (
    <PlanGuard feature="training">
      <TrainingContent />
    </PlanGuard>
  );
}

function TrainingContent() {
  const navigate = useNavigate();
  const { billing, isLimitReached } = usePlan();
  const { t, lang } = useLang();
  useDocumentTitle(t("dash.nav.training"));

  const [limitModal, setLimitModal] = useState(false);
  const [paywallModal, setPaywallModal] = useState(false);

  const used = billing.usage.trainingCalls;
  const limit = billing.limits.trainingCallsPerDay;
  const totalTopics = useMemo(
    () => subjects.reduce((sum, subject) => sum + subject.topicKeys.length, 0),
    [],
  );

  function handleStart(subject: string) {
    if (isLimitReached("trainingCalls")) {
      setLimitModal(true);
      return;
    }

    navigate(
      `/dashboard/quiz?subject=${encodeURIComponent(subject)}&autostart=1&source=training`,
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="rounded-2xl border border-zinc-200 bg-white px-6 py-6 sm:px-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <HeroPill
                icon={<Dumbbell size={13} className="text-amber-700" />}
              >
                Samga Practice
              </HeroPill>
              <HeroPill
                icon={<Sparkles size={13} className="text-amber-700" />}
              >
                {lang === "kz" ? "Қысқа сериялар" : "Короткие серии"}
              </HeroPill>
            </div>
            <h1
              className="text-[24px] text-zinc-950 sm:text-[30px]"
              style={{ fontWeight: 760, lineHeight: 1.08 }}
            >
              {t("training.title")}
            </h1>
            <p
              className="mt-3 text-[13px] text-zinc-600 sm:text-[14px]"
              style={{ lineHeight: 1.7 }}
            >
              {lang === "kz"
                ? "Samga практикасында жылдам ритм маңызды: пәнді таңдап, қысқа серияны бірден бастаңыз."
                : "В практике Samga важен быстрый ритм: выбрали предмет и сразу ушли в короткую серию вопросов."}
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-3 lg:w-[430px]">
            <HeroStat
              label={lang === "kz" ? "Бүгін" : "Сегодня"}
              value={`${used}/${limit}`}
            />
            <HeroStat
              label={lang === "kz" ? "Пәндер" : "Предметы"}
              value={String(subjects.length)}
            />
            <HeroStat
              label={lang === "kz" ? "Тақырыптар" : "Темы"}
              value={String(totalTopics)}
            />
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {subjects.map((subject) => {
          // toneClasses keys are seeded from `subjects[].tone`; fall back to
          // sky to satisfy noUncheckedIndexedAccess if the literal drifts.
          const tone = toneClasses[subject.tone] ?? toneClasses.sky!;
          return (
            <article
              key={subject.nameKey}
              className="rounded-2xl border border-zinc-200 bg-white p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-xl border ${tone.icon}`}
                >
                  <Dumbbell size={18} />
                </div>
                <span
                  className={`inline-flex items-center rounded-full border px-3 py-1.5 ${tone.badge}`}
                  style={{ fontSize: 11, fontWeight: 700 }}
                >
                  {t(subject.typeKey)}
                </span>
              </div>

              <h2
                className="mt-4 text-zinc-950"
                style={{ fontSize: 18, fontWeight: 730, lineHeight: 1.25 }}
              >
                {t(subject.nameKey)}
              </h2>

              <div
                className="mt-3 flex items-center gap-2 text-zinc-500"
                style={{ fontSize: 12.5 }}
              >
                <Target size={13} className="text-zinc-500" />
                <span>
                  {subject.topicKeys.length} {t("training.topics")}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {subject.topicKeys.map((topicKey) => (
                  <span
                    key={topicKey}
                    className={`inline-flex items-center rounded-full border px-3 py-1.5 ${tone.chip}`}
                    style={{ fontSize: 11.5, fontWeight: 650 }}
                  >
                    {t(topicKey)}
                  </span>
                ))}
              </div>

              <button
                type="button"
                onClick={() => handleStart(subject.apiSubject)}
                className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 text-white transition-colors hover:bg-black"
                style={{ fontSize: 13, fontWeight: 720 }}
              >
                <Play size={15} />
                {lang === "kz" ? "Серияны бастау" : "Начать серию"}
              </button>
            </article>
          );
        })}
      </div>

      <LimitReachedModal
        open={limitModal}
        onClose={() => setLimitModal(false)}
        counter="trainingCalls"
        onUpgrade={() => {
          setLimitModal(false);
          setPaywallModal(true);
        }}
      />
      <PaywallModal
        open={paywallModal}
        onClose={() => setPaywallModal(false)}
        feature="training"
      />
    </div>
  );
}

function HeroPill({ icon, children }: { icon: ReactNode; children: string }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-zinc-700"
      style={{ fontSize: 11, fontWeight: 700 }}
    >
      {icon}
      {children}
    </span>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
      <p
        className="text-zinc-500"
        style={{ fontSize: 11, fontWeight: 760, textTransform: "uppercase" }}
      >
        {label}
      </p>
      <p
        className="mt-2 text-zinc-900"
        style={{ fontSize: 20, fontWeight: 760, lineHeight: 1 }}
      >
        {value}
      </p>
    </div>
  );
}
