"""Exercise lifecycle boundaries with controlled thread interleavings."""

import json
import threading
import time
from contextvars import ContextVar
from dataclasses import replace
from types import SimpleNamespace

import pytest
from deployment_support import BuiltAgents
from fastapi.testclient import TestClient
from roboz import Agent
from roboz.runtime.io import interact_with_user
from roboz.runtime.persistence import RunStatus as AgentStatus
from roboz.runtime.pipe import EventPipe
from roboz.tools import stop
from roboz_endpoints import openrouter

from robosprawl.api.app import create_app
from robosprawl.api.errors import ProjectBusyError
from robosprawl.api.project_service import ProjectService
from robosprawl.api.run_control import RunControl
from robosprawl.api.run_manager import RunManager
from robosprawl.api.state import RunStatus
from robosprawl.api.wait_registry import WaitRegistry
from robosprawl.hub.utils import load_hub

_TEST_ENDPOINT = openrouter.z_ai__glm_5_3


@pytest.fixture
def config(tmp_path):
    from pathlib import Path

    example = Path(__file__).resolve().parents[2] / "hub.config.py"
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    (config_dir / "hub.config.py").write_text(example.read_text())
    return load_hub(start=config_dir)


def manager_for(factory):
    return RunManager(
        factory,
        hub_name="OwnershipTest",
        default_orchestrator_endpoint=lambda: _TEST_ENDPOINT,
    )


def join_run(manager, run_id):
    deadline = time.monotonic() + 3
    while manager.get_run(run_id)["worker_alive"] and time.monotonic() < deadline:
        time.sleep(0.005)
    assert not manager.get_run(run_id)["worker_alive"]


@pytest.mark.parametrize("project_cancel", [False, True])
def test_cancel_during_construction_never_invokes(config, project_cancel):
    entered, release = threading.Event(), threading.Event()
    invoked = []

    def factory(sandbox, project_slug, *, endpoint_getter, event_sinks):
        entered.set()
        assert release.wait(2)
        return BuiltAgents(
            SimpleNamespace(pipe=EventPipe(), invoke=lambda: invoked.append(True))
        )

    manager = manager_for(factory)
    run_id = manager.create(config.project("demo"))
    manager.start_run(run_id)
    try:
        assert entered.wait(2)
        assert (
            manager.cancel_runs_for_project("demo")
            if project_cancel
            else manager.cancel(run_id)
        )
    finally:
        release.set()
        join_run(manager, run_id)
    assert invoked == []
    assert manager.run_view(run_id)["status"] == RunStatus.CANCELLED


def test_cancel_survives_pipe_initialization_reset(config):
    entered, release = threading.Event(), threading.Event()
    invoked = []

    def factory(sandbox, project_slug, *, endpoint_getter, event_sinks):
        pipe = EventPipe(event_sinks=event_sinks)

        def invoke():
            entered.set()
            assert release.wait(2)
            pipe.initialize(agent_name="root")
            try:
                pipe.raise_if_cancelled()
                invoked.append(True)
            finally:
                pipe.finalize_run(status=AgentStatus.CANCELLED)

        return BuiltAgents(SimpleNamespace(pipe=pipe, invoke=invoke))

    manager = manager_for(factory)
    run_id = manager.create(config.project("demo"))
    manager.start_run(run_id)
    try:
        assert entered.wait(2)
        assert manager.cancel(run_id)
    finally:
        release.set()
        join_run(manager, run_id)
    assert invoked == []
    assert manager.run_view(run_id)["status"] == RunStatus.CANCELLED


@pytest.mark.parametrize("operation", ["cancel", "reply"])
def test_prompt_registration_is_atomic_with_control(config, operation, monkeypatch):
    entered, release, attempted, returned = (threading.Event() for _ in range(4))
    replies, errors = [], []

    def factory(sandbox, project_slug, *, endpoint_getter, event_sinks):
        pipe = EventPipe(event_sinks=event_sinks)

        def invoke():
            replies.append(interact_with_user("question", with_reply=True))

        return BuiltAgents(SimpleNamespace(pipe=pipe, invoke=invoke))

    manager = manager_for(factory)
    original_register = WaitRegistry.register

    def register(registry, prompt_id):
        entered.set()
        assert release.wait(2)
        original_register(registry, prompt_id)

    monkeypatch.setattr(WaitRegistry, "register", register)
    run_id = manager.create(config.project("demo"))
    manager.start_run(run_id)
    assert entered.wait(2)

    def operate():
        attempted.set()
        try:
            if operation == "cancel":
                manager.cancel(run_id)
            else:
                manager.submit_reply(run_id, None, "answer")
        except Exception as exc:
            errors.append(exc)
        finally:
            returned.set()

    caller = threading.Thread(target=operate)
    caller.start()
    try:
        assert attempted.wait(2)
        assert not returned.wait(0.05), (
            "control must not observe a half-registered prompt"
        )
    finally:
        release.set()
        caller.join(2)
        join_run(manager, run_id)
    assert errors == []
    assert returned.is_set()
    assert replies == (["answer"] if operation == "reply" else [])
    assert manager.run_view(run_id)["current_prompt_id"] is None


def test_factory_failure_closes_http_stream_and_late_subscribers(config):
    def factory(sandbox, project_slug, *, endpoint_getter, event_sinks):
        if project_slug == "broken":
            raise RuntimeError("cannot construct this project")
        return BuiltAgents(
            Agent(
                name="root",
                is_agentic=False,
                agent_endpoint=None,
                default_tools=[stop],
                event_sinks=event_sinks,
            )
        )

    app = create_app(
        deployment=replace(config, deployment=factory, transcription_endpoint=None)
    )
    with TestClient(app) as client:
        client.post("/projects", json={"name": "broken"})
        run_id = client.post("/run/create", json={"project": "broken"}).json()["run_id"]
        with client.stream("GET", f"/run/{run_id}/stream") as response:
            assert response.status_code == 200
            assert list(response.iter_bytes()) == []
        state = client.get(f"/run/{run_id}").json()
        assert state["status"] == "failed"
        assert "cannot construct" in state["error"]
        completions, events = [], []
        app.state.run_manager.subscribe_event_listener(
            run_id, events.append, on_complete=lambda: completions.append(True)
        )
        assert completions == [True]
        assert events == [], "host failure must not manufacture persisted agent events"


def test_snapshots_do_not_expose_mutable_event_state(config):
    from roboz.models import Message, Role
    from roboz.runtime.events import MessageEvent

    entered, release = threading.Event(), threading.Event()

    def factory(sandbox, project_slug, *, endpoint_getter, event_sinks):
        def invoke():
            for sink in event_sinks:
                sink(MessageEvent(Message(role=Role.USER, content="original"), 0))
            entered.set()
            assert release.wait(3)

        return BuiltAgents(SimpleNamespace(pipe=EventPipe(), invoke=invoke))

    manager = manager_for(factory)
    run_id = manager.create(config.project("demo"))
    manager.start_run(run_id)
    try:
        assert entered.wait(2)
        snapshot = manager.get_run(run_id)
        # Even while running, the entire observation is data, with no live handles.
        assert json.loads(json.dumps(snapshot))["project"] == "demo"
        assert snapshot["worker_alive"]
        assert snapshot["model_id"] == _TEST_ENDPOINT.dependency_id
        assert (
            not {
                "thread",
                "pipe",
                "background_pipes",
                "event_listeners",
                "orchestrator_endpoint",
            }
            & snapshot.keys()
        )
        snapshot["message_trace"][0]["payload"]["content"] = "changed"
        snapshot["status"] = RunStatus.CANCELLED
        snapshot["agent_stack"].append("injected")
        actual = manager.get_run(run_id)
        assert actual["message_trace"][0]["payload"]["content"] == "original"
        assert actual["status"] == RunStatus.RUNNING
        assert actual["agent_stack"] == []
    finally:
        release.set()
        join_run(manager, run_id)


@pytest.mark.parametrize("operation", ["start", "create"])
def test_deletion_serializes_against_start_and_create(config, monkeypatch, operation):
    import robosprawl.api.project_service as module

    entered, release, attempted = (
        threading.Event(),
        threading.Event(),
        threading.Event(),
    )
    invoked, errors = [], []

    def factory(sandbox, project_slug, *, endpoint_getter, event_sinks):
        invoked.append(True)
        return BuiltAgents(SimpleNamespace(pipe=EventPipe(), invoke=lambda: None))

    manager = manager_for(factory)
    projects = ProjectService(config, manager)
    projects.create("demo")
    run_id = projects.prepare_run("demo")
    original_remove = module.shutil.rmtree

    def remove(path):
        entered.set()
        assert release.wait(2)
        original_remove(path)

    monkeypatch.setattr(module.shutil, "rmtree", remove)
    delete = threading.Thread(target=lambda: projects.delete("demo"))
    delete.start()
    assert entered.wait(2)

    def operate():
        attempted.set()
        try:
            if operation == "start":
                manager.start_run(run_id)
            else:
                projects.prepare_run("demo")
        except (KeyError, FileNotFoundError) as exc:
            errors.append(exc)

    caller = threading.Thread(target=operate)
    caller.start()
    assert attempted.wait(2)
    release.set()
    delete.join(2)
    caller.join(2)
    assert not delete.is_alive() and not caller.is_alive()
    assert len(errors) == 1
    assert invoked == []
    assert not config.project("demo").root.exists()


def test_shutdown_tracks_background_thread_until_it_exits(config):
    started, release = threading.Event(), threading.Event()
    background_pipe = EventPipe()

    def factory(sandbox, project_slug, *, endpoint_getter, event_sinks):
        def background_invoke():
            background_pipe.initialize(agent_name="renamed-maintenance")
            started.set()
            assert release.wait(3)
            background_pipe.finalize_run(status=AgentStatus.COMPLETED)

        background = SimpleNamespace(pipe=background_pipe, invoke=background_invoke)

        def invoke():
            threading.Thread(target=background.invoke, daemon=True).start()
            assert started.wait(2)

        return BuiltAgents(
            SimpleNamespace(pipe=EventPipe(), invoke=invoke), (background,)
        )

    manager = manager_for(factory)
    projects = ProjectService(config, manager)
    projects.create("demo")
    run_id = projects.prepare_run("demo")
    manager.start_run(run_id)
    join_run(manager, run_id)
    try:
        assert projects.list()[0]["status"] == "syncing"
        assert manager.shutdown(timeout_s=0.01) is False
        assert background_pipe.cancelled
        with pytest.raises(ProjectBusyError):
            projects.delete("demo")
        with pytest.raises(ProjectBusyError, match="shutting down"):
            manager.create(config.project("new"))
    finally:
        release.set()
        assert manager.shutdown(timeout_s=2)
    projects.delete("demo")


def test_lifespan_shutdown_releases_input_wait(config):
    ready = threading.Event()

    def factory(sandbox, project_slug, *, endpoint_getter, event_sinks):
        def invoke():
            ready.set()
            interact_with_user("question", with_reply=True)

        return BuiltAgents(
            SimpleNamespace(
                pipe=EventPipe(), invoke=invoke, external_dependencies=lambda: ()
            )
        )

    app = create_app(
        deployment=replace(config, deployment=factory, transcription_endpoint=None)
    )
    with TestClient(app):
        manager = app.state.run_manager
        run_id = manager.create(config.project("demo"))
        manager.start_run(run_id)
        assert ready.wait(2)
    assert not manager.get_run(run_id)["worker_alive"]
    assert manager.run_view(run_id)["status"] == "cancelled"


def test_interrupted_input_releases_its_wait_slot(config, monkeypatch):
    control = RunControl(config.project("demo"), _TEST_ENDPOINT, history_limit=10)
    seen = []

    def interrupted(registry, prompt_id, *, timeout_s):
        seen.append((registry, prompt_id))
        raise KeyboardInterrupt

    monkeypatch.setattr(WaitRegistry, "wait", interrupted)
    with pytest.raises(KeyboardInterrupt):
        control.request_input("question")
    registry, prompt_id = seen[0]
    assert not registry.resolve(prompt_id, "late reply")
    assert control.snapshot()["current_prompt_id"] is None


def test_wait_slot_accepts_exactly_one_reply():
    from robosprawl.api.wait_registry import WaitRegistry

    registry = WaitRegistry()
    registry.register("prompt")
    assert registry.resolve("prompt", "first")
    assert not registry.resolve("prompt", "second")
    assert registry.wait("prompt", timeout_s=0.1) == "first"


def test_concurrent_starts_invoke_factory_once(config):
    barrier = threading.Barrier(3)
    entered, release = threading.Event(), threading.Event()
    calls, results, errors = [], [], []

    def factory(sandbox, project_slug, *, endpoint_getter, event_sinks):
        calls.append(project_slug)
        entered.set()
        assert release.wait(3)
        return BuiltAgents(SimpleNamespace(pipe=EventPipe(), invoke=lambda: None))

    manager = manager_for(factory)
    run_id = manager.create(config.project("demo"))

    def start():
        try:
            barrier.wait(timeout=2)
            results.append(manager.start_run(run_id))
        except Exception as error:
            errors.append(error)

    callers = [threading.Thread(target=start) for _ in range(2)]
    for caller in callers:
        caller.start()
    try:
        barrier.wait(timeout=2)
        for caller in callers:
            caller.join(2)
            assert not caller.is_alive()
        assert not errors
        assert sorted(results) == [False, True]
        assert entered.wait(2)
        assert calls == ["demo"]
    finally:
        release.set()
        assert manager.shutdown(timeout_s=3)


def test_worker_inherits_context_at_start(config):
    request_id = ContextVar("ownership-test-request", default="missing")
    entered, release = threading.Event(), threading.Event()
    observed = []

    def factory(sandbox, project_slug, *, endpoint_getter, event_sinks):
        entered.set()
        assert release.wait(3)
        observed.append(request_id.get())
        return BuiltAgents(SimpleNamespace(pipe=EventPipe(), invoke=lambda: None))

    manager = manager_for(factory)
    run_id = manager.create(config.project("demo"))
    token = request_id.set("original-request")
    try:
        assert manager.start_run(run_id)
    finally:
        request_id.reset(token)
    try:
        assert entered.wait(2)
        assert request_id.get() == "missing"
    finally:
        release.set()
        join_run(manager, run_id)
    assert observed == ["original-request"]


def test_thread_start_failure_finishes_once_without_holding_control_lock(
    config, monkeypatch
):
    control = RunControl(config.project("demo"), _TEST_ENDPOINT, history_limit=10)
    original_start = threading.Thread.start
    observed, invoked = [], []

    def start(thread):
        if thread.name == "failing-worker":
            raise RuntimeError("cannot start thread")
        return original_start(thread)

    def completed():
        # A subscriber can read from another thread before returning.
        reader = threading.Thread(target=lambda: observed.append(control.status))
        reader.start()
        reader.join(1)
        assert not reader.is_alive()

    monkeypatch.setattr(threading.Thread, "start", start)
    control.subscribe(lambda event: None, on_complete=completed)
    with pytest.raises(RuntimeError, match="cannot start thread"):
        control.launch_worker(
            lambda: invoked.append(True), thread_name="failing-worker"
        )
    assert observed == [RunStatus.FAILED]
    assert not invoked
    state = control.snapshot()
    assert state["status"] == RunStatus.FAILED
    assert state["error"] == "cannot start thread"
    assert not state["worker_alive"]
    assert not control.launch_worker(lambda: invoked.append(True), thread_name="retry")
    control.subscribe(lambda event: None, on_complete=completed)
    assert observed == [RunStatus.FAILED, RunStatus.FAILED]


def test_replies_cannot_cross_run_prompt_boundaries(config):
    replies = {}

    def factory(sandbox, project_slug, *, endpoint_getter, event_sinks):
        def invoke():
            replies[project_slug] = interact_with_user(project_slug, with_reply=True)

        return BuiltAgents(SimpleNamespace(pipe=EventPipe(), invoke=invoke))

    manager = manager_for(factory)
    runs = {name: manager.create(config.project(name)) for name in ("first", "second")}
    try:
        for run_id in runs.values():
            assert manager.start_run(run_id)
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            states = {name: manager.get_run(run_id) for name, run_id in runs.items()}
            if all(state["current_prompt_id"] is not None for state in states.values()):
                break
            time.sleep(0.005)
        first_prompt = states["first"]["current_prompt_id"]
        second_prompt = states["second"]["current_prompt_id"]
        assert first_prompt and second_prompt and first_prompt != second_prompt
        with pytest.raises(ValueError, match="does not match"):
            manager.submit_reply(runs["first"], second_prompt, "wrong run")
        assert not replies
        manager.submit_reply(runs["first"], first_prompt, "one")
        manager.submit_reply(runs["second"], second_prompt, "two")
        for run_id in runs.values():
            join_run(manager, run_id)
        assert replies == {"first": "one", "second": "two"}
    finally:
        assert manager.shutdown(timeout_s=3)
