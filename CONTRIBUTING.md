# Contributing

This is an unmaintained MIT-licensed snapshot. The original author is
not actively reviewing contributions.

If you want to build on top of it, the healthiest path is to **fork**
and own your fork. Pull requests against this upstream may sit open
indefinitely.

## If you do open a PR

- Describe the observable behavior change and the scope.
- Keep the diff small. No "while we're at it" sweeps.
- Don't commit secrets, API keys, or `.env` files.
- Don't commit scraped third-party content.
- Run the test suites before pushing:
  - `cd backend && pytest`
  - `cd frontend && npm test -- --run`
  - `cd frontend && npm run lint && npm run typecheck`

## Code style

Existing patterns:

- **Frontend**: PascalCase components, camelCase hooks (`useFoo`),
  one component per file, tests colocated in `__tests__/`.
- **Backend**: snake_case modules, async FastAPI handlers, Pydantic
  schemas for request/response, service modules own business logic,
  routers own HTTP.
- **Migrations**: Alembic, one revision per logical change, never
  edit a shipped migration.

## Licence

By submitting a PR you agree your contribution is MIT-licensed under
the project's [LICENSE](LICENSE).
