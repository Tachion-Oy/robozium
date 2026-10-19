// Copied from robozium-electron/desktop/web/app/components/hud/run/RunHud.tsx at 076b2c9.
// Adapted: the displayed run comes from the desktop session owner as props.
// Replies, cancellation, interruption and dictation render unavailable until
// their owners arrive (roadmap steps 14, 15 and 21).
import type { Dispatch, SetStateAction } from "react"
import type { HudDisplay } from "../../hud/hud-view"
import type { LayoutMode } from "../hud/HudCornerControls"
import type { AgentMessage } from "./AgentMessagePanel"
import { ReplyForm } from "./ReplyForm"
import { AgentActivityState, type HudMessageNavigationDirection } from "./run-view"

type RunHudProps = {
	draft: string
	onDraftChange: Dispatch<SetStateAction<string>>
	layoutMode: LayoutMode
	display: HudDisplay
	awaitingInput: boolean
	focusOnOpen: boolean
	onSelect: (index: number) => void
}

const unavailable = { isPending: false, available: false, onTrigger: () => {} }

export function RunHud({
	draft,
	onDraftChange,
	layoutMode,
	display,
	awaitingInput,
	focusOnOpen,
	onSelect,
}: RunHudProps) {
	const { index, currentIndex, count } = display
	const message: AgentMessage = {
		id: display.id,
		content: display.text,
		contentType: display.contentType,
		mode: display.streaming ? "streaming" : index === currentIndex ? "current" : "history",
	}
	const targets: Record<HudMessageNavigationDirection, number> = {
		first: 0,
		previous: index - 1,
		next: index + 1,
		latest: currentIndex,
	}

	return (
		<ReplyForm
			message={message}
			layoutMode={layoutMode}
			composer={{
				value: draft,
				isReplyAvailable: false,
				isSubmitting: false,
				focusOnOpen,
				onChange: onDraftChange,
				onSubmit: () => {},
			}}
			navigation={{
				agentActivityState: awaitingInput
					? AgentActivityState.AwaitingInput
					: AgentActivityState.Working,
				enabled: {
					first: index > 0,
					previous: index > 0,
					next: index < count - 1,
					latest: index !== currentIndex,
				},
				onNavigate: (direction) => onSelect(targets[direction]),
			}}
			controls={{
				dictation: {
					isRecording: false,
					isTranscribing: false,
					available: false,
					onToggle: () => {},
				},
				cancel: unavailable,
				interrupt: unavailable,
			}}
		/>
	)
}
