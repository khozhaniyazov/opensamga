import { Page, expect, APIRequestContext } from '@playwright/test';

export const TEST_USER = {
  name: 'E2E Test User',
  email: `e2e_test_${Date.now()}@samga.ai`,
  password: 'TestPass123!',
};

// v4.3 (2026-05-05): backend runs on :8001 per project convention (matched
// by uvicorn invocations everywhere in this repo). The :8000 here
// was a leftover from an earlier port — same bug as api.spec.ts:7.
const API_BASE = 'http://localhost:8001';

export const uniqueEmail = (prefix = 'e2e') =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@samga.ai`;

export const MOCK_TOKEN = 'mock-e2e-token';

export const MOCK_ONBOARDED_USER = {
  id: 1001,
  email: 'mock-e2e@samga.ai',
  name: 'Mock E2E User',
  is_admin: false,
  role: 'student',
  target_university_id: 1,
  chosen_subjects: ['Physics', 'Mathematics'],
  weakest_subject: 'Physics',
  last_test_results: {
    'History of Kazakhstan': [15],
    'Reading Literacy': [8],
    'Mathematical Literacy': [9],
    Physics: [35],
    Mathematics: [40],
  },
  language_preference: 'RU',
  onboarding_completed: true,
};

export const MOCK_FRESH_USER = {
  ...MOCK_ONBOARDED_USER,
  id: 1002,
  email: 'fresh-e2e@samga.ai',
  name: 'Fresh E2E User',
  target_university_id: null,
  chosen_subjects: [],
  weakest_subject: null,
  last_test_results: {},
  onboarding_completed: false,
};

export const MOCK_FREE_BILLING = {
  plan: 'FREE',
  is_premium: false,
  expires_at: null,
  provider: null,
  chat_model: 'samga-free',
  price_kzt: 2000,
  limits: {
    chat_messages: 20,
    exam_runs: 0,
    mistake_analyses: 0,
    practice_questions: 0,
  },
  usage: {
    chat_messages: 0,
    exam_runs: 0,
    mistake_analyses: 0,
    practice_questions: 0,
  },
};

export const MOCK_PREMIUM_BILLING = {
  ...MOCK_FREE_BILLING,
  plan: 'PREMIUM',
  is_premium: true,
  chat_model: 'samga-premium',
  limits: {
    chat_messages: 200,
    exam_runs: 10,
    mistake_analyses: 10,
    practice_questions: 100,
  },
  usage: {
    chat_messages: 0,
    exam_runs: 0,
    mistake_analyses: 0,
    practice_questions: 0,
  },
};

export async function registerUser(page: Page, name: string, email: string, password: string) {
  await page.goto('/register');
  await page.locator('input[type="text"]').fill(name);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  // Wait for either dashboard or onboarding
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
}

export async function createOnboardedUser(request: APIRequestContext, name: string, email: string, password: string) {
  // 1. Register
  const reg = await request.post(`${API_BASE}/api/auth/register`, {
    data: { name, email, password, language_preference: 'RU' },
  });
  if (!reg.ok()) {
    const text = await reg.text();
    throw new Error(`Registration failed: ${reg.status()} ${text}`);
  }
  const { access_token } = await reg.json();

  // 2. Complete onboarding via API
  // Score ranges: History of Kazakhstan=20, Mathematical Literacy=10, Reading Literacy=10, others=50
  // s26 phase 7 (backend/app/utils/onboarding.py:is_onboarding_completed):
  // target_majors[0] and competition_quota are now required for the
  // 428 onboarding gate to lift. Earlier helpers.ts predates this rule
  // and produced fixtures that satisfied the FE schema but failed the
  // BE gate, surfacing as api.spec.ts:77 returning 428.
  const onboardingData = {
    chosen_subjects: ['Physics', 'Mathematics'],
    target_university_id: 1,
    target_majors: ['B057'],
    competition_quota: 'GENERAL',
    weakest_subject: 'Physics',
    last_test_results: {
      'History of Kazakhstan': [15],
      'Reading Literacy': [8],
      'Mathematical Literacy': [9],
      'Physics': [35],
      'Mathematics': [40],
    },
    language_preference: 'RU',
  };

  const update = await request.put(`${API_BASE}/api/users/me`, {
    headers: { Authorization: `Bearer ${access_token}` },
    data: onboardingData,
  });
  if (!update.ok()) {
    const text = await update.text();
    throw new Error(`Onboarding failed: ${update.status()} ${text}`);
  }

  return { email, password, token: access_token };
}

export async function loginAsUser(page: Page, token: string) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate((t) => {
    localStorage.setItem('access_token', t);
    localStorage.setItem('token', t);
  }, token);
  await page.goto('/dashboard');
  await page.waitForURL(/\/dashboard(?!\/onboarding)/, { timeout: 15000 });
}

export async function installMockAuth(
  page: Page,
  options: {
    user?: Record<string, unknown>;
    billing?: Record<string, unknown>;
  } = {}
) {
  let user = { ...MOCK_ONBOARDED_USER, ...(options.user || {}) };
  const billing = { ...MOCK_FREE_BILLING, ...(options.billing || {}) };

  await page.route('**/api/users/me', async (route) => {
    const method = route.request().method().toUpperCase();
    if (method === 'PUT' || method === 'PATCH') {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(route.request().postData() || '{}');
      } catch {
        payload = {};
      }
      user = {
        ...user,
        ...payload,
        onboarding_completed:
          typeof payload.onboarding_completed === 'boolean'
            ? payload.onboarding_completed
            : Boolean(payload.chosen_subjects && payload.target_university_id && payload.weakest_subject),
      };
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(user),
    });
  });

  await page.route('**/api/billing/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(billing),
    });
  });

  await page.route('**/api/billing/checkout', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });
}

export async function loginAsMockUser(
  page: Page,
  options: {
    path?: string;
    lang?: 'ru' | 'kz';
    user?: Record<string, unknown>;
    billing?: Record<string, unknown>;
  } = {}
) {
  await installMockAuth(page, options);
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(
    ({ token, lang }) => {
      localStorage.setItem('access_token', token);
      localStorage.setItem('token', token);
      localStorage.setItem('samga_lang', lang);
      localStorage.removeItem('samga_chat_draft');
      sessionStorage.removeItem('samga_exam_data_v1');
      sessionStorage.removeItem('samga_exam_in_progress_v1');
    },
    { token: MOCK_TOKEN, lang: options.lang || 'ru' }
  );
  await page.goto(options.path || '/dashboard');
  await page.waitForURL(/\/dashboard(?!\/onboarding)/, { timeout: 15000 });
}

export async function loginUser(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
}

export async function logout(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => {
    try {
      localStorage.removeItem('access_token');
      localStorage.removeItem('token');
      localStorage.removeItem('samga_chat_draft');
      localStorage.removeItem('samga_lang');
    } catch {
      // ignore
    }
  });
}

export async function expectToast(page: Page, text: string | RegExp) {
  const toast = page.locator('[role="status"], .sonner-toast, [data-sonner-toast]').filter({ hasText: text }).first();
  await expect(toast).toBeVisible({ timeout: 10000 });
}

export async function measurePerformance(page: Page, action: () => Promise<void>, label: string) {
  const start = performance.now();
  await action();
  const end = performance.now();
  const duration = end - start;
  console.log(`[PERF] ${label}: ${duration.toFixed(2)}ms`);
  return duration;
}

export async function waitForStableState(page: Page, selector: string, timeout = 10000) {
  await page.waitForSelector(selector, { state: 'visible', timeout });
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return el && !el.querySelector('[aria-busy="true"], .loading, .skeleton');
    },
    selector,
    { timeout }
  );
}

export async function expectNoDocumentHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(0, doc.scrollWidth - doc.clientWidth);
  });
  expect(overflow).toBeLessThanOrEqual(1);
}
