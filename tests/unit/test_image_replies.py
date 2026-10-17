"""Image replies through HTTP, real agent prompts, and a scripted provider."""

import base64
import json
import logging
import re
import shutil
import time
from contextlib import contextmanager
from io import BytesIO
from threading import Event
from types import SimpleNamespace

import pytest
from config_support import write_config
from deployment_support import configured_hub
from fastapi.testclient import TestClient
from PIL import Image
from roboz.deployment import Capability, DeployableAgent, ToolLabel
from roboz.llm import LLMEndpoint, LLMEndpointRoute, MockLLMEndpoint
from roboz.models import AgentMode, Empty, Message, Stop, Str, StrImage
from roboz.runtime import interact_with_user
from roboz.tooling import tool
from roboz.tools import prompt_user_at_start, stop

from robozium.api import attachments
from robozium.api.app import create_app
from robozium.api.sse import event_to_sse_frame
from robozium.hub.application import AttachmentSettings
from robozium.hub.utils import load_hub
from robozium.mock.agents import mock_deployment
from robozium.mock.model_selection import mock_model_endpoint


def picture(format="PNG", color="red", **options):
    out = BytesIO()
    Image.new("RGB", (3, 2), color).save(out, format=format, **options)
    return out.getvalue()


def wait_prompt(client, run_id, previous=None):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        state = client.get(f"/run/{run_id}").json()
        assert state["status"] not in {"failed", "cancelled", "completed"}, state
        if state["current_prompt_id"] and state["current_prompt_id"] != previous:
            return state["current_prompt_id"]
        time.sleep(0.01)
    raise AssertionError(state)


def upload(run, data=None, filename="image.png", **params):
    return run.client.post(
        f"/run/{run.run_id}/files",
        params={"prompt_id": run.prompt, "filename": filename, **params},
        content=picture() if data is None else data,
        headers={"content-type": "application/octet-stream"},
    )


@contextmanager
def image_run(tmp_path, *, vision=True, specialist=False, accepts_images=True, background=None, failure=False, limits=None, timeout=None):
    config = write_config(tmp_path)
    if limits is not None:
        with config.open("a") as file:
            file.write(f"\nATTACHMENTS = {limits!r}\n")
    calls = []

    def create(**request):
        calls.append(request["messages"])
        response = {"action": "prompt_user", "rationale": "ask again", "value": "more?"}
        if background is not None:
            response = {"action": "stop", "rationale": "done", "value": "ok"}
        if failure:
            response = {"action": "fail", "rationale": "test failure"}
        return SimpleNamespace(usage=None, choices=[SimpleNamespace(
            message=SimpleNamespace(content=json.dumps(response))
        )])

    endpoint = LLMEndpoint(
        client=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)),
                               models=object(), close=lambda: None),
        api_name="test", model_name="images", stream=False, accepts_images=vision,
    )

    @tool
    def text_prompt(input: Empty, messages: list[Message]) -> Str:
        return interact_with_user("permission?", with_reply=True) or Str(value="")

    @tool
    def timed_prompt(input: Empty, messages: list[Message]) -> Str | StrImage:
        return interact_with_user("image?", with_reply=True, timeout=timeout,
                                  accepts_images=True) or Str(value="expired")

    @tool
    def fail(input: Empty, messages: list[Message]) -> Str:
        raise RuntimeError("scripted failure")

    def configure(sandbox, project_slug, *, endpoint_getter):
        prompt = prompt_user_at_start("image?") if accepts_images else text_prompt
        if timeout is not None:
            prompt = timed_prompt
        receiver = DeployableAgent(name="receiver", system_prompt="Inspect user images.", capabilities=[
            Capability(label=ToolLabel(name="ask", default=True), value=prompt),
            Capability(label=ToolLabel(name="stop"), value=stop),
            Capability(label=ToolLabel(name="fail"), value=fail),
        ])
        receiver.set_agent_endpoint(LLMEndpointRoute(lambda: endpoint))
        if background is not None:
            @tool
            def hold(input: Empty, messages: list[Message]) -> Stop:
                assert background.wait(5)
                return Stop(value="done")

            receiver.add_background_agents(DeployableAgent(
                name="background", mode=AgentMode.DETERMINISTIC, capabilities=[
                    Capability(label=ToolLabel(name="hold", default=True), value=hold),
                ],
            ))
        if not specialist:
            return receiver
        root = DeployableAgent(name="root", system_prompt="Delegate the request.", nested_agents=[receiver], capabilities=[
            Capability(label=ToolLabel(name="stop"), value=stop),
        ])
        root.set_agent_endpoint(MockLLMEndpoint([
            {"action": "receiver", "rationale": "delegate"},
            {"action": "stop", "rationale": "done", "value": "ok"},
        ], accepts_images=not vision))
        return root

    hub = configured_hub(load_hub(start=tmp_path), deployment=configure)
    app = create_app(deployment=hub)
    client = TestClient(app)
    try:
        assert client.post("/projects", json={"name": "alpha"}).status_code == 200
        run_id = client.post("/run/create", json={"project": "alpha"}).json()["run_id"]
        app.state.run_manager.start_run(run_id)
        prompt = wait_prompt(client, run_id)
        yield SimpleNamespace(client=client, run_id=run_id, prompt=prompt, calls=calls,
                              endpoint=endpoint, app=app, hub=hub,
                              path=hub.project("alpha").root / attachments.DIRECTORY / run_id,
                              url=f"/run/{run_id}/reply")
    finally:
        if background is not None:
            background.set()
        assert app.state.run_manager.shutdown()
        client.close()


@pytest.mark.parametrize("specialist,content", [(False, "look"), (False, ""), (True, "")])
def test_ordered_images_reach_model_and_files_survive_until_workers_stop(tmp_path, specialist, content):
    data = [picture(), picture("JPEG", "blue"), picture("WEBP"), picture("GIF")]
    with image_run(tmp_path, specialist=specialist) as run:
        staged = []
        for original in data:
            response = upload(run, original, "../<unsafe>.png")
            assert response.status_code == 200
            staged.append(response.json()["path"])
            assert run.client.get(f"/files/{staged[-1]}").content == original
        assert wait_prompt(run.client, run.run_id) == run.prompt
        assert run.calls == []
        response = run.client.post(run.url, json={"prompt_id": run.prompt, "content": content})
        assert response.json() == {"ok": True}
        next_prompt = wait_prompt(run.client, run.run_id, run.prompt)
        parts = [part for message in run.calls[0] if isinstance(message["content"], list)
                 for part in message["content"]]
        urls = [part["image_url"]["url"] for part in parts if part["type"] == "image_url"]
        assert [base64.b64decode(url.split(",", 1)[1]) for url in urls] == data
        text = "\n".join(part["text"] for part in parts if part["type"] == "text").replace('\\"', '"')
        assert "../&lt;unsafe&gt;.png" in text and content in text
        paths = re.findall(r'<file src="([^"]+)">', text)
        assert paths == staged
        for path, original in zip(paths, data, strict=True):
            assert run.client.get(f"/files/{path}").content == original
        saved = run.hub.project("alpha").root / "saved.png"
        shutil.copyfile(run.hub.settings.sandbox.resolved_root / paths[0], saved)
        assert run.client.post(run.url, json={"prompt_id": next_prompt, "content": "text"}).status_code == 200
        wait_prompt(run.client, run.run_id, next_prompt)
        urls = [part["image_url"]["url"] for message in run.calls[1]
                if isinstance(message["content"], list) for part in message["content"]
                if part["type"] == "image_url"]
        assert [base64.b64decode(url.split(",", 1)[1]) for url in urls] == data
    assert not run.path.exists()
    assert saved.read_bytes() == data[0]


@pytest.mark.parametrize("specialist", [False, True])
def test_text_only_prompts_reject_images_and_remain_pending(tmp_path, specialist):
    with image_run(tmp_path, specialist=specialist, accepts_images=False) as run:
        response = upload(run)
        assert response.status_code == 400
        assert wait_prompt(run.client, run.run_id) == run.prompt
        assert not run.path.exists()
        assert run.client.post(run.url, json={"content": "text still works"}).json() == {"ok": True}
        wait_prompt(run.client, run.run_id, run.prompt)


@pytest.mark.parametrize("case", ["invalid", "animated", "format", "pixels", "bytes", "missing", "stale"])
def test_invalid_uploads_leave_no_files_or_consumed_prompt(tmp_path, case):
    image = picture()
    if case == "invalid":
        image = b"not an image"
    elif case == "animated":
        image = picture("GIF", save_all=True, append_images=[Image.new("RGB", (3, 2), "blue")])
    elif case == "format":
        image = picture("BMP")
    elif case == "pixels":
        out = BytesIO()
        Image.new("1", (5001, 5000)).save(out, format="PNG")
        image = out.getvalue()
    elif case == "bytes":
        image = b"x" * (AttachmentSettings().max_image_bytes + 1)
    with image_run(tmp_path) as run:
        params = {} if case == "missing" else {"prompt_id": "stale" if case == "stale" else run.prompt}
        response = run.client.post(f"/run/{run.run_id}/files", params=params, content=image)
        assert response.status_code in {400, 413, 422}
        assert wait_prompt(run.client, run.run_id) == run.prompt
        assert not run.path.exists()


def test_json_reply_contract_and_stale_requests_preserve_current_images(tmp_path):
    with image_run(tmp_path) as run:
        response = run.client.post(run.url, json={"content": "hello"})
        assert response.json() == {"ok": True}
        next_prompt = wait_prompt(run.client, run.run_id, run.prompt)
        assert upload(run, prompt_id=next_prompt).status_code == 200
        assert run.client.post(run.url, json={"prompt_id": run.prompt, "content": "duplicate"}).status_code == 400
        assert upload(run).status_code == 400
        assert wait_prompt(run.client, run.run_id) == next_prompt
        assert len(list(run.path.iterdir())) == 1
        assert run.client.post(run.url, json={"prompt_id": next_prompt, "content": ""}).status_code == 200
        wait_prompt(run.client, run.run_id, next_prompt)
        schema = run.client.get("/openapi.json").json()["paths"]["/run/{run_id}/reply"]["post"]
        assert set(schema["requestBody"]["content"]) == {"application/json"}


def test_run_budget_and_discarding_unsent_files(tmp_path):
    store = attachments.RunAttachments(tmp_path, tmp_path, "run")
    data = picture()
    upload = attachments.UploadedImage("a.png", data, "png")
    store.add(upload)
    store.clear_pending(delete_files=True)
    assert list(store.path.iterdir()) == []
    large = attachments.UploadedImage("a.png", b"x" * AttachmentSettings().max_image_bytes, "png")
    for _ in range(10):
        store.add(large)
        store.clear_pending()
    with pytest.raises(ValueError, match="run byte limit"):
        store.add(upload)
    store.cleanup()
    assert not store.path.exists()


def test_recovery_removes_only_temporary_entries_without_following_symlinks(tmp_path):
    with image_run(tmp_path) as run:
        pass
    root = run.path.parent
    run.path.mkdir(parents=True)
    saved = run.hub.project("alpha").root / "saved.png"
    saved.write_bytes(picture())
    (run.path / "link").symlink_to(saved)
    run.app.state.projects.recover()
    assert not root.exists() and saved.is_file()
    root.symlink_to(saved.parent, target_is_directory=True)
    run.app.state.projects.recover()
    assert not root.is_symlink() and saved.is_file()


def test_hub_startup_removes_abandoned_temporary_files(tmp_path):
    write_config(tmp_path)
    endpoint = mock_model_endpoint()
    hub = configured_hub(load_hub(start=tmp_path), deployment=mock_deployment,
                         models={"mock": endpoint}, default_model=endpoint,
                         transcription_endpoint=None)
    project = hub.project("alpha")
    folder = project.root / attachments.DIRECTORY / "abandoned-run"
    folder.mkdir(parents=True)
    (folder / "image.png").write_bytes(picture())
    saved = project.root / "saved.png"
    saved.write_bytes(picture())
    with TestClient(create_app(deployment=hub)) as client:
        assert client.get("/ready").status_code == 200
        assert not folder.parent.exists()
        assert saved.read_bytes() == picture()


@pytest.mark.parametrize("specialist", [False, True])
@pytest.mark.parametrize("vision", [False, True])
def test_model_changes_omit_and_restore_uploads_without_retry(tmp_path, specialist, vision, caplog):
    caplog.set_level(logging.DEBUG, logger="roboz")
    with image_run(tmp_path, specialist=specialist, vision=vision) as run:
        path = upload(run).json()["path"]
        events = []
        run.app.state.run_manager.subscribe_event_listener(run.run_id, events.append)
        prompt = run.prompt
        for index, accepts_images in enumerate([vision, False, False, True, False]):
            run.endpoint.accepts_images = accepts_images
            assert run.client.post(run.url, json={
                "prompt_id": prompt, "content": f"Keep text {index}",
            }).json() == {"ok": True}
            prompt = wait_prompt(run.client, run.run_id, prompt)
            state = run.client.get(f"/run/{run.run_id}").json()
            assert state["current_prompt"] == "more?"
            assert len(run.calls) == index + 1
            sent = run.calls[-1]
            urls = [part["image_url"]["url"] for message in sent
                    if isinstance(message["content"], list) for part in message["content"]
                    if part["type"] == "image_url"]
            if accepts_images:
                assert [base64.b64decode(url.split(",", 1)[1]) for url in urls] == [picture()]
            else:
                assert urls == []
                assert "Images omitted" in json.dumps(sent)
            assert "Keep text 0" in json.dumps(sent)
            assert "image.png" in json.dumps(sent) and path in json.dumps(sent)
            notices = [entry["payload"] for entry in state["message_trace"]
                       if entry["type"] == "runtime_event" and entry["payload"]["kind"] == "images_omitted"]
            assert len(notices) == (int(index >= (1 if vision else 0)) + int(index >= 4))
            assert all(notice["level"] == "info" for notice in notices)
            assert not any(entry["payload"].get("kind") in {"failed", "retrying"}
                           for entry in state["message_trace"] if entry["type"] == "runtime_event")
            assert run.client.get(f"/files/{path}").content == picture()
        serialized = "".join(event_to_sse_frame(event) for event in events)
        assert "base64," not in serialized + json.dumps(state) + caplog.text
        assert "images_omitted" in serialized


def test_prompt_change_during_upload_is_rechecked(tmp_path):
    with image_run(tmp_path) as run:
        def chunks():
            yield picture()[:10]
            run.app.state.run_manager.submit_reply(run.run_id, run.prompt, Str(value="text"))
            yield picture()[10:]

        response = run.client.post(f"/run/{run.run_id}/files",
                                   params={"prompt_id": run.prompt}, content=chunks())
        assert response.status_code == 400
        wait_prompt(run.client, run.run_id, run.prompt)
        assert not run.path.exists()


def test_body_limit_does_not_trust_content_length(tmp_path):
    with image_run(tmp_path) as run:
        response = run.client.post(f"/run/{run.run_id}/files", params={"prompt_id": run.prompt},
                                   headers={"content-length": "1"},
                                   content=b"x" * (run.hub.settings.attachments.max_image_bytes + 1))
        assert response.status_code == 413
        assert wait_prompt(run.client, run.run_id) == run.prompt


@pytest.mark.parametrize("ending", ["cancel", "timeout"])
def test_unsent_images_are_discarded_when_prompt_ends(tmp_path, ending):
    with image_run(tmp_path, timeout=1 if ending == "timeout" else None) as run:
        path = upload(run).json()["path"]
        if ending == "cancel":
            assert run.app.state.run_manager.cancel(run.run_id)
            assert run.app.state.run_manager.shutdown()
        else:
            wait_prompt(run.client, run.run_id, run.prompt)
        assert run.client.get(f"/files/{path}").status_code == 404


def test_completed_foreground_keeps_files_until_background_stops(tmp_path):
    release = Event()
    with image_run(tmp_path, background=release) as run:
        assert upload(run).status_code == 200
        assert run.client.post(run.url, json={"prompt_id": run.prompt, "content": ""}).status_code == 200
        manager = run.app.state.run_manager
        deadline = time.monotonic() + 5
        while manager.get_run(run.run_id)["worker_alive"] and time.monotonic() < deadline:
            time.sleep(0.01)
        assert manager.get_run(run.run_id)["status"] == "completed"
        assert manager.get_run(run.run_id)["background_active"]
        assert len(list(run.path.iterdir())) == 1
        release.set()
        while run.path.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        assert not run.path.exists()


def test_failure_cleans_accepted_uploads(tmp_path):
    with image_run(tmp_path, failure=True) as run:
        assert upload(run).status_code == 200
        assert run.client.post(run.url, json={"prompt_id": run.prompt, "content": ""}).status_code == 200
        deadline = time.monotonic() + 5
        manager = run.app.state.run_manager
        while manager.project_is_busy("alpha") and time.monotonic() < deadline:
            time.sleep(0.01)
        assert manager.get_run(run.run_id)["status"] == "failed"
        assert not run.path.exists()


@pytest.mark.parametrize("limit,value,status", [
    ("max_image_bytes", 64, 413),
    ("max_pixels", 5, 400),
    ("max_run_bytes", 64, 400),
])
def test_hub_config_controls_reply_limits(tmp_path, limit, value, status):
    limits = AttachmentSettings(**{limit: value})
    with image_run(tmp_path, limits=limits) as run:
        assert run.hub.settings.attachments == limits
        response = upload(run)
        assert response.status_code == status
        assert wait_prompt(run.client, run.run_id) == run.prompt
        assert not run.path.exists()


def test_image_count_limit_preserves_previously_staged_image(tmp_path):
    with image_run(tmp_path, limits=AttachmentSettings(max_images=1)) as run:
        path = upload(run).json()["path"]
        assert upload(run).status_code == 400
        assert list(run.path.iterdir()) == [run.hub.settings.sandbox.resolved_root / path]
        assert run.client.post(run.url, json={"content": ""}).status_code == 200
        wait_prompt(run.client, run.run_id, run.prompt)
