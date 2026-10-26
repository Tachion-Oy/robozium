// Copied from robozium-electron/desktop/web/app/components/theme/ThemeToggle.tsx at 076b2c9.
// Adapted: the theme owner saves the choice natively; one window needs no cookie or channel.
// The toggle is a left-edge button above the panel divider buttons, shaped as the
// message log toggle on the right edge, showing only its dot.
import { toggleTheme } from "../../theme/theme"

export function ThemeToggle() {
	return (
		<button
			type="button"
			className="theme-toggle agent-hud__corner-control agent-hud__edge-toggle"
			data-hud-ignore-dismiss
			aria-label="Toggle color theme"
			title="Toggle color theme"
			onClick={() => {
				void toggleTheme()
			}}>
			<span className="theme-toggle__indicator" aria-hidden="true" />
		</button>
	)
}
