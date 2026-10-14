import { HudButton } from "./HudButton"

type HudHeaderProps = {
	theme: "dark" | "light"
	onToggleTheme: () => void
}

function SelectorCaret() {
	return (
		<svg className="hud-header__caret" viewBox="0 0 16 14" aria-hidden="true">
			<path d="M8 12.75 1.25 1.25h13.5Z" />
		</svg>
	)
}

export function HudHeader({ theme, onToggleTheme }: HudHeaderProps) {
	const nextTheme = theme === "dark" ? "Light" : "Dark"
	return (
		<header className="hud-header">
			<HudButton variant="success" className="hud-header__selector hud-header__model"
				title="Mock model" disabled>
				<span className="hud-header__label">Mock model</span>
				<SelectorCaret />
			</HudButton>
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
			<HudButton variant="warning" className="hud-header__selector"
				title="Runs Overview" disabled>
				<span className="hud-header__label">Runs Overview</span>
				<SelectorCaret />
			</HudButton>
		</header>
	)
}
