<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/robozium-title-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/robozium-title-light.svg">
    <img alt="Robozium" src="docs/assets/robozium-title-light.svg" width="95%">
  </picture><br><br>

  <img alt="" src="docs/assets/robozium-icon.svg" width="128"><br><br>

  <p><strong>Durable agentic projects with custom tools</strong></p>

  <br>

  <p>
    <img src="docs/assets/robozium-runs-overview.png" alt="Robozium runs overview" width="38.5%" align="top">
    <img src="docs/assets/robozium-current-run.png" alt="Robozium current run beside its message log" width="60%" align="top">
  </p>

  <br>
</div>

Robozium is a multi-agent desktop application built on
[RoboZ](https://github.com/Tachion-Oy/roboz). It creates and runs agentic
projects in parallel, each with its own memory and scoped tools. RoboZ's guard
layer keeps one project's agents from changing another's files. You can add
your own tools and skills as the agent's capabilities.

[![CI](https://github.com/Tachion-Oy/robozium/actions/workflows/ci.yml/badge.svg)](https://github.com/Tachion-Oy/robozium/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)

> [!NOTE]
> Robozium and its RoboZ dependency are early-stage software. Configuration,
> behavior, and interfaces may change. See the [changelog](CHANGELOG.md).

## Table of contents

- [How it works](#how-it-works)
- [What is it for?](#what-is-it-for)
- [Install on Debian and Ubuntu](#install-on-debian-and-ubuntu)
  - [Install Robozium](#install-robozium)
  - [Optional encrypted credentials](#optional-encrypted-credentials)
- [Hub files and permissions](#hub-files-and-permissions)
- [Run capabilities](#run-capabilities)
- [Private capabilities](#private-capabilities)
- [Host scripts](#host-scripts)
- [Configuration](#configuration)
- [Development and contributions](#development-and-contributions)
- [Module map](#module-map)
- [Troubleshooting](#troubleshooting)
- [License and credits](#license-and-credits)

## How it works

Robozium is an Electron app with a React Head-Up Display (HUD). It runs its
Python API in a rootless Podman container on your machine, listening only on
loopback.

Creating or restarting a project launches an orchestrator agent and a background
librarian agent, with [scoped tool permissions](#hub-files-and-permissions) for
that project. From the HUD you can run several projects in parallel and move
between their runs. The librarian snapshots conversations and consolidates a
persistent memory, which gives later runs in the same project their context.

RoboZ supplies the agent runtime and tool composition. Shed supplies the
orchestrator, librarian, guarded file tools, reusable skills, and capabilities.
Endpoints supplies provider adapters and model catalogues. Robozium owns the
deployment recipe, HUD guidance skill, desktop interface, HTTP API, run
lifecycle, credentials, and application choices. See
[RoboZ's documentation](https://github.com/Tachion-Oy/roboz#shed) for the
underlying agent and tool concepts.

## What is it for?

Robozium is for long-lived projects, each focused on one theme or task. Each
project keeps its own memory, and fine-grained tool policies stop its agents
from changing other projects. A [shared workspace and a read-only
folder](#hub-files-and-permissions) let agents collaborate in a controlled way.

RoboZ's tool chaining lets you build your own tools and mostly deterministic
workflows. You don't have to rely on an off-the-shelf agent that uses low-level
tools over many steps and may not follow the rules in its system prompt and
skills.

## Install on Debian and Ubuntu

The app needs an x86-64 (amd64) machine running Ubuntu 22.04 or newer, or
Debian 12 or newer. It runs its backend in a rootless
[Podman](https://podman.io/) container as your own user: no daemon, no
`docker` group and no root access. apt installs Podman with the app.

### Install Robozium

The app installs with apt and upgrades with `sudo apt upgrade`. Add the signed
repository once:

```sh
sudo install -d /etc/apt/keyrings
curl -fsSL https://raw.githubusercontent.com/Tachion-Oy/robozium/main/desktop/packaging/robozium-archive-keyring.asc \
  | sudo tee /etc/apt/keyrings/robozium.asc >/dev/null
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/robozium.asc] https://github.com/Tachion-Oy/robozium/releases/latest/download ./" \
  | sudo tee /etc/apt/sources.list.d/robozium.list
sudo apt update && sudo apt install robozium-desktop
```

Start **Robozium** from the application menu, or run `robozium --mock` for a
mock backend that needs no keys. The first start builds the backend image, which
needs internet access and can take several minutes. The first live start locks
the HUD. **Start Here** walks you through adding provider keys in the
**Environment** panel, and saving them unlocks the HUD without a restart.

Versions up to 0.3.1 ran the backend in Docker. After an upgrade, the app builds
its image with Podman and keeps your projects and keys. Before the first start
after the upgrade, remove the old Robozium containers: one still running holds
the backend's port, and the new backend cannot start. The second command removes
the old images, which you can keep if you still want them:

```sh
docker ps -aq --filter label=fi.tachion.robozium.desktop.installation | xargs -r docker rm -f
docker images --format '{{.Repository}}' | grep '^robozium-desktop-' | xargs -r docker rmi
```

The default configuration offers OpenRouter and Cerebras models. The
librarian's memory model also uses OpenRouter. Voice input uses Groq Whisper and
needs `GROQ_API_KEY`.

Upgrades replace only the installed program. Settings, environment variables,
encrypted keys and installed tools stay in `~/.config/Robozium`, and projects
stay in the hub folder. `sudo apt remove robozium-desktop` keeps both.

### Optional encrypted credentials

In the HUD's **Environment** panel, save API keys as secrets in `.env.encrypt`,
then restart and unlock them through **Secrets**. Manual `.env` values override
saved values. Secret values stay masked, and saving secrets requires an
encryption password.

If you forget the password, stop all runs, open **Environment** and choose
**Reset environment**. Confirming it permanently deletes the saved settings and
secrets without asking for the old password. Imported packages and `.env`
remain. Enter the settings again and save with a new password.

Before granting a coding agent access to your files, encrypt API keys and
remove plaintext `.env`. Keep the unlock password out of the agent's reach:
outside its files, its prompts, and its shell environment. Git ignore rules do
not prevent file reads. Encryption protects stored files; a running backend can
still use unlocked values.

## Hub files and permissions

Projects live in the hub folder, `~/Robozium-Hub` by default:

```text
~/Robozium-Hub/
├── readonly/         # reference files
├── workspace/        # shared working files
└── projects/         # project files, history, snapshots, memory
```

**Environment → Hub folder** shows its path, opens it, and changes it with the
folder picker; a new folder applies after a restart. If the folder goes missing,
the app asks you to reconnect it or choose another instead of starting with an
empty hub. The app never moves or deletes a hub folder. Mock mode keeps its own
throwaway hub.

Each project's file tools can read within the hub and write in that project's
folder. Writes to `workspace/` ask for confirmation. Writes to other projects
and `readonly/` are denied. These are agent file-tool permissions, not an
operating-system sandbox; custom Python tools must enforce their own bounds.

![Three example projects and their permitted, prompted, and denied file paths inside the hub sandbox](docs/assets/sandbox-permissions.svg)

The hub is ordinary user data outside Git. Back it up yourself.

## Run capabilities

In the HUD, **New Project** opens the capability selector with a project-name
field. A dormant project's **Tools** button opens the same selector with its
last saved choices. Change the optional capabilities, then **Launch** saves the
selection and starts the run. A row's **Launch** button reuses the saved
choices directly. Relaunching keeps the project's memory while allowing a
different set of capabilities.

Filesystem, stop, compactification, and the Robozium skill are always included.
SafeScripts and imported capabilities are optional. New optional capabilities
start unchecked, and newly selected skills follow their declared loading mode.
Mock mode offers harmless **mock information** and **mock guidance** examples.

## Private capabilities

In **Environment**, select **Browse folder** to import a package. Its root must
contain `__init__.py` and `env.example` (or `.env.example`); `requirements.txt`
is optional. Robozium validates the package, copies it to
`~/.config/Robozium/<mode>/local/imports/<folder-name>/`, and shows the
discovered capabilities and example settings. The source folder is not linked.
Restart to activate the copy, then select its tools or skills when launching a
project.

The app discovers the package's exported RoboZ `Capability` instances, and
subclasses that take no constructor arguments. `__all__` limits the exports
when present. Discovery doesn't run capability builders or tools, and importing
never loads a package's `.env`. Requirements are resolved against the pinned
application dependencies before the code is imported. Incompatible dependencies,
invalid exports or duplicate capability names are rejected.

To update an import, select **Remove** next to it, import the new version,
then restart. Removing deletes only the copy; its saved settings remain.
Imported code runs as part of the application, so import only trusted packages.
[Robozify](https://github.com/Tachion-Oy/robozify) offers email and timesheets.

## Host scripts

The SafeScripts capability runs trusted `.sh` files from the hub's
`readonly/safe-scripts/` as your user, with the hub as working directory. In
live mode on Linux the app starts this host service before the backend and
stops it afterwards. It needs [uv](https://docs.astral.sh/uv/) on `PATH` or in
`~/.local/bin`. The backend reaches it through a private Unix socket and cannot
write to the script folder. Ask the agent to call `run_shell_script` without a
script name to list the scripts. **Dependencies** shows whether the service is
running and why it is not.

## Configuration

[hub.config.py](hub.config.py) contains the application choices:

| Configuration | Purpose |
| --- | --- |
| `NAME`, `SANDBOX` | Application name, hub layout, and persistence folders. |
| `MODELS`, `DEFAULT_MODEL` | Models offered in the HUD and the initial selection. |
| `MEMORY_ENDPOINT` | The librarian's model, independent of the project model. |
| `SUBAGENTS` | Specialist agent definitions. |
| `TRANSCRIPTION_ENDPOINT` | Groq Whisper speech-to-text by default; `None` disables transcription. |
| `ADDITIONAL_DEPENDENCIES`, `DEPENDENCY_HEALTH` | Extra monitored resources and health-check timing. |
| `ATTACHMENTS` | Limits for images attached to replies. |
| `LOGGING` | Technical log location. |

Configuration is executable Python tracked by Git, and the installed app uses
the copy it was built with. To change it, edit it in a checkout and run or
package the app from there.

## Development and contributions

Bug reports, fixes, examples, and documentation improvements are welcome. Small
fixes may go directly to a PR; substantive changes need an approved issue first.
Read [Contributing](CONTRIBUTING.md) for setup, proposal approval, and the PR
flow.

To run the app from a checkout, install Podman (`sudo apt install podman uidmap
catatonit`), Node.js 22.18 or newer, and npm, then run:

```sh
npm --prefix desktop ci
npm --prefix desktop start -- --mock
```

The [desktop README](desktop/README.md) covers live mode, packaging and
diagnostics. See [Code style](docs/code-style.md),
[Testing](docs/testing.md), and [Testing practices](docs/testing-practices.md)
for checks. Full E2E must pass in CI before merging.

## Module map

| Location | Provides |
| --- | --- |
| `desktop/src` | Electron main process, preload bridge, and backend lifecycle. |
| `desktop/renderer` | React HUD. |
| `desktop/packaging` | Debian package and signed apt repository tooling. |
| `src/robozium/hub` | Configuration loading, project paths, local capabilities, and deployment bindings. |
| `src/robozium/api` | HTTP routes, runs, prompts, SSE events, credentials, and dependency health. |
| `src/robozium/mock` | Scripted agent and model behavior for demos and tests. |
| `src/robozium/model_catalogue` | Provider model catalogue offered in the HUD. |
| `hub.config.py`, `desktop/Dockerfile`, `desktop/src/backend-layout.json` | Application choices and the backend container. |
| `tests`, `desktop/tests`, `scripts` | Backend checks, desktop suites, and helpers. |

## Troubleshooting

For provider failures, open **Dependencies** in the HUD and select **Check
Now**. Failed dependencies show their error and cause. **Copy diagnostic**
copies the dependency ID, check time, reason, and safe connection details to
share with a coding agent. Backend logs are in
`~/.config/Robozium/<mode>/.runtime/logs/`; see the
[desktop README](desktop/README.md) for container diagnostics.

Report bugs with the version, mode, operating system, and sanitized logs in an
[issue](https://github.com/Tachion-Oy/robozium/issues). Report vulnerabilities
privately through [Security](SECURITY.md).

## License and credits

Robozium is licensed under the [Apache License 2.0](LICENSE).

Brand lettering uses Pirulen artwork by Raymond Larabie
([usage terms](https://typodermicfonts.com/license/)). The HUD status mark uses
Anurati A. Third-party assets retain their respective usage terms.
