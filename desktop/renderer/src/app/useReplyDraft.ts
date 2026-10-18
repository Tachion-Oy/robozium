import { useRef, useState } from "react"
import type { ReplyResult } from "../session/useRunInteractions"

export interface ReplyDraft {
	value: string
	change: (value: string) => void
	submit: (reply: (content: string) => Promise<ReplyResult>) => Promise<void>
}

/** Keep the shared draft; an acknowledgement can clear only the submitted revision. */
export function useReplyDraft(initialValue: string): ReplyDraft {
	const [value, setValue] = useState(initialValue)
	const revision = useRef(0)

	function change(next: string): void {
		revision.current++
		setValue(next)
	}

	async function submit(reply: (content: string) => Promise<ReplyResult>): Promise<void> {
		const submittedRevision = revision.current
		const result = await reply(value)
		if (result.status !== "acknowledged" || result.promptState === "replaced") return
		if (revision.current === submittedRevision) {
			change("")
		}
	}

	return { value, change, submit }
}
