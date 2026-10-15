"""Image replies through real agents, HTTP, filesystem skills, and persistence."""

import base64
import json
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from io import BytesIO
from pathlib import Path
from threading import Barrier, Event
from types import SimpleNamespace
from uuid import uuid4

import pytest
from config_support import write_config
from deployment_support import configured_hub
from fastapi.testclient import TestClient
from PIL import Image as PILImage
from roboz.deployment import Capability, DeployableAgent, ToolLabel
from roboz.llm import LLMEndpoint, LLMEndpointRoute
from roboz.shed.agents import orchestrator
from roboz.tools import prompt_user_at_start, stop

from robozium.api.app import create_app
from robozium.api.attachments import (
    ATTACHMENTS_DIR,
    OWNER,
    OWNER_FILE,
    AttachmentStore,
    recover_attachments,
    validate_image,
)
from robozium.hub.utils import load_hub


def image_bytes(fmt="PNG", color="red", size=(4, 3)):
    out = BytesIO()
    PILImage.new("RGB", size, color).save(out, format=fmt)
    return out.getvalue()


def action(name, **payload):
    return {"action": name, "rationale": "image reply test", **payload}


def scripted_endpoint(responses, *, accepts_images=True, name="vision"):
    requests = []
    iterator = iter(responses)

    def create(**request):
        requests.append(request)
        response = next(iterator)
        if callable(response):
            response = response(request)
        if isinstance(response, Exception):
            raise response
        return SimpleNamespace(
            usage=None,
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(content=json.dumps(response)),
                )
            ],
        )

    endpoint = LLMEndpoint(
        client=SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=create)),
            models=object(),
            close=lambda: None,
        ),
        api_name="script",
        model_name=name,
        accepts_images=accepts_images,
        stream=False,
    )
    return endpoint, requests


@contextmanager
def image_run(
    tmp_path, responses=(), *, accepts_images=True, specialists=(), configure_extra=None
):
    write_config(tmp_path)
    endpoint, requests = scripted_endpoint(responses, accepts_images=accepts_images)
    text_endpoint, _ = scripted_endpoint([], accepts_images=False, name="text")
    other_endpoint, _ = scripted_endpoint([], name="other-vision")

    def configure(sandbox, project_slug, *, endpoint_getter):
        root = orchestrator(
            sandbox,
            agent_endpoint=LLMEndpointRoute(endpoint_getter),
            nested_agents=specialists,
        )
        root.add_capabilities(
            Capability(
                label=ToolLabel("initial_prompt", default=True),
                value=prompt_user_at_start("Send a reply"),
            )
        )
        if configure_extra:
            configure_extra(root)
        return root

    hub = configured_hub(
        load_hub(start=tmp_path),
        deployment=configure,
        default_model=endpoint,
        models={
            "Vision": endpoint,
            "Text": text_endpoint,
            "Other vision": other_endpoint,
        },
    )
    app = create_app(deployment=hub)
    # No lifespan dependency polling: all external calls use scripted providers.
    client = TestClient(app)
    try:
        if not hub.project("alpha").root.exists():
            assert client.post("/projects", json={"name": "alpha"}).status_code == 200
        run_id = client.post("/run/create", json={"project": "alpha"}).json()["run_id"]
        assert app.state.run_manager.start_run(run_id)
        yield client, run_id, hub, requests
    finally:
        assert app.state.run_manager.shutdown()
        client.close()


def wait_view(client, run_id, *, prompt_id=None, terminal=False):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        view = client.get(f"/run/{run_id}").json()
        if terminal and view["status"] in {"completed", "failed", "cancelled"}:
            return view
        if (
            not terminal
            and view["current_prompt_id"]
            and view["current_prompt_id"] != prompt_id
        ):
            return view
        time.sleep(0.005)
    raise AssertionError(
        {key: view[key] for key in ("status", "error", "current_prompt")}
    )


def upload(client, run_id, prompt, files, content="inspect these"):
    return client.post(
        f"/run/{run_id}/reply",
        data={
            "prompt_id": prompt,
            **({"content": content} if content is not None else {}),
        },
        files=[
            ("images", (name, data, "application/octet-stream")) for name, data in files
        ],
    )


def image_urls(request):
    return [
        part["image_url"]["url"]
        for message in request["messages"]
        if isinstance(message["content"], list)
        for part in message["content"]
        if part["type"] == "image_url"
    ]


@pytest.mark.parametrize(
    "content,count", [("inspect these", 1), ("", 1), (None, 1), ("compare", 4)]
)
def test_initial_images_reach_provider_but_not_history(
    tmp_path, content, count, caplog
):
    caplog.set_level(logging.DEBUG)
    responses = [action("prompt_user", value="Follow up"), action("stop", value="done")]
    with image_run(tmp_path, responses) as (client, run_id, hub, requests):
        view = wait_view(client, run_id)
        assert view["current_prompt_accepts_images"] is True
        assert [
            row["accepts_images"] for row in client.get("/models").json()["models"]
        ] == [True, False, True]
        images = [
            (f"../../image-{i}<tag>.png", image_bytes(color=color))
            for i, color in enumerate(["red", "blue", "green", "yellow"][:count])
        ]
        response = upload(client, run_id, view["current_prompt_id"], images, content)
        assert response.status_code == 200, response.text
        followup = wait_view(client, run_id, prompt_id=view["current_prompt_id"])
        urls = image_urls(requests[0])
        assert urls == [
            "data:image/png;base64," + base64.b64encode(data).decode()
            for _, data in images
        ]
        project = hub.project("alpha")
        stored = list((project.root / ATTACHMENTS_DIR / run_id).glob("*.png"))
        assert len(stored) == count
        assert all(path.name not in {name for name, _ in images} for path in stored)
        history = json.dumps(followup)
        assert "&lt;tag&gt;" in history
        for path in stored:
            relative = path.relative_to(project.sandbox.resolved_root).as_posix()
            assert relative in history
            assert client.get(f"/files/{relative}").status_code == 200
        for _, data in images:
            encoded = base64.b64encode(data).decode()
            assert encoded not in history
            assert encoded not in caplog.text
            for path in project.logs.rglob("*.json"):
                assert encoded not in path.read_text()
        assert (
            client.post(f"/run/{run_id}/reply", json={"content": "finish"}).status_code
            == 200
        )
        assert wait_view(client, run_id, terminal=True)["status"] == "completed"
        assert client.app.state.run_manager.shutdown()
        assert not (project.root / ATTACHMENTS_DIR / run_id).exists()
        for path in stored:
            relative = path.relative_to(project.sandbox.resolved_root).as_posix()
            assert client.get(f"/files/{relative}").status_code == 404


def test_followup_and_specialist_use_receiving_endpoint(tmp_path):
    child_endpoint, child_requests = scripted_endpoint(
        [action("stop", value="child done")]
    )
    child = DeployableAgent(
        name="specialist",
        system_prompt="Inspect the images",
        capabilities=(
            Capability(label=ToolLabel("stop"), value=stop),
            Capability(
                label=ToolLabel("initial_prompt", default=True),
                value=prompt_user_at_start("Specialist reply"),
            ),
        ),
    )
    child.set_agent_endpoint(child_endpoint)
    responses = [
        action("prompt_user", value="Add a follow-up image"),
        action("stop", value="done"),
    ]
    with image_run(tmp_path, responses) as (client, run_id, _, requests):
        initial = wait_view(client, run_id)
        assert (
            client.post(f"/run/{run_id}/reply", json={"content": "begin"}).status_code
            == 200
        )
        followup = wait_view(client, run_id, prompt_id=initial["current_prompt_id"])
        assert (
            upload(
                client,
                run_id,
                followup["current_prompt_id"],
                [("follow.png", image_bytes())],
                "",
            ).status_code
            == 200
        )
        wait_view(client, run_id, terminal=True)
        assert image_urls(requests[1])
    # A text-only root may delegate to an image-capable specialist.
    with image_run(
        tmp_path,
        [action("specialist", value="inspect"), action("stop", value="done")],
        accepts_images=False,
        specialists=(child,),
    ) as (client, run_id, _, requests):
        first = wait_view(client, run_id)
        assert not first["current_prompt_accepts_images"]
        assert (
            client.post(
                f"/run/{run_id}/reply", json={"content": "delegate"}
            ).status_code
            == 200
        )
        specialist = wait_view(client, run_id, prompt_id=first["current_prompt_id"])
        assert specialist["current_agent_name"] == "specialist"
        assert specialist["current_prompt_accepts_images"]
        assert (
            upload(
                client,
                run_id,
                specialist["current_prompt_id"],
                [("special.png", image_bytes())],
            ).status_code
            == 200
        )
        assert wait_view(client, run_id, terminal=True)["status"] == "completed"
        assert len(image_urls(child_requests[0])) == 1
        assert all(not image_urls(request) for request in requests)


@pytest.mark.parametrize(
    "failure",
    [
        "unsupported",
        "wrong_prompt",
        "corrupt",
        "too_many",
        "too_large",
        "animated",
        "pixels",
    ],
)
def test_rejected_images_leave_prompt_pending(tmp_path, failure):
    data = image_bytes()
    files = [("test.png", data)]
    if failure == "corrupt":
        files = [("bad.png", data[:-15])]
    elif failure == "too_many":
        files *= 5
    elif failure == "too_large":
        files = [("large.png", data + b"\0" * (10 * 1024 * 1024))]
    elif failure == "animated":
        out = BytesIO()
        PILImage.new("RGB", (2, 2), "red").save(
            out,
            format="GIF",
            save_all=True,
            append_images=[PILImage.new("RGB", (2, 2), "blue")],
        )
        files = [("animated.gif", out.getvalue())]
    elif failure == "pixels":
        files = [("large.png", image_bytes(size=(5001, 5000)))]
    with image_run(
        tmp_path,
        [action("stop", value="done")],
        accepts_images=failure != "unsupported",
    ) as (client, run_id, hub, requests):
        before = wait_view(client, run_id)
        prompt = "stale" if failure == "wrong_prompt" else before["current_prompt_id"]
        response = upload(client, run_id, prompt, files)
        assert response.status_code == 400, response.text
        if failure == "unsupported":
            assert response.json()["code"] == "images_not_supported"
        assert requests == []
        assert (
            wait_view(client, run_id)["current_prompt_id"]
            == before["current_prompt_id"]
        )
        assert not list(hub.project("alpha").root.glob(f"{ATTACHMENTS_DIR}/**/*.png"))
        assert (
            client.post(
                f"/run/{run_id}/reply", json={"content": "text works"}
            ).status_code
            == 200
        )
        assert wait_view(client, run_id, terminal=True)["status"] == "completed"


@pytest.mark.parametrize("fmt", ["PNG", "JPEG", "WEBP", "GIF"])
def test_supported_static_formats(fmt):
    validated = validate_image("display-name", image_bytes(fmt))
    assert (
        validated.media_type
        == {
            "PNG": "image/png",
            "JPEG": "image/jpeg",
            "WEBP": "image/webp",
            "GIF": "image/gif",
        }[fmt]
    )


def test_model_change_rechecked_and_images_lock_run_to_capable_models(tmp_path):
    responses = [action("prompt_user", value="Continue"), action("stop", value="done")]
    with image_run(tmp_path, responses) as (client, run_id, _, requests):
        view = wait_view(client, run_id)
        models = client.get("/models").json()["models"]

        def select(index):
            return client.post(
                "/models",
                json={"run_id": run_id, "model_id": models[index]["model_id"]},
            )

        assert select(1).status_code == 200
        assert not wait_view(client, run_id)["current_prompt_accepts_images"]
        rejected = upload(
            client, run_id, view["current_prompt_id"], [("a.png", image_bytes())]
        )
        assert (
            rejected.status_code == 400
            and rejected.json()["code"] == "images_not_supported"
        )
        assert not requests
        assert select(0).status_code == 200
        assert (
            upload(
                client, run_id, view["current_prompt_id"], [("a.png", image_bytes())]
            ).status_code
            == 200
        )
        wait_view(client, run_id, prompt_id=view["current_prompt_id"])
        assert select(1).json()["code"] == "images_not_supported"
        assert select(2).status_code == 200
        # Switch back to the scripted endpoint to finish.
        assert select(0).status_code == 200
        assert (
            client.post(f"/run/{run_id}/reply", json={"content": "done"}).status_code
            == 200
        )
        assert wait_view(client, run_id, terminal=True)["status"] == "completed"


def test_concurrent_duplicate_images_commit_exactly_once(tmp_path):
    with image_run(
        tmp_path,
        [action("prompt_user", value="Continue"), action("stop", value="done")],
    ) as (client, run_id, hub, requests):
        view = wait_view(client, run_id)
        barrier = Barrier(3)

        def send():
            barrier.wait(3)
            return upload(
                client, run_id, view["current_prompt_id"], [("a.png", image_bytes())]
            ).status_code

        with ThreadPoolExecutor(2) as executor:
            replies = [executor.submit(send) for _ in range(2)]
            barrier.wait(3)
            assert sorted(reply.result(5) for reply in replies) == [200, 400]
        followup = wait_view(client, run_id, prompt_id=view["current_prompt_id"])
        assert (
            len(list(hub.project("alpha").root.glob(f"{ATTACHMENTS_DIR}/**/*.png")))
            == 1
        )
        assert len(image_urls(requests[0])) == 1
        assert followup["status"] == "awaiting_user_input"


def test_read_images_prevents_switching_to_a_text_only_model(tmp_path):
    responses = [
        action("read_images", paths=["projects/alpha/saved.png"]),
        action("prompt_user", value="Continue inspecting the saved image"),
        action("stop", value="done"),
    ]
    with image_run(tmp_path, responses) as (client, run_id, hub, requests):
        initial = wait_view(client, run_id)
        (hub.project("alpha").root / "saved.png").write_bytes(image_bytes())
        assert client.post(
            f"/run/{run_id}/reply", json={"content": "Read the saved image"}
        ).status_code == 200
        wait_view(client, run_id, prompt_id=initial["current_prompt_id"])
        assert len(image_urls(requests[1])) == 1
        text_model = client.get("/models").json()["models"][1]["model_id"]
        response = client.post(
            "/models", json={"run_id": run_id, "model_id": text_model}
        )
        assert response.status_code == 400
        assert response.json()["code"] == "images_not_supported"
        assert client.post(
            f"/run/{run_id}/reply", json={"content": "Finish"}
        ).status_code == 200
        assert wait_view(client, run_id, terminal=True)["status"] == "completed"


@pytest.mark.parametrize(
    "body",
    [
        b"",
        b"--broken\r\n",
        b'--b\r\nContent-Disposition: form-data; name="prompt_id"\r\n\r\np\r\n--b\r\nContent-Disposition: form-data; name="images"; filename="a.png"\r\n\r\nincomplete',
    ],
)
def test_incomplete_multipart_leaves_prompt_pending(tmp_path, body):
    with image_run(tmp_path) as (client, run_id, hub, requests):
        before = wait_view(client, run_id)
        response = client.post(
            f"/run/{run_id}/reply",
            content=body,
            headers={"content-type": "multipart/form-data; boundary=b"},
        )
        assert response.status_code == 400
        assert (
            wait_view(client, run_id)["current_prompt_id"]
            == before["current_prompt_id"]
        )
        assert requests == []
        assert not (hub.project("alpha").root / ATTACHMENTS_DIR).exists()


def test_body_limit_before_parsing_with_and_without_content_length(tmp_path):
    with image_run(tmp_path) as (client, run_id, _, requests):
        before = wait_view(client, run_id)
        for body, headers in [
            (b"", {"content-length": str(41 * 1024 * 1024 + 1)}),
            (iter([b"x" * (1024 * 1024)] * 42), {}),
        ]:
            response = client.post(
                f"/run/{run_id}/reply",
                content=body,
                headers={"content-type": "multipart/form-data; boundary=b", **headers},
            )
            assert response.status_code == 413
        assert (
            wait_view(client, run_id)["current_prompt_id"]
            == before["current_prompt_id"]
        )
        assert requests == []


def test_recovery_removes_only_owned_directories_without_following_symlinks(tmp_path):
    write_config(tmp_path)
    project = load_hub(start=tmp_path).project("alpha")
    project.root.mkdir(parents=True)
    store = AttachmentStore(project, str(uuid4()))
    staged = store.stage("inspect", [validate_image("a.png", image_bytes())])
    saved = project.root / "saved.png"
    saved.write_bytes(staged.paths[0].read_bytes())
    external = tmp_path / "external"
    external.mkdir()
    (external / OWNER_FILE).write_bytes(OWNER)
    (external / "keep").write_text("keep")
    linked = store.root.parent / str(uuid4())
    linked.symlink_to(external, target_is_directory=True)
    (store.root / "nested-link").symlink_to(external, target_is_directory=True)
    unowned = store.root.parent / str(uuid4())
    unowned.mkdir()
    (unowned / "keep").write_text("keep")
    recover_attachments(project)
    assert not store.root.exists()
    assert saved.read_bytes() == image_bytes()
    assert linked.is_symlink()
    assert (external / "keep").read_text() == "keep"
    assert (unowned / "keep").exists()


def test_permission_prompt_remains_text_only(tmp_path):
    response = action(
        "run_file_command",
        value=[
            ("cp", "CMD"),
            ("projects/alpha/source.png", "PTH"),
            ("workspace/saved.png", "PTH"),
        ],
    )
    with image_run(tmp_path, [response, action("stop", value="done")]) as (
        client,
        run_id,
        hub,
        requests,
    ):
        initial = wait_view(client, run_id)
        (hub.project("alpha").root / "source.png").write_bytes(image_bytes())
        hub.settings.sandbox.shared_dir.mkdir(parents=True, exist_ok=True)
        assert (
            client.post(f"/run/{run_id}/reply", json={"content": "copy it"}).status_code
            == 200
        )
        approval = wait_view(client, run_id, prompt_id=initial["current_prompt_id"])
        assert not approval["current_prompt_accepts_images"]
        rejected = upload(
            client,
            run_id,
            approval["current_prompt_id"],
            [("a.png", image_bytes())],
            "yes",
        )
        assert (
            rejected.status_code == 400
            and rejected.json()["code"] == "images_not_supported"
        )
        assert len(requests) == 1
        assert (
            wait_view(client, run_id)["current_prompt_id"]
            == approval["current_prompt_id"]
        )
        assert (
            client.post(f"/run/{run_id}/reply", json={"content": "yes"}).status_code
            == 200
        )
        assert wait_view(client, run_id, terminal=True)["status"] == "completed"
        assert (
            hub.settings.sandbox.shared_dir / "saved.png"
        ).read_bytes() == image_bytes()


@pytest.mark.parametrize("change", ["model", "text", "cancel", "timeout"])
def test_commit_rechecks_after_staging(tmp_path, monkeypatch, change):
    entered, release = Event(), Event()
    original = Path.open

    def delayed_open(path, mode="r", *args, **kwargs):
        if mode == "xb" and path.suffix == ".png" and ATTACHMENTS_DIR in path.parts:
            entered.set()
            assert release.wait(5)
        return original(path, mode, *args, **kwargs)

    # Delay the real filesystem write, allowing control transitions during staging.
    monkeypatch.setattr(Path, "open", delayed_open)
    responses = [
        action("prompt_user", value="Timed prompt", timeout_seconds=0.15),
        action("prompt_user", value="Continue"),
        action("stop", value="done"),
    ]
    with image_run(tmp_path, responses) as (client, run_id, hub, requests):
        initial = wait_view(client, run_id)
        prompt = initial
        if change == "timeout":
            assert (
                client.post(
                    f"/run/{run_id}/reply", json={"content": "begin"}
                ).status_code
                == 200
            )
            prompt = wait_view(client, run_id, prompt_id=initial["current_prompt_id"])
        with ThreadPoolExecutor(1) as executor:
            pending = executor.submit(
                upload,
                client,
                run_id,
                prompt["current_prompt_id"],
                [("a.png", image_bytes())],
            )
            try:
                assert entered.wait(3)
                if change == "model":
                    text_model = client.get("/models").json()["models"][1]["model_id"]
                    assert (
                        client.post(
                            "/models", json={"run_id": run_id, "model_id": text_model}
                        ).status_code
                        == 200
                    )
                elif change == "text":
                    assert (
                        client.post(
                            f"/run/{run_id}/reply", json={"content": "winner"}
                        ).status_code
                        == 200
                    )
                    wait_view(client, run_id, prompt_id=initial["current_prompt_id"])
                elif change == "cancel":
                    assert client.post("/projects/alpha/cancel").status_code == 200
                else:
                    wait_view(client, run_id, prompt_id=prompt["current_prompt_id"])
            finally:
                release.set()
            assert pending.result(5).status_code == 400
        assert not list(hub.project("alpha").root.glob(f"{ATTACHMENTS_DIR}/**/*.png"))
        if change == "model":
            assert (
                wait_view(client, run_id)["current_prompt_id"]
                == initial["current_prompt_id"]
            )
        assert all(not image_urls(request) for request in requests)


def test_partial_storage_failure_removes_already_written_files(tmp_path, monkeypatch):
    original = Path.open
    calls = 0

    def failing_open(path, mode="r", *args, **kwargs):
        nonlocal calls
        if mode == "xb" and path.suffix == ".png" and ATTACHMENTS_DIR in path.parts:
            calls += 1
            if calls == 2:
                raise OSError("simulated disk failure")
        return original(path, mode, *args, **kwargs)

    monkeypatch.setattr(Path, "open", failing_open)
    with image_run(tmp_path) as (client, run_id, hub, requests):
        initial = wait_view(client, run_id)
        with pytest.raises(OSError, match="simulated disk failure"):
            upload(
                client,
                run_id,
                initial["current_prompt_id"],
                [("a.png", image_bytes())] * 2,
            )
        assert not list(hub.project("alpha").root.glob(f"{ATTACHMENTS_DIR}/**/*.png"))
        assert (
            wait_view(client, run_id)["current_prompt_id"]
            == initial["current_prompt_id"]
        )
        assert requests == []


def test_run_storage_quota_and_rollback(tmp_path):
    write_config(tmp_path)
    project = load_hub(start=tmp_path).project("alpha")
    project.root.mkdir(parents=True)
    store = AttachmentStore(project, str(uuid4()))
    raw = image_bytes()
    image = validate_image("large.png", raw + b"\0" * (10 * 1024 * 1024 - len(raw)))
    staged = [store.stage("", [image] * count) for count in (4, 4, 2)]
    with pytest.raises(ValueError, match="100 MiB"):
        store.stage("", [image])
    assert len(list(store.root.glob("*.png"))) == 10
    store.discard(staged[-1])
    replacement = store.stage("", [image] * 2)
    assert len(list(store.root.glob("*.png"))) == 10
    moved = project.root / "moved.png"
    replacement.paths[0].rename(moved)
    store.stage("", [image])
    store.cleanup()
    assert moved.stat().st_size == 10 * 1024 * 1024
    assert not store.root.exists()
    with pytest.raises(ValueError, match="closed"):
        store.stage("", [image])


def test_sse_strips_pixels_without_changing_the_live_message():
    from roboz.models import Image, Message, Role
    from roboz.runtime.events import MessageEvent

    from robozium.api.sse import event_to_sse_frame

    image = Image.from_bytes(image_bytes(), media_type="image/png")
    message = Message(
        role=Role.USER,
        content='<file src="projects/alpha/a.png">a.png</file>',
        images=[image],
    )
    frame = event_to_sse_frame(MessageEvent(message=message, sequence=1))
    assert image.url not in frame
    assert "images" not in json.loads(frame.removeprefix("data: "))["payload"]
    assert message.images == [image]


def test_saved_copy_and_rereading_after_compaction_keep_pixels_out_of_summaries(
    tmp_path, caplog
):
    from roboz.models import All
    from roboz.shed.identifiers import COMPACTIFY_MESSAGES_TOOL_NAME
    from roboz.shed.tools.compactification.compactify_messages import (
        get_compactify_messages_when_needed_tool,
    )
    from roboz.shed.tools.snapshot_conversations import (
        SnapshotConversationsContext,
        snapshot_conversations,
    )

    caplog.set_level(logging.DEBUG)
    references = []
    summary_requests = []

    def summarize(request):
        text = json.dumps(request["messages"])
        assert "base64" not in text
        assert all(not image_urls(item) for item in [request])
        summary_requests.append(request)
        return {"value": "Continue inspecting these images: " + " ".join(references)}

    summary_endpoint, _ = scripted_endpoint(
        [summarize, summarize], accepts_images=False, name="summary"
    )
    summary_endpoint.max_context_tokens = 32_000

    def copy_uploaded(request):
        content = json.dumps(request["messages"])
        temporary = re.search(
            r"projects/alpha/\.robozium-attachments/[a-z0-9-]+/[a-z0-9]+\.png", content
        )
        assert temporary
        references.extend([temporary[0], "projects/alpha/saved.png"])
        return action(
            "run_file_command",
            value=[("cp", "CMD"), (references[0], "PTH"), (references[1], "PTH")],
        )

    def reread(request):
        assert not image_urls(request), "Compaction must replace the live image message"
        text = json.dumps(request["messages"])
        assert all(reference in text for reference in references)
        return action("read_images", paths=references)

    def configure(root):
        root.add_capabilities(
            Capability(
                label=ToolLabel("manual_compaction"),
                value=get_compactify_messages_when_needed_tool(
                    endpoint=summary_endpoint, threshold_percent=60
                ),
            )
        )

    responses = [
        copy_uploaded,
        action(COMPACTIFY_MESSAGES_TOOL_NAME, **{"rationale": "context " * 35_000}),
        reread,
        action("prompt_user", value="Inspected both copies"),
        action("stop", value="done"),
    ]
    with image_run(tmp_path, responses, configure_extra=configure) as (
        client,
        run_id,
        hub,
        requests,
    ):
        initial = wait_view(client, run_id)
        data = image_bytes()
        assert (
            upload(
                client,
                run_id,
                initial["current_prompt_id"],
                [("original.png", data)],
                "Inspect and save this image",
            ).status_code
            == 200
        )
        followup = wait_view(client, run_id, prompt_id=initial["current_prompt_id"])
        assert len(summary_requests) == 1
        # This test's startup default runs again once compaction replaces all
        # assistant messages; continue it before the next scripted model step.
        assert followup["current_prompt"] == "Send a reply"
        assert (
            client.post(
                f"/run/{run_id}/reply", json={"content": "continue inspection"}
            ).status_code
            == 200
        )
        followup = wait_view(client, run_id, prompt_id=followup["current_prompt_id"])
        assert (
            image_urls(requests[3])
            == ["data:image/png;base64," + base64.b64encode(data).decode()] * 2
        )
        for reference in references:
            assert client.get(f"/files/{reference}").content == data
        assert (
            client.post(f"/run/{run_id}/reply", json={"content": "finish"}).status_code
            == 200
        )
        assert wait_view(client, run_id, terminal=True)["status"] == "completed"
        assert client.app.state.run_manager.shutdown()
        project = hub.project("alpha")
        # Run the Librarian's real snapshot operation on the persisted conversation.
        snapshot_conversations(
            SnapshotConversationsContext(
                endpoint=summary_endpoint,
                conversation_root=project.logs,
                snapshot_root=project.snapshots,
                memory_root=project.memory,
                agent_names={"orchestrator"},
                token_growth_threshold=0,
                max_chars=4000,
            )
        )(All(), [])
        assert len(summary_requests) == 2
        assert list(project.snapshots.rglob("*.md"))
        encoded = base64.b64encode(data).decode()
        for folder in (project.logs, project.snapshots, project.memory):
            for path in folder.rglob("*"):
                if path.is_file():
                    assert encoded not in path.read_text()
        assert encoded not in caplog.text
        assert client.get(f"/files/{references[0]}").status_code == 404
        assert client.get(f"/files/{references[1]}").content == data
        assert followup["current_prompt_accepts_images"]
    # A subsequent run rereads the durable copy with the same filesystem skill.
    with image_run(
        tmp_path,
        [action("read_images", paths=[references[1]]), action("stop", value="done")],
    ) as (client, run_id, _, requests):
        wait_view(client, run_id)
        assert (
            client.post(
                f"/run/{run_id}/reply", json={"content": "inspect saved image"}
            ).status_code
            == 200
        )
        assert wait_view(client, run_id, terminal=True)["status"] == "completed"
        assert len(image_urls(requests[1])) == 1


@pytest.mark.parametrize("cancel", [False, True])
def test_attachment_cleanup_waits_for_background_worker(tmp_path, cancel):
    from roboz.models import AgentMode, Empty, Message, Stop
    from roboz.tooling.decorators import tool

    entered, release = Event(), Event()

    @tool
    def hold(input: Empty, messages: list[Message]) -> Stop:
        entered.set()
        assert release.wait(5)
        return Stop(value="background done")

    background = DeployableAgent(
        name="background",
        mode=AgentMode.DETERMINISTIC,
        capabilities=(Capability(label=ToolLabel("hold", default=True), value=hold),),
    )
    responses = [
        action("prompt_user", value="Continue")
        if cancel
        else action("stop", value="done")
    ]
    with image_run(
        tmp_path,
        responses,
        configure_extra=lambda root: root.add_background_agents(background),
    ) as (client, run_id, hub, _):
        initial = wait_view(client, run_id)
        assert (
            upload(
                client, run_id, initial["current_prompt_id"], [("a.png", image_bytes())]
            ).status_code
            == 200
        )
        try:
            assert entered.wait(3)
            if cancel:
                wait_view(client, run_id, prompt_id=initial["current_prompt_id"])
                assert client.post("/projects/alpha/cancel").status_code == 200
            assert wait_view(client, run_id, terminal=True)["status"] == (
                "cancelled" if cancel else "completed"
            )
            root = hub.project("alpha").root / ATTACHMENTS_DIR / run_id
            assert list(root.glob("*.png")), "Background work must retain access"
        finally:
            release.set()
        deadline = time.monotonic() + 3
        while root.exists() and time.monotonic() < deadline:
            time.sleep(0.005)
        assert not root.exists()


def test_failed_agent_cleans_up_attachments(tmp_path):
    from roboz.models import Empty, Message, Str
    from roboz.tooling.decorators import tool

    @tool
    def fail(input: Empty, messages: list[Message]) -> Str:
        raise RuntimeError("scripted tool failure")

    with image_run(
        tmp_path,
        [action("fail")],
        configure_extra=lambda root: root.add_capabilities(
            Capability(label=ToolLabel("fail"), value=fail),
        ),
    ) as (client, run_id, hub, _):
        initial = wait_view(client, run_id)
        assert (
            upload(
                client, run_id, initial["current_prompt_id"], [("a.png", image_bytes())]
            ).status_code
            == 200
        )
        assert wait_view(client, run_id, terminal=True)["status"] == "failed"
        assert client.app.state.run_manager.shutdown()
        assert not (hub.project("alpha").root / ATTACHMENTS_DIR / run_id).exists()


@pytest.mark.parametrize(
    "fields",
    [
        [("content", "missing prompt")],
        [("prompt_id", "")],
        [("prompt_id", "ACTIVE"), ("images", "a file is required")],
        [("prompt_id", "ACTIVE"), ("unexpected", "field")],
        [("prompt_id", "ACTIVE"), ("content", "one"), ("content", "two")],
    ],
)
def test_multipart_field_contract_preserves_active_prompt(tmp_path, fields):
    with image_run(tmp_path) as (client, run_id, _, requests):
        initial = wait_view(client, run_id)
        response = client.post(
            f"/run/{run_id}/reply",
            files=[
                (
                    key,
                    (
                        None,
                        initial["current_prompt_id"] if value == "ACTIVE" else value,
                    ),
                )
                for key, value in fields
            ],
        )
        assert response.status_code == 400
        assert (
            wait_view(client, run_id)["current_prompt_id"]
            == initial["current_prompt_id"]
        )
        assert requests == []


def test_partial_multipart_closes_spooled_files(tmp_path, monkeypatch):
    import starlette.formparsers as forms

    created = []
    original = forms.SpooledTemporaryFile

    def tracked(*args, **kwargs):
        stream = original(*args, **kwargs)
        created.append(stream)
        return stream

    monkeypatch.setattr(forms, "SpooledTemporaryFile", tracked)
    with image_run(tmp_path) as (client, run_id, _, requests):
        initial = wait_view(client, run_id)
        body = (
            b'--b\r\nContent-Disposition: form-data; name="images"; filename="a.png"\r\n\r\n'
            + b"x" * (1024 * 1024 + 1)
        )
        response = client.post(
            f"/run/{run_id}/reply",
            content=body,
            headers={"Content-Type": "multipart/form-data; boundary=b"},
        )
        assert response.status_code == 400
        assert created and all(stream.closed for stream in created)
        assert (
            wait_view(client, run_id)["current_prompt_id"]
            == initial["current_prompt_id"]
        )
        assert requests == []
