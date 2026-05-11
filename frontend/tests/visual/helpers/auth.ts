import { Page } from "@playwright/test";

// v4.11 (2026-05-06): backend runs on :8001 per project convention (matched
// by uvicorn invocations everywhere in this repo and by
// tests/helpers.ts `API_BASE` + tests/api.spec.ts `baseURL`). The
// old `:8000` here was the same leftover that v4.3 fixed in
// helpers.ts + api.spec.ts but missed on this file — resulting in
// 27 authenticated a11y + visual-snapshot specs ECONNREFUSED'ing
// against the wrong port for every run on master through v4.10.
// Keep this value in lock-step with tests/helpers.ts `API_BASE`;
// the v4.11 port-parity contract test asserts they match.
const API_URL = "http://localhost:8001";

interface AuthResult {
  token: string;
  refreshToken: string;
  email: string;
  name: string;
}

/**
 * Programmatically create a test user, complete onboarding via API,
 * and inject the token into localStorage so the frontend sees an
 * authenticated, fully-onboarded session.
 */
export async function setupAuthenticatedUser(page: Page): Promise<AuthResult> {
  const ts = Date.now();
  const email = `qa-visual-${ts}@example.com`;
  const password = "TestPass123!";
  const name = `QA Visual ${ts}`;

  // 1. Register
  const registerResp = await page.request.post(`${API_URL}/api/auth/register`, {
    data: { name, email, password },
    headers: { "Content-Type": "application/json" },
  });

  let token: string;
  let refreshToken: string;

  if (registerResp.ok()) {
    const body = await registerResp.json();
    token = body.access_token;
    refreshToken = body.refresh_token;
  } else {
    // User may already exist from a prior run — try logging in
    const loginResp = await page.request.post(`${API_URL}/api/auth/login`, {
      data: { email, password },
      headers: { "Content-Type": "application/json" },
    });
    if (!loginResp.ok()) {
      throw new Error(`Auth failed: register ${registerResp.status()}, login ${loginResp.status()}`);
    }
    const body = await loginResp.json();
    token = body.access_token;
    refreshToken = body.refresh_token;
  }

  // 2. Complete onboarding via PUT /api/users/me
  // v4.11 (2026-05-06): payload mirrors `tests/helpers.ts`
  // `createOnboardedUser`. s26 phase 7 added `target_majors[0]` +
  // `competition_quota` to the BE onboarding gate
  // (backend/app/utils/onboarding.py:is_onboarding_completed); the
  // previous payload satisfied the FE schema but left the 428 gate
  // latched, which sent every authenticated a11y/visual spec back
  // to /dashboard/onboarding instead of the screen under test.
  const onboardingResp = await page.request.put(`${API_URL}/api/users/me`, {
    data: {
      chosen_subjects: ["Mathematics", "Physics"],
      target_university_id: 1,
      target_majors: ["B057"],
      competition_quota: "GENERAL",
      weakest_subject: "Mathematics",
      last_test_results: {
        "History of Kazakhstan": [15],
        "Mathematical Literacy": [8],
        "Reading Literacy": [9],
        "Mathematics": [45],
        "Physics": [40],
      },
      language_preference: "RU",
    },
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!onboardingResp.ok()) {
    const errText = await onboardingResp.text().catch(() => "unknown");
    console.warn("Onboarding PUT failed:", onboardingResp.status(), errText);
  }

  // 3. Inject token into localStorage and reload context
  await page.goto("/");
  await page.evaluate(
    ({ t }) => {
      localStorage.setItem("access_token", t);
      localStorage.setItem("token", t);
    },
    { t: token }
  );

  return { token, refreshToken, email, name };
}

/**
 * For screens that need a *fresh* (non-onboarded) account.
 */
export async function setupFreshUser(page: Page): Promise<AuthResult> {
  const ts = Date.now();
  const email = `qa-fresh-${ts}@example.com`;
  const password = "TestPass123!";
  const name = `QA Fresh ${ts}`;

  const registerResp = await page.request.post(`${API_URL}/api/auth/register`, {
    data: { name, email, password },
    headers: { "Content-Type": "application/json" },
  });

  if (!registerResp.ok()) {
    throw new Error(`Fresh user registration failed: ${registerResp.status()}`);
  }

  const body = await registerResp.json();
  const token = body.access_token;
  const refreshToken = body.refresh_token;

  await page.goto("/");
  await page.evaluate(
    ({ t }) => {
      localStorage.setItem("access_token", t);
      localStorage.setItem("token", t);
    },
    { t: token }
  );

  return { token, refreshToken, email, name };
}

/**
 * Clear auth state.
 */
export async function logoutUser(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      localStorage.removeItem("access_token");
      localStorage.removeItem("token");
    });
  } catch {
    // Page may still be on about:blank if setup failed early
  }
}
