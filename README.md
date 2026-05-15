# opensamga

> UNT / ҰБТ preparation platform for Kazakhstani high-school students.
> Grounded AI tutor, verified practice bank, university & grant strategy.
> Released MIT. No active maintainer.

This is the open-source snapshot of **Samga.ai** — an exam-prep stack
originally built as a private commercial product for 10–11 grade
students in Kazakhstan preparing for the ЕНТ (RU) / ҰБТ (KZ)
university-entrance exam. The code is now MIT-licensed so anyone can
self-host it, fork it, study it, or build on top of it.

## Status

- **License:** MIT (see [`LICENSE`](LICENSE)).
- **Maintenance:** none. The original author is no longer actively
  shipping. Issues and pull requests may or may not be reviewed.
- **Origin:** lifted from a private monorepo at a specific
  point in time. CHANGELOG / git history are not preserved here; this
  is a single-commit snapshot.
- **Datasets:** the proprietary scraped question banks, library PDFs,
  and university-data JSONs are **not** shipped. You'll need to bring
  your own data to make the end-to-end product work. See
  ["Data you'll have to bring yourself"](#data-youll-have-to-bring-yourself).

## What's in the box

| Layer | Stack | Path |
|---|---|---|
| Backend | FastAPI · SQLAlchemy 2 async · asyncpg · pgvector · Alembic | `backend/` |
| Frontend | React 18 · Vite 6 · TypeScript · Tailwind · Radix UI | `frontend/` |
| AI | OpenAI / Qwen (DashScope) / Moonshot (Kimi) — function-calling agent loop | `backend/app/services/chat/` |
| Auth | JWT access + refresh, bcrypt, admin-gated routes | `backend/app/routers/auth.py` |
| Retrieval | pgvector + embedding pipeline + citation guard | `backend/app/services/ai_orchestrator.py` |
| Observability | Python logging with structured fields; per-provider HTTP client registry | `backend/app/logging_config.py` |
| Tests | pytest (backend) · vitest (frontend) · Playwright + axe (E2E / a11y) | `backend/tests/`, `frontend/src/**/__tests__/`, `frontend/tests/` |

## Local dev quick start

Both stacks share one PostgreSQL database with the pgvector extension.

### Prerequisites

- Python 3.11+ (CI is pinned to 3.11; 3.12 also works)
- Node.js 20+ (pinned via `.nvmrc`)
- PostgreSQL 16+ with the `pgvector` extension installed
  (`CREATE EXTENSION vector;`)

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate      # or `source .venv/bin/activate`
pip install -r requirements.txt
cp .env.docker.example .env  # fill in OPENAI_API_KEY etc.
alembic upgrade head
uvicorn app.main:app --reload --port 8001
```

> Note: `requirements.txt` covers the runtime; for tests install
> `pytest pytest-asyncio pytest-cov` separately (matches CI).

### Frontend

```bash
cd frontend
npm install
npm run dev                 # Vite on :5174, proxies /api → :8001
```

### Tests

```bash
cd backend  && pytest
cd frontend && npm test -- --run      # vitest
cd frontend && npx playwright test    # E2E (needs backend + frontend running)
```

## Configuration

Secrets are **never** hardcoded. Everything that needs a key reads it
from `os.environ`. The canonical template is
[`backend/.env.docker.example`](backend/.env.docker.example). Notable
variables:

| Variable | What for |
|---|---|
| `OPENAI_API_KEY` | Fallback chat / OCR (chat.py, convert_scanned_book.py, openai_failover.py) |
| `OPENAI_BASE_URL` | Optional; defaults to DashScope's OpenAI-compatible endpoint. Set to `https://api.openai.com/v1` if you want to use a real OpenAI key. |
| `OPENAI_MODEL` | Defaults to `qwen-max` (DashScope). Switch to `gpt-4o-mini` etc. when pointing at OpenAI. |
| `DASHSCOPE_API_KEY` | Qwen / Alibaba chat backend (used by OCR + reranker) |
| `EMBEDDING_API_KEY` / `EMBEDDING_BASE_URL` | Optional override for the embedding provider; defaults to DashScope. |
| `MINIMAX_API_KEY` / `MINIMAX_BASE_URL` | Optional MiniMax backend used by the failover chain. |
| `DATABASE_URL` | `postgresql+asyncpg://user:pass@host:5432/db` |
| `SECRET_KEY` | JWT signing — **must** be set in production |
| `ALLOWED_ORIGINS` / `ALLOWED_HOSTS` | Comma-separated. CORS rejects `*` in production. |
| `BILLING_WEBHOOK_SECRET` | HMAC for billing provider webhooks |
| `TESTING_KZ_SCHEDULE_URL` | Optional override for the retake-schedule scraper target |
| `RAG_ADMIN_EMAILS` | Comma-separated allowlist for the admin / data-confidence dashboard. |

The backend refuses to start in `ENVIRONMENT=production` if the
default dev secret is still in place — see `validate_settings()` in
`backend/app/config.py`.

## Architecture at a glance

```
frontend/ (Vite dev server :5174)
    │  /api/*  (proxied)
    ▼
backend/  (uvicorn :8001)
    │
    ├── routers/              HTTP surface (FastAPI)
    ├── services/             business logic
    │   ├── chat/             agent loop, tool registry, prompts
    │   ├── ai_orchestrator   RAG + citation guard
    │   ├── gap_analyzer      weak-topic / practice clustering
    │   ├── strategy_service  university / grant planning
    │   └── retake_guide      NCT schedule fetcher + parser
    ├── dependencies/         FastAPI dependencies (auth, quotas)
    ├── migrations/           Alembic revisions
    └── utils/                logging, HTTP client registry, crypto
```

The AI layer is a **function-calling agent loop** (not a LangChain
wrapper). The model is given a registry of tools (`consult_library`,
`get_dream_university_progress`, `get_weak_topics`, …), the loop calls
them, persists the call/result parts into the conversation, and
streams the final text back to the browser via SSE.

## Data you'll have to bring yourself

The private product shipped with a curated dataset of:

- ~15,000 UNT practice questions (RU + KZ) sourced from third-party
  providers — **not included** for copyright reasons.
- Per-subject textbook PDFs with OCR-extracted Markdown — not
  included.
- A curated list of Kazakhstani universities, majors, cut-off scores,
  and grant data — **not included**.

To run the full product you'll need to populate:

- `mock_questions` (see `backend/app/models.py`)
- `library_books` / `library_chunks`
- `universities` / `grants_2024` / `major_groups`
- pgvector embeddings for chunks + questions

The ingestion scripts under `backend/scripts/` (`ingest_sdamgia.py`,
`ingest_egovreader.py`, `synthesize_mock_questions.py`,
`qwen_ingest.py`, …) are preserved as examples of how the original
pipeline worked. They assume files under an `UNT_DATASET_RAW` /
`UNT_DATASET_CONVERTED` path (env-driven).

## What was deliberately dropped from this public snapshot

The public tree is a **curated subset** of the private monorepo. The
following surfaces were removed before release and do not appear in
git history on this repo:

- Internal planning docs, investor docs, `CHANGELOG.md` (300+ tagged
  ships), session memos, and the agent working notes.
- A private telemetry console module (`app/services/telemetry_console/`).
  The main application keeps no-op stubs; if you want telemetry, wire
  your own OTel / Sentry client into the places that check
  `TELEMETRY_AVAILABLE`.
- Scraped question banks (`database/` RU/KZ JSONs) and scanned library
  content (`library/` textbook PDFs + scrapers). If you need the full
  dataset for research or non-commercial use, email
  [saparbayevskii@gmail.com](mailto:saparbayevskii@gmail.com).
- Per-session contract-pin tests tied to internal workflow
  (`test_v342_*`, `test_v343_*`, `test_v357_*`, `test_v440_*`,
  `test_v460_*`). The general-purpose tests (auth, chat, billing,
  gap-analyzer, retake-guide, strategy, universities, etc.) are
  preserved.
- Private Playwright suite (`e2e-tests/`). The public Playwright
  surface under `frontend/tests/` is kept.

## Contributing

This is a released-as-is snapshot with no active maintainer. If you
fork and improve something, that's great — you own your fork under
MIT. Upstream PRs may sit unreviewed indefinitely.

If you want to report a security issue, see [`SECURITY.md`](SECURITY.md).

## Trademark

"Samga" and the Samga.ai wordmark are not part of this MIT grant. If
you fork and deploy, please rename and use your own branding.

## Credits

Built by Zhanserik Khozhaniyazov between 2025 and 2026 as a private
commercial product, released MIT in 2026.

---

**Disclaimer:** this code was written for a specific deployment
targeting Kazakhstani high-school students. It contains Russian and
Kazakh copy throughout the UI and system prompts. English UI strings
exist but coverage varies.
