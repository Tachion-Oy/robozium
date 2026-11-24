"""API interaction adapter; the run controller owns prompt state."""

from roboz.models import Message, MessageKind, Role, Str, StrImage
from roboz.runtime.events import MessageEvent

from robozium.api.run_control import RunControl


class ApiUserIO:
    def __init__(self, control: RunControl) -> None:
        self._control = control

    def request_input(
        self, message: str, timeout: float | None = None, *, accepts_images: bool = False
    ) -> Str | StrImage | None:
        # The wait after a failed model call asks with empty text: nothing to record.
        if message:
            self._record(message, MessageKind.USER_PROMPT)
        return self._control.request_input(message, timeout, accepts_images=accepts_images)

    def notify(self, message: str) -> None:
        self._record(message, MessageKind.USER_NOTIFICATION)

    def _record(self, message: str, kind: MessageKind) -> None:
        """Write a message shown to the user into the run history under its kind."""
        self._control.dispatch(
            MessageEvent(
                message=Message(role=Role.ASSISTANT, content=message, message_kind=kind),
                sequence=0,
            )
        )
