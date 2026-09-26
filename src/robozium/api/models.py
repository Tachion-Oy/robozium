"""HTTP request and response models."""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field
from roboz.models import MessageKind

from robozium.api.projects import ProjectStatus
from robozium.api.state import RunStatus


class ProjectSummary(BaseModel):
    slug: str
    status: ProjectStatus
    run_id: str | None
    current_agent_name: str | None
    created_at: float | None


class CreateBody(BaseModel):
    project: str


class ProjectCreateBody(BaseModel):
    name: str


class ModelSelectBody(BaseModel):
    model_id: str
    run_id: str | None = None


class AvailableModelView(BaseModel):
    model_id: str
    label: str


class ModelSelectionView(BaseModel):
    models: list[AvailableModelView]
    selected_model_id: str


class CredentialStatus(BaseModel):
    available: bool
    locked: bool
    removable: bool


class ReplyBody(BaseModel):
    prompt_id: str | None = Field(
        None,
        description="Optional; if omitted, the current active prompt for the run is used.",
    )
    content: str


class RunViewMessagePayload(BaseModel):
    role: str
    content: str
    truncation: Any = None
    message_kind: MessageKind | None = None


class RunViewMessageEntry(BaseModel):
    type: Literal["message"]
    sequence: int
    payload: RunViewMessagePayload
    message_id: str | None = None


class RunViewLifecyclePayload(BaseModel):
    kind: str
    agent_name: str
    sequence: int
    parent_agent_name: str | None = None
    status: str | None = None
    api_name: str | None = None
    model_name: str | None = None
    max_context_tokens: int | None = None
    temperature: float | None = None
    output_format: str | None = None


class RunViewLifecycleEntry(BaseModel):
    type: Literal["run_lifecycle"]
    payload: RunViewLifecyclePayload


class RunViewScriptOutputPayload(BaseModel):
    content: str


class RunViewScriptOutputEntry(BaseModel):
    type: Literal["script_output"]
    sequence: int
    payload: RunViewScriptOutputPayload


class RunViewRuntimeEventPayload(BaseModel):
    category: str
    kind: str
    level: Literal["debug", "info", "warning", "error"]
    message: str
    agent_name: str
    data: dict[str, Any] | None = None


class RunViewRuntimeEventEntry(BaseModel):
    type: Literal["runtime_event"]
    sequence: int
    payload: RunViewRuntimeEventPayload


TraceEntry = Annotated[
    RunViewMessageEntry
    | RunViewLifecycleEntry
    | RunViewScriptOutputEntry
    | RunViewRuntimeEventEntry,
    Field(discriminator="type"),
]


class RunView(BaseModel):
    project: str
    status: RunStatus
    current_agent_name: str | None
    parent_agent_name: str | None
    message_trace: list[TraceEntry]
    current_prompt_id: str | None
    current_prompt: str | None
    error: str | None


__all__ = [
    "AvailableModelView",
    "CreateBody",
    "ModelSelectBody",
    "ModelSelectionView",
    "ProjectCreateBody",
    "ProjectSummary",
    "ReplyBody",
    "RunView",
    "RunViewLifecycleEntry",
    "RunViewLifecyclePayload",
    "RunViewMessageEntry",
    "RunViewMessagePayload",
    "RunViewRuntimeEventEntry",
    "RunViewRuntimeEventPayload",
    "RunViewScriptOutputEntry",
    "RunViewScriptOutputPayload",
    "TraceEntry",
]
