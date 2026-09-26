# Changelog

## Unreleased

- Require successful WebKit tests alongside Chromium and Firefox. Preserve
  streamed message IDs in HTTP snapshots so recovered completion clears the
  HUD stream and history navigation remains correct when polling arrives first.

- Load private capabilities from a Git-ignored root `local/` package without
  editing tracked configuration. Mount the package read-only into the Docker
  API and keep it out of application images and distributions.

- Document repository-based use and public contributions. Expand the README
  with application concepts, configuration, module boundaries, and license
  information; add contribution, code-style, testing-practices, and security
  guides plus a PR template. Clarify validation and maintainer branch protection
  setup without changing runtime behavior.

- Rename the application and its runtime identifiers to Robozium. Replace the
  bundled display webfont with complete Pirulen outline artwork while retaining
  the Anurati A in the HUD. Pin RoboZ `0.1.2a2`, which includes the renamed
  recipe and consolidated Shed and Endpoints modules.

- Reduce PR CI to one job for unit tests, lint, and type checks. Run the complete
  browser, distribution, and Docker checks after merges to main or manually on
  a selected branch. Reuse one browser setup/build, cancel superseded runs, and
  upload only failure reports. Remove version/architecture matrices and WebKit
  stress repetitions.

- Add Docker Compose as the supported single-repository installation path on
  Windows, macOS, and Linux. Production API and standalone web images run as
  non-root users, persist mock and live hub state separately, publish only the web
  port on `6969`, and include one start interface with an explicit `--mock` flag plus a containerized
  first-use and restart-recovery browser gate. Startup remains attached for
  logs and Ctrl+C shutdown; mock mode advertises only its local mock endpoint.
  Remove the former native install, development, and aggregate-test launchers.

- Update Next.js and its matching ESLint configuration from 16.2.4 to 16.3.5
  to remove the critical production advisory reported for the previous pin.

- Migrate to concrete Roboz endpoints and typed `LLMEndpointRoute` selection.
  Each run retains its live model getter while fixed memory endpoints remain
  concrete. Replace dependency checker registrations with resources that own
  `check()`, and combine built-agent dependencies with selectable models and
  optional standalone resources in the health monitor. Deployment build,
  invocation, model switching, persistence, and cancellation order are preserved.

- Previously consume separate RoboZ, Shed, and Endpoints packages. Call Shed's
  `robozium()` recipe with the scoped project and deployment choices for each
  new run. Project context, agent defaults, and persistence stay in Shed;
  replies, model switching, cancellation, and streaming retain their lifecycle.
  Remove the obsolete `INTERACTION_MODE` configuration value; interaction is
  now bound by the API host per invocation, and deterministic agents use the
  explicit Roboz agent mode.

- Adopt shared `Deployment` and `DeployableAgent` composition with one fresh,
  project-scoped Sandbox per run. Paths and permissions come from that instance;
  the Python configuration retains all deployment choices and project context.
  Shared agent/tool definitions and host lifecycle behavior are unchanged.

- Replace the split workspace and persistence configuration with one `SANDBOX`.
  It is the sole source of project paths and tiered tool permissions; the API's
  `Project` remains an application-owned identity/lifecycle value. The default
  sandbox root is now `../Robozium`, outside the checkout, while tier names,
  project persistence names, and permission behavior remain unchanged.

- Install the tested Roboz, Shed, and Endpoints releases from PyPI. Development
  setup and installed browser tests no longer need a sibling Roboz checkout or
  a private-repository dependency token.

- Add a credential-free model-selection mock scenario and HTTP/browser checks that verify actual provider requests after active-run switching and isolation between runs.

- Type configuration exports with `HubValues` and select the shared `robozium` orientation/HUD skill. The shared deployment derives actual paths from `Sandbox` and the current project slug at construction time.

- Replace the split Python/JSON configuration with one editable `hub.config.py` containing named constants. Hub holds validated inputs and runtime selection directly; loading and slug helpers live in `hub.utils`. Logging defaults live in `hub.logging`.
- Consume shared deployment recipes, sandbox permissions, dependency routing, model selection, and health monitoring. The shared Robozium recipe binds capability choices to each project; local construction layers are removed.
- Select lazy endpoints from the RoboZ Endpoints inventory directly. Display labels map to endpoint objects, primitive identities drive model selection, and all advertised models are monitored.
- `create_app` accepts only Hub. Configure capabilities, policies, paths, health timings, transcription, and dependency registrations through the Python constants. JSON, builder exports, HubConfig wrappers, local endpoint schemas, and app-level overrides are removed.

### Fixed

- Keep projects syncing until the Librarian's final snapshot and memory
  consolidation complete after foreground agents stop, so terminal conversation
  facts are persisted before project actions resume.

- Pin the Shed development snapshot so configuration loading,
  tests, and frontend builds can import the concrete `robozium()` recipe.

- Provision the frontend CI job with Python and the resolved Roboz dependencies before loading `hub.config.py`; keep transcription assertions and generated test configuration isolated.

- Report completed WebKit test failures as advisory warnings with successful CI job checks, while retaining required setup and runner failures.

- Keep local editor reports, frontend build output, and development artifacts out of Python source distributions.

### Changed

- Test against the exact Roboz releases locked from PyPI. Full E2E builds fresh application candidates for installation and browser checks after merges or on manual request.

- Use RoboZ Shed for automatic context compaction, restoring the full continuation prompts and forwarding run cancellation and optional timeouts. Python consumers import the builder from `roboz.shed.tools`.

- Verify installed backends with the production frontend in Chromium, Firefox, and WebKit. E2E runs retain diagnostics and clean up their services and temporary data after failures or interruption.
