// The theme owner saves the choice natively; one window needs no cookie or channel.
// The toggle is the centre of the left edge, between the zoom and panel divider
// buttons, shaped as the message log toggle on the right edge. It shows the current theme: a sun in light,
// a moon in dark. Both glyphs stay in the document and CSS shows one, so the glyph
// changes inside the theme switch's fade.
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
			<svg className="agent-hud__layout-wedge theme-toggle__glyph theme-toggle__sun" viewBox="0 0 24 24" aria-hidden="true">
				<path d="M16.07 10.32v3.36l-2.39 2.39h-3.36l-2.39-2.39v-3.36l2.39-2.39h3.36Z" />
				<path d="M10 5.8h4L12 0.4ZM10 18.2h4L12 23.6ZM5.8 10v4L0.4 12ZM18.2 10v4l5.4 -2Z" />
				<path transform="rotate(45 12 12)" d="M10.5 5.6h3L12 1.6ZM10.5 18.4h3L12 22.4ZM5.6 10.5v3L1.6 12ZM18.4 10.5v3l4 -1.5Z" />
			</svg>
			<svg className="agent-hud__layout-wedge theme-toggle__glyph theme-toggle__moon" viewBox="0 0 24 24" aria-hidden="true">
				<path d="M9.5 3.62 3.61 7.03 1.51 13.5 4.28 19.72 10.5 22.49 16.97 20.39 20.38 14.5 15.39 15.42 10.84 13.16 8.58 8.61Z" />
				<path d="M17.5 2.9 18.2 4.8 20.1 5.5 18.2 6.2 17.5 8.1 16.8 6.2 14.9 5.5 16.8 4.8Z" />
			</svg>
		</HudEdgeButton>
	)
}
