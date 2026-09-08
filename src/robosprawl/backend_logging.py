"""Console and rotating technical-file logging for the backend."""

from __future__ import annotations

import json
import logging
import os
import re
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from logging.handlers import RotatingFileHandler
from threading import Lock
from urllib.parse import urlsplit

from roboz.runtime import LOG_DATA_ATTRIBUTE, LOG_DATE_FORMAT, LOG_FORMAT

from robosprawl.hub.logging import HubLoggingConfig

_APPLICATION_LOGGERS = ("robosprawl", "roboshed", "roboz")
_UVICORN_LOGGERS = ("uvicorn.access", "uvicorn.error")
_POLLING_PATHS = (re.compile(r"/projects"), re.compile(r"/run/[^/]+"))


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
        try:
            os.chmod(self.baseFilename, 0o600)
        except OSError:
            stream.close()
            raise
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


class _ProcessLogging:
    """Own process handlers; application lifespans only register their use."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._users = 0
        self._config: HubLoggingConfig | None = None
        self._handlers: tuple[logging.Handler, ...] = ()
        self._saved: list[tuple[logging.Logger, int, bool]] = []
        self._filter_added = False

    @contextmanager
    def use(self, config: HubLoggingConfig) -> Iterator[None]:
        with self._lock:
            if self._users and self._config != config:
                raise RuntimeError(
                    "Backend logging is already in use with a different configuration"
                )
            if not self._users:
                self._install(config)
                self._config = config
            self._users += 1
        try:
            yield
        finally:
            with self._lock:
                self._users -= 1
                if not self._users:
                    self._config = None
                    self._uninstall()

    def _install(self, config: HubLoggingConfig) -> None:
        self._saved = [
            (logger, logger.level, logger.propagate)
            for name in _APPLICATION_LOGGERS
            for logger in (logging.getLogger(name),)
        ]
        try:
            console = _build_console_handler(config)
            self._handlers = (console,)
            file_handler = None
            file_error = None
            try:
                file_handler = _build_file_handler(config)
            except OSError as error:
                if config.on_error == "fail":
                    raise RuntimeError(
                        f"Cannot initialize backend log file {config.path}"
                    ) from error
                file_error = error
            if file_handler is not None:
                self._handlers += (file_handler,)

            logger_level = min(handler.level for handler in self._handlers)
            for name in _APPLICATION_LOGGERS:
                logger = logging.getLogger(name)
                for handler in self._handlers:
                    _attach(logger, handler)
                logger.setLevel(logger_level)
                logger.propagate = False

            for name in _UVICORN_LOGGERS:
                _attach(logging.getLogger(name), file_handler)

            access_logger = logging.getLogger("uvicorn.access")
            if keep_access_log not in access_logger.filters:
                access_logger.addFilter(keep_access_log)
                self._filter_added = True

            if file_error is not None:
                logging.getLogger("robosprawl").error(
                    "Persistent backend logging unavailable (path=%s, error_type=%s)",
                    config.path,
                    type(file_error).__name__,
                )
        except BaseException:
            self._uninstall()
            raise

    def _uninstall(self) -> None:
        for name in (*_APPLICATION_LOGGERS, *_UVICORN_LOGGERS):
            logger = logging.getLogger(name)
            for handler in self._handlers:
                logger.removeHandler(handler)
        if self._filter_added:
            logging.getLogger("uvicorn.access").removeFilter(keep_access_log)
        for logger, level, propagate in self._saved:
            logger.setLevel(level)
            logger.propagate = propagate
        for handler in self._handlers:
            handler.close()
        self._handlers = ()
        self._saved = []
        self._filter_added = False


_PROCESS_LOGGING = _ProcessLogging()


@contextmanager
def backend_logging_context(config: HubLoggingConfig) -> Iterator[None]:
    """Use the process logging configuration until this application exits."""
    with _PROCESS_LOGGING.use(config):
        yield
