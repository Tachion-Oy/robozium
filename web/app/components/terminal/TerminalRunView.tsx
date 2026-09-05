"use client"

import { StreamLogRole } from "@/lib/robosprawl/view-model"
import { TerminalLog } from "./TerminalLog"
import { TerminalMessage } from "./TerminalMessage"
import { TerminalStream } from "./TerminalStream"
import { TerminalCursor } from "./TerminalCursor"
import { IntroStream, PlaceholderLog } from "./demo/DemoLog"

type TerminalRunViewProps = {
	runId: string | null
	error: string | null
	/** Play the fresh-load intro instead of the static demo log. */
	playIntro?: boolean
	/** Called once the intro stream has finished (after the HUD pause). */
	onIntroDone?: () => void
	/**
	 * Fade the placeholder log in. False right as the boot intro hands off
	 * (same content already visible, no motion wanted); true once returning to
	 * landing after a run (a genuine swap-in behind the HUD).
	 */
	fadeInPlaceholder?: boolean
}

export function TerminalRunView({
	runId,
	error,
	playIntro = false,
	onIntroDone,
	fadeInPlaceholder = false,
}: TerminalRunViewProps) {
	if (!runId && !error) {
		if (playIntro && onIntroDone) {
			return <IntroStream onIntroDone={onIntroDone} />
		}
		return <PlaceholderLog fadeIn={fadeInPlaceholder} />
	}

	if (error) {
		return (
			<TerminalLog>
				<TerminalMessage role={StreamLogRole.Error}>
					{error}
					<TerminalCursor role={StreamLogRole.Error} />
				</TerminalMessage>
			</TerminalLog>
		)
	}

	return <TerminalStream />
}
