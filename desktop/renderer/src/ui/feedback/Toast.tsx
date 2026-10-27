// A toast declared where its condition lives: render it to show it, change its props
// to update it, and stop rendering it to remove it. It takes no space in the layout.
import { useEffect, useId } from "react"
import { holdToast, releaseToast, type PersistentToastOptions } from "../../feedback/notices"

export function Toast(props: PersistentToastOptions): null {
	const owner = useId()
	useEffect(() => holdToast(owner, props))
	useEffect(() => () => releaseToast(owner), [owner])
	return null
}
