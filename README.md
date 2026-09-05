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

The model selector retains GLM-5.3, GLM-5.3 Flash (OpenRouter), and GPT-OSS-120B (Cerebras). Endpoint URLs, context limits, request options, and the root/memory model choices are configurable in the optional `deployment` section of `hub.config.json`; `hub.config.json.example` shows the full defaults. Credentials stay in the environment. With the default configuration, OpenRouter is also required by the Librarian even when Cerebras is selected for the root agent. The dependency panel reports missing credentials or unavailable routes. Readiness means the application is initialized; provider health is reported independently. Model availability may depend on your provider account.

Live capabilities are interaction, guarded file reading, literal patch editing, automatic context compaction, and Librarian memory. Reads stay within the configured sandbox; the current project is writable, shared workspace writes prompt, and other locations are denied. These are application tool guards, not an OS sandbox. Live transcription returns a clear HTTP 503; mock transcription remains testable. See [deferred dependency work](docs/deferred-dependency-changes.md) for omitted integrations.

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

Set `ROBOSPRAWL_CONFIG=/absolute/path/hub.config.json` to choose a separate deployment and data location. The existing configuration remains valid without a `deployment` section. To use one OpenAI-compatible model for both the root agent and memory, add this section and replace the example service/model values:

```json
"deployment": {
  "endpoints": {
    "local": {
      "label": "Local model",
      "api_name": "local",
      "model": "your-model-id",
      "base_url": "http://127.0.0.1:1234/v1",
      "api_key_env": "LOCAL_MODEL_KEY",
      "max_context_tokens": 32768
    }
  },
  "selectable_models": ["local"],
  "default_model": "local",
  "memory_model": "local"
}
```

Set the referenced credential variable (use a placeholder if your local service requires no authentication). Each endpoint also accepts `timeout_s` (default 60), `stream` (default true), and `extra_body`. Endpoint keys are local configuration references; `api_name` distinguishes services in dependency identities. The model menu, memory pipeline, and dependency health registrations are assembled together. Invalid references, overlapping persistence folders, and missing `logs`, `snapshots`, or `memory` folders fail configuration validation before agents are constructed.

For custom Python deployments, `HubDeployment.custom()` accepts a model selector and dependency registrations. Built-in executable/model checker registrations can be inferred from the constructed graph; other dependency kinds require explicit checkers. An explicit registry retains exact graph validation.

Backend imports have no startup side effects. ASGI factories build an app; its lifespan registers use of process logging and recovers activity markers before accepting work. Overlapping apps in one process must share the same logging configuration. Shutdown cancels root and background work and waits up to ten seconds, logging a timeout if synchronous work cannot stop. Run registries are process-local: run one backend worker per data directory.

See [Backend ownership](docs/backend-architecture.md) for the intent and boundaries of the runtime.

## Data and isolation

`hub.config.json` is generic and ready to use; `hub.config.json.example` documents the layout and model defaults. Runtime data defaults to `.runtime/data` and technical logs to `.runtime/logs`. Each project owns `conversation_logs`, `conversation_snapshots`, and `persistent_memory`. Configuration lookup uses `ROBOSPRAWL_CONFIG` when set, otherwise checks the current directory and its parents before the application checkout. All relative data and log paths resolve against the selected configuration file. Python callers can pass `load_hub_config(config_file=Path(...))`, which takes precedence over the environment.

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
Actions are pinned to immutable commits and maintained by Dependabot. Until Roboz
is published, its private checkout uses a dedicated fine-grained read-only token stored
as `ROBOZ_CI_TOKEN` in both Actions and Dependabot secrets. Same-repository PRs
and Dependabot use that credential; fork PRs cannot complete the private dependency
checks without access to it. See [CI credential setup](docs/testing.md#temporary-private-dependency-access).
Reports and candidate archives are retained for 14 days.

## Future PyPI installation

The project declares versioned dependencies on `roboz`, `roboz-shed`, and
`roboz-openai`, with exactly three local source overrides in `pyproject.toml`.
Once compatible versions of all three are on PyPI, remove those overrides and
the CI Roboz checkouts, refresh `uv.lock`, and download the released dependency
wheels into the existing candidate directory instead of building Roboz from
source. The archive verifier and browser installation continue to consume that
directory. Revoke the token and delete both secret entries after the
credential-free workflow passes. See the [PyPI cutover steps](docs/testing.md#pypi-cutover).
No import or application namespace changes are needed; these checks do not publish packages.
