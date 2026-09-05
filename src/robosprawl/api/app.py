"""Minimal HTTP surface for starting runs and replying to prompts."""

import asyncio
import json
import logging
import queue
import shutil
import tempfile
from collections.abc import Collection, Sequence
from pathlib import Path

from fastapi import (
    FastAPI,
    HTTPException,
    Request,
    Response,
    UploadFile,
)
from fastapi.responses import StreamingResponse
from roboz.llm import (
    MockTranscriptionEndpoint,
    TranscriptionEndpointLike,
)
from roboz.llm.calls import call_transcription_api
from roboz.runtime import log_with_data
from roboz.runtime.events import PipeEvent, RunLifecycleEvent
from roboz.runtime.persistence import (
    active_marker_paths,
    clear_active_markers,
)

from robosprawl.api.dependencies import dependency_lifespan
from robosprawl.api.dependencies import router as dependency_router
from robosprawl.api.errors import (
    ProjectBusyError,
    ProjectCancellationInProgressError,
)
from robosprawl.api.files import serve_hub_file
from robosprawl.api.models import *
from robosprawl.api.projects import ProjectListItem, compose_project_list
from robosprawl.api.run_manager import RunManager
from robosprawl.api.sse import event_to_sse_frame
from robosprawl.api.state import RunLifecycleKind, RunStatus
from robosprawl.api.state import (
    RunView as RunViewState,
)
from robosprawl.backend_logging import configure_backend_logging
from robosprawl.dependency_contract import DependencyRegistration
from robosprawl.deployment import (
    EXECUTABLE_DEPENDENCY_REGISTRATIONS,
    HubDeployment,
    OrchestratorModelSelector,
)
from robosprawl.hub import HubConfig, load_hub_config
from robosprawl.identifiers import LIBRARIAN_AGENT_NAME
from robosprawl.mock import (
    mock_orchestrator_factory,
    stream_mock_orchestrator_factory,
    stream_sync_mock_orchestrator_factory,
)
from robosprawl.workspace import Project

logger = logging.getLogger(__name__)

SSE_KEEPALIVE_INTERVAL_S = 15.0
MAX_TRANSCRIPTION_UPLOAD_BYTES = 25 * 1024 * 1024
ALLOWED_TRANSCRIPTION_CONTENT_TYPES = frozenset(
    {
        "application/octet-stream",
        "audio/aac",
        "audio/mp4",
        "audio/mpeg",
        "audio/ogg",
        "audio/wav",
        "audio/webm",
        "audio/x-m4a",
    }
)


def _clear_preboot_active_markers(*, config: HubConfig) -> None:
    projects_dir = config.sandbox.projects_dir
    if not projects_dir.is_dir():
        return
    for project_dir in projects_dir.iterdir():
        if not project_dir.is_dir():
            continue
        try:
            project = config.project(project_dir.name)
        except RuntimeError:
            continue
        clear_active_markers(project.logs)


def _librarian_is_active(project: Project) -> bool:
    return bool(active_marker_paths(project.logs, {LIBRARIAN_AGENT_NAME}))


def _active_librarian_project_slugs(projects: Sequence[Project]) -> set[str]:
    return {project.slug for project in projects if _librarian_is_active(project)}


def _cancelling_project_slugs(
    *,
    projects: Sequence[Project],
    manager: RunManager,
    active_librarian_project_slugs: Collection[str],
) -> set[str]:
    return {
        project.slug
        for project in projects
        if manager.project_is_cancelling(
            project.slug,
            background_sync_active=project.slug in active_librarian_project_slugs,
        )
    }


def _model_selection_view(
    selector: OrchestratorModelSelector,
    *,
    selected_model_id: str | None = None,
) -> ModelSelectionView:
    return ModelSelectionView(
        models=[
            AvailableModelView(model_id=endpoint.dependency_id, label=label)
            for label, endpoint in selector.models.items()
        ],
        selected_model_id=selected_model_id or selector.selected_model_id,
    )


def create_app(
    *,
    deployment: HubDeployment,
    dependency_registry: Sequence[DependencyRegistration] | None = None,
    dependency_check_interval_s: float = 60.0,
    dependency_check_timeout_s: float = 20.0,
) -> FastAPI:
    """Build the ASGI app.

    ``deployment`` supplies the complete orchestrator, model selection, and
    transcription dependency set together with filesystem structure and policy.

    """
    hub_config = deployment.config
    configure_backend_logging(hub_config.logging)
    _clear_preboot_active_markers(config=hub_config)
    app = FastAPI(
        title=hub_config.name,
        version="0.1.0",
        lifespan=dependency_lifespan(
            factory=deployment.orchestrator_factory,
            endpoint_getter=lambda: deployment.model_selector.selected_endpoint,
            project=hub_config.project(hub_config.name),
            transcription_endpoint=deployment.transcription_endpoint,
            selectable_endpoints=deployment.inspectable_endpoints,
            registrations=dependency_registry
            if dependency_registry is not None
            else deployment.dependency_registry,
            interval_s=dependency_check_interval_s,
            timeout_s=dependency_check_timeout_s,
        ),
    )
    app.state.ready = False
    app.state.dependency_health = None
    app.state.run_manager = RunManager(
        deployment.orchestrator_factory,
        hub_name=hub_config.name,
        default_orchestrator_endpoint=lambda: (
            deployment.model_selector.selected_endpoint
        ),
    )
    app.state.transcription_endpoint = deployment.transcription_endpoint
    app.include_router(dependency_router)

    @app.get("/models", response_model=ModelSelectionView)
    def models_get(request: Request, run_id: str | None = None) -> ModelSelectionView:
        if run_id is None:
            return _model_selection_view(deployment.model_selector)
        manager: RunManager = request.app.state.run_manager
        try:
            endpoint = manager.get_orchestrator_endpoint(run_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="unknown run_id") from None
        return _model_selection_view(
            deployment.model_selector,
            selected_model_id=endpoint.dependency_id,
        )

    @app.post("/models", response_model=ModelSelectionView)
    def models_select(body: ModelSelectBody, request: Request) -> ModelSelectionView:
        try:
            endpoint = deployment.model_selector.endpoint(body.model_id)
        except KeyError as exc:
            raise HTTPException(status_code=400, detail="unknown model_id") from exc
        if body.run_id is None:
            deployment.model_selector.select(body.model_id)
        else:
            manager: RunManager = request.app.state.run_manager
            try:
                manager.replace_orchestrator_endpoint(body.run_id, endpoint)
            except KeyError:
                raise HTTPException(status_code=404, detail="unknown run_id") from None
        return _model_selection_view(
            deployment.model_selector,
            selected_model_id=endpoint.dependency_id,
        )

    @app.get("/files/{path:path}")
    def files_get(path: str) -> Response:
        return serve_hub_file(path, sandbox=hub_config.sandbox)

    @app.post("/run/create")
    def run_create(body: CreateBody, request: Request) -> dict[str, str]:
        manager: RunManager = request.app.state.run_manager
        try:
            project = hub_config.project(body.project)
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if not project.root.is_dir():
            raise HTTPException(status_code=404, detail="unknown project")
        try:
            run_id = manager.create(
                project,
                background_sync_active=_librarian_is_active(project),
            )
        except (ProjectBusyError, ProjectCancellationInProgressError) as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return {"run_id": run_id}

    @app.post("/projects")
    def projects_create(body: ProjectCreateBody) -> dict[str, str]:
        try:
            project = hub_config.manifest_project(body.name)
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"slug": project.slug}

    @app.get("/projects", response_model=list[ProjectSummary])
    def projects_get(request: Request) -> list[ProjectSummary]:
        manager: RunManager = request.app.state.run_manager
        projects_dir = hub_config.sandbox.projects_dir
        projects = (
            sorted(
                (
                    hub_config.project(project_dir.name)
                    for project_dir in projects_dir.iterdir()
                    if project_dir.is_dir()
                ),
                key=lambda item: item.slug,
            )
            if projects_dir.is_dir()
            else []
        )
        active_librarian_project_slugs = _active_librarian_project_slugs(projects)
        cancelling_project_slugs = _cancelling_project_slugs(
            projects=projects,
            manager=manager,
            active_librarian_project_slugs=active_librarian_project_slugs,
        )
        rows: list[ProjectListItem] = compose_project_list(
            projects=projects,
            runs=manager.list_project_runs(
                active_background_sync_projects=active_librarian_project_slugs
            ),
            cancelling_projects=cancelling_project_slugs,
            active_background_sync_projects=active_librarian_project_slugs,
        )
        return [ProjectSummary(**row) for row in rows]

    @app.delete("/projects/{slug}")
    def projects_delete(slug: str, request: Request) -> dict[str, bool]:
        manager: RunManager = request.app.state.run_manager
        try:
            project = hub_config.project(slug)
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        projects_dir = hub_config.sandbox.projects_dir.resolve()
        root = project.root.resolve()
        # Confine the delete to a direct child of the projects tier.
        if root == projects_dir or root.parent != projects_dir:
            raise HTTPException(status_code=400, detail="invalid project path")
        if not root.is_dir():
            raise HTTPException(status_code=404, detail="unknown project")
        if manager.project_is_busy(project.slug) or _librarian_is_active(project):
            raise HTTPException(
                status_code=409,
                detail="project has an active run; cancel it first",
            )
        shutil.rmtree(root)
        manager.forget_project_runs(project.slug)
        return {"ok": True}

    @app.post("/projects/{slug}/cancel")
    def projects_cancel(slug: str, request: Request) -> dict[str, bool]:
        manager: RunManager = request.app.state.run_manager
        try:
            project = hub_config.project(slug)
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if not project.root.is_dir():
            raise HTTPException(status_code=404, detail="unknown project")
        return {"ok": manager.cancel_project(project.slug)}

    @app.get("/run/{run_id}", response_model=RunView)
    def run_get(run_id: str, request: Request) -> RunView:
        manager: RunManager = request.app.state.run_manager
        view: RunViewState | None = manager.run_view(run_id)
        if view is None:
            raise HTTPException(status_code=404, detail="unknown run_id")
        return RunView.model_validate(view)

    @app.post("/run/{run_id}/interrupt")
    def run_interrupt(run_id: str, request: Request) -> dict[str, bool]:
        manager: RunManager = request.app.state.run_manager
        try:
            interrupted = manager.interrupt(run_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="unknown run_id") from None
        return {"ok": interrupted}

    @app.post("/run/{run_id}/reply")
    def run_reply(run_id: str, body: ReplyBody, request: Request) -> dict[str, bool]:
        manager: RunManager = request.app.state.run_manager
        try:
            manager.submit_reply(run_id, body.prompt_id, body.content)
        except KeyError:
            raise HTTPException(status_code=404, detail="unknown run_id") from None
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"ok": True}

    @app.post("/transcribe")
    async def transcribe(file: UploadFile, request: Request) -> dict[str, str]:
        # Browsers attach codec parameters to the part's Content-Type (Chrome
        # sends "audio/webm;codecs=opus"); compare against the bare media type so
        # those parameters don't get rejected by the exact-match allowlist.
        raw_content_type = file.content_type or "application/octet-stream"
        content_type = raw_content_type.split(";", 1)[0].strip().lower()
        if content_type not in ALLOWED_TRANSCRIPTION_CONTENT_TYPES:
            raise HTTPException(
                status_code=400, detail="unsupported audio content type"
            )

        audio = await file.read(MAX_TRANSCRIPTION_UPLOAD_BYTES + 1)
        if len(audio) > MAX_TRANSCRIPTION_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="audio upload too large")

        endpoint: TranscriptionEndpointLike | None = request.app.state.transcription_endpoint
        if endpoint is None:
            raise HTTPException(status_code=503, detail="Live transcription is not available in RoboSprawl.")
        try:
            text = await asyncio.to_thread(
                call_transcription_api,
                endpoint,
                audio,
                filename=file.filename or "audio.webm",
                content_type=content_type,
            )
        except Exception as exc:
            raise HTTPException(status_code=502, detail="transcription failed") from exc
        return {"text": text}

    @app.get("/run/{run_id}/stream")
    async def run_stream(run_id: str, request: Request) -> StreamingResponse:
        manager: RunManager = request.app.state.run_manager
        view = manager.run_view(run_id)
        if view is None:
            log_with_data(
                logger,
                logging.INFO,
                f"Stream rejected: run={run_id[:8]}, reason=unknown_run",
                {"run_id": run_id, "reason": "unknown_run"},
            )
            raise HTTPException(status_code=404, detail="unknown run_id")
        if view["status"] in (
            RunStatus.COMPLETED,
            RunStatus.FAILED,
            RunStatus.CANCELLED,
        ):
            log_with_data(
                logger,
                logging.INFO,
                (
                    f"Stream rejected: run={run_id[:8]}, reason=finished, "
                    f"status={view['status'].value}"
                ),
                {
                    "run_id": run_id,
                    "reason": "finished",
                    "status": view["status"].value,
                },
            )
            raise HTTPException(status_code=409, detail="run already finished")
        stream_started = asyncio.get_running_loop().time()
        event_queue: queue.Queue[PipeEvent] = queue.Queue()
        stream_queue_listener = event_queue.put_nowait

        try:
            manager.subscribe_event_listener(run_id, stream_queue_listener)
        except KeyError:
            log_with_data(
                logger,
                logging.INFO,
                f"Stream subscribe failed: run={run_id[:8]}, reason=unknown_run",
                {"run_id": run_id, "reason": "unknown_run"},
            )
            raise HTTPException(status_code=404, detail="unknown run_id") from None
        try:
            started = manager.start_if_needed(run_id)
        except KeyError:
            manager.unsubscribe_event_listener(run_id, stream_queue_listener)
            log_with_data(
                logger,
                logging.INFO,
                f"Stream start failed: run={run_id[:8]}, reason=unknown_run",
                {"run_id": run_id, "reason": "unknown_run"},
            )
            raise HTTPException(status_code=404, detail="unknown run_id") from None
        except Exception as exc:
            manager.unsubscribe_event_listener(run_id, stream_queue_listener)
            log_with_data(
                logger,
                logging.ERROR,
                (
                    f"Stream start failed: run={run_id[:8]}, "
                    f"error_type={type(exc).__name__}"
                ),
                {"run_id": run_id, "error_type": type(exc).__name__},
                exc_info=True,
            )
            raise
        log_with_data(
            logger,
            logging.INFO,
            (
                f"Stream started: run={run_id[:8]}, status={view['status'].value}, "
                f"started_run={started}"
            ),
            {
                "run_id": run_id,
                "status": view["status"].value,
                "started_run": started,
            },
        )

        async def body():
            ended_on_terminal = False
            try:
                while True:
                    try:
                        event = await asyncio.to_thread(
                            event_queue.get, timeout=SSE_KEEPALIVE_INTERVAL_S
                        )
                    except queue.Empty:
                        yield b": keepalive\n\n"
                        continue
                    yield event_to_sse_frame(event).encode("utf-8")
                    if (
                        isinstance(event, RunLifecycleEvent)
                        and event.kind == RunLifecycleKind.STOPPED
                        and event.parent_agent_name is None
                    ):
                        ended_on_terminal = True
                        return
            finally:
                manager.unsubscribe_event_listener(run_id, stream_queue_listener)
                duration_ms = round(
                    (asyncio.get_running_loop().time() - stream_started) * 1000
                )
                reason = "terminal" if ended_on_terminal else "closed_early"
                log_with_data(
                    logger,
                    logging.INFO,
                    (
                        f"Stream finished: run={run_id[:8]}, reason={reason}, "
                        f"duration_ms={duration_ms}"
                    ),
                    {
                        "run_id": run_id,
                        "reason": reason,
                        "duration_ms": duration_ms,
                    },
                )

        return StreamingResponse(body(), media_type="text/event-stream")

    return app


def _ephemeral_hub_config() -> HubConfig:
    """A throwaway hub root (config + sandbox) under a temp dir.

    Streaming mock projects and their entire sandbox remain throwaway. The
    directory lives for the process lifetime, like the factory's ephemeral
    conversation-log root.
    """
    config_dir = Path(tempfile.mkdtemp(prefix="robosprawl-stream-mock-hub-"))
    config = {
        "hub": {"name": "StreamMockHub"},
        "logging": {
            "console": {"level": "INFO"},
            "file": {
                "path": "technical_logs/backend.jsonl",
                "level": "DEBUG",
                "max_bytes": 26214400,
                "backup_count": 5,
                "on_error": "fail",
            },
        },
        "sandbox": {
            "root": "sandbox",
            "readonly": "readonly",
            "workspace": "workspace",
            "projects": "projects",
            "safe_scripts": "safe-scripts",
        },
        "project": {
            "logs": "conversation_logs",
            "snapshots": "conversation_snapshots",
            "memory": "persistent_memory",
        },
    }
    (config_dir / "hub.config.json").write_text(json.dumps(config), encoding="utf-8")
    return load_hub_config(start=config_dir)


def live_app() -> FastAPI:
    return create_app(deployment=HubDeployment.standard(load_hub_config()))
MOCK_DEPENDENCY_REGISTRY = EXECUTABLE_DEPENDENCY_REGISTRATIONS
mock_app = create_app(
    deployment=HubDeployment.custom(
        load_hub_config(),
        mock_orchestrator_factory,
        MockTranscriptionEndpoint(["mock transcription"]),
    ),
    dependency_registry=MOCK_DEPENDENCY_REGISTRY,
)
def stream_mock_app() -> FastAPI:
    """Create the paced, ephemeral mock only when explicitly launched."""
    return create_app(
        deployment=HubDeployment.custom(
            _ephemeral_hub_config(),
            stream_mock_orchestrator_factory,
            MockTranscriptionEndpoint(["mock transcription"]),
        ),
        dependency_registry=MOCK_DEPENDENCY_REGISTRY,
    )


def stream_sync_mock_app() -> FastAPI:
    """Create the paced mock with a cancellable background Librarian."""
    return create_app(
        deployment=HubDeployment.custom(
            _ephemeral_hub_config(),
            stream_sync_mock_orchestrator_factory,
            MockTranscriptionEndpoint(["mock transcription"]),
        ),
        dependency_registry=MOCK_DEPENDENCY_REGISTRY,
    )


__all__ = [
    "CreateBody",
    "ProjectCreateBody",
    "ReplyBody",
    "RunView",
    "live_app",
    "create_app",
    "mock_app",
    "stream_mock_app",
    "stream_sync_mock_app",
]
