// Copied from web/app/components/hud/onboarding/OnboardingHud.tsx at af87bea.
// Adapted: desktop import paths.
import { useState } from "react"
import type { ReplyImagesModel } from "../../attachments/useReplyImages"
import type { LayoutMode } from "../hud/HudCornerControls"
import { ReplyForm } from "../run/ReplyForm"
import { AgentActivityState, type HudMessageNavigationDirection } from "../run/run-view"
import { ONBOARDING_PAGES } from "./pages"

const ignore = () => {}

const NO_IMAGES: ReplyImagesModel = {
	images: [],
	error: null,
	isBusy: false,
	isReady: true,
	canAdd: false,
	canRetry: false,
	onRetry: ignore,
	submit: async () => false,
	onDrop: ignore,
	onRemove: ignore,
	onClear: ignore,
}

type OnboardingHudProps = {
	layoutMode: LayoutMode
	/** Leaving backwards from the first page returns to Runs Overview. */
	onExit: () => void
}

/** Setup guide in the run view's shape: only the message arrows are enabled. */
export function OnboardingHud({ layoutMode, onExit }: OnboardingHudProps) {
	const [index, setIndex] = useState(0)
	const last = ONBOARDING_PAGES.length - 1
	const page = ONBOARDING_PAGES[index]

	const navigate = (direction: HudMessageNavigationDirection) => {
		if (direction === "previous" && index === 0) {
			onExit()
			return
		}
		setIndex(
			direction === "first"
				? 0
				: direction === "latest"
					? last
					: Math.min(last, Math.max(0, index + (direction === "next" ? 1 : -1))),
		)
	}

	return (
		<ReplyForm
			locked
			layoutMode={layoutMode}
			message={{ ...page, contentType: "markdown", mode: "current" }}
			composer={{
				value: "",
				images: NO_IMAGES,
				isReplyAvailable: false,
				isSubmitting: false,
				onChange: ignore,
				onSubmit: ignore,
			}}
			navigation={{
				agentActivityState: AgentActivityState.AwaitingInput,
				enabled: {
					first: index > 0,
					previous: true,
					next: index < last,
					latest: index < last,
				},
				onNavigate: navigate,
			}}
			controls={{
				dictation: {
					isRecording: false,
					isTranscribing: false,
					onToggle: ignore,
				},
				cancel: { isPending: false, onTrigger: ignore },
				interrupt: { isPending: false, onTrigger: ignore },
			}}
		/>
	)
}
