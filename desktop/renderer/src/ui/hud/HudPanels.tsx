import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react"
import type { LayoutMode } from "./HudCornerControls"
import "./hud-panels.css"

function AgentMessagePanel({ message, messageId, streaming, notice }: { message: string; messageId: string; streaming: boolean; notice?: ReactNode }) {
	const scroller = useRef<HTMLDivElement>(null)
	const previousId = useRef(messageId)
	useLayoutEffect(() => {
		if (scroller.current) {
			if (previousId.current !== messageId) scroller.current.scrollTop = 0
			else if (streaming) scroller.current.scrollTop = scroller.current.scrollHeight
		}
		previousId.current = messageId
	}, [message, messageId, streaming])
	return (
		<section className="hud-panel hud-panel--agent" aria-label="Agent message">
			<div ref={scroller} className="hud-panel__scroll" tabIndex={0} aria-label="Agent message text" role="region">
				{notice}
				<pre>{message}</pre>
			</div>
		</section>
	)
}

function ReplyEditor({ draft, onChange, focusOnOpen, editor }: {
	draft: string; onChange: (draft: string) => void; focusOnOpen: boolean
	editor: RefObject<HTMLTextAreaElement | null>
}) {
	useEffect(() => {
		if (focusOnOpen) editor.current?.focus()
	}, [focusOnOpen, editor])
	return (
		<div className="hud-panel hud-panel--user">
			<textarea ref={editor} aria-label="Reply" placeholder="Type your reply..."
				value={draft} onChange={event => onChange(event.target.value)} />
		</div>
	)
}

export function HudPanels({ message, messageId, streaming = false, notice, draft, onDraftChange, layout, focusOnOpen, editor }: {
	messageId: string
	streaming?: boolean
	notice?: ReactNode
	message: string
	draft: string
	onDraftChange: (draft: string) => void
	layout: LayoutMode
	focusOnOpen: boolean
	editor: RefObject<HTMLTextAreaElement | null>
}) {
	return (
		<section className="hud-panels" data-layout={layout} aria-label="Current Run">
			<AgentMessagePanel message={message} messageId={messageId} streaming={streaming} notice={notice} />
			<ReplyEditor draft={draft} onChange={onDraftChange} focusOnOpen={focusOnOpen} editor={editor} />
		</section>
	)
}
