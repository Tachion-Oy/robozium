"""Validate image bytes and own temporary files for a single run."""

import shutil
from dataclasses import dataclass
from html import escape
from io import BytesIO
from pathlib import Path
from uuid import UUID, uuid4

from PIL import Image as PillowImage
from roboz.models import Image, Str, StrImage

from robozium.hub.application import AttachmentSettings

DIRECTORY = ".robozium-attachments"
FORMATS = {"PNG": "png", "JPEG": "jpeg", "WEBP": "webp", "GIF": "gif"}


@dataclass(frozen=True)
class AttachmentInfo:
    id: str
    name: str
    path: str
    upload_id: UUID | None = None


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
        self._pending: dict[str, tuple[Path, AttachmentInfo, int]] = {}

    @property
    def has_pending(self) -> bool:
        return bool(self._pending)

    def pending(self) -> list[AttachmentInfo]:
        return [info for _, info, _ in self._pending.values()]

    def add(self, image: UploadedImage, upload_id: UUID | None = None) -> AttachmentInfo:
        """Save one new pending attachment while the caller holds the run lock."""
        size = len(image.data)
        self._check_capacity(size)
        path = self._save_image(image)
        info = AttachmentInfo(
            id=path.stem,
            name=image.name,
            path=path.relative_to(self._hub_root).as_posix(),
            upload_id=upload_id,
        )
        self._pending[info.id] = (path, info, size)
        self._retained_bytes += size
        return info

    def _check_capacity(self, size: int) -> None:
        if len(self._pending) >= self._settings.max_images:
            raise ValueError("Reply exceeds the configured image count limit")
        if self._retained_bytes + size > self._settings.max_run_bytes:
            raise ValueError("Temporary images exceed the configured run byte limit")

    def _save_image(self, image: UploadedImage) -> Path:
        if self.path.resolve() != self.path or self.path.is_symlink():
            raise ValueError("Attachment directories must not use symbolic links")
        self.path.mkdir(parents=True, exist_ok=True)
        image_path = self.path / f"{uuid4().hex}.{image.format}"
        # Failed exclusive creation must not unlink an existing file.
        file = image_path.open("xb")
        try:
            with file:
                file.write(image.data)
        except BaseException:
            image_path.unlink(missing_ok=True)
            raise
        return image_path

    def build_reply(self, content: Str | StrImage) -> Str | StrImage:
        if not self._pending:
            return content
        links = []
        images = list(content.images) if isinstance(content, StrImage) else []
        for path, info, _ in self._pending.values():
            src = path.relative_to(self._hub_root).as_posix()
            links.append(f'<file src="{escape(src, quote=True)}">{escape(info.name)}</file>')
            images.append(Image.from_bytes(
                path.read_bytes(), media_type=f"image/{path.suffix[1:]}"
            ))
        return StrImage(
            value="\n".join(([content.value] if content.value else []) + links),
            images=images,
        )

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
