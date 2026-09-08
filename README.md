# RoboSprawl

A runnable project-agent application built on Roboz, with a FastAPI backend, streaming Next.js terminal UI, and persistent Librarian memory.

## Prerequisites and installation

Use Linux with Bash, `setsid`, curl, uv (CI uses 0.12.10), Node.js 22, npm, and the read commands `grep`, `rg`, `pwd`, `cat`, `head`, `tail`, `find`, `ls`, `wc`, and `diff`. Python 3.13+ is required; uv downloads it into this checkout if needed. Playwright needs its usual Linux browser libraries already installed; installation scripts do not change system packages.

Place a fresh checkout of Roboz’s current `main` at `../roboz`. RoboSprawl consumes that checkout through its public package APIs. From the RoboSprawl directory:

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

The model selector retains GLM-5.3, GLM-5.3 Flash (OpenRouter), and GPT-OSS-120B (Cerebras). The editable constants in `hub.config.py` select model labels, root/memory endpoints, and capabilities from shared primitives. Credentials stay in the environment. With the default configuration, OpenRouter is also required by the Librarian even when Cerebras is selected for the root agent. The dependency panel reports missing credentials or unavailable routes. Readiness means the application is initialized; provider health is reported independently. Model availability may depend on your provider account.

Live capabilities are interaction, guarded file reading, literal patch editing, automatic context compaction, and Librarian memory. Reads stay within the configured workspace; the current project is writable, shared workspace writes prompt, and other locations are denied. These are application tool guards, not an OS sandbox. Live transcription returns a clear HTTP 503; mock transcription remains testable. See [deferred dependency work](docs/deferred-dependency-changes.md) for omitted integrations.

The live orchestrator applies remembered preferences, delegates to configured specialists, and stays available across tasks. It stops when the user asks to end the session. See [deployment composition](docs/deployment.md) for the shared factory and workspace configuration.

Both launch modes use `fastapi dev`, showing the FastAPI startup banner, API documentation URL, and server logs in the terminal. Backend source changes reload automatically.

The launcher waits up to 60 seconds for API readiness and stops both process groups when either service exits or Ctrl+C is pressed. Ports 8000 and 3000 must be free.

## Backend configuration and launch

For a backend-only development server:

```bash
source scripts/env.sh
uv run uvicorn robosprawl.api.app:mock_app --factory --reload --reload-dir src
# Live backend, with credentials from .env:
uv run --env-file .env uvicorn robosprawl.api.app:live_app --factory --reload --reload-dir src
```

Set `ROBOSPRAWL_CONFIG=/absolute/path/hub.config.py` to choose configuration and data locations. The file contains named `Final` constants, with no builder or schema classes. Edit `MODELS`, `DEFAULT_MODEL`, `MEMORY_ENDPOINT`, `CAPABILITIES`, and the other declarations directly. Shared catalogs own provider URLs, credential variables, context limits, and lazy SDK construction. Set `OPENROUTER_API_KEY` and `CEREBRAS_API_KEY` for live inference.

```python
MODELS: Final = {"GLM": GLM, "Cerebras": GPT_OSS}
DEFAULT_MODEL: Final = GLM
CAPABILITIES: Final = (FileCommands, FileEditing, Compactification(threshold_percent=60))
```

The checked-in file supplies all deployment choices. Logging is the explicit exception: `LOGGING = HubLoggingConfig()` uses defaults from `robosprawl.hub.logging`; pass individual keyword arguments to customize them. See [deployment composition](docs/deployment.md) for the complete contract.

`create_app(deployment=load_hub())` consumes a validated Hub directly. `robosprawl.hub.utils` owns discovery, loading, and slug normalization. Hub owns its inputs and runtime selector; there is no nested configuration wrapper. Shared inspection derives executable/model registrations from constructed agents and all advertised models, including unselected ones. Explicit registries retain exact validation. Standard file boundaries come from `Project.permissions`.

Backend imports have no startup side effects. ASGI factories build an app; its lifespan registers use of process logging and recovers activity markers before accepting work. Overlapping apps in one process must share the same logging configuration. Shutdown cancels root and background work and waits up to ten seconds, logging a timeout if synchronous work cannot stop. Run registries are process-local: run one backend worker per data directory.

See [Backend ownership](docs/backend-architecture.md) for the intent and boundaries of the runtime.

## Data and isolation

`hub.config.py` is the single runnable configuration example. Runtime data remains in `.runtime/data` and technical logs in `.runtime/logs`. Projects retain `conversation_logs`, `conversation_snapshots`, and `persistent_memory`. Configuration lookup uses `ROBOSPRAWL_CONFIG` when set, otherwise the current directory and its parents. Relative workspace and technical-log paths resolve against the selected file. Python callers can pass `load_hub(config_file=Path(...))`, which takes precedence over the environment. There is no checkout fallback or JSON loader. The frontend reads its build-time title through the same loader, using `.venv/bin/python` or the interpreter selected by `ROBOSPRAWL_PYTHON`.


The scripts source `scripts/env.sh`, keeping temporary files, environments, Python bytecode, uv/npm caches, and downloaded browsers inside `.artifacts`, `.venv`, or `web`. Next.js build output and browser reports also remain inside this checkout. These generated directories are gitignored. Before running tools directly, use:

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
recovery after a backend crash/restart. Chromium and Firefox are required in CI;
WebKit is temporarily advisory, including its stress run.
The repaired WebKit layout and toast scenarios are repeated ten times without
retries in CI. Flaky tests fail their browser job even if a diagnostic retry
passes. Completed WebKit test failures produce advisory warnings and successful
job checks; setup, service, interruption, and cleanup failures remain required.

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

CI resolves Roboz’s current `main` once per workflow run and checks out that
exact revision beside this repository for Python, quality, and packaging checks.
Both tested source revisions appear in the workflow summary and distribution
reports. Dependencies are built fresh and passed to browser jobs as artifacts
from the same run; previous runs’ application builds are not reused. Require the aggregate **CI** check for branch protection.
Actions are pinned to immutable commits and maintained by Dependabot. Until Roboz
is published, its private checkout uses a dedicated fine-grained read-only token stored
as `ROBOZ_CI_TOKEN` in both Actions and Dependabot secrets. Same-repository PRs
and Dependabot use that credential; fork PRs cannot complete the private dependency
checks without access to it. See [CI credential setup](docs/testing.md#temporary-private-dependency-access).
Reports and candidate archives are retained for 14 days.

## Future PyPI installation

The project declares versioned dependencies on `roboz`, `roboshed`, and
`roboz-endpoints[openai]`, with exactly three local source overrides in `pyproject.toml`.
Once compatible versions of all three are on PyPI, remove those overrides and
the CI Roboz checkouts, refresh `uv.lock`, and download the released dependency
wheels into the existing candidate directory instead of building Roboz from
source. The archive verifier and browser installation continue to consume that
directory. Revoke the token and delete both secret entries after the
credential-free workflow passes. See the [PyPI cutover steps](docs/testing.md#pypi-cutover).
No import or application namespace changes are needed; these checks do not publish packages.
