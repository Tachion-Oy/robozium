# Robozium

Robozium runs durable agent projects with separate memory and selectable tools.
Its browser HUD uses [RoboZ](https://github.com/Tachion-Oy/roboz) agents and guarded file operations.

## Run

Install Docker Compose v2.24 or newer. Docker Desktop users must enable
[host networking](https://docs.docker.com/engine/network/drivers/host/#docker-desktop).
Clone this repository; RoboZ, Shed, and Endpoints come from the pinned dependency.

```sh
git clone https://github.com/Tachion-Oy/robozium.git
cd robozium
./start --mock
```

On Windows, use `start.cmd --mock`. Open <http://127.0.0.1:6969>. Mock mode needs
no keys. For live mode, run `./start` or `start.cmd` without `--mock`. The first
live start locks the HUD; **Start Here** walks through adding provider keys in
the **Environment** panel, and saving them unlocks the HUD without a restart. A
`.env` copied from [.env.example](.env.example) also works.

Set `ROBOZIUM_WEB_PORT` in `.env` to change the web port. The API listens on
`127.0.0.1:8000`; the web app also binds to loopback. Ctrl+C stops the app
without deleting project data.

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
`local/imports/<folder-name>/`, and shows the discovered capabilities and
example settings. The source folder is not linked. Restart to activate the copy,
then select its tools or skills when launching a project.

To update an import, select **Remove** next to it, import the new version,
then restart. Removing deletes only the copy; its saved settings remain.
Import only trusted packages. [Robozify](https://github.com/Tachion-Oy/robozify) offers email and timesheets.

## Hub files and permissions

Live projects default to `../Robozium-Hub/`; mock projects use
`.runtime/mock-hub/`. Set `ROBOZIUM_HUB_ROOT` in `.env` to move the live hub.
The hub contains `projects/`, shared `workspace/`, and `readonly/`. File tools
write within their project, ask before writing to `workspace/`, and deny writes
to other projects and `readonly/`. Custom Python tools must enforce their own
bounds. Back up the hub and `.runtime/` separately from Git.

## Development and contributions

Read [Contributing](CONTRIBUTING.md) before submitting changes. For native Linux
development, install Python 3.13+, uv, Node.js, and npm, then run:

```sh
uv sync --locked --dev
npm --prefix web ci
./scripts/dev.sh --mock
```

Open <http://127.0.0.1:3000>. See [Code style](docs/code-style.md) and
[Testing](docs/testing.md) for checks. Full E2E must pass in CI before merging.

## Troubleshooting

Check container status and logs:

```sh
docker compose ps
docker compose logs --tail=200 api web
```

For provider failures, use **Dependencies → Check Now** in the HUD. Report bugs
with sanitized logs in an [issue](https://github.com/Tachion-Oy/robozium/issues);
report vulnerabilities through [Security](SECURITY.md). Do not run
`docker compose down --volumes` without identifying the exact project and data.

Robozium uses the [Apache License 2.0](LICENSE). Pirulen lettering is by
Raymond Larabie ([terms](https://typodermicfonts.com/license/)); the HUD mark uses Anurati A.
