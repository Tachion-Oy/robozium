"""Validate image bytes and own temporary files for a single run."""

import shutil
from dataclasses import dataclass
from html import escape
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from PIL import Image as PillowImage
from roboz.models import Image, Str, StrImage

from robozium.hub.application import AttachmentSettings

DIRECTORY = ".robozium-attachments"
FORMATS = {"PNG": "png", "JPEG": "jpeg", "WEBP": "webp", "GIF": "gif"}


@dataclass(frozen=True)
class UploadedImage:
    name: str
    data: bytes
    format: str

    @classmethod
    def validate(
        cls, name: str, data: bytes, settings: AttachmentSettings
    ) -> "UploadedImage":
        if len(data) > settings.max_image_bytes:
            raise ValueError("Image exceeds the configured byte limit")
        try:
            with PillowImage.open(BytesIO(data)) as image:
                format = FORMATS.get(image.format or "")
                if format is None or getattr(image, "is_animated", False):
                    raise ValueError("Use static PNG, JPEG, WebP, or GIF images")
                if image.width * image.height > settings.max_pixels:
                    raise ValueError("Image exceeds the configured pixel limit")
                image.verify()
            with PillowImage.open(BytesIO(data)) as image:
                image.load()
        except (OSError, SyntaxError, PillowImage.DecompressionBombError) as exc:
            raise ValueError("Invalid image upload") from exc
        return cls(name, data, format)


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
        project_root: Path,
        hub_root: Path,
        run_id: str,
        settings: AttachmentSettings = AttachmentSettings(),
    ) -> None:
        self.path = project_root / DIRECTORY / run_id
        self._hub_root = hub_root
        self._retained_bytes = 0
        self._settings = settings
        self._pending: list[tuple[Path, str, int]] = []

    @property
    def has_pending(self) -> bool:
        return bool(self._pending)

    def add(self, image: UploadedImage) -> str:
        """Stage one validated image while the caller holds its run lock."""
        if len(self._pending) >= self._settings.max_images:
            raise ValueError("Reply exceeds the configured image count limit")
        size = len(image.data)
        if self._retained_bytes + size > self._settings.max_run_bytes:
            raise ValueError("Temporary images exceed the configured run byte limit")
        if self.path.resolve() != self.path or self.path.is_symlink():
            raise ValueError("Attachment directories must not use symbolic links")
        self.path.mkdir(parents=True, exist_ok=True)
        path = self.path / f"{uuid4().hex}.{image.format}"
        file = path.open("xb")
        try:
            with file:
                file.write(image.data)
        except BaseException:
            path.unlink(missing_ok=True)
            raise
        self._pending.append((path, image.name, size))
        self._retained_bytes += size
        return path.relative_to(self._hub_root).as_posix()

    def build_reply(self, content: Str | StrImage) -> Str | StrImage:
        if not self._pending:
            return content
        links = []
        images = list(content.images) if isinstance(content, StrImage) else []
        for path, name, _ in self._pending:
            src = path.relative_to(self._hub_root).as_posix()
            links.append(f'<file src="{escape(src, quote=True)}">{escape(name)}</file>')
            images.append(Image.from_bytes(
                path.read_bytes(), media_type=f"image/{path.suffix[1:]}"
            ))
        return StrImage(
            value="\n".join(([content.value] if content.value else []) + links),
            images=images,
        )

    def clear_pending(self, *, delete_files: bool = False) -> None:
        """Keep accepted files readable; delete unsent files when a prompt ends."""
        if delete_files:
            for path, _, size in self._pending:
                path.unlink(missing_ok=True)
                self._retained_bytes -= size
        self._pending.clear()

    def cleanup(self) -> None:
        remove_attachments(self.path)
