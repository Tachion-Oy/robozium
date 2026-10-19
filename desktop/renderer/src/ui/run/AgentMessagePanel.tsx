"use client"

import { useEffect, useRef } from "react"
import type { ContentType } from "@/lib/robozium/view-model"
import { HudMarkdown } from "./HudMarkdown"

export type AgentMessage = {
	id: string
	content: string
	contentType: ContentType
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
				{message.contentType === "plain-text" ? (
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
