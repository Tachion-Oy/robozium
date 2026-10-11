# syntax=docker/dockerfile:1.7

FROM python:3.13-slim-bookworm AS python-deps

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never
WORKDIR /app

RUN python -m pip install --no-cache-dir uv==0.12.10
COPY pyproject.toml uv.lock README.md LICENSE CHANGELOG.md hub.config.py ./
COPY src ./src
RUN uv sync --locked --no-dev --no-editable


FROM python:3.13-slim-bookworm AS api

ENV PATH=/app/.venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ROBOZIUM_CONFIG=/app/hub.config.py
WORKDIR /app

RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        ca-certificates \
        coreutils \
        diffutils \
        findutils \
        grep \
        libglib2.0-bin \
        libreoffice \
        ripgrep \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 robozium \
    && useradd --uid 10001 --gid robozium --no-create-home --home-dir /nonexistent robozium \
    && mkdir -p /hub /logs \
    && chown -R robozium:robozium /hub /logs

# The API UID may be overridden for bind-mount permissions; keep LO's profile writable.
ENV HOME=/tmp \
    UserInstallation=file:///tmp/robozium-libreoffice

COPY --from=python-deps /app/.venv /app/.venv
COPY --from=python-deps /usr/local/bin/uv /usr/local/bin/uv
COPY hub.config.py ./hub.config.py

USER robozium
EXPOSE 8000
HEALTHCHECK --interval=5s --timeout=3s --start-period=180s --retries=12 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/ready', timeout=2).read()"]
CMD ["sh", "-c", "exec uvicorn \"robozium.api.app:${ROBOZIUM_MODE:-mock}_app\" --factory --host 127.0.0.1 --port 8000 --workers 1"]


FROM node:25-bookworm-slim AS web-builder

WORKDIR /app
COPY web/package.json web/package-lock.json ./web/
RUN npm --prefix web ci
COPY hub.config.py ./
COPY web ./web
ENV NEXT_TELEMETRY_DISABLED=1 \
    ROBOZIUM_API_BASE_URL=http://api:8000
RUN npm --prefix web run build


FROM node:25-bookworm-slim AS web

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=127.0.0.1 \
    PORT=6969
WORKDIR /app

RUN groupadd --gid 10001 robozium \
    && useradd --uid 10001 --gid robozium --no-create-home --home-dir /nonexistent robozium

COPY --from=web-builder --chown=robozium:robozium /app/web/.next/standalone ./
COPY --from=web-builder --chown=robozium:robozium /app/web/.next/static ./.next/static
COPY --from=web-builder --chown=robozium:robozium /app/web/public ./public

USER robozium
EXPOSE 6969
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=12 \
    CMD ["node", "-e", "(async()=>{try{const r=await fetch('http://127.0.0.1:'+process.env.PORT+'/api/health');if(!r.ok)throw Error(r.status)}catch(e){console.error(e);process.exit(1)}})()"]
CMD ["node", "server.js"]


# Keep this version aligned with Playwright in web/package-lock.json.
FROM mcr.microsoft.com/playwright:v1.64.0-noble@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f AS verify

WORKDIR /tests
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY tests/container ./container
COPY web/playwright.container.config.ts ./playwright.config.ts
CMD ["npx", "playwright", "test"]
