"use client"

import { TerminalBackdrop } from "../terminal/TerminalBackdrop"
import { TerminalStream } from "../terminal/TerminalStream"
import { PlaceholderLog } from "../terminal/demo/DemoLog"

/** One local terminal renderer, mounted only while the attached pane is open. */
export function MessageLog({ active }: { active: boolean }) {
	return (
		<section id="desktop-message-log" aria-label="Message log" className="desktop-message-log">
			<TerminalBackdrop title={!active}>
				{active ? <TerminalStream readable /> : <PlaceholderLog scrollable />}
			</TerminalBackdrop>
		</section>
	)
}
