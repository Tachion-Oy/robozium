"""Minimal HTTP surface for starting runs and replying to prompts."""

import asyncio
import logging
import queue
import tempfile
from dataclasses import replace
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response, UploadFile
from fastapi.responses import StreamingResponse
from roboz.llm import (
    MockTranscriptionEndpoint,
    ModelSelector,
    TranscriptionEndpointLike,
)
from roboz.llm.calls import call_transcription_api
from roboz.runtime import log_with_data
from roboz.runtime.events import PipeEvent

from robosprawl.api.dependencies import router as dependency_router
from robosprawl.api.errors import ProjectBusyError, ProjectCancellationInProgressError
from robosprawl.api.files import serve_hub_file
from robosprawl.api.lifespan import application_lifespan
from robosprawl.api.models import *
from robosprawl.api.project_service import ProjectService
from robosprawl.api.run_manager import RunManager
from robosprawl.api.sse import event_to_sse_frame
from robosprawl.api.state import RunStatus
from robosprawl.api.state import RunView as RunViewState
from robosprawl.hub.application import Hub
from robosprawl.hub.utils import load_hub
from robosprawl.mock.agents import (
    mock_deployment,
    stream_mock_deployment,
    stream_sync_mock_deployment,
)
from robosprawl.mock.model_selection import mock_model_endpoint

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


def _model_selection_view(
    selector: ModelSelector,
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


def create_app(*, deployment: Hub) -> FastAPI:
    """Host the supplied Hub through ASGI, owning HTTP and runtime lifecycle."""
    manager = RunManager(
        deployment.configure_deployment,
        hub_name=deployment.name,
        default_orchestrator_endpoint=lambda: (
            deployment.model_selector.selected_endpoint
        ),
    )
    projects = ProjectService(deployment, manager)
    app = FastAPI(
        title=deployment.name,
        version="0.1.0",
        lifespan=application_lifespan(
            deployment=deployment,
            manager=manager,
            projects=projects,
        ),
    )
    app.state.ready = False
    app.state.dependency_health = None
    app.state.run_manager = manager
    app.state.projects = projects
    app.state.transcription_endpoint = deployment.transcription_endpoint
    app.include_router(dependency_router)

    @app.get("/models", response_model=ModelSelectionView)
    def models_get(request: Request, run_id: str | None = None) -> ModelSelectionView:
        if run_id is None:
            return _model_selection_view(deployment.model_selector)
        manager: RunManager = request.app.state.run_manager
        try:
            model_id = manager.get_orchestrator_model_id(run_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="unknown run_id") from None
        return _model_selection_view(
            deployment.model_selector,
            selected_model_id=model_id,
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
        return serve_hub_file(path, sandbox=deployment.sandbox)

    def project_operation(operation):
        try:
            return operation()
        except (ProjectBusyError, ProjectCancellationInProgressError) as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="unknown project") from exc
        except (RuntimeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/run/create")
    def run_create(body: CreateBody) -> dict[str, str]:
        return {"run_id": project_operation(lambda: projects.prepare_run(body.project))}

    @app.post("/projects")
    def projects_create(body: ProjectCreateBody) -> dict[str, str]:
        return {"slug": project_operation(lambda: projects.create(body.name))}

    @app.get("/projects", response_model=list[ProjectSummary])
    def projects_get() -> list[ProjectSummary]:
        return [ProjectSummary(**row) for row in projects.list()]

    @app.delete("/projects/{slug}")
    def projects_delete(slug: str) -> dict[str, bool]:
        project_operation(lambda: projects.delete(slug))
        return {"ok": True}

    @app.post("/projects/{slug}/cancel")
    def projects_cancel(slug: str) -> dict[str, bool]:
        return {"ok": project_operation(lambda: projects.cancel(slug))}

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

        endpoint: TranscriptionEndpointLike | None = (
            request.app.state.transcription_endpoint
        )
        if endpoint is None:
            raise HTTPException(
                status_code=503,
                detail="Live transcription is not available in RoboSprawl.",
            )
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
        event_queue: queue.Queue[PipeEvent | None] = queue.Queue()
        stream_queue_listener = event_queue.put_nowait

        try:
            manager.subscribe_event_listener(
                run_id,
                stream_queue_listener,
                on_complete=lambda: event_queue.put_nowait(None),
            )
        except KeyError:
            log_with_data(
                logger,
                logging.INFO,
                f"Stream subscribe failed: run={run_id[:8]}, reason=unknown_run",
                {"run_id": run_id, "reason": "unknown_run"},
            )
            raise HTTPException(status_code=404, detail="unknown run_id") from None
        try:
            started = manager.start_run(run_id)
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
                    if event is None:
                        ended_on_terminal = True
                        return
                    yield event_to_sse_frame(event).encode("utf-8")
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


def _ephemeral_hub() -> Hub:
    """A throwaway Hub with sandbox and logging under a temporary directory.

    Streaming mock projects and their entire sandbox remain throwaway. The
    directory lives for the process lifetime.
    """
    config_dir = Path(tempfile.mkdtemp(prefix="robosprawl-stream-mock-hub-"))
    config = load_hub()
    return replace(
        config,
        sandbox=replace(
            config.sandbox, root=config_dir / config.sandbox.root.name
        ),
        logging=replace(config.logging, path=config_dir / config.logging.path.name),
    )


def live_app() -> FastAPI:
    return create_app(deployment=load_hub())


def mock_app() -> FastAPI:
    endpoint = mock_model_endpoint()
    return create_app(
        deployment=replace(
            load_hub(),
            models={"Mock": endpoint},
            default_model=endpoint,
            deployment=mock_deployment,
            transcription_endpoint=MockTranscriptionEndpoint(["mock transcription"]),
        ),
    )


def stream_mock_app() -> FastAPI:
    """Create the paced, ephemeral mock only when explicitly launched."""
    endpoint = mock_model_endpoint()
    return create_app(
        deployment=replace(
            _ephemeral_hub(),
            models={"Mock": endpoint},
            default_model=endpoint,
            deployment=stream_mock_deployment,
            transcription_endpoint=MockTranscriptionEndpoint(["mock transcription"]),
        ),
    )


def stream_sync_mock_app() -> FastAPI:
    """Create the paced mock with a cancellable background Librarian."""
    endpoint = mock_model_endpoint()
    return create_app(
        deployment=replace(
            _ephemeral_hub(),
            models={"Mock": endpoint},
            default_model=endpoint,
            deployment=stream_sync_mock_deployment,
            transcription_endpoint=MockTranscriptionEndpoint(["mock transcription"]),
        ),
    )
