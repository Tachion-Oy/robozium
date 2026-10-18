import { useEffect, useState } from "react"
import { HudButton } from "../HudButton"
import { HudMessageNavigation } from "./HudMessageNavigation"
import { CopyTextButton } from "./CopyTextButton"
import { useDesktopActionLayout } from "../../hud/useDesktopActionLayout"
import "./hud-footer.css"

interface FooterAction {
	enabled: boolean
	pending: boolean
	onClick: () => void
}

interface HudFooterProps {
	message: string
	selected: number
	count: number
	currentIndex?: number
	onSelect: (index: number) => void
	draft: string
	onClear: () => void
	status?: string
	reply?: FooterAction
	interrupt?: FooterAction
	cancel?: FooterAction
}

export function HudFooter({
	message, selected, count, currentIndex, onSelect, draft, onClear, status,
	reply, interrupt, cancel,
}: HudFooterProps) {
	const actions = useDesktopActionLayout()
	const [error, setError] = useState("")
	useEffect(() => setError(""), [message, draft])
	return (
		<footer className="hud-footer" role="group" aria-label="Current Run controls">
			<div className="hud-footer__actions" ref={actions}>
				<HudButton className="hud-footer__cancel" variant="warning" disabled={!cancel?.enabled} onClick={cancel?.onClick}>{cancel?.pending ? "Cancelling…" : "Cancel"}</HudButton>
				<HudButton className="hud-footer__interrupt" variant="danger" disabled={!interrupt?.enabled} onClick={interrupt?.onClick}>{interrupt?.pending ? "Interrupting…" : "Interrupt"}</HudButton>
				<div className="hud-footer__navigation">
					<HudMessageNavigation selected={selected} count={count} currentIndex={currentIndex} onSelect={onSelect} status={status} />
				</div>
				<div className="hud-footer__helpers" role="group" aria-label="Text actions">
					<HudButton className="hud-footer__copy" disabled={draft === ""}
						aria-label="Clear reply" title="Clear reply" onClick={onClear}>
						<svg className="hud-footer__icon" viewBox="0 0 24 24" aria-hidden="true">
							<path d="m4.75 14.75 8.9-8.9a2.1 2.1 0 0 1 2.97 0l1.53 1.53a2.1 2.1 0 0 1 0 2.97l-8.9 8.9H7.72l-2.97-2.97a1.08 1.08 0 0 1 0-1.53Z" />
							<path d="m10.25 9.25 4.5 4.5M9.25 19.25H20" />
						</svg>
					</HudButton>
					<CopyTextButton content={draft} target="reply" onError={setError} />
					<CopyTextButton content={message} target="agent output" onError={setError} />
				</div>
				<HudButton className="hud-footer__record" variant="success" disabled><span>Record</span></HudButton>
				<HudButton className="hud-footer__send" variant="success" disabled={!reply?.enabled} onClick={reply?.onClick}>{reply?.pending ? "Sending…" : "Send"}</HudButton>
			</div>
			{error && <p className="hud-footer__error" role="alert">{error}</p>}
		</footer>
	)
}
