# Samga.ai — Web Client

Vite + React + TypeScript frontend for the Samga.ai platform.

> Proprietary commercial software. See [`../LICENSE`](../LICENSE).

## Local development

```bash
npm install
npm run dev    # Vite dev server on http://localhost:5174 (proxies /api → backend on :8001)
npm run build  # production build → dist/
npm test       # vitest, headless
```

## Layout

- `src/app/` — application code (routes, components, hooks, lib).
- `src/test/` — vitest setup.
- `tests/` — Playwright + a11y + visual + RAG-eval test suites.
- `vite.config.ts` / `vitest.config.ts` — build and test config.

Auth, environment variables, and protected fixtures are not in this repo.
