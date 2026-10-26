// Copied from robozium-electron/desktop/web/app/components/hud/run/HudCopyControls.tsx at 076b2c9.
// Adapted: an indicator message has no agent output to copy. Clear also removes
// images, as in web/app/components/hud/run/HudCopyControls.tsx at 2a0c183. Without a
// message (no reply form) there is nothing to copy, and the buttons are disabled.
// The buttons follow the panels top to bottom, with Clear last.
import type { AgentMessage } from "./AgentMessagePanel"
import {
	CopyTextButton,
	type CopyTextButtonProps,
} from "./CopyTextButton"

type HudCopyControlsProps = {
	agentMessage: AgentMessage | null
	replyDraft: string
	hasImages?: boolean
	disabled?: boolean
	onClearReply: () => void
}

/** Copy the top (agent) panel, copy the bottom (reply) panel, then clear the reply. */
export function HudCopyControls({
	agentMessage,
	replyDraft,
	hasImages = false,
	disabled = false,
	onClearReply,
}: HudCopyControlsProps) {
	const targets: CopyTextButtonProps[] = [
		{
			copyKey: agentMessage?.id ?? "",
			content: !agentMessage || agentMessage.indicator ? "" : agentMessage.content,
			target: "agent output",
			reverseIcon: true,
		},
		{
			copyKey: replyDraft,
			content: replyDraft,
			target: "user reply",
		},
	]

	return (
		<div
			className="agent-hud__copy-controls"
			role="group"
			aria-label="Reply text actions">
			{targets.map((target) => (
				<CopyTextButton
					key={target.target}
					{...target}
					disabled={disabled}
				/>
			))}
			<button
				type="button"
				className="agent-hud__copy-text agent-hud__clear-reply"
				onClick={onClearReply}
				disabled={disabled || (!replyDraft && !hasImages)}
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
		</div>
	)
}
