"""Indexed dependency checks must reject missing or substituted release wheels."""

import hashlib
import importlib.util
import io
from pathlib import Path
from urllib.error import HTTPError

import pytest

SPEC = importlib.util.spec_from_file_location(
    "roboz_wheels", Path(__file__).parents[2] / "scripts/roboz_wheels.py"
)
assert SPEC is not None and SPEC.loader is not None
WHEELS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WHEELS)


@pytest.fixture
def release(tmp_path):
    lock = tmp_path / "uv.lock"
    records = []
    payloads = {}
    for name in WHEELS.PACKAGES:
        filename = f"{name.replace('-', '_')}-1.0.dev1-py3-none-any.whl"
        url = f"https://test-files.pythonhosted.org/packages/{filename}"
        data = f"published bytes for {name}".encode()
        payloads[url] = data
        records.append(
            f'[[package]]\nname = "{name}"\nversion = "1.0.dev1"\n'
            'source = { registry = "https://test.pypi.org/simple/" }\n'
            f'wheels = [{{ url = "{url}", '
            f'hash = "sha256:{hashlib.sha256(data).hexdigest()}" }}]\n'
        )
    lock.write_text("\n".join(records))
    return lock, payloads, tmp_path / "downloaded"


def serve(monkeypatch, payloads):
    def open_url(url, *, timeout):
        response = io.BytesIO(payloads[url])
        response.geturl = lambda: url
        return response

    monkeypatch.setattr(WHEELS.urllib.request, "urlopen", open_url)


def test_downloaded_wheels_match_locked_bytes(release, monkeypatch):
    lock, payloads, dist = release
    serve(monkeypatch, payloads)
    WHEELS.download_wheels(dist, lock)
    paths = WHEELS.verify_wheels(dist, lock)
    assert {p.read_bytes() for p in paths} == set(payloads.values())
    with pytest.raises(FileExistsError, match="fresh"):
        WHEELS.download_wheels(dist, lock)


def test_hash_mismatch_does_not_stage_candidate_wheels(release, monkeypatch):
    lock, payloads, dist = release
    payloads[next(iter(payloads))] = b"different build with the same filename"
    serve(monkeypatch, payloads)
    with pytest.raises(ValueError, match="hash does not match"):
        WHEELS.download_wheels(dist, lock)
    assert not list(dist.iterdir())


def test_missing_release_fails_without_source_fallback(release, monkeypatch):
    lock, _, dist = release

    def missing(url, *, timeout):
        raise HTTPError(url, 404, "Not found", {}, None)

    monkeypatch.setattr(WHEELS.urllib.request, "urlopen", missing)
    with pytest.raises(HTTPError):
        WHEELS.download_wheels(dist, lock)
    assert not list(dist.iterdir())


@pytest.mark.parametrize(
    ("before", "after"),
    [
        ('registry = "https://test.pypi.org/simple/"', 'directory = "../roboz"'),
        ("https://test-files.pythonhosted.org/", "https://files.pythonhosted.org/"),
    ],
)
def test_local_sources_and_wrong_index_hosts_are_rejected(release, before, after):
    lock, _, _ = release
    lock.write_text(lock.read_text().replace(before, after))
    with pytest.raises(ValueError):
        WHEELS.locked_wheels(lock)


def test_candidate_checks_reject_stale_versions_and_modified_bytes(
    release, monkeypatch
):
    lock, payloads, dist = release
    serve(monkeypatch, payloads)
    WHEELS.download_wheels(dist, lock)
    stale = dist / "roboz-0.0.1-py3-none-any.whl"
    stale.write_bytes(b"older release")
    with pytest.raises(ValueError, match="Expected only"):
        WHEELS.verify_wheels(dist, lock)
    stale.unlink()
    next(dist.glob("roboz-*.whl")).write_bytes(b"locally rebuilt")
    with pytest.raises(ValueError, match="hash does not match"):
        WHEELS.verify_wheels(dist, lock)
