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
`.env`, add your keys, and run `./start` or `start.cmd` without `--mock`.
OpenRouter is needed for the Librarian; a Cerebras key is needed only for the
Cerebras model. To keep keys encrypted on disk, follow [RoboZ's encrypted-key
instructions](https://github.com/Tachion-Oy/roboz#endpoints-and-model-catalogues),
place `.env.encrypt` here, remove the plaintext keys from `.env`, and unlock
**API keys** in the HUD after starting live mode.
If both files exist, `.env.encrypt` does not override plaintext API keys in
`.env`. Those keys are loaded directly, and the unlock button can stay hidden.
Remove the API key entries from `.env` to use encrypted-key unlocking and avoid
keeping plaintext provider keys on disk.

Set `ROBOZIUM_WEB_PORT` in `.env` if port 6969 is busy. Mock and live projects
persist in separate Docker volumes. Ctrl+C stops the app without deleting them;
`docker compose down --volumes` deletes persistent state. For problems, run
`docker compose ps` and `docker compose logs --tail=200 api web`.

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
