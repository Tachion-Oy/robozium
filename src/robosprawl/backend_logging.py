"""Console and rotating technical-file logging for the backend."""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import UTC, datetime
from logging.handlers import RotatingFileHandler
from urllib.parse import urlsplit

from roboz.runtime import LOG_DATA_ATTRIBUTE, LOG_DATE_FORMAT, LOG_FORMAT

from robosprawl.hub import HubLoggingConfig

_APPLICATION_LOGGERS = ("robosprawl", "roboz_shed", "roboz")
_UVICORN_LOGGERS = ("uvicorn.access", "uvicorn.error")
_POLLING_PATHS = (re.compile(r"/projects"), re.compile(r"/run/[^/]+"))
_HANDLERS: tuple[logging.Handler, logging.Handler | None] | None = None


def _level(name: str) -> int:
    return logging.getLevelNamesMapping()[name]


class _JsonLinesFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        record_data = getattr(record, LOG_DATA_ATTRIBUTE, {})
        data = (
            {
                key: value
                for key, value in record_data.items()
                if isinstance(key, str)
                and (value is None or isinstance(value, (str, int, float, bool)))
            }
            if isinstance(record_data, dict)
            else {}
        )
        payload: dict[str, object] = {
            "timestamp": datetime.fromtimestamp(record.created, UTC)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
            "level": record.levelname,
            "logger": record.name,
            "thread": record.threadName,
            "message": record.getMessage(),
        }
        if data:
            payload["data"] = data
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


class _SecureRotatingFileHandler(RotatingFileHandler):
    def _open(self):
        stream = super()._open()
        os.chmod(self.baseFilename, 0o600)
        return stream


def _build_console_handler(config: HubLoggingConfig) -> logging.Handler:
    handler = logging.StreamHandler()
    handler.setLevel(_level(config.console_level))
    handler.setFormatter(logging.Formatter(LOG_FORMAT, LOG_DATE_FORMAT))
    return handler


def _build_file_handler(config: HubLoggingConfig) -> logging.Handler:
    path = config.path
    parent_existed = path.parent.exists()
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not parent_existed:
        path.parent.chmod(0o700)
    handler = _SecureRotatingFileHandler(
        path,
        maxBytes=config.max_bytes,
        backupCount=config.backup_count,
        encoding="utf-8",
    )
    handler.setLevel(_level(config.file_level))
    handler.setFormatter(_JsonLinesFormatter())
    return handler


def _attach(logger: logging.Logger, handler: logging.Handler | None) -> None:
    if handler is not None and handler not in logger.handlers:
        logger.addHandler(handler)


def keep_access_log(record: logging.LogRecord) -> bool:
    """Hide successful UI status polls while retaining all other requests."""
    args = record.args
    if not isinstance(args, tuple) or len(args) < 5:
        return True
    method, raw_path, raw_status = str(args[1]), str(args[2]), str(args[4])
    try:
        status_code = int(raw_status)
    except ValueError:
        return True
    if method.upper() != "GET" or status_code >= 500:
        return True
    path = urlsplit(raw_path).path.rstrip("/") or "/"
    return not any(pattern.fullmatch(path) for pattern in _POLLING_PATHS)


def configure_backend_logging(config: HubLoggingConfig) -> None:
    """Install application console and technical-file handlers once."""
    global _HANDLERS
    if _HANDLERS is None:
        console = _build_console_handler(config)
        try:
            file_handler = _build_file_handler(config)
        except OSError as error:
            if config.on_error == "fail":
                raise RuntimeError(
                    f"Cannot initialize backend log file {config.path}"
                ) from error
            file_handler = None
            fallback = logging.getLogger("robosprawl")
            _attach(fallback, console)
            fallback.setLevel(console.level)
            fallback.error(
                "Persistent backend logging unavailable (path=%s, error_type=%s)",
                config.path,
                type(error).__name__,
            )
        _HANDLERS = console, file_handler

    console, file_handler = _HANDLERS
    logger_level = min(
        console.level,
        file_handler.level if file_handler is not None else logging.CRITICAL,
    )
    for name in _APPLICATION_LOGGERS:
        logger = logging.getLogger(name)
        _attach(logger, console)
        _attach(logger, file_handler)
        logger.setLevel(logger_level)
        logger.propagate = False

    for name in _UVICORN_LOGGERS:
        _attach(logging.getLogger(name), file_handler)

    access_logger = logging.getLogger("uvicorn.access")
    if keep_access_log not in access_logger.filters:
        access_logger.addFilter(keep_access_log)
