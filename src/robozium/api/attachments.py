"""Validate uploaded files and own the temporary files of a single run."""

import re
import shutil
from dataclasses import dataclass
from html import escape
from io import BytesIO
from pathlib import Path, PurePath
from typing import Literal
from uuid import UUID, uuid4

from PIL import Image as PillowImage
from PIL import UnidentifiedImageError
from roboz.models import Image, Str, StrImage

from robozium.hub.application import AttachmentSettings

FORMATS = {"PNG": "png", "JPEG": "jpeg", "WEBP": "webp", "GIF": "gif"}
AttachmentKind = Literal["image", "file"]
# Other files keep a plain extension so the agent's readers recognise them.
_EXTENSION = re.compile(r"[a-z0-9]{1,10}")


@dataclass(frozen=True)
class AttachmentInfo:
    id: str
    name: str
    path: str
    kind: AttachmentKind
    upload_id: UUID | None = None


@dataclass(frozen=True)
class UploadedFile:
    """An image sent to the model with its link, or any other file sent as a link."""

    name: str
    data: bytes
    kind: AttachmentKind
    suffix: str

    @property
    def is_image(self) -> bool:
        return self.kind == "image"

    @classmethod
    def validate(
        cls, name: str, data: bytes, settings: AttachmentSettings
    ) -> "UploadedFile":
        if len(data) > settings.max_file_bytes:
            raise ValueError("File exceeds the configured byte limit")
        try:
            with PillowImage.open(BytesIO(data)) as image:
                format = FORMATS.get(image.format or "")
                # Formats models do not take stay files the agent can copy.
                if format is None or getattr(image, "is_animated", False):
                    return cls._file(name, data)
                if image.width * image.height > settings.max_pixels:
                    raise ValueError("Image exceeds the configured pixel limit")
                image.verify()
            with PillowImage.open(BytesIO(data)) as image:
                image.load()
        except UnidentifiedImageError:
            return cls._file(name, data)
        except (OSError, SyntaxError, PillowImage.DecompressionBombError) as exc:
            raise ValueError("Invalid image upload") from exc
        return cls(name, data, "image", f".{format}")

    @classmethod
    def _file(cls, name: str, data: bytes) -> "UploadedFile":
        extension = PurePath(name).suffix[1:].lower()
        return cls(name, data, "file", f".{extension}" if _EXTENSION.fullmatch(extension) else "")


def remove_attachments(path: Path) -> None:
    """Remove app-owned entries without traversing redirected parent directories."""
    if path.parent.resolve() != path.parent:
        return
    if path.is_symlink():
        path.unlink()
    elif path.is_dir():
        shutil.rmtree(path)


class RunAttachments:
    def __init__(
        self,
        attachments_root: Path,
        hub_root: Path,
        run_id: str,
        settings: AttachmentSettings = AttachmentSettings(),
    ) -> None:
        self.path = attachments_root / run_id
        self._hub_root = hub_root
        self._retained_bytes = 0
        self._settings = settings
        self._pending: dict[str, tuple[Path, AttachmentInfo, int]] = {}

    @property
    def has_pending_images(self) -> bool:
        return any(info.kind == "image" for _, info, _ in self._pending.values())

    def pending(self) -> list[AttachmentInfo]:
        return [info for _, info, _ in self._pending.values()]

    def add(self, file: UploadedFile, upload_id: UUID | None = None) -> AttachmentInfo:
        """Save one new pending attachment while the caller holds the run lock."""
        size = len(file.data)
        self._check_capacity(size)
        path = self._save(file)
        info = AttachmentInfo(
            id=path.stem,
            name=file.name,
            path=path.relative_to(self._hub_root).as_posix(),
            kind=file.kind,
            upload_id=upload_id,
        )
        self._pending[info.id] = (path, info, size)
        self._retained_bytes += size
        return info

    def _check_capacity(self, size: int) -> None:
        if len(self._pending) >= self._settings.max_files:
            raise ValueError("Reply exceeds the configured file count limit")
        if self._retained_bytes + size > self._settings.max_run_bytes:
            raise ValueError("Temporary attachments exceed the configured run byte limit")

    def _save(self, file: UploadedFile) -> Path:
        if self.path.resolve() != self.path or self.path.is_symlink():
            raise ValueError("Attachment directories must not use symbolic links")
        self.path.mkdir(parents=True, exist_ok=True)
        path = self.path / f"{uuid4().hex}{file.suffix}"
        # Failed exclusive creation must not unlink an existing file.
        stream = path.open("xb")
        try:
            with stream:
                stream.write(file.data)
        except BaseException:
            path.unlink(missing_ok=True)
            raise
        return path

    def build_reply(self, content: Str | StrImage) -> Str | StrImage:
        if not self._pending:
            return content
        links = []
        images = list(content.images) if isinstance(content, StrImage) else []
        for path, info, _ in self._pending.values():
            src = path.relative_to(self._hub_root).as_posix()
            links.append(f'<file src="{escape(src, quote=True)}">{escape(info.name)}</file>')
            if info.kind == "image":
                images.append(Image.from_bytes(
                    path.read_bytes(), media_type=f"image/{path.suffix[1:]}"
                ))
        value = "\n".join(([content.value] if content.value else []) + links)
        return StrImage(value=value, images=images) if images else Str(value=value)

    def remove_pending(self, attachment_id: str) -> None:
        """Delete only a registered, unsent file while holding the run lock."""
        entry = self._pending.get(attachment_id)
        if entry is None:
            return
        path, _, size = entry
        if path.parent.resolve() != path.parent:
            raise ValueError("Attachment directories must not use symbolic links")
        path.unlink(missing_ok=True)
        del self._pending[attachment_id]
        self._retained_bytes -= size

    def clear_pending(self, *, delete_files: bool = False) -> None:
        """Consume accepted entries, or explicitly discard unsent files."""
        if delete_files:
            for attachment_id in list(self._pending):
                self.remove_pending(attachment_id)
        self._pending.clear()

    def cleanup(self) -> None:
        remove_attachments(self.path)
        self._pending.clear()
        self._retained_bytes = 0
