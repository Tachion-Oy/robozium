"use client"

import type { AgentMessage } from "./AgentMessagePanel"
import {
	CopyTextButton,
	type CopyTextButtonProps,
} from "./CopyTextButton"

type HudCopyControlsProps = {
	agentMessage: AgentMessage
	replyDraft: string
	onClearReply: () => void
}

/** Copy controls for the two text panels in their visual top-to-bottom order. */
export function HudCopyControls({
	agentMessage,
	replyDraft,
	onClearReply,
}: HudCopyControlsProps) {
	const targets: CopyTextButtonProps[] = [
		{
			copyKey: replyDraft,
			content: replyDraft,
			target: "user reply",
		},
		{
			copyKey: agentMessage.id,
			content: agentMessage.content,
			target: "agent output",
			reverseIcon: true,
		},
	]

	return (
		<div
			className="agent-hud__copy-controls"
			role="group"
			aria-label="Reply text actions">
			<button
				type="button"
				className="agent-hud__copy-text agent-hud__clear-reply"
				onClick={onClearReply}
				disabled={!replyDraft}
				aria-label="Clear reply"
				title="Clear reply">
				<svg
					className="agent-hud__copy-text-icon agent-hud__clear-reply-icon"
					viewBox="0 0 24 24"
					aria-hidden="true">
					<path d="m4.75 14.75 8.9-8.9a2.1 2.1 0 0 1 2.97 0l1.53 1.53a2.1 2.1 0 0 1 0 2.97l-8.9 8.9H7.72l-2.97-2.97a1.08 1.08 0 0 1 0-1.53Z" />
					<path d="m10.25 9.25 4.5 4.5M9.25 19.25H20" />
				</svg>
			</button>
			{targets.map((target) => (
				<CopyTextButton
					key={target.target}
					{...target}
				/>
			))}
		</div>
	)
}
