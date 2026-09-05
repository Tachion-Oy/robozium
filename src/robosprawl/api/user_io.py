"""API interaction adapter; the run controller owns prompt state."""

from roboz.models import Message, MessageKind, Role
from roboz.runtime.events import MessageEvent

from robosprawl.api.run_control import RunControl


class ApiUserIO:
    def __init__(self, control: RunControl) -> None:
        self._control = control

    def request_input(self, message: str, timeout: float | None = None) -> str | None:
        return self._control.request_input(message, timeout)

    def notify(self, message: str) -> None:
        self._control.dispatch(
            MessageEvent(
                message=Message(
                    role=Role.ASSISTANT,
                    content=message,
                    message_kind=MessageKind.USER_NOTIFICATION,
                ),
                sequence=0,
            )
        )
