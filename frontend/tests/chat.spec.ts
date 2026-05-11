import { test, expect, type Page } from '@playwright/test';
import { loginAsMockUser } from './helpers';

async function mockChat(page: Page, assistantText: string) {
  await page.route('**/api/chat/template-context', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });

  await page.route('**/api/chat/history**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ messages: [] }),
    });
  });

  await page.route('**/api/chat/threads', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 101 }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ threads: [], legacy_bucket_message_count: 0 }),
    });
  });

  // v4.12 (2026-05-06): force REST fallback. With
  // VITE_CHAT_AGENT_LOOP=true (the default in `frontend/.env.local`,
  // shipped since s24) the composer POSTs `/api/chat/stream` first
  // and only falls back to REST `/api/chat` on a non-transient
  // failure (`useSendMessage.ts` sendViaAgentStream → `if (!response.ok)
  // return false` → REST path). Unmocked, the stream call hit the
  // real backend and these tests either stalled or streamed random
  // LLM text instead of `assistantText`.
  //
  // We return 500 (non-transient per `isTransient5xx`: only
  // 502/503/504/520..524 are retried), which short-circuits the
  // retry loop and cleanly hands off to the existing REST mock
  // below. 500 is also classified as "fall back silently, no
  // retry pill" — so the test UI stays clean.
  //
  // Works equally well with VITE_CHAT_AGENT_LOOP unset/false: the
  // FE never hits /chat/stream in that mode so the route is a noop.
  await page.route('**/api/chat/stream', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'text/plain',
      body: 'forced REST fallback for chat.spec.ts',
    });
  });

  await page.route('**/api/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        message: assistantText,
        content: assistantText,
        rag_query_log_id: 1,
      }),
    });
  });

  await page.route('**/api/library/books', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 1, title: 'Математика 2 Оспанов', grade: 10, subject: 'Математика' }]),
    });
  });
}

test.describe('Chat frontend', () => {
  test('loads the authenticated chat interface', async ({ page }) => {
    await mockChat(page, 'Samga дайын.');
    await loginAsMockUser(page, { path: '/dashboard/chat' });

    await expect(page.getByRole('textbox')).toBeVisible({ timeout: 15000 });
    // v4.12 (2026-05-06): the send-button aria-label is produced by
    // `composerSendButtonAriaLabel({..., sendLabel: t("chat.send")})`
    // where `chat.send = {ru: "Отправить", kz: "Жіберу"}`
    // (`LanguageContext.tsx:535`). The composer also fills the
    // aria-label on the textarea itself via `chat.composer.label`
    // ("Поле для сообщения чата Samga" / "Samga чат хабарламасының
    // өрісі"). The old regex `/спросите|сұраңыз|chat/i` tried to
    // match the composer *placeholder* text, which was never the
    // accessible name of any button — the match came up 0 and
    // strict-mode violation happened elsewhere.
    //
    // On a freshly-mounted chat the textarea is empty, so the
    // button sits in `empty` state with label "Введите сообщение,
    // чтобы отправить" / "Жіберу үшін хабарлама теріңіз". On a
    // non-empty textarea it flips to "Отправить (Enter)" /
    // "Жіберу (Enter)". Both contain the substring "отправить" or
    // "жіберу" (case-insensitive), so a single permissive match
    // covers every state the mount might settle in — including the
    // lang='kz' path once we start reusing this helper for KZ
    // regression specs.
    //
    // Dedicated empty / over-limit / sending state coverage lives
    // in `composerSendButtonAria.test.ts` (vitest); this spec is
    // only responsible for "a send button exists and is findable
    // by role + accessible name".
    await expect(
      page
        .getByRole('button', { name: /отправить|жіберу/i })
        .first(),
    ).toBeVisible();
  });

  test('suppresses citation chips for a regular response', async ({ page }) => {
    await mockChat(page, 'Қысқа жоспар:\n\n1. Тақырыпты қайталау.\n2. Есеп шығару.\n\n📚 *Source: Математика 2 Оспанов, Page 41*');
    await loginAsMockUser(page, { path: '/dashboard/chat' });

    const input = page.getByRole('textbox');
    await input.fill('Привет, составь короткий план по математике');
    await input.press('Enter');

    await expect(page.locator('text=Қысқа жоспар')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('main')).not.toContainText(/Математика 2 Оспанов|p\. 41|Source:/i);
  });

  test('promotes citation chips when the user asks for a source', async ({ page }) => {
    await mockChat(page, 'Мына дереккөзге сүйенемін.\n\n📚 *Source: Математика 2 Оспанов, Page 41*');
    await loginAsMockUser(page, { path: '/dashboard/chat' });

    const input = page.getByRole('textbox');
    await input.fill('Дай источник и страницу по этой теме');
    await input.press('Enter');

    await expect(page.locator('text=Мына дереккөзге сүйенемін.')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('main')).toContainText(/Математика 2 Оспанов/);
    await expect(page.locator('main')).toContainText(/p\. 41/);
  });
});
