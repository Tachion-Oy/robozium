// The theme owner saves the choice natively; one window needs no cookie or channel.
// The toggle is a left-edge button above the panel divider buttons, shaped as the
// message log toggle on the right edge, showing only its dot.
import { toggleTheme } from "../../theme/theme"
import { HudEdgeButton } from "../hud/HudEdgeButton"

export function ThemeToggle() {
	return (
		<HudEdgeButton
			variant="toggle"
			className="theme-toggle"
			data-hud-ignore-dismiss
			aria-label="Toggle color theme"
			title="Toggle color theme"
			onClick={() => {
				void toggleTheme()
			}}>
			<span className="theme-toggle__indicator" aria-hidden="true" />
		</HudEdgeButton>
	)
}
