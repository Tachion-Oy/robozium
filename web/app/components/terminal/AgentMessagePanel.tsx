"use client"

import { useEffect, useRef } from "react"
import { HudMarkdown } from "./HudMarkdown"

export type AgentMessage = {
	id: string
	content: string
	mode: "current" | "history" | "streaming"
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
				ref={scrollRef}>
				{message.mode === "streaming" ? (
					<pre
						className="agent-hud__stream-text"
						aria-live="polite">
						{message.content}
					</pre>
				) : (
					<HudMarkdown>{message.content}</HudMarkdown>
				)}
			</div>
		</div>
	)
}
