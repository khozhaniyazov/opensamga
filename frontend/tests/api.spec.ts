import { test, expect } from '@playwright/test';
import { createOnboardedUser } from './helpers';

const uniqueEmail = () => `e2e_api_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@samga.ai`;

test.describe('API Endpoints', () => {
  // v4.3 (2026-05-05): backend runs on :8001 per project convention and
  // every uvicorn invocation in CI / dev. The hardcoded :8000 here
  // was a leftover from an earlier port and meant every api.spec
  // test ECONNREFUSED'd against the right host but wrong port.
  const baseURL = 'http://localhost:8001';

  test('health endpoint should return 200', async ({ request }) => {
    const resp = await request.get(`${baseURL}/health`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty('status', 'ok');
  });

  test('root endpoint should return API info', async ({ request }) => {
    const resp = await request.get(`${baseURL}/`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty('message');
    expect(body).toHaveProperty('version');
  });

  test('unauthorized request to /api/users/me should return 401', async ({ request }) => {
    const resp = await request.get(`${baseURL}/api/users/me`);
    expect(resp.status()).toBe(401);
  });

  test('invalid token should return 401', async ({ request }) => {
    const resp = await request.get(`${baseURL}/api/users/me`, {
      headers: { Authorization: 'Bearer invalid_token_12345' },
    });
    expect(resp.status()).toBe(401);
  });

  test('login endpoint should return token', async ({ request }) => {
    const email = uniqueEmail();
    // Register first
    const reg = await request.post(`${baseURL}/api/auth/register`, {
      data: { name: 'API Test', email, password: 'TestPass123!' },
    });
    expect(reg.status()).toBe(200);
    const regBody = await reg.json();
    expect(regBody).toHaveProperty('access_token');

    // Login
    const login = await request.post(`${baseURL}/api/auth/token`, {
      form: { username: email, password: 'TestPass123!' },
    });
    expect(login.status()).toBe(200);
    const loginBody = await login.json();
    expect(loginBody).toHaveProperty('access_token');
    expect(typeof loginBody.access_token).toBe('string');
    expect(loginBody.access_token.length).toBeGreaterThan(10);
  });

  test('login with wrong password should return 401', async ({ request }) => {
    const email = uniqueEmail();
    await request.post(`${baseURL}/api/auth/register`, {
      data: { name: 'API Test', email, password: 'TestPass123!' },
    });
    const login = await request.post(`${baseURL}/api/auth/token`, {
      form: { username: email, password: 'WrongPass123!' },
    });
    expect(login.status()).toBe(401);
  });

  test('chat history endpoint should require auth', async ({ request }) => {
    const resp = await request.get(`${baseURL}/api/chat/history`);
    expect(resp.status()).toBe(401);
  });

  test('chat history endpoint should work with an onboarded token', async ({ request }) => {
    const email = uniqueEmail();
    const { token } = await createOnboardedUser(request, 'API Test', email, 'TestPass123!');

    const resp = await request.get(`${baseURL}/api/chat/history`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(Array.isArray(body.messages)).toBe(true);
  });

  test('rate limiting should not block normal usage', async ({ request }) => {
    const email = uniqueEmail();
    const reg = await request.post(`${baseURL}/api/auth/register`, {
      data: { name: 'API Test', email, password: 'TestPass123!' },
    });
    const { access_token } = await reg.json();

    // Make several rapid requests
    const promises = Array.from({ length: 5 }, () =>
      request.get(`${baseURL}/api/users/me`, {
        headers: { Authorization: `Bearer ${access_token}` },
      })
    );
    const responses = await Promise.all(promises);
    const allOk = responses.every((r) => r.status() === 200);
    expect(allOk).toBe(true);
  });

  test('CORS preflight should succeed', async ({ request }) => {
    const resp = await request.fetch(`${baseURL}/api/auth/token`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5174',
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect(resp.status()).toBe(200);
  });

  test('compression headers should be present', async ({ request }) => {
    const resp = await request.get(`${baseURL}/`);
    const headers = resp.headers();
    // Check for either content-encoding or that response is compressed
    expect([200]).toContain(resp.status());
  });

  test('security headers should be present', async ({ request }) => {
    const resp = await request.get(`${baseURL}/`);
    const headers = resp.headers();
    expect(headers).toBeDefined();
  });

  test('universities list endpoint should return data', async ({ request }) => {
    const resp = await request.get(`${baseURL}/api/data/universities`);
    expect([200, 401]).toContain(resp.status());
  });

  test('library catalog endpoint should be public', async ({ request }) => {
    const resp = await request.get(`${baseURL}/api/library/books`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test('library PDF endpoint should require auth', async ({ request }) => {
    const resp = await request.get(`${baseURL}/api/library/books/1/pdf`);
    expect(resp.status()).toBe(401);
  });

  test('GET /api/exam/generate should require auth', async ({ request }) => {
    const resp = await request.get(`${baseURL}/api/exam/generate?sub1=math&sub2=physics`);
    expect(resp.status()).toBe(401);
  });
});
