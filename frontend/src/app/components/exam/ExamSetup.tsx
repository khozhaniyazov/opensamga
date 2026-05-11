import { useState, type ReactNode } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Sparkles,
} from "lucide-react";
import { useLang } from "../LanguageContext";
import {
  VALID_PAIRINGS,
  SUBJECT_NAMES,
  type ProfileSubjectKey,
  type SubjectPairing,
} from "./types";

interface ExamSetupProps {
  onStart: (sub1: ProfileSubjectKey, sub2: ProfileSubjectKey) => void;
  onCancel: () => void;
}

export function ExamSetup({ onStart, onCancel }: ExamSetupProps) {
  const { t, lang } = useLang();
  const [selectedPairing, setSelectedPairing] = useState<SubjectPairing | null>(
    null,
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="rounded-2xl border border-zinc-200/80 bg-zinc-50 px-6 py-6 sm:px-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <HeroPill
                icon={<ClipboardCheck size={13} className="text-amber-700" />}
              >
                Samga Exam
              </HeroPill>
              <HeroPill
                icon={<Sparkles size={13} className="text-amber-700" />}
              >
                {lang === "kz" ? "Жұпты таңдау" : "Выбор пары"}
              </HeroPill>
            </div>
            <h1
              className="text-[24px] text-zinc-950 sm:text-[30px]"
              style={{ fontWeight: 760, lineHeight: 1.08 }}
            >
              {t("examSetup.title")}
            </h1>
            <p
              className="mt-3 text-[13px] text-zinc-600 sm:text-[14px]"
              style={{ lineHeight: 1.7 }}
            >
              {t("examSetup.subtitle")}
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-4 lg:w-[520px]">
            <HeroStat label={t("examSetup.minutes")} value="240" />
            <HeroStat label={t("examSetup.questions")} value="120" />
            <HeroStat label={t("examSetup.maxPoints")} value="140" />
            <HeroStat label={t("examSetup.subjects")} value="5" />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200/80 bg-white px-5 py-5 ">
        <div className="mb-4">
          <h2
            className="text-zinc-950"
            style={{ fontSize: 18, fontWeight: 730 }}
          >
            {t("examSetup.format")}
          </h2>
          <p
            className="mt-1 text-zinc-500"
            style={{ fontSize: 13, lineHeight: 1.6 }}
          >
            {t("examSetup.formatDesc")}
          </p>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="rounded-xl border border-zinc-200/80 bg-zinc-50 p-4">
            <p
              className="text-zinc-500"
              style={{
                fontSize: 11,
                fontWeight: 760,
                textTransform: "uppercase",
              }}
            >
              {t("examSetup.mandatory")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <SubjectBadge
                label={SUBJECT_NAMES.histKz[lang]}
                detail="20 x 1"
                accent={false}
              />
              <SubjectBadge
                label={SUBJECT_NAMES.readLit[lang]}
                detail="10 x 1"
                accent={false}
              />
              <SubjectBadge
                label={SUBJECT_NAMES.mathLit[lang]}
                detail="10 x 1"
                accent={false}
              />
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200/80 bg-zinc-50 p-4">
            <p
              className="text-zinc-500"
              style={{
                fontSize: 11,
                fontWeight: 760,
                textTransform: "uppercase",
              }}
            >
              {t("examSetup.profile")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {selectedPairing ? (
                <>
                  <SubjectBadge
                    label={SUBJECT_NAMES[selectedPairing.sub1][lang]}
                    detail="40 -> 50"
                    accent
                  />
                  <SubjectBadge
                    label={SUBJECT_NAMES[selectedPairing.sub2][lang]}
                    detail="40 -> 50"
                    accent
                  />
                </>
              ) : (
                <span className="text-zinc-500" style={{ fontSize: 12.5 }}>
                  {t("examSetup.selectBelow")}
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200/80 bg-white px-5 py-5 ">
        <div className="mb-4">
          <h2
            className="text-zinc-950"
            style={{ fontSize: 18, fontWeight: 730 }}
          >
            {t("examSetup.choosePairing")}
          </h2>
        </div>

        <div className="grid gap-3 xl:grid-cols-2">
          {VALID_PAIRINGS.map((pairing, idx) => {
            const isSelected =
              selectedPairing?.sub1 === pairing.sub1 &&
              selectedPairing?.sub2 === pairing.sub2;

            return (
              <button
                key={idx}
                type="button"
                onClick={() => setSelectedPairing(pairing)}
                className={`rounded-xl border px-4 py-4 text-left transition-all ${
                  isSelected
                    ? "border-amber-300 bg-amber-50/70 "
                    : "border-zinc-200/80 bg-zinc-50 hover:border-zinc-300 hover:bg-white"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                      isSelected
                        ? "border-amber-500 bg-amber-500"
                        : "border-zinc-300 bg-white"
                    }`}
                  >
                    {isSelected ? (
                      <CheckCircle2 size={15} className="text-white" />
                    ) : null}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="text-zinc-950"
                        style={{ fontSize: 15, fontWeight: 700 }}
                      >
                        {SUBJECT_NAMES[pairing.sub1][lang]}
                      </span>
                      <span className="text-zinc-300">+</span>
                      <span
                        className="text-zinc-950"
                        style={{ fontSize: 15, fontWeight: 700 }}
                      >
                        {SUBJECT_NAMES[pairing.sub2][lang]}
                      </span>
                    </div>
                    <p
                      className="mt-2 text-zinc-500"
                      style={{ fontSize: 12.5, lineHeight: 1.6 }}
                    >
                      {pairing.trajectory[lang]}
                    </p>
                  </div>

                  <ChevronRight
                    size={16}
                    className={isSelected ? "text-amber-600" : "text-zinc-300"}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-4">
        <div className="flex gap-3">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-700" />
          <p
            className="text-amber-900"
            style={{ fontSize: 12.5, lineHeight: 1.7 }}
          >
            {t("examSetup.warning")}
          </p>
        </div>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => {
            if (selectedPairing) {
              onStart(selectedPairing.sub1, selectedPairing.sub2);
            }
          }}
          disabled={!selectedPairing}
          className={`inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl px-5 transition-colors ${
            selectedPairing
              ? "bg-zinc-950 text-white hover:bg-black"
              : "cursor-not-allowed bg-zinc-200 text-zinc-500"
          }`}
          style={{ fontSize: 14, fontWeight: 720 }}
        >
          <ClipboardCheck size={16} />
          {t("examSetup.startExam")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-12 items-center justify-center rounded-2xl border border-zinc-200 bg-white px-5 text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
          style={{ fontSize: 14, fontWeight: 680 }}
        >
          {t("examSetup.cancel")}
        </button>
      </div>
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
    <div className="rounded-xl border border-zinc-200/80 bg-white px-4 py-3 text-center">
      <p
        className="text-zinc-500"
        style={{ fontSize: 11, fontWeight: 760, textTransform: "uppercase" }}
      >
        {label}
      </p>
      <p
        className="mt-2 text-zinc-900"
        style={{ fontSize: 18, fontWeight: 760, lineHeight: 1 }}
      >
        {value}
      </p>
    </div>
  );
}

function SubjectBadge({
  label,
  detail,
  accent,
}: {
  label: string;
  detail: string;
  accent: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 ${
        accent
          ? "border-amber-200 bg-amber-50 text-amber-700"
          : "border-zinc-200 bg-white text-zinc-600"
      }`}
      style={{ fontSize: 12, fontWeight: 650 }}
    >
      {label}
      <span className="opacity-60" style={{ fontSize: 10.5 }}>
        {detail}
      </span>
    </span>
  );
}
