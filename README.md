# Robozium

Robozium runs durable agent projects with separate memory and selectable tools.
Its desktop HUD uses [RoboZ](https://github.com/Tachion-Oy/roboz) agents and guarded file operations.

## Install on Debian and Ubuntu

The app installs with apt and upgrades with `sudo apt upgrade`. It needs Docker
Engine with Compose v2.24 or newer and an x86-64 (amd64) machine. Add the signed
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
mock backend that needs no keys. The first live start locks the HUD; **Start
Here** walks through adding provider keys in the **Environment** panel, and
saving them unlocks the HUD without a restart.

Upgrades replace only the installed program. Settings, environment variables,
encrypted keys and installed tools stay in `~/.config/Robozium`, and projects
stay in the hub folder.

### Optional encrypted credentials

In the HUD's **Environment** panel, save API keys as secrets in `.env.encrypt`,
then restart and unlock them through **Secrets**. Manual `.env` values override
saved values. **Reset environment** deletes saved settings if you forget the
password; imported packages and `.env` remain.

Before granting a coding agent access to the checkout, encrypt API keys and
remove plaintext `.env`. Keep the unlock password outside the checkout, agent
prompts, and the agent's shell environment. Git ignore rules do not prevent
file reads.

## Private capabilities

In **Environment**, select **Browse folder** to import a package. Its root must
contain `__init__.py` and `env.example` (or `.env.example`); `requirements.txt`
is optional. Robozium validates the package, copies it to
`~/.config/Robozium/<mode>/local/imports/<folder-name>/`, and shows the
discovered capabilities and example settings. The source folder is not linked. Restart to activate the copy,
then select its tools or skills when launching a project.

To update an import, select **Remove** next to it, import the new version,
then restart. Removing deletes only the copy; its saved settings remain.
Import only trusted packages. [Robozify](https://github.com/Tachion-Oy/robozify) offers email and timesheets.

## Hub files and permissions

Projects live in `~/Robozium-Hub/` by default; **Environment → Hub folder**
changes it. Mock mode keeps its own throwaway hub. The hub contains `projects/`,
shared `workspace/`, and `readonly/`. File tools write within their project, ask
before writing to `workspace/`, and deny writes to other projects and
`readonly/`. Custom Python tools must enforce their own bounds. Back up the hub
separately from Git.

## Development and contributions

Read [Contributing](CONTRIBUTING.md) before submitting changes. To run the app
from a checkout, install Docker Engine with Compose v2.24 or newer, Node.js 22.18
or newer, and npm, then run:

```sh
npm --prefix desktop ci
npm --prefix desktop start -- --mock
```

The [desktop README](desktop/README.md) covers live mode, packaging and
diagnostics. See [Code style](docs/code-style.md) and [Testing](docs/testing.md)
for checks. Full E2E must pass in CI before merging.

## Troubleshooting

For provider failures, use **Dependencies → Check Now** in the HUD. Backend logs
are in `~/.config/Robozium/<mode>/.runtime/logs/`; see the
[desktop README](desktop/README.md) for container diagnostics. Report bugs with
sanitized logs in an [issue](https://github.com/Tachion-Oy/robozium/issues);
report vulnerabilities through [Security](SECURITY.md).

Robozium uses the [Apache License 2.0](LICENSE). Pirulen lettering is by
Raymond Larabie ([terms](https://typodermicfonts.com/license/)); the HUD mark uses Anurati A.
