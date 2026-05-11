import { test, expect, type Page, type TestInfo } from "@playwright/test";
import {
  MOCK_ONBOARDED_USER,
  MOCK_PREMIUM_BILLING,
  MOCK_TOKEN,
  expectNoDocumentHorizontalOverflow,
} from "./helpers";

const books = [
  {
    id: 1,
    title: "Математика 2 Оспанов",
    subject: "Математика",
    grade: 10,
    file_name: "math-ospanov.pdf",
    total_pages: 220,
  },
  {
    id: 2,
    title: "Физика 11",
    subject: "Физика",
    grade: 11,
    file_name: "physics-11.pdf",
    total_pages: 180,
  },
];

const universities = [
  {
    id: 1,
    label: "Казахстанско-Британский технический университет",
    value: "kazakhstan_british_technical_university",
    city: "Алматы",
    university_code: "KBTU",
    total_students: 5000,
    majors_count: 24,
    median_grant_threshold: 118,
    popularity_score: 95,
    popularity_tier: "very_high",
    prestige_score: 96,
    prestige_tier: "elite",
    prestige_note: "Strong technical university.",
  },
  {
    id: 2,
    label: "Назарбаев Университет",
    value: "nazarbayev_university",
    city: "Астана",
    university_code: "NU",
    total_students: 7000,
    majors_count: 32,
    median_grant_threshold: 125,
    popularity_score: 98,
    popularity_tier: "very_high",
    prestige_score: 99,
    prestige_tier: "elite",
    prestige_note: "Research university.",
  },
];

const thumbnailSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 24 32"><rect width="24" height="32" rx="3" fill="#f4f4f5"/></svg>';

function examQuestion(section: string, index: number) {
  return {
    id: `${section}-${index}`,
    type: "single",
    stem: {
      ru: `Вопрос ${index} по разделу ${section}`,
      kz: `${section} бөлімі бойынша ${index} сұрақ`,
    },
    options: [
      { id: "a", text: { ru: "Вариант A", kz: "A нұсқасы" } },
      { id: "b", text: { ru: "Вариант B", kz: "B нұсқасы" } },
      { id: "c", text: { ru: "Вариант C", kz: "C нұсқасы" } },
      { id: "d", text: { ru: "Вариант D", kz: "D нұсқасы" } },
    ],
    correctIds: ["a"],
    maxPoints: 1,
  };
}

function examSection(key: string, count: number, maxPoints: number) {
  return {
    key,
    maxPoints,
    questions: Array.from({ length: count }, (_, index) =>
      examQuestion(key, index + 1),
    ),
  };
}

function examData() {
  return {
    subjects: [
      examSection("histKz", 20, 20),
      examSection("readLit", 10, 10),
      examSection("mathLit", 10, 10),
      examSection("math", 40, 50),
      examSection("physics", 40, 50),
    ],
    totalQuestions: 120,
    totalMaxPoints: 140,
    durationSeconds: 14400,
  };
}

async function installFrontendMocks(page: Page) {
  let user = { ...MOCK_ONBOARDED_USER };
  const billing = { ...MOCK_PREMIUM_BILLING };

  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname.replace(/^\/api/, "");
      const method = request.method().toUpperCase();

      const json = async (body: unknown, status = 200) => {
        await route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify(body),
        });
      };

      if (path === "/users/me") {
        if (method === "PUT" || method === "PATCH") {
          try {
            user = {
              ...user,
              ...JSON.parse(request.postData() || "{}"),
              onboarding_completed: true,
            };
          } catch {
            user = { ...user, onboarding_completed: true };
          }
        }
        return json(user);
      }

      if (path === "/billing/status") return json(billing);
      if (path === "/billing/checkout") return json({ ok: true });

      if (path === "/data/universities") return json(universities);
      if (path.startsWith("/data/universities/")) {
        return json({
          ...universities[0],
          majors: [
            { name: "Computer Science", grant_threshold: 118, code: "B057" },
            { name: "Data Science", grant_threshold: 121, code: "B058" },
          ],
        });
      }

      if (path === "/library/books") return json(books);
      if (/^\/library\/books\/\d+\/pages\/\d+\/thumbnail$/.test(path)) {
        return route.fulfill({
          status: 200,
          contentType: "image/svg+xml",
          body: thumbnailSvg,
        });
      }
      if (/^\/library\/books\/\d+\/pdf$/.test(path)) {
        return route.fulfill({
          status: 200,
          contentType: "application/pdf",
          body: "%PDF-1.4\n% Samga route sweep PDF\n",
        });
      }

      if (path === "/chat/template-context") {
        return json({
          unresolved_mistakes_count: 2,
          exam_attempts_count: 3,
          weakness_topic_tag: "mechanics",
          has_library_activity: true,
          profile_subjects: ["Physics", "Mathematics"],
          weakest_subject: "Physics",
          last_test_results_count: 5,
          target_university_name: "KBTU",
          has_onboarding_profile: true,
        });
      }
      if (path === "/chat/history") {
        return json({
          messages: [
            {
              id: 1,
              role: "assistant",
              content: "Samga дайын. Қай тақырыпты талдаймыз?",
              created_at: "2026-04-25T08:00:00.000Z",
              metadata: {},
            },
          ],
        });
      }
      if (path === "/chat/threads") {
        if (method === "POST") return json({ id: 10 });
        return json({
          threads: [
            {
              id: 10,
              title: "Physics review",
              message_count: 1,
              created_at: "2026-04-25T08:00:00.000Z",
              updated_at: "2026-04-25T08:05:00.000Z",
            },
          ],
        });
      }
      if (path.startsWith("/chat/threads/")) return json({ ok: true });
      if (path === "/chat" || path === "/chat/history/truncate") {
        return json({
          content: "Короткий разбор готов.",
          message: "Короткий разбор готов.",
        });
      }
      if (path === "/feedback/chat") return json({ ok: true });

      if (path === "/exam/history") return json([]);
      if (path === "/exam/generate") return json(examData());
      if (path === "/exam/submit") {
        return json({
          score: 1,
          max_score: 140,
          attempt_id: 42,
          mistakes_created: 0,
          answered_count: 1,
          skipped_count: 119,
          wrong_answered_count: 0,
        });
      }
      if (path === "/exam/analytics") {
        return json({
          total_attempts: 4,
          avg_score: 104,
          avg_percentage: 74,
          best_score: 119,
          best_percentage: 85,
          score_trend: [
            { date: "2026-04-20", percentage: 66 },
            { date: "2026-04-22", percentage: 72 },
            { date: "2026-04-24", percentage: 85 },
          ],
          subject_performance: [
            { subject: "Mathematics", avg_score: 41, avg_max: 50 },
            { subject: "Physics", avg_score: 37, avg_max: 50 },
            { subject: "Reading", avg_score: 8, avg_max: 10 },
          ],
        });
      }

      if (path === "/practice/generate") {
        return json({
          id: 77,
          session_id: 900,
          question: "Найдите значение выражения 2 + 2.",
          options: [
            { key: "A", text: "3" },
            { key: "B", text: "4" },
            { key: "C", text: "5" },
            { key: "D", text: "6" },
          ],
          subject: "Mathematics",
          grade: 11,
          difficulty: "MEDIUM",
          language: "ru",
        });
      }
      if (/^\/practice\/\d+\/answer$/.test(path)) {
        return json({
          is_correct: true,
          correct_answer: "B",
          explanation: "2 + 2 = 4.",
          citation: null,
        });
      }

      if (path === "/analytics/gap-analysis") {
        return json({
          target_university: "KBTU",
          grant_threshold: 118,
          current_score: 96,
          current_score_source: "profile_results",
          gap: 22,
          total_recoverable_points: 18,
          recommendations: [
            {
              topic: "Physics",
              points_lost: 8,
              pages_to_read: 14,
              efficiency: 0.7,
              action: "READ",
              priority: "HIGH",
              message: "Focus on mechanics.",
            },
          ],
          practice_summary: null,
        });
      }
      if (path === "/analytics/rag-stats") {
        return json({
          window_hours: 24,
          total_queries: 12,
          hit_rate: 0.83,
          p50_ms: 220,
          p95_ms: 640,
          top_subjects: [{ subject: "Physics", count: 7 }],
          top_books: [{ book: "Физика 11", count: 5 }],
          feedback: { positive: 8, negative: 1 },
        });
      }

      if (path === "/mistakes/trends") {
        return json({
          daily_trends: [
            { date: "2026-04-20", total: 3, resolved: 1, unresolved: 2 },
            { date: "2026-04-21", total: 4, resolved: 2, unresolved: 2 },
          ],
          total_mistakes: 7,
          total_resolved: 3,
          total_unresolved: 4,
          resolution_rate: 0.43,
        });
      }
      if (path === "/mistakes/recommendations") {
        return json({
          recommendations: [
            {
              topic: "Mechanics",
              subject: "Physics",
              mistake_count: 4,
              unresolved_count: 3,
              priority: "high",
              recommendation: "Review Newton laws.",
              last_mistake_date: "2026-04-24",
            },
          ],
          total_weak_areas: 1,
          practice_summary: null,
        });
      }
      if (path === "/mistakes/list") {
        return json({
          mistakes: [
            {
              id: 1,
              question_text: "What is acceleration?",
              subject: "Physics",
              topic_tag: "Mechanics",
              question_type: "practice",
              user_answer: "Velocity",
              correct_answer: "Change in velocity over time",
              is_resolved: false,
              points_lost: 1,
              created_at: "2026-04-24T08:00:00.000Z",
              ai_diagnosis: "You mixed velocity and acceleration.",
            },
          ],
          total: 1,
          page: 1,
          page_size: 20,
          subjects: ["Physics"],
          topics: ["Mechanics"],
        });
      }
      if (path === "/mistakes/unresolved") return json([]);

      return json({ ok: true });
    },
  );
}

async function login(page: Page, path = "/dashboard") {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(
    ({ token }) => {
      localStorage.setItem("access_token", token);
      localStorage.setItem("token", token);
      localStorage.setItem("samga_lang", "ru");
      sessionStorage.clear();
    },
    { token: MOCK_TOKEN },
  );
  await page.goto(path);
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
}

async function assertHealthyRoute(
  page: Page,
  testInfo: TestInfo,
  routePath: string,
  label: string,
) {
  await page.goto(routePath);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(700);

  await expect(page.locator("body")).not.toContainText(
    /Something went wrong|Unhandled|TypeError|ReferenceError|Request failed|Failed to load|Не удалось загрузить|Ошибка загрузки/i,
  );
  await expectNoDocumentHorizontalOverflow(page);

  const visibleTextLength = await page
    .locator("body")
    .evaluate((body) => body.innerText.trim().length);
  expect(visibleTextLength).toBeGreaterThan(20);

  await page.screenshot({
    path: testInfo.outputPath(`${label}.png`),
    fullPage: true,
  });
}

const routes = [
  ["/dashboard", "dashboard"],
  ["/dashboard/chat", "chat"],
  ["/dashboard/exams", "exams"],
  ["/dashboard/exams/analytics", "exam-analytics"],
  ["/dashboard/mistakes", "mistakes"],
  ["/dashboard/training", "training"],
  ["/dashboard/gap-analysis", "gap-analysis"],
  ["/dashboard/library", "library"],
  ["/dashboard/library/books/1?page=41", "pdf-viewer"],
  ["/dashboard/universities", "universities"],
  ["/dashboard/billing", "billing"],
  ["/dashboard/profile", "profile"],
  ["/dashboard/quiz", "quiz"],
  ["/dashboard/commuter", "commuter"],
  ["/dashboard/portfolio", "portfolio"],
  ["/dashboard/buddy", "buddy"],
] as const;

test.describe("Frontend route sweep", () => {
  test("dashboard routes render cleanly on desktop and mobile", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000);
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(message.text());
    });

    await installFrontendMocks(page);
    await login(page);

    for (const viewport of [
      { width: 1366, height: 768, suffix: "desktop" },
      { width: 390, height: 844, suffix: "mobile" },
    ]) {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      for (const [routePath, label] of routes) {
        await assertHealthyRoute(
          page,
          testInfo,
          routePath,
          `${viewport.suffix}-${label}`,
        );
      }
    }

    expect(runtimeErrors).toEqual([]);
  });

  test("mobile dashboard drawer opens and closes without page overflow", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installFrontendMocks(page);
    await login(page);

    await page
      .getByRole("button", { name: /Открыть меню|Мәзірді ашу/i })
      .click();
    // 2026-05-05 (v4.5): the drawer's role=dialog wrapper has the
    // localized aria-label "Мобильное боковое меню" / "Мобильді бүйір
    // мәзірі" set in DashboardLayout.tsx. The previous selector
    // "Mobile dashboard sidebar" was a guess that never matched, so
    // the assertion timed out silently. We use getByRole('dialog')
    // here so the inner <aside> with the same aria-label doesn't
    // trip strict-mode duplicate-match.
    await expect(
      page.getByRole("dialog", { name: /Мобильное боковое меню|Мобильді бүйір мәзірі/ }),
    ).toBeVisible();
    await expectNoDocumentHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("mobile-drawer-open.png"),
      fullPage: true,
    });

    await page.keyboard.press("Escape");
    await page.mouse.click(360, 40);
    await expect(
      page.getByRole("dialog", { name: /Мобильное боковое меню|Мобильді бүйір мәзірі/ }),
    ).toHaveCount(0);
    await expectNoDocumentHorizontalOverflow(page);
  });
});
