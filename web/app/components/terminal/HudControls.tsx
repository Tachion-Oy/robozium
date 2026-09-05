import { AudioLevelMeter } from "./AudioLevelMeter"
import { HudCopyControls } from "./HudCopyControls"
import {
	HudMessageNavigation,
	type HudMessageNavigationModel,
} from "./HudMessageNavigation"

export type LayoutMode = "equal" | "top" | "bottom"
export type LayoutDirection = "up" | "down"

/** Panel-seam order from its lowest position to its highest position. */
export const LAYOUT_MODES: readonly LayoutMode[] = ["top", "equal", "bottom"]

export function moveLayoutMode(
	mode: LayoutMode,
	direction: LayoutDirection,
): LayoutMode {
	const index = LAYOUT_MODES.indexOf(mode)
	const offset = direction === "up" ? 1 : -1
	const nextIndex = Math.min(
		LAYOUT_MODES.length - 1,
		Math.max(0, index + offset),
	)
	return LAYOUT_MODES[nextIndex]
}

export type HudLayoutControls = {
	mode: LayoutMode
	onMove: (direction: LayoutDirection) => void
	onMinimize: () => void
}

export type HudDictationControls = {
	isRecording: boolean
	audioLevel?: number
	isTranscribing: boolean
	error: string | null
	onToggle: () => void
}

export type HudPendingAction = {
	isPending: boolean
	onTrigger: () => void
}

export type HudControlModel = {
	dictation: HudDictationControls
	cancel?: HudPendingAction
	interrupt?: HudPendingAction
}

type HudControlsProps = HudControlModel & {
	navigation: HudMessageNavigationModel
	replyDraft: string
	onClearReply: () => void
	submission: {
		canSubmit: boolean
		isSubmitting: boolean
	}
}

export function HudCornerControls({
	layout,
	disabled = false,
}: {
	layout: HudLayoutControls
	disabled?: boolean
}) {
	return (
		<div
			className="agent-hud__corner-controls"
			data-disabled={disabled || undefined}>
			<button
				type="button"
				className="agent-hud__minimize agent-hud__corner-control"
				onClick={layout.onMinimize}
				disabled={disabled}
				aria-label="Minimize"
				title="Minimize">
				<svg
					className="agent-hud__size-icon"
					viewBox="0 0 20 20"
					aria-hidden="true">
					<path d="M3 8h5V3M17 8h-5V3M3 12h5v5M17 12h-5v5" />
				</svg>
			</button>
			<div
				className="agent-hud__layout-controls"
				role="group"
				aria-label={`Panel divider: ${layout.mode}`}>
				<button
					type="button"
					className="agent-hud__layout-direction agent-hud__corner-control"
					onClick={() => layout.onMove("up")}
					disabled={disabled || layout.mode === "bottom"}
					aria-label="Move panel divider up">
					<svg
						className="agent-hud__layout-wedge agent-hud__layout-wedge--up"
						viewBox="0 0 16 14"
						aria-hidden="true">
						<path d="M8 1.25 14.75 12.75H1.25Z" />
					</svg>
				</button>
				<button
					type="button"
					className="agent-hud__layout-direction agent-hud__corner-control"
					onClick={() => layout.onMove("down")}
					disabled={disabled || layout.mode === "top"}
					aria-label="Move panel divider down">
					<svg
						className="agent-hud__layout-wedge agent-hud__layout-wedge--down"
						viewBox="0 0 16 14"
						aria-hidden="true">
						<path d="M8 1.25 14.75 12.75H1.25Z" />
					</svg>
				</button>
			</div>
		</div>
	)
}

export function HudControls({
	dictation,
	navigation,
	replyDraft,
	onClearReply,
	submission,
	cancel,
	interrupt,
}: HudControlsProps) {
	const dictationLabel = dictation.isTranscribing
		? "Text…"
		: dictation.isRecording
			? "Stop"
			: "Record"
	const dictationAccessibleLabel = dictation.isTranscribing
		? "Transcribing voice input"
		: dictationLabel
	const dictationState = dictation.isTranscribing
		? "transcribing"
		: dictation.isRecording
			? "recording"
			: "idle"

	return (
		<div className="agent-hud__actions">
			<div className="agent-hud__run-actions">
				{cancel ? (
					<button
						type="button"
						className="agent-hud__cancel"
						onClick={cancel.onTrigger}
						disabled={cancel.isPending}>
						{cancel.isPending ? "Cancelling..." : "Cancel"}
					</button>
				) : null}
				{interrupt ? (
					<button
						type="button"
						className="agent-hud__interrupt"
						onClick={interrupt.onTrigger}
						disabled={interrupt.isPending || cancel?.isPending}>
						{interrupt.isPending ? "Interrupting..." : "Interrupt"}
					</button>
				) : null}
			</div>
			<HudMessageNavigation {...navigation} />
			<div className="agent-hud__actions-submit">
				<HudCopyControls
					replyDraft={replyDraft}
					onClearReply={onClearReply}
				/>
				<button
					type="button"
					className="agent-hud__dictate"
					onClick={dictation.onToggle}
					disabled={dictation.isTranscribing}
					data-dictation-state={dictationState}
					aria-label={dictationAccessibleLabel}
					title={dictation.isTranscribing ? dictationAccessibleLabel : undefined}
					aria-pressed={dictation.isRecording}>
					<span>{dictationLabel}</span>
					{dictation.isRecording ? (
						<AudioLevelMeter level={dictation.audioLevel ?? 0} />
					) : null}
				</button>
				<button
					type="submit"
					className="agent-hud__send"
					disabled={
						submission.isSubmitting ||
						!submission.canSubmit ||
						cancel?.isPending ||
						interrupt?.isPending
					}>
					Send
				</button>
			</div>
		</div>
	)
}
