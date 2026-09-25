# Robozium

A project-agent app built on [RoboZ](https://github.com/Tachion-Oy/roboz).

## Run

Install Docker Compose v2.24+ and clone this repository. RoboZ is installed from
`uv.lock`; you do not need a second checkout.

```sh
git clone https://github.com/Tachion-Oy/robozium.git
cd robozium
./start --mock
```

On Windows, run `start.cmd --mock` instead. Open http://127.0.0.1:6969.
Mock mode needs no provider keys. To use live models, copy `.env.example` to
`.env`, fill in the needed `_SECRET` credentials, and run `./start` or
`start.cmd` without `--mock`. OpenRouter is needed for the Librarian. Groq,
Cerebras, and Proton Bridge settings are also in the example.

For encrypted storage, run `uv run python -m robozium.secret_env encrypt`,
then delete `.env`. The resulting `.env.encrypt` keeps nonsecret settings and
encrypts API keys and the Proton password; unlock **API keys** in the HUD.
The API strips `_SECRET` from runtime names. Recreate older encrypted files
after renaming password entries to `_SECRET`; the old encryptor left them plain.

Set `ROBOZIUM_WEB_PORT` before encrypting if port 6969 is busy. Ctrl+C stops the app
without deleting project files. For problems, run `docker compose ps` and
`docker compose logs --tail=200 api web`.

## Hub files

The live hub sits beside the clone, mounted at `/hub` inside the API container.
The launcher creates it if missing and reuses it when present.

```text
parent/
├── robozium/             # cloned repository
│   └── .runtime/         # mock data and technical logs
└── Robozium-Hub/         # live hub, mounted at /hub
    ├── readonly/
    ├── workspace/
    └── projects/         # project files, history, snapshots, memory
```

Set `ROBOZIUM_HUB_ROOT` before encrypting to choose another live location. Mock runs
use `.runtime/mock-hub`. `docker compose down --volumes` does not delete these
host folders, though older Docker named volumes may still hold data.

On Linux, `./scripts/dev.sh --mock` runs the development servers at
http://127.0.0.1:3000 (requires `uv`, Node.js, and npm). Omit `--mock` for live
development. Change models and other app settings in `hub.config.py`.

## File permissions

Each project can read inside the hub sandbox and write in its own folder.
Workspace writes ask for confirmation; writes to other projects and `readonly/`
are denied. These are agent file-tool permissions, not an operating-system
sandbox. See [RoboZ's Shed overview](https://github.com/Tachion-Oy/roboz#shed)
for the underlying tools and guards.

![Three example projects and their permitted, prompted, and denied file paths inside the hub sandbox](docs/assets/sandbox-permissions.svg)

## Known issues

- A delayed run poll can replace a newer status with an older one.
- A failed project refresh can hide the project list; a failed reply has no clear error message.
- Run snapshot timestamps are generated when normalized and can differ between renders.

## Credits

Brand lettering uses Pirulen artwork by Raymond Larabie ([usage terms](https://typodermicfonts.com/license/)).
The HUD status mark uses Anurati A.
