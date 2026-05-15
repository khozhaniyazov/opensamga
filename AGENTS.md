# OpenSamga Agent Notes

These notes apply to the whole repository. They are written for AI coding
agents and automation tools that need quick project context before editing.

## Project

OpenSamga is an MIT-licensed UNT / UBT preparation platform for
Kazakhstani high-school students. The app includes a React frontend,
FastAPI backend, PostgreSQL + pgvector storage, seed exam/university data,
an AI tutor flow, practice tooling, and university/grant strategy features.

The repository is a public open-source codebase. Keep it self-contained,
usable, and free of private deployment details.

## Repository Layout

- `backend/` - FastAPI app, SQLAlchemy models, Alembic migrations,
  services, scripts, backend tests.
- `frontend/` - Vite + React + TypeScript client, Vitest tests, public
  Playwright smoke/a11y/RAG-eval suites.
- `database/` - public seed JSON for exam questions, universities, majors,
  acceptance scores, and grant thresholds.
- `backend/data/` - public reference data such as knowledge graphs,
  min-score snapshots, and sample opportunities.
- `.github/workflows/` - CI, backend, Playwright, accessibility, and
  security workflows.

## Public Data Boundary

It is acceptable to edit or extend the public seed/reference data already
tracked under `database/` and `backend/data/`.

Do not commit:

- `.env` files or production secrets.
- API keys, JWT secrets, billing webhook secrets, tokens, or credentials.
- Raw textbook PDFs, scanned books, uploads, caches, or generated OCR output.
- Full private database dumps.
- Personal attribution, personal emails, or individual credits unless a
  maintainer explicitly asks for them.

When adding data, prefer compact JSON/CSV seed files with clear schema fit.
Avoid large binary assets and scraped bulk corpora unless their redistribution
rights are clear.

## Setup

Backend:

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
cp .env.docker.example .env
alembic upgrade head
python scripts/seed_questions.py --commit
python scripts/seed_universities.py --commit
uvicorn app.main:app --reload --port 8001
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Vite runs on `http://localhost:5174` and proxies `/api` to
`http://localhost:8001`.

## Verification Commands

Backend:

```bash
cd backend
ruff check .
ruff format --check .
pytest --collect-only -q
pytest
pytest -m integration
```

Frontend:

```bash
cd frontend
npm run typecheck
npm run typecheck:test
npm run lint
npm test -- --run
npm run build
```

Public browser checks:

```bash
cd frontend
npx playwright test --config tests/smoke/playwright.config.ts
npx playwright test --config tests/a11y/a11y.config.ts --grep "public"
```

For fresh database verification, use PostgreSQL 16 with `pgvector` enabled:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## Coding Conventions

- Follow existing backend patterns: async FastAPI handlers, SQLAlchemy 2
  async sessions, Pydantic schemas, service-layer business logic.
- Follow existing frontend patterns: React 18, TypeScript, Tailwind,
  component files under `frontend/src/app/`, tests near the code when
  practical.
- Keep changes scoped. Do not introduce new frameworks or broad refactors
  without a concrete need.
- Use structured parsers for JSON/CSV/YAML instead of ad hoc string edits.
- Preserve bilingual RU/KZ behavior where relevant.

## Product Boundaries

- Keep the public README and setup instructions accurate after changes.
- Keep the app runnable with the tracked seed data.
- Do not rely on untracked private datasets for default flows.
- The Samga.ai hosted-service name, logo, and production branding are not
  part of the MIT grant. Forks and deployments should use their own branding.

## CI Expectations

Before treating a change as ready, run the smallest relevant local checks.
For data/setup changes, at minimum dry-run the seed scripts and validate JSON.
For frontend-visible changes, run build or the relevant test suite. For backend
behavior changes, run ruff and targeted pytest, then broaden if the blast
radius is larger.

