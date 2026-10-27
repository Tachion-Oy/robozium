import type { ReactElement } from "react"
import type { NoticeAction, NotificationTone } from "../../feedback/notices"

export { showNotificationToast, showErrorToast } from "../../feedback/notices"

type ErrorToastContentProps = {
	title?: string
	message: string
	detail?: string | null
	tone?: NotificationTone
	isVisible: boolean
	/** Buttons that answer the toast, such as Retry. */
	actions?: readonly NoticeAction[]
	onDismiss?: () => void
}

export function ErrorToastContent({
	title = "Action Required",
	message,
	detail,
	tone = "error",
	isVisible,
	actions,
	onDismiss,
}: ErrorToastContentProps): ReactElement {
	return (
		<section
			role={tone === "error" ? "alert" : "status"}
			aria-live={tone === "error" ? "assertive" : "polite"}
			// A leaving toast still fades out, but is no longer content.
			aria-hidden={!isVisible}
			className={`agent-error-toast agent-error-toast--${tone} pointer-events-auto flex w-[min(50rem,calc(100vw-2rem))] items-start gap-3 px-4 py-4 ${
				isVisible
					? " agent-error-toast--visible"
					: " agent-error-toast--hidden"
			}`}>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<p className="agent-error-toast__title">{title}</p>
				<p className="agent-error-toast__message">{message}</p>
				{detail ? <p className="agent-error-toast__detail">{detail}</p> : null}
			</div>
			{actions?.map(action => (
				<button
					key={action.label}
					type="button"
					className="agent-error-toast__action shrink-0"
					disabled={action.disabled}
					data-hud-ignore-dismiss
					onPointerDown={(event) => event.stopPropagation()}
					onClick={(event) => {
						event.stopPropagation()
						action.onClick()
					}}>
					{action.label}
				</button>
			))}
			{onDismiss ? (
				<button
					type="button"
					className="agent-error-toast__dismiss shrink-0"
					data-hud-ignore-dismiss
					onPointerDown={(event) => event.stopPropagation()}
					onClick={(event) => {
						event.stopPropagation()
						onDismiss()
					}}
					aria-label={`Dismiss ${tone} notification`}>
					Dismiss
				</button>
			) : null}
		</section>
	)
}
