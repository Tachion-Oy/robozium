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
        git \
        grep \
        libglib2.0-bin \
        libreoffice \
        openssh-client \
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

ARG ROBOZIUM_DESKTOP_BUILD_ID=manual
LABEL fi.tachion.robozium.desktop.build=$ROBOZIUM_DESKTOP_BUILD_ID

USER robozium
ENV ROBOZIUM_DESKTOP_API_PORT=18001
EXPOSE 18001
HEALTHCHECK --interval=5s --timeout=3s --start-period=180s --retries=12 \
    CMD ["python", "-c", "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.environ['ROBOZIUM_DESKTOP_API_PORT']+'/ready', timeout=2).read()"]
CMD ["sh", "-c", "exec uvicorn \"robozium.api.app:${ROBOZIUM_MODE:-live}_app\" --factory --host 127.0.0.1 --port \"$ROBOZIUM_DESKTOP_API_PORT\" --workers 1"]
