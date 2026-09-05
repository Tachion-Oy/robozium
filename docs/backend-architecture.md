# Backend ownership

The backend should be straightforward to configure and run, with clear ownership
of its state. HTTP routes translate requests into operations. The objects below
own the behavior behind those operations.

- **ProjectService owns projects on disk.** It creates and removes projects,
  checks their existence and activity, and coordinates project operations with
  the run registry. `prepare_run` checks the project and asks the manager to
  register or reuse a run; it does not start a worker. Its cancellation operation
  checks the project and asks the manager to cancel its runs.
- **RunManager owns the run registry.** It creates run records, finds existing
  runs, and selects them for operations such as `cancel_runs_for_project`.
  Each selected control handles its own cancellation. The registry lock prevents
  startup from racing with project deletion or application shutdown. Its private
  static execution method binds the API context, constructs and attaches the
  agent bundle, invokes the agent, and reports the outcome through the control.
- **RunControl owns one run’s lifecycle.** It creates, starts, and tracks the
  worker; handles cancellation, interruption, and user replies; and determines
  the final status. Checks and state changes that must happen together share
  its lock.
- **RunEvents owns the API’s event view.** It orders incoming events, maintains
  the displayed history, and delivers updates to subscribers.

On the request thread, `RunManager.start_run` resolves the run and passes its
work to `RunControl.launch_worker`, which creates and tracks the thread.
Inside that worker, the static `RunManager._run_agent` method binds the API
context, constructs the agent, and invokes it. The control receives a callable;
it has no dependency on the manager, and the callable never accesses manager state.

If cancellation arrives during agent construction, the control remembers it and
refuses execution when the bundle is attached. Lifecycle decisions have one owner
even though several components participate.

Run snapshots contain detached data. Worker handles, prompt storage, and event
dispatchers stay behind their owners’ operations.

Persisted agent activity flows through Roboz’s event pipe. Direct user
notifications are transient. Host completion can close an API stream even when
construction fails before an agent produces any events.

Deployment settings select models and provide the configuration from which agent
factories and dependency checks are assembled. Application lifespan owns
dependency monitoring, startup recovery, and worker shutdown. It registers use
of process logging: one process owner configures and closes the handlers.
Overlapping applications must use the same logging configuration; the final
release closes it and restores the previous logger settings.

When adding behavior, place it with the state or resource it governs.
Cross-component work should call that owner’s operations rather than reach into
its mutable state.

Automatic conversation compaction is provided by Roboz Shed. The orchestrator
composes its tool with the selected endpoint, a 60% threshold, and the same
event pipe that owns the agent's cancellation and interruption signals.
`compactify_timeout_s` optionally bounds each provider attempt; it defaults to
`None`. The shared tool owns its continuation prompts, history replacement,
status payload, and per-instance counter. Roboz core owns summarization.
