// Copied from robozium-electron/desktop/web/app/components/desktop/MessageLog.tsx at 076b2c9.
// Adapted: the log rows are a selector over the displayed run's retained events.
import { useMemo } from "react"
import { TerminalBackdrop } from "../terminal/TerminalBackdrop"
import { TerminalStream } from "../terminal/TerminalStream"
import { PlaceholderLog } from "../terminal/demo/DemoLog"
import { selectLogItems } from "../../log/run-log"
import type { RunRecord } from "../../run/run-contracts"

/** One local terminal renderer, mounted only while the attached pane is open. */
export function MessageLog({ active, events }: { active: boolean; events: readonly RunRecord[] }) {
	const items = useMemo(() => selectLogItems(events), [events])
	return (
		<section id="desktop-message-log" aria-label="Message log" className="desktop-message-log" data-live={active || undefined}>
			<TerminalBackdrop title={!active}>
				{active ? <TerminalStream items={items} readable /> : <PlaceholderLog scrollable command="START AN AGENT TO SEE THE LIVE MESSAGES !" />}
			</TerminalBackdrop>
		</section>
	)
}
