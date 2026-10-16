"""Keep embedded pixels on live messages, outside public and persisted history."""

from dataclasses import replace

from roboz.runtime.events import EventSink, MessageEvent, PipeEvent


def text_event(event: PipeEvent) -> PipeEvent:
    if isinstance(event, MessageEvent):
        return replace(event, message=event.message.model_copy(update={"images": []}))
    return event


def text_sink(sink: EventSink) -> EventSink:
    def consume(event: PipeEvent) -> None:
        sink(text_event(event))

    return consume
