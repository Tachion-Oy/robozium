import { Suspense } from "react"
import type { ModelSelection } from "@/lib/robosprawl/wire"
import { HudScreenSelector } from "./HudScreenSelector"
import { ModelSelector, ModelSelectorLoading } from "./ModelSelector"
import type { HudView } from "./HudScreenContent"

type HudHeaderProps = {
	view: HudView
	isLanding: boolean
	isRecovery: boolean
	runId: string | null
	modelSelectionPromise: Promise<ModelSelection | null> | null
	onSelectView: (view: HudView) => void
}

export function HudHeader({
	view,
	isLanding,
	isRecovery,
	runId,
	modelSelectionPromise,
	onSelectView,
}: HudHeaderProps) {
	return (
		<div
			className={
				isLanding && view === "main"
					? "agent-hud__header agent-hud__header--landing"
					: "agent-hud__header agent-hud__header--row"
			}>
			<Suspense fallback={<ModelSelectorLoading />}>
				{modelSelectionPromise ? (
					<ModelSelector
						key={isRecovery ? "recovery-default" : (runId ?? "default")}
						runId={isRecovery ? null : runId}
						initialSelection={modelSelectionPromise}
					/>
				) : (
					<ModelSelectorLoading />
				)}
			</Suspense>
			<div className="agent-hud__header-actions flex shrink-0 items-start gap-(--hud-actions-gap)">
				<HudScreenSelector
					view={view}
					isLanding={isLanding}
					isRecovery={isRecovery}
					onSelectView={onSelectView}
				/>
			</div>
		</div>
	)
}
