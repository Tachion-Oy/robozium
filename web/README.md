# RoboSprawl frontend

Next.js terminal UI for the RoboSprawl API. Install and launch from the repository root using `./scripts/install.sh` and `./scripts/dev.sh`.

For direct commands, first source `../scripts/env.sh` and set `ROBOSPRAWL_API_BASE_URL=http://127.0.0.1:8000`. Use `npm run test:run` for unit tests. `npm run test:e2e` starts an isolated mock backend and Chromium; `npm run test:e2e:all-browsers` runs all three browsers sequentially. See the root README for required gates and artifact paths.
