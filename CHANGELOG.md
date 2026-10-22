# Changelog

## Unreleased

- Attach images to desktop replies by pasting, dropping or choosing them with
  **image**, as in the web HUD: thumbnails while they upload, remove and
  **Retry images**, the same limits and messages, and image-only replies. Staged
  images stay when you switch views and return when the run is reopened.

- Display saved and web images inline in browser HUD responses, with compact
  previews, an accessible larger viewer, and an original-image link. Preserve
  image previews while output streams and show a fallback when images cannot load.
- Show the dependency monitor in the desktop Dependencies view: sortable records,
  **Check Now**, and copyable diagnostics, with **Restart backend** and
  **Recreate backend** for this installation's API container. In both apps the
  diagnostic's **Copy diagnostic** button now stays at body size in dark mode.

- Guide fresh live starts through API key setup in the web HUD. Without `.env` or
  `.env.encrypt`, the API reports `setup_required` from `GET /credentials` and
  holds provider actions; the HUD disables projects and header controls and
  replaces **New Project** with **Start Here**, an onboarding guide paged with the
  run view's message arrows. The guide adds keys in **Environment**, the only other
  view available during setup; the first save loads them into the API and unlocks
  the HUD without a restart. Mock mode is unaffected.

- Grow the desktop window to fit the message log when it opens, side by side or
  stacked, and restore the earlier size when it closes unless you resized it.
  Open at 1260×780 or the last size, zoom in 10% steps, remember size and zoom
  across launches, and bring the open window forward on a second launch.

- Show the desktop message log beside the HUD, or below it in narrow windows,
  from the toggle on the HUD's right edge. It lists the displayed run's
  messages, script output and agent lifecycle banners as in the reference, and
  shows the reference placeholder log when no run is active.

- Show desktop notifications as the reference toasts in both themes, with error,
  warning and success tones, Dismiss, and a five-second lifetime that pauses on
  hover. Preserve reply focus and use no inline styles under the renderer CSP.
  Show the backend error when an accepted run fails during execution.

- Send pasted, dropped, or selected images in web replies, including image-only
  replies. Upload while a run is processing, restore pending previews after
  refresh, and remove or clear pending images through standard DELETE endpoints.
  Keep drafts on failure, avoid duplicate uploads on retry, and retain accepted
  files until the run's workers stop.

- Preview pasted, dropped, or selected images in the web reply composer, with
  run-scoped drafts and removal/clearing controls.

- Start selected projects from the desktop HUD and display live output, prompts,
  history, and completion. Preserve drafts and output on errors, keep one session
  across views, and retry output without creating another run. Standalone preview
  remains available; replies and cancellation controls are still deferred.
  Separate run reconciliation from desktop HUD selection, clear abandoned model
  attempts, keep active prompts and settling progress visible, and process token
  updates without rebuilding completed history. Keep recovered script entries
  uniquely selectable, apply repeated events to stale live text, and preserve
  script boundaries across prompts and history recovery.

- Connect desktop Runs Overview to backend project listing, creation, and selection,
  and the model dropdown to the backend default. Preserve drafts and confirmed
  selections on failure, keep model refresh separate from write retry, and reload
  backend model state after reconnect. Retain the local mock history under Preview run.

- Display image-omission notices as information and keep the chat usable while
  unsupported attachments are omitted. Integration tests cover restoring uploads
  after switching back to a vision model. Pin the published RoboZ 0.14.0a1 release
  that supplies the graceful image handling.

- Connect the desktop renderer directly to the Python API with HTTP/SSE transport,
  desktop Host/Origin checks, readiness polling, and connection Retry that preserves
  the mounted HUD and does not restart Docker.

- Stage pasted images in a run's temporary folder and attach them when its JSON
  reply is submitted, using RoboZ 0.14.0a1. Clean temporary files after workers
  stop and remove leftovers on hub startup. Configure image limits through
  `ATTACHMENTS` in `hub.config.py`. RoboZ handles model compatibility when
  preparing requests. Stream text and file links without inline image
  payloads in SSE messages.

- Manage desktop backend startup and shutdown from Electron main, with image
  reuse, startup status and retry, cancellation, and ownership-checked shutdown
  that preserves runtime data. Pin the selected Docker context through retries and
  cleanup so context switches cannot leave the original backend running. Keep a
  separate Docker-free UI preview command.


- Add desktop-owned Docker configuration for manual live and mock API startup,
  with isolated runtime data, credential-free build staging, and restart checks.

- Open each selected desktop history message at the top while preserving the
  reply draft, editor scroll position, and text selection.

- Add the desktop Current Run footer with three-message history, Clear reply,
  exact native clipboard copying, accessible success/failure feedback, and
  centered controls that wrap while retaining focus. Sending and run actions
  remain disabled previews.

- Keep both desktop selectors stable across label changes while shrinking in
  narrow windows, center the divider arrows in square light-theme buttons, and
  animate panel resizing with the web HUD’s 220ms easing.

- Start a desktop mock run from Runs Overview, with opaque message/reply panels,
  a retained multiline draft, and keyboard-accessible three-position divider controls.

- Enable desktop model/view selectors with keyboard navigation and local choices;
  show placeholder panels for Runs Overview, Dependencies, and Environment.

- Add the desktop HUD header with shared buttons, disabled model/secrets/view
  previews, and a working theme toggle that fits narrow windows and native zoom.
- Make desktop Ctrl zoom shortcuts work with plus/equal and keypad keys.

- Add the full-window Robozium frame with dark and light themes and bundled HUD typography.

- Keep the web HUD outer glow at full strength while waiting, streaming, and after completion.

- Render the Robozium Electron app with React and Vite, serving bundled assets through
  a restricted local protocol while keeping the browser application independent.

- Add a Linux Electron scaffold with a native window, a typed version bridge,
  and required native startup, isolation, and shutdown checks.

- Wrap HUD table headers and cells within the panel, keeping readable minimum
  column widths and horizontal scrolling for tables with too many columns.
- Keep dependency metadata and diagnostics within their table cells in both themes.

- Show Environment save confirmations and example-file errors through toasts.

- Add a confirmed Environment reset for forgotten passwords. Delete saved settings
  and secrets without the old password; retain imported packages and manual `.env` settings.

- Keep the Environment encryption password fields inactive until there are changes to save.

- Add the Environment editor with browser folder uploads into fixed
  `local/imports/` storage. Validate package files and exported capabilities,
  confirm their actual names immediately, and activate them after restart.
  Preserve the Environment UI and use RoboZ 0.11 for encrypted variable editing;
  recreate legacy encrypted settings using `_ENCRYPTED` storage names. Mark the
  initial application variables `[required]` and prefill editable example defaults.
  Validate upload paths before copying, preserve quoted example values, and detect
  concurrent settings changes before replacing the file.
  Report invalid edits, passwords, and imports through error toasts. Match the
  Secret toggle to the other action buttons and use the red style.

- Remove built-in email construction and registration. Import optional email and
  timesheets packages through the HUD; capability settings come from the
  application root environment. Docker loads root `.env.encrypt` and `.env`
  generically while preserving container-owned settings.

- Load private packages from `local/`; import external packages through the HUD.
  Resolve all requirements together and fail startup on incompatible dependencies.

- Discover CLI-created capability packages in `local/tools/` and `local/skills/`
  on each API restart. Create them with `uv run --locked roboz tool init` or
  `uv run --locked roboz skill init`, then select them in live mode. Migrate
  existing registries to individual packages exporting `CAPABILITY`, preserving
  label names for saved selections. Parent registries are no longer executed;
  private source files are preserved. Remove shipped private samples and launcher
  registration copying. Mock mode keeps its scripted capabilities.

- Own the Robozium deployment recipe and HUD guidance skill in
  `robozium.hub.deployment` and `robozium.hub.skills`. These replace the
  application-specific imports from RoboZ's Shed. Pin RoboZ `0.9.1` with the
  unified CLI. Agent behavior and persistence paths are unchanged.

- Use Docker host networking to connect directly to a host-installed Proton Mail
  Bridge. Bind API and web listeners to localhost. Docker Desktop users must
  enable host networking in version 4.34 or newer.

- Show external dependency failure messages and linked causes in the HUD, with
  a Copy diagnostic action. Preserve the same diagnostic in backend technical
  logs through RoboZ's shared dependency checker. Pin RoboZ 0.7.0a1 for the
  shared dependency-check contract.

- Separate capability discovery and project selection persistence into a
  capabilities router with catalogue, read, and write endpoints. Store choices
  in project JSON independently of run creation and retain them across restarts.
  Wire the HUD through the BFF: Tools restores saved choices, direct Launch uses
  them, and Cancel discards edits. Save before launching, retain skill loading
  modes, and allow failed launches to retry without recreating the project.
- Reject duplicate project creation to protect existing choices.

- Add a per-launch HUD capability selector for new and existing projects, with
  fixed defaults shown in faded green and saved optional choices restored.
- Add blue Tools row actions for capability selection and green Launch actions
  for starting with saved choices, compact the runs table, and remove the redundant
  Agent column.
- Add hover feedback to HUD launch controls without changing their size, and
  prevent Enter in the project name field from starting a run.
- Make the light-mode HUD frame shadow dimmer and symmetric.
- Keep Launch as a separate HUD view, retain drafts across view changes, and
  report launch failures even when the HUD has been dismissed.
- Retain model choices per scope when switching between Launch and active-run
  views, including model saves that finish after switching views.
- Remove the redundant `current_agent_name` field from project-list summaries.
- Offer selectable mock tool and skill examples and cover capability changes
  when relaunching a project with existing memory.
- Ship an optional Simpsons quote capability and seed ignored local registration
  from a commented template without overwriting private configuration.
- Document the RoboZ `0.6.1a1` migration for private capabilities and supply a
  working selectable skill example, validated during Docker onboarding.

- Pin RoboZ `0.6.1a1` for deployment capability selection and built-in tools.

- Accept orchestrator capability choices when creating a run, expose the
  capability catalog and effective run selection, and keep choices in memory.
  Built-ins belong to Robozium's deployment definition; app additions come from
  `local/`. SafeScripts and Proton Bridge email are selectable.

- Keep the HUD above the title in both themes when returning from a run or
  resizing into an overlap, and fade the returning title in smoothly.

- Pin RoboZ `0.5.0rc1`. Guarded file tool reports now preserve permission
  questions, exact replies, and decisions, including declined approvals.

- Coordinate frontend polling and stream-recovery snapshots so delayed responses
  cannot restore an older run status or prompt. Show failed replies in a toast
  while keeping the draft available for retry. Remove browser-generated lifecycle
  timestamps that changed when reopening a run.

- Upgrade RoboZ to `0.5.0a1` with its tagged file-command CLI for guarded
  discovery, reading, writing, transfers, and deletion. Include `gio trash`
  support in the API container. Saved calls using the old CLI input must be
  converted before replay; existing hub data is preserved.

- Render the landing title glow independently of clipped accessibility text.
  Scale the title to narrow viewports and keep the landing HUD below it as
  the browser's reported visible viewport changes. Keep hover glow updates
  static to avoid animating blur filters.
  Let the landing page scroll when the visible viewport cannot fit the HUD's
  minimum height, keeping its controls reachable when a keyboard appears.

- Start Docker Compose directly; missing Process Compose or failed optional host
  processes no longer prevent live or mock application startup.

- Add bottom padding to background message logs so the final badge and inline
  tag effects are not clipped in either theme.

- Enable Groq Whisper voice transcription in the default live configuration.

- Private `LocalTool` declarations now install their own Python requirements at
  API startup before their capabilities are loaded.

- Include LibreOffice in the API container for document conversion tools.

- Supervise RoboZ's SafeScripts service on Linux live runs
  through the Process Compose inventory. Keep mock runs isolated from host services.

## Published (through 2026-09-27)

- Update the pinned RoboZ dependency to `0.2.1a1` and adapt encrypted credential
  loading to its `load_secrets` API and native `*_SECRET` names. Check for future
  RoboZ updates daily with Dependabot.

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
