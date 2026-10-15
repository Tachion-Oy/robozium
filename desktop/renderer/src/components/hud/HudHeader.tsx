import { useState } from "react"
import { modelOptions, viewOptions, type ModelId, type HudView } from "../../fixtures/header"
import { HudButton } from "./HudButton"
import { HudSelector } from "./HudSelector"
import { SelectorCaret } from "./SelectorCaret"
import "./hud-header.css"
import "./theme-toggle.css"

type HudHeaderProps = {
	theme: "dark" | "light"
	onToggleTheme: () => void
	model: ModelId
	onSelectModel: (model: ModelId) => void
	view: HudView
	onSelectView: (view: HudView) => void
}

export function HudHeader({ theme, onToggleTheme, model, onSelectModel, view, onSelectView }: HudHeaderProps) {
	const [openSelector, setOpenSelector] = useState<"model" | "view" | null>(null)
	const toggleSelector = (selector: "model" | "view", open: boolean) =>
		setOpenSelector(current => open ? selector : current === selector ? null : current)
	const nextTheme = theme === "dark" ? "Light" : "Dark"
	return (
		<header className="hud-header">
			<HudSelector value={model} options={modelOptions} label="Base model" variant="model"
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
			<HudSelector value={view} options={viewOptions} label="HUD view" variant="view"
				onSelect={onSelectView} open={openSelector === "view"}
				onOpenChange={open => toggleSelector("view", open)} />
		</header>
	)
}
