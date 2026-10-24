// Copied from web/app/components/hud/run/AgentMessagePanel.tsx at 86ef5c1.
// Adapted: content types come from the desktop HUD view. The illustration
// follows web at af87bea, named by a class because the renderer CSP forbids
// inline styles. Inline images follow web at 2a0c183.
import { useEffect, useRef } from "react"
import type { ContentType } from "../../hud/hud-view"
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
	hubFileUrl?: (path: string) => string
}

export function AgentMessagePanel({ message, hubFileUrl }: AgentMessagePanelProps) {
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
					<HudMarkdown key={message.id} hubFileUrl={hubFileUrl}>{message.content}</HudMarkdown>
				)}
			</div>
		</div>
	)
}
