"""Validated image uploads and run-owned, disposable project storage."""

from __future__ import annotations

import os
import shutil
import stat
import warnings
from dataclasses import dataclass
from html import escape
from io import BytesIO
from pathlib import Path
from threading import RLock
from uuid import UUID, uuid4

from PIL import Image as PillowImage
from roboz.models import Image, StrImage

from robozium.api.projects import Project

ATTACHMENTS_DIR = ".robozium-attachments"
OWNER_FILE = ".owner"
OWNER = b"robozium image attachments v1\n"
MAX_IMAGES = 4
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_RUN_BYTES = 100 * 1024 * 1024
MAX_IMAGE_PIXELS = 25_000_000
MAX_REPLY_BYTES = 41 * 1024 * 1024
IMAGE_FORMATS = {
    "PNG": ("image/png", ".png"),
    "JPEG": ("image/jpeg", ".jpg"),
    "WEBP": ("image/webp", ".webp"),
    "GIF": ("image/gif", ".gif"),
}


class ImagesNotSupported(ValueError):
    """The pending prompt or receiving model cannot accept images."""


@dataclass(frozen=True)
class UploadedImage:
    filename: str
    data: bytes
    media_type: str
    suffix: str


def validate_image(filename: str, data: bytes) -> UploadedImage:
    """Decode and verify a complete, single-frame image before writing it."""
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise ValueError("Each image must contain between 1 byte and 10 MiB")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", PillowImage.DecompressionBombWarning)
            with PillowImage.open(BytesIO(data)) as image:
                if image.format not in IMAGE_FORMATS:
                    raise ValueError("Use a PNG, JPEG, WebP, or GIF image")
                media_type, suffix = IMAGE_FORMATS[image.format]
                if image.width * image.height > MAX_IMAGE_PIXELS:
                    raise ValueError("Images must not exceed 25 megapixels")
                if getattr(image, "n_frames", 1) != 1:
                    raise ValueError("Animated images are not supported")
                image.verify()
            # verify() checks structure; load() also detects incomplete pixels.
            with PillowImage.open(BytesIO(data)) as image:
                image.load()
    except (
        OSError,
        EOFError,
        SyntaxError,
        PillowImage.DecompressionBombError,
        PillowImage.DecompressionBombWarning,
    ) as exc:
        raise ValueError("Invalid or incomplete image") from exc
    return UploadedImage(filename, data, media_type, suffix)


@dataclass(frozen=True)
class StagedReply:
    reply: StrImage
    paths: tuple[Path, ...]


class AttachmentStore:
    """Reserve upload bytes until commit, rollback, or final worker cleanup.

    Only generated paths are written. The reserved directory is host-owned;
    agents can use the existing file tools to copy images into durable files.
    """

    def __init__(self, project: Project, run_id: str) -> None:
        self._project = project
        self.root = project.root / ATTACHMENTS_DIR / str(UUID(run_id))
        self._lock = RLock()
        self._closed = False

    def stage(self, content: str, images: list[UploadedImage]) -> StagedReply:
        size = sum(len(image.data) for image in images)
        with self._lock:
            if self._closed:
                raise ValueError("run attachment storage has closed")
            if not 1 <= len(images) <= MAX_IMAGES:
                raise ValueError("A reply may contain at most four images")
            for directory in (self.root.parent, self.root):
                if directory.is_symlink() or directory.resolve() != directory:
                    raise ValueError("Attachment storage must not use symbolic links")
            self.root.parent.mkdir(exist_ok=True)
            try:
                self.root.mkdir()
            except FileExistsError:
                pass
            else:
                with (self.root / OWNER_FILE).open("xb") as stream:
                    stream.write(OWNER)
            if not _owned(self.root):
                raise ValueError("Attachment directory is not owned by Robozium")
            retained = 0
            # Existing file operations may have moved images out of temporary
            # storage. Count retained regular files, without following links.
            for path in self.root.rglob("*"):
                metadata = path.lstat()
                if path != self.root / OWNER_FILE and stat.S_ISREG(metadata.st_mode):
                    retained += metadata.st_size
            if retained + size > MAX_RUN_BYTES:
                raise ValueError("Run image storage limit of 100 MiB exceeded")
            paths: list[Path] = []
            links: list[str] = []
            inputs: list[Image] = []
            try:
                for image in images:
                    path = self.root / f"{uuid4().hex}{image.suffix}"
                    with path.open("xb") as stream:
                        paths.append(path)
                        stream.write(image.data)
                    relative = path.relative_to(self._project.sandbox.resolved_root)
                    links.append(
                        f'<file src="{escape(relative.as_posix(), quote=True)}">'
                        f"{escape(image.filename or 'Image')}</file>"
                    )
                    inputs.append(
                        Image.from_bytes(image.data, media_type=image.media_type)
                    )
                reply = StrImage(
                    value="\n\n".join(filter(None, [content, *links])), images=inputs
                )
                return StagedReply(reply, tuple(paths))
            except BaseException:
                for path in paths:
                    path.unlink(missing_ok=True)
                raise

    def discard(self, staged: StagedReply) -> None:
        with self._lock:
            # Cleanup may have already removed the entire directory.
            if self._closed:
                return
            if self.root.resolve() != self.root:
                raise ValueError("Attachment storage must not use symbolic links")
            for path in staged.paths:
                path.unlink(missing_ok=True)

    def cleanup(self) -> None:
        """Close storage only after foreground and background workers stop."""
        with self._lock:
            self._closed = True
            _remove_owned(self.root)


def _remove_owned(directory: Path) -> None:
    if directory.resolve() != directory or not directory.is_dir():
        return
    if not _owned(directory):
        return
    # Python's rmtree never traverses descendant symlinks.
    shutil.rmtree(directory)


def _owned(directory: Path) -> bool:
    marker = directory / OWNER_FILE
    if marker.is_symlink():
        return False
    try:
        descriptor = os.open(
            marker,
            os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0),
        )
    except OSError:
        return False
    with os.fdopen(descriptor, "rb") as stream:
        metadata = os.fstat(stream.fileno())
        return (
            stat.S_ISREG(metadata.st_mode)
            and metadata.st_nlink == 1
            and stream.read(len(OWNER) + 1) == OWNER
        )


def recover_attachments(project: Project) -> None:
    """Remove abandoned UUID directories bearing our marker, without following links."""
    root = project.root / ATTACHMENTS_DIR
    if project.root.is_symlink() or root.is_symlink() or not root.is_dir():
        return
    for child in root.iterdir():
        try:
            if str(UUID(child.name)) != child.name:
                continue
        except ValueError:
            continue
        _remove_owned(child)
