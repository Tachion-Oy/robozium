import io
import json
import logging
import re
import stat
from pathlib import Path

import pytest
from roboz.runtime import LOG_DATE_FORMAT, LOG_FORMAT, log_with_data

from robosprawl import backend_logging
from robosprawl.backend_logging import _APPLICATION_LOGGERS, configure_backend_logging
from robosprawl.hub import HubLoggingConfig


def _config(tmp_path: Path) -> HubLoggingConfig:
    return HubLoggingConfig(
        console_level="INFO",
        path=tmp_path / "backend.jsonl",
        file_level="DEBUG",
        max_bytes=1024,
        backup_count=5,
        on_error="fail",
    )


def _isolate_app_loggers(monkeypatch):
    monkeypatch.setattr(backend_logging, "_HANDLERS", None)
    app_loggers = [logging.getLogger(name) for name in _APPLICATION_LOGGERS]
    for app_logger in app_loggers:
        monkeypatch.setattr(app_logger, "handlers", [])
        monkeypatch.setattr(app_logger, "level", app_logger.level)
        monkeypatch.setattr(app_logger, "propagate", app_logger.propagate)
    for name in ("uvicorn.access", "uvicorn.error"):
        uvicorn_logger = logging.getLogger(name)
        monkeypatch.setattr(uvicorn_logger, "handlers", [])
        monkeypatch.setattr(uvicorn_logger, "level", uvicorn_logger.level)
        monkeypatch.setattr(uvicorn_logger, "propagate", uvicorn_logger.propagate)
    return app_loggers


def test_app_logging_installs_shared_console_and_file_handlers(
    monkeypatch, tmp_path: Path
) -> None:
    app_loggers = _isolate_app_loggers(monkeypatch)

    configure_backend_logging(_config(tmp_path))

    assert all(len(app_logger.handlers) == 2 for app_logger in app_loggers)
    console_handlers = [app_logger.handlers[0] for app_logger in app_loggers]
    file_handlers = [app_logger.handlers[1] for app_logger in app_loggers]
    assert all(handler is console_handlers[0] for handler in console_handlers)
    assert all(handler is file_handlers[0] for handler in file_handlers)
    assert console_handlers[0].level == logging.INFO
    assert file_handlers[0].level == logging.DEBUG

    formatter = console_handlers[0].formatter
    assert formatter is not None
    assert formatter._fmt == LOG_FORMAT
    assert formatter.datefmt == LOG_DATE_FORMAT

    record = logging.LogRecord(
        name="roboz.test",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="hello",
        args=(),
        exc_info=None,
    )
    record.msecs = 123
    record.threadName = "test-thread"
    assert re.fullmatch(
        r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.123"
        r" \| INFO     \| test-thread \| roboz\.test \| hello",
        formatter.format(record),
    )

    file_handlers[0].close()


def test_console_is_concise_while_jsonl_keeps_structured_metadata(
    monkeypatch, tmp_path: Path
) -> None:
    app_loggers = _isolate_app_loggers(monkeypatch)
    configure_backend_logging(_config(tmp_path))
    console = app_loggers[0].handlers[0]
    stream = io.StringIO()
    console.setStream(stream)

    log_with_data(
        app_loggers[0],
        logging.INFO,
        "LLM call succeeded: fake/model (tokens: input=10)",
        {"call_id": "full-uuid", "token_input": 10},
    )

    console_text = stream.getvalue()
    assert "LLM call succeeded: fake/model (tokens: input=10)" in console_text
    assert "full-uuid" not in console_text
    assert "data=" not in console_text

    payload = json.loads((tmp_path / "backend.jsonl").read_text(encoding="utf-8"))
    assert payload["message"] == "LLM call succeeded: fake/model (tokens: input=10)"
    assert payload["data"] == {"call_id": "full-uuid", "token_input": 10}

    app_loggers[0].handlers[1].close()


def test_console_does_not_filter_librarian_tool_logs(
    monkeypatch, tmp_path: Path
) -> None:
    app_loggers = _isolate_app_loggers(monkeypatch)
    configure_backend_logging(_config(tmp_path))
    console, file_handler = app_loggers[0].handlers
    assert isinstance(console, logging.StreamHandler)
    stream = io.StringIO()
    console.setStream(stream)

    log_with_data(
        logging.getLogger("roboz.agent.tool_observability"),
        logging.INFO,
        "Tool call succeeded: sleep (agent=librarian)",
        {"agent": "librarian", "tool": "sleep"},
    )

    assert "Tool call succeeded: sleep (agent=librarian)" in stream.getvalue()
    file_handler.close()


def test_console_keeps_internal_traceback_while_jsonl_omits_it(
    monkeypatch, tmp_path: Path
) -> None:
    app_loggers = _isolate_app_loggers(monkeypatch)
    configure_backend_logging(_config(tmp_path))
    console = app_loggers[0].handlers[0]
    stream = io.StringIO()
    console.setStream(stream)

    try:
        raise ValueError("internal boom")
    except ValueError as error:
        log_with_data(
            app_loggers[0],
            logging.ERROR,
            "Provider request failed",
            {
                "error_type": type(error).__name__,
                "status": 401,
            },
            exc_info=True,
        )

    raw = (tmp_path / "backend.jsonl").read_text(encoding="utf-8")
    payload = json.loads(raw)
    assert "ValueError: internal boom" in stream.getvalue()
    assert "internal boom" not in raw
    assert "exception" not in payload
    assert payload["data"] == {"error_type": "ValueError", "status": 401}

    app_loggers[0].handlers[1].close()


def test_file_handler_creates_private_directory_and_file(
    monkeypatch, tmp_path: Path
) -> None:
    app_loggers = _isolate_app_loggers(monkeypatch)
    path = tmp_path / "private" / "nested" / "backend.jsonl"
    base = _config(tmp_path)
    config = HubLoggingConfig(
        console_level=base.console_level,
        path=path,
        file_level=base.file_level,
        max_bytes=base.max_bytes,
        backup_count=base.backup_count,
        on_error=base.on_error,
    )

    configure_backend_logging(config)

    assert stat.S_IMODE(path.parent.stat().st_mode) == 0o700
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    app_loggers[0].handlers[1].close()


def test_jsonl_rotates_at_configured_size(monkeypatch, tmp_path: Path) -> None:
    app_loggers = _isolate_app_loggers(monkeypatch)
    base = _config(tmp_path)
    config = HubLoggingConfig(
        console_level=base.console_level,
        path=base.path,
        file_level=base.file_level,
        max_bytes=200,
        backup_count=2,
        on_error=base.on_error,
    )
    configure_backend_logging(config)

    for sequence in range(4):
        log_with_data(
            app_loggers[0],
            logging.INFO,
            "Rotation probe",
            {"sequence": sequence, "padding_chars": 80},
        )

    assert config.path.exists()
    assert config.path.with_name("backend.jsonl.1").exists()
    assert not config.path.with_name("backend.jsonl.3").exists()
    app_loggers[0].handlers[1].close()


def test_successful_uvicorn_access_remains_visible_and_is_persisted(
    monkeypatch, tmp_path: Path
) -> None:
    app_loggers = _isolate_app_loggers(monkeypatch)
    access_logger = logging.getLogger("uvicorn.access")
    access_stream = io.StringIO()
    access_console = logging.StreamHandler(access_stream)
    access_logger.addHandler(access_console)
    access_logger.setLevel(logging.INFO)

    configure_backend_logging(_config(tmp_path))
    access_logger.info(
        '%s - "%s %s HTTP/%s" %s',
        "127.0.0.1:1",
        "POST",
        "/transcribe",
        "1.1",
        200,
    )

    assert 'POST /transcribe HTTP/1.1" 200' in access_stream.getvalue()
    payload = json.loads((tmp_path / "backend.jsonl").read_text(encoding="utf-8"))
    assert 'POST /transcribe HTTP/1.1" 200' in payload["message"]
    assert "data" not in payload
    app_loggers[0].handlers[1].close()


def test_file_initialization_failure_can_fail_startup(
    monkeypatch, tmp_path: Path
) -> None:
    _isolate_app_loggers(monkeypatch)

    def fail_file_handler(config: HubLoggingConfig) -> logging.Handler:
        del config
        raise OSError("permission denied")

    monkeypatch.setattr(backend_logging, "_build_file_handler", fail_file_handler)

    with pytest.raises(RuntimeError, match="Cannot initialize backend log file"):
        configure_backend_logging(_config(tmp_path))


def test_file_initialization_failure_can_fall_back_to_console(
    monkeypatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    app_loggers = _isolate_app_loggers(monkeypatch)
    base = _config(tmp_path)
    config = HubLoggingConfig(
        console_level=base.console_level,
        path=base.path,
        file_level=base.file_level,
        max_bytes=base.max_bytes,
        backup_count=base.backup_count,
        on_error="console",
    )

    def fail_file_handler(config: HubLoggingConfig) -> logging.Handler:
        del config
        raise OSError("permission denied")

    monkeypatch.setattr(backend_logging, "_build_file_handler", fail_file_handler)

    configure_backend_logging(config)

    assert all(len(app_logger.handlers) == 1 for app_logger in app_loggers)
    console = app_loggers[0].handlers[0]
    assert isinstance(console, logging.StreamHandler)
    captured = capsys.readouterr()
    assert "Persistent backend logging unavailable" in captured.err
    assert "OSError" in captured.err
