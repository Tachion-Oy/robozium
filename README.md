<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/robozium-title-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/robozium-title-light.svg">
    <img alt="Robozium" src="docs/assets/robozium-title-light.svg" width="95%">
  </picture><br><br>

  <p><strong>Durable agentic projects with custom tools</strong></p>

  <br>

  <p>
    <img src="https://raw.githubusercontent.com/Tachion-Oy/roboz/main/docs/assets/robozium-project-chat.png" alt="Robozium project chat" width="49%" align="top">
    <img src="https://raw.githubusercontent.com/Tachion-Oy/roboz/main/docs/assets/robozium-runs-overview.png" alt="Robozium runs overview" width="49.43%" align="top">
  </p>

  <br>
</div>

Robozium is a multi-agent application built on [RoboZ](https://github.com/Tachion-Oy/roboz). It allows the creation and parallel execution of agentic projects each with their individual memory and scoped tools that prevent unwanted cross-pollination by using a guard layer introduced by RoboZ's tool chaining. The API is built on FastAPI and the UI using NEXT.js. It supports custom tools and their injection as the agent's capabilities.

[![CI](https://github.com/Tachion-Oy/robozium/actions/workflows/ci.yml/badge.svg)](https://github.com/Tachion-Oy/robozium/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)

> [!NOTE]
> Robozium and its RoboZ dependency are early-stage software. Configuration,
> behavior, and interfaces may change. See the [changelog](CHANGELOG.md).

## Table of contents

- [How it works](#how-it-works)
- [What is it for?](#what-is-it-for)
- [Hub files and permissions](#hub-files-and-permissions)
- [Run](#run)
  - [Optional encrypted credentials](#optional-encrypted-credentials)
  - [Run with API keys](#run-with-api-keys)
- [Configuration](#configuration)
- [Run capabilities](#run-capabilities)
- [Private capabilities](#private-capabilities)
- [Host scripts on Linux](#host-scripts-on-linux)
- [Development and contributions](#development-and-contributions)
- [Module map](#module-map)
- [Troubleshooting](#troubleshooting)
- [License and credits](#license-and-credits)

## How it works

When the user creates or restarts a project it launches an orchestrator agent along with its librarian background agent with [scoped tool permissions](#hub-files-and-permissions), allowing to work on a specific task. The browser Head-Up-Display (HUD) allows launching several agents in parallel and navigating between their respective runs.

The background librarian continuously snapshots conversations and consolidates a persistent
memory, which supplies context for later runs in the same project.

RoboZ supplies the agent runtime and tool composition. Shed supplies the
orchestrator, librarian, guarded file tools, reusable skills, and capabilities.
Endpoints supplies provider adapters and model catalogues. Robozium owns the
deployment recipe, HUD guidance skill, browser interface, HTTP API, run
lifecycle, credentials, and application choices.
See [RoboZ's documentation](https://github.com/Tachion-Oy/roboz#shed) for the
underlying agent and tool concepts.

Import the application recipe with
`from robozium.hub.deployment import robozium` and its guidance skill with
`from robozium.hub.skills import robozium`. These replace the former
`roboz.shed.deployments` and `roboz.shed.skills` imports.

The recipe returns a `DeployableAgent` with fixed filesystem, stop,
compactification, and Robozium guidance, plus selectable SafeScripts. Email and timesheets are available through Robozify.
Supply optional `scripts_dir=...` or `script_socket=...`;
scripts otherwise use the sandbox's read-only `safe-scripts` directory. Keep
that directory outside agent-writable paths. Attach local additions with
`definition.add_capabilities(...)`, apply
`definition.set_capability_selection(...)`, then call
`definition.build(event_sinks=..., event_sink_factory=...)` for runtime agents
and per-agent persistence.

All projects are organized within a [hub with the individual project folders as well as a shared workspace and a readonly folder](#hub-files-and-permissions). Files outside the hub are strictly off limits.

Custom tools created with RoboZ can straightforwardly be introduced, see [Private capabilities](#private-capabilities).

## What is it for?

Robozium allows for having long lived specific projects focussed on a specific theme or task, with memory specific to that task and no fear of contamination from other agents due to the fine-grained tool policies preventing unwanted changes. A [shared workspace and readonly locations](#hub-files-and-permissions) allow collaboration of agents in a regimented manner.

With Roboz' tool chaining the user may create their specific tools and (mostly) deterministic workflows and do not have to rely on an off-the-self agent using low level tools with multiple back and forth steps and risking that rules and guidelines given in system prompts and skills are correctly followed.

## Hub files and permissions

The live hub sits beside the clone and is mounted at `/hub` in the API container.
The launcher creates it if missing and reuses it when present.

```text
parent/
├── robozium/             # cloned repository
│   └── .runtime/         # mock data and technical logs
└── Robozium-Hub/         # live hub, mounted at /hub
    ├── readonly/         # reference files
    ├── workspace/        # shared working files
    └── projects/         # project files, history, snapshots, memory
```

Set `ROBOZIUM_HUB_ROOT` in **Environment** to choose another live location. It may be
absolute or relative to the repository. Mock runs use `.runtime/mock-hub` and
`.runtime/mock-logs`; live technical logs use `.runtime/logs`.

Each project's file tools can read within the hub and write in that project's
folder. Writes to `workspace/` ask for confirmation. Writes to other projects
and `readonly/` are denied. These are agent file-tool permissions, not an
operating-system sandbox; custom Python code must apply its own appropriate
guards.

RoboZ supplies the guarded file CLI. Scripted `run_file_command`
calls use ordered `[value, tag]` pairs in `value`, for example
`[["cat", "CMD"], ["workspace/notes.txt", "PTH"]]`. The old `file_commands`
and `chain` inputs are no longer accepted. Convert saved tool calls before
replaying them; upgrading does not rewrite existing project files or history.
See the [RoboZ guarded file CLI guide](https://github.com/Tachion-Oy/roboz/blob/roboz-v0.6.1a1/README.md#guarded-file-cli).

![Three example projects and their permitted, prompted, and denied file paths inside the hub sandbox](docs/assets/sandbox-permissions.svg)

Hub files live outside Git history; `.runtime/` is also ignored. Back up these
host directories separately. `docker compose down --volumes` does not delete
them, but older Docker named volumes may still contain user data. Do not use that
command as routine cleanup without identifying and authorizing the exact target.

## Run

Robozium is run from this repository, using Docker Compose on Windows, macOS,
and Linux. Clone it to use the application; a fork is optional. Robozium is not
distributed through PyPI. RoboZ is installed at the version pinned in
[uv.lock](uv.lock), including Shed and Endpoints, so no second checkout is needed.

Install Docker with Docker Compose v2.24 or newer. Robozium uses host networking.
On macOS and Windows, use Docker Desktop 4.34 or newer with Linux containers,
then enable **Settings → Resources → Network → Enable host networking** and
apply the restart. Enhanced Container Isolation must be off. See
[Docker's host networking setup](https://docs.docker.com/engine/network/drivers/host/#docker-desktop).

Then clone this repository:

```sh
git clone https://github.com/Tachion-Oy/robozium.git
cd robozium
./start --mock
```

On Windows, use `start.cmd --mock` instead. Open
[http://127.0.0.1:6969](http://127.0.0.1:6969).

Mock mode uses scripted agents and needs no provider keys. It exercises the
interface and persists its own project data separately from the live hub. The
first start builds the application images and downloads their dependencies.

### Environment and secrets

Start the app, then select **Environment** from the view menu next to
**Runs Overview** and **Dependencies**. This works in live mode and in
`./start --mock` (`start.cmd --mock` on Windows), so dummy values are enough to
test the complete setup workflow.

1. Optionally clone Robozify or another catalogue. Enter its folder under
   **Capability folders**, for example `../robozify`, then **Save and apply**.
   Separate multiple paths with semicolons; relative paths start at this checkout.
2. Click suggested variables from the app and catalogue `.env.example` files.
   Enter values, select **Secret** where appropriate, or add a custom variable.
3. Choose **Encrypt and apply**, enter and confirm an encryption password, and
   wait for the containers to restart. The browser unlocks using the password
   just entered; it retains neither the password nor keys in browser storage.
4. Create a project and select the capabilities to use. Later starts can be
   unlocked with the **Secrets** button. It also clears unlocked secrets from
   the API process; remove stored entries in **Environment**.

Environment editing is available only when **all runs are stopped**, including
queued runs, runs waiting for input, and background work. Applying changes
also prevents new runs from starting until restart or a reported failure.

The UI writes only the root `.env.encrypt`. Ordinary values retain their base
names; selected secrets are encrypted as `NAME_ENCRYPTED`. On unlock, tools
receive `NAME`. Startup settings such as folders, the hub location, and web port
remain plain because Docker needs them before the app opens. No host Python or
uv installation is needed for this UI workflow.

A manually created root `.env` overrides `.env.encrypt`. The UI leaves it
untouched and labels overridden settings. Capability `.env` files are never
loaded. Suggestions preserve conflicting defaults with their source labels.
Invalid catalogue configuration leaves Environment available for correction.

The default live configuration uses `OPENROUTER_API_KEY` for models and the
librarian, `CEREBRAS_API_KEY` for Cerebras, and `GROQ_API_KEY` for voice input.
Use the real provider keys in live mode; mock mode uses scripted responses.
Store Bridge's generated IMAP password as `PROTON_BRIDGE_PASSWORD`, with
**Secret** selected. Email and timesheet settings remain capability-owned.

Set `ROBOZIUM_WEB_PORT` through the UI or a manual `.env` if 6969 is busy.
Listeners remain on host loopback; port 8000 must also be free. Keep the launcher
running while using the app. Ctrl+C stops its containers without deleting data.
Use `docker compose logs -f api web` for container logs.

### Optional encrypted credentials

The existing CLI also supports encryption when uv and Python are installed:

```sh
uv run --locked roboz env encrypt --secret OPENROUTER_API_KEY
```

It reads `.env` and writes `.env.encrypt`, leaving the source untouched.
Repeat `--secret NAME` for each selected base name. Delete the source yourself
if encrypted storage is desired. The UI never creates this plaintext source.

When upgrading from RoboZ 0.10, replace `_SECRET` names with base names in
configuration and custom tools, then recreate encrypted entries. There are no
legacy aliases. Recover existing credentials with the previous release before
upgrading if necessary. Keep unlock passwords outside the checkout and agent
prompts; stored encryption does not hide values from the running API after unlock.


## Configuration

[hub.config.py](hub.config.py) contains the application choices:

| Configuration | Purpose |
| --- | --- |
| `NAME`, `SANDBOX` | Application name, hub layout, and persistence folders. |
| `MODELS`, `DEFAULT_MODEL` | Models offered in the HUD and the initial selection. |
| `MEMORY_ENDPOINT` | The librarian's model, independent of the project model. |
| `SUBAGENTS` | Specialist agent definitions. |
| `TRANSCRIPTION_ENDPOINT` | Groq Whisper speech-to-text by default; `None` disables live transcription. |
| `ADDITIONAL_DEPENDENCIES`, `DEPENDENCY_HEALTH` | Extra monitored resources and health-check timing. |
| `LOGGING` | Technical log location. |

Configuration is executable Python and is tracked by Git. Restart native
development after changing it, or rerun the start command to rebuild the Docker
application. Use a branch or fork for source customizations you want to keep,
and review configuration diffs before including them in an upstream PR.

## Run capabilities

In the HUD, **New Project** opens the capability selector with a project-name
field. A dormant project's **Tools** button (or its row) opens the same selector
with the existing name and its last saved choices. Change optional capabilities,
then click **Launch** to save the selection and start the run. The row's green
**Launch** button uses the saved choices directly. Without saved choices, only
fixed capabilities are included.
Fixed capabilities are always included and cannot be changed. New optional
capabilities start unchecked, removed ones are ignored, and saved skill loading
modes are retained. Newly selected skills follow their declared loading mode.
**Cancel** discards edits. Relaunching keeps the project's memory while allowing
a different set of capabilities.
Switching to Dependencies and back to Launch keeps the current launch form open.
Mock mode offers harmless **mock information** and **mock guidance** examples.

Robozium's deployment definition owns the built-ins: filesystem, stop,
compactification, and the Robozium skill are fixed. SafeScripts and discovered
external capabilities are selectable. The application loads additional capabilities only
from packages in `local/tools/` and `local/skills/`, plus configured external
directories; see [Private capabilities](#private-capabilities).

The capabilities router separates the live catalogue from saved project choices:

- `GET /capabilities` returns the agent's current `CapabilityView` catalogue:
  `name`, `kind`, `selectable`, and skill `loading` mode.
- `GET /capabilities/{project}` returns the saved JSON selection unchanged, or
  `null` if nothing has been saved. `{}` means an explicitly empty selection.
- `POST /capabilities/{project}` replaces the saved selection with the request
  body and returns it. For example: `{"safe_scripts": true, "email": "on_demand"}`.
  The project must already exist. Invalid JSON selection values return 422.

Saved choices live in `.robozium/capabilities.json` in the project folder and
survive backend restarts. Reads and writes do not consult the catalogue or change
an active run. Adding or removing agent capabilities never rewrites this file.
Writes use atomic replacement; a failed write preserves the previous selection.
An unreadable or malformed saved file returns a load error.

The web BFF exposes these routes under `/api/capabilities`. The HUD combines the
current catalogue with saved choices by name. On Launch, it saves the resolved
selection before supplying the same choices to `POST /run/create`. A read or save
failure prevents launching; a later run-creation failure leaves the choices saved
and allows retrying:

```json
{"project": "my-project", "capabilities": {"safe_scripts": true, "email": "on_demand"}}
```

Run creation does not read or write saved settings. Omitting `capabilities` (or
sending `null`) uses all declared capabilities; `{}` retains only fixed ones.
Skill choices accept `true`, `false`, `"automatic"`, or `"on_demand"`; tool choices
accept booleans. Invalid run choices return 422. An existing active run is reused
when choices are omitted or equivalent; different explicit choices return 409.
`GET /run/{run_id}` includes the effective selection. Choices do not change
Librarian maintenance.

For email or timesheets, clone [Robozify](https://github.com/Tachion-Oy/robozify)
beside Robozium and add `../robozify` under **Environment → Capability folders**.
Apply, then choose the suggested settings from each capability’s `.env.example`.
Discovery never reads a capability `.env`. Select
`email` or `timesheet` when launching a run. Bridge settings now use
`PROTON_BRIDGE_*`; rename old `ROBOZIUM_PROTON_BRIDGE_*` entries. Timesheets
default to `readonly/timesheets`; set `TIMESHEET_ROOT=readonly/Tachion` to
continue using existing data. Encrypt and apply through Environment, then unlock
saved secrets through the HUD after later launches.

Host networking lets the API connect directly to Bridge's localhost listener.
Start Bridge before selecting **Check Now**. An exported shell variable
overrides the same setting in `.env` or `.env.encrypt`.

## Private capabilities

With uv installed, run from the repository root:

```sh
uv run --locked roboz tool init
uv run --locked roboz skill init
```

These create packages in `local/tools/simpsons_quotes/` and
`local/skills/simpsons_quotes_skill/`. Edit `tool.py`, export `CAPABILITY` from
`__init__.py`, and list dependencies in `requirements.txt` (keep it even if empty).
Use `--path` to create more packages:

```sh
uv run --locked roboz tool init --path local/tools/timesheets
uv run --locked roboz skill init --path local/skills/project_guide
```

`local/` is always scanned. To also load tools from other folders or cloned
repositories, enter their locations under **Environment → Capability folders**:

```text
../customer-tools;/path/to/shared-tools
```

Each directory must exist and contain packages directly under `tools/` or
`skills/`. Separate paths with semicolons on all platforms; Windows paths can use
forward slashes. Relative paths use the checkout (the selected configuration's
directory for native loading). `--path` can also target these external directories.

Apply to restart the app after folder changes, then reopen the
capability selector. New optional capabilities start unchecked; CLI-generated
skills load on demand. Keep label names stable to preserve saved selections.
Mock mode includes catalogue labels with harmless substitutes so selection can
be tested without constructing provider clients or contacting live services.

Requirements are resolved together against the pinned application dependencies
before private code is imported. Incompatible dependencies, invalid exports, or
duplicate capability names stop startup with an error. Docker mounts source
directories read-only; installed dependencies stay in `.runtime/local-deps/`.
Private files in `local/` are Git-ignored.

## Host scripts on Linux

Docker Compose owns the API container and its read-only SafeScripts mounts.
[process-compose.yaml](process-compose.yaml) owns optional host processes,
dependencies, restart limits, shutdown, and log paths. When
[Process Compose v1.122.0](https://github.com/F1bonacc1/process-compose/releases/tag/v1.122.0)
is installed, the live launcher attempts every process in its platform namespace
(`live-Linux`, `live-Darwin`, or `live-windows`). Only Linux currently has a
service: RoboZ's SafeScripts. Mock mode skips host processes. To add another
RoboZ-owned host service, declare it in the relevant namespace. Third-party
applications keep their own launchers.

Install trusted `.sh` files in the live hub's `readonly/safe-scripts/`. The host
needs Bash, [uv](https://docs.astral.sh/uv/), and Python 3.13 or newer. The
service runs as your user with the hub as its working directory. The API uses a
private Unix socket and cannot write to the mounted script directory. Ask the
agent to call `run_shell_script` without a script name to list entries.
`compose.yaml` sets `ROBOZIUM_HOST_SCRIPT_SOCKET=/host-scripts/scripts.sock`
and binds `.runtime/host-socket` there. SafeScripts serves that directory's
`scripts.sock` socket as declared in `process-compose.yaml`; no socket setting
is needed in `.env` or `.env.encrypt`. RoboZ's existing dependency checks show
service availability in the HUD. Missing Process Compose or service prerequisites
and failed host processes do not prevent application startup. An unavailable
service reports a failure when its tool is used.

Start with `./start` or `./start --mock` (`start.cmd` on Windows). The supervisor
writes `.runtime/logs/host-services.log`; SafeScripts writes
`.runtime/logs/safe-scripts.log`. Set machine-specific hub
and port values in `.env` or `.env.encrypt` as described above.

## Development and contributions

Bug reports, fixes, examples, and documentation improvements are welcome. Small
fixes may go directly to a PR; substantive changes need an approved issue first.
Read [Contributing](CONTRIBUTING.md) for setup, proposal approval, and the PR flow.

For coding-agent work across the repository, prepare
[encrypted credentials](#optional-encrypted-credentials) and delete plaintext
`.env` before granting access. Unlock keys yourself through the HUD when needed;
keep API keys and the unlock password out of agent prompts and its shell
environment. Mock development needs no credentials.

Native development requires Python 3.13 or newer, uv, Node.js, and npm. CI uses
Python 3.13 and Node.js 22. On Linux:

```sh
uv sync --locked --dev
npm --prefix web ci
./scripts/dev.sh --mock
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Omit `--mock` for live
development with `.env` or `.env.encrypt`. The development launcher uses its
own `.runtime/dev-mock-hub` or `.runtime/dev-live-hub` by default; set
`ROBOZIUM_HUB_ROOT` explicitly to select another location. Docker Compose remains
the supported user runtime on all three operating systems.

See [Code style](docs/code-style.md), [Testing](docs/testing.md), and
[Testing practices](docs/testing-practices.md). The
[CI workflow](.github/workflows/ci.yml) defines the PR checks; the
[Full E2E workflow](.github/workflows/e2e.yml) also runs on every PR, pushes to
`main`, and manual dispatch. Both checks must pass before merging. Wheel and
source archive checks validate internal installation, not PyPI publication.

## Module map

| Location | Provides |
| --- | --- |
| `src/robozium/hub` | Configuration loading, project paths, and deployment bindings. |
| `src/robozium/api` | HTTP routes, runs, prompts, SSE events, credentials, and dependency health. |
| `src/robozium/mock` | Scripted agent and model behavior for demos and tests. |
| `web/app`, `web/hooks`, `web/lib` | Next.js HUD, API proxy routes, and browser session state. |
| `hub.config.py`, `compose.yaml`, `Dockerfile` | Application choices and supported deployment. |
| `scripts`, `tests`, `web/tests`, `web/e2e` | Development helpers, backend checks, frontend tests, and browser suites. |

## Troubleshooting

From the repository root, check container status and recent logs:

```sh
docker compose ps
docker compose logs --tail=200 api web
```

Open **Dependencies** in the HUD and select **Check Now** when a live provider is
unavailable. Failed dependencies show their error message and linked cause; use
**Copy diagnostic** to share the dependency ID, check time, reason, and safe
connection metadata with your coding agent. If clipboard access is unavailable,
select the diagnostic text and copy it manually. Check API-key controls for
credential failures.

The same diagnostics appear in API console logs and the rotating technical log
at `.runtime/logs/backend.jsonl` (unless the logging path was configured otherwise).
New or changed failures are warnings, recovery is info, and repeated observations
are debug records. For a reproducible bug, include the commit, mode, operating system,
and sanitized logs in an [issue](https://github.com/Tachion-Oy/robozium/issues).
Report vulnerabilities privately using [Security](SECURITY.md).

## License and credits

Robozium is licensed under the [Apache License 2.0](LICENSE).

Brand lettering uses Pirulen artwork by Raymond Larabie
([usage terms](https://typodermicfonts.com/license/)). The HUD status mark uses
Anurati A. Third-party assets retain their respective usage terms.
