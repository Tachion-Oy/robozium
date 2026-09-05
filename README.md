# RoboSprawl

A runnable project-agent application built on Roboz, with a FastAPI backend, streaming Next.js terminal UI, and persistent Librarian memory.

## Prerequisites and installation

Use Linux with Bash, `setsid`, curl, uv (CI uses 0.12.10), Node.js 22, npm, and the read commands `grep`, `rg`, `pwd`, `cat`, `head`, `tail`, `find`, `ls`, `wc`, and `diff`. Python 3.13+ is required; uv downloads it into this checkout if needed. Playwright needs its usual Linux browser libraries already installed; installation scripts do not change system packages.

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

The scripts source `scripts/env.sh`, keeping environments, Python bytecode, uv/npm caches, downloaded browsers, inside `.artifacts`, `.venv`, or `web`. Next.js build output and browser reports also remain inside this checkout. These generated directories are gitignored. Before running tools directly, use:

```bash
source scripts/env.sh
```

Installed-package checks and E2E create disposable configuration/data directories
outside the source checkout, then remove them after shutdown. Keep those
runner-owned directories separate from real user data. `.env` and runtime data are never tracked. The existing Git repository and Apache-2.0 license are preserved.

## Verification

```bash
./scripts/test.sh             # Python, quality, frontend, all three browsers
./scripts/verify-wheels.sh    # fresh archives, pip installs, composition and HTTP E2E
```

E2E covers projects, replies, streaming, specialist views, file links,
cancel/delete, recovery, themes, Librarian activity, and persisted-project
recovery after a backend crash/restart. All three browsers are required.
The repaired WebKit layout and toast scenarios are repeated ten times without
retries in CI. Flaky tests fail the gate even if a diagnostic retry passes.

Set `ROBOSPRAWL_E2E_API_PORT` and `ROBOSPRAWL_E2E_WEB_PORT` if ports 8000 and 3100
are occupied. Each invocation owns its backend, frontend, temporary data, and
unique `.artifacts/e2e/run-*` reports. The runner stops process groups after
failure or interruption; readiness failure and occupied ports fail explicitly.

For CI-equivalent installed E2E, provide `ROBOSPRAWL_E2E_PYTHON` with the absolute
path to an installed candidate interpreter and set `ROBOSPRAWL_E2E_PREBUILT=1`
after building the frontend. The default command remains a convenient developer
wrapper. See [testing commands and artifact contracts](docs/testing.md).

For a paced stream demonstration, source `scripts/env.sh` and run `uv run uvicorn robosprawl.api.app:stream_sync_mock_app --factory`; its temporary data stays inside the checkout.

Visual baselines live under `web/e2e/visual-regression.spec.ts-snapshots`. Update them intentionally with `--project=chromium --update-snapshots`, then review the images. [Verification notes](docs/verification.md) record the port's results and visual review. Credential-backed live inference is reported separately from automated configuration tests.

CI checks out this repository and the pinned Roboz revision as siblings, so
locked source paths work unchanged. Dependencies are built once and passed as
candidate artifacts. Require the aggregate **CI** check for branch protection.
Actions are pinned to immutable commits and maintained by Dependabot; fork PR
checks need no secrets. Reports and candidate archives are retained for 14 days.

## Future PyPI installation

The project declares versioned dependencies on `roboz`, `roboz-shed`, and `roboz-openai`, with exactly three local source overrides in `pyproject.toml`. Once the desired versions are published, remove `[tool.uv.sources]`, refresh `uv.lock` with `uv lock`, and run the full checks again. No import or application namespace changes are needed. The installation checker accepts a directory of candidate distributions and
continues to apply after that transition. Supply the reviewed PyPI dependency
wheels instead of building the temporary sibling checkout. No containerization
or publication is performed by these checks.
