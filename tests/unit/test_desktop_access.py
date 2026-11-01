"""Desktop requests are rejected before API effects; no policy applies without a desktop port."""

import pytest
from config_support import write_config
from dotenv import dotenv_values
from fastapi.testclient import TestClient
from roboz.endpoints import encrypt_env

from robozium.api.app import create_app
from robozium.hub.utils import load_hub

ORIGIN = "robozium://app"
BASE = "http://127.0.0.1:18001"
ENVIRONMENT = "/credentials/environment"


@pytest.fixture
def client(tmp_path, monkeypatch):
    write_config(tmp_path)
    monkeypatch.setenv("ROBOZIUM_DESKTOP_API_PORT", "18001")
    monkeypatch.setenv("ROBOZIUM_ENCRYPTED_ENV_PATH", str(tmp_path / ".env.encrypt"))
    return TestClient(create_app(deployment=load_hub(start=tmp_path)), base_url=BASE)


@pytest.mark.parametrize("origin", [ORIGIN, None])
def test_renderer_and_native_requests(client, origin):
    headers = {"Origin": origin} if origin else {}
    for path in ["/live", "/ready", "/projects"]:
        response = client.get(path, headers=headers)
        assert response.status_code in {200, 503}
        assert response.headers.get("access-control-allow-origin") == origin
        assert "access-control-allow-credentials" not in response.headers
    response = client.post("/projects", json={"name": "allowed"}, headers=headers)
    assert response.status_code == 200


@pytest.mark.parametrize("headers", [
    {"Origin": "https://evil.example"},
    {"Origin": "null"},
    {"Origin": "robozium://app/"},
    {"Origin": "robozium://other"},
    {"Origin": BASE},
    {"Origin": ""},
    {"Host": "localhost:18001", "Origin": ORIGIN},
    {"Host": "127.0.0.1:18000", "Origin": ORIGIN},
    {"Host": "evil.example", "Origin": ORIGIN},
    {"Sec-Fetch-Site": "none"},
    {"Sec-Fetch-Mode": "no-cors"},
    [("Origin", ORIGIN), ("Origin", "https://evil.example")],
    [("Host", "127.0.0.1:18001"), ("Host", "evil.example")],
])
def test_forbidden_requests_do_not_invoke_endpoints(client, headers):
    for method, path in [("POST", "/projects"), ("GET", "/projects"), ("DELETE", ENVIRONMENT)]:
        response = client.request(method, path, headers=headers, json={"name": "forbidden"})
        assert response.status_code == 403
        assert response.headers["cache-control"] == "no-store"
        assert "access-control-allow-origin" not in response.headers
    assert client.get("/projects").json() == []


def test_preflight_is_explicit_and_cannot_bypass_policy(client):
    headers = {"Origin": ORIGIN, "Access-Control-Request-Method": "POST",
               "Access-Control-Request-Headers": "content-type,accept"}
    response = client.options("/projects", headers=headers)
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == ORIGIN
    assert set(response.headers["access-control-allow-methods"].split(", ")) == {"GET", "POST", "DELETE"}
    for extra, status in [({"Origin": "https://evil.example"}, 403),
                          ({"Host": "evil.example"}, 403),
                          ({"Access-Control-Request-Method": "PUT"}, 400),
                          ({"Access-Control-Request-Headers": "authorization"}, 400)]:
        assert client.options("/projects", headers=headers | extra).status_code == status


@pytest.mark.parametrize("origin", [ORIGIN, None])
def test_unhandled_server_errors_preserve_cors_for_allowed_origin(client, origin):
    # A file at the projects directory provokes a real storage error without
    # depending on the test user's ability to bypass filesystem permissions.
    directory = client.app.state.hub.settings.sandbox.projects_dir
    directory.parent.mkdir(parents=True, exist_ok=True)
    directory.write_text("not a directory")
    errors = TestClient(client.app, base_url=BASE, raise_server_exceptions=False)
    response = errors.post(
        "/projects", json={"name": "storage failure"},
        headers={"Origin": origin} if origin else {},
    )
    assert response.status_code == 500
    assert response.text == "Internal Server Error"
    assert response.headers.get("access-control-allow-origin") == origin
    if origin:
        assert "Origin" in response.headers["vary"].split(", ")
    assert "access-control-allow-credentials" not in response.headers
    rejected = errors.post(
        "/projects", json={"name": "forbidden"},
        headers={"Origin": "https://evil.example"},
    )
    assert rejected.status_code == 403
    assert "access-control-allow-origin" not in rejected.headers


def test_environment_keeps_validation_storage_and_busy_gate(client, tmp_path):
    client.headers["Origin"] = ORIGIN
    # Queued before any change: a saved change would lock out new runs.
    client.post("/projects", json={"name": "busy"})
    client.post("/run/create", json={"project": "busy"})
    assert client.delete(ENVIRONMENT).status_code == 409
    client.post("/projects/busy/cancel")
    view = client.get(ENVIRONMENT).json()
    edit = {"revision": view["revision"], "entries": [{"name": "SETTING", "value": "saved"}]}
    assert client.post(ENVIRONMENT, json=edit).status_code == 200
    assert dotenv_values(tmp_path / ".env.encrypt") == {"SETTING": "saved"}
    assert client.post(ENVIRONMENT, json=edit).status_code == 409
    for headers, status in [({"Content-Type": "text/plain"}, 415),
                            ({"Content-Length": "-1"}, 400),
                            ({"Content-Length": str(32 * 1024 * 1024)}, 413)]:
        response = client.post(ENVIRONMENT, content=b"{}", headers={"Content-Type": "application/json"} | headers)
        assert response.status_code == status
    response = client.post(ENVIRONMENT, content=(b"x" * 65536 for _ in range(5)),
                           headers={"Content-Type": "application/json"})
    assert response.status_code == 413
    assert response.headers["access-control-allow-origin"] == ORIGIN
    assert client.post(ENVIRONMENT + "/import", content=b"unused",
                       headers={"Content-Type": "text/plain"}).status_code == 415


def test_desktop_does_not_bypass_locked_credentials(client, tmp_path, monkeypatch):
    monkeypatch.delenv("TEST_DESKTOP_API_KEY", raising=False)
    source = tmp_path / ".env"
    source.write_text("TEST_DESKTOP_API_KEY=synthetic\n")
    encrypt_env(source, secret_names=["TEST_DESKTOP_API_KEY"], password="synthetic-password")
    source.unlink()
    for method, path in [("POST", "/run/create"), ("GET", "/run/unknown/stream"),
                         ("POST", "/run/unknown/reply"), ("POST", "/transcribe")]:
        response = client.request(method, path, headers={"Origin": ORIGIN}, json={})
        assert response.status_code == 423
        assert response.headers["access-control-allow-origin"] == ORIGIN


def test_app_without_desktop_port_has_no_desktop_policy(tmp_path, monkeypatch):
    monkeypatch.delenv("ROBOZIUM_DESKTOP_API_PORT", raising=False)
    write_config(tmp_path)
    client = TestClient(create_app(deployment=load_hub(start=tmp_path)))
    assert client.get("/projects", headers={"Origin": "https://example.com"}).status_code == 200
    assert client.post(ENVIRONMENT, json={}, headers={"Origin": ORIGIN}).status_code == 403


@pytest.mark.parametrize("port", ["", "0", "65536", "abc", "１８００１"])
def test_invalid_desktop_port_fails_at_creation(tmp_path, monkeypatch, port):
    write_config(tmp_path)
    monkeypatch.setenv("ROBOZIUM_DESKTOP_API_PORT", port)
    with pytest.raises(ValueError, match="Invalid desktop API port"):
        create_app(deployment=load_hub(start=tmp_path))
