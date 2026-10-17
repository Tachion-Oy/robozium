import { useState } from "react"
import { viewOptions, runViewOptions, type HudView } from "../../fixtures/header"
import { HudButton } from "./HudButton"
import { HudSelector } from "./HudSelector"
import { SelectorCaret } from "./SelectorCaret"
import "./hud-header.css"
import "./theme-toggle.css"

type HudHeaderProps = {
	theme: "dark" | "light"
	onToggleTheme: () => void
	model: string
	models: readonly { value: string; label: string }[]
	modelDisabled?: boolean
	modelPlaceholder?: string
	onSelectModel: (model: string) => void
	view: HudView
	hasRun: boolean
	onSelectView: (view: HudView) => void
}

export function HudHeader({ theme, onToggleTheme, model, models, modelDisabled, modelPlaceholder, onSelectModel, view, hasRun, onSelectView }: HudHeaderProps) {
	const [openSelector, setOpenSelector] = useState<"model" | "view" | null>(null)
	const toggleSelector = (selector: "model" | "view", open: boolean) =>
		setOpenSelector(current => open ? selector : current === selector ? null : current)
	const nextTheme = theme === "dark" ? "Light" : "Dark"
	return (
		<header className="hud-header">
			<HudSelector value={model} options={models} disabled={modelDisabled} placeholder={modelPlaceholder} label="Base model" variant="model"
				onSelect={onSelectModel} open={openSelector === "model"}
				onOpenChange={open => toggleSelector("model", open)} />
			<HudButton variant="info" className="theme-toggle" aria-label="Toggle color theme"
				title={`Switch to ${nextTheme.toLowerCase()} theme`} onClick={onToggleTheme}>
				<span className="theme-toggle__indicator" aria-hidden="true" />
				<span className="hud-header__label">{nextTheme}</span>
			</HudButton>
			<HudButton variant="danger" className="hud-header__selector"
				title="Secrets unavailable" disabled>
				<span className="hud-header__label">Secrets unavailable</span>
				<SelectorCaret />
			</HudButton>
			<HudSelector value={view} options={hasRun ? runViewOptions : viewOptions} label="HUD view" variant="view"
				onSelect={onSelectView} open={openSelector === "view"}
				onOpenChange={open => toggleSelector("view", open)} />
		</header>
	)
}
