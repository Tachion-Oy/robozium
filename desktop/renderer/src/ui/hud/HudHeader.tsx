// Copied from web/app/components/hud/HudHeader.tsx at a664db2.
// Adapted: the model selector and the secrets menu are supplied by the caller.
import type { ReactNode } from "react"
import { ThemeToggle } from "../theme/ThemeToggle"
import { HudScreenSelector } from "./HudScreenSelector"
import type { HudPresentation, HudScreen } from "./hudPresentation"

type HudHeaderProps = {
	presentation: HudPresentation
	modelSelector: ReactNode
	secretsMenu: ReactNode
	onSelectScreen: (screen: HudScreen) => void
}

export function HudHeader({
	presentation,
	modelSelector,
	secretsMenu,
	onSelectScreen,
}: HudHeaderProps) {
	return (
		<div
			className={[
				"agent-hud__header",
				presentation.headerVariant === "landing"
					? "agent-hud__header--landing"
					: "agent-hud__header--row",
				presentation.showProjectBadge ? "agent-hud__header--project" : "",
				presentation.context === "active-run" && presentation.screen === "projects"
					? "agent-hud__header--runs-overview"
					: "",
			]
					.filter(Boolean)
					.join(" ")}>
			{modelSelector}
			<div className="agent-hud__header-actions flex shrink-0 items-start gap-(--hud-actions-gap)">
				<ThemeToggle />
				{secretsMenu}
				<HudScreenSelector
					screen={presentation.screen}
					options={presentation.screenOptions}
					onSelectScreen={onSelectScreen}
				/>
			</div>
		</div>
	)
}
