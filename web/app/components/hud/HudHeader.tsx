import { Suspense } from "react"
import type { ModelSelection } from "@/lib/robozium/wire"
import { ThemeToggle } from "../theme/ThemeToggle"
import { HudScreenSelector } from "./HudScreenSelector"
import {
	ModelSelector,
	ModelSelectorLoading,
} from "./ModelSelector"
import type { HudPresentation, HudScreen } from "./hudPresentation"
import { UnlockApiKeys } from "./UnlockApiKeys"

type HudHeaderProps = {
	presentation: HudPresentation
	runId: string | null
	modelSelectionPromise: Promise<ModelSelection | null> | null
	onSelectScreen: (screen: HudScreen) => void
}

export function HudHeader({
	presentation,
	runId,
	modelSelectionPromise,
	onSelectScreen,
}: HudHeaderProps) {
	return (
		<div
			className={
				presentation.headerVariant === "landing"
					? "agent-hud__header agent-hud__header--landing"
					: "agent-hud__header agent-hud__header--row"
			}>
			<Suspense fallback={<ModelSelectorLoading />}>
				{modelSelectionPromise ? (
					<ModelSelector
						key={presentation.modelScope === "default" ? "default" : runId}
						runId={presentation.modelScope === "run" ? runId : null}
						initialSelection={modelSelectionPromise}
					/>
				) : (
					<ModelSelectorLoading />
				)}
			</Suspense>
			<div className="agent-hud__header-actions flex shrink-0 items-start gap-(--hud-actions-gap)">
				<ThemeToggle />
				<UnlockApiKeys />
				<HudScreenSelector
					screen={presentation.screen}
					options={presentation.screenOptions}
					onSelectScreen={onSelectScreen}
				/>
			</div>
		</div>
	)
}
