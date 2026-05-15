# OpenSamga

OpenSamga is an MIT-licensed UNT / ҰБТ preparation platform for
Kazakhstani high-school students. It combines a React web client,
FastAPI backend, PostgreSQL + pgvector retrieval, an AI tutor agent,
practice-bank workflows, and university / grant-planning tools.

This repository includes the application code plus a compact seed dataset
so a fresh local install can exercise the main product flows without
starting from an empty database.

## What Is Included

| Area | What it does | Main paths |
|---|---|---|
| Web app | Student-facing React interface, auth screens, dashboard, chat, exams, practice, library, strategy tools | `frontend/src/app/` |
| API | FastAPI app, routers, auth, quotas, billing hooks, admin/data endpoints | `backend/app/` |
| AI tutor | Function-calling chat loop, tool registry, provider failover, OCR helpers, prompt and response shaping | `backend/app/services/chat/` |
| Retrieval | pgvector-backed textbook search, citation handling, RAG query logging | `backend/app/services/ai_orchestrator.py`, `backend/app/services/library_retrieval.py` |
| Practice | Mock questions, weak-topic mode, mistake review, exam attempts, scoring utilities | `backend/app/routers/practice.py`, `backend/app/routers/exams.py`, `backend/app/services/gap_analyzer.py` |
| University strategy | Major matching, grant-probability helpers, retake-guide parsing, profile-based planning | `backend/app/routers/strategy.py`, `backend/app/services/strategy_service.py` |
| Database | SQLAlchemy models and Alembic migrations for the public schema | `backend/app/models.py`, `backend/alembic/` |
| Seed data | Exam questions, universities, grant thresholds, major groups, knowledge graphs, min-score references | `database/`, `backend/data/` |
| Tests | Backend pytest suites, frontend Vitest tests, public Playwright smoke/a11y/RAG-eval surfaces | `backend/tests/`, `frontend/src/**/__tests__/`, `frontend/tests/` |

## Included Data

The public seed set is intentionally small enough to keep in git while
still making the app usable after setup:

- 297 file-backed bilingual exam questions across 15 subject files in
  `database/`, expanded by built-in backfill rows to 442 seeded exam
  questions.
- 684 exact-answer `mock_questions` rows derived from the seed exam set
  for the chat/practice-bank path.
- 107 university-detail records in `database/university_details.json`.
- 4,098 acceptance-score rows in `database/acceptance_scores.json`.
- 6,216 historical grant-threshold rows in
  `database/historical_grant_thresholds.json`.
- 1,915 university/program rows in `database/university_data.json`.
- 127 major-group records in `database/major_groups.json`.
- Math, chemistry, and physics knowledge graphs in `backend/data/`.
- 1,021 university/program min-score references in
  `backend/data/univision_min_scores_2025.json`.
- A small opportunities CSV in `backend/data/sample_opportunities.csv`.

These files are enough to seed the exam engine, university picker,
strategy surfaces, and local knowledge-graph helpers.

## What Is Not Included

The repository still excludes data that should not be committed directly:

- Raw textbook PDFs and scanned book assets.
- Full production database dumps.
- Runtime uploads, caches, generated embeddings, logs, and local `.env`
  files.
- Any deployment-specific secrets or credentials.

The scraper and ingestion scripts remain available under
`backend/scripts/` for teams that want to build a larger corpus from
their own licensed or public-domain sources.

## Tech Stack

| Layer | Stack |
|---|---|
| Backend | FastAPI, SQLAlchemy 2 async, asyncpg, Alembic, pgvector |
| Frontend | React 18, Vite 6, TypeScript, Tailwind, Radix UI |
| Database | PostgreSQL 16+ with `vector` extension |
| AI providers | OpenAI-compatible APIs, DashScope/Qwen, Moonshot/Kimi, MiniMax failover hooks |
| Testing | pytest, Vitest, Testing Library, Playwright, axe-core |

## Local Setup

### Prerequisites

- Python 3.11+
- Node.js 20+
- PostgreSQL 16+
- `pgvector` installed in the target database:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate      # Windows
# source .venv/bin/activate # macOS/Linux
pip install -r requirements.txt
cp .env.docker.example .env
alembic upgrade head
python scripts/seed_questions.py --commit
python scripts/seed_universities.py --commit
uvicorn app.main:app --reload --port 8001
```

Fill `.env` before starting the server. At minimum you need
`DATABASE_URL`, `SECRET_KEY`, and whichever AI-provider keys you want to
use.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server runs on `http://localhost:5174` and proxies `/api`
to the backend on `http://localhost:8001`.

## Configuration

The canonical backend template is
[`backend/.env.docker.example`](backend/.env.docker.example). Important
settings include:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Async SQLAlchemy database URL, for example `postgresql+asyncpg://user:pass@localhost:5432/opensamga` |
| `SECRET_KEY` | JWT signing key. Must be changed outside local development. |
| `OPENAI_API_KEY` | OpenAI-compatible fallback for chat/OCR/provider failover |
| `OPENAI_BASE_URL` | Optional OpenAI-compatible endpoint override |
| `OPENAI_MODEL` | Default chat model name |
| `DASHSCOPE_API_KEY` | Qwen/DashScope provider key |
| `KIMI_KEY` | Moonshot/Kimi provider key |
| `MINIMAX_API_KEY` | Optional MiniMax provider key |
| `EMBEDDING_API_KEY` | Embedding provider key |
| `ALLOWED_ORIGINS` | JSON or comma-separated list of allowed frontend origins |
| `ALLOWED_HOSTS` | JSON or comma-separated list of allowed hosts |
| `BILLING_WEBHOOK_SECRET` | HMAC secret for billing webhook verification |
| `RAG_ADMIN_EMAILS` | Comma-separated admin allowlist for RAG/data dashboards |
| `RATE_LIMIT_ENABLED` | Enables SlowAPI route limits when set for deployed environments |

The backend validates production settings at startup and rejects unsafe
defaults such as the development JWT secret.

## Database Notes

Fresh public deployments should use Alembic:

```bash
cd backend
alembic upgrade head
python scripts/seed_questions.py --commit
python scripts/seed_universities.py --commit
```

The public migrations include compatibility bootstrap logic for a new
empty database, including `pgvector` support and raw RAG helper tables
that are not represented as SQLAlchemy models.

`seed_questions.py` loads `database/<subject>.json` into
`exam_questions`. `seed_universities.py` loads university details, major
groups, acceptance scores, historical grant thresholds, and
university/program rows from the same `database/` directory.

For local integration tests, set `TEST_DATABASE_URL` to a disposable
PostgreSQL database with `vector` enabled.

## Tests

Backend:

```bash
cd backend
ruff check .
ruff format --check .
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

## Repository Boundaries

This public tree is intentionally smaller than the deployed product. The
following are not part of this repository:

- Raw scanned textbook assets and generated OCR outputs.
- Private telemetry console implementation.
- Internal planning, investor, and operating documents.
- Private Playwright suites for hosted-product-only flows.
- Deployment-specific secrets, environment files, and production data.

The remaining code is intended to be useful for study, self-hosting,
forking, and building adjacent UNT / ҰБТ education tools.

## Security

Do not commit `.env` files, API keys, private datasets, or production
credentials. See [`SECURITY.md`](SECURITY.md) for vulnerability-reporting
guidance.

## License And Branding

Code in this repository is released under the MIT license. See
[`LICENSE`](LICENSE).

The Samga.ai name, logo, and hosted-service branding are not included in
the MIT grant. Forks and deployments should use their own branding.
