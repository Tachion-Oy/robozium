// Copied from web/app/components/terminal/TerminalCursor.tsx at db6a20f.
import { logRoleToCaret, StreamLogRole } from "../../log/view-model"

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
