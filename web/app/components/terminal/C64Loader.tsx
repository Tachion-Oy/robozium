import { StreamLogRole } from "@/lib/robosprawl/view-model"
import { TerminalCursor } from "./TerminalCursor"

export function C64Loader() {
	return (
		<div className="mt-4">
			<div className="term-prompt flex items-center gap-[0.15em]">
				<span className="term-prompt-host">robosprawl@local</span>
				<span className="term-prompt-sep">:</span>
				<span className="term-prompt-path">~</span>
				<span className="term-prompt-sigil">$</span>
				<span></span>
				<TerminalCursor role={StreamLogRole.Agent} />
			</div>
		</div>
	)
}
