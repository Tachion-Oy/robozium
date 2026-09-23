"use client"

import { StreamLogRole } from "@/lib/robozium/view-model"
import { TerminalCursor } from "./TerminalCursor"

type TerminalPromptProps = {
	/** Caret color; shell line stays agent-styled. */
	cursorRole?: StreamLogRole
}

/**
 * Bottom input prompt shown before the blinking caret.
 */
export function TerminalPrompt({ cursorRole = StreamLogRole.Agent }: TerminalPromptProps) {
	return (
		<div
			className="term-prompt flex items-center gap-[0.15em] mt-[1.1rem]"
			aria-label="Terminal prompt">
			<span className="term-prompt-host">robozium@local</span>
			<span className="term-prompt-sep">:</span>
			<span className="term-prompt-path">~</span>
			<span className="term-prompt-sigil">$</span>
			<TerminalCursor role={cursorRole} />
		</div>
	)
}
