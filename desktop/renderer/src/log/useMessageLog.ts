// Own whether the message log pane is open. Step 13c moves this state into main,
// which resizes the window and remembers it across launches.
import { useCallback, useState } from "react"

export interface MessageLogState {
	open: boolean
	toggle: () => void
}

export function useMessageLog(): MessageLogState {
	const [open, setOpen] = useState(false)
	const toggle = useCallback(() => setOpen(value => !value), [])
	return { open, toggle }
}
