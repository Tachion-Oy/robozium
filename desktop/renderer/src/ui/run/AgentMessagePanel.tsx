// Content types come from the desktop HUD view. The illustration is named by a
// class because the renderer CSP forbids inline styles. The inline image viewer sits outside
// the per-message Markdown so a new message does not close it, and the scroll
// area takes focus back when the viewer's trigger is gone.
import { useEffect, useRef } from "react"
import type { ContentType } from "../../hud/hud-view"
import { HudImageViewer } from "./HudImage"
import { HudMarkdown } from "./HudMarkdown"

export type AgentMessage = {
	id: string
	content: string
	contentType: ContentType
	mode: "current" | "history" | "streaming"
	/** Static app artwork shown beside the text; agent content never sets it. */
	illustration?: { name: "keys" | "secrets"; alt: string }
	/** Status text, such as the working indicator, that is not copied as agent output. */
	indicator?: boolean
}

type AgentMessagePanelProps = {
	message: AgentMessage
}

export function AgentMessagePanel({ message }: AgentMessagePanelProps) {
	const scrollRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const element = scrollRef.current
		if (!element) return
		element.scrollTop =
			message.mode === "streaming" ? element.scrollHeight : 0
	}, [message.content, message.id, message.mode])

	return (
		<div className="agent-hud__replyBox agent-hud__replyBox--agent">
			<div
				className="agent-hud__replyBox-scroll"
				tabIndex={-1}
				onLoadCapture={() => {
					const element = scrollRef.current
					if (element && message.mode === "streaming") element.scrollTop = element.scrollHeight
				}}
				ref={scrollRef}>
				{message.illustration ? (
					<span
						className={`agent-hud__message-illustration agent-hud__message-illustration--${message.illustration.name}`}
						role="img"
						aria-label={message.illustration.alt}
					/>
				) : null}
				{message.contentType === "plain-text" ? (
					<pre
						className="agent-hud__stream-text"
						aria-live="polite">
						{message.content}
					</pre>
				) : (
					<HudImageViewer returnFocus={scrollRef}>
						<HudMarkdown key={message.id}>{message.content}</HudMarkdown>
					</HudImageViewer>
				)}
			</div>
		</div>
	)
}
