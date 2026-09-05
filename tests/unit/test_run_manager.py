"""RunManager + WaitRegistry integration (no HTTP)."""

import time
from collections.abc import Sequence
from datetime import datetime, timezone
from pathlib import Path
from threading import Event, Lock
from typing import Any, cast

import pytest
from roboz import Agent
from roboz.agent import SubagentCtx, run_subagent
from roboz.llm import LLMEndpoint, MockLLMEndpoint
from roboz.models import Empty, Message, MessageKind, Role, Str
from roboz.runtime import Output
from roboz.runtime.events import (
    EventSink,
    MessageDeltaEvent,
    MessageEvent,
    RunLifecycleEvent,
    RuntimeEvent,
    ScriptOutputEvent,
)
from roboz.runtime.persistence import (
    ConversationRun,
    clear_conversation_active,
    mark_conversation_active,
    utc_iso_z,
)
from roboz.runtime.pipe import EventPipe
from roboz.tooling import ExternalDependencyKind, LazyExternalDependency
from roboz.tooling.decorators import tool
from roboz.tools import MessageCtx, prompt_user_at_start, stop

from robosprawl.api.errors import (
    ProjectBusyError,
    ProjectCancellationInProgressError,
)
from robosprawl.api.run_manager import RunManager
from robosprawl.api.state import (
    STATUS_CANCELLING,
    STATUS_COMPLETED,
    STATUS_FAILED,
    STATUS_RUNNING,
    RootAgentBundle,
    RunState,
)
from robosprawl.api.user_io import ApiUserIO
from robosprawl.api.wait_registry import WaitRegistry
from robosprawl.composition import (
    BuildContext,
    OrchestratorConstructor,
    PersistencePaths,
    ProjectPaths,
)
from robosprawl.deployment import OrchestratorEndpointRoute
from robosprawl.hub import hub_paths
from robosprawl.identifiers import LIBRARIAN_AGENT_NAME, ORCHESTRATOR_AGENT_NAME
from robosprawl.orchestrator_factory import (
    OrchestratorEndpointGetter,
    OrchestratorFactory,
)
from robosprawl.workspace import Project, Sandbox, SandboxNames


@tool
def entry(input: Empty, messages: list[Message]) -> Str:
    return Str(value="question")


@tool
def busy(input: Empty, messages: list[Message]) -> Str:
    """Spin forever in short Python steps so an injected interrupt can land."""
    while True:
        time.sleep(0.02)
    return Str(value="unreachable")  # noqa: B007 — keeps the return type honest




def _busy_factory(
    project: Project,
    /,
    *,
    endpoint_getter: OrchestratorEndpointGetter,
    event_sinks: Sequence[EventSink],
) -> RootAgentBundle:
    """A run that gets stuck inside a tool, i.e. RUNNING (not awaiting input)."""
    del project, endpoint_getter
    endpoint = MockLLMEndpoint(responses=[{"action": "busy", "rationale": "spin"}])
    return _root_bundle(
        Agent(
            interaction_mode=Output.API,
            event_sinks=event_sinks,
            name="busy_test",
            tools=[busy, stop],
            system_prompt="Busy spin agent.",
            agent_endpoint=endpoint,
            initial_messages=None,
        )
    )


def _wait_status(
    manager: RunManager, run_id: str, statuses: set[str], timeout: float = 15.0
) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        view = manager.run_view(run_id)
        assert view is not None
        if view["status"] in statuses:
            return dict(view)
        time.sleep(0.02)
    raise AssertionError(f"status not in {statuses}: {manager.run_view(run_id)}")


NAMES = SandboxNames(
    readonly="readonly",
    workspace="workspace",
    projects="projects",
    safe_scripts="safe-scripts",
)


def _project(slug: str = "alpha") -> Project:
    return Project(
        sandbox=Sandbox(root=Path(__file__).resolve().parents[2] / ".artifacts" / "test-sandbox", names=NAMES),
        slug=slug,
        subdirs={
            "logs": "conversation_logs",
            "snapshots": "snapshots",
            "memory": "memory",
        },
    )


def _minimal_api_agent_for_manager_test(
    project: Project,
    /,
    *,
    endpoint_getter: OrchestratorEndpointGetter,
    event_sinks: Sequence[EventSink],
) -> RootAgentBundle:
    del project, endpoint_getter
    endpoint = MockLLMEndpoint(
        responses=[
            {"action": "entry", "rationale": "ask"},
            {"action": "stop", "rationale": "done", "value": "ok"},
        ]
    )
    start_only = prompt_user_at_start(MessageCtx(message="m"))
    return _root_bundle(
        Agent(
            interaction_mode=Output.API,
            event_sinks=event_sinks,
            name="manager_api_test",
            tools=[entry, stop],
            system_prompt="Run manager API test agent.",
            default_tools=[start_only],
            custom_prompt_user_tool=None,
            agent_endpoint=endpoint,
            initial_messages=None,
        )
    )


def _lazy_manager_endpoint(name: str) -> LazyExternalDependency[LLMEndpoint]:
    return LazyExternalDependency(
        dependency_id_value=f"model:test:{name}",
        dependency_kind=ExternalDependencyKind.MODEL_ENDPOINT,
        metadata={
            "api_name": "test",
            "model_name": name,
            "endpoint_type": "llm",
        },
        resolver=lambda: LLMEndpoint(
            client=object(),
            api_name="test",
            model_name=name,
        ),
    )


_TEST_DEFAULT_ENDPOINT = _lazy_manager_endpoint("default")


def _root_bundle(agent: Agent) -> RootAgentBundle:
    return RootAgentBundle(agent=agent, background_agents=())


def _manager(
    factory: OrchestratorFactory, *, hub_name: str, **kwargs: Any
) -> RunManager:
    return RunManager(
        factory,
        hub_name=hub_name,
        default_orchestrator_endpoint=lambda: _TEST_DEFAULT_ENDPOINT,
        **kwargs,
    )


def test_run_executor_builds_a_route_that_closes_over_its_run_state() -> None:
    first = _lazy_manager_endpoint("first")
    second = _lazy_manager_endpoint("second")
    static_route = OrchestratorEndpointRoute(lambda: first)
    waiting_for_change = Event()
    continue_run = Event()
    resolved_models: list[str] = []

    def run_factory(
        project: Project,
        /,
        *,
        endpoint_getter: OrchestratorEndpointGetter,
        event_sinks: Sequence[EventSink],
    ) -> Any:
        route = OrchestratorEndpointRoute(endpoint_getter)

        class ProbeAgent:
            def __init__(self) -> None:
                self.pipe = EventPipe()

            def invoke(self) -> None:
                waiting_for_change.set()
                assert continue_run.wait(timeout=5.0)
                resolved_models.append(route.materialize().model_name)

        del project, event_sinks
        resolved_models.append(route.materialize().model_name)
        return RootAgentBundle(
            agent=cast(Agent, ProbeAgent()),
            background_agents=(),
        )

    # Dependency inspection and other construction outside a run sees the
    # configured static default.
    assert static_route.materialize().model_name == "first"

    manager = RunManager(
        run_factory,
        hub_name="TestHub",
        default_orchestrator_endpoint=lambda: first,
    )
    run_id = manager.create(_project())
    assert manager.start_if_needed(run_id)
    assert waiting_for_change.wait(timeout=5.0)

    manager.replace_orchestrator_endpoint(run_id, second)
    continue_run.set()

    assert _wait_status(manager, run_id, {"completed"})["status"] == "completed"
    assert resolved_models == ["first", "second"]


def _write_hub_config(root: Path) -> None:
    (root / "hub.config.json").write_text(
        """{
  "hub": {"name": "TestHub"},
  "logging": {
    "console": {"level": "INFO"},
    "file": {
      "path": "technical_logs/backend.jsonl",
      "level": "DEBUG",
      "max_bytes": 26214400,
      "backup_count": 5,
      "on_error": "fail"
    }
  },
  "sandbox": {
    "root": "workspace",
    "readonly": "readonly",
    "workspace": "workspace",
    "projects": "projects",
    "safe_scripts": "safe-scripts"
  },
  "project": {
    "logs": "conversation_logs",
    "snapshots": "conversation_snapshots",
    "memory": "persistent_memory"
  }
}
""",
        encoding="utf-8",
    )


def test_run_manager_api_user_io_unblocks_on_resolve() -> None:
    def factory(
        project: Project,
        /,
        *,
        endpoint_getter: OrchestratorEndpointGetter,
        event_sinks: Sequence[EventSink],
    ) -> RootAgentBundle:
        return _minimal_api_agent_for_manager_test(
            project,
            endpoint_getter=endpoint_getter,
            event_sinks=event_sinks,
        )

    manager = _manager(factory, hub_name="TestHub")
    run_id = manager.create(_project())
    assert manager.start_if_needed(run_id)

    deadline = time.monotonic() + 15.0
    prompt_id = None
    while time.monotonic() < deadline:
        view = manager.run_view(run_id)
        assert view is not None
        if view["status"] == "awaiting_user_input":
            prompt_id = view["current_prompt_id"]
            assert view["current_prompt"] is not None
            break
        if view["status"] in ("failed", "completed"):
            raise AssertionError(f"unexpected terminal state: {view}")
        time.sleep(0.05)
    assert prompt_id is not None

    manager.submit_reply(run_id, prompt_id, "from http client")

    while time.monotonic() < deadline:
        view = manager.run_view(run_id)
        assert view is not None
        if view["status"] in ("completed", "failed"):
            break
        time.sleep(0.05)

    assert view["status"] == "completed"




def _orchestrator_build_ctx(tmp_path: Path) -> BuildContext:
    paths = hub_paths(start=tmp_path)
    sandbox = Sandbox(root=paths.resolved_root, names=NAMES)
    return BuildContext(
        paths=ProjectPaths(
            sandbox=sandbox,
            project_root=sandbox.project_dir(ORCHESTRATOR_AGENT_NAME),
            base_dir=sandbox.resolved_root,
            slug=ORCHESTRATOR_AGENT_NAME,
            persistence=PersistencePaths(
                logs_root=paths.resolved_root / "conversation_logs",
                snapshots_root=paths.resolved_root / "conversation_snapshots",
                memory_root=paths.resolved_root / "persistent_memory",
            ),
        )
    )


def test_orchestrator_cli_is_deterministic_without_singleton(
    tmp_path: Path,
) -> None:
    _write_hub_config(tmp_path)
    built = OrchestratorConstructor(
        agent_endpoint=MockLLMEndpoint(responses=[]),
        seed_initial_messages_from_memory=False,
    ).build(_orchestrator_build_ctx(tmp_path))
    ref = OrchestratorConstructor(
        agent_endpoint=MockLLMEndpoint(responses=[]),
        seed_initial_messages_from_memory=False,
    ).build(_orchestrator_build_ctx(tmp_path))
    assert {t.name for t in built.active_tools.values()} == {
        t.name for t in ref.active_tools.values()
    }
    assert built.system_prompt == ref.system_prompt
    assert built.interaction_mode == Output.CLI


def test_wait_registry_resolve_before_wait_returns_immediately() -> None:
    reg = WaitRegistry()
    reg.register("p1")
    assert reg.resolve("p1", "early")
    assert reg.wait("p1", timeout_s=1.0) == "early"


def test_api_user_io_returns_none_when_prompt_times_out() -> None:
    state = cast(
        RunState,
        {"current_prompt_id": None, "current_prompt": None, "status": STATUS_RUNNING},
    )
    io = ApiUserIO(WaitRegistry(), state, Lock(), lambda _event: None)

    # A real (tiny) timeout: if it were not forwarded to the registry's event.wait,
    # this would block forever instead of returning None.
    assert io.request_input("question?", timeout=0.01) is None
    assert state["current_prompt_id"] is None


def test_api_user_io_notify_streams_message_event_to_sink() -> None:
    """Generic one-way notify output must reach the run event sink."""
    state = cast(
        RunState,
        {"current_prompt_id": None, "current_prompt": None, "status": STATUS_RUNNING},
    )
    emitted: list[object] = []
    io = ApiUserIO(WaitRegistry(), state, Lock(), emitted.append)

    io.notify("buzz line 1\n")
    io.notify("buzz line 2\n")

    assert len(emitted) == 2
    first = emitted[0]
    assert isinstance(first, MessageEvent)
    assert first.message.role == Role.ASSISTANT
    assert first.message.content == "buzz line 1\n"
    assert first.message.message_kind == MessageKind.USER_NOTIFICATION
    assert state["status"] == STATUS_RUNNING
    assert state["current_prompt_id"] is None
    assert state["current_prompt"] is None
    # The manager owns final run sequencing; ApiUserIO emits a placeholder.
    assert isinstance(emitted[1], MessageEvent)
    assert first.sequence == 0
    assert emitted[1].sequence == 0


def test_manager_sequences_and_replays_user_notifications() -> None:
    manager = _manager(_minimal_api_agent_for_manager_test, hub_name="TestHub")
    run_id = manager.create(_project())
    state = manager._runs[run_id]
    io = ApiUserIO(
        manager._wait_registry,
        state,
        manager._lock,
        manager._events.sink(run_id),
    )

    io.notify("first")
    io.notify("second")

    view = manager.run_view(run_id)
    assert view is not None
    notifications = [
        entry
        for entry in view["message_trace"]
        if entry["type"] == "message"
        and entry["payload"]["message_kind"] == MessageKind.USER_NOTIFICATION
    ]
    assert [entry["sequence"] for entry in notifications] == [1, 2]
    assert [entry["payload"]["content"] for entry in notifications] == [
        "first",
        "second",
    ]
    assert all(entry["payload"]["role"] == Role.ASSISTANT for entry in notifications)


def test_manager_assigns_one_sequence_space_to_mixed_run_events() -> None:
    def factory(
        project: Project,
        /,
        *,
        endpoint_getter: OrchestratorEndpointGetter,
        event_sinks: Sequence[EventSink],
    ) -> RootAgentBundle:
        return _minimal_api_agent_for_manager_test(
            project,
            endpoint_getter=endpoint_getter,
            event_sinks=event_sinks,
        )

    manager = _manager(factory, hub_name="TestHub")
    run_id = manager.create(_project())
    delivered: list[object] = []
    manager.subscribe_event_listener(run_id, delivered.append)

    manager._events.dispatch(  # noqa: SLF001 - regression covers event normalization.
        run_id,
        RunLifecycleEvent(kind="started", agent_name="agent", sequence=99),
    )
    manager._events.dispatch(  # noqa: SLF001
        run_id,
        ScriptOutputEvent(content="line", sequence=1),
    )
    manager._events.dispatch(  # noqa: SLF001
        run_id,
        RuntimeEvent(
            category="llm",
            kind="failed",
            level="error",
            message="auth failed",
            sequence=1,
            agent_name="agent",
            data={"error_kind": "auth"},
        ),
    )
    manager._events.dispatch(  # noqa: SLF001
        run_id,
        MessageEvent(Message(role=Role.USER, content="done"), sequence=1),
    )

    assert [getattr(event, "sequence") for event in delivered] == [1, 2, 3, 4]
    view = manager.run_view(run_id)
    assert view is not None
    trace_sequences = [
        entry["sequence"] if "sequence" in entry else entry["payload"]["sequence"]
        for entry in view["message_trace"]
    ]
    assert trace_sequences == [1, 2, 3, 4]
    assert view["message_trace"][2]["type"] == "runtime_event"
    message_entry = view["message_trace"][3]
    assert message_entry["type"] == "message"
    assert message_entry["payload"]["message_kind"] is None


def test_manager_forwards_message_deltas_without_trace_pollution() -> None:
    def factory(
        project: Project,
        /,
        *,
        endpoint_getter: OrchestratorEndpointGetter,
        event_sinks: Sequence[EventSink],
    ) -> RootAgentBundle:
        return _minimal_api_agent_for_manager_test(
            project,
            endpoint_getter=endpoint_getter,
            event_sinks=event_sinks,
        )

    manager = _manager(factory, hub_name="TestHub")
    run_id = manager.create(_project())
    delivered: list[object] = []
    manager.subscribe_event_listener(run_id, delivered.append)

    manager._events.dispatch(  # noqa: SLF001 - regression covers event normalization.
        run_id,
        MessageDeltaEvent(
            message_id="m1",
            delta="hel",
            chunk_index=1,
            role=Role.ASSISTANT,
            agent_name="agent",
            sequence=99,
        ),
    )
    manager._events.dispatch(  # noqa: SLF001
        run_id,
        MessageDeltaEvent(
            message_id="m1",
            delta="lo",
            chunk_index=2,
            role=Role.ASSISTANT,
            agent_name="agent",
            sequence=99,
        ),
    )
    manager._events.dispatch(  # noqa: SLF001
        run_id,
        MessageEvent(
            Message(role=Role.ASSISTANT, content="hello"),
            sequence=99,
            message_id="m1",
        ),
    )

    assert [getattr(event, "sequence") for event in delivered] == [1, 2, 3]
    assert isinstance(delivered[0], MessageDeltaEvent)
    assert isinstance(delivered[1], MessageDeltaEvent)
    assert isinstance(delivered[2], MessageEvent)
    assert delivered[2].message_id == "m1"

    view = manager.run_view(run_id)
    assert view is not None
    assert len(view["message_trace"]) == 1
    assert view["message_trace"][0]["type"] == "message"


def test_nested_subagent_lifecycle_events_reach_run_event_listeners() -> None:
    """The hub run sink is passed explicitly into parent and child agent pipes."""
    collected: list[object] = []

    def factory(
        project: Project,
        /,
        *,
        endpoint_getter: OrchestratorEndpointGetter,
        event_sinks: Sequence[EventSink],
    ) -> RootAgentBundle:
        del project, endpoint_getter
        child = Agent(
            name="child_agent",
            interaction_mode=Output.API,
            event_sinks=event_sinks,
            tools=[stop],
            system_prompt="Child agent.",
            agent_endpoint=MockLLMEndpoint(
                responses=[
                    {
                        "action": "stop",
                        "rationale": "child done",
                        "value": "from_child",
                    },
                ]
            ),
        )
        run_child = run_subagent(SubagentCtx(child)).copy(name="delegate")
        return _root_bundle(
            Agent(
                name="parent_orchestrator",
                interaction_mode=Output.API,
                event_sinks=event_sinks,
                tools=[run_child, stop],
                system_prompt="Parent.",
                agent_endpoint=MockLLMEndpoint(
                    responses=[
                        {"action": "delegate", "rationale": "call child"},
                        {"action": "stop", "rationale": "parent done", "value": "ok"},
                    ]
                ),
            )
        )

    manager = _manager(factory, hub_name="TestHub")
    run_id = manager.create(_project())
    capture = lambda e: collected.append(e)  # noqa: E731
    manager.subscribe_event_listener(run_id, capture)
    assert manager.start_if_needed(run_id)

    deadline = time.monotonic() + 30.0
    try:
        while time.monotonic() < deadline:
            view = manager.run_view(run_id)
            if view is None:
                break
            if view["status"] in ("completed", "failed"):
                assert view["status"] == "completed"
                break
            time.sleep(0.05)
        else:
            raise AssertionError("run did not complete")

        lifecycle = [e for e in collected if isinstance(e, RunLifecycleEvent)]
        started = {e.agent_name for e in lifecycle if e.kind == "started"}
        assert "child_agent" in started
        assert "parent_orchestrator" in started
        stops = [e for e in lifecycle if e.kind == "stopped"]
        assert stops[-1].agent_name == "parent_orchestrator"
    finally:
        manager.unsubscribe_event_listener(run_id, capture)


def test_manager_create_stores_project_slug() -> None:
    manager = _manager(_minimal_api_agent_for_manager_test, hub_name="TestHub")
    run_id = manager.create(_project("my-project"))

    view = manager.run_view(run_id)
    assert view is not None
    assert view["project"] == "my-project"
    assert [run["project"] for run in manager.list_project_runs()] == ["my-project"]


def test_manager_create_returns_existing_active_run_for_project() -> None:
    manager = _manager(_minimal_api_agent_for_manager_test, hub_name="TestHub")
    first = manager.create(_project("my-project"))
    second = manager.create(_project("my-project"))
    other_project = manager.create(_project("other-project"))

    assert second == first
    assert other_project != first
    assert {run["run_id"] for run in manager.list_project_runs()} == {
        first,
        other_project,
    }


def test_manager_create_returns_existing_run_during_librarian_overlap() -> None:
    manager = _manager(_minimal_api_agent_for_manager_test, hub_name="TestHub")
    project = _project("my-project")
    existing_run = manager.create(project)

    assert manager.create(project, background_sync_active=True) == existing_run


def test_manager_create_allocates_new_run_after_project_completes() -> None:
    manager = _manager(_minimal_api_agent_for_manager_test, hub_name="TestHub")
    first = manager.create(_project("my-project"))
    with manager._lock:
        state = manager._runs[first]
        state["status"] = STATUS_COMPLETED
        state["completed_at"] = time.time()

    second = manager.create(_project("my-project"))

    assert second != first


def test_manager_create_allocates_new_run_after_project_fails() -> None:
    manager = _manager(_minimal_api_agent_for_manager_test, hub_name="TestHub")
    first = manager.create(_project("my-project"))
    with manager._lock:
        state = manager._runs[first]
        state["status"] = STATUS_FAILED
        state["completed_at"] = time.time()

    second = manager.create(_project("my-project"))

    assert second != first


def test_manager_create_rejects_new_run_while_background_sync_is_active(
    tmp_path: Path,
) -> None:
    manager = _manager(_minimal_api_agent_for_manager_test, hub_name="TestHub")
    project = _tmp_project(tmp_path, "my-project")

    with pytest.raises(ProjectBusyError, match="synchronization"):
        manager.create(project, background_sync_active=True)


def test_manager_create_allows_new_run_when_background_sync_is_not_active(
    tmp_path: Path,
) -> None:
    manager = _manager(_minimal_api_agent_for_manager_test, hub_name="TestHub")
    project = _tmp_project(tmp_path, "my-project")

    run_id = manager.create(project)

    assert manager.run_view(run_id) is not None


def test_manager_create_rejects_blank_project_slug() -> None:
    manager = _manager(_minimal_api_agent_for_manager_test, hub_name="TestHub")
    with pytest.raises(ValueError, match="project slug"):
        manager.create(_project("   "))


def test_manager_start_if_needed_is_idempotent() -> None:
    manager = _manager(_minimal_api_agent_for_manager_test, hub_name="TestHub")
    run_id = manager.create(_project())
    assert manager.start_if_needed(run_id)
    assert not manager.start_if_needed(run_id)
    state = manager.get_run(run_id)
    assert state is not None
    thread = state["thread"]
    assert thread is not None
    assert thread.name == f"TestHub-run-{run_id[:8]}"


def test_manager_cancel_awaiting_input_marks_cancelled() -> None:
    manager = _manager(_minimal_api_agent_for_manager_test, hub_name="TestHub")
    run_id = manager.create(_project())
    assert manager.start_if_needed(run_id)
    _wait_status(manager, run_id, {"awaiting_user_input"})

    assert manager.cancel(run_id) is True
    assert _wait_status(manager, run_id, {"cancelled"})["status"] == "cancelled"


def test_manager_cancel_running_thread_marks_cancelled() -> None:
    manager = _manager(_busy_factory, hub_name="TestHub")
    run_id = manager.create(_project())
    assert manager.start_if_needed(run_id)
    _wait_status(manager, run_id, {"running"})
    time.sleep(0.1)  # let the thread enter the busy tool loop
    running_state = manager.get_run(run_id)
    assert running_state is not None
    run_pipe = running_state["pipe"]
    assert run_pipe is not None
    assert run_pipe.cancelled is False

    assert manager.cancel(run_id) is True
    assert run_pipe.cancelled is True
    assert _wait_status(manager, run_id, {"cancelled"})["status"] == "cancelled"

    # The interrupted worker thread must actually unwind (this is the delete gate).
    state = manager.get_run(run_id)
    assert state is not None
    thread = state["thread"]
    assert thread is not None
    deadline = time.monotonic() + 5.0
    while thread.is_alive() and time.monotonic() < deadline:
        time.sleep(0.02)
    assert not thread.is_alive()


def test_manager_interrupt_running_thread_prompts_user_and_keeps_run_alive() -> None:
    manager = _manager(_busy_factory, hub_name="TestHub")
    run_id = manager.create(_project())
    assert manager.start_if_needed(run_id)
    _wait_status(manager, run_id, {"running"})
    time.sleep(0.1)
    running_state = manager.get_run(run_id)
    assert running_state is not None
    run_pipe = running_state["pipe"]
    assert run_pipe is not None
    assert run_pipe.interrupted is False

    assert manager.interrupt(run_id) is True
    assert run_pipe.interrupted is True
    view = _wait_status(manager, run_id, {"awaiting_user_input"})
    assert view["status"] == "awaiting_user_input"
    assert view["current_prompt"] is not None


def test_manager_interrupt_terminal_run_returns_false() -> None:
    manager = _manager(_minimal_api_agent_for_manager_test, hub_name="TestHub")
    run_id = manager.create(_project())
    with manager._lock:
        state = manager._runs[run_id]
        state["status"] = STATUS_COMPLETED
        state["completed_at"] = time.time()
    assert manager.interrupt(run_id) is False


def test_manager_cancel_returns_false_when_terminal() -> None:
    manager = _manager(_minimal_api_agent_for_manager_test, hub_name="TestHub")
    run_id = manager.create(_project())
    with manager._lock:
        manager._runs[run_id]["status"] = STATUS_COMPLETED
        manager._runs[run_id]["completed_at"] = time.time()

    assert manager.cancel(run_id) is False


def test_manager_cancel_queued_run_marks_cancelled_and_blocks_start() -> None:
    manager = _manager(_minimal_api_agent_for_manager_test, hub_name="TestHub")
    run_id = manager.create(_project())

    assert manager.cancel(run_id) is True
    view = manager.run_view(run_id)
    assert view is not None
    assert view["status"] == "cancelled"
    assert manager.start_if_needed(run_id) is False


def test_manager_completes_immediately_after_root_exits_even_with_librarian() -> None:
    background = _stub_background_agent()

    def factory(
        project: Project,
        /,
        *,
        endpoint_getter: OrchestratorEndpointGetter,
        event_sinks: Sequence[EventSink],
    ) -> RootAgentBundle:
        del project, endpoint_getter
        root = Agent(
            interaction_mode=Output.API,
            event_sinks=event_sinks,
            name="syncing_root",
            tools=[stop],
            system_prompt="Completes immediately.",
            agent_endpoint=MockLLMEndpoint(
                responses=[{"action": "stop", "rationale": "done", "value": "ok"}]
            ),
        )
        return RootAgentBundle(agent=root, background_agents=(background,))

    manager = _manager(factory, hub_name="TestHub")
    run_id = manager.create(_project("syncing-proj"))
    assert manager.start_if_needed(run_id)
    assert _wait_status(manager, run_id, {"completed"})["status"] == "completed"
    listed = [run for run in manager.list_project_runs() if run["run_id"] == run_id]
    assert listed and listed[0]["status"] == "completed"


def test_manager_failed_root_does_not_transition_through_syncing() -> None:
    background = _stub_background_agent()

    @tool
    def boom(input: Empty, messages: list[Message]) -> Str:
        raise RuntimeError("boom")

    def factory(
        project: Project,
        /,
        *,
        endpoint_getter: OrchestratorEndpointGetter,
        event_sinks: Sequence[EventSink],
    ) -> RootAgentBundle:
        del project, endpoint_getter
        root = Agent(
            interaction_mode=Output.API,
            event_sinks=event_sinks,
            name="failing_root",
            tools=[boom],
            system_prompt="Fails immediately.",
            agent_endpoint=MockLLMEndpoint(
                responses=[{"action": "boom", "rationale": "fail"}]
            ),
        )
        return RootAgentBundle(agent=root, background_agents=(background,))

    manager = _manager(factory, hub_name="TestHub")
    run_id = manager.create(_project("failing-proj"))
    assert manager.start_if_needed(run_id)
    assert _wait_status(manager, run_id, {"failed"})["status"] == "failed"


def test_manager_cancelled_run_does_not_enter_syncing_state() -> None:
    background = _stub_background_agent()

    def factory(
        project: Project,
        /,
        *,
        endpoint_getter: OrchestratorEndpointGetter,
        event_sinks: Sequence[EventSink],
    ) -> RootAgentBundle:
        del project, endpoint_getter
        root = Agent(
            interaction_mode=Output.API,
            event_sinks=event_sinks,
            name="busy_root",
            tools=[busy, stop],
            system_prompt="Busy spin agent.",
            agent_endpoint=MockLLMEndpoint(
                responses=[{"action": "busy", "rationale": "spin"}]
            ),
        )
        return RootAgentBundle(agent=root, background_agents=(background,))

    manager = _manager(factory, hub_name="TestHub")
    run_id = manager.create(_project("cancelled-proj"))
    assert manager.start_if_needed(run_id)
    _wait_status(manager, run_id, {"running"})

    assert manager.cancel(run_id) is True
    assert _wait_status(manager, run_id, {"cancelled"})["status"] == "cancelled"


def test_manager_project_is_busy_tracks_thread_liveness_and_forget() -> None:
    manager = _manager(_busy_factory, hub_name="TestHub")
    run_id = manager.create(_project("busy-proj"))
    # Not started yet: no live thread, so not busy.
    assert manager.project_is_busy("busy-proj") is False

    assert manager.start_if_needed(run_id)
    _wait_status(manager, run_id, {"running"})
    deadline = time.monotonic() + 5.0
    while not manager.project_is_busy("busy-proj") and time.monotonic() < deadline:
        time.sleep(0.02)
    assert manager.project_is_busy("busy-proj") is True

    assert manager.cancel(run_id) is True
    _wait_status(manager, run_id, {"cancelled"})
    # Once the thread unwinds the project is no longer busy (safe to delete).
    deadline = time.monotonic() + 5.0
    while manager.project_is_busy("busy-proj") and time.monotonic() < deadline:
        time.sleep(0.02)
    assert manager.project_is_busy("busy-proj") is False

    manager.forget_project_runs("busy-proj")
    assert manager.get_run(run_id) is None
    assert manager.list_project_runs() == []


def _stub_background_agent(name: str = "stub_librarian") -> Agent:
    """A minimal Agent standing in for a background daemon; only its pipe matters."""
    return Agent(
        name=name,
        interaction_mode=Output.API,
        tools=[stop],
        system_prompt="stub background agent",
        agent_endpoint=MockLLMEndpoint(responses=[]),
    )


def _completed_root_with_background(background: Agent) -> OrchestratorFactory:
    def factory(
        project: Project,
        /,
        *,
        endpoint_getter: OrchestratorEndpointGetter,
        event_sinks: Sequence[EventSink],
    ) -> RootAgentBundle:
        del project, endpoint_getter
        root = Agent(
            interaction_mode=Output.API,
            event_sinks=event_sinks,
            name="syncing_root",
            tools=[stop],
            system_prompt="Completes immediately.",
            agent_endpoint=MockLLMEndpoint(
                responses=[{"action": "stop", "rationale": "done", "value": "ok"}]
            ),
        )
        return RootAgentBundle(agent=root, background_agents=(background,))

    return factory


def _tmp_project(tmp_path: Path, slug: str = "alpha") -> Project:
    return Project(
        sandbox=Sandbox(root=tmp_path, names=NAMES),
        slug=slug,
        subdirs={
            "logs": "conversation_logs",
            "snapshots": "snapshots",
            "memory": "memory",
        },
    )


def _write_agent_log(
    project: Project, *, agent_name: str, status: str, conversation_id: str = "conv-1"
) -> None:
    run = ConversationRun(
        conversation_id=conversation_id,
        agent_name=agent_name,
        started_at=utc_iso_z(datetime.now(timezone.utc)),
        ended_at=None if status == "running" else utc_iso_z(datetime.now(timezone.utc)),
        status=status,  # type: ignore[arg-type]
    )
    path = project.logs / agent_name / f"{conversation_id}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(run.model_dump_json(), encoding="utf-8")
    if status == "running":
        mark_conversation_active(
            agent_dir=path.parent, conversation_id=run.conversation_id
        )
    else:
        clear_conversation_active(
            agent_dir=path.parent, conversation_id=run.conversation_id
        )


def test_manager_cancel_does_not_fan_out_to_background_agents() -> None:
    """Cancelling the orchestrator must not force-cancel the librarian pipe."""
    background = _stub_background_agent()

    def factory(
        project: Project,
        /,
        *,
        endpoint_getter: OrchestratorEndpointGetter,
        event_sinks: Sequence[EventSink],
    ) -> RootAgentBundle:
        del project, endpoint_getter
        root = Agent(
            interaction_mode=Output.API,
            event_sinks=event_sinks,
            name="busy_root",
            tools=[busy, stop],
            system_prompt="Busy spin agent.",
            agent_endpoint=MockLLMEndpoint(
                responses=[{"action": "busy", "rationale": "spin"}]
            ),
        )
        return RootAgentBundle(agent=root, background_agents=(background,))

    manager = _manager(factory, hub_name="TestHub")
    run_id = manager.create(_project())
    assert manager.start_if_needed(run_id)
    _wait_status(manager, run_id, {"running"})
    time.sleep(0.1)
    assert background.pipe.cancelled is False

    assert manager.cancel(run_id) is True
    assert background.pipe.cancelled is False
    assert _wait_status(manager, run_id, {"cancelled"})["status"] == "cancelled"


def test_manager_cancel_project_cancels_background_librarian_pipe(
    tmp_path: Path,
) -> None:
    background = _stub_background_agent(name=LIBRARIAN_AGENT_NAME)
    manager = _manager(
        _completed_root_with_background(background),
        hub_name="TestHub",
    )
    slug = "syncing-project"
    project = _tmp_project(tmp_path, slug)
    run_id = manager.create(project)
    assert manager.start_if_needed(run_id)
    assert _wait_status(manager, run_id, {"completed"})["status"] == "completed"
    assert background.pipe.cancelled is False
    _write_agent_log(
        project,
        agent_name=LIBRARIAN_AGENT_NAME,
        status="running",
    )

    assert manager.cancel_project(slug) is True
    assert background.pipe.cancelled is True
    assert (
        manager.project_is_cancelling(project.slug, background_sync_active=True) is True
    )


def test_manager_create_rejects_project_while_cancellation_is_in_progress(
    tmp_path: Path,
) -> None:
    background = _stub_background_agent(name=LIBRARIAN_AGENT_NAME)
    manager = _manager(
        _completed_root_with_background(background),
        hub_name="TestHub",
    )
    project = _tmp_project(tmp_path, "cancelling-project")
    run_id = manager.create(project)
    assert manager.start_if_needed(run_id)
    _wait_status(manager, run_id, {"completed"})
    _write_agent_log(
        project,
        agent_name=LIBRARIAN_AGENT_NAME,
        status="running",
    )
    assert manager.cancel_project(project.slug) is True

    with pytest.raises(ProjectCancellationInProgressError, match="still in progress"):
        manager.create(project, background_sync_active=True)


def test_manager_looks_up_each_cancelling_run() -> None:
    manager = _manager(_minimal_api_agent_for_manager_test, hub_name="TestHub")
    projects = [_project(f"cancelling-{index}") for index in range(4)]
    run_ids = [manager.create(project) for project in projects]
    with manager._lock:
        for run_id in run_ids:
            manager._runs[run_id]["status"] = STATUS_CANCELLING
            manager._runs[run_id]["cancel_requested"] = True

    assert all(manager.project_is_cancelling(project.slug) for project in projects)


def test_manager_cancel_project_cancels_live_run_by_slug() -> None:
    manager = _manager(_minimal_api_agent_for_manager_test, hub_name="TestHub")
    slug = "live-project"
    run_id = manager.create(_project(slug))
    assert manager.start_if_needed(run_id)
    _wait_status(manager, run_id, {"awaiting_user_input"})

    assert manager.cancel_project(slug) is True
    assert _wait_status(manager, run_id, {"cancelled"})["status"] == "cancelled"
    assert manager.cancel_project(slug) is True


def test_manager_cancel_terminal_run_is_noop_without_syncing_path(
    tmp_path: Path,
) -> None:
    manager = _manager(_minimal_api_agent_for_manager_test, hub_name="TestHub")
    run_id = manager.create(_tmp_project(tmp_path, "idle-proj"))
    with manager._lock:
        state = manager._runs[run_id]
        state["status"] = STATUS_COMPLETED
        state["completed_at"] = time.time()

    assert manager.cancel(run_id) is False


def test_manager_list_project_runs_evicts_stale_completed_entries() -> None:
    manager = _manager(
        _minimal_api_agent_for_manager_test,
        hub_name="TestHub",
        completed_ttl_s=0.01,
    )
    run_id = manager.create(_project())
    with manager._lock:
        state = manager._runs[run_id]
        state["status"] = STATUS_COMPLETED
        state["completed_at"] = time.time() - 1.0

    listed = manager.list_project_runs()
    assert listed == []
    assert manager.get_run(run_id) is None
