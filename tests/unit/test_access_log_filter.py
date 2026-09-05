import logging

from robosprawl.backend_logging import keep_access_log


def _record(*, method: str, path: str, status: int | str = 200) -> logging.LogRecord:
    return logging.LogRecord(
        name="uvicorn.access",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg='%s - "%s %s HTTP/%s" %s',
        args=("127.0.0.1:1", method, path, "1.1", status),
        exc_info=None,
    )


def test_polling_get_paths_are_suppressed() -> None:
    assert keep_access_log(_record(method="GET", path="/projects")) is False
    assert keep_access_log(_record(method="GET", path="/run/abc123")) is False


def test_polling_path_with_query_is_suppressed() -> None:
    assert keep_access_log(_record(method="GET", path="/run/abc123?since=10")) is False


def test_non_polling_paths_are_kept() -> None:
    assert keep_access_log(_record(method="GET", path="/run/abc123/stream"))
    assert keep_access_log(_record(method="GET", path="/run/abc123/reply"))
    assert keep_access_log(_record(method="GET", path="/files/projects/a/cv.txt"))


def test_polling_404s_are_suppressed() -> None:
    assert (
        keep_access_log(_record(method="GET", path="/run/abc123", status=404)) is False
    )


def test_non_get_and_server_errors_are_kept() -> None:
    assert keep_access_log(_record(method="POST", path="/run/abc123"))
    assert keep_access_log(_record(method="GET", path="/run/abc123", status=500))
    assert keep_access_log(_record(method="GET", path="/runs", status=404))
    assert keep_access_log(_record(method="GET", path="/runs", status="oops"))
