import { useRef, useState } from "react"

/** Keep the shared draft; an acknowledgement can clear only the submitted revision. */
export function useReplyDraft(initialValue: string) {
	const [value, setValue] = useState(initialValue)
	const revision = useRef(0)

	function change(next: string) {
		revision.current++
		setValue(next)
	}

	async function submit(reply: (content: string) => Promise<boolean>) {
		const submittedRevision = revision.current
		const accepted = await reply(value)
		if (accepted && revision.current === submittedRevision) {
			change("")
		}
	}

	return { value, change, submit }
}
