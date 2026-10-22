"use client"

import { useEffect, useRef, type CSSProperties } from "react"
import type { ContentType } from "@/lib/robozium/view-model"
import { HudMarkdown } from "./HudMarkdown"

export type AgentMessage = {
	id: string
	content: string
	contentType: ContentType
	mode: "current" | "history" | "streaming"
	/** Static app artwork shown below the text; agent content never sets it. */
	illustration?: { src: string; alt: string }
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
				onLoadCapture={() => {
					const element = scrollRef.current
					if (element && message.mode === "streaming") element.scrollTop = element.scrollHeight
				}}
				ref={scrollRef}>
				{message.illustration ? (
					<span
						className="agent-hud__message-illustration"
						role="img"
						aria-label={message.illustration.alt}
						style={{ "--illustration-source": `url("${message.illustration.src}")` } as CSSProperties}
					/>
				) : null}
				{message.contentType === "plain-text" ? (
					<pre
						className="agent-hud__stream-text"
						aria-live="polite">
						{message.content}
					</pre>
				) : (
					<HudMarkdown key={message.id}>{message.content}</HudMarkdown>
				)}
			</div>
		</div>
	)
}
