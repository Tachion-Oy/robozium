import { useEffect, type RefObject } from "react"
import type { LayoutMode } from "./HudDividerControls"
import "./hud-panels.css"

function AgentMessagePanel({ message }: { message: string }) {
	return (
		<section className="hud-panel hud-panel--agent" aria-label="Agent message">
			<div className="hud-panel__scroll" tabIndex={0} aria-label="Agent message text" role="region">
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

export function HudPanels({ message, draft, onDraftChange, layout, focusOnOpen, editor }: {
	message: string
	draft: string
	onDraftChange: (draft: string) => void
	layout: LayoutMode
	focusOnOpen: boolean
	editor: RefObject<HTMLTextAreaElement | null>
}) {
	return (
		<section className="hud-panels" data-layout={layout} aria-label="Current Run">
			<AgentMessagePanel message={message} />
			<ReplyEditor draft={draft} onChange={onDraftChange} focusOnOpen={focusOnOpen} editor={editor} />
		</section>
	)
}
