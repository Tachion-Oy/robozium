from __future__ import annotations

import os
import tempfile
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import SupportsIndex

from roboz.llm import EndpointLike, MockLLMEndpoint, MockProviderError
from roboz.models import Empty, Message
from roboz.runtime import interact_with_user
from roboz.runtime.events import EventSink, MessageDeltaEvent, PipeEvent
from roboz.runtime.pipe import EventPipe
from roboz.tooling import Ctx
from roboz.tooling.decorators import factory
from roboz.tools import stop

from robosprawl.composition import (
    AgenticConstructor,
    AgenticFactory,
    BuildContext,
    CancellationProbe,
    LibrarianConstructor,
    LibrarianTuning,
    OrchestratorConstructor,
    RootAgentBundle,
    SubAgentSpec,
    ToolSurface,
)
from robosprawl.orchestrator_factory import OrchestratorEndpointGetter
from robosprawl.workspace import Project

# Per-chunk pause (seconds) the streaming mock inserts between message deltas so
# the live stream is actually visible in the HUD. Override with
# ``ROBOSPRAWL_STREAM_MOCK_DELAY_S``. Only the streaming mock uses this; the e2e
# ``mock_app`` never paces, so its timing is unchanged.
DEFAULT_STREAM_MOCK_DELAY_S = 0.1

# One-off pause (seconds) before the very first delta of each agent message, so
# the HUD's pre-stream "waiting" state is visible long enough to inspect the
# weighting, the placeholder text, and the panel layout before text starts
# filling in. Override with ``ROBOSPRAWL_STREAM_MOCK_START_DELAY_S``.
DEFAULT_STREAM_MOCK_START_DELAY_S = 4.0
MOCK_SCENARIO_MARKER = ".mock-scenario"
MOCK_SCENARIO_LLM_ERROR = "llm-error"
MOCK_SCENARIO_USER_NOTIFICATION = "user-notification"

# While this marker exists in the project root, the mock librarian's LLM
# endpoint blocks before answering, pinning the project in SYNCING so e2e tests
# can assert the syncing-phase invariants deterministically. Absent by default,
# so every other spec sees the usual fast librarian.
LIBRARIAN_HOLD_MARKER = ".librarian-hold"
LIBRARIAN_CANCEL_HOLD_MARKER = ".librarian-cancel-hold"
# Generous ceiling so a leaked marker can't wedge the shared e2e backend, while
# leaving ample headroom for a loaded browser to run every syncing-phase
# assertion before the test releases the hold. The normal path always releases
# explicitly, so this only bites on a stuck test.
LIBRARIAN_HOLD_MAX_S = 120.0
LIBRARIAN_HOLD_POLL_S = 0.05
ScriptedMockResponse = dict[str, object] | Exception


@factory
def mock_user_notification(
    input: Empty, messages: list[Message], ctx: Ctx
) -> Empty:
    """Send a deterministic one-way notification in the mock scenario."""
    del input, messages
    interact_with_user(ctx.message, with_reply=False)
    return Empty()


@dataclass(frozen=True)
class HelloWorldConstructor(AgenticConstructor):
    """A deterministic specialist that returns Hello, World! and stops."""

    agent_name: str = "hello_world"

    def description(self) -> str:
        return "A deterministic specialist that returns Hello, World! and stops."

    def endpoint(self) -> MockLLMEndpoint:
        return MockLLMEndpoint(
            responses=[
                {"action": "stop", "rationale": "finished", "value": "Hello, World!"}
            ]
        )

    def system_prompt(self) -> str:
        return "A deterministic specialist that returns Hello, World! and stops."

    def tool_surface(
        self, ctx: BuildContext, pipe: EventPipe, probe: CancellationProbe
    ) -> ToolSurface:
        return ToolSurface(tools=(stop,))


def _mock_orchestrator_responses(project: Project) -> list[ScriptedMockResponse]:
    """A fresh scripted response list (``MockLLMEndpoint`` mutates it via ``pop``)."""
    return [
        {
            "action": "prompt_user",
            "rationale": "ask user what to do next",
            "value": (
                "Hello! I generated a text artifact for validation: "
                f'<file src="projects/{project.slug}/documents/generated-note.txt">'
                "Open the generated text file"
                "</file>"
            ),
        },
        {"action": "hello_world", "rationale": "invoke specialist"},
        {
            "action": "prompt_user",
            "rationale": "collect one follow-up answer after sub-agent run",
            "value": "Thanks. One more thing before I finish?",
        },
        {
            "action": "stop",
            "rationale": "finished",
            "value": "mock orchestrator done",
        },
    ]


def _mock_orchestrator_error_responses() -> list[ScriptedMockResponse]:
    """Parks for a reply, fails one LLM call, then succeeds after retry.

    Selected when the project's ``.mock-scenario`` marker is ``llm-error`` to
    exercise the error-toast pipeline without a live LLM provider. The
    ``prompt_user`` step keeps timing deterministic — it waits for the browser
    to attach its SSE stream and reply before the next scripted item raises a
    provider-like auth failure while the stream is open.
    """
    return [
        {
            "action": "prompt_user",
            "rationale": "wait for the browser before failing the next call",
            "value": "About to simulate an LLM failure. Reply to continue.",
        },
        MockProviderError("Invalid API key", status_code=401),
        {
            "action": "stop",
            "rationale": "recovered after provider switch",
            "value": "mock orchestrator recovered",
        },
    ]


def _mock_scenario(project: Project) -> str | None:
    marker = project.root / MOCK_SCENARIO_MARKER
    if not marker.exists():
        return None
    return marker.read_text(encoding="utf-8").strip() or None


def _mock_agentic_factory(
    project: Project,
    *,
    responses: list[ScriptedMockResponse],
    with_librarian: bool,
    logs_root_override: Path | None = None,
    notification: str | None = None,
    endpoint: EndpointLike | None = None,
) -> AgenticFactory:
    """A scripted deployment built from the shed's constructors.

    Per-call construction is deliberate: ``MockLLMEndpoint`` consumes its
    response list and the scenario marker is read per run. Redirect
    ``logs_root_override`` to a throwaway dir to keep a run ephemeral.
    """
    # Keep mock HUD semantics stable: first parsed user message should be the
    # explicit reply from prompt_user, not auto-loaded skill bootstrap chatter.
    return AgenticFactory(
        orchestrator=OrchestratorConstructor(
            agent_endpoint=endpoint if endpoint is not None else MockLLMEndpoint(responses=responses),
            subagents=(
                SubAgentSpec(
                    constructor=HelloWorldConstructor(),
                    tool_name="hello_world",
                    tool_description="Run a deterministic hello world specialist agent.",
                ),
            ),
            extra_default_tools=(
                (mock_user_notification(Ctx(message=notification)),)
                if notification is not None
                else ()
            ),
            auto_load_skills=False,
            seed_initial_messages_from_memory=False,
        ),
        librarian=(_mock_librarian_constructor(project) if with_librarian else None),
        logs_root_override=logs_root_override,
    )


def mock_orchestrator_factory(
    project: Project,
    *,
    endpoint_getter: OrchestratorEndpointGetter,
    event_sinks: Sequence[EventSink],
) -> RootAgentBundle:
    if _mock_scenario(project) == "model-selection":
        from robosprawl.mock.model_selection import model_selection_endpoint

        return _mock_agentic_factory(
            project, responses=[], with_librarian=False,
            endpoint=model_selection_endpoint(endpoint_getter, project.root),
        )(project, event_sinks=event_sinks)
    artifact = project.root / "documents" / "generated-note.txt"
    artifact.parent.mkdir(parents=True, exist_ok=True)
    if not artifact.exists():
        artifact.write_text("Generated by the RoboSprawl mock agent.\n", encoding="utf-8")
    scenario = _mock_scenario(project)
    responses = (
        _mock_orchestrator_error_responses()
        if scenario == MOCK_SCENARIO_LLM_ERROR
        else _mock_orchestrator_responses(project)
    )
    notification = None
    if scenario == MOCK_SCENARIO_USER_NOTIFICATION:
        prose_wrap_token = "WRAP_" + ("abcdefghijklmnopqrstuvwxyz0123456789" * 24)
        code_scroll_token = "CODE_" + ("0123456789abcdef" * 80)
        notification = (
            "### Generated artifacts\n\n"
            "Plain prose: Fullstack-kehitt\\u00e4j\\u00e4 · "
            "75\\u201385 \\u20ac/h. Even one unbroken token must wrap within "
            f"the panel: {prose_wrap_token}\n\n"
            "```text\n"
            "Literal escape: \\ud83d\\ude80\n"
            f"{code_scroll_token}\n"
            "```\n\n"
            "| Date | Weekday | Onboarding Hours | Onboarding Cumulative | "
            "Research & Analysis Hours | Research & Analysis Cumulative | "
            "Day Total | Cumulative Total | Explanation |\n"
            "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |\n"
            "| 2026-08-03 | Monday | 2.0 | 2.0 | 0.0 | 0.0 | 4.0 | 4.0 | "
            "Onboarding and introduction: Going through project details and "
            "sorting out practicalities. |\n\n"
            "Your requested file is ready: "
            f'<file src="projects/{project.slug}/documents/generated-note.txt">'
            "Open the generated text file"
            "</file>"
        )
    # The bundle hands the librarian's pipe to the manager so cancel_project can
    # reach it — same wiring as production (the shed's standard deployment).
    # Without it, cancelling a SYNCING project is a no-op in the mock app.
    factory = _mock_agentic_factory(
        project,
        responses=responses,
        with_librarian=True,
        notification=notification,
    )
    return factory(project, event_sinks=event_sinks)


# Long, agent-flavoured prose used only by the streaming mock so the live HUD
# stream lasts a few seconds (~10x the terse e2e responses). It is never used by
# ``mock_app``, so e2e's exact-text assertions are unaffected.
_STREAM_MOCK_RATIONALE = (
    "I'm taking a moment to think through this out loud so the stream has "
    "something substantial to render. First I consider what the user is most "
    "likely trying to accomplish, then I weigh the handful of tools available "
    "to me and which one moves us forward with the least friction. I prefer to "
    "narrate my reasoning in plain language: it keeps the collaboration honest, "
    "it makes my next action predictable, and it gives you a chance to redirect "
    "me before I commit to anything irreversible. None of this changes the "
    "outcome here — it simply gives the streaming view a realistic amount of "
    "text to reveal token by token, the way a real model response would arrive."
)
_STREAM_MOCK_VALUE = (
    "Hello! This is the streaming mock, so everything you're watching appear "
    "one chunk at a time is being generated on a deliberate delay to show off "
    "the live HUD stream. Take a look at how the text fills in progressively, "
    "how the panel behaves while I'm working, and how the controls like layout "
    "and expand keep reacting while the stream is live. You'll also see several "
    "tool calls in a row so the terminal log has enough activity to evaluate. "
    "When you're ready, type anything below and send it — I'll run one more "
    "specialist step, then wrap up. There's no real work happening behind any "
    "of this; it exists purely so you can see and tune how a genuine, lengthy "
    "model response looks as it streams into the interface."
)


def _stream_mock_orchestrator_responses() -> list[ScriptedMockResponse]:
    """A fresh, verbose response list for the streaming mock (visible stream)."""
    return [
        {
            "action": "prompt_user",
            "rationale": _STREAM_MOCK_RATIONALE,
            "value": _STREAM_MOCK_VALUE,
        },
        {
            "action": "hello_world",
            "rationale": (
                "Now I'll delegate to a deterministic specialist sub-agent for a first pass. "
                + _STREAM_MOCK_RATIONALE
            ),
        },
        {
            "action": "hello_world",
            "rationale": (
                "Running a second specialist pass so the stream includes back-to-back tool calls. "
                + _STREAM_MOCK_RATIONALE
            ),
        },
        {
            "action": "prompt_user",
            "rationale": (
                "Collecting one follow-up answer after the sub-agent run. "
                + _STREAM_MOCK_RATIONALE
            ),
            "value": ("Thanks — the specialist finished. " + _STREAM_MOCK_VALUE),
        },
        {
            "action": "hello_world",
            "rationale": (
                "After your reply, I run one final specialist step before stopping. "
                + _STREAM_MOCK_RATIONALE
            ),
        },
        {
            "action": "stop",
            "rationale": "Finished; nothing left to do. " + _STREAM_MOCK_RATIONALE,
            "value": (
                "That's the end of the streaming mock walkthrough. "
                + _STREAM_MOCK_VALUE
            ),
        },
    ]


def _env_delay_seconds(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return max(0.0, float(raw))
    except ValueError:
        return default


def _stream_mock_delay_seconds() -> float:
    return _env_delay_seconds(
        "ROBOSPRAWL_STREAM_MOCK_DELAY_S", DEFAULT_STREAM_MOCK_DELAY_S
    )


def _stream_mock_start_delay_seconds() -> float:
    return _env_delay_seconds(
        "ROBOSPRAWL_STREAM_MOCK_START_DELAY_S", DEFAULT_STREAM_MOCK_START_DELAY_S
    )


def _streaming_pace_sink(delay_seconds: float, start_delay_seconds: float) -> EventSink:
    """An event sink that paces message deltas reaching the SSE stream.

    The orchestrator emits deltas synchronously, so sleeping here paces how fast
    they reach the SSE stream — turning the otherwise-instant mock response into
    a visibly progressive stream in the HUD. A longer one-off pause before the
    first delta of each message holds the HUD in its pre-stream "waiting" state
    so that layout can be inspected before text starts filling in.
    """

    def sink(event: PipeEvent) -> None:
        if not isinstance(event, MessageDeltaEvent):
            return
        # The first chunk of each message holds the HUD in its pre-stream state;
        # later chunks just pace the visible fill-in. Note the pipe increments
        # chunk_index before emitting, so the first delta is index 1, not 0.
        if event.chunk_index == 1:
            if start_delay_seconds > 0:
                time.sleep(start_delay_seconds)
        elif delay_seconds > 0:
            time.sleep(delay_seconds)

    return sink


def _paced_event_sinks(event_sinks: Sequence[EventSink]) -> tuple[EventSink, ...]:
    # The pace sink must run BEFORE the manager's stream sink: the pipe dispatches
    # to sinks in registration order, so sleeping here delays when each delta is
    # pushed to the SSE queue. Placed last, the first delta would already have
    # reached the browser before the pause — text would appear, then freeze.
    return (
        _streaming_pace_sink(
            _stream_mock_delay_seconds(), _stream_mock_start_delay_seconds()
        ),
        *event_sinks,
    )


def _stream_responses(project: Project) -> list[ScriptedMockResponse]:
    return (
        _mock_orchestrator_error_responses()
        if _mock_scenario(project) == MOCK_SCENARIO_LLM_ERROR
        else _stream_mock_orchestrator_responses()
    )


def stream_mock_orchestrator_factory(
    project: Project,
    *,
    endpoint_getter: OrchestratorEndpointGetter,
    event_sinks: Sequence[EventSink],
) -> RootAgentBundle:
    """Local-viewing mock: streams visibly and persists nothing.

    Conversation logs go to a throwaway temp dir and the librarian is omitted, so
    nothing lands in the real hub data. Used only by ``stream_mock_app``; the e2e
    ``mock_app`` is untouched.
    """
    del endpoint_getter
    factory = _mock_agentic_factory(
        project,
        responses=_stream_responses(project),
        with_librarian=False,
        logs_root_override=Path(tempfile.mkdtemp(prefix="robosprawl-stream-mock-")),
    )
    return factory(project, event_sinks=_paced_event_sinks(event_sinks))


def stream_sync_mock_orchestrator_factory(
    project: Project,
    *,
    endpoint_getter: OrchestratorEndpointGetter,
    event_sinks: Sequence[EventSink],
) -> RootAgentBundle:
    """Local-viewing sync mock: visible stream plus mocked background librarian.

    This is the cheap manual reproduction app for cancel-vs-sync behavior. It
    still uses only ``MockLLMEndpoint`` instances and an ephemeral log root, but
    unlike ``stream_mock_orchestrator_factory`` it includes the librarian so the
    manager enters the same post-stop ``syncing`` state as production.
    """
    del endpoint_getter
    factory = _mock_agentic_factory(
        project,
        responses=_stream_responses(project),
        with_librarian=True,
        logs_root_override=Path(tempfile.mkdtemp(prefix="robosprawl-stream-sync-mock-")),
    )
    return factory(project, event_sinks=_paced_event_sinks(event_sinks))


class _HoldableResponses(list[str | Exception]):
    def __init__(
        self,
        responses: list[str | Exception],
        *,
        hold_marker: Path,
        cancel_hold_marker: Path | None,
        is_cancelled: Callable[[], bool],
        max_hold_s: float,
    ) -> None:
        super().__init__(responses)
        self.hold_marker = hold_marker
        self.cancel_hold_marker = cancel_hold_marker
        self.is_cancelled = is_cancelled
        self.max_hold_s = max_hold_s

    def pop(self, index: SupportsIndex = -1) -> str | Exception:
        deadline = time.monotonic() + self.max_hold_s
        while (
            self.hold_marker.exists()
            and time.monotonic() < deadline
            and not self.is_cancelled()
        ):
            time.sleep(LIBRARIAN_HOLD_POLL_S)
        while (
            self.cancel_hold_marker is not None
            and self.cancel_hold_marker.exists()
            and time.monotonic() < deadline
            and self.is_cancelled()
        ):
            time.sleep(LIBRARIAN_HOLD_POLL_S)
        return super().pop(index)


def _holdable_endpoint(
    endpoint: MockLLMEndpoint,
    *,
    hold_marker: Path,
    cancel_hold_marker: Path | None = None,
    is_cancelled: Callable[[], bool],
    max_hold_s: float = LIBRARIAN_HOLD_MAX_S,
) -> MockLLMEndpoint:
    """Make a mock endpoint block before consuming each scripted response.

    Blocking on the librarian's own thread keeps its conversation log in
    ``running`` until the marker is deleted, the pipe is cancelled, or the
    safety timeout elapses.
    """

    endpoint.mock_responses = _HoldableResponses(
        endpoint.mock_responses,
        hold_marker=hold_marker,
        cancel_hold_marker=cancel_hold_marker,
        is_cancelled=is_cancelled,
        max_hold_s=max_hold_s,
    )
    return endpoint


def _mock_librarian_constructor(project: Project) -> LibrarianConstructor:
    # The orchestrator logs into the same conversation root the librarian scans,
    # so a single cycle may snapshot several conversations (the seeded one plus
    # the live run) before consolidating them into memory. Hand out a generous
    # supply of identical responses, each carrying the marker the e2e test
    # asserts on, so no eligible conversation is starved of a response and the
    # scripted endpoint never exhausts mid-run. Unused responses are harmless
    # once every conversation has been snapshotted and consolidated.
    endpoint = MockLLMEndpoint(
        [{"value": "## E2E snapshot\n- Librarian generated this memory."}] * 12
    )
    # ``endpoint_factory`` receives the constructor's cancellation probe, which
    # tracks the built librarian's pipe — no self-referential closure needed.
    return LibrarianConstructor(
        endpoint_factory=lambda is_cancelled: _holdable_endpoint(
            endpoint,
            hold_marker=project.root / LIBRARIAN_HOLD_MARKER,
            cancel_hold_marker=project.root / LIBRARIAN_CANCEL_HOLD_MARKER,
            is_cancelled=is_cancelled,
        ),
        tuning=LibrarianTuning(
            min_pending_snapshots=1,
            max_pending_age_seconds=0,
            token_growth_threshold=1,
            sleep_seconds=1,
            max_log_files=4,
        ),
    )


__all__ = [
    "HelloWorldConstructor",
    "mock_orchestrator_factory",
    "stream_mock_orchestrator_factory",
    "stream_sync_mock_orchestrator_factory",
]
