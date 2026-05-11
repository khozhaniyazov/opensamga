import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

// Import translation files
import enCommon from "./locales/en/common.json";
import enSubjects from "./locales/en/subjects.json";
import enErrors from "./locales/en/errors.json";

import ruCommon from "./locales/ru/common.json";
import ruAuth from "./locales/ru/auth.json";
import ruDashboard from "./locales/ru/dashboard.json";
import ruExam from "./locales/ru/exam.json";
import ruSocial from "./locales/ru/social.json";
import ruChat from "./locales/ru/chat.json";
import ruProfile from "./locales/ru/profile.json";
import ruWidgets from "./locales/ru/widgets.json";
import ruSubjects from "./locales/ru/subjects.json";
import ruSearch from "./locales/ru/search.json";
import ruLibrary from "./locales/ru/library.json";
import ruQuiz from "./locales/ru/quiz.json";
import ruCommuter from "./locales/ru/commuter.json";
import ruErrors from "./locales/ru/errors.json";

import kzCommon from "./locales/kz/common.json";
import kzAuth from "./locales/kz/auth.json";
import kzDashboard from "./locales/kz/dashboard.json";
import kzExam from "./locales/kz/exam.json";
import kzSocial from "./locales/kz/social.json";
import kzChat from "./locales/kz/chat.json";
import kzProfile from "./locales/kz/profile.json";
import kzWidgets from "./locales/kz/widgets.json";
import kzSubjects from "./locales/kz/subjects.json";
import kzSearch from "./locales/kz/search.json";
import kzLibrary from "./locales/kz/library.json";
import kzQuiz from "./locales/kz/quiz.json";
import kzCommuter from "./locales/kz/commuter.json";
import kzErrors from "./locales/kz/errors.json";

const resources = {
  en: {
    common: enCommon,
    subjects: enSubjects,
    errors: enErrors,
  },
  ru: {
    common: ruCommon,
    auth: ruAuth,
    dashboard: ruDashboard,
    exam: ruExam,
    social: ruSocial,
    chat: ruChat,
    profile: ruProfile,
    widgets: ruWidgets,
    subjects: ruSubjects,
    search: ruSearch,
    library: ruLibrary,
    quiz: ruQuiz,
    commuter: ruCommuter,
    errors: ruErrors,
  },
  kz: {
    common: kzCommon,
    auth: kzAuth,
    dashboard: kzDashboard,
    exam: kzExam,
    social: kzSocial,
    chat: kzChat,
    profile: kzProfile,
    widgets: kzWidgets,
    subjects: kzSubjects,
    search: kzSearch,
    library: kzLibrary,
    quiz: kzQuiz,
    commuter: kzCommuter,
    errors: kzErrors,
  },
};

// FIX: Clean up region codes in localStorage BEFORE i18n init
// This ensures ru-RU becomes ru, kz-KZ becomes kz, etc.
const storedLang = localStorage.getItem("i18nextLng");
if (storedLang && storedLang.includes("-")) {
  const normalizedLang = storedLang.split("-")[0] ?? storedLang;
  localStorage.setItem("i18nextLng", normalizedLang);
  // BUG #6 fix (2026-04-24): only log normalization in dev so the
  // browser console stays clean in production builds.
  if (import.meta.env?.DEV) {
    console.debug(
      `[i18n] Normalized language: ${storedLang} -> ${normalizedLang}`,
    );
  }
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "ru",
    supportedLngs: ["en", "ru", "kz"],
    load: "languageOnly", // Strip region codes: ru-RU -> ru, kz-KZ -> kz
    defaultNS: "common",
    ns: [
      "common",
      "auth",
      "dashboard",
      "exam",
      "social",
      "chat",
      "profile",
      "widgets",
      "subjects",
      "search",
      "library",
      "quiz",
      "commuter",
      "errors",
    ],

    interpolation: {
      escapeValue: false, // React already escapes
    },

    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "i18nextLng",
      caches: ["localStorage"],
    },
  });

export default i18n;
