FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev curl \
    # v3.27 (2026-05-01): WeasyPrint stack for the parent-report PDF
    # rendering path (Issue #15 AC#5). Pango handles text shaping,
    # Cairo handles drawing, gdk-pixbuf decodes raster images,
    # fontconfig resolves font names, and fonts-noto* gives us full
    # Cyrillic + Kazakh diacritic coverage.
    libpango-1.0-0 libpangoft2-1.0-0 libcairo2 libgdk-pixbuf-2.0-0 \
    libharfbuzz-subset0 libffi-dev shared-mime-info fontconfig \
    fonts-noto-core fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# Build context is `./backend` (see docker-compose.yml), so COPY paths
# are relative to that, NOT to the repo root. Session 16 (2026-04-21)
# fix — old paths `backend/requirements.txt` never resolved under this
# context, meaning this image had never built cleanly.
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY . /app/
RUN mkdir -p /app/uploads

# Run migrations then start server.
# Port 8001 matches README + vite.config.ts + nginx_frontend.conf upstream.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8001"]

# Container-level healthcheck — hits the /health shim (s15).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS http://localhost:8001/health || exit 1

EXPOSE 8001
