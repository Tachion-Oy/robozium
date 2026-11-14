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
		<div className="terminal-backdrop term-scanlines term-vignette">
			{title && <div className="term-title relative z-60 shrink-0">
				<div className="flex h-full items-center justify-center px-(--title-row-inset)">
					<h1 className={`term-title__brand term-title__brand m-0${animateTitle ? " term-title__brand--enter" : ""}`}>
						<span className="term-title__label"><span className="term-title__art" aria-hidden="true"><DisplayArt name="robozium" decorative /></span><span className="sr-only">Robozium</span></span>
					</h1>
				</div>
			</div>}
			<TerminalFrame>{children}</TerminalFrame>
		</div>
	)
}
