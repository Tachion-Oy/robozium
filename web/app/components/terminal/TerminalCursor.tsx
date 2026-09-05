import { logRoleToCaret, StreamLogRole } from "@/lib/robosprawl/view-model"

type TerminalCursorProps = {
	role?: StreamLogRole
}

export function TerminalCursor({
	role = StreamLogRole.Agent,
}: TerminalCursorProps) {
	return (
		<span
			className="term-caret"
			data-term-role={logRoleToCaret[role]}
			aria-hidden="true"
		/>
	)
}
