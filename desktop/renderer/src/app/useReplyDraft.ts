import { useRef, useState } from "react"

export interface ReplyDraft {
	value: string
	change: (value: string) => void
	submit: (reply: (content: string) => Promise<boolean>) => Promise<void>
}

/** Keep the shared draft; an acknowledgement can clear only the submitted revision. */
export function useReplyDraft(initialValue: string): ReplyDraft {
	const [value, setValue] = useState(initialValue)
	const revision = useRef(0)

	function change(next: string): void {
		revision.current++
		setValue(next)
	}

	async function submit(reply: (content: string) => Promise<boolean>): Promise<void> {
		const submittedRevision = revision.current
		const accepted = await reply(value)
		if (accepted && revision.current === submittedRevision) {
			change("")
		}
	}

	return { value, change, submit }
}
