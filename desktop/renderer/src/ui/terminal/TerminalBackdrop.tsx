import type { ReactNode } from "react"
import { DisplayArt } from "../branding/DisplayArt"
import { TerminalFrame } from "./TerminalFrame"

/** Shared terminal geometry keeps the local loading HUD aligned with the app. */
export function TerminalBackdrop({ children, title = true, animateTitle = false }: {
	children: ReactNode
	title?: boolean
	animateTitle?: boolean
}) {
	return (
		<div className="desktop-terminal term-scanlines term-vignette">
			{title && <div className="app-nav__row relative z-60 shrink-0">
				<div className="flex h-full items-center justify-center px-(--landing-nav-inset)">
					<h1 className={`app-nav__brand app-nav__brand--bar m-0${animateTitle ? " app-nav__brand--enter" : ""}`}>
						<span className="app-nav__brand-label"><span className="app-nav__brand-art" aria-hidden="true"><DisplayArt name="robozium" decorative /></span><span className="sr-only">Robozium</span></span>
					</h1>
				</div>
			</div>}
			<TerminalFrame>{children}</TerminalFrame>
		</div>
	)
}
