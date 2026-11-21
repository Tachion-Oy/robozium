// The log rows are a selector over the shown run's retained events.
import { useMemo, type ReactNode } from "react"
import { TerminalBackdrop } from "../terminal/TerminalBackdrop"
import { TerminalStream } from "../terminal/TerminalStream"
import { PlaceholderLog } from "../terminal/demo/DemoLog"
import { selectLogItems } from "../../log/run-log"
import type { RunRecord } from "../../run/run-contracts"

type MessageLogProps = {
	active: boolean
	events: readonly RunRecord[]
	/** Chooses the shown run. */
	runSelector: ReactNode
}

/** One local terminal renderer, mounted only while the attached pane is open. */
export function MessageLog({ active, events, runSelector }: MessageLogProps) {
	const items = useMemo(() => selectLogItems(events), [events])
	let content = <TerminalStream items={items} footerStart={runSelector} />
	if (!active) {
		content = <div className="flex flex-1 min-h-0 w-full flex-col">
			<PlaceholderLog scrollable command="START AN AGENT TO SEE THE LIVE MESSAGES !" />
			<div className="term-log-footer">{runSelector}</div>
		</div>
	}
	return (
		<section id="message-log" aria-label="Message log" className="message-log" data-live={active || undefined}>
			<TerminalBackdrop title={!active}>{content}</TerminalBackdrop>
		</section>
	)
}
