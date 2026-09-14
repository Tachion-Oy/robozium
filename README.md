# RoboSprawl

A runnable project-agent application built on Roboz, with a FastAPI backend, streaming Next.js terminal UI, and persistent Librarian memory.

## Quick start

Install Git and a current Docker Desktop on Windows or macOS, or Docker Engine
with Docker Compose v2.24+ on Linux. Clone this repository only: RoboZ, Roboshed, and the
endpoint package are installed from the releases pinned in `uv.lock`.

```bash
git clone https://github.com/Tachion-Oy/robosprawl.git
cd robosprawl
./start --mock
```

On Windows, run `start.cmd --mock` instead. This mode requires no API keys.

Open http://127.0.0.1:6969. That launch runs the deterministic mock agent
without credentials or a `.env` file. Create a project, reply twice, inspect its
specialist, and follow its generated file link. The mock uses real RoboZ events,
conversation logs, cancellation, snapshots, and memory; its model responses are
scripted and do not prove that live providers work.

The browser is the only published service. It forwards requests to the API on
Compose's private network. If port 6969 is occupied, set `ROBOSPRAWL_WEB_PORT` in
a `.env` file (for example, `ROBOSPRAWL_WEB_PORT=6970`), rerun the command, and
open that port instead.

Logs remain in the terminal. Press Ctrl+C once to stop both services; project
data is preserved. See [deployment](docs/deployment.md) for backup and recovery.

## Real models

Copy `.env.example` to `.env` with your editor or file manager and supply the
credentials for the configured providers. Then run `./start` on macOS/Linux or
`start.cmd` on Windows. With no flag the launcher explicitly selects live mode;
Docker Compose reads the ignored `.env` file automatically. In PowerShell the
copy command is `Copy-Item .env.example .env`; in Bash it is
`cp .env.example .env`.

The default configuration offers GLM-5.3, GLM-5.3 Flash through OpenRouter, and
GPT-OSS-120B through Cerebras. OpenRouter is also required by the Librarian. The
dependency panel reports missing credentials and unavailable providers.

Mock and live modes use distinct named volumes. Switching the mode does not mix
scripted demonstration memory with real projects. Readiness means the processes
are initialized; provider health remains visible in the dependency panel.

## Configuration

Edit the named constants in `hub.config.py`, then restart with `./start` or
`start.cmd`. The image rebuild includes the edited file.

```python
MODELS: Final = {"GLM": GLM, "Cerebras": GPT_OSS}
DEFAULT_MODEL: Final = GLM
CAPABILITIES: Final = (
    Capability(auto_loaded_skills=(robosprawl,)),
    Compactification(threshold_percent=60),
)
```

See [deployment configuration](docs/deployment.md) for every setting and
[backend architecture](docs/backend-architecture.md) for runtime ownership.

## Hub state and isolation

Projects, workspace files, conversation history, snapshots, and memory persist
in the hub volume. Operational logs persist separately. Mock and live modes use
different volumes. Pressing Ctrl+C and starting again preserves both. See
[deployment](docs/deployment.md) for backup and restore commands.

## Verification

PRs run unit tests, lint, and type checks. Merges to main run the full browser,
package, and Docker onboarding checks; these can also be started manually on a
selected branch. See [testing](docs/testing.md).
