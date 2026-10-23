// Copied from robozium-electron/desktop/web/app/components/theme/ThemeToggle.tsx at 076b2c9.
// Adapted: the theme owner saves the choice natively; one window needs no cookie or channel.
import { toggleTheme } from "../../theme/theme"

export function ThemeToggle({ disabled = false }: { disabled?: boolean }) {
	return (
		<button
			type="button"
			className="theme-toggle agent-hud__selector-trigger"
			data-hud-ignore-dismiss
			aria-label="Toggle color theme"
			disabled={disabled}
			onClick={() => {
				void toggleTheme()
			}}>
			<span className="theme-toggle__indicator" aria-hidden="true" />
			<span className="theme-toggle__label theme-toggle__label--light">
				Light
			</span>
			<span className="theme-toggle__label theme-toggle__label--dark">
				Dark
			</span>
		</button>
	)
}
