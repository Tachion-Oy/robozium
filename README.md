# RoboSprawl

A runnable project-agent application built on Roboz, with a FastAPI backend, streaming Next.js terminal UI, and persistent Librarian memory.

## Prerequisites and installation

Use Linux with Bash, `setsid`, curl, uv (0.6.14 or newer), Node.js 22, npm, and the read commands `grep`, `rg`, `pwd`, `cat`, `head`, `tail`, `find`, `ls`, `wc`, and `diff`. Python 3.13+ is required; uv downloads it into this checkout if needed. Playwright needs its usual Linux browser libraries already installed; installation scripts do not change system packages.

Place Roboz at `../roboz`, pinned to `f148023af667dc58c842d11f5a93843c2b0f1a8e` for the verified dependency contract. RoboSprawl never modifies that checkout. From the RoboSprawl directory:

```bash
./scripts/install.sh
./scripts/dev.sh
```

Open http://127.0.0.1:3000. The default launch runs the deterministic mock agent without credentials or a `.env` file. Create a project, reply twice, inspect its specialist, and follow its generated file link. The mock uses real Roboz events, conversation logs, cancellation, snapshots, and memory. The decorative landing terminal is sample content.

## Real models

```bash
cp .env.example .env
# Set OPENROUTER_API_KEY and, optionally, CEREBRAS_API_KEY in .env.
./scripts/dev.sh --live
```

The model selector retains GLM-5.3, GLM-5.3 Flash (OpenRouter), and GPT-OSS-120B (Cerebras). Endpoint URLs, context limits, and request options are application policy in `src/robosprawl/deployment.py`; credentials stay in the environment. OpenRouter is also required by the Librarian even when Cerebras is selected for the root agent. The dependency panel reports missing credentials or unavailable routes. Readiness means the application is initialized; provider health is reported independently. Model availability may depend on your provider account.

Live capabilities are interaction, guarded file reading, literal patch editing, automatic context compaction, and Librarian memory. Reads stay within the configured sandbox; the current project is writable, shared workspace writes prompt, and other locations are denied. These are application tool guards, not an OS sandbox. Live transcription returns a clear HTTP 503; mock transcription remains testable. See [deferred dependency work](docs/deferred-dependency-changes.md) for omitted integrations.

Both launch modes use `fastapi dev`, showing the FastAPI startup banner, API documentation URL, and server logs in the terminal. Backend source changes reload automatically.

The launcher waits up to 60 seconds for API readiness and stops both process groups when either service exits or Ctrl+C is pressed. Ports 8000 and 3000 must be free.

## Data and isolation

`hub.config.json` is generic and ready to use; `hub.config.json.example` documents the same layout. Runtime data defaults to `.runtime/data` and technical logs to `.runtime/logs`. Each project owns `conversation_logs`, `conversation_snapshots`, and `persistent_memory`. Configuration lookup checks the current directory and its parents before the application checkout.

The scripts source `scripts/env.sh`, keeping environments, Python bytecode, uv/npm caches, downloaded browsers, and temporary workspaces inside `.artifacts`, `.venv`, or `web`. Next.js build output and browser reports also remain inside this checkout. These generated directories are gitignored. Before running tools directly, use:

```bash
source scripts/env.sh
```

Do not point runtime configuration or artifact overrides outside this checkout when preserving port isolation. `.env` and runtime data are never tracked. The existing Git repository and Apache-2.0 license are preserved.

## Verification

```bash
./scripts/test.sh             # Python, frontend, lint, Chromium and Firefox
./scripts/verify-wheels.sh    # stage sources locally, build/install wheels, smoke test
# Advisory browser coverage:
bash scripts/e2e/run-mock-playwright.sh --project=webkit
```

E2E runs create their own local sandbox and remove it after coordinated shutdown. They cover creation/resumption, replies, streaming, agent views, model selection, file links, cancel/delete, error recovery, and Librarian snapshots/memory. Set `ROBOSPRAWL_E2E_API_PORT` and `ROBOSPRAWL_E2E_WEB_PORT` if the default test ports 8000 and 3100 are occupied. Run browsers sequentially because they share the frontend build directory.

For a paced stream demonstration, source `scripts/env.sh` and run `uv run uvicorn robosprawl.api.app:stream_sync_mock_app --factory`; its temporary data stays inside the checkout.

Visual baselines live under `web/e2e/visual-regression.spec.ts-snapshots`. Update them intentionally with `--project=chromium --update-snapshots`, then review the images. [Verification notes](docs/verification.md) record the port's results and visual review. Credential-backed live inference is reported separately from automated configuration tests.

CI pins the Roboz commit and downloads it under `.artifacts/dependencies/roboz`; it rewrites only the CI checkout's three source paths and matching lockfile locations. Chromium and Firefox are required gates; WebKit is advisory. Build inputs, wheels, browsers, caches, and reports stay inside the checkout.

## Future PyPI installation

The project declares versioned dependencies on `roboz`, `roboz-shed`, and `roboz-openai`, with exactly three local source overrides in `pyproject.toml`. Once the desired versions are published, remove `[tool.uv.sources]`, refresh `uv.lock` with `uv lock`, and run the full checks again. No import or application namespace changes are needed. `verify-wheels.sh` specifically verifies today's local dependency sources; replace its staging step when switching to registry-only installation.
